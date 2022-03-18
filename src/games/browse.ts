import { CardGame, ClickDeckArgs, ClickTableArgs } from "../cardgame";
import { initDeck, getDecks, getDeckName, getShuffledDeck, CardDeckMap, getCard } from "../cards";
import { revealCard } from "../cardtable";
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

        const dir: CardDeckMap = {};
        decks.forEach(deck => dir[deck.name] = deck);

        const hand = dir['Hand'];
        assert(hand);

        this.onClickDeck(async (args: ClickDeckArgs) => {
            const name = args.deck;
            const selected = args.selected;

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
                let card = await deck.drawCard(hand);
                if (card != null) {
                    revealCard(this.tableId, card);
                }
            }
        });

        // Right click to flip cards.
        this.onRightClickDeck(async (args: ClickDeckArgs) => {
            const deck = dir[args.deck];
            if (deck && deck != hand) {
                const id = await deck.peekId();
                if (id != null) {
                    deck.flipIds([id]);
                    revealCard(this.tableId, await getCard(id));
                }
            }
        });

        // Create a new deck from selected cards.
        this.onClickTable(async (args: ClickTableArgs) => {
            const selected = args.selected;
            if (selected && selected.length > 0) {
                const deck = await initDeck(this.tableId, getDeckName(args.x, args.z));
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