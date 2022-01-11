import { createClient } from "redis";
import { Server, Socket } from "socket.io";
import { isDevelopment } from "./utils";
import { mintSet } from "./admin";
import { openPack } from "./marketplace";
import { CardPlayer } from "./cardplayer";

export const players: CardPlayer[] = [];

// Connect to Redis db.
export type RedisClientType = ReturnType<typeof createClient>;
const client: RedisClientType = createClient({
    url: process.env.QOVERY_REDIS_Z8BD2191C_DATABASE_URL
});
(async () => {
    client.on('error', (err) => console.log(`Redis: ${err}`));
    client.on('connect', () => console.log("Redis: connect"));
    client.on('ready', () => console.log("Redis: ready"));
    client.on('end', () => console.log("Redis: end"));
    client.on('reconnecting', () => console.log("Redis: reconnecting"));
    await client.connect();
})();

// Setup express server.
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

// Report public ip.
http.get({'host': 'api.ipify.org', 'port': 80, 'path': '/'}, (resp: any) => {
    resp.on('data', (ip: any) => {
        console.log("My public IP address is: " + ip);
    });
});

// Browser socket.io handlers.
io.of("/browser").on("connection", (socket: Socket) => {

    if (isDevelopment) {
        socket.emit('isDevelopment', true);
        socket.on('mintSet', () => {
            mintSet(socket, defaultSet, defaultMinting);
        });
    }

    socket.on('openPack', async (address: string) => {
        socket.emit('packOpened', await openPack(socket, address, defaultPriceMutez, defaultSet, defaultMinting));
    });
});

// Unity socket.io connection.
io.on('connection', (socket: Socket) => {

    const player = new CardPlayer(socket, io, client);
    players.push(player);
    socket.on("disconnect", () => {
        players.splice(players.indexOf(player), 1);
        player.destroy();
    });

});

// Serve client build (production only).
if (process.env.NODE_ENV !== 'development') {
    console.log('hosting production build');

    // Set up rate limiter: maximum of five requests per minute.
    const rateLimit = require('express-rate-limit');
    const limiter = rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 5
    });

    // Apply rate limiter to all requests.
    app.use(limiter);

    // Serve React app.
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
    console.log(`server listening on port: ${port}`)
});