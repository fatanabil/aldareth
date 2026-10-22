import { QueueDriver } from '../drivers/driver.js';
import { createDriver } from '../drivers/resolve.js';
import { DispatchOptions, Job, JobClass } from './job.js';

let defaultQueue: Queue | undefined;
export const setDefaultQueue = (q: Queue) => {
    defaultQueue = q;
};
export function getDefaultQueue(): Queue {
    // static dispatch hanya butuh driver, jadi queue dibangun dari env — tanpa config module pun jalan
    defaultQueue ??= new Queue(createDriver());
    return defaultQueue;
}

const MAX_PAYLOAD_BYTES = 64 * 1024;

// `await` pada Promise asli memakai slot internal, jadi hasil dispatch yang dibuang tidak terlihat.
// Thenable membuat pemanggilnya bisa diamati: apa pun yang menangani hasil ini memanggil salah satu method di bawah.
function mustAwait<T>(promise: Promise<T>): Promise<T> {
    let handled = false;
    const tracked = {
        then(onFulfilled: any, onRejected: any) {
            handled = true;
            return promise.then(onFulfilled, onRejected);
        },
        catch(onRejected: any) {
            handled = true;
            return promise.catch(onRejected);
        },
        finally(onFinally: any) {
            handled = true;
            return promise.finally(onFinally);
        },
    };
    setImmediate(() => {
        if (!handled) console.warn('[aldareth] dispatch() result was not awaited — the job may never be enqueued.');
    });
    return tracked as unknown as Promise<T>;
}

export class Queue {
    constructor(private driver: QueueDriver) {}

    dispatch<J extends Job<any>>(cls: JobClass<J>, data: J['data'], opts: DispatchOptions = {}): Promise<string> {
        return mustAwait(this.send(cls, data, opts));
    }

    private async send<J extends Job<any>>(cls: JobClass<J>, data: J['data'], opts: DispatchOptions): Promise<string> {
        const probe = new cls();
        const payload = JSON.stringify(data ?? null);
        if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) {
            throw new Error('Payload exceed max size!');
        }
        return this.driver.push({
            queue: opts.queue ?? probe.queue,
            name: cls.jobName,
            payload,
            maxAttempts: probe.tries,
            delaySeconds: opts.delay ?? 0,
        });
    }
}
