import type { ClaimedJob, QueueDriver } from '../drivers/driver.js';
import type { Registry } from '../core/registry.js';
import { consoleReporter, type Reporter } from './reporter.js';

export interface WorkerOptions {
    queues: string[];
    maxTimeMs: number;
    maxJobs?: number;
    stopWhenEmpty: boolean;
    pollMs: number;
    leaseSeconds: number;
    graceMs?: number;
    workerId: string;
    reporter?: Reporter;
}

export interface WorkerResult {
    processed: number;
    timedOut: boolean;
}

class JobTimeoutError extends Error {}
type Outcome = 'done' | 'timeout' | 'deferred';

const MIN_START_MS = 1000;

export class Worker {
    private emit: Reporter;

    constructor(
        private driver: QueueDriver,
        private registry: Registry,
        private opts: WorkerOptions,
    ) {
        this.emit = opts.reporter ?? consoleReporter;
    }

    async run(): Promise<WorkerResult> {
        const graceMs = this.opts.graceMs ?? 5000;
        if (graceMs >= this.opts.maxTimeMs) {
            throw new Error(`graceMs (${graceMs}) must be less than maxTimeMs (${this.opts.maxTimeMs})`);
        }

        const deadline = Date.now() + this.opts.maxTimeMs;
        const claimUntil = deadline - graceMs;
        let processed = 0;
        let timedOut = false;

        this.emit({ type: 'worker:start', workerId: this.opts.workerId, queues: this.opts.queues });
        try {
            await this.driver.recoverExpired();
            while (!timedOut && Date.now() < deadline) {
                if (this.opts.maxJobs !== undefined && processed >= this.opts.maxJobs) break;
                const [claimed] = await this.driver.claim({
                    queues: this.opts.queues,
                    limit: 1,
                    workerId: this.opts.workerId,
                    leaseSeconds: this.opts.leaseSeconds,
                });
                if (!claimed) {
                    if (this.opts.stopWhenEmpty) break;
                    await sleep(Math.min(this.opts.pollMs, Math.max(0, deadline - Date.now())));
                    continue;
                }
                const outcome = await this.process(claimed, deadline);
                if (outcome === 'deferred') break;
                if (outcome === 'timeout') timedOut = true;
                processed++;
            }
        } finally {
            await this.driver.close();
            this.emit({ type: 'worker:stop', processed, timedOut });
        }
        return { processed, timedOut };
    }

    private async process(claimed: ClaimedJob, deadline: number): Promise<Outcome> {
        const { id, name, lockToken } = claimed;
        const cls = this.registry.resolve(name);

        if (!cls) {
            const error = `Handler tidak terdaftar: ${name}`;
            this.emit({ type: 'job:fail', id, name, ms: 0, error });
            await this.settle(this.driver.fail(id, lockToken, error), id, name);
            return 'done';
        }

        const job = new cls();
        job.data = claimed.payload;
        job.attempt = claimed.attempts;

        const declaredMs = job.timeout !== undefined ? job.timeout * 1000 : undefined;

        if (declaredMs !== undefined && (declaredMs > this.opts.maxTimeMs || job.timeout! + 5 > this.opts.leaseSeconds)) {
            const error = 'Timeout job melebihi max-time atau lease worker';
            this.emit({ type: 'job:fail', id, name, ms: 0, error });
            await this.settle(this.driver.fail(id, lockToken, error), id, name);
            return 'done';
        }

        const remainingMs = deadline - Date.now();
        if ((declaredMs !== undefined && remainingMs < declaredMs) || remainingMs < MIN_START_MS) {
            this.emit({ type: 'job:defer', id, name });
            await this.settle(this.driver.release(id, lockToken), id, name);
            return 'deferred';
        }

        const effectiveMs = Math.min(declaredMs ?? remainingMs, remainingMs);
        this.emit({ type: 'job:start', id, name, attempt: claimed.attempts, maxAttempts: claimed.maxAttempts });
        const t0 = Date.now();

        try {
            await withTimeout(job.handle(), effectiveMs);
            if (await this.settle(this.driver.complete(id, lockToken), id, name)) {
                this.emit({ type: 'job:done', id, name, ms: Date.now() - t0 });
            }
            return 'done';
        } catch (err) {
            const ms = Date.now() - t0;
            const error = err instanceof Error ? err : new Error(String(err));

            if (claimed.attempts >= claimed.maxAttempts) {
                if (await this.settle(this.driver.fail(id, lockToken, error.message), id, name)) {
                    this.emit({ type: 'job:fail', id, name, ms, error: error.message });
                }
                try {
                    await job.failed?.(error);
                } catch (e) {
                    console.error(`[aldareth] hook failed() error pada job ${id}`, e);
                }
            } else {
                const delaySeconds = job.backoff[claimed.attempts - 1] ?? job.backoff.at(-1) ?? 60;
                if (await this.settle(this.driver.retry(id, lockToken, delaySeconds, error.message), id, name)) {
                    this.emit({
                        type: 'job:retry',
                        id,
                        name,
                        ms,
                        error: error.message,
                        delaySeconds,
                        attempt: claimed.attempts,
                        maxAttempts: claimed.maxAttempts,
                    });
                }
            }
            return error instanceof JobTimeoutError ? 'timeout' : 'done';
        }
    }

    /** true jika status berhasil diubah; false jika lease sudah hilang */
    private async settle(op: Promise<boolean>, id: string, name: string): Promise<boolean> {
        const ok = await op;
        if (!ok) this.emit({ type: 'job:lease-lost', id, name });
        return ok;
    }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new JobTimeoutError(`Timeout setelah ${ms}ms`)), ms);
        p.then(
            (v) => {
                clearTimeout(t);
                resolve(v);
            },
            (e) => {
                clearTimeout(t);
                reject(e);
            },
        );
    });
}
