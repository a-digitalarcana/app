import { strict as assert } from "assert";
import { totalCards, totalMinor, majorArcana } from "./tarot";
import { shuffle } from "./utils";
import { redis } from "./server";
import { sendEvent } from "./connection";

export type Card = {
    id: number,         // uniquely identifies this card w/o giving away any information concerning it
    value: number,      // index into allCards or token_id % totalCards
    token_id: number,   // token_id of this card in the FA2 contract
    ipfsUri: string,    // metadata location
}

export const registerCard = async (value: number, token_id: number = -1, ipfsUri: string = "") => {
    const getNextCardId = async (): Promise<number> => {
        return await redis.incr('nextCardId');
    };
    const card = {id: await getNextCardId(), value, token_id, ipfsUri};
    redis.hSet(`card:${card.id}`, card);
    return card;
};

export const registerCards = async (values: number[]) =>
    Promise.all(values.map(value => registerCard(value)));

export const getCard = async (id: number): Promise<Card> => {
    const card = await redis.hGetAll(`card:${id}`);
    return {
        id: JSON.parse(card.id),
        value: JSON.parse(card.value),
        token_id: JSON.parse(card.token_id),
        ipfsUri: card.ipfsUri
    };
};

export const getCards = async (ids: number[]): Promise<Card[]> => {
    return Promise.all(ids.map(id => getCard(id)));
};

export const clearOwned = (walletAddress: string) => {
    redis.del(`${walletAddress}:owned`);
};

export const hasOwned = async (walletAddress: string) => {
    return await redis.exists(`${walletAddress}:owned`);
};

export const addOwned = (walletAddress: string, cards: Card[]) => {

    // Keep track of owned by value (sorted by token_id).
    const idStrings = cards.map(card => {
        const idString = card.id.toString();
        redis.zAdd(`${walletAddress}:owned:${card.value}`, {score: card.token_id, value: idString});
        return idString;
    });

    redis.sAdd(`${walletAddress}:owned`, idStrings);
};

export const getOwned = async (walletAddress: string) => {
    const idStrings = await redis.sMembers(`${walletAddress}:owned`);
    return idStrings.map(Number);
};

const getCardStates = async (key: string, idStrings: string[]) => {
    const facingStrings = (idStrings.length > 0) ?
        await redis.hmGet(`${key}:facing`, idStrings) : [];
    return idStrings.map((idString, i) => (
        {id: Number(idString), facing: Number(facingStrings[i])}
    ));
};

// TODO: Ability to specify DeckMode (e.g. fan down).
export const initDeck = async (tableId: string, name: string) => {
    redis.sAdd(`${tableId}:decks`, name);
    const key = `${tableId}:deck:${name}`;
    const cards = await redis.zRangeWithScores(key, 0, -1);
    const [minScore, maxScore] = (cards.length > 0) ?
        [Math.min(-1, cards[0].score), Math.max(1, cards[cards.length - 1].score)] : [-1, 1]; // Reserve zero for not in deck (default returned by zScore).
    const deck = new CardDeck(name, key, tableId, minScore, maxScore);
    const idStrings = cards.map(card => card.value);
    sendEvent(tableId, 'initDeck', key, await getCardStates(key, idStrings));
    return deck;
};

export const getDecks = async (tableId: string) => {
    return await redis.sMembers(`${tableId}:decks`);
};

export const getDeckCards = async (tableId: string, name: string) => {
    const key = `${tableId}:deck:${name}`;
    const idStrings = await redis.zRange(key, 0, -1);
    return {key, cards: await getCardStates(key, idStrings)};
};

export const getDeckName = (x: number, z: number) => {
    return `{${x.toFixed(2)},${z.toFixed(2)}}`;
};

// A collection of cards (not necessarily a full deck, might be a discard pile, or current set of cards in hand, etc.).
export class CardDeck
{
    _name: string;
    get name() {return this._name;}

    _key: string;
    get key() {return this._key;}

    _tableId: string;
    get tableId() {return this._tableId;}

    _minScore: number;
    _maxScore: number;

    constructor(name: string, key: string, tableId: string, minScore: number, maxScore: number) {
        this._name = name;
        this._key = key;
        this._tableId = tableId;
        this._minScore = minScore;
        this._maxScore = maxScore;
    }

    _verifyHaveNot(idStrings: string[]) {
        redis.zmScore(this.key, idStrings)
            .then(results => assert(!results.some(Boolean), `${this.key} already has: ${idStrings}`));
    }
    _verifyHave(idStrings: string[]) {
        redis.zmScore(this.key, idStrings)
            .then(results => assert(results.every(Boolean), `${this.key} does not have: ${idStrings}`));
    }

