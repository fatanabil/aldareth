import { beforeAll, beforeEach, afterAll, expect, it, describe } from 'vitest';
import mysql from 'mysql2/promise';
import { MysqlDriver } from '../src/drivers/mysql/mysql-driver.js';

// These tests need a live MySQL server. Set ALDARETH_TEST_MYSQL=1 to run them;
// otherwise the whole file is skipped. Connection details come from the
// ALDARETH_TEST_MYSQL_* environment variables, never from source.
const enabled = process.env.ALDARETH_TEST_MYSQL === '1';
const conn = {
    host: process.env.ALDARETH_TEST_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.ALDARETH_TEST_MYSQL_PORT ?? 3306),
    user: process.env.ALDARETH_TEST_MYSQL_USER ?? 'root',
    password: process.env.ALDARETH_TEST_MYSQL_PASSWORD ?? '',
    database: process.env.ALDARETH_TEST_MYSQL_DATABASE ?? 'aldareth_test',
};
const mk = () => new MysqlDriver(conn, { prefix: 't_' });

describe.skipIf(!enabled)('mysql driver', () => {
    let admin: mysql.Connection;

    beforeAll(async () => {
        const d = mk();
        await d.migrate();
        await d.close();
        admin = await mysql.createConnection(conn);
    });
    beforeEach(async () => {
        await admin.query('TRUNCATE TABLE `t_jobs`');
    });
    afterAll(async () => {
        await admin.end();
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

    it('driver bisa dibuat dari URI', async () => {
        const auth = conn.password ? `${conn.user}:${encodeURIComponent(conn.password)}` : conn.user;
        const uri = `mysql://${auth}@${conn.host}:${conn.port}/${conn.database}`;
        const d = new MysqlDriver(uri, { prefix: 't_' });
        expect(await d.push(job)).toBeTruthy();
        await d.close();
    });
});
