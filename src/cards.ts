import { strict as assert } from "assert";
import { totalCards } from "./tarot";
import { shuffle } from "./utils";
import { redis } from "./server";
import { sendEvent } from "./connection";

export type Card = {
    id: number,         // uniquely identifies this card w/o giving away any information concerning it
    value: number,      // index into allCards or token_id % totalCards
    token_id: number,   // token_id of this card in the FA2 contract
    ipfsUri: string,    // metadata location
    facing: number      // facing (even=default, odd=flipped)
}

export const registerCard = async (value: number, token_id: number = -1, ipfsUri: string = "", facing = 0) => {
    const getNextCardId = async (): Promise<number> => {
        return await redis.incr('nextCardId');
    };
    const card = {id: await getNextCardId(), value, token_id, ipfsUri, facing};
    redis.hSet(`card:${card.id}`, card);
    return card;
};

export const getCard = async (id: number): Promise<Card> => {
    const card = await redis.hGetAll(`card:${id}`);
    return {
        id: JSON.parse(card.id),
        value: JSON.parse(card.value),
        token_id: JSON.parse(card.token_id),
        ipfsUri: card.ipfsUri,
        facing: JSON.parse(card.facing)
    };
};

export const getCards = async (ids: number[]): Promise<Card[]> => {
    return Promise.all(ids.map(id => getCard(id)));
};

export const flipCard = async (id: number) => {
    redis.hIncrBy(`card:${id}`, 'facing', 1);
};

export const flipCards = async (ids: number[]) => {
    return Promise.all(ids.map(id => flipCard(id)));
};

export const isFlipped = (card: Card) => {
    return card.facing % 2 != 0;
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

export const initDeck = async (tableId: string, name: string) => {
    redis.sAdd(`${tableId}:decks`, name);
    const key = `${tableId}:deck:${name}`;
    const cards = await redis.zRangeWithScores(key, 0, -1);
    const [minScore, maxScore] = (cards.length > 0) ?
        [cards[0].score, cards[cards.length - 1].score] : [0, 0];
    const deck = new CardDeck(name, key, tableId, minScore, maxScore);
    const ids = cards.map(card => Number(card.value));
    sendEvent(tableId, 'initDeck', key, ids);
    return deck;
};

export const getDecks = async (tableId: string) => {
    return await redis.sMembers(`${tableId}:decks`);
};

export const getDeckCards = async (tableId: string, name: string) => {
    const key = `${tableId}:deck:${name}`;
    const idStrings = await redis.zRange(key, 0, -1);
    return {key, ids: idStrings.map(Number)};
};

export const getDeckName = (x: number, z: number) => {
    return `{${x},${z}}`;
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

    _addIds(idStrings: string[], toStart = false) {

        // Verify ids have not already been added to deck.
        redis.zmScore(this.key, idStrings)
            .then(results => assert(!results.some(Boolean), `${this.key}: ${idStrings}`));

        let i: number;
        if (toStart) {
            this._minScore -= idStrings.length;
            i = this._minScore;
        } else {
            i = this._maxScore;
            this._maxScore += idStrings.length;
        }

        // Add them to the deck.
        redis.zAdd(this.key, idStrings.map(idString => ({score: i++, value: idString})));
    }
    _removeIds(idStrings: string[]) {

        // Verify ids currently exist in this deck.
        redis.zmScore(this.key, idStrings)
            .then(results => assert(results.every(Boolean), `${this.key}: ${idStrings}`));

        // Remove them from this deck.
        redis.zRem(this.key, idStrings);
    }

    add = (cards: Card[], toStart = false) => this.addIds(cards.map(card => card.id), toStart);
    addIds(ids: number[], toStart = false) {
        this._addIds(ids.map(String), toStart);
        sendEvent(this.tableId, 'addCards', this.key, ids);
    }

    move = (cards: Card[], to: CardDeck, toStart = false) => this.moveIds(cards.map(card => card.id), to, toStart);
    moveIds(ids: number[], to: CardDeck, toStart = false) {
        const idStrings = ids.map(String);
        this._removeIds(idStrings);
        to._addIds(idStrings, toStart);
        sendEvent(this.tableId, 'moveCards', to.key, ids);
    }
    moveAll(to: CardDeck, toStart = false) {
        redis.zRange(this.key, 0, -1).then(idStrings => {
            to._addIds(idStrings, toStart);
            const ids = idStrings.map(Number);
            sendEvent(this.tableId, 'moveCards', to.key, ids);
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

    async drawCard(to: CardDeck, toStart = false) {
        const top = await redis.zPopMin(this.key);
        if (top) {
            to._addIds([top.value], toStart);
            const id = Number(top.value);
            sendEvent(this.tableId, 'moveCards', to.key, [id]);
            return await getCard(id);
        }
        return null;
    }

    async numCards() {
        return await redis.zCard(this.key);
    }
}

export type CardDeckMap = { [name: string]: CardDeck };

const values = Array.from({length: totalCards}, (_, i) => i);

export const getShuffledDeck = async (walletAddress: string) => {

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