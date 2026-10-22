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

export class Queue {
    constructor(private driver: QueueDriver) {}

    async dispatch<J extends Job<any>>(cls: JobClass<J>, data: J['data'], opts: DispatchOptions = {}): Promise<string> {
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
