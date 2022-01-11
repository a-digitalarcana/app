import axios from "axios";
import { indexerUrl, fa2Contract } from "./contracts";
import { Card, CardDeck, registerCard } from "./cards";
import { Socket, Server } from "socket.io";
import { bytes2Char } from "@taquito/utils";
import { CardTable } from "./cardtable";
import { totalCards } from "./tarot";
import { players, RedisClientType } from "./server";
import { War } from "./games/war";
import { assert } from "console";

const tables: CardTable[] = [];

type LedgerKey = {
    nat: string, // token_id
    address: string
};

type LedgerEntry = {
    key: LedgerKey,
    value: string, // amount
    active: boolean
};

type MetadataEntry = {
    token_id: string,
    token_info: any
};

export class CardPlayer
{
    db: RedisClientType;
    io: Server;
    socket: Socket;
    name: string = "Unknown";
    walletAddress: string = "";
    owned: CardDeck | null = null;
    table: CardTable | null = null;

    setName(name: string) {
        this.name = name;
        this.socket.emit('msg', `Welcome ${name}!`);
    }

    verifyWallet() {
        if (!this.walletAddress) {
            this.socket.emit('msg', "You must choose a wallet before setting your name.");
            return false;
        }
        return true;
    }

    constructor(socket: Socket, io: Server, db: RedisClientType) {
        this.socket = socket;
        this.io = io;
        this.db = db;

        socket.on('setWallet', async (address: string) => {
            console.log(`setWallet: ${address}`);
            this.walletAddress = address;

            // Fetch cached name (if any)
            const info = await db.hGetAll(this.walletAddress);
            if (info.name) {
                this.setName(info.name);
            }

            this.queryOwned();
            // TODO: Check for game in progress.
        });

        socket.on('userName', (name: string) => {
            if (!this.verifyWallet()) {
                return;
            }

            this.setName(name);

            // Cache name across sessions
            db.hSet(this.walletAddress, 'name', name);
        });

        socket.on('chat', (msg: string) => {
            if (this.name) {
                msg = this.name + ": " + msg;
            }
            console.log(msg);
            if (this.table) {
                this.table.emit(null, 'msg', msg);
            } else {
                this.socket.emit('msg', msg);
            }
        });

        socket.on('playOnline', async (game: string) => {
            console.log(`Player ${this.name} wants to play ${game}`);
            if (!this.verifyWallet()) {
                return;
            }

            // See if anyone is waiting
            const player = await this.getNextWaiting();
            if (player) {

                // New table for two
                var table = new CardTable();
                table.join(player);
                table.join(this);
                table.welcome();
                tables.push(table);

                if (game == "War") {
                    const game = new War(table);
                    game.begin();
                }

            } else {

                // Wait for someone else to join
                this.setWaiting(game);
                this.socket.emit('msg', "Waiting for another player...");
            }
        });
    }

    destroy() {
        const table = this.table;
        if (table) {
            table.leave(this);

            // Last one out destroy the table
            if (table.players.length <= 1) {
                tables.splice(tables.indexOf(table, 1));
                table.destroy();
            }
        }
    }

    setWaiting(game: string) {
        assert(this.walletAddress);
        this.db.lPush('pendingTable', this.walletAddress);
        // TODO: Track which game.
    }

    async getNextWaiting() {

        // Loop through players pending tables...
        while (true) {
            const pending = await this.db.rPop('pendingTable');
            if (!pending) {
                break;
            }

            // Return first connected player that doesn't already have a table.
            const player = findPlayer(pending);
            if (player && !player.table) {
                return player;
            }
        }
        return null;
    }

    revealCards(cards: Card[]) {
        this.socket.emit('revealCards', cards);
    }

    getBestOwned(value: number) {
        if (!this.owned) {
            return null;
        }

        const owned = this.owned.cards.filter((card) => card.value == value);
        if (owned.length === 0) {
            return null;
        }

        return owned.reduce((best, card) => (card.token_id < best.token_id) ? card : best);
    }

    async queryOwned() {

        // Destroy previous deck (if any)
        if (this.owned) {
            this.owned.destroy();
            this.owned = null;
        }

        const owned = new CardDeck(this, "owned");

        // query the list of nft token_ids owned by this wallet address
        const bigmapQuery = indexerUrl + fa2Contract + "/bigmaps";
        const ledgerQuery = bigmapQuery + "/ledger/keys?select=key,value,active&key.address=" + this.walletAddress;
        const config = {headers: {'Content-Type': 'application/json'}};
        const { data } = await axios.get<LedgerEntry[]>(ledgerQuery, config);
        const active = data.filter(entry => entry.active);
        if (active.length > 0) {

            // store off amounts for easier lookup below
            const amounts = new Map<number, number>();
            for (let entry of active) {
                amounts.set(parseInt(entry.key.nat), parseInt(entry.value));
            }

            // query the metadata for each of the token_ids
            const token_ids = active.map(entry => entry.key.nat);
            let metadataQuery = bigmapQuery + "/token_metadata/keys?select=value&key";
            metadataQuery += (token_ids.length === 1) ? "=" : ".in=";
            metadataQuery += token_ids.join(",");
            const { data } = await axios.get<MetadataEntry[]>(metadataQuery, config);

            // register unique instances for number owned
            const cards = [];
            for (let entry of data) {
                const token_id = parseInt(entry.token_id);
                const ipfsUri = bytes2Char(entry.token_info['']);
                const amount = amounts.get(token_id);
                if (amount) {
                    for (let i = 0; i < amount; i++) {
                        cards.push(registerCard(token_id % totalCards, token_id, ipfsUri));
                    }
                    //console.log(`token_id=${entry.token_id} amount=${amount} metadata=${ipfsUri}`);
                } else {
                    console.log(`Invalid amount for token_id: ${entry.token_id}`);
                }
            }

            owned.add(cards);
            this.revealCards(cards);
        }
        else {
            console.log(`No owned cards for ${this.walletAddress}`);
        }

        this.owned = owned;

        // TODO: Register for changes to ledger to add/remove cards for this player.
    }
}

// Find a connected player by walletAddress
export const findPlayer = (walletAddress: string) => {
    for (let player of players) {
        if (player.walletAddress === walletAddress) {
            return player;
        }
    }
    return null;
}