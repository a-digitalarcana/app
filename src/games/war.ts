import { CardGame, ClickDeckArgs } from "../cardgame";
import { Card, initDeck, getShuffledDeck, getDeckCards, getCard } from "../cards";
import { broadcastMsg, revealCard } from "../cardtable";
import { allCards, minorCards, totalMinor } from "../tarot";
import { getUserName } from "../connection";
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
            const [A, B] = await Promise.all([
                getDeckCards(this.tableId, playedA.name),
                getDeckCards(this.tableId, playedB.name),
            ]);
            if (A.cards.length > B.cards.length) {
                return [await getCard(A.cards[A.cards.length - 1].id), null];
            } else if (B.cards.length > A.cards.length) {
                return [null, await getCard(B.cards[B.cards.length - 1].id)];
            }
            return [null, null];
        };

        let [cardA, cardB] = await getLastPlayed();

        const cards = allCards();

        // Use face value (ignore suit) unless major arcana (which beats minor)
        // TODO: Check rarity first?
        const getValue = (card: Card) => {
            if (card.value < totalMinor) {
                return card.value % minorCards.length;
            }
            return card.value;
        }

        // Hook up client commands
        this.onClickDeck(async (args: ClickDeckArgs) => {
            const player = args.userId;
            const name = args.deck;

            // Wait for board to clear
            if (cardA && cardB) {
                return;
            }

            // Select a card if haven't already
            if (player === playerA) {
                if (cardA === null && name === deckA.name) {
                    cardA = await deckA.drawCard(playedA);
                    if (cardA != null) {
                        revealCard(this.tableId, cardA);
                        const name = await getUserName(playerA);
                        broadcastMsg(this.tableId, `${name} played ${cards[cardA.value]}`);
                    }
                }
            } else {
                if (cardB === null && name === deckB.name) {
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

        console.log("GO");
        return true;
    }
}