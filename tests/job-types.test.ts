import { expect, it } from 'vitest';
import { Job, type JobClass, type Queue } from '../src/index.js';

interface EmailPayload {
    to: string;
    subject: string;
}

class SendEmailJob extends Job<EmailPayload> {
    static jobName = 'send-email';

    async handle() {
        console.log(this.data.to);
    }
}

it('payload job memakai generic dari developer', () => {
    const job = new SendEmailJob();
    job.data = { to: 'user@example.com', subject: 'Hello' };
    expect(job.data.subject).toBe('Hello');
});

it('payload harus lengkap saat dispatch', () => {
    // @ts-expect-error `subject` wajib ada
    const wrong: SendEmailJob['data'] = { to: 'user@example.com' };
    expect(wrong).toBeTruthy();
});

it('job dengan payload generik tetap bisa didaftarkan', () => {
    const cls: JobClass = SendEmailJob;
    expect(cls.jobName).toBe('send-email');
});

it('dispatch menerima payload sesuai generic', () => {
    const dispatch = (queue: Queue) => queue.dispatch(SendEmailJob, { to: 'user@example.com', subject: 'Hello' });
    expect(typeof dispatch).toBe('function');
});
