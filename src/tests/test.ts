import test from 'ava';
import { createClient } from "redis";
import { initDeck, registerCards } from "../cards";
import { newTable, numPlayers, getPlayerSeat } from '../cardtable';

const tableId = "table:test";

test.beforeEach('reset redis', async t => {
    const redis = createClient();
    await redis.connect();
    for await (const key of redis.scanIterator({MATCH: `${tableId}*`})) {
        redis.del(key);
    }
});

test('redis connection', async t => {
    const redis = createClient();
    redis.on('connect', () => t.pass());
    redis.on('error', () => t.fail());
    await redis.connect();
    t.log(await redis.info('Server'));
});

test('init deck', async t => {
    const deck = await initDeck(tableId, "test");
    t.truthy(deck);
});

test('num cards', async t => {
    const deck = await initDeck(tableId, "test");
    const cards = await registerCards([1, 2, 3]);
    deck.add(cards);
    t.is(await deck.numCards(), cards.length);
});

test('move cards', async t => {
    const [deckA, deckB] = await Promise.all([
        initDeck(tableId, "deckA"),
        initDeck(tableId, "deckB"),
    ]);
    t.true([deckA, deckB].every(Boolean));
    deckA.add(await registerCards([1, 2, 3]));
    deckB.add(await registerCards([4, 5, 6]));
    deckB.moveAll(deckA);
    t.is(await deckB.drawCard(deckA), null);

    const verifyCard = async (value: number | null) => {
        const card = await deckA.drawCard(deckB);
        if (!t.is(card ? card.value : null, value)) {
            t.log({card});
        }
    };

    return Promise.all([1, 2, 3, 4, 5, 6, null].map(value => verifyCard(value)));
});

test('add cards to start', async t => {
    const deck = await initDeck(tableId, "test-add-start");
    const cards = await registerCards([1, 2, 3]);
    deck.add([cards[0]], true);
    deck.add([cards[1]]);
    deck.add([cards[2]], true);

    const verifyCard = async (value: number) => {
        const card = await deck.drawCard(deck);
        t.is(card?.value, value);
    };

    return Promise.all([3, 1, 2].map(value => verifyCard(value)));
});

test('peek cards', async t => {
    const deck = await initDeck(tableId, "test-peek");
    const cards = await registerCards([1, 2, 3]);
    t.is(await deck.peekId(), null);
    deck.add(cards);
    t.is(await deck.peekId(), cards[0].id);
    deck.move([cards[1]], deck, true);
    t.is(await deck.peekId(), cards[1].id);
    await Promise.all([
        deck.drawCard(deck),
        deck.drawCard(deck)
    ]);
    const card = await deck.peekCard();
    t.like(card, cards[2]);
});

test('flip card', async t => {
    const deck = await initDeck(tableId, "test-flip");
    const cards = await registerCards([1, 2, 3]);
    deck.add(cards);
    t.false(await deck.areFlipped(cards).then(flipped => flipped.some(Boolean)));
    deck.flip([cards[0]]); // just the first
    t.true(await deck.isFlipped(cards[0]));
    deck.flip(cards); // mixed flip
    t.false(await deck.isFlipped(cards[0]));
    t.true(await deck.areFlipped(cards.slice(-2)).then(flipped => flipped.every(Boolean)));
});

test('players', async t => {
    const userIds = ["PlayerA", "PlayerB"];
    const tableId = await newTable(userIds);
    t.is(await numPlayers(tableId), 2);
    const [seatA, seatB] = await Promise.all(
        userIds.map(userId => getPlayerSeat(tableId, userId))
    );
    t.is(seatA, "A");
    t.is(seatB, "B");
    t.not(await getPlayerSeat(tableId, "PlayerC"), "C");
});