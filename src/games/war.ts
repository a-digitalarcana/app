import { Card, hasOwned, newDeck, getShuffledDeck } from "../cards";
import { getPlayers, broadcastMsg, revealCards } from "../cardtable";
import { allCards, minorCards, totalMinor } from "../tarot";
import { getUserName } from "../connection";
import { redis } from "../server";
import { sleep } from "../utils";
import { assert } from "console";

export class War
{
    _tableId: string;
    get tableId() {return this._tableId;}

    constructor(tableId: string) {
        this._tableId = tableId;
    }

    async begin() {
        console.log("Begin Game: War");

        const players = await getPlayers(this.tableId);
        if (players.length != 2) {
            broadcastMsg(this.tableId, "Invalid number of players:");
            players.forEach((userId, index) => {
                broadcastMsg(this.tableId, `${index+1}: ${userId}`);
            });
            return;
        }

        const playerA = players[0];
        const playerB = players[1];
        assert(playerA != playerB);

        // Give players a chance to query their cards (server-side)
        for (let i = 0; i < 5; i++) {

            const owned = await Promise.all(players.map(walletAddress => hasOwned(walletAddress)));
            if (owned.every(Boolean)) {
                break;
            }

            console.log("Waiting for cards...");
            await sleep(1000);
        }

        const [deckA, deckB, playedA, playedB, wonA, wonB] = await Promise.all([
            newDeck(this.tableId, 'DeckA'),
            newDeck(this.tableId, 'DeckB'),
            newDeck(this.tableId, 'PlayedA'),
            newDeck(this.tableId, 'PlayedB'),
            newDeck(this.tableId, 'WonA'),
            newDeck(this.tableId, 'WonB'),
        ]);

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
        for (let player of players) {
            const sub = redis.duplicate();
            sub.connect();
            sub.subscribe(`${player}:drawCard`, async () => {

                // Wait for board to clear
                if (cardA && cardB) {
                    return;
                }

                // Select a card if haven't already
                if (player === playerA) {
                    if (cardA === null) {
                        cardA = await deckA.drawCard();
                        if (cardA != null) {
                            playedA.add([cardA]);
                            revealCards(this.tableId, [cardA]);
                            const name = await getUserName(playerA);
                            broadcastMsg(this.tableId, `${name} played ${cards[cardA.value]}`);
                        }
                    }
                } else {
                    if (cardB === null) {
                        cardB = await deckB.drawCard();
                        if (cardB != null) {
                            playedB.add([cardB]);
                            revealCards(this.tableId, [cardB]);
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
                        wonA.transferAllFrom([playedA, playedB]);
                        const name = await getUserName(playerA);
                        broadcastMsg(this.tableId, `${name} wins round`);
                    } else if (valueB > valueA) {
                        wonB.transferAllFrom([playedA, playedB]);
                        const name = await getUserName(playerB);
                        broadcastMsg(this.tableId, `${name} wins round`);
                    } else {
                        broadcastMsg(this.tableId, "It's a tie!");
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
                    broadcastMsg(this.tableId, result);
                    sub.disconnect();
                }
                */
            });
        }

        await sleep(500); // TODO: Don't rely on this

        deckA.add(await getShuffledDeck(playerA));
        deckB.add(await getShuffledDeck(playerB));

        console.log("GO");
    }
}