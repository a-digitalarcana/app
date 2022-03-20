import { CardGame } from "../cardgame";
import { initDeck, getDeckName, getShuffledDeck, getCard } from "../cards";
import { broadcastMsg, revealCard } from "../cardtable";

export class Solitaire extends CardGame
{
    static get requiredPlayers() {return 1;}
    getName() {return "Solitaire";}
    getMinPlayers() {return Solitaire.requiredPlayers;}
    getMaxPlayers() {return Solitaire.requiredPlayers;}

    async begin(initialSetup: boolean) {
        if (!await super.begin(initialSetup)) {
            return false;
        }

        const draw = await initDeck(this.tableId, 'DeckB');
        const piles = await Promise.all(Array(7).fill(null).map((_, i) =>
            initDeck(this.tableId, getDeckName(-0.1, 0.25 - i * 0.09))));

        if (initialSetup) {
            const player = this.players[0];
            draw.add(await getShuffledDeck(player));
            piles.forEach((pile, i) => draw.drawCards(i+1, pile)
                .then(cards => {
                    const top = cards[0];
                    if (top != null) {
                        pile.flipIds([top.id]);
                        revealCard(this.tableId, top);
                    }
                }));
        }

        broadcastMsg(this.tableId, "Welcome to Solitaire!");
        return true;
    }
}