import { Cron } from 'croner';

export function assertValidTimezone(tz: string): void {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
        throw new Error(`Invalid timezone: ${tz}`);
    }
}

export function assertValidCron(expr: string, tz: string): void {
    if (expr.trim().split(/\s+/).length !== 5) throw new Error('Invalid cron expression: expected 5 fields.');
    assertValidTimezone(tz);
    const c = new Cron(expr, { timezone: tz });
    if (c.nextRun(new Date()) === null) throw new Error(`Invalid cron expression: ${expr}`);
}

export function isDue(expr: string, minute: Date, tz: string): boolean {
    const next = new Cron(expr, { timezone: tz }).nextRun(new Date(minute.getTime() - 1));
    return next !== null && next.getTime() === minute.getTime();
}
