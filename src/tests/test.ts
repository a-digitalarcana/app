import test from 'ava';
import { createClient } from "redis";
import { newDeck, registerCard } from "../cards";

const tableId = "table:test";

const registerCards = async (values: number[]) => {
    return await Promise.all(values.map(value => registerCard(value)));
};

test('redis connection', async t => {

    const redis = createClient();
    redis.on('connect', () => t.pass());
    redis.on('error', () => t.fail());
    await redis.connect();
    t.log(await redis.info('Server'));
});

test('new deck', async t => {
    const deck = await newDeck(tableId, "test");
    t.truthy(deck);
});

test('num cards', async t => {
    const deck = await newDeck(tableId, "test");
    const cards = await registerCards([1, 2, 3]);
    deck.add(cards);
    t.is(await deck.numCards(), cards.length);

    // Remove first
    deck.remove(cards.slice(0, 1));
    t.is(await deck.numCards(), cards.length-1);

    // Remove rest
    deck.remove(cards.slice(1));
    t.is(await deck.numCards(), 0);
});

test('deck transfer', async t => {
    const [deckA, deckB] = await Promise.all([
         newDeck(tableId, "deckA"),
         newDeck(tableId, "deckB"),
    ]);
    t.true([deckA, deckB].every(Boolean));
    deckA.add(await registerCards([1, 2, 3]));
    deckB.add(await registerCards([4, 5, 6]));
    deckB.transferAllTo(deckA);
    t.is(await deckB.drawCard(), null);

    const verifyCard = async (value: number | null) => {
        const card = await deckA.drawCard();
        if (!t.is(card ? card.value : null, value)) {
            t.log({card});
        }
    };

    return Promise.all([1, 2, 3, 4, 5, 6, null].map(value => verifyCard(value)));
});