    _addIds(idStrings: string[], toStart = false) {
        this._verifyHaveNot(idStrings);

        // Keep track of min/max score
        let i: number;
        if (toStart) {
            this._minScore -= idStrings.length;
            i = this._minScore;
        } else {
            i = this._maxScore;
            this._maxScore += idStrings.length;
        }
        assert(i != 0, `${this.key} min:${this._minScore} max:${this._maxScore} ${idStrings}`);

        redis.zAdd(this.key, idStrings.map(idString => ({score: i++, value: idString})));
    }
    _removeIds(idStrings: string[]) {
        this._verifyHave(idStrings);
        redis.hDel(this._facingKey, idStrings);
        redis.zRem(this.key, idStrings);
    }

    add = (cards: Card[], toStart = false) => this.addIds(cards.map(card => card.id), toStart);
    addIds(ids: number[], toStart = false) {
        this._addIds(ids.map(String), toStart);
        sendEvent(this.tableId, 'addCards', this.key, ids, toStart);
    }

    move = (cards: Card[], to: CardDeck, toStart = false) => this.moveIds(cards.map(card => card.id), to, toStart);
    moveIds(ids: number[], to: CardDeck, toStart = false) {
        const idStrings = ids.map(String);
        this._removeIds(idStrings);
        to._addIds(idStrings, toStart);
        sendEvent(this.tableId, 'moveCards', to.key, ids, toStart);
    }
    moveAll(to: CardDeck, toStart = false) {
        redis.zRange(this.key, 0, -1).then(idStrings => {
            to._addIds(idStrings, toStart);
            const ids = idStrings.map(Number);
            sendEvent(this.tableId, 'moveCards', to.key, ids, toStart);
        });
        redis.del(this.key);
    }
    moveAllFrom(decks: CardDeck[], toStart = false) {
        decks.forEach(deck => deck.moveAll(this, toStart));
    }

    async peekId() {
        const top = await redis.zRange(this.key, 0, 0);
        return (top && top.length > 0) ? Number(top[0]) : null;
    }

    async peekCard() {
        const id = await this.peekId();
        return id ? await getCard(id) : null;
    }

    async drawCards(count: number, to: CardDeck, toStart = false) {
        const results = await redis.zPopMinCount(this.key, count);
        if (results && results.length > 0) {
            const idStrings = results.map(result => result.value);
            redis.hDel(this._facingKey, idStrings);
            to._addIds(idStrings, toStart);
            const ids = idStrings.map(Number);
            sendEvent(this.tableId, 'moveCards', to.key, ids, toStart);
            return getCards(ids);
        }
        return [];
    }

    async drawCard(to: CardDeck, toStart = false) {
        const cards = await this.drawCards(1, to, toStart);
        return (cards && cards.length > 0) ? cards[0] : null;
    }

    async numCards() {
        return await redis.zCard(this.key);
    }

    get _facingKey() {return `${this.key}:facing`;}

    flip = (cards: Card[]) => this.flipIds(cards.map(card => card.id));
    flipIds(ids: number[]) {
        const key = this._facingKey;
        const idStrings = ids.map(String);
        this._verifyHave(idStrings);
        idStrings.forEach(idString => redis.hIncrBy(key, idString, 1));
        redis.hmGet(key, idStrings).then(facingStrings =>
            sendEvent(this.tableId, 'facing', this.key, facingStrings.map((facingString, i) => (
                {id: ids[i], facing: Number(facingString)}
            ))));
    }

    areFlipped = (cards: Card[]) => this.areFlippedIds(cards.map(card => card.id));
    async areFlippedIds(ids: number[]) {
        const facingStrings = await redis.hmGet(this._facingKey, ids.map(String));
        return facingStrings.map(facingString => Number(facingString) % 2 != 0);
    }

    isFlipped = (card: Card) => this.isFlippedId(card.id);
    async isFlippedId(id: number) {
        const facingString = await redis.hGet(this._facingKey, String(id));
        return facingString != undefined && Number(facingString) % 2 != 0;
    }
}

export type CardDeckMap = { [name: string]: CardDeck };

const valuesAll = Array.from({length: totalCards}, (_, i) => i);
const valuesMinor = Array.from({length: totalMinor}, (_, i) => i);
const valuesMajor = Array.from({length: majorArcana.length}, (_, i) => i);

export enum DeckContents
{
    AllCards,
    MinorOnly,
    MajorOnly,
}

export const getShuffledDeck = async (walletAddress: string, contents = DeckContents.AllCards) => {

    let values: number[];
    switch (contents)
    {
        case DeckContents.AllCards: values = valuesAll; break;
        case DeckContents.MinorOnly: values = valuesMinor; break;
        case DeckContents.MajorOnly: values = valuesMajor; break;
        default: values = []; break;
    }

    shuffle(values);

    return await Promise.all(values.map(async (value) => {
        const best = await getBestOwned(walletAddress, value);
        return best ?? await registerCard(value); // loaner
    }));
};

export const getBestOwned = async (walletAddress: string, value: number) => {
    const owned = await redis.zRange(`${walletAddress}:owned:${value}`, 0, 0);
    return (owned.length > 0) ? await getCard(Number(owned[0])) : null;
};