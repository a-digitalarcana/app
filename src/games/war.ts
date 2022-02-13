import { CardGame } from "../cardgame";
import { Card, initDeck, getShuffledDeck, getCards, getCard } from "../cards";
import { broadcastMsg, revealCard } from "../cardtable";
import { allCards, minorCards, totalMinor } from "../tarot";
import { getUserName, sendEvent } from "../connection";
import { sleep } from "../utils";
import { strict as assert } from "assert";

export class War extends CardGame
{
    getName() {return "War";}
    getMinPlayers() {return 2;}
    getMaxPlayers() {return 2;}

    async begin(initialSetup: boolean) {
        if (!await super.begin(initialSetup)) {
            return false;
        }

        const playerA = this.players[0];
        const playerB = this.players[1];
        assert(playerA != playerB);

        // TODO: Store decks in table, send initial state on connect.
        const [deckA, deckB, playedA, playedB, wonA, wonB] = await Promise.all([
            initDeck(this.tableId, 'DeckA'),
            initDeck(this.tableId, 'DeckB'),
            initDeck(this.tableId, 'PlayedA'),
            initDeck(this.tableId, 'PlayedB'),
            initDeck(this.tableId, 'WonA'),
            initDeck(this.tableId, 'WonB'),
        ]);

        const getLastPlayed = async () => {
            const [cardsA, cardsB] = await Promise.all([
                getCards(this.tableId, playedA.name),
                getCards(this.tableId, playedB.name),
            ]);
            if (cardsA.ids.length > cardsB.ids.length) {
                return [await getCard(cardsA.ids[cardsA.ids.length - 1]), null];
            } else if (cardsB.ids.length > cardsA.ids.length) {
                return [null, await getCard(cardsB.ids[cardsB.ids.length - 1])];
            }
            return [null, null];
        };

        let [cardA, cardB] = await getLastPlayed();

        const cards = allCards();

        // Use face value (ignore suit) unless major arcana (which beats minor)
        const getValue = (card: Card) => {
            if (card.value < totalMinor) {
                return card.value % minorCards.length;
            }
            return card.value;
        }

        // Hook up client commands
        this.onDrawCard(async (player) => {

            // Wait for board to clear
            if (cardA && cardB) {
                return;
            }

            // Select a card if haven't already
            if (player === playerA) {
                if (cardA === null) {
                    cardA = await deckA.drawCard(playedA);
                    if (cardA != null) {
                        revealCard(this.tableId, cardA);
                        const name = await getUserName(playerA);
                        broadcastMsg(this.tableId, `${name} played ${cards[cardA.value]}`);
                    }
                }
            } else {
                if (cardB === null) {
                    cardB = await deckB.drawCard(playedB);
                    if (cardB != null) {
                        revealCard(this.tableId, cardB);
                        const name = await getUserName(playerB);
                        broadcastMsg(this.tableId, `${name} played ${cards[cardB.value]}`);
                    }
                }
            }

            // Once both selected
            if (cardA && cardB) {
                await sleep(1000);
                const valueA = getValue(cardA);
                const valueB = getValue(cardB);
                if (valueA > valueB) {
                    wonA.moveAllFrom([playedA, playedB]);
                    const name = await getUserName(playerA);
                    broadcastMsg(this.tableId, `${name} wins round`);
                } else if (valueB > valueA) {
                    wonB.moveAllFrom([playedA, playedB]);
                    const name = await getUserName(playerB);
                    broadcastMsg(this.tableId, `${name} wins round`);
                } else {
                    broadcastMsg(this.tableId, "It's a tie!");
                }
                cardA = cardB = null;

                // TODO: Handle game over state.
            }
        });

        if (initialSetup) {
            deckA.add(await getShuffledDeck(playerA));
            deckB.add(await getShuffledDeck(playerB));
        }

        sendEvent(playerA, 'setDrawPile', deckA.name);
        sendEvent(playerB, 'setDrawPile', deckB.name);

        console.log("GO");
        return true;
    }
}