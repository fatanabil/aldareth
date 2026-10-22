import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import { MongoDriver } from '../src/drivers/mongodb/mongodb-driver.js';

const uri = 'mongodb://127.0.0.1:27017/aldareth_test';
const mk = () => new MongoDriver(uri, { prefix: 't_' });
let admin: MongoClient;

beforeAll(async () => {
    const d = mk();
    await d.migrate();
    await d.close();
    admin = new MongoClient(uri);
    await admin.connect();
});
beforeEach(async () => {
    await admin.db('aldareth_test').collection('t_jobs').deleteMany({});
});
afterAll(async () => {
    await admin.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const job = { queue: 'default', name: 'x', payload: '{}', maxAttempts: 3, delaySeconds: 0 };

it('dua worker paralel tidak pernah meng-claim job yang sama', async () => {
    const setup = mk();
    for (let i = 0; i < 100; i++) await setup.push(job);
    await setup.close();

    const drain = async (id: string) => {
        const d = mk();
        const got: string[] = [];
        for (;;) {
            const batch = await d.claim({ queues: ['default'], limit: 5, workerId: id, leaseSeconds: 60 });
            if (batch.length === 0) break;
            got.push(...batch.map((j) => j.id));
        }
        await d.close();
        return got;
    };

    const [a, b] = await Promise.all([drain('A'), drain('B')]);
    const all = [...a, ...b];
    expect(new Set(all).size).toBe(all.length); // tidak ada duplikat
    expect(all.length).toBe(100); // tidak ada yang hilang
});

it('worker lama tidak bisa menyelesaikan job yang sudah di-claim ulang', async () => {
    const d = mk();
    const id = await d.push(job);
    const [first] = await d.claim({ queues: ['default'], limit: 1, workerId: 'A', leaseSeconds: 1 });
    await sleep(2200);
    expect(await d.recoverExpired()).toBe(1);
    const [second] = await d.claim({ queues: ['default'], limit: 1, workerId: 'B', leaseSeconds: 60 });
    expect(second!.id).toBe(id);
    expect(await d.complete(id, first!.lockToken)).toBe(false); // token lama ditolak
    expect(await d.complete(id, second!.lockToken)).toBe(true);
    await d.close();
});
