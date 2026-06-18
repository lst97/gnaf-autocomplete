## Description

<!-- Briefly describe what this PR does and why. Include the problem, the approach, and any relevant context. -->

Closes #<!-- issue number if applicable -->

## PR Title Convention

**`type(scope): short description`**

| Type | Scope |
|------|-------|
| `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore` | `api`, `db`, `router`, `search`, `loader`, `ui`, `deps` |

## PR Checklist

- [ ] Tests pass (`bun test`)
- [ ] Lint passes (`bun run lint`)
- [ ] Formatting applied (`bun run format`)
- [ ] Performance verified if on hot path (`bun run benchmark/bench.ts`)
- [ ] No `as any`, `@ts-ignore`, or `@ts-expect-error`
- [ ] No `console.log` — uses the Pino logger
- [ ] New environment variables added to `src/env.ts` and `.env.example`

## Type of Change

<!-- Check all that apply. -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Performance improvement
- [ ] Refactor (no functional change)
- [ ] Test addition or improvement
- [ ] Documentation update
- [ ] Dependency update
- [ ] Breaking change (fix or feature that would break existing functionality)

## How Has This Been Tested?

<!-- Describe the tests you ran to verify your changes. -->

- [ ] Unit tests (`bun run test:unit`)
- [ ] Integration tests (`bun run test:integration`)
- [ ] Manual testing (describe steps below)

**Test steps:**

## Performance Impact (if applicable)

<!-- If your change affects the query path, include benchmark output. -->

```
# Paste benchmark results here
bun run benchmark/bench.ts
bun run benchmark/verify-tiers.ts
```

## Environment (if bug fix)

<!-- If this fixes a bug, include your environment. -->

- OS:
- Bun:
- PostgreSQL:
- Docker memory limit:
- Host RAM:

## Additional Context

<!-- Anything else reviewers should know? Design decisions, trade-offs, alternatives considered. -->

## License

By submitting this pull request, I confirm that my contributions are licensed under the [GNU Affero General Public License v3](LICENSE).
