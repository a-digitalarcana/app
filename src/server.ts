import { Server, Socket } from "socket.io";
import { isDevelopment } from "./utils";
import { mintSet } from "./admin";
import { openPack } from "./marketplace";
import { CardPlayer } from "./cardplayer";
import { CardTable } from "./cardtable";

const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
      origin: ["http://localhost:3000"]
    }
});
const port = process.env.PORT || 8080;

const defaultSet = "Default (beta)";
const defaultMinting = "First Edition";
const defaultPriceMutez = 1000000;

const players: CardPlayer[] = [];
const tables: CardTable[] = [];

io.of("/browser").on("connection", (socket: Socket) => {
    socket.emit('error', "");

    socket.on('openPack', (address: string) => openPack(socket, address, defaultPriceMutez, defaultSet, defaultMinting));

    if (isDevelopment) {
        socket.emit('isDevelopment', true);
        socket.on('mintSet', () => {
            mintSet(socket, defaultSet, defaultMinting);
        });
    }
});

io.on('connection', (socket: Socket) => {

    const player = new CardPlayer(socket, io);
    players.push(player);
    socket.on("disconnect", () => {
        players.splice(players.indexOf(player), 1);
        const table = player.table;
        if (table) {
            tables.splice(tables.indexOf(table, 1));
            table.destroy();
        }
    });

});

// Serve client build (production only).
if (process.env.NODE_ENV !== 'development') {
    console.log('hosting production build');
    const buildpath = path.join(__dirname, '../build');
    app.use(express.static(buildpath));
    app.get('/', (req: any, res: any) => {
        res.sendFile(path.join(buildpath, 'index.html'))
    });
} else {
    console.log('running in development mode');
    app.get('/ping', (req: any, res: any) => res.send('pong'));
}

server.listen(port, () => {
    console.log(`server started at http://localhost:${port}`)
});