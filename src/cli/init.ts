import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';

const FILES: Record<string, string> = {
    'aldareth.ts': `import { createAldareth } from 'aldareth';

// The worker resolves jobs by name, so every job class has to be listed here.
export default createAldareth({
    jobs: [
        // ExampleJob,
    ],
});
`,
    'worker.ts': `import aldareth from './aldareth.js';

aldareth
    .work({ stopWhenEmpty: true, maxTime: 55 })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
`,
    'schedule.ts': `import { Schedule } from 'aldareth';

export default new Schedule({
    timezone: 'Asia/Jakarta',

    // Required by withoutOverlapping() — uncomment together with the import above it:
    //   import aldareth from './aldareth.js';
    //   hasActive: (jobName) => aldareth.driver.hasActive(jobName),
    //
    // schedule.job(ExampleJob).dailyAt('08:00');
});
`,
    'run-schedule.ts': `import { scheduleRun } from 'aldareth';
import schedule from './schedule.js';

// once: dispatch whatever is due this minute, then return
scheduleRun(schedule, { once: true }).then(() => process.exit(0));
`,
};

const SCRIPTS = (base: string): Record<string, string> => ({
    'aldareth:migrate': 'aldareth migrate',
    'aldareth:worker': `tsx ${path.posix.join(base, 'worker.ts')}`,
    'aldareth:schedule': `tsx ${path.posix.join(base, 'run-schedule.ts')}`,
});

const DOTENV = `ALDARETH_DB_URL=mysql://user:password@127.0.0.1:3306/aldareth\n`;

function createFile(rel: string, content: string) {
    const full = path.resolve(process.cwd(), rel);
    if (existsSync(full)) {
        console.log(`[aldareth] skip    ${rel} (already exists)`);
        return;
    }
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
    console.log(`[aldareth] created ${rel}`);
}

function addScripts(base: string) {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (!existsSync(pkgPath)) {
        console.log('[aldareth] skip    package.json (not found)');
        return;
    }

    const raw = readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    pkg.scripts ??= {};

    const added: string[] = [];
    for (const [name, command] of Object.entries(SCRIPTS(base))) {
        if (pkg.scripts[name]) {
            console.log(`[aldareth] skip    script "${name}" (already exists)`);
            continue;
        }
        pkg.scripts[name] = command;
        added.push(name);
    }
    if (!added.length) return;

    const indent = /^[ \t]+/m.exec(raw)?.[0] ?? '  ';
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, indent)}\n`);
    console.log(`[aldareth] added   scripts: ${added.join(', ')}`);
}

// Non-TTY (CI, piped input) takes the default instead of blocking on a prompt.
async function askDir(): Promise<string> {
    if (!process.stdin.isTTY) return 'src';
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await rl.question('Folder for the Aldareth files [src]: ');
        return answer.trim() || 'src';
    } finally {
        rl.close();
    }
}

export async function runInit(dir?: string) {
    // posix path: the npm scripts must work on Windows shells too
    const base = (dir ?? (await askDir())).replace(/\\/g, '/').replace(/\/+$/, '');

    for (const [rel, content] of Object.entries(FILES)) createFile(path.posix.join(base, rel), content);
    createFile('.env', DOTENV);
    addScripts(base);

    console.log(
        [
            '',
            'next:',
            '  1. npm install --save-dev tsx',
            '  2. set ALDARETH_DB_URL in .env',
            '  3. npx aldareth migrate',
            '  4. npm run aldareth:worker   |   npm run aldareth:schedule',
        ].join('\n'),
    );
}