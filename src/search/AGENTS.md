# src/search

Query tokenization, scoring, display formatting, typo correction. Pure functions, no I/O.

## OVERVIEW
Three pure-function modules + one I/O-bound corrector loader. Heavily tested.

## STRUCTURE
| File | Exports | Purpose |
|------|---------|---------|
| `tokenizer.ts` | `tokenizeQuery`, `detectStateFilter`, `detectPostcodeFilter`, `STREET_TYPE_LC` | Parse raw query → `TokenizedQuery` |
| `scorer.ts` | `computeScore` | Single function: `similarity * (1 + ln(1 + confidenceNorm))` |
| `formatter.ts` | `buildDisplay`, `buildSearchText`, `AddressComponents`, `FLAT_TYPE_DISPLAY`, `STREET_TYPE_ABBREV` | Compose AU address string + search text |
| `corrector.ts` | `Corrector`, `ensureCorrector`, `getCorrector`, `resetCorrector`, `setCorrector` | SymSpell typo corrector (loaded from DB via `src/sql/corrector.ts`) |

## WHERE TO LOOK
- **Add new address pattern**: `tokenizer.ts` (e.g., new flat type → add to `FLAT_TYPE_LC`)
- **Add new street type abbreviation**: BOTH `STREET_TYPE_LC` (tokenizer) AND `STREET_TYPE_ABBREV` (formatter)
- **Change scoring**: `scorer.ts` AND `src/db/queries.ts` SQL ORDER BY (must match)

## CONVENTIONS
- Corrector dictionaries are loaded from the MV via `src/sql/corrector.ts`
- Street corrector threshold: ≥4 chars; locality corrector: ≥3 chars
- State corrector uses Levenshtein-1 against 9 AU state codes
- All SQl for corrector loading is in `src/sql/corrector.ts` — not inline
