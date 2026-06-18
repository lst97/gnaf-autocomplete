# Contributing to G-NAF Address Autocomplete

Thank you for your interest in contributing. This project exists because
address lookup is a solved infrastructure problem that should not be monetised
per request — every contribution brings us closer to that goal.

**Table of Contents**

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Coding Conventions](#coding-conventions)
- [Testing](#testing)
- [Performance](#performance)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [Quarterly G-NAF Data Updates](#quarterly-g-naf-data-updates)
- [License](#license)

---

## Code of Conduct

This project adheres to the [Contributor Covenant](CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code. Report unacceptable
behaviour to **laisiotou1997@gmail.com**.

## Getting Started

### Prerequisites

- **Bun 1.3+** — required for running the dev server, tests, and scripts
- **Docker + Docker Compose** — required for the PostgreSQL database
- **~25 GB free disk** — for the PostgreSQL data volume (~27 GB after initial load)

### One-time Setup

```bash
# Clone the repository
git clone https://github.com/your-org/gnaf-autocomplete.git
cd gnaf-autocomplete

# Install dependencies
bun install

# Copy environment (defaults work for local dev)
cp .env.example .env

# Start the database
docker compose up -d db

# Load the G-NAF data (~9.5 minutes)
docker compose run --rm api bun run scripts/load.ts

# Start the API in watch mode
bun run dev
```

The API is now running at `http://localhost:8000`. Open it in your browser —
the bundled test UI is served at the root URL.

## Development Environment

### Dev Server

```bash
bun run dev          # starts with --watch for hot reload
bun run start        # starts without watch
```

### Useful Commands

```bash
bun test                       # all tests (~476)
bun run test:unit              # unit tests only (~417, no DB needed)
bun run test:integration       # integration tests (~59, needs live API)
bun run lint                   # biome check src/
bun run format                 # biome format --write src/
bun run benchmark              # run the performance benchmark
```

### Environment Variables

All environment variables are validated at startup by the Zod schema in
`src/env.ts`. Copy `.env.example` to `.env` and adjust as needed.

Key variables for development:

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `8000` | API port |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5433/gnaf` | Local Postgres |
| `LOG_LEVEL` | `info` | Set to `debug` for verbose logging |
| `NODE_ENV` | `development` | Don't set to `production` locally — it enables rate limits |
| `CORS_ORIGINS` | `*` | Fine for local dev |

## Project Structure

```
├── src/                # Application source
│   ├── api/            # Elysia HTTP routes
│   ├── db/             # postgres.js client + 7-tier query router
│   ├── lib/            # LRU cache, error classes, pino logger, request-id
│   ├── search/         # tokenizer, scorer, formatter, corrector
│   ├── sql/            # Domain-organized SQL modules
│   ├── types/          # Shared TS types
│   ├── env.ts          # Zod env schema
│   └── index.ts        # App entry — middleware + route registration
├── sql/                # 13 numbered SQL files for DB setup
├── scripts/            # G-NAF PSV loader
├── tests/              # Unit + integration tests
├── benchmark/          # p50/p95/p99 latency benchmarks
├── pages/              # Static HTML/JS/CSS test UI (no build step)
└── docker-compose.yml  # PostgreSQL + API + optional cloudflared tunnel
```

## Coding Conventions

This project follows strict conventions. Please read this section carefully
before submitting code.

### TypeScript & Module System

- **ESM only** — `"type": "module"` in package.json. Use `import`/`export`, not `require`.
- **`verbatimModuleSyntax`** — use `import type` for type-only imports.
- **`strict: true`** — full strict mode with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, and `noUnusedLocals`/`noUnusedParameters`.
- **No `as any`**, no `@ts-ignore`, no `@ts-expect-error`. Fix the type properly.

### Linting & Formatting

- **Biome 2.4** — space indent, 100 line width.
- Run `bun run lint` before committing. The CI enforces this.

### HTTP Validation

- Use Elysia's `t` namespace for route validation, not raw Zod.
  ```typescript
  query: t.Object({ q: t.String({ minLength: 2, maxLength: 200 }) })
  ```

### Environment Validation

- Use `@t3-oss/env-core` + Zod in `src/env.ts`. Do not scatter `process.env`
  accesses across the codebase.

### Logging

- Use the Pino singleton from `src/lib/logger.ts`.
- Structured format: `logger.info({ key, val }, "message")`.
- Never use `console.log`.

### Database

- **`postgres.js`** is the client — use the singleton via `getSql()`.
- Never mock the DB in tests — test against the real query router.
- Never use `ILIKE` — use `LIKE` with `text_pattern_ops` btree or the `%` (trigram) operator.
- Never run `count(*)` on the MV — use `pg_class.reltuples`.
- Never enable `jit` in `postgresql.conf`.

### Singleton Pattern

Lazy-init in module scope + `getXxx()` getter + `resetXxx()` for tests.

### Anti-Patterns (Must Not Do)

| Rule | Reason |
|------|--------|
| Cache paginated results (`offset > 0`) | First page only |
| `ALTER MATERIALIZED VIEW ... DROP COLUMN` | Postgres doesn't support it |
| Mount `sql/005_prewarm.sql` in initdb | Runs after loader populates MV |
| Use `*` for `CORS_ORIGINS` in production | Security |
| Use `Bun.file().text()` in the loader | Memory blowup — use stream reader |
| Set `NODE_ENV=production` locally | Enables 120/min rate limit |
| Include trigram queries in `/warmup` | 100-500ms each, not on hot path |
| Create DB without `LC_COLLATE='C'` | `text_pattern_ops` loses 10-20% perf |

## Testing

### Test Runner

We use **`bun:test`** — NOT Jest, NOT Mocha, NOT Vitest.

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
```

### Test Structure

```
tests/
├── unit/           # No DB required — fast, ~417 tests
│   ├── router.test.ts
│   ├── tokenizer.test.ts
│   └── ...
├── integration/    # Requires live API, ~59 tests
│   └── api.test.ts
├── db/             # DB-specific helpers
└── fixtures/       # Test data
```

### Writing Tests

- **Unit tests** should be pure — no database, no network, no filesystem.
- **Integration tests** skip gracefully if the API is offline.
- Add tests for every new feature. The CI expects existing tests to pass.

### Running Tests

```bash
bun test             # all tests
bun run test:unit    # unit only (fast)
bun run test:integration  # integration only
```

## Performance

Performance is a core feature. The project targets **p95 < 50 ms** end-to-end
query latency. If your change affects the query path, you must verify it.

```bash
bun run benchmark/bench.ts   # exits 1 if p95 > 50ms
bun run benchmark/verify-tiers.ts  # ensures tier routing is correct
```

### When to Benchmark

- Any change to `src/db/router.ts`, `src/db/queries.ts`, or the index definitions
- Any change to the scoring formula in `src/search/scorer.ts`
- Any change to the tokenizer or corrector that affects query paths
- Adding a new query tier or modifying an existing one

### Cache Awareness

- The in-process LRU caches first-page results for 30 seconds.
- Benchmarks use `?no_cache=1` to measure cold-cache latency.
- Repeated queries will show `< 1ms` on cache hit — always verify cold-cache.

## Pull Request Process

### Before Submitting

1. **Read the conventions** — this document and `AGENTS.md`.
2. **Run the full test suite** — `bun test` must pass.
3. **Run the linter** — `bun run lint` must pass.
4. **Benchmark if applicable** — `bun run benchmark/bench.ts` must pass.
5. **Write tests** — new features need coverage; bug fixes need a regression test.

### PR Checklist

- [ ] Tests pass (`bun test`)
- [ ] Lint passes (`bun run lint`)
- [ ] Formatting applied (`bun run format`)
- [ ] Performance verified if on hot path (`bun run benchmark/bench.ts`)
- [ ] No `as any`, `@ts-ignore`, or `@ts-expect-error`
- [ ] No `console.log` — use the Pino logger
- [ ] New environment variables added to `src/env.ts` and `.env.example`

### PR Title Convention

```
type(scope): short description
```

Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`
Scopes: `api`, `db`, `router`, `search`, `loader`, `ui`, `deps`

Examples:
- `feat(router): add locality-tier0 state + postcode branch`
- `fix(search): handle empty query in correctStateToken`
- `perf(db): reduce tier2 trigram similarity threshold to 0.25`

### Review Process

1. A maintainer will review your PR within a few business days.
2. If changes are requested, address them and re-request review.
3. After approval, a maintainer will merge your PR.

**Small, focused PRs are much more likely to be reviewed quickly.**
A single PR should do one thing. Split large changes into multiple PRs.

## Reporting Issues

### Bug Reports

Open a [Bug Report](https://github.com/your-org/gnaf-autocomplete/issues/new?template=bug_report.yml).
Include reproduction steps, expected vs actual behaviour, and your environment
(Bun version, Postgres version, Docker memory limit).

### Feature Requests

Open a [Feature Request](https://github.com/your-org/gnaf-autocomplete/issues/new?template=feature_request.yml).
Explain what you need and why existing alternatives don't work.

### Security Vulnerabilities

**Do not** open a public issue. Report privately to **laisiotou1997@gmail.com**.
See [`SECURITY.md`](SECURITY.md) for details.

## Quarterly G-NAF Data Updates

Geoscape Australia publishes G-NAF ~4× per year. When a new release is out:

1. Download from [data.gov.au](https://data.gov.au/data/dataset/geocoded-national-address-file-g-naf)
2. Set `GNAF_DATA_DIR` to the new PSV directory
3. Run `bun run scripts/load.ts` (idempotent — safe to re-run)
4. Re-run `bun run benchmark/bench.ts` to verify performance

If the MV schema needs changes (e.g., new G-NAF columns), update `sql/007_mv.sql`
and the loader. The loader checks `pg_matviews.ispopulated` and
`information_schema.tables` to skip already-applied schema setup.

## License

By contributing, you agree that your contributions will be licensed under the
[GNU Affero General Public License v3](LICENSE) — the same license as the
project itself.

The G-NAF dataset itself is © Geoscape Australia and licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) with a mail-use
restriction. See the [README](README.md#g-naf-license) for details.
