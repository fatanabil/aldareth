import { getDefaultQueue } from './queue.js';

export type JobClass<J extends Job<any> = Job<any>> = (new () => J) & { jobName: string };

export interface DispatchOptions {
    delay?: number; // detik
    queue?: string;
}

export abstract class Job<TData = unknown> {
    static jobName: string;

    tries = 3;
    backoff: number[] = [10, 60, 300];
    timeout?: number;
    queue = 'default';

    data!: TData;
    attempt = 0;

    abstract handle(): Promise<void>;
    failed?(error: Error): Promise<void> | void;

    static dispatch<J extends Job<any>>(this: JobClass<J>, data: J['data'], opts: DispatchOptions = {}): Promise<string> {
        return getDefaultQueue().dispatch(this, data, opts);
    }
}
