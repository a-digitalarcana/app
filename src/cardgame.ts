import { getPlayers, broadcastMsg } from "./cardtable";
import { hasOwned } from "./cards";
import { sleep } from "./utils";
import { redis, RedisClientType } from "./server";

interface ClickArgs {
    userId: string;
    selected: number[];
}

export interface ClickDeckArgs extends ClickArgs {
    deck: string;
}

export interface ClickTableArgs extends ClickArgs {
    x: number;
    z: number;
}

type OnClickDeckFn = (args: ClickDeckArgs) => void;
type OnClickTableFn = (args: ClickTableArgs) => void;

export abstract class CardGame
{
    abstract getName(): string;
    abstract getMinPlayers(): number;
    abstract getMaxPlayers(): number;

    _onClickDeck: OnClickDeckFn | null = null;
    onClickDeck(fn: OnClickDeckFn) {this._onClickDeck = fn;}

    _onRightClickDeck: OnClickDeckFn | null = null;
    onRightClickDeck(fn: OnClickDeckFn) {this._onRightClickDeck = fn;}

    _onClickTable: OnClickTableFn | null = null;
    onClickTable(fn: OnClickTableFn) {this._onClickTable = fn;}

    _onRightClickTable: OnClickTableFn | null = null;
    onRightClickTable(fn: OnClickTableFn) {this._onRightClickTable = fn;}

    _tableId: string;
    get tableId() {return this._tableId;}

    _players: string[] = [];
    get players() {return this._players;}

    // TODO: Disconnect on table destroy msg.
    sub: RedisClientType;

    constructor(tableId: string) {
        this._tableId = tableId;
        this.sub = redis.duplicate();
        this.sub.connect().then(() => {
            this.sub.subscribe(`${tableId}:clickDeck`, (msg) => {
                if (this._onClickDeck) {
                    this._onClickDeck(JSON.parse(msg));
                }
            });
            this.sub.subscribe(`${tableId}:rightClickDeck`, (msg) => {
                if (this._onRightClickDeck) {
                    this._onRightClickDeck(JSON.parse(msg));
                }
            });
            this.sub.subscribe(`${tableId}:clickTable`, (msg) => {
                if (this._onClickTable) {
                    this._onClickTable(JSON.parse(msg));
                }
            });
            this.sub.subscribe(`${tableId}:rightClickTable`, (msg) => {
                if (this._onRightClickTable) {
                    this._onRightClickTable(JSON.parse(msg));
                }
            });
        });
    }

    async begin(initialSetup: boolean) {
        const name = this.getName();
        this._players = await getPlayers(this.tableId);

        if (!initialSetup) {
            console.log(`Resume Game: ${name}`);
            return true;
        }

        console.log(`Begin Game: ${name}`);

        // Validate number of players at table
        if (this.players.length < this.getMinPlayers() || this.players.length > this.getMaxPlayers()) {
            broadcastMsg(this.tableId, "Invalid number of players:");
            this.players.forEach((userId, index) => {
                broadcastMsg(this.tableId, `${index+1}: ${userId}`);
            });
            return false;
        }

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