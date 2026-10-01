import { PoolOptions } from 'mysql2';
import { Job, JobClass, DispatchOptions } from './core/job.js';
import { MysqlDriver } from './drivers/mysql/mysql-driver.js';
import { Registry } from './core/registry.js';
import { Queue, setDefaultQueue, getDefaultQueue } from './core/queue.js';
import { Worker } from './worker/worker.js';
import { hostname } from 'node:os';

export interface AldarethConfigOptions {
    prefix?: string;
    removeOnComplete?: boolean;
}

export interface AldarethConfig {
    connection: PoolOptions;
    jobs: JobClass[];
    opts?: AldarethConfigOptions;
}

export const defineConfig = (c: AldarethConfig) => c;

export function createAldareth(config: AldarethConfig) {
    const driver = new MysqlDriver(config.connection, { prefix: config.opts?.prefix, removeOnComplete: config.opts?.removeOnComplete });
    const registry = new Registry();
    config.jobs.forEach((j) => registry.register(j));
    const queue = new Queue(driver);
    setDefaultQueue(queue);

    async function work(
        opts: {
            stopWhenEmpty?: boolean;
            maxTime?: number;
            maxJobs?: number;
            queues?: string[];
        } = {},
    ) {
        const maxTime = opts.maxTime ?? 50;
        const worker = new Worker(driver, registry, {
            queues: opts.queues ?? ['default'],
            maxTimeMs: maxTime * 1000,
            maxJobs: opts.maxJobs,
            stopWhenEmpty: opts.stopWhenEmpty ?? false,
            pollMs: 1000,
            leaseSeconds: maxTime + 60,
            workerId: `${hostname()}:${process.pid}`,
        });
        const result = await worker.run();
        if (result.timedOut) process.exitCode = 1;
        return result;
    }
    return { queue, registry, driver, work };
}

export { Job, Queue, Registry, MysqlDriver, getDefaultQueue };
export type { JobClass, DispatchOptions };
export type { QueueDriver, ClaimedJob, NewJob } from './drivers/driver.js';
export { Worker, type WorkerOptions, type WorkerResult } from './worker/worker.js';
export { consoleReporter, type Reporter, type WorkerEvent } from './worker/reporter.js';
