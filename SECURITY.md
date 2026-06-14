# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in G-NAF Address Autocomplete, please report it privately.

**Contact:** laisiotou1997@gmail.com

Do **not** report security issues via public GitHub issues — that exposes the vulnerability before a fix can be deployed.

### What to include

- A clear description of the vulnerability and the affected component
- Steps to reproduce (proof of concept preferred)
- Your assessment of the potential impact
- Any suggested remediation (if known)

### Response timeline

- **Acknowledgement:** within 48 hours of your report
- **Triage and validation:** within 5 business days
- **Fix deployed:** timeline depends on severity — critical issues are prioritised

## Scope

This policy covers all components of the G-NAF Address Autocomplete service:

- The HTTP API (Elysia/Bun routes in `src/api/`)
- The PostgreSQL query router and SQL layer (`src/db/`, `src/sql/`)
- The G-NAF data loader (`scripts/`)
- API key generation, storage, and authentication (`src/api/keys*.ts`, `src/api/auth.ts`)
- The static admin UI (`pages/`)

### Out of scope

- The G-NAF dataset itself (reports about address data accuracy should go to Geoscape Australia)
- Docker or infrastructure-level CVEs
- Third-party dependencies — report those to the respective maintainers

## Safe Harbour

We will not pursue legal action against researchers who:

- Follow this disclosure policy
- Make a good-faith effort to avoid privacy violations, data destruction, and service disruption
- Do not exploit a vulnerability beyond what is necessary to confirm its existence
- Report findings promptly and confidentially

Thank you for helping keep this project and its users safe.
