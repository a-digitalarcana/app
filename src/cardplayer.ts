import axios from "axios";
import { indexerUrl, fa2Contract } from "./contracts";
import { Card, CardDeck, registerCard } from "./cards";
import { Socket, Server } from "socket.io";
import { bytes2Char } from "@taquito/utils";
import { CardTable } from "./cardtable";
import { players } from "./server";

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
    io: Server;
    socket: Socket;
    name: string = "Unknown";
    walletAddress: string = "";
    table: CardTable | null = null;
    owned: CardDeck | null = null;
    pendingTable: boolean = false;

    constructor(socket: Socket, io: Server) {
        this.socket = socket;
        this.io = io;

        socket.on('setWallet', (address: string) => {
            console.log(`setWallet: ${address}`);
            this.walletAddress = address;
            this.getCards();
        });

        socket.on('userName', (name: string) => {
            this.name = name;
            this.socket.emit('msg', `Welcome ${name}!`);
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

        socket.on('playOnline', (game: string) => {
            console.log(`Player ${this.name} wants to play ${game}`);

            // See if anyone is waiting
            for (let player of players) {
                if (player.pendingTable) {
                    player.pendingTable = false;

                    // New table for two
                    var table = new CardTable();
                    table.join(player);
                    table.join(this);
                    table.welcome();
                    tables.push(table);                    
                    return;
                }
            }

            // Wait for someone else to join
            this.pendingTable = true;
            this.socket.emit('msg', "Waiting for another player...");

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

    revealCards(cards: Card[]) {
        this.socket.emit('revealCards', cards);
    }

    async getCards() {
        // query the list of nft token_ids owned by this wallet address
        const bigmapQuery = indexerUrl + fa2Contract + "/bigmaps";
        const ledgerQuery = bigmapQuery + "/ledger/keys?select=key,value,active&key.address=" + this.walletAddress;
        const { data } = await axios.get<LedgerEntry[]>(ledgerQuery);
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
            const { data } = await axios.get<MetadataEntry[]>(metadataQuery);

            // register unique instances for number owned
            const cards = [];
            for (let entry of data) {
                const token_id = parseInt(entry.token_id);
                const ipfsUri = bytes2Char(entry.token_info['']);
                const amount = amounts.get(token_id);
                if (amount) {
                    for (let i = 0; i < amount; i++) {
                        cards.push(registerCard(token_id, ipfsUri));
                    }
                    //console.log(`token_id=${entry.token_id} amount=${amount} metadata=${ipfsUri}`);
                } else {
                    console.log(`Invalid amount for token_id: ${entry.token_id}`);
                }
            }

            this.owned = new CardDeck(this, "owned");
            this.owned.add(cards);
            this.revealCards(cards);

        }
        else {
            console.log(`No owned cards for ${this.walletAddress}`);
        }
        // TODO: Register for changes to ledger to add/remove cards for this player.
    }
}
