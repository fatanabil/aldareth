# Aldareth

A reliable job queue and scheduler for Node.js, powered by MySQL.

## Features

- **Reliable job processing** — Jobs are persisted in MySQL and survive restarts
- **Automatic retries** — Configurable retry attempts with exponential backoff
- **Lease-based locking** — Prevents duplicate processing across multiple workers
- **Timeout handling** — Per-job timeouts with automatic retry on timeout
- **Delayed jobs** — Schedule jobs to run after a delay
- **Multi-queue support** — Organize jobs into different queues with priority
- **Graceful shutdown** — Workers finish in-progress jobs before stopping
- **Event reporting** — Hook into worker lifecycle events
- **Cron-based scheduler** — Schedule jobs with cron expressions and timezone support

## Requirements

- Node.js >= 20
- MySQL 5.7+ or MySQL 8.0+

## Installation

```bash
npm install aldareth
```

## Quick Start

### 1. Configure environment variables

```bash
# .env
ALDARETH_HOST=127.0.0.1
ALDARETH_PORT=3306
ALDARETH_USER=root
ALDARETH_PASSWORD=secret
ALDARETH_DATABASE=aldareth
```

### 2. Define jobs and aldareth config

```javascript
// src/aldareth.ts
import { createAldareth } from 'aldareth';
import { SendEmailJob } from './jobs/send-email.js';

export default createAldareth({
    jobs: [SendEmailJob],
    opts: {
        prefix: 'aldareth_', // Optional, default: 'aldareth_'
    },
});
```

```javascript
// src/jobs/send-email.ts
import { Job } from 'aldareth';

export class SendEmailJob extends Job {
    static jobName = 'send-email';

    tries = 3;
    backoff = [5, 30, 120]; // Retry after 5s, 30s, then 120s
    timeout = 30; // 30 second timeout
    queue = 'emails'; // Target queue

    async handle() {
        console.log('Sending email to:', this.data.to);
        // await sendEmail(this.data);
    }

    failed(error) {
        console.error('Email failed permanently:', error.message);
    }
}
```

### 3. Dispatch jobs

```javascript
import { getDefaultQueue } from 'aldareth';

const queue = getDefaultQueue();

// Simple dispatch
await SendEmailJob.dispatch({ to: 'user@example.com', subject: 'Hello' });

// With options
await queue.dispatch(SendEmailJob, { to: 'user@example.com' }, {
    delay: 60, // Delay in seconds before job is available
    queue: 'high-priority',
});
```

### 4. Run migrations

```bash
npx aldareth migrate
```

### 5. Start workers

```bash
# Simple worker
npx aldareth queue:work

# With options
npx aldareth queue:work --queue emails,notifications --max-time 300 --stop-when-empty

# Run scheduler
npx aldareth schedule:run
```

## Environment Variables

| Variable           | Description                          | Default     |
| ------------------ | ----------------------------------- | ----------- |
| `ALDARETH_HOST`    | MySQL host                          | `127.0.0.1` |
| `ALDARETH_PORT`    | MySQL port                          | `3306`      |
| `ALDARETH_USER`    | MySQL user                          | -           |
| `ALDARETH_PASSWORD`| MySQL password                      | -           |
| `ALDARETH_DATABASE`| MySQL database                      | -           |
| `ALDARETH_SOCKET`  | MySQL socket path                   | -           |
| `ALDARETH_PREFIX`  | Table prefix (e.g. `aldareth_`)    | `aldareth_` |
| `ALDARETH_MODULE`  | Path to aldareth config module       | `src/aldareth.ts` |

## CLI Commands

| Command | Description |
| ------- | ----------- |
| `migrate` | Run database migrations |
| `queue:work` | Start a queue worker |
| `schedule:run` | Start the scheduler (polls every 60s) |

### CLI Options

**`queue:work` options:**

| Option | Description | Default |
| ------ | ----------- | ------- |
| `--queue` | Queue names (comma-separated) | `default` |
| `--max-time` | Max runtime in seconds | `50` |
| `--max-jobs` | Max jobs to process before exiting | - |
| `--stop-when-empty` | Exit when queue is empty | `false` |

