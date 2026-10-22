#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { AldarethConfig, createAldareth, Worker, Schedule, consoleScheduleReporter, resolveDriver, type QueueDriver, type Registry } from '../index.js';
import { MysqlDriver } from '../drivers/mysql/mysql-driver.js';
import { MongoDriver } from '../drivers/mongodb/mongodb-driver.js';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { hostname } from 'node:os';

let tsLoader: Promise<boolean> | undefined;

function buildDriver(uri: string, prefix?: string) {
    return resolveDriver(uri) === 'mongodb' ? new MongoDriver(uri, { prefix }) : new MysqlDriver(uri, { prefix });
}

// .env dari working directory; variabel yang sudah ada di environment tidak ditimpa
function loadDotEnv() {
    if (typeof process.loadEnvFile !== 'function') return; // Node < 20.12
    try {
        process.loadEnvFile();
    } catch {
        // tidak ada .env — variabel bisa datang dari shell
    }
}

// Node tidak bisa meng-import .ts tanpa loader; tsx biasanya sudah ada di project TS,
// jadi daftarkan hook-nya di sini alih-alih memaksa pengguna memanggil `node --import tsx`.
// tsx dicari dari project pengguna: kalau aldareth di-link ke app, resolusi dari file CLI
// hanya akan menyusuri node_modules package aldareth sendiri.
function loadTsLoader(): Promise<boolean> {
    tsLoader ??= (async () => {
        try {
            const { register } = createRequire(path.join(process.cwd(), 'package.json'))('tsx/esm/api') as { register: () => void };
            register();
            return true;
        } catch {
            return false;
        }
    })();
    return tsLoader;
}

// Modul CJS hasil transpile: mod.default adalah module.exports, jadi `export default` ada satu level di bawahnya.
// `any` di sini karena ini batas dengan modul pengguna yang belum bertipe.
function moduleExport(mod: any): any {
    const exp = mod.default as { __esModule?: boolean; default?: unknown } | undefined;
    if (exp && typeof exp === 'object' && exp.__esModule && 'default' in exp) return exp.default;
    return mod.default;
}

async function main() {
    loadDotEnv();
    const [command, ...rest] = process.argv.slice(2);
    const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
            'stop-when-empty': { type: 'boolean', default: false },
            once: { type: 'boolean', default: false },
            'max-time': { type: 'string', default: '50' },
            'max-jobs': { type: 'string' },
            queue: { type: 'string', default: 'default' },
            module: { type: 'string' },
            dir: { type: 'string' },
        },
    });

    const maxTimeSec = Number(values['max-time']);

    switch (command) {
        case 'migrate': {
            const uri = process.env.ALDARETH_DB_URL;
            if (!uri) {
                console.error('[aldareth] ALDARETH_DB_URL is required');
                process.exit(1);
            }
            const driver = buildDriver(uri, process.env.ALDARETH_PREFIX);
            await driver.migrate();
            await driver.close();
            console.log('[aldareth] migration completed');
            return;
        }
        case 'schedule:run': {
            let schedule: Schedule;

            try {
                const schedulePath = values.module ?? process.env.ALDARETH_MODULE ?? 'src/aldareth.ts';
                if (/\.m?tsx?$/.test(schedulePath) && !(await loadTsLoader())) {
                    throw new Error(`'${schedulePath}' is TypeScript and no loader was found. Install tsx, or point --module to the compiled .js.`);
                }
                const url = pathToFileURL(path.resolve(process.cwd(), schedulePath)).href;
                const mod = await import(url);

                const exported = moduleExport(mod);
                if (exported instanceof Schedule) {
                    schedule = exported;
                } else {
                    throw new Error(`Module '${schedulePath}' must export a Schedule instance as default export`);
                }

                // If schedule has no event handler, use console reporter
                if (!schedule.opts?.onEvent) {
                    schedule.opts = { ...schedule.opts, onEvent: consoleScheduleReporter };
                }
            } catch (err) {
                console.error(`[aldareth] failed to load schedule module:`, err instanceof Error ? err.message : err);
                process.exit(1);
            }

            if (values.once) {
                const result = await schedule.run();
                console.log(`[aldareth] ${result.dispatched} dispatched, ${result.failed} failed`);
                process.exit(result.failed > 0 ? 1 : 0);
            }

            console.log('[aldareth] scheduler started, press Ctrl+C to stop');

            // Run once immediately, then loop every minute
            await schedule.run();

            const intervalMs = 60_000;
            let running = true;
            const stop = () => {
                running = false;
            };
            process.on('SIGINT', stop);
            process.on('SIGTERM', stop);

            while (running) {
                await new Promise(resolve => setTimeout(resolve, intervalMs));
                if (!running) break;
                try {
                    await schedule.run();
                } catch (err) {
                    console.error('[aldareth] schedule run error:', err instanceof Error ? err.message : err);
                }
            }

            console.log('[aldareth] scheduler stopped');
            return;
        }
        case 'queue:work': {
            // Load user's aldareth module — expected to export AldarethConfig or createAldareth result
            let registry: Registry;
            let driver: QueueDriver;
            try {
                const modulePath = values.module ?? process.env.ALDARETH_MODULE ?? 'src/aldareth.ts';
                if (/\.m?tsx?$/.test(modulePath) && !(await loadTsLoader())) {
                    throw new Error(`'${modulePath}' is TypeScript and no loader was found. Install tsx, or point --module to the compiled .js.`);
                }
                const url = pathToFileURL(path.resolve(process.cwd(), modulePath)).href;
                const mod = await import(url);

                const exported = moduleExport(mod);
                if (exported && typeof exported === 'object' && 'queue' in exported) {
                    // Module exported createAldareth() result — driver sudah menyelesaikan config dari env
                    ({ registry, driver } = exported);
                } else if (exported && typeof exported === 'object' && 'jobs' in exported) {
                    // Module exported AldarethConfig
                    ({ registry, driver } = createAldareth(exported as AldarethConfig));
                } else {
                    throw new Error(`Module '${modulePath}' must export an AldarethConfig or createAldareth result`);
                }
            } catch (err) {
                console.error(`[aldareth] failed to load module:`, err instanceof Error ? err.message : err);
                process.exit(1);
            }

            const worker = new Worker(driver, registry, buildWorkerOpts(values, maxTimeSec));
            const result = await worker.run();
            console.log(`[aldareth] completed, ${result.processed} job processed`);
            process.exit(result.timedOut ? 1 : 0);
        }
        default:
            console.error(`Command unknown: ${command ?? '(blank)'}`);
            console.error('available: init, migrate, queue:work, schedule:run');
            process.exit(1);
    }
}

function buildWorkerOpts(values: Record<string, unknown>, maxTimeSec: number) {
    return {
        queues: String(values.queue).split(','),
        maxTimeMs: maxTimeSec * 1000,
        maxJobs: values['max-jobs'] ? Number(values['max-jobs']) : undefined,
        stopWhenEmpty: Boolean(values['stop-when-empty']),
        pollMs: 1000,
        leaseSeconds: maxTimeSec + 60,
        workerId: `${hostname()}:${process.pid}`,
    };
}

main().catch((err) => {
    console.error('[aldareth] fatal error:', err);
    process.exit(1);
});