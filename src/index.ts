import { PoolOptions } from 'mysql2';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Job, JobClass, DispatchOptions } from './core/job.js';
import { MysqlDriver } from './drivers/mysql/mysql-driver.js';
import { createDriver, driverFromUri, resolveDriver } from './drivers/resolve.js';
import { Registry } from './core/registry.js';
import { Queue, setDefaultQueue, getDefaultQueue } from './core/queue.js';
import { Worker } from './worker/worker.js';
import { Schedule, consoleScheduleReporter, type ScheduleEvent, type ScheduleOptions } from './scheduler/schedule.js';
import { hostname } from 'node:os';

export interface AldarethConfigOptions {
    prefix?: string;
    removeOnComplete?: boolean;
}

export type ScheduleConfig =
    | Schedule
    | string
    | ((schedule: Schedule) => void);

export type DriverKind = 'mysql' | 'mongodb';

export interface AldarethConfig {
    /** Connection URI: mysql://user:pass@host:3306/db or mongodb://host:27017/db. PoolOptions is also accepted for MySQL. ALDARETH_DB_URL takes precedence over a URI. */
    connection?: string | PoolOptions;
    /** Driver to use. ALDARETH_DRIVER takes precedence; otherwise it follows the URI scheme. */
    driver?: DriverKind;
    jobs: JobClass[];
    opts?: AldarethConfigOptions;
    schedule?: ScheduleConfig;
}

export interface ScheduleRunOptions {
    intervalMs?: number;
    onEvent?: (e: ScheduleEvent) => void;
    /** Run the tasks due for this minute, then return — for cron-driven hosts. */
    once?: boolean;
}

export const defineConfig = (c: AldarethConfig) => c;

export { driverFromUri, resolveDriver };

async function resolveSchedule(config: ScheduleConfig | undefined): Promise<Schedule | undefined> {
    if (!config) return undefined;

    if (config instanceof Schedule) return config;

    if (typeof config === 'string') {
        const url = pathToFileURL(path.resolve(process.cwd(), config)).href;
        const mod = await import(url);
        if (mod.default instanceof Schedule) return mod.default;
        throw new Error(`Module '${config}' must export a Schedule instance`);
    }

    // callback function
    const schedule = new Schedule();
    config(schedule);
    return schedule;
}

export function createAldareth(config: AldarethConfig) {
    const driver = createDriver(config);
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

    let _schedule: Schedule | undefined;
    let _scheduleResolved = false;

    async function scheduleRun(opts: ScheduleRunOptions = {}) {
        if (!_scheduleResolved) {
            _schedule = await resolveSchedule(config.schedule);
            _scheduleResolved = true;
        }
        if (!_schedule) throw new Error('No schedule configured');

        if (opts.onEvent || !_schedule.opts.onEvent) {
            _schedule.opts = {
                ..._schedule.opts,
                onEvent: opts.onEvent ?? consoleScheduleReporter,
            };
        }

        // Run once immediately
        await _schedule.run();
        if (opts.once) return;

        const intervalMs = opts.intervalMs ?? 60_000;
        let running = true;
        const stop = () => { running = false; };

        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);

        while (running) {
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
            if (!running) break;
            await _schedule!.run();
        }

        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
    }

    return { queue, registry, driver, work, scheduleRun };
}

export async function scheduleRun(schedule: Schedule, opts: ScheduleRunOptions = {}) {
    if (opts.onEvent || !schedule.opts.onEvent) {
        schedule.opts = { ...schedule.opts, onEvent: opts.onEvent ?? consoleScheduleReporter };
    }

    // Run once immediately
    await schedule.run();
    if (opts.once) return;

    const intervalMs = opts.intervalMs ?? 60_000;
    let running = true;
    const stop = () => {
        running = false;
    };

    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    while (running) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        if (!running) break;
        await schedule.run();
    }

    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
}

export { Job, Queue, Registry, MysqlDriver, getDefaultQueue };
export type { JobClass, DispatchOptions };
export { MongoDriver, type MongoDriverOptions } from './drivers/mongodb/mongodb-driver.js';
export type { QueueDriver, ClaimedJob, NewJob } from './drivers/driver.js';
export { Worker, type WorkerOptions, type WorkerResult } from './worker/worker.js';
export { consoleReporter, type Reporter, type WorkerEvent } from './worker/reporter.js';
export { Schedule, consoleScheduleReporter, type ScheduleOptions, type ScheduleEvent } from './scheduler/schedule.js';
export { type ScheduleableJob, type ScheduleableHandler, type ScheduleTask } from './scheduler/task.js';
