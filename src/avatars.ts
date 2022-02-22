import { getPlayers } from "./cardtable";

const Identicon = require('identicon.js');

export const getAvatar = async (userId: string, size = 64, background = [11, 47, 108]) : Promise<Buffer> => {

    if (userId.startsWith('table:')) {
        const i = userId.lastIndexOf(':');
        const tableId = userId.substring(0, i);
        const slot = Number(userId.substring(i + 1));
        const players = await getPlayers(tableId);
        if (players && slot < players.length) {
            return getAvatar(players[slot], size, background);
        }
    }

    const hash = Buffer.from(userId, 'base64').toString('hex');
    const data = new Identicon(hash, {size, background}).toString();
    return Buffer.from(data, 'base64');
};