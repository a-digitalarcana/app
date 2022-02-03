import { Card, getCards } from "./cards";
import { newTable, beginGame, resumeGame, broadcastMsg } from "./cardtable";
import { collectCards } from "./cardcollector";
import { Socket } from "socket.io";
import { redis } from "./server";
import { strict as assert } from "assert";

export const getUserName = async (userId: string) => {
    const name = await redis.hGet(userId, 'name');
    return name ?? "Unknown";
};

export const sendEvent = (id: string, event: any, ...args: any[]) => {
    const msg = JSON.stringify({event, args});
    redis.xAdd(`${id}:events`, '*', {msg});
};

export class Connection
{
    connected = true;
    socket: Socket;
    userId: string = ""; // wallet address
    tableId: string | null = null;

    async getName() {
        return await getUserName(this.userId);
    }

    welcome(name: string) {
        this.socket.emit('msg', `Welcome ${name}!`);
    }

    verifyUserId() {
        if (!this.userId) {
            this.socket.emit('msg', "You must choose a wallet before setting your name.");
            return false;
        }
        return true;
    }

    disconnect() {
        this.connected = false;
    }

    constructor(socket: Socket) {
        this.socket = socket;

        // Message handler
        (async () => {
            const stream = redis.duplicate();
            await stream.connect();
    
            const ids: any = {};

            while (this.connected) {

                const streams = [
                    `${this.userId}:events`,
                    `${this.tableId}:events`,
                    `${this.tableId}:chat`,
                ];

                const response = await stream.xRead(
                    streams.map(stream => ({id: ids[stream] ?? '0-0', key: stream})),
                    {BLOCK: 5000}
                );
                response?.forEach(stream => {
                    stream.messages.forEach(msg => {
                        this.handleEvent(msg.message.msg);
                        ids[stream.name] = msg.id;
                    });
                });
            }
            stream.disconnect();
        })();

        socket.on('setWallet', async (address: string) => {
            console.log(`setWallet: ${address}`);

            const oldId = this.userId;
            this.userId = address;

            collectCards(address);

            // Fetch cached data
            const info = await redis.hGetAll(this.userId);
            if (info.name) {
                this.welcome(info.name);
            }
            if (info.table) {
                this.setTable(info.table);
            } else {
                const tableId = await newTable([this.userId]);
                beginGame('Browse', tableId);
            }

            sendEvent(oldId, ""); // refresh streams
        });

        socket.on('userName', (name: string) => {
            if (!this.verifyUserId()) {
                return;
            }

            this.welcome(name);

            // Cache name across sessions
            redis.hSet(this.userId, 'name', name);
        });

        socket.on('chat', async (msg: string) => {
            const name = await this.getName();
            if (name) {
                msg = `${name}: ${msg}`;
            }
            console.log(msg);
            if (this.tableId) {
                broadcastMsg(this.tableId, msg);
            } else {
                this.socket.emit('msg', msg);
            }
        });

        socket.on('playOnline', async (game: string) => {
            const name = await this.getName();
            console.log(`Player ${name} wants to play ${game}`);
            if (!this.verifyUserId()) {
                return;
            }

            // See if anyone is waiting
            const waiting = await this.getNextWaiting();
            if (waiting) {

                // New table for two
                const tableId = await newTable([waiting, this.userId]);
                beginGame(game, tableId);

            } else {

                // Wait for someone else to join
                this.setWaiting(game);
                this.socket.emit('msg', "Waiting for another player...");
            }
        });

        socket.on('drawCard', () => {
            if (this.tableId) {
                redis.publish(`${this.tableId}:drawCard`, this.userId);
            }
        });

        socket.on('getCards', async (name: string) => {
            if (this.tableId) {
                const cards = await getCards(this.tableId, name);
                this.socket.emit('setCards', name, cards);
            }
        });
    }

    setWaiting(game: string) {
        assert(this.userId);
        redis.lPush('pendingTable', this.userId);
        // TODO: Track which game.
    }

    async getNextWaiting() {
    
        // Loop through players pending tables...
        while (true) {
            const pending = await redis.rPop('pendingTable');
            if (!pending) {
                break;
            }
    
            // TODO: Filter out if not currently connected?
    /*
            // Skip if already found a table.
            const table = await redis.hGet(pending, 'table');
            if (table) {
                continue;
            }
    */
            return pending;
        }
        return null;
    }

    async setTable(tableId: string) {
        this.tableId = tableId;
        resumeGame(tableId);
    }

    revealCards(cards: Card[]) {
        this.socket.emit('revealCards', cards);
    }

    handleEvent(msg: string) {
        const data = JSON.parse(msg);
        if (data.exclude === this.userId) {
            return;
        }
        switch (data.event) {
            case '': break;
            case 'setTable': this.setTable(data.args[0]); break;
            default: this.socket.emit(data.event, ...data.args); break;
        }
    }
}