import { expect, it, vi } from 'vitest';
import { Job, Queue, type QueueDriver } from '../src/index.js';

class NoopJob extends Job<{ n: number }> {
    static jobName = 'noop';

    async handle() {}
}

const driver = { push: async () => 'id-1' } as unknown as QueueDriver;
const tick = () => new Promise((r) => setImmediate(r));

it('dispatch tanpa await -> warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new Queue(driver).dispatch(NoopJob, { n: 1 });
    await tick();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not awaited'));
    warn.mockRestore();
});

it('dispatch yang di-await -> tidak ada warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(new Queue(driver).dispatch(NoopJob, { n: 1 })).resolves.toBe('id-1');
    await tick();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
});