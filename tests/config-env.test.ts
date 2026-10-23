import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAldareth } from '../src/index.js';
import { MysqlDriver } from '../src/drivers/mysql/mysql-driver.js';
import { MongoDriver } from '../src/drivers/mongodb/mongodb-driver.js';

const saved = {
    ALDARETH_DB_URL: process.env.ALDARETH_DB_URL,
    ALDARETH_DRIVER: process.env.ALDARETH_DRIVER,
};

afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
});

it('connection diambil dari ALDARETH_DB_URL', async () => {
    process.env.ALDARETH_DB_URL = 'mongodb://127.0.0.1:27017/aldareth';
    delete process.env.ALDARETH_DRIVER;
    const a = createAldareth({ jobs: [] });
    expect(a.driver).toBeInstanceOf(MongoDriver);
    await a.driver.close();
});

it('ALDARETH_DRIVER menentukan driver', async () => {
    process.env.ALDARETH_DB_URL = 'mongodb://127.0.0.1:27017/aldareth';
    process.env.ALDARETH_DRIVER = 'mongodb';
    const a = createAldareth({ jobs: [] });
    expect(a.driver).toBeInstanceOf(MongoDriver);
    await a.driver.close();
});

it('ALDARETH_DB_URL lebih dulu dari connection di config', async () => {
    process.env.ALDARETH_DB_URL = 'mongodb://127.0.0.1:27017/aldareth';
    delete process.env.ALDARETH_DRIVER;
    const a = createAldareth({ jobs: [], connection: 'mysql://root:secret@127.0.0.1:3306/aldareth' });
    expect(a.driver).toBeInstanceOf(MongoDriver);
    await a.driver.close();
});

it('PoolOptions di config tidak ditimpa env', async () => {
    process.env.ALDARETH_DB_URL = 'mongodb://127.0.0.1:27017/aldareth';
    delete process.env.ALDARETH_DRIVER;
    const a = createAldareth({ jobs: [], connection: { host: '127.0.0.1', user: 'root' } });
    expect(a.driver).toBeInstanceOf(MysqlDriver);
    await a.driver.close();
});

it('tanpa connection di config dan tanpa env -> error', () => {
    delete process.env.ALDARETH_DB_URL;
    expect(() => createAldareth({ jobs: [] })).toThrow(/ALDARETH_DB_URL/);
});

it('ALDARETH_DRIVER yang tidak dikenal -> error', () => {
    process.env.ALDARETH_DB_URL = 'mongodb://127.0.0.1:27017/aldareth';
    process.env.ALDARETH_DRIVER = 'postgres';
    expect(() => createAldareth({ jobs: [] })).toThrow(/ALDARETH_DRIVER/);
});

it('.env di cwd dipakai saat env kosong, dan tidak menimpa env yang ada', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aldareth-env-'));
    const cwd = process.cwd();
    writeFileSync(path.join(dir, '.env'), 'ALDARETH_DB_URL=mongodb://127.0.0.1:27017/aldareth\n');
    process.chdir(dir);
    try {
        delete process.env.ALDARETH_DB_URL;
        const a = createAldareth({ jobs: [] });
        expect(a.driver).toBeInstanceOf(MongoDriver);
        await a.driver.close();

        process.env.ALDARETH_DB_URL = 'mysql://root:secret@127.0.0.1:3306/aldareth';
        delete process.env.ALDARETH_DRIVER;
        const b = createAldareth({ jobs: [] });
        expect(b.driver).toBeInstanceOf(MysqlDriver);
        await b.driver.close();
    } finally {
        process.chdir(cwd);
        rmSync(dir, { recursive: true, force: true });
    }
});
