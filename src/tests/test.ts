import test from 'ava';
import { createClient } from "redis";

test('redis connection', async t => {

    const redis = createClient();
    redis.on('connect', () => t.pass());
    redis.on('error', () => t.fail());
    await redis.connect();
    t.log(await redis.info('Server'));
});