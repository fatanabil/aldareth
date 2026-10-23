# Aldareth

A job queue and cron scheduler for Node.js, backed by MySQL or MongoDB.

Jobs are plain classes. Your app pushes them into the database, a worker process runs
them. The database is the source of truth — if a worker dies, its jobs come back.

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Jobs](#jobs)
- [Worker](#worker)
- [Scheduler](#scheduler)
- [CLI](#cli)
- [Production](#production)
- [MongoDB](#mongodb)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Requirements

- Node.js >= 20. CommonJS apps can `require()` it too, on Node >= 20.19 / 22.12
- MySQL 5.7+ (default) or MongoDB 5.0+

## Installation

```bash
npm install aldareth
```

## Quick start

### 1. Scaffold the files

```bash
npx aldareth init
```

This writes `src/aldareth.ts` (the config module), `src/worker.ts`, `src/schedule.ts`,
`src/run-schedule.ts`, a `.env` with a placeholder connection, and three npm scripts
(`aldareth:migrate`, `aldareth:worker`, `aldareth:schedule`).
Nothing that already exists is overwritten, so it is safe to run twice.

It asks where the files should go — press Enter to keep `src`:

```
Folder for the Aldareth files [src]:
```

Answer it upfront instead with `--dir`:

```bash
npx aldareth init --dir=app/queue
```

```
src/aldareth.ts        # the job classes — the worker needs them to run jobs by name
src/worker.ts          # worker process entry
src/schedule.ts        # the Schedule instance
src/run-schedule.ts    # scheduler process entry
.env                   # ALDARETH_DB_URL
package.json           # migrate, worker, schedule
```

Install the TypeScript runner it points at:

```bash
npm install --save-dev tsx
```

### 2. Point it at your database

```bash
# .env
ALDARETH_DB_URL=mysql://root:secret@127.0.0.1:3306/aldareth
```

### 3. Write a job

A job is a class with a unique name and a `handle()` method.

```ts
// src/jobs/send-email.ts
import { Job } from 'aldareth';

export class SendEmailJob extends Job {
    static jobName = 'send-email';

    async handle() {
        console.log('Sending email to:', this.data.to);
        // await sendEmail(this.data);
    }
}
```

### 4. Register it

```ts
// src/aldareth.ts
import { createAldareth } from 'aldareth';
import { SendEmailJob } from './jobs/send-email.js';

export default createAldareth({
    jobs: [SendEmailJob],
});
```

### 5. Create the queue storage

```bash
npm run aldareth:migrate
```

Once per database, before the first worker. It creates the table (MySQL) or the indexes
(MongoDB).

### 6. Dispatch from your app, run a worker

```ts
import { SendEmailJob } from './jobs/send-email.js';

await SendEmailJob.dispatch({ to: 'user@example.com', subject: 'Hello' });
```

```bash
npm run aldareth:worker
```

The worker picks the job up, runs `handle()`, and removes it when it is done.

## Configuration

Everything is resolved from the environment first, and from the config module second.

| Setting             | Environment      | In code                     | Default         |
| ------------------- | ---------------- | --------------------------- | --------------- |
| Connection          | `ALDARETH_DB_URL` | `connection`                | required        |
| Driver              | `ALDARETH_DRIVER` | `driver`                    | from the URI    |
| Table/collection    | `ALDARETH_PREFIX` | `opts.prefix`               | `aldareth_`     |
| Delete finished jobs | —                | `opts.removeOnComplete`     | `true`          |
| Job classes         | —                | `jobs`                      | required        |

- The driver is `mysql` or `mongodb`; the URI scheme decides when `ALDARETH_DRIVER` is unset.
- The environment wins over a URI written in code, so one build can be pointed at another
  database by changing the env alone. The exception is a MySQL `PoolOptions` object — it
  carries options a URI cannot express (`ssl`, `socketPath`), so it is always used as-is.
- A URI whose scheme does not match the driver is rejected on startup.

Both the CLI and the library load `.env` from the working directory when `ALDARETH_DB_URL`
is not already set. The file never overrides an existing variable, so a production
environment always wins. Set `ALDARETH_NO_DOTENV=1` to turn the file off.

```ts
import { createAldareth, defineConfig } from 'aldareth';

// defineConfig is optional — it only keeps the type without an explicit annotation
export default defineConfig({ jobs: [SendEmailJob] });
```

## Jobs

| Property  | Type       | Default         | Description                           |
| --------- | ---------- | --------------- | ------------------------------------- |
| `jobName` | `string`   | (required)      | Unique identifier of the job class    |
| `tries`   | `number`   | `3`             | Attempts before the job fails         |
| `backoff` | `number[]` | `[10, 60, 300]` | Seconds to wait before each retry     |
| `timeout` | `number`   | —               | Seconds before the attempt is aborted |
| `queue`   | `string`   | `'default'`     | Queue the job is dispatched to        |

`failed(error)` is optional and runs only when the job has failed for good, not on every
retry.

Worth knowing:

- `jobName` must be unique across all registered jobs — registering it twice throws.
- Payload data has to be JSON-serializable, and is capped at 64 KB.
- Job classes are instantiated to read `queue` and `tries`, so keep the constructor
  argument-free and free of side effects.
- A timeout counts as a failed attempt, so the job is retried like any other error.

### Typed payloads

Give the job a type parameter and the payload is checked where you dispatch it.

```ts
interface EmailPayload {
    to: string;
    subject: string;
}

export class SendEmailJob extends Job<EmailPayload> {
    static jobName = 'send-email';

    async handle() {
        await sendEmail(this.data.to, this.data.subject);
    }
}
```

```ts
SendEmailJob.dispatch({ to: 'user@example.com', subject: 'Hello' }); // ok
SendEmailJob.dispatch({ to: 'user@example.com' });                    // error: subject is missing
```

This is a compile-time guarantee only — the payload is stored as JSON, so nothing validates
it again when a worker picks the job up. A job without a type parameter takes `unknown`.

### Dispatching

```ts
import { getDefaultQueue } from 'aldareth';
import { ReportJob } from './jobs/report.js';

// through the class
await ReportJob.dispatch({ month: 3 });

// through the queue, with options
await getDefaultQueue().dispatch(ReportJob, { month: 3 }, { delay: 30, queue: 'reports' });
```

| Option  | Type     | Description                       |
| ------- | -------- | --------------------------------- |
| `delay` | `number` | Seconds until the job becomes due |
| `queue` | `string` | Queue to put the job in           |

`Job.dispatch()` builds its queue from the environment on first use — no `createAldareth()`
call and no import needed. Without `ALDARETH_DB_URL` it throws `Koneksi database belum
diatur`.

Always `await` the dispatch. If the result is dropped, Aldareth prints a `dispatch() result
was not awaited` warning: the request can finish before the job is enqueued.

## Worker

A worker claims jobs, runs them, and settles the outcome. The entry point written by
`init` starts one:

```ts
// src/worker.ts
import aldareth from './aldareth.js';

aldareth.work({ stopWhenEmpty: true, maxTime: 55 }).catch((err) => {
    console.error(err);
    process.exit(1);
});
```

| Option           | Type       | Default              | Description                            |
| ---------------- | ---------- | -------------------- | -------------------------------------- |
| `stopWhenEmpty`  | `boolean`  | `false`              | Exit as soon as the queues are empty   |
| `maxTime`        | `number`   | `50`                 | Max runtime in seconds                 |
| `maxJobs`        | `number`   | —                    | Stop after this many jobs              |
| `queues`         | `string[]` | `['default']`        | Queues to listen on                    |

The worker exits by itself when it is done — as soon as the queues are empty, or when
`maxTime` is up. Whatever starts your processes (a process manager, a cron entry, your dev
loop) can start it again.

To attach a custom reporter, build the worker yourself:

```ts
import { Worker } from 'aldareth';
import aldareth from './aldareth.js';

const worker = new Worker(aldareth.driver, aldareth.registry, {
    queues: ['default'],
    maxTimeMs: 50_000,
    leaseSeconds: 110,
    workerId: 'worker-1',
    reporter,
});

const result = await worker.run();
```

| Option          | Type       | Default              | Description                                  |
| --------------- | ---------- | -------------------- | -------------------------------------------- |
| `queues`        | `string[]` | `['default']`        | Queues to listen on                          |
| `maxTimeMs`     | `number`   | `50000`              | Max runtime in milliseconds                  |
| `maxJobs`       | `number`   | —                    | Max jobs before exiting                      |
| `stopWhenEmpty` | `boolean`  | `false`              | Exit when all queues are empty               |
| `pollMs`        | `number`   | `1000`               | Poll interval in milliseconds                |
| `leaseSeconds`  | `number`   | `maxTime + 60`       | How long a claimed job stays locked          |
| `graceMs`       | `number`   | `5000`               | Time reserved for the running job at the end |
| `workerId`      | `string`   | `${hostname}:${pid}` | Unique worker identifier                     |
| `reporter`      | `Reporter` | `consoleReporter`    | Event reporter                               |

`graceMs` has to be smaller than `maxTimeMs`, and a job's `timeout` has to fit in both
`maxTimeMs` and `leaseSeconds` — otherwise the job is rejected as failed instead of
retried. A few seconds before the deadline the worker stops claiming new jobs and lets the
running one finish.

### Worker events

A reporter is a function that receives one event object.

```ts
import type { Reporter } from 'aldareth';

const reporter: Reporter = (event) => {
    if (event.type === 'job:fail') {
        console.error(`job ${event.name} failed: ${event.error}`);
    }
};
```

| Event            | Payload                                                   | Meaning                                          |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------ |
| `worker:start`   | `workerId`, `queues`                                      | The worker started                               |
| `job:start`      | `id`, `name`, `attempt`, `maxAttempts`                    | A job was claimed and is being handled           |
| `job:done`       | `id`, `name`, `ms`                                        | A job finished successfully                      |
| `job:retry`      | `id`, `name`, `ms`, `error`, `delaySeconds`, `attempt`, `maxAttempts` | A job failed and will be retried     |
| `job:fail`       | `id`, `name`, `ms`, `error`                               | A job failed for good                            |
| `job:defer`      | `id`, `name`                                              | Put back — not enough time left in this run      |
| `job:lease-lost` | `id`, `name`                                              | Another worker took over the job                 |
| `worker:stop`    | `processed`, `timedOut`                                   | The worker stopped                               |

## Scheduler

The scheduler dispatches jobs on a cron expression. It uses the same queue, so it is a
separate process that imports the config module.

```ts
// src/schedule.ts
import { Schedule } from 'aldareth';
import aldareth from './aldareth.js';
import { SendReportJob } from './jobs/send-report.js';

const schedule = new Schedule({
    timezone: 'Asia/Jakarta',
    hasActive: (jobName) => aldareth.driver.hasActive(jobName),
});

schedule.job(SendReportJob).dailyAt('08:00');
schedule.fn({ jobName: 'cleanup', handle: async () => { /* ... */ } }).everyFiveMinutes();

export default schedule;
```

Run it from the entry point written by `init`:

```ts
// src/run-schedule.ts
import { scheduleRun } from 'aldareth';
import schedule from './schedule.js';

// once: dispatch whatever is due this minute, then return
scheduleRun(schedule, { once: true }).then(() => process.exit(0));
```

| Option       | Type              | Default                  | Description                         |
| ------------ | ----------------- | ------------------------ | ----------------------------------- |
| `intervalMs` | `number`          | `60000`                  | How often to re-check the tasks    |
| `onEvent`    | `(event) => void` | `consoleScheduleReporter` | Event reporter                     |
| `once`       | `boolean`         | `false`                  | Run the due tasks, then return     |

Without `once` the same call loops forever, checking the tasks every minute. With `once` it
runs a single pass — the mode for hosts where only cron is available. The explicit
`process.exit()` in the snippet is needed because the queue keeps its connection pool open.

The same options work on `aldareth.scheduleRun()`, which resolves the schedule from the
config module instead of taking an instance.

### Frequency

| Method                     | Cron equivalent    | Description                            |
| -------------------------- | ------------------ | -------------------------------------- |
| `everyMinute()`            | `* * * * *`        | Run every minute                       |
| `everyMinutes(n)`          | `*/n * * * *`       | Run every n minutes (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30) |
| `everyFiveMinutes()`       | `*/5 * * * *`       | Run every five minutes                 |
| `hourlyAt(minute)`         | `${m} * * * *`      | Minute past the hour (0–59)            |
| `dailyAt(time)`            | `${m} ${h} * * *`   | Daily at `HH:MM`                       |
| `weeklyOn(day, time)`      | `${m} ${h} * * ${d}` | Weekly on a day (0 = Sunday)         |
| `monthlyOn(day, time)`     | `${m} ${h} ${d} * *` | Monthly on a day (1–28)              |
| `monthlyOnLastDate(time)`  | `${m} ${h} L * *`   | Last day of the month                 |

### Task and schedule options

| Option on a task   | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `timezone(tz)`     | Timezone for this task                               |
| `withoutOverlapping()` | Skip the run while the previous job is still active |
| `name(n)`          | Name used in reports (defaults to `jobName`)         |

| Option on a schedule | Type                            | Default                  | Description                        |
| -------------------- | ------------------------------- | ------------------------ | ---------------------------------- |
| `timezone`           | `string`                        | `'UTC'`                  | Default timezone for tasks         |
| `hasActive`          | `(jobName) => Promise<boolean>` | —                        | Required by `withoutOverlapping()` |
| `onEvent`            | `(event) => void`               | `consoleScheduleReporter` | Event reporter                    |

`withoutOverlapping()` asks the database whether a job with that name is still pending or
running; without `hasActive` the schedule throws when the task is defined.

### Schedule events

| Event                      | Payload         | Meaning                                     |
| -------------------------- | --------------- | ------------------------------------------- |
| `schedule:dispatched`      | `task`          | The task was dispatched                     |
| `schedule:skipped-overlap` | `task`          | Skipped — the previous run is still active  |
| `schedule:error`           | `task`, `error` | The task handler threw                      |

One failing task does not stop the others.

## CLI

```bash
npx aldareth init           # scaffold the files and the npm scripts
npx aldareth migrate        # create/verify the queue storage
npx aldareth queue:work     # start a worker
npx aldareth schedule:run   # start the scheduler
```

`init` never overwrites anything; it asks for the target folder and `--dir` answers it
without a prompt (default `src`). `migrate` reads only the environment. The other two
commands load a module — `--module` or `ALDARETH_MODULE`, default `src/aldareth.ts`,
resolved against the working directory. A TypeScript module works if `tsx` is installed in
your project; the CLI registers it for you. A module compiled to CommonJS works too — the
default export is unwrapped for you.

- `queue:work` expects a `createAldareth()` result (has a `queue` key) or a plain
  `AldarethConfig` (has a `jobs` key) — the config module from [step 4](#quick-start).
- `schedule:run` expects a `Schedule` instance, so in the layout above it needs
  `--module src/schedule.ts`.

### `queue:work`

| Option              | Description                          | Default           |
| ------------------- | ------------------------------------ | ----------------- |
| `--queue`           | Queues to listen on (comma-separated) | `default`         |
| `--max-time`        | Max runtime in seconds               | `50`              |
| `--max-jobs`        | Stop after this many jobs            | —                 |
| `--stop-when-empty` | Exit once every queue is empty       | `false`           |
| `--module`          | Path to the config module            | `src/aldareth.ts` |

```bash
npx aldareth queue:work --queue emails,notifications --max-time 300 --stop-when-empty
```

### `schedule:run`

| Option     | Description                                    | Default           |
| ---------- | ---------------------------------------------- | ----------------- |
| `--module` | Path to the schedule module                    | `src/aldareth.ts` |
| `--once`   | Dispatch the due tasks for this minute, then exit | `false`          |

## Production

Run the worker and the scheduler as separate processes — they do different things and
scale differently. Both are plain scripts in `package.json`:

```json
{
    "scripts": {
        "migrate": "aldareth migrate",
        "worker": "tsx src/worker.ts",
        "schedule": "tsx src/run-schedule.ts"
    }
}
```

Build first and run the compiled files in production — no TypeScript loader involved:

```json
{
    "scripts": {
        "aldareth:migrate": "aldareth migrate",
        "aldareth:worker": "node dist/worker.js",
        "aldareth:schedule": "node dist/run-schedule.js"
    }
}
```

```bash
npm run aldareth:migrate    # once per database
npm run aldareth:worker     # as many as you like
npm run aldareth:schedule   # exactly one, or accept duplicate cron triggers
```

- Workers coordinate through the database, so several of them can run at the same time
  without processing a job twice.
- A worker that is killed mid-job does not lose the job: it stays locked until its lease
  expires (`maxTime + 60` seconds) and the next worker picks it up again.
- Keep the same environment variables for every process — the worker, the scheduler and
  `migrate` all read the same database.

## MongoDB

```bash
# .env
ALDARETH_DB_URL=mongodb://127.0.0.1:27017/aldareth
npm run aldareth:migrate
```

`migrate` creates the indexes the queue needs — there is no schema to apply. The URI has to
name the database, and may carry credentials and options
(`mongodb://user:pass@host/db?retryWrites=true`). Jobs live in one collection named
`<prefix>jobs` (default `aldareth_jobs`) with the same fields as the MySQL table. A
standalone `mongod` is enough — no replica set, no transactions.

## Troubleshooting

| Message / symptom                                   | Cause                                                  | Fix                                                        |
| --------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `Koneksi database belum diatur`                     | No `ALDARETH_DB_URL` in the env and no `.env` in the cwd | Set the env var, or put it in `<cwd>/.env`                  |
| `dispatch() result was not awaited`                 | The dispatch result was dropped                         | `await Job.dispatch(...)`, or add a `.catch(...)`           |
| `[aldareth] ALDARETH_DB_URL is required`            | `migrate` ran without a connection                      | Set the env var for the process                            |
| `MySQL URI harus dimulai dengan mysql://`           | The URI scheme does not match the driver               | Use a `mysql://` URI, or set `ALDARETH_DRIVER=mysql`        |
| `MongoDB URI harus dimulai dengan mongodb://`       | The URI scheme does not match the driver               | Use a `mongodb://` URI, or set `ALDARETH_DRIVER=mongodb`    |
| `ALDARETH_DRIVER tidak dikenal`                    | The driver name is not `mysql` or `mongodb`             | Use one of the two names                                   |
| `Timeout job melebihi max-time atau lease worker`   | The job's `timeout` is longer than the worker's limits  | Lower the job timeout or raise `maxTime`                   |
| `Table 'aldareth_jobs' doesn't exist`               | The migration was never run                            | Run `npm run aldareth:migrate`                             |
| Jobs stay `processing` after a crash                | The worker died before releasing the job               | The lease expires and another worker picks the job up      |
| `withoutOverlapping() needs hasActive`              | The schedule has no `hasActive`                        | Supply `hasActive` when creating the `Schedule`            |

## Development

```bash
npm install
npm run build      # compile to dist/
npm run dev        # compile in watch mode
npm run typecheck
npm test           # npx vitest run tests/scheduler.test.ts for one file
```

The driver tests need a live MySQL and a live MongoDB. The scheduler, config and queue
tests run without any database.

## License

ISC