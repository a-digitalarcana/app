import { CardGame, ClickDeckArgs } from "../cardgame";
import { initDeck, getDeckName, getShuffledDeck, registerCard, Card, CardDeck, CardDeckMap, DeckContents } from "../cards";
import { broadcastMsg, revealCard } from "../cardtable";
import { minorCards } from "../tarot";

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

        // TODO: Cleanup
        // - CardGame members to wrap tableId fns (e.g. initDeck)
        // - Add Card/Cards members to CardDec (e.g. flipCard)
        // - Build list of deck names, use split to fill subsets
        // - Use getDecks when !initialSetup

        const decks = await Promise.all([
            initDeck(this.tableId, 'Hand'),
            initDeck(this.tableId, 'DeckB'),
            initDeck(this.tableId, getDeckName(0.17, -0.02))
        ]);
        const foundations = await Promise.all(Array(4).fill(null).map((_, i) =>
            initDeck(this.tableId, getDeckName(0.06, -0.14 - i * 0.09))));
        const tableau = await Promise.all(Array(7).fill(null).map((_, i) =>
            initDeck(this.tableId, getDeckName(-0.1, 0.25 - i * 0.09))));

        const [hand, stock, talon] = decks;
        const dir: CardDeckMap = {};
        decks.concat(foundations).concat(tableau)
            .forEach(deck => dir[deck.name] = deck);
            
        const drawStock = async () => {
            const cards = await stock.drawCards(3, talon, true);
            if (cards.length > 0) {
                talon.flip(cards);
                revealCard(this.tableId, cards[0]);
            }
        };

        const drawTalon = async () => {

            // Put card back.
            let card = await hand.drawCard(talon, true);
            if (card != null) {
                talon.flip([card]);
                return;
            }

            // Pick card up.
            await talon.drawCard(hand);
            card = await talon.peekCard();
            if (card != null) {
                revealCard(this.tableId, card);
            }
        };

        const King = minorCards.length - 1;

        const isValidMove = async (card: Card, pile: CardDeck) => {
            const rank = card.value % minorCards.length;
            const top = await pile.peekCard();
            if (top != null) {
                const topRank = top.value % minorCards.length;
                // TODO: Enforce alternating suit.
                return rank === topRank - 1;
            }
            return rank === King;
        };

        const placeTableau = async (pile: CardDeck) => {
            const card = await hand.peekCard();
            if (card != null && await isValidMove(card, pile)) {
                hand.move([card], pile, true);
                // TODO: Face up cards need to fan down while leaving face down cards stacked.
                pile.flip([card]);
            }
        };

        this.onClickDeck(async (args: ClickDeckArgs) => {
            const deck = dir[args.deck];
            switch (deck)
            {
                case stock: drawStock(); break;
                case talon: drawTalon(); break;
                default:
                    if (tableau.includes(deck)) {
                        placeTableau(deck);
                        return;
                    }
            }
        });

        if (initialSetup) {
            const player = this.players[0];
            // TODO: Mark cards black vs red (scoped to table)
            stock.add(await getShuffledDeck(player, DeckContents.MinorOnly));
            tableau.forEach((pile, i) => stock.drawCards(i+1, pile)
                .then(cards => {
                    const top = cards[0];
                    if (top != null) {
                        pile.flipIds([top.id]);
                        revealCard(this.tableId, top);
                    }
                }));
            
            // Add placeholder blank cards.
            foundations.forEach(foundation => {
                // TODO: These are getting upgraded when revealing our owned blue ace.
                registerCard(0).then(card => {
                    foundation.add([card]);
                    foundation.flipIds([card.id]);
                });
            });

            broadcastMsg(this.tableId, "Welcome to Solitaire!");
        }

        return true;
    }
}