**`schedule:run` options:**

| Option | Description | Default |
| ------ | ----------- | ------- |
| `--module` | Path to aldareth config module | `src/aldareth.ts` |

## Configuration

### `AldarethConfig`

| Option       | Type                    | Required | Default |
| ------------ | ----------------------- | -------- | ------- |
| `connection` | `PoolOptions`           | Auto     | env     |
| `jobs`       | `JobClass[]`            | Yes      | -       |
| `opts`       | `AldarethConfigOptions` | No       | `{}`    |
| `schedule`   | `Schedule \| string \| fn` | No   | -       |

> **Note:** `connection` is automatically populated from environment variables. You only need to specify `jobs` and optionally `opts`.

### `AldarethConfigOptions`

| Option | Type      | Default       | Description                         |
| ------ | --------- | ------------- | ----------------------------------- |
| `prefix` | `string` | `'aldareth_'` | Table prefix for namespacing        |
| `removeOnComplete` | `boolean` | `true`        | Remove completed jobs automatically |

### `ScheduleOptions`

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `timezone` | `string` | `'UTC'` | Default timezone for tasks |
| `hasActive` | `fn` | - | Check if queue has active jobs (required for `withoutOverlapping`) |
| `onEvent` | `fn` | `consoleScheduleReporter` | Event reporter |

### Job Properties

| Property  | Type       | Default         | Description               |
| --------- | ---------- | --------------- | ------------------------- |
| `jobName` | `string`   | (required)      | Unique job identifier     |
| `tries`   | `number`   | `3`             | Max retry attempts        |
| `backoff` | `number[]` | `[10, 60, 300]` | Backoff delays in seconds |
| `timeout` | `number`   | -               | Job timeout in seconds    |
| `queue`   | `string`   | `'default'`     | Target queue name         |

### WorkerOptions

| Option          | Type       | Default              | Description                    |
| --------------- | ---------- | -------------------- | ------------------------------ |
| `queues`        | `string[]` | `['default']`        | Queues to listen on            |
| `maxTimeMs`     | `number`   | `50000`              | Max runtime in milliseconds    |
| `maxJobs`       | `number`   | -                    | Max jobs before exiting        |
| `stopWhenEmpty` | `boolean`  | `false`              | Exit when all queues are empty |
| `pollMs`        | `number`   | `1000`               | Poll interval in milliseconds   |
| `leaseSeconds`  | `number`   | `maxTime + 60`       | Job lock duration              |
| `graceMs`       | `number`   | `5000`               | Grace period before hard stop  |
| `workerId`      | `string`   | `${hostname}:${pid}` | Unique worker identifier       |
| `reporter`      | `Reporter` | `consoleReporter`    | Event reporter                 |

## Scheduler

The scheduler lets you run jobs on a cron-based schedule with timezone support.

### Defining a Schedule

```typescript
// src/aldareth.ts
import { createAldareth } from 'aldareth';
import { SendReportJob } from './jobs/send-report.js';
import { Schedule } from 'aldareth';

const schedule = new Schedule();
schedule.job(SendReportJob).dailyAt('08:00').timezone('Asia/Jakarta');
schedule.fn(
    { jobName: 'cleanup', handle: async () => { /* cleanup logic */ } },
).everyFiveMinutes();

export default createAldareth({
    jobs: [SendReportJob],
    schedule,
});
```

### Scheduling Methods

| Method | Cron Equivalent | Description |
| ------ | --------------- | ----------- |
| `everyMinute()` | `* * * * *` | Run every minute |
| `everyMinutes(n)` | `*/n * * * *` | Run every n minutes (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30) |
| `everyFiveMinutes()` | `*/5 * * * *` | Run every 5 minutes |
| `hourlyAt(minute)` | `${minute} * * * *` | Run at specific minute past every hour |
| `dailyAt(time)` | `${m} ${h} * * *` | Run daily at HH:MM (e.g. `08:00`) |
| `weeklyOn(day, time)` | `${m} ${h} * * ${day}` | Run weekly on day (0=Sun..6=Sat) |
| `monthlyOn(day, time)` | `${m} ${h} ${day} * *` | Run monthly on day 1-28 |
| `monthlyOnLastDate(time)` | `${m} ${h} L * *` | Run monthly on the last day of the month |

