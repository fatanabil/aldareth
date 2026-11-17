import { assertValidCron } from './cron.js';

/** A schedulable job: a job class (JobClass) or any object exposing `jobName` + `dispatch`. */
export interface ScheduleableJob<TData = unknown> {
    jobName: string;
    dispatch(data: TData, opts?: import('../core/job.js').DispatchOptions): Promise<unknown>;
}

/** An inline handler that runs inside the scheduler process (no queue, no retry). */
export interface ScheduleableHandler<TData = unknown> {
    jobName: string;
    handle(data: TData): Promise<unknown>;
}

export type ScheduleableTask = ScheduleableJob | ScheduleableHandler;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class ScheduleTask {
    private expr?: string;
    private tz: string;
    private _name: string;
    private _noOverlap: boolean = false;

    constructor(
        readonly task: ScheduleableTask,
        readonly data: unknown,
        defaultTz: string,
    ) {
        this._name = task.jobName;
        this.tz = defaultTz;
    }

    isHandler(): this is ScheduleTask & { task: ScheduleableHandler } {
        return 'handle' in this.task;
    }

    cron(expr: string) {
        this.expr = expr;
        return this;
    }
    everyMinute() {
        return this.cron('* * * * *');
    }
    everyMinutes(n: number) {
        if (![1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30].includes(n)) throw new Error(`everyMinutes(${n}) is invalid.`);
        return this.cron(`*/${n} * * * *`);
    }
    everyFiveMinutes() {
        return this.everyMinutes(5);
    }
    hourlyAt(minute = 0) {
        if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('Minute must be in the 0-59 range.');
        return this.cron(`${minute} * * * *`);
    }
    dailyAt(time: string) {
        const [h, m] = this.parse(time);
        return this.cron(`${m} ${h} * * *`);
    }
    weeklyOn(day: 0 | 1 | 2 | 3 | 4 | 5 | 6, time = '00:00') {
        const [h, m] = this.parse(time);
        return this.cron(`${m} ${h} * * ${day}`);
    }
    monthlyOn(day: number, time = '00:00') {
        if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error(`monthlyOn(${day}) is invalid: day must be in the 1-28 range.`);
        const [h, m] = this.parse(time);
        return this.cron(`${m} ${h} ${day} * *`);
    }
    monthlyOnLastDate(time = '00:00') {
        const [h, m] = this.parse(time);
        return this.cron(`${m} ${h} L * *`);
    }
    timezone(tz: string) {
        this.tz = tz;
        return this;
    }
    name(n: string) {
        this._name = n;
        return this;
    }
    withoutOverlapping() {
        // Inline handlers run inside this process and are awaited one by one, so
        // there is nothing to guard against. Only queued jobs can overlap across workers.
        if (this.isHandler()) {
            throw new Error('withoutOverlapping() is only valid for queued jobs, not for inline handlers.');
        }
        this._noOverlap = true;
        return this;
    }
    finalize() {
        if (!this.expr) throw new Error(`Task ${this._name} has no frequency yet.`);
        assertValidCron(this.expr, this.tz);
        return { name: this._name, expr: this.expr, tz: this.tz, noOverlap: this._noOverlap, isHandler: this.isHandler() };
    }
    private parse(t: string): [number, number] {
        const m = TIME.exec(t);
        if (!m) throw new Error('Time format must be HH:mm.');
        return [Number(m[1]), Number(m[2])];
    }
}
