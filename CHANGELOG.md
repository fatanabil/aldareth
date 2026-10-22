# Changelog

## 0.1.0-beta.2

- MongoDB driver with the same claim/lease/fencing protocol as MySQL
- Config resolved from `ALDARETH_DB_URL`, `ALDARETH_DRIVER` and `ALDARETH_PREFIX` — the env wins over the config module
- `Job.dispatch()` works from the env alone, no config module needed
- Warning when a dispatch result is not awaited
- CLI `init` command: scaffolds the config module, the worker and scheduler entry points, `.env` and the npm scripts
- CLI `init` asks for the target folder; `--dir` answers it without a prompt
- CLI `schedule:run --once` for cron-driven hosts
- CLI resolves the TypeScript loader from the consumer project, so `queue:work` works in a TypeScript app
- README rewritten as a linear quick start

## 0.1.0-beta.1

- Initial beta release: MySQL-backed queue, worker and cron scheduler
