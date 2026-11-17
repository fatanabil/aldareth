import { JobClass } from './job.js';

export class Registry {
    private map = new Map<string, JobClass>();

    register(cls: JobClass): void {
        if (!cls.jobName) throw new Error('Job must have a static jobName.');
        if (this.map.has(cls.jobName)) throw new Error(`Duplicate job name: ${cls.jobName}`);
        this.map.set(cls.jobName, cls);
    }

    resolve(name: string): JobClass | undefined {
        return this.map.get(name);
    }
}
