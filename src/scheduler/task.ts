import { assertValidCron } from './cron.js';

export interface ScheduleableJob {
    jobName: string;
    dispatch(data: any, opts?: any): Promise<unknown>;
}

export interface ScheduleableHandler {
    jobName: string;
    handle(data: unknown): Promise<unknown>;
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
        if (![1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30].includes(n)) throw new Error(`everyMinutes(${n}) invalid.`);
        return this.cron(`*/${n} * * * *`);
    }
    everyFiveMinutes() {
        return this.everyMinutes(5);
    }
    hourlyAt(minute = 0) {
        if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error(`Minutes value must be in range 0 - 59`);
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
        if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error(`monthlyOn(${day}) invalid day, must be in 1-28 range`);
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
        this._noOverlap = true;
        return this;
    }
    finalize() {
        if (!this.expr) throw new Error(`Task ${this._name} didnt has frequency yet`);
        assertValidCron(this.expr, this.tz);
        return { name: this._name, expr: this.expr, tz: this.tz, noOverlap: this._noOverlap, isHandler: this.isHandler() };
    }
    private parse(t: string): [number, number] {
        const m = TIME.exec(t);
        if (!m) throw new Error(`Time format must be HH:mm.`);
        return [Number(m[1]), Number(m[2])];
    }
}
