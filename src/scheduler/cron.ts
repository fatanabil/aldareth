import { Cron } from 'croner';

export function assertValidCron(expr: string, tz: string): void {
    if (expr.trim().split(/\s+/).length !== 5) throw new Error(`Cron expression invalid.`);
    const c = new Cron(expr, { timezone: tz });
    if (c.nextRun(new Date()) === null) throw new Error(`Cron expression not match: ${expr}`);
}

export function assertValidTimezone(tz: string): void {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch (error) {
        throw new Error(`Timezone invalid: ${tz}`);
    }
}

export function isDue(expr: string, minute: Date, tz: string): boolean {
    const next = new Cron(expr, { timezone: tz }).nextRun(new Date(minute.getTime() - 1));
    return next !== null && next.getTime() === minute.getTime();
}
