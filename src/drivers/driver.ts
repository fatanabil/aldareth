export interface NewJob {
    queue: string;
    name: string;
    payload: string;
    maxAttempts: number;
    delaySeconds: number;
}

export interface ClaimedJob {
    id: string;
    queue: string;
    name: string;
    payload: unknown;
    attempts: number;
    maxAttempts: number;
    lockToken: string;
}

export interface QueueDriver {
    migrate?(): Promise<void>;
    push(job: NewJob): Promise<string>;
    claim(opts: { queues: string[]; limit: number; workerId: string; leaseSeconds: number }): Promise<ClaimedJob[]>;
    complete(id: string, token: string): Promise<boolean>;
    retry(id: string, token: string, delaySeconds: number, error: string): Promise<boolean>;
    fail(id: string, token: string, error: string): Promise<boolean>;
    release(id: string, token: string): Promise<boolean>;
    recoverExpired(): Promise<number>;
    hasActive(name: string): Promise<boolean>;
    close(): Promise<void>;
}
