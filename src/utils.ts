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
}

