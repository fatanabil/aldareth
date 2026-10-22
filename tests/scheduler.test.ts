// test/scheduler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { isDue } from '../src/scheduler/cron.js';
import { Schedule } from '../src/scheduler/schedule.js';

const at = (iso: string) => new Date(iso);

describe('isDue', () => {
    it('dailyAt 08:00 Asia/Jakarta = 01:00 UTC', () => {
        expect(isDue('0 8 * * *', at('2026-10-02T01:00:00Z'), 'Asia/Jakarta')).toBe(true);
        expect(isDue('0 8 * * *', at('2026-10-02T08:00:00Z'), 'Asia/Jakarta')).toBe(false);
        expect(isDue('0 8 * * *', at('2026-10-02T01:01:00Z'), 'Asia/Jakarta')).toBe(false);
    });
    it('pergantian hari UTC vs Jakarta: 00:30 Jakarta = 17:30 UTC hari sebelumnya', () => {
        expect(isDue('30 0 * * *', at('2026-10-01T17:30:00Z'), 'Asia/Jakarta')).toBe(true);
    });
    it('*/5', () => {
        expect(isDue('*/5 * * * *', at('2026-10-02T10:15:00Z'), 'UTC')).toBe(true);
        expect(isDue('*/5 * * * *', at('2026-10-02T10:16:00Z'), 'UTC')).toBe(false);
    });
    it('mingguan: 2026-10-02 adalah Jumat (5)', () => {
        expect(isDue('0 9 * * 5', at('2026-10-02T09:00:00Z'), 'UTC')).toBe(true);
        expect(isDue('0 9 * * 4', at('2026-10-02T09:00:00Z'), 'UTC')).toBe(false);
    });
});

const fakeJob = (name = 'fake') => ({ jobName: name, dispatch: vi.fn().mockResolvedValue(1) });

describe('Schedule.run', () => {
    it('hanya mengirim task yang due', async () => {
        const a = fakeJob('a'),
            b = fakeJob('b');
        const s = new Schedule();
        s.job(a).everyFiveMinutes();
        s.job(b).dailyAt('08:00').timezone('Asia/Jakarta');
        const r = await s.run(at('2026-10-02T10:15:30Z'));
        expect(r).toEqual({ due: 1, dispatched: 1, failed: 0 });
        expect(a.dispatch).toHaveBeenCalledOnce();
        expect(b.dispatch).not.toHaveBeenCalled();
    });
    it('task tanpa frekuensi gagal keras, tidak ada yang terkirim', async () => {
        const a = fakeJob();
        const s = new Schedule();
        s.job(a);
        await expect(s.run()).rejects.toThrow(/frequency/);
        expect(a.dispatch).not.toHaveBeenCalled();
    });
    it('satu task gagal tidak menghentikan yang lain', async () => {
        const bad = { jobName: 'bad', dispatch: vi.fn().mockRejectedValue(new Error('x')) };
        const ok = fakeJob('ok');
        const s = new Schedule();
        s.job(bad).everyMinute();
        s.job(ok).everyMinute();
        expect(await s.run()).toMatchObject({ dispatched: 1, failed: 1 });
    });
    it('withoutOverlapping melewati jika masih aktif', async () => {
        const a = fakeJob();
        const s = new Schedule({ hasActive: async () => true });
        s.job(a).everyMinute().withoutOverlapping();
        expect(await s.run()).toMatchObject({ due: 1, dispatched: 0 });
    });
    it('withoutOverlapping tanpa hasActive ditolak', async () => {
        const s = new Schedule();
        s.job(fakeJob()).everyMinute().withoutOverlapping();
        await expect(s.run()).rejects.toThrow(/hasActive/);
    });
    it('ekspresi dan timezone invalid ditolak', async () => {
        const s = new Schedule();
        s.job(fakeJob()).cron('bukan cron');
        await expect(s.run()).rejects.toThrow();
        const s2 = new Schedule();
        s2.job(fakeJob()).everyMinute().timezone('Bukan/Zona');
        await expect(s2.run()).rejects.toThrow();
    });
});
