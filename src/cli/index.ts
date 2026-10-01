#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { AldarethConfig, createAldareth, Worker } from '../index.js';
import { MysqlDriver } from '../drivers/mysql/mysql-driver.js';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { hostname } from 'node:os';

function buildConnection() {
    return {
        host: process.env.ALDARETH_HOST ?? '127.0.0.1',
        port: process.env.ALDARETH_PORT ? Number(process.env.ALDARETH_PORT) : undefined,
        user: process.env.ALDARETH_USER,
        password: process.env.ALDARETH_PASSWORD,
        database: process.env.ALDARETH_DATABASE,
        charset: process.env.ALDARETH_CHARSET,
        socketPath: process.env.ALDARETH_SOCKET,
    };
}

async function main() {
    const [command, ...rest] = process.argv.slice(2);
    const { values } = parseArgs({
        args: rest,
        options: {
            'stop-when-empty': { type: 'boolean', default: false },
            'max-time': { type: 'string', default: '50' },
            'max-jobs': { type: 'string' },
            queue: { type: 'string', default: 'default' },
            module: { type: 'string' },
        },
    });

    const modulePath = values.module ?? process.env.ALDARETH_MODULE ?? 'src/aldareth.ts';
    const maxTimeSec = Number(values['max-time']);

    switch (command) {
        case 'migrate': {
            const connection = buildConnection();
            const prefix = process.env.ALDARETH_PREFIX;
            const driver = new MysqlDriver(connection, { prefix });
            await driver.migrate();
            await driver.close();
            console.log('[aldareth] migration completed');
            return;
        }
        case 'queue:work': {
            // Load user's aldareth module — expected to export AldarethConfig or createAldareth result
            let config: AldarethConfig;
            try {
                const url = pathToFileURL(path.resolve(process.cwd(), modulePath)).href;
                const mod = await import(url);

                if (mod.default && typeof mod.default === 'object' && 'queue' in mod.default) {
                    // Module exported createAldareth() result — re-create with env connection
                    const { registry } = mod.default;
                    const connection = buildConnection();
                    const prefix = process.env.ALDARETH_PREFIX;
                    const driver = new MysqlDriver(connection, { prefix });
                    const worker = new Worker(driver, registry, buildWorkerOpts(values, maxTimeSec));
                    const result = await worker.run();
                    console.log(`[aldareth] completed, ${result.processed} job processed`);
                    process.exit(result.timedOut ? 1 : 0);
                } else if (mod.default && typeof mod.default === 'object' && 'connection' in mod.default) {
                    // Module exported AldarethConfig
                    config = mod.default as AldarethConfig;
                } else {
                    throw new Error(`Module '${modulePath}' must export an AldarethConfig or createAldareth result`);
                }
            } catch (err) {
                console.error(`[aldareth] failed to load module '${modulePath}':`, err instanceof Error ? err.message : err);
                process.exit(1);
            }

            // Merge env connection into config (CLI overrides file connection)
            config.connection = { ...config.connection, ...buildConnection() };

            const { driver, registry } = createAldareth(config);
            const worker = new Worker(driver, registry, buildWorkerOpts(values, maxTimeSec));
            const result = await worker.run();
            console.log(`[aldareth] completed, ${result.processed} job processed`);
            process.exit(result.timedOut ? 1 : 0);
        }
        default:
            console.error(`Command unknown: ${command ?? '(blank)'}`);
            console.error('available: migrate, queue:work');
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
