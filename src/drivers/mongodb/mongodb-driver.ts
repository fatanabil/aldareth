import { Collection, MongoClient, ObjectId, type Filter, type MongoClientOptions } from 'mongodb';
import { ClaimedJob, NewJob, QueueDriver } from '../driver.js';
import { randomUUID } from 'node:crypto';

export interface MongoDriverOptions {
    prefix?: string;
    removeOnComplete?: boolean;
    clientOptions?: MongoClientOptions;
}

type Status = 'pending' | 'processing' | 'completed' | 'failed';

interface JobDoc {
    _id: ObjectId;
    queue: string;
    name: string;
    payload: string;
    status: Status;
    attempts: number;
    max_attempts: number;
    available_at: Date;
    locked_until: Date | null;
    locked_by: string | null;
    lock_token: string | null;
    last_error: string | null;
    created_at: Date;
    updated_at: Date;
}

function dbNameOf(uri: string): string {
    let name: string;
    try {
        name = new URL(uri).pathname.replace(/^\//, '');
    } catch {
        throw new Error('MongoDB URI invalid');
    }
    if (!name) throw new Error('MongoDB URI harus menyebut nama database, contoh: mongodb://localhost:27017/aldareth');
    return name;
}

export class MongoDriver implements QueueDriver {
    private client: MongoClient;
    private col: Collection<JobDoc>;
    private removeOnComplete: boolean;

    readonly uri: string;
    readonly collection: string;

    constructor(uri: string, opts: MongoDriverOptions = {}) {
        if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
            throw new Error('MongoDB URI harus dimulai dengan mongodb:// atau mongodb+srv://');
        }
        const prefix = opts.prefix ?? 'aldareth_';
        if (!/^[A-Za-z0-9_]*$/.test(prefix)) throw new Error('Collection prefix invalid');
        this.uri = uri;
        this.collection = `${prefix}jobs`;
        this.removeOnComplete = opts.removeOnComplete ?? true;
        this.client = new MongoClient(uri, opts.clientOptions);
        this.col = this.client.db(dbNameOf(uri)).collection<JobDoc>(this.collection);
    }

    async migrate(): Promise<void> {
        await this.col.createIndex({ queue: 1, status: 1, available_at: 1, _id: 1 }, { name: 'idx_claim' });
        await this.col.createIndex({ status: 1, locked_until: 1 }, { name: 'idx_recover' });
    }

    async push(job: NewJob): Promise<string> {
        const now = new Date();
        const doc: JobDoc = {
            _id: new ObjectId(),
            queue: job.queue,
            name: job.name,
            payload: job.payload,
            status: 'pending',
            attempts: 0,
            max_attempts: job.maxAttempts,
            available_at: new Date(now.getTime() + job.delaySeconds * 1000),
            locked_until: null,
            locked_by: null,
            lock_token: null,
            last_error: null,
            created_at: now,
            updated_at: now,
        };
        await this.col.insertOne(doc);
        return doc._id.toHexString();
    }

    async claim(opts: { queues: string[]; limit: number; workerId: string; leaseSeconds: number }): Promise<ClaimedJob[]> {
        const token = randomUUID();
        const now = new Date();
        const until = new Date(now.getTime() + opts.leaseSeconds * 1000);
        const claimed: ClaimedJob[] = [];

        for (let i = 0; i < opts.limit; i++) {
            const doc = await this.col.findOneAndUpdate(
                { status: 'pending', available_at: { $lte: now }, queue: { $in: opts.queues } },
                {
                    $set: {
                        status: 'processing',
                        locked_by: opts.workerId,
                        lock_token: token,
                        locked_until: until,
                        updated_at: now,
                    },
                    $inc: { attempts: 1 },
                },
                { sort: { _id: 1 }, returnDocument: 'after' },
            );
            if (!doc) break;
            claimed.push({
                id: doc._id.toHexString(),
                queue: doc.queue,
                name: doc.name,
                payload: JSON.parse(doc.payload),
                attempts: doc.attempts,
                maxAttempts: doc.max_attempts,
                lockToken: token,
            });
        }
        return claimed;
    }

    complete(id: string, token: string): Promise<boolean> {
        const filter = this.guard(id, token);
        if (!filter) return Promise.resolve(false);
        if (this.removeOnComplete) {
            return this.col.deleteOne(filter).then((r) => r.deletedCount === 1);
        }
        return this.col
            .updateOne(filter, { $set: { status: 'completed', locked_until: null, lock_token: null, updated_at: new Date() } })
            .then((r) => r.matchedCount === 1);
    }

    retry(id: string, token: string, delaySeconds: number, error: string): Promise<boolean> {
        const filter = this.guard(id, token);
        if (!filter) return Promise.resolve(false);
        const now = new Date();
        return this.col
            .updateOne(filter, {
                $set: {
                    status: 'pending',
                    locked_until: null,
                    lock_token: null,
                    last_error: error,
                    available_at: new Date(now.getTime() + delaySeconds * 1000),
                    updated_at: now,
                },
            })
            .then((r) => r.matchedCount === 1);
    }

    fail(id: string, token: string, error: string): Promise<boolean> {
        const filter = this.guard(id, token);
        if (!filter) return Promise.resolve(false);
        return this.col
            .updateOne(filter, {
                $set: { status: 'failed', locked_until: null, lock_token: null, last_error: error, updated_at: new Date() },
            })
            .then((r) => r.matchedCount === 1);
    }

    release(id: string, token: string): Promise<boolean> {
        const filter = this.guard(id, token);
        if (!filter) return Promise.resolve(false);
        return this.col
            .updateOne(filter, {
                $set: { status: 'pending', locked_until: null, lock_token: null, updated_at: new Date() },
                $inc: { attempts: -1 },
            })
            .then((r) => r.matchedCount === 1);
    }

    async recoverExpired(): Promise<number> {
        const now = new Date();
        const failed = await this.col.updateMany(
            { status: 'processing', locked_until: { $lt: now }, $expr: { $gte: ['$attempts', '$max_attempts'] } },
            {
                $set: {
                    status: 'failed',
                    locked_until: null,
                    lock_token: null,
                    last_error: 'Lease kedaluwarsa dan percobaan habis',
                    updated_at: now,
                },
            },
        );
        const requeued = await this.col.updateMany(
            { status: 'processing', locked_until: { $lt: now }, $expr: { $lt: ['$attempts', '$max_attempts'] } },
            { $set: { status: 'pending', locked_until: null, lock_token: null, updated_at: now } },
        );
        return failed.modifiedCount + requeued.modifiedCount;
    }

    async hasActive(name: string): Promise<boolean> {
        const found = await this.col.countDocuments({ name, status: { $in: ['pending', 'processing'] } });
        return found > 0;
    }

    async close(): Promise<void> {
        await this.client.close();
    }

    private guard(id: string, token: string): Filter<JobDoc> | null {
        if (!ObjectId.isValid(id)) return null;
        return { _id: new ObjectId(id), lock_token: token, status: 'processing' };
    }
}
