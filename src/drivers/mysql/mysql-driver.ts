import mysql, { ResultSetHeader, RowDataPacket, Pool, PoolOptions } from 'mysql2/promise';
import { ClaimedJob, NewJob, QueueDriver } from '../driver.js';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export interface MysqlDriverOptions {
    prefix?: string;
    removeOnComplete?: boolean;
}

const MAX_DEADLOCK_RETRIES = 3;

export class MysqlDriver implements QueueDriver {
    private pool: Pool;
    private table: string;
    private prefix: string;
    private removeOnComplete: boolean;

    constructor(connection: string | PoolOptions, opts: MysqlDriverOptions = {}) {
        if (typeof connection === 'string' && !/^mysql:\/\//i.test(connection)) {
            throw new Error('MySQL URI harus dimulai dengan mysql://');
        }
        const prefix = opts.prefix ?? 'aldareth_';
        if (!/^[A-Za-z0-9_]*$/.test(prefix)) throw new Error('Table prefix invalid');
        this.prefix = prefix;
        this.table = `\`${prefix}jobs\``;
        this.pool = mysql.createPool(
            typeof connection === 'string' ? { uri: connection, connectionLimit: 2 } : { ...connection, connectionLimit: 2 },
        );
        this.removeOnComplete = opts.removeOnComplete ?? true;
    }

    private async exec(sql: string, params: unknown[]): Promise<ResultSetHeader> {
        const conn = await this.pool.getConnection();
        try {
            const [res] = await conn.query<ResultSetHeader>(sql, params);
            return res;
        } finally {
            conn.release();
        }
    }

    private async query<T extends RowDataPacket[]>(sql: string, params: unknown[]): Promise<T> {
        const conn = await this.pool.getConnection();
        try {
            const [rows] = await conn.query<T>(sql, params);
            return rows;
        } finally {
            conn.release();
        }
    }

    async migrate(): Promise<void> {
        const url = new URL('../../../migrations/001_create_jobs.sql', import.meta.url);
        const sql = (await readFile(url, 'utf8')).replaceAll('{{prefix}}', this.prefix);
        await this.exec(sql, []);
    }

    async push(job: NewJob): Promise<string> {
        const res = await this.exec(
            `INSERT INTO ${this.table}
        (queue, name, payload, status, attempts, max_attempts, available_at, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
            [job.queue, job.name, job.payload, job.maxAttempts, job.delaySeconds],
        );
        return String(res.insertId);
    }

    async claim(opts: { queues: string[]; limit: number; workerId: string; leaseSeconds: number }): Promise<ClaimedJob[]> {
        const token = randomUUID();
        for (let attempt = 0; ; attempt++) {
            try {
                const res = await this.exec(
                    `UPDATE ${this.table}
           SET status='processing', attempts=attempts+1, locked_by=?, lock_token=?,
               locked_until=DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), updated_at=UTC_TIMESTAMP()
           WHERE status='pending' AND available_at <= UTC_TIMESTAMP() AND queue IN (?)
           ORDER BY id LIMIT ?`,
                    [opts.workerId, token, opts.leaseSeconds, opts.queues, opts.limit],
                );
                if (res.affectedRows === 0) return [];
                break;
            } catch (err: any) {
                if (err?.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_DEADLOCK_RETRIES) continue;
                throw err;
            }
        }
        const rows = await this.query<RowDataPacket[]>(
            `SELECT id, queue, name, payload, attempts, max_attempts FROM ${this.table}
       WHERE lock_token = ? AND status = 'processing' ORDER BY id`,
            [token],
        );
        return rows.map((r: RowDataPacket) => ({
            id: String(r.id),
            queue: r.queue,
            name: r.name,
            payload: JSON.parse(r.payload),
            attempts: r.attempts,
            maxAttempts: r.max_attempts,
            lockToken: token,
        }));
    }

    private async guarded(sql: string, params: unknown[]): Promise<boolean> {
        const res = await this.exec(sql, params);
        return res.affectedRows === 1;
    }

    complete(id: string, token: string) {
        return this.removeOnComplete
            ? this.guarded(`DELETE FROM ${this.table} WHERE id=? AND lock_token=? AND status='processing'`, [id, token])
            : this.guarded(
                  `UPDATE ${this.table} SET status='completed', locked_until=NULL, lock_token=NULL, updated_at=UTC_TIMESTAMP()
         WHERE id=? AND lock_token=? AND status='processing'`,
                  [id, token],
              );
    }

    retry(id: string, token: string, delaySeconds: number, error: string) {
        return this.guarded(
            `UPDATE ${this.table} SET status='pending', locked_until=NULL, lock_token=NULL, last_error=?,
         available_at=DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), updated_at=UTC_TIMESTAMP()
       WHERE id=? AND lock_token=? AND status='processing'`,
            [error, delaySeconds, id, token],
        );
    }

    fail(id: string, token: string, error: string) {
        return this.guarded(
            `UPDATE ${this.table} SET status='failed', locked_until=NULL, lock_token=NULL, last_error=?, updated_at=UTC_TIMESTAMP()
       WHERE id=? AND lock_token=? AND status='processing'`,
            [error, id, token],
        );
    }

    release(id: string, token: string) {
        return this.guarded(
            `UPDATE ${this.table} SET status='pending', attempts=attempts-1, locked_until=NULL, lock_token=NULL, updated_at=UTC_TIMESTAMP()
       WHERE id=? AND lock_token=? AND status='processing'`,
            [id, token],
        );
    }

    async recoverExpired(): Promise<number> {
        // Yang percobaannya sudah habis -> failed; sisanya kembali ke antrean
        const failed = await this.exec(
            `UPDATE ${this.table} SET status='failed', locked_until=NULL, lock_token=NULL,
         last_error='Lease kedaluwarsa dan percobaan habis', updated_at=UTC_TIMESTAMP()
       WHERE status='processing' AND locked_until < UTC_TIMESTAMP() AND attempts >= max_attempts`,
            [],
        );
        const requeued = await this.exec(
            `UPDATE ${this.table} SET status='pending', locked_until=NULL, lock_token=NULL, updated_at=UTC_TIMESTAMP()
       WHERE status='processing' AND locked_until < UTC_TIMESTAMP() AND attempts < max_attempts`,
            [],
        );
        return failed.affectedRows + requeued.affectedRows;
    }

    async hasActive(name: string): Promise<boolean> {
        const rows = await this.query<RowDataPacket[]>(
            `SELECT 1 AS active
        FROM ${this.table}
        WHERE name = ?
            AND status IN ('pending', 'processing')
        LIMIT 1`,
            [name],
        );
        return rows.length > 0;
    }

    async close(): Promise<void> {
        await this.pool.end();
    }
}
