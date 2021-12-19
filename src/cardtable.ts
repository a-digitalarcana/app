import { CardPlayer } from "./cardplayer";
import { strict as assert } from 'assert';

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

        console.log("Player " + player.name + " joined the table");
    }

    leave(player: CardPlayer) {
        assert(this.players.includes(player));
        this.players.splice(this.players.indexOf(player), 1);
        player.table = null;

        console.log("Player " + player.name + " left the table");
    }

    emit(exclude: CardPlayer, ev: any, ...args: any[]) {
        for (let player of this.players) {
            if (player !== exclude) {
                player.socket.emit(ev, args);
            }
        }
    }
}

