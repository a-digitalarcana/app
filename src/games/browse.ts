import { CardGame } from "../cardgame";
import { initDeck, getCards, getDecks, getDeckName, getShuffledDeck } from "../cards";
import { revealCard } from "../cardtable";
import { sendEvent } from "../connection";

export class Browse extends CardGame
{
    getName() {return "Browse";}
    getMinPlayers() {return 1;}
    getMaxPlayers() {return 1;}

    async begin(initialSetup: boolean) {
        if (!await super.begin(initialSetup)) {
            return false;
        }

        const [deck, hand] = await Promise.all([
            initDeck(this.tableId, 'DeckA'),
            initDeck(this.tableId, 'Hand')
        ]);

        const decks: any = {};
        decks[deck.name] = deck;
        decks[hand.name] = hand;
        const names = await getDecks(this.tableId);
        for (let name of names) {
            if (!decks.hasOwnProperty(name)) {
                decks[name] = await initDeck(this.tableId, name);
            }
        }

        this.onDrawCard(async (player, from) => {

            if (await hand.numCards() >= 24 ) {
                return;
            }

            const deck = decks[from];
            if (deck) {
                const card = await deck.drawCard(hand);
                if (card != null) {
                    revealCard(this.tableId, card);
                }
            }
        });

        this.onClickTable(async (player, x, z, selected) => {
            if (selected && selected.length > 0) {
                const deck = await initDeck(this.tableId, getDeckName(x, z));
                hand.moveIds(selected, deck);
            }
        });

        const player = this.players[0];
        if (initialSetup) {
            deck.add(await getShuffledDeck(player));
        }

        sendEvent(player, 'setDrawPile', deck.name);

        console.log("GO");
        return true;
    }
}