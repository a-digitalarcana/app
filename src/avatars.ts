import { getPlayer } from "./cardtable";

const Identicon = require('identicon.js');

export const getAvatar = async (userId: string, size = 64, background = [11, 47, 108]) : Promise<Buffer | null> => {
    try {

        const player = await getPlayer(userId);
        if (player) {
            return getAvatar(player, size, background);
        }

        const hash = Buffer.from(userId, 'base64').toString('hex');
        const data = new Identicon(hash, {size, background}).toString();
        return Buffer.from(data, 'base64');

    } catch (e) {
        return null;
    }
};