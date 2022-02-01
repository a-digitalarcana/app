import { getPlayers, broadcast, broadcastMsg } from "./cardtable";
import { hasOwned } from "./cards";
import { sleep } from "./utils";
import { redis, RedisClientType } from "./server";

type OnDrawCardFn = (player: string) => void;

export abstract class CardGame
{
    abstract getName(): string;
    abstract getMinPlayers(): number;
    abstract getMaxPlayers(): number;

    _onDrawCard: OnDrawCardFn | null = null;
    onDrawCard(fn: OnDrawCardFn) {this._onDrawCard = fn;}

    _tableId: string;
    get tableId() {return this._tableId;}

    _players: string[] = [];
    get players() {return this._players;}

    // TODO: Disconnect on table destroy msg.
    sub: RedisClientType;

    constructor(tableId: string) {
        this._tableId = tableId;
        this.sub = redis.duplicate();
        this.sub.connect();
        this.sub.subscribe(`${tableId}:drawCard`, (player) => {
            if (this._onDrawCard) {
                this._onDrawCard(player);
            }
        });
    }

    async begin() {
        const name = this.getName();
        console.log(`Begin Game: ${name}`);

        // Validate number of players at table
        this._players = await getPlayers(this.tableId);
        if (this.players.length < this.getMinPlayers() || this.players.length > this.getMaxPlayers()) {
            broadcastMsg(this.tableId, "Invalid number of players:");
            this.players.forEach((userId, index) => {
                broadcastMsg(this.tableId, `${index+1}: ${userId}`);
            });
            return false;
        }

        broadcast(this.tableId, 'beginGame', name);

        // Give players a chance to query their cards (server-side)
        for (let i = 0; i < 5; i++) {

            const owned = await Promise.all(this.players.map(walletAddress => hasOwned(walletAddress)));
            if (owned.every(Boolean)) {
                break;
            }

            console.log("Waiting for cards...");
            await sleep(1000);
        }

        return true;
    }
};