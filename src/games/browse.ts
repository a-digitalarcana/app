import { CardGame } from "../cardgame";
import { initDeck, getDecks, getDeckName, getShuffledDeck } from "../cards";
import { revealCard } from "../cardtable";
import { sendEvent } from "../connection";
import { strict as assert } from "assert";

export class Browse extends CardGame
{
    getName() {return "Browse";}
    getMinPlayers() {return 1;}
    getMaxPlayers() {return 1;}

    async begin(initialSetup: boolean) {
        if (!await super.begin(initialSetup)) {
            return false;
        }

        const names = initialSetup ? ['DeckA', 'Hand'] : await getDecks(this.tableId);
        const decks = await Promise.all(names.map(name => initDeck(this.tableId, name)));

        const dir: any = {};
        decks.forEach(deck => dir[deck.name] = deck);

        const hand = dir['Hand'];
        assert(hand);

        this.onClickDeck(async (player, name, selected) => {

            // Add selected cards to deck.
            if (selected && selected.length > 0) {
                if (name in dir) {
                    hand.moveIds(selected, dir[name], true);
                }
                return;
            }

            // Limit holding 24 cards.
            if (await hand.numCards() >= 24 ) {
                return;
            }

            // Draw card from deck.
            const deck = dir[name];
            if (deck) {
                const card = await deck.drawCard(hand);
                if (card != null) {
                    revealCard(this.tableId, card);
                }
            }
        });

        // Create a new deck from selected cards.
        this.onClickTable(async (player, x, z, selected) => {
            if (selected && selected.length > 0) {
                const deck = await initDeck(this.tableId, getDeckName(x, z));
                hand.moveIds(selected, deck);
                dir[deck.name] = deck;
            }
        });

        const player = this.players[0];
        const deck = dir['DeckA'];
        assert(deck);

        if (initialSetup) {
            deck.add(await getShuffledDeck(player));
        }

        console.log("GO");
        return true;
    }
}