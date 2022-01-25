import { Card } from "./cards";
import { getUserName, sendEvent } from "./connection";
import { redis } from "./server";

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
    const id = await redis.incr(`${tableId}:nextMsgId`);
    const msg = JSON.stringify({event: 'msg', args: [text], exclude});
    // TODO: Same exact text will replace previous entry with new score.
    redis.zAdd(`${tableId}:chat`, {score: id, value: msg}),
    redis.publish(tableId, "msg")
};

export const getMessages = async (tableId: string, min: number | string = "-inf", max: number | string = "+inf") => {
    return await redis.zRangeByScoreWithScores(`${tableId}:chat`, min, max);
};

export const broadcast = (tableId: string, event: string, ...args: any[]) => {
    const msg = JSON.stringify({event, args});
    redis.publish(tableId, msg);
};

export const revealCards = (tableId: string, cards: Card[]) => {
    broadcast(tableId, 'revealCards', cards);
};