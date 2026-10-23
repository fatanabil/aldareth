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

// .env dari cwd sebagai fallback: variabel yang sudah ada di environment tidak ditimpa,
// jadi production tetap menang. ALDARETH_NO_DOTENV=1 mematikannya.
function loadDotEnv(): void {
    if (process.env.ALDARETH_NO_DOTENV) return;
    if (typeof process.loadEnvFile !== 'function') return; // Node < 20.12
    try {
        process.loadEnvFile();
    } catch {
        // tidak ada .env — variabel bisa datang dari shell
    }
}

export function createDriver(config: Partial<AldarethConfig> = {}): QueueDriver {
    if (!process.env.ALDARETH_DB_URL && typeof config.connection !== 'object') loadDotEnv();
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