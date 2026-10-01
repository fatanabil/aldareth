export type WorkerEvent =
    | { type: 'worker:start'; workerId: string; queues: string[] }
    | { type: 'worker:stop'; processed: number; timedOut: boolean }
    | { type: 'job:start'; id: string; name: string; attempt: number; maxAttempts: number }
    | { type: 'job:done'; id: string; name: string; ms: number }
    | { type: 'job:retry'; id: string; name: string; ms: number; error: string; delaySeconds: number; attempt: number; maxAttempts: number }
    | { type: 'job:fail'; id: string; name: string; ms: number; error: string }
    | { type: 'job:defer'; id: string; name: string }
    | { type: 'job:lease-lost'; id: string; name: string };

export type Reporter = (event: WorkerEvent) => void;

const WIDTH = 80;
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const paint = (code: number, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const pad = (n: number) => String(n).padStart(2, '0');

function timestamp(): string {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function row(name: string, status: string, color: number, ms?: number, extra = ''): void {
    const left = `${timestamp()} ${name} `;
    const right = `${ms !== undefined ? `${ms}ms ` : ''}${status}${extra}`;
    const dots = '.'.repeat(Math.max(3, WIDTH - left.length - right.length - 1));
    console.log(`${left}${paint(90, dots)} ${ms !== undefined ? `${ms}ms ` : ''}${paint(color, status)}${extra}`);
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').slice(0, 200);

export const consoleReporter: Reporter = (e) => {
    switch (e.type) {
        case 'worker:start':
            console.log(`[aldareth] worker ${e.workerId} mulai (queue: ${e.queues.join(',')})`);
            break;
        case 'worker:stop':
            console.log(`[aldareth] worker berhenti, ${e.processed} job diproses${e.timedOut ? ' (ada timeout)' : ''}`);
            break;
        case 'job:start':
            row(e.name, 'RUNNING', 33);
            break;
        case 'job:done':
            row(e.name, 'DONE', 32, e.ms);
            break;
        case 'job:retry':
            row(e.name, 'RETRY', 33, e.ms, ` ${e.attempt}/${e.maxAttempts} (${e.delaySeconds}s)`);
            console.log(`   └ ${oneLine(e.error)}`);
            break;
        case 'job:fail':
            row(e.name, 'FAIL', 31, e.ms);
            console.log(`   └ ${oneLine(e.error)}`);
            break;
        case 'job:defer':
            row(e.name, 'DEFERRED', 36);
            break;
        case 'job:lease-lost':
            row(e.name, 'LEASE LOST', 31);
            break;
    }
};
