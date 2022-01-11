import { CardPlayer } from "./cardplayer";
import { strict as assert } from 'assert';
import { Card } from "./cards";

export class CardTable
{
    players: CardPlayer[] = [];

    constructor() {
        console.log("New table");
    }

    destroy() {
        console.log("Destroy table");
        for (let player of this.players) {
            player.table = null;
        }
        this.players = [];
    }

    join(player: CardPlayer) {
        assert(!this.players.includes(player));
        this.players.push(player);
        player.table = this;

        switch (this.players.length)
        {
            case 1:
                player.socket.emit("isPlayerA");
                break;
            case 2:
                player.socket.emit("isPlayerB");
                break;
        }
    }

    leave(player: CardPlayer) {
        assert(this.players.includes(player));
        this.players.splice(this.players.indexOf(player), 1);
        player.table = null;
        this.emit(player, 'msg', `Player ${player.name} has left the table.`);
    }

    emit(exclude: CardPlayer | null, ev: any, ...args: any[]) {
        for (let player of this.players) {
            if (player !== exclude) {
                player.socket.emit(ev, ...args);
            }
        }
    }

    revealCards(cards: Card[]) {
        for (let player of this.players) {
            player.revealCards(cards);
        }
    }

    welcome() {
        for (let player of this.players) {
            this.emit(player, 'msg', `Player ${player.name} has joined the table!`);
        }
    }
}