### Scheduler Options

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `timezone` | `string` | `'UTC'` | Default timezone for tasks |
| `hasActive` | `(name) => Promise<boolean>` | - | Check if a queue has active jobs (for `withoutOverlapping`) |
| `onEvent` | `(event) => void` | `consoleScheduleReporter` | Event reporter |

### Task Options

| Method | Description |
| ------ | ----------- |
| `timezone(tz)` | Override timezone for this task |
| `withoutOverlapping()` | Skip run if previous job is still active/pending |
| `name(n)` | Custom name for the task (defaults to `jobName`) |

### Running the Scheduler

```bash
# Run scheduler (polls every 60 seconds)
npx aldareth schedule:run

# With custom module path
npx aldareth schedule:run --module src/scheduler.ts
```

### Programmatic Usage

```typescript
import { scheduleRun } from 'aldareth';

// Run schedule once or in a loop
await scheduleRun(schedule, {
    intervalMs: 60_000, // default: 60s
    onEvent: (event) => {
        if (event.type === 'schedule:dispatched') {
            console.log(`${event.task} dispatched`);
        } else if (event.type === 'schedule:skipped-overlap') {
            console.log(`${event.task} skipped — still active`);
        } else if (event.type === 'schedule:error') {
            console.error(`${event.task} failed:`, event.error);
        }
    },
});
```

### Scheduler Events

| Event | Description |
| ----- | ----------- |
| `schedule:dispatched` | Task was dispatched |
| `schedule:skipped-overlap` | Task skipped because `withoutOverlapping` returned true |
| `schedule:error` | Task handler threw an error |

## Event Reporting

Implement a custom `Reporter` to hook into worker lifecycle events:

```typescript
import type { Reporter, WorkerEvent } from 'aldareth';

const myReporter: Reporter = {
    on(event: WorkerEvent, data: unknown) {
        switch (event) {
            case 'worker:start':
                console.log('Worker started');
                break;
            case 'job:start':
                console.log('Processing job:', data);
                break;
            case 'job:done':
                console.log('Job completed:', data);
                break;
            case 'job:retry':
                console.log('Job retry:', data);
                break;
            case 'job:fail':
                console.log('Job failed:', data);
                break;
            case 'job:defer':
                console.log('Job deferred (past deadline):', data);
                break;
            case 'job:lease-lost':
                console.log('Job lease lost:', data);
                break;
            case 'worker:stop':
                console.log('Worker stopped');
                break;
        }
    },
};
```

## Database Schema

Aldareth uses a single table with the following structure:

```sql
CREATE TABLE aldareth_jobs (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    queue         VARCHAR(100) DEFAULT 'default',
    name          VARCHAR(150) NOT NULL,
    payload       LONGTEXT,
    status        VARCHAR(20),
    attempts      INT UNSIGNED,
    max_attempts  INT UNSIGNED,
    available_at  DATETIME,
    locked_until  DATETIME,
    locked_by     VARCHAR(100),
    lock_token    CHAR(36),
    last_error    TEXT,
    created_at    DATETIME,
    updated_at    DATETIME
);
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│    Queue    │────▶│    MySQL    │
│  (dispatch) │     │  (enqueue)  │     │  (persist)  │
└─────────────┘     └─────────────┘     └─────────────┘
                                                │
                                                ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Worker    │◀────│   Registry  │◀────│  Job Class  │
│  (process)  │     │  (resolve)  │     │  (handler)  │
└─────────────┘     └─────────────┘     └─────────────┘
```

- **MysqlDriver** — Persists jobs to MySQL
- **Registry** — Maps job names to job classes
- **Queue** — Enqueues jobs via the driver
- **Worker** — Polls for pending jobs, claims them with a lease, and processes them
- **Schedule** — Manages cron-based scheduled dispatching of jobs
- **Cron** — Evaluates cron expressions with timezone awareness (via `croner`)

## License

ISC
