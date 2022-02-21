import { createClient } from "redis";
import { Server, Socket } from "socket.io";
import { isDevelopment } from "./utils";
import { mintSet } from "./admin";
import { openPack } from "./marketplace";
import { Connection } from "./connection";

// Connect to Redis db.
export type RedisClientType = ReturnType<typeof createClient>;
export const redis: RedisClientType = createClient({
    url: process.env.QOVERY_REDIS_Z8BD2191C_DATABASE_URL,
    socket: {connectTimeout: isDevelopment ? 600000 : 5000}
});
(async () => {
    redis.on('error', (err) => console.log(`Redis: ${err}`));
    redis.on('connect', () => console.log("Redis: connect"));
    redis.on('ready', () => console.log("Redis: ready"));
    redis.on('end', () => console.log("Redis: end"));
    redis.on('reconnecting', () => console.log("Redis: reconnecting"));
    await redis.connect();
})();

// Setup express server.
const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
export const io = new Server(server, {
    cors: {
      origin: ["http://localhost:3000"]
    }
});
const port = process.env.PORT || 8080;

const defaultSet = "Default (beta)";
const defaultMinting = "First Edition";
const defaultPriceMutez = 1000000;

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
    const player = new Connection(socket);
    socket.on("disconnect", () => {
        player.disconnect();
    });
});

// Serve client build (production only).
if (process.env.NODE_ENV !== 'development') {
    console.log('hosting production build');

    // Report public ip.
    http.get({'host': 'api.ipify.org', 'port': 80, 'path': '/'}, (resp: any) => {
        resp.on('data', (ip: any) => {
            console.log("My public IP address is: " + ip);
        });
    });

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

// Serve player avatars.
const Identicon = require('identicon.js');
app.get('/avatar/:userId', (req: any, res: any) => {
    const userId = req.params.userId;
    const hash = Buffer.from(userId, 'base64').toString('hex');
    const data = new Identicon(hash, {
        size: 64,
        background: [11, 47, 108]
    }).toString();

    res.type('png');
    res.end(Buffer.from(data, 'base64'));
});

server.listen(port, () => {
    console.log(`server listening on port: ${port}`)
});