import { Card, getDecks, getDeckCards, getCards } from "./cards";
import { newTable, beginGame, resumeGame, broadcastMsg, numPlayers, getPlayerSlot, getPlayerSeat } from "./cardtable";
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

    async setName(name: string) {
        if (!this.verifyUserId()) {
            return;
        }

        this.welcome(name);

        // Cache name across sessions
        redis.hSet(this.userId, 'name', name);

        // Let everyone at the table know
        if (this.tableId) {
            sendEvent(this.tableId, 'nameChanged',
                await getPlayerSlot(this.tableId, this.userId));
        }
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
    
            const idsKey = `${this.userId}:ids`;
            const ids = await redis.hGetAll(idsKey);

            // TODO: Replay recent chat only?
            for (const id in ids) {
                if (id.endsWith(':chat')) {
                    ids[id] = '0-0';
                }
            }

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
                        redis.hSet(idsKey, stream.name, msg.id);
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
                this.socket.emit('userName', info.name);
            }
            if (info.pending) {
                this.socket.emit('resumeGame', info.pending);
                this.socket.emit('msg', "Waiting for another player...");
            }
            if (info.table) {
                this.setTable(info.table);
            } else {
                const tableId = await newTable([this.userId]);
                beginGame('Browse', tableId);
            }

            sendEvent(oldId, ""); // refresh streams
        });

        socket.on('userName', (name: string) => this.setName(name));

        socket.on('chat', async (msg: string) => {
            if (msg.startsWith('/name ')) {
                if (msg.length > 6) {
                    this.setName(msg.substring(6));
                }
                return;
            }
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

        socket.on('playGame', async (game: string) => {
            const name = await this.getName();
            console.log(`Player ${name} wants to play ${game}`);
            if (!this.verifyUserId()) {
                return;
            }

            // See if anyone is waiting
            const waiting = await this.getNextWaiting(game);
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

        socket.on('quitGame', async (game: string) => {
            const name = await this.getName();
            console.log(`Player ${name} is quitting ${game}`);
            redis.hDel(this.userId, 'pending');
            const tableId = await newTable([this.userId]);
            beginGame('Browse', tableId);
        });

        socket.on('clickDeck', (deck: string, selected: number[], alt: boolean) => {
            this.tableAction('clickDeck', {deck, selected, alt});
        });
        socket.on('clickTable', (x: number, z: number, selected: number[], alt: boolean) => {
            this.tableAction('clickTable', {x, z, selected, alt});
        });
    }

    tableAction(action: string, args: any) {
        if (this.tableId) {
            args.userId = this.userId;
            redis.publish(`${this.tableId}:${action}`, JSON.stringify(args));
        }
    }

    setWaiting(game: string) {
        assert(this.userId);
        redis.lPush(`pending:${game}`, this.userId);
        redis.hSet(this.userId, 'pending', game);
    }

    async getNextWaiting(game: string) {
    
        // Loop through players pending tables...
        while (true) {
            const userId = await redis.rPop(`pending:${game}`);
            if (!userId) {
                break;
            }

            // Ensure they are still waiting for this game.
            const pending = await redis.hGet(userId, 'pending');
            if (pending != game) {
                break;
            }
            redis.hDel(userId, 'pending');

            // TODO: Filter out if not currently connected?

            return userId;
        }
        return null;
    }

    async setTable(tableId: string) {
        this.tableId = tableId;

        // Notify client
        const [seat, count] = await Promise.all([
            getPlayerSeat(tableId, this.userId),
            numPlayers(tableId)
        ]);

        this.socket.emit('setTable', tableId, seat, count);

        // Send initial deck state
        getDecks(tableId).then(decks => decks.forEach(name => {
            getDeckCards(tableId, name).then(deck => {
                this.socket.emit('initDeck', deck.key, deck.cards);
            });
        }));

        resumeGame(tableId).then(game => {
            if (game) {
                this.socket.emit('resumeGame', game);
            }
        });

        redis.zRange(`${tableId}:${this.userId}:cards`, 0, -1)
            .then(cards => cards && getCards(cards.map(Number))
                .then(cards => this.socket.emit('revealCards', cards)));
    }

    handleEvent(msg: string) {
        const data = JSON.parse(msg);
        if (data.exclude === this.userId) {
            return;
        }
        switch (data.event) {
            case '': return; // filter empty messages (used to unblock msg handler in setWallet)
            case 'setTable': this.setTable(data.args[0]); return;
            case 'revealCards':
                const cards = data.args[0] as Card[];
                redis.zAdd(`${this.tableId}:${this.userId}:cards`, cards.map(card => (
                    {score: card.id, value: String(card.id)}
                )));
                break;
        }
        this.socket.emit(data.event, ...data.args);
    }
}