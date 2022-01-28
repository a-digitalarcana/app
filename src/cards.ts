import { strict as assert } from "assert";
import { Namespace } from "socket.io";
import { totalCards } from "./tarot";
import { shuffle } from "./utils";
import { io, redis } from "./server";
import { broadcast } from "./cardtable";

// TODO: Have Unity connect to redis to get deck info and register for changes? (https://redis.io/clients#c-sharp)

export type Card = {
    id: number,         // uniquely identifies this card w/o giving away any information concerning it
    value: number,      // index into allCards or token_id % totalCards
    token_id: number,   // token_id of this card in the FA2 contract
    ipfsUri: string     // metadata location
}

export const registerCard = async (value: number, token_id: number = -1, ipfsUri: string = "") => {
    const getNextCardId = async (): Promise<number> => {
        return await redis.incr('nextCardId');
    };
    const card = {id: await getNextCardId(), value, token_id, ipfsUri};
    redis.hSet(`card:${card.id}`, card);
    return card;
};

export const getCard = async (id: number): Promise<Card> => {
    const card = await redis.hGetAll(`card:${id}`);
    return {
        id: JSON.parse(card.id),
        value: JSON.parse(card.value),
        token_id: JSON.parse(card.token_id),
        ipfsUri: card.ipfsUri
    };
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

export const newDeck = async (tableId: string, name: string) => {
    const deck = new CardDeck(name, `${tableId}:deck:${name}`);
    broadcast(tableId, 'newDeck', name, deck.namespace.name);

    // TODO: Clients should probably ask for this instead on receiving above event.
    redis.zRange(deck.key, 0, -1).then(idStrings => {
        if (idStrings.length > 0) {
            deck.namespace.emit('addCards', idStrings.map(Number));
        }
    });
    return deck;
};

// A collection of cards (not necessarily a full deck, might be a discard pile, or current set of cards in hand, etc.).
export class CardDeck
{
    _name: string;
    get name() {return this._name;}

    _key: string;
    get key() {return this._key;}

    namespace: Namespace; // socket.io
    maxIndex: number = 0;

    constructor(name: string, key: string) {
        this._name = name;
        this._key = key;
        this.namespace = io.of(`/${key}`);
        redis.del(key);
    }

    add = (cards: Card[]) => this.addIds(cards.map(card => card.id));
    addIds(ids: number[]) {
        const idStrings = ids.map(String);
        redis.zmScore(this.key, idStrings)
            .then(results => assert(!results.some(Boolean)));

        redis.zAdd(this.key, idStrings.map(idString => ({score: ++this.maxIndex, value: idString})));
        this.namespace.emit('addCards', ids);
    }

    remove = (cards: Card[]) => this.removeIds(cards.map(card => card.id));
    removeIds(ids: number[]) {
        const idStrings = ids.map(String);
        redis.zmScore(this.key, idStrings)
            .then(results => assert(results.every(Boolean)));

        redis.zRem(this.key, idStrings);
        this.namespace.emit('removeCards', ids);
    }

    transferAllTo(dest: CardDeck) {
        redis.zRange(this.key, 0, -1).then(idStrings => {
            const ids = idStrings.map(Number);
            this.namespace.emit('removeCards', ids);
            dest.addIds(ids);
        });
        redis.del(this.key);
    }

    transferAllFrom(decks: CardDeck[]) {
        decks.forEach(deck => deck.transferAllTo(this));
    }

    destroy() {
        redis.zRange(this.key, 0, -1)
            .then(idStrings => this.namespace.emit('removeCards', idStrings.map(Number)));
        redis.del(this.key);
    }

    async numCards() {
        return await redis.zCard(this.key);
    }

    async drawCard() {
        const top = await redis.zPopMin(this.key);
        return top ? await getCard(Number(top.value)) : null;
    }
}

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