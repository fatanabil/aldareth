import { isDue } from './cron.js';
import { ScheduleableJob, ScheduleableHandler, ScheduleTask } from './task.js';
import type { Job } from '../core/job.js';

export type ScheduleEvent =
    | { type: 'schedule:dispatched'; task: string }
    | { type: 'schedule:ran'; task: string }
    | { type: 'schedule:skipped-overlap'; task: string }
    | { type: 'schedule:error'; task: string; error: unknown };

export interface ScheduleOptions {
    timezone?: string;
    hasActive?: (jobName: string) => Promise<boolean>;
    onEvent?: (e: ScheduleEvent) => void;
}

export class Schedule {
    private tasks: ScheduleTask[] = [];
    constructor(public opts: ScheduleOptions = {}) {}

    /** Schedule a queued job: it is dispatched to the queue and run by a worker (retry, timeout, lease). */
    job<TData>(task: ScheduleableJob<TData>, data: TData) {
        const t = new ScheduleTask(task, data, this.opts.timezone ?? 'UTC');
        this.tasks.push(t);
        return t;
    }

    /** Schedule an inline handler: it runs inside the scheduler process, without retry or timeout. */
    fn<TData>(task: ScheduleableHandler<TData>, data: TData) {
        const t = new ScheduleTask(task, data, this.opts.timezone ?? 'UTC');
        this.tasks.push(t);
        return t;
    }

    async run(now: Date = new Date()): Promise<{ due: number; dispatched: number; ran: number; failed: number }> {
        const defs = this.tasks.map((t) => ({ t, ...t.finalize() }));
        if (defs.some((d) => d.noOverlap) && !this.opts.hasActive) throw new Error('withoutOverlapping() requires hasActive in the schedule options.');

        const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
        const emit = this.opts.onEvent ?? (() => {});
        let due = 0,
            dispatched = 0,
            ran = 0,
            failed = 0;

        for (const d of defs) {
            try {
                if (!isDue(d.expr, minute, d.tz)) continue;
                due++;
                if (d.noOverlap && (await this.opts.hasActive!(d.t.task.jobName))) {
                    emit({ type: 'schedule:skipped-overlap', task: d.name });
                    continue;
                }
                if (d.isHandler) {
                    await (d.t.task as ScheduleableHandler).handle(d.t.data);
                    ran++;
                    emit({ type: 'schedule:ran', task: d.name });
                } else {
                    await (d.t.task as ScheduleableJob).dispatch(d.t.data as never);
                    dispatched++;
                    emit({ type: 'schedule:dispatched', task: d.name });
                }
            } catch (error) {
                failed++;
                emit({ type: 'schedule:error', task: d.name, error });
            }
        }
        return { due, dispatched, ran, failed };
    }
}

export function consoleScheduleReporter(e: ScheduleEvent) {
    const ts = new Date().toISOString();
    if (e.type === 'schedule:dispatched') console.log(`${ts} ${e.task} ... DISPATCHED`);
    else if (e.type === 'schedule:ran') console.log(`${ts} ${e.task} ... RAN`);
    else if (e.type === 'schedule:skipped-overlap') console.log(`${ts} ${e.task} ... SKIPPED (still active)`);
    else console.error(`${ts} ${e.task} ... ERROR ${String((e.error as Error)?.message ?? e.error).split('\n')[0]}`);
}
