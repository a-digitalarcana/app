import { CardGame } from "../cardgame";
import { getShuffledDeck, initDeck } from "../cards";
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
            initDeck(this.tableId, 'HandRoot') // HandA?
        ]);

        this.onDrawCard(async (player) => {

            if (await hand.numCards() >= 24 ) {
                return;
            }

            const card = await deck.drawCard(hand);
            if (card != null) {
                revealCard(this.tableId, card);
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