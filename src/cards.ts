import { CardPlayer } from "./cardplayer";
import { strict as assert } from "assert";
import { Namespace } from "socket.io";

export type Card = {
    id: number,         // uniquely identifies this card w/o giving away any information concerning it
    token_id: number,   // token_id of this card in the FA2 contract
    ipfsUri: string     // metadata location
}

// TODO: Clean up when client disconnects (maybe store per table?)
export const cardRegistry: Card[] = [];

export const registerCard = (token_id: number, ipfsUri: string) => {
    const card = {id: cardRegistry.length, token_id, ipfsUri};
    cardRegistry.push(card);
    return card;
};

export const deckRegistry = new Map<string, CardDeck>();    // by owner.walletAddress + deck.name

// A collection of cards (not necessarily a full deck, might be a discard pile, or current set of cards in hand, etc.).
export class CardDeck
{
    owner: CardPlayer;
    _name: string;
    get name() { return this._name; }

    namespace: Namespace;

    constructor(owner: CardPlayer, name: string) {
        this.owner = owner;
        this._name = name;
        assert(owner.walletAddress);
        const key = `${owner.walletAddress}.${name}`;
        //assert(!deckRegistry.has(key));
        //deckRegistry.set(key, this);
        this.namespace = owner.io.of(`/${key}`);
    }

    cards: Card[] = [];
    add(cards: Card[]) {
        assert(!this.cards.some(card => cards.includes(card)));
        this.cards.concat(cards);
        this.namespace.emit('addCards', cards.map(card => card.id));
    }
    remove(cards: Card[]) {
        this.cards = this.cards
            .filter(card => !cards.includes(card));
        this.namespace.emit('removeCards', cards.map(card => card.id));
    }
}

