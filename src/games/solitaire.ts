import { CardGame, ClickDeckArgs } from "../cardgame";
import { initDeck, getDeckName, getShuffledDeck, registerCard, Card, CardDeck, CardDeckMap, DeckContents, getCard } from "../cards";
import { broadcastMsg, revealCard } from "../cardtable";
import { minorCards } from "../tarot";
import { sleep } from "../utils";

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

        // TODO: Persist across server restart.
        let lastDrawPile: CardDeck | null = null;

        // TODO: Need ablity to replace stock when empty.
        const drawStock = async () => {
            const cards = await stock.drawCards(3, talon, true);
            if (cards.length > 0) {
                talon.flip(cards);
                revealCard(this.tableId, cards[0]);
            }
        };

        const drawTalon = async () => {
            if (await hand.numCards() > 0) {
                return;
            }

            // Pick card up.
            await talon.drawCard(hand);
            lastDrawPile = talon;

            // Reveal next in pile.
            const card = await talon.peekCard();
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

        const clickTableau = async (pile: CardDeck) => {

            // TODO: Need ability to click in empty area (to place King).
            const card = await hand.peekCard();
            if (card != null && await isValidMove(card, pile)) {
                hand.move([card], pile, true);
                // TODO: Face up cards need to fan down while leaving face down cards stacked.
                pile.flip([card]);
                return;
            }

            const topId = await pile.peekId();
            if (topId == null) {
                return;
            }
            if (await pile.isFlippedId(topId)) {
                if (await hand.numCards() == 0) {
                    pile.drawCard(hand);
                    lastDrawPile = pile;
                }
            } else {
                pile.flipIds([topId]);
                revealCard(this.tableId, await getCard(topId));
            }
        };

        const clickFoundation = async (pile: CardDeck) => {
            const card = await hand.peekCard();
            if (card == null) {
                return;
            }
            const top = await pile.peekCard();
            if (top == null) {
                return;
            }
            const rank = card.value % minorCards.length;
            if (rank === (top.value % minorCards.length) + 1) {
                hand.move([card], pile, true);
                pile.flip([card]);
            }
        };

        this.onClickDeck(async (args: ClickDeckArgs) => {
            const deck = dir[args.deck];

            // Put card back.
            if (lastDrawPile != null && lastDrawPile == deck) {
                let card = await hand.drawCard(lastDrawPile, true);
                if (card != null) {
                    lastDrawPile.flip([card]);
                    lastDrawPile = null;
                    return;
                }
            }

            switch (deck)
            {
                case stock: drawStock(); break;
                case talon: drawTalon(); break;
                default:
                    if (tableau.includes(deck)) {
                        clickTableau(deck);
                        return;
                    }
                    if (foundations.includes(deck)) {
                        clickFoundation(deck);
                        return;
                    }
            }
        });

        if (initialSetup) {

            // Add placeholder blank cards.
            foundations.forEach(foundation => {
                registerCard(-1).then(card => {
                    foundation.add([card]);
                    foundation.flipIds([card.id]);
                });
            });

            // TODO: Mark cards black vs red (scoped to table)
            const player = this.players[0];
            stock.add(await getShuffledDeck(player, DeckContents.MinorOnly));
            for (let i = 0; i < tableau.length; i++) {
                for (let j = i; j < tableau.length; j++) {
                    const pile = tableau[j];
                    const card = await stock.drawCard(pile, true);
                    if (j == i && card != null) {
                        pile.flipIds([card.id]);
                        revealCard(this.tableId, card);
                    }
                    await sleep(50);
                }
            }

            broadcastMsg(this.tableId, "Welcome to Solitaire!");
        }

        return true;
    }
}