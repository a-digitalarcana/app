import fs from "fs";
import path from "path";
import { Socket } from "socket.io";
import { File } from "nft.storage";

export const isDevelopment = process.env.NODE_ENV === 'development';

// Collect and load the top level files at a given path (subdirs excluded).
export const getDirectory = async (socket: Socket, dirpath: string) => {
    const directory = [];
    const files = fs.readdirSync(dirpath, { withFileTypes: true })
        .filter(dirent => dirent.isFile())
        .map(dirent => dirent.name);
    const pct = ((i=0, max=files.length) => () => ++i / max * 100)();
    for (let file of files) {
        socket.emit('pct', pct(), `Loading ${file}`);
        const filepath = path.join(dirpath, file);
        directory.push(new File([await fs.promises.readFile(filepath)], file));
    }
    return directory;
};

export const sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

export const randomRange = (minInclusive: number, maxInclusive: number) => {
    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxInclusive);
    return Math.floor(Math.random() * (max - min + 1) + min);
};

export const shuffle = (list: number[]) => {
    const count = list.length;
    const last = count - 1;
    for (let i = 0; i < last; ++i) {
        const n = randomRange(i, last);
        [list[i], list[n]] = [list[n], list[i]];
    }
};

export const notNull = <T>(x: T | null): x is T => x !== null;