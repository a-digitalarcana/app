import { Card } from "./cards";
import { getUserName, sendEvent } from "./connection";
import { strict as assert } from "assert";
import { redis } from "./server";
import { Browse } from "./games/browse";
import { War } from "./games/war";

const gameTypes: any = {
    Browse,
    War,
};

const newGame = (className: string, tableId: string) => {
    return new gameTypes[className](tableId);
};

const games: any = {};

export const beginGame = (name: string, tableId: string) => {

    const game = newGame(name, tableId);
    assert(game);

    // TODO: Clean up old game?
    assert(!(tableId in games));
    games[tableId] = game;

    // Cache name of game.
    redis.hSet(tableId, 'game', name);

    game.begin();
};

export const resumeGame = async (tableId: string) => {

    // Bail if someone else already resumed.
    if (games[tableId]) {
        return;
    }

    // Get cached name of game, if any.
    const name = await redis.hGet(tableId, 'game');
    if (!name) {
        return;
    }

    const game = newGame(name, tableId);
    assert(game);

    games[tableId] = game;

    // TODO: Setup callbacks, without creating new decks, etc.
    game.begin();
};


export const newTable = async (userIds: string[]) => {

    const getNextTableId = async () => {
        const id = await redis.incr('nextTableId');
        return `table:${id}`;
    };

    const tableId = await getNextTableId();
    redis.sAdd(`${tableId}:players`, userIds);
    userIds.forEach((userId, index) => {

        // TODO: Remove userId from prev table's players list
        //       (Cleanup on empty)

        // Store table across sessions.
        redis.hSet(userId, 'table', tableId);

        // Notify all connections of new table.
        sendEvent(userId, 'setTable', tableId);

        // Send welcome messages.
        getUserName(userId).then(name =>
            broadcastMsg(tableId, `Player ${name} has joined the table!`, userId));
    });

    return tableId;
};

// Get the wallet addresses for the players at the table
export const getPlayers = async (tableId: string) => {
    return await redis.sMembers(`${tableId}:players`);
};

// Send a message to everyone at the table (with optional exclude userId).
export const broadcastMsg = async (tableId: string, text: string, exclude?: string) => {
    const debug = true;
    if (debug) {
        text = `${tableId}> ${text}`;
    }
    const msg = JSON.stringify({event: 'msg', args: [text], exclude});
    redis.xAdd(`${tableId}:chat`, '*', {msg});
};

export const revealCard = (tableId: string, card: Card) => revealCards(tableId, [card]);
export const revealCards = (tableId: string, cards: Card[]) => {
    sendEvent(tableId, 'revealCards', cards);
};