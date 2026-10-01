import { QueueDriver } from '../drivers/driver.js';
import { DispatchOptions, Job, JobClass } from './job.js';

let defaultQueue: Queue | undefined;
export const setDefaultQueue = (q: Queue) => {
    defaultQueue = q;
};
export function getDefaultQueue(): Queue {
    if (!defaultQueue) throw new Error('Aldareth not config yet, call createAldareth() first');
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
