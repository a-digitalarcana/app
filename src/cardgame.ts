import { getPlayers, broadcastMsg } from "./cardtable";
import { sendEvent } from "./connection";
import { hasOwned } from "./cards";
import { sleep } from "./utils";
import { redis, RedisClientType } from "./server";

type OnDrawCardFn = (player: string) => void;
type OnClickTableFn = (player: string, x: number, z: number, selected: number[]) => void;

export abstract class CardGame
{
    abstract getName(): string;
    abstract getMinPlayers(): number;
    abstract getMaxPlayers(): number;

    _onDrawCard: OnDrawCardFn | null = null;
    onDrawCard(fn: OnDrawCardFn) {this._onDrawCard = fn;}

    _onClickTable: OnClickTableFn | null = null;
    onClickTable(fn: OnClickTableFn) {this._onClickTable = fn;}

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
            this.sub.subscribe(`${tableId}:drawCard`, (player) => {
                if (this._onDrawCard) {
                    this._onDrawCard(player);
                }
            });
            this.sub.subscribe(`${tableId}:clickTable`, (args) => {
                if (this._onClickTable) {
                    const _ = JSON.parse(args);
                    this._onClickTable(_.userId, _.x, _.z, _.selected);
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