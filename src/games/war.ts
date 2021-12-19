import { Card, CardDeck, getShuffledDeck } from "../cards";
import { CardTable } from "../cardtable";
import { allCards, minorCards, totalMinor } from "../tarot";
import { sleep } from "../utils";

export class War
{
    table: CardTable;

    constructor(table: CardTable) {
        this.table = table;
    }

    async begin() {
        console.log("Begin Game: War");

        if (this.table.players.length != 2) {
            this.table.emit(null, 'msg', "Invalid number of players!");
            return;
        }

        const playerA = this.table.players[0];
        const playerB = this.table.players[1];

        if (playerA.walletAddress === playerB.walletAddress) {
            this.table.emit(null, 'msg', "Players cannot use the same accounts!");
            return;
        }

        // Give players a chance to query their cards (server-side)
        for (let i = 0; i < 5; i++) {
            if (this.table.players.every((player) => player.owned != null)) {
                break;
            }
            console.log("Waiting for cards...");
            await sleep(1000);
        }

        const deckA = new CardDeck(playerA, "draw");
        const deckB = new CardDeck(playerB, "draw");

        const playedA = new CardDeck(playerA, "played");
        const playedB = new CardDeck(playerB, "played");

        const wonA = new CardDeck(playerA, "won");
        const wonB = new CardDeck(playerB, "won");

        let cardA: Card | null = null;
        let cardB: Card | null = null;

        let scoreA = 0;
        let scoreB = 0;

        const cards = allCards();

        // Use face value (ignore suit) unless major arcana (which beats minor)
        const getValue = (card: Card) => {
            if (card.value < totalMinor) {
                return card.value % minorCards.length;
            }
            return card.value;
        }

        // Hook up client commands
        for (let player of this.table.players) {
            player.socket.on('drawCard', async () => {

                // Wait for board to clear
                if (cardA && cardB) {
                    return;
                }

                // Select a card if haven't already
                if (player === playerA) {
                    if (cardA === null) {
                        cardA = deckA.drawCard();
                        if (cardA != null) {
                            playedA.add([cardA]);
                            this.table.revealCards([cardA]);
                            this.table.emit(null, 'msg', `${playerA.name} played ${cards[cardA.value]}`);
                        }
                    }
                } else {
                    if (cardB === null) {
                        cardB = deckB.drawCard();
                        if (cardB != null) {
                            playedB.add([cardB]);
                            this.table.revealCards([cardB]);
                            this.table.emit(null, 'msg', `${playerB.name} played ${cards[cardB.value]}`);
                        }
                    }
                }

                // Once both selected
                if (cardA && cardB) {
                    await sleep(1000);
                    const valueA = getValue(cardA);
                    const valueB = getValue(cardB);
                    if (valueA > valueB) {
                        // Give cards to playerA
                        wonA.add(playedA.cards);
                        wonA.add(playedB.cards);
                        playedA.remove(playedA.cards);
                        playedB.remove(playedB.cards);
                        this.table.emit(null, 'msg', `${playerA.name} wins round`);
                    } else if (valueB > valueA) {
                        // Give cards to playerB
                        wonB.add(playedA.cards);
                        wonB.add(playedB.cards);
                        playedA.remove(playedA.cards);
                        playedB.remove(playedB.cards);
                        this.table.emit(null, 'msg', `${playerB.name} wins round`);
                    } else {
                        this.table.emit(null, 'msg', "It's a tie!");
                    }
                    cardA = cardB = null;
                }

                /*
                if (gameOver) {
                    let result = "";
                    if (scoreA === scoreB) {
                        result = "Game ended in a tie!";
                    } else if (scoreA > scoreB) {
                        result = `Player ${playerA.name} wins!`;
                    } else {
                        result = `Player ${playerB.name} wins!`;
                    }
                    this.table.emit(null, 'msg', result);
                    //player.socket.off('drawCard');
                }
                */
            });
        }

        this.table.emit(null, 'newDeck', 'DeckA', deckA.namespace.name);
        this.table.emit(null, 'newDeck', 'DeckB', deckB.namespace.name);
        this.table.emit(null, 'newDeck', 'PlayedA', playedA.namespace.name);
        this.table.emit(null, 'newDeck', 'PlayedB', playedB.namespace.name);
        this.table.emit(null, 'newDeck', 'WonA', wonA.namespace.name);
        this.table.emit(null, 'newDeck', 'WonB', wonB.namespace.name);

        await sleep(500); // TODO: Don't rely on this

        deckA.add(getShuffledDeck(playerA));
        deckB.add(getShuffledDeck(playerB));

        console.log("GO");
    }
}