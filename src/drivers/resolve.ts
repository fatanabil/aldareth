import { MysqlDriver } from './mysql/mysql-driver.js';
import { MongoDriver } from './mongodb/mongodb-driver.js';
import type { QueueDriver } from './driver.js';
import type { AldarethConfig, DriverKind } from '../index.js';

export function driverFromUri(uri: string): DriverKind {
    return /^mongodb(\+srv)?:\/\//i.test(uri) ? 'mongodb' : 'mysql';
}

/** ALDARETH_DRIVER > explicit > skema URI */
export function resolveDriver(uri: string, explicit?: DriverKind): DriverKind {
    return driverFromEnv() ?? explicit ?? driverFromUri(uri);
}

function driverFromEnv(): DriverKind | undefined {
    const raw = process.env.ALDARETH_DRIVER?.trim().toLowerCase();
    if (!raw) return undefined;
    if (raw !== 'mysql' && raw !== 'mongodb') throw new Error(`ALDARETH_DRIVER tidak dikenal: ${raw} (pilihan: mysql, mongodb)`);
    return raw;
}

export function createDriver(config: Partial<AldarethConfig> = {}): QueueDriver {
    const opts = {
        prefix: process.env.ALDARETH_PREFIX ?? config.opts?.prefix,
        removeOnComplete: config.opts?.removeOnComplete,
    };

    // PoolOptions hanya bisa datang dari config — URI env tidak bisa membawa opsi seperti ssl/socketPath
    if (typeof config.connection === 'object') {
        if (driverFromEnv() === 'mongodb') throw new Error('ALDARETH_DRIVER=mongodb tidak cocok dengan PoolOptions (khusus MySQL)');
        return new MysqlDriver(config.connection, opts);
    }

    const connection = process.env.ALDARETH_DB_URL ?? config.connection;
    if (!connection) throw new Error('Koneksi database belum diatur — isi "connection" atau env ALDARETH_DB_URL');
    const kind = resolveDriver(connection, config.driver);
    return kind === 'mongodb' ? new MongoDriver(connection, opts) : new MysqlDriver(connection, opts);
}