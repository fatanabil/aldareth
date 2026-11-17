import { MysqlDriver } from './mysql/mysql-driver.js';
import { MongoDriver } from './mongodb/mongodb-driver.js';
import type { QueueDriver } from './driver.js';
import type { AldarethConfig, DriverKind } from '../index.js';

export function driverFromUri(uri: string): DriverKind {
    return /^mongodb(\+srv)?:\/\//i.test(uri) ? 'mongodb' : 'mysql';
}

/** ALDARETH_DRIVER > explicit > URI scheme */
export function resolveDriver(uri: string, explicit?: DriverKind): DriverKind {
    return driverFromEnv() ?? explicit ?? driverFromUri(uri);
}

function driverFromEnv(): DriverKind | undefined {
    const raw = process.env.ALDARETH_DRIVER?.trim().toLowerCase();
    if (!raw) return undefined;
    if (raw !== 'mysql' && raw !== 'mongodb') throw new Error(`Unknown ALDARETH_DRIVER: ${raw} (choose mysql or mongodb)`);
    return raw;
}

// .env from the cwd as a fallback: variables already present in the environment are
// never overwritten, so production always wins. ALDARETH_NO_DOTENV=1 disables it.
function loadDotEnv(): void {
    if (process.env.ALDARETH_NO_DOTENV) return;
    if (typeof process.loadEnvFile !== 'function') return; // Node < 20.12
    try {
        process.loadEnvFile();
    } catch {
        // no .env — the variables may come from the shell
    }
}

export function createDriver(config: Partial<AldarethConfig> = {}): QueueDriver {
    if (!process.env.ALDARETH_DB_URL && typeof config.connection !== 'object') loadDotEnv();
    const opts = {
        prefix: process.env.ALDARETH_PREFIX ?? config.opts?.prefix,
        removeOnComplete: config.opts?.removeOnComplete,
    };

    // PoolOptions can only come from config — an env URI cannot carry options like ssl/socketPath
    if (typeof config.connection === 'object') {
        if (driverFromEnv() === 'mongodb') throw new Error('ALDARETH_DRIVER=mongodb does not match PoolOptions (MySQL only)');
        return new MysqlDriver(config.connection, opts);
    }

    const connection = process.env.ALDARETH_DB_URL ?? config.connection;
    if (!connection) throw new Error('Database connection is not configured — set "connection" or the ALDARETH_DB_URL env var');
    const kind = resolveDriver(connection, config.driver);
    return kind === 'mongodb' ? new MongoDriver(connection, opts) : new MysqlDriver(connection, opts);
}