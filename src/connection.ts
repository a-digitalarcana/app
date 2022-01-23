import { Card } from "./cards";
import { newTable, broadcastMsg, getMessages } from "./cardtable";
import { collectCards } from "./cardcollector";
import { Socket } from "socket.io";
import { redis, RedisClientType } from "./server";
import { War } from "./games/war";
import { assert } from "console";

export const getUserName = async (userId: string) => {
    const name = await redis.hGet(userId, 'name');
    return name ?? "Unknown";
};

// setTable: tableId (string)
// revealCards: cards (Card[])
export const sendEvent = (userId: string, event: any, payload?: any) => {
    redis.publish(userId, JSON.stringify({event, payload}));
};

export class Connection
{
    sub: RedisClientType;
    msg: RedisClientType;
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
        this.sub.disconnect();
        this.msg.disconnect();
    }

    constructor(socket: Socket) {
        this.socket = socket;
        this.sub = redis.duplicate();
        this.msg = redis.duplicate();
        this.sub.connect();
        this.msg.connect();

        socket.on('setWallet', async (address: string) => {
            console.log(`setWallet: ${address}`);

            // Handle table join commands
            if (this.userId) {
                this.sub.unsubscribe(this.userId);
            }
            this.userId = address;
            this.sub.subscribe(this.userId, msg => {
                const data = JSON.parse(msg);
                this.handleEvent(data.event, data.payload);
            });

            // Fetch cached data
            const info = await redis.hGetAll(this.userId);
            if (info.name) {
                this.welcome(info.name);
            }
            this.setTable(info.table ?? null);

            collectCards(address);
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

                if (game == "War") {
                    const game = new War(tableId);
                    game.begin();
                }

            } else {

                // Wait for someone else to join
                this.setWaiting(game);
                this.socket.emit('msg', "Waiting for another player...");
            }
        });

        socket.on('drawCard', () => redis.publish(`${this.userId}:drawCard`, ""));
    }

    handleEvent(event: any, payload: any) {
        switch (event) {
            case 'setTable': this.setTable(payload); break;
            case 'revealCards': this.revealCards(payload); break;
            default: this.socket.emit(event, payload); break;
        }
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

    async setTable(tableId: string | null) {

        // Cleanup previous.
        if (this.tableId) {
            this.msg.unsubscribe(this.tableId);
        }

        this.tableId = tableId;
        if (!tableId) {
            return;
        }

        // Broadcast event handler.
        let last = -1;
        const onMsg = async (msg: string = "msg") => {
            if (msg === "msg") {
                const msgs = await getMessages(tableId, last+1);
                for (let msg of msgs) {
                    if (msg.score <= last) {
                        continue;
                    }
                    last = msg.score;
                    this.handleMsg(msg.value);
                }
            } else {
                this.handleMsg(msg);
            }
        };

        await this.msg.subscribe(tableId, onMsg);

        // Get any pending messages, now
        // that our handler is hooked up.
        onMsg();
    }

    handleMsg(msg: string) {
        const data = JSON.parse(msg);
        if (data.exclude === this.userId) {
            return;
        }
        this.socket.emit(data.event, ...data.args);
    }

    revealCards(cards: Card[]) {
        this.socket.emit('revealCards', cards);
    }
}

