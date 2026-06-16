# src/search

Query tokenization, scoring, display formatting, typo correction. Pure functions, no I/O.

## OVERVIEW
Three pure-function modules + one I/O-bound corrector loader. Heavily tested.

## STRUCTURE
| File | Exports | Purpose |
|------|---------|---------|
| `tokenizer.ts` | `tokenizeQuery`, `detectStateFilter`, `detectPostcodeFilter`, `STREET_TYPE_LC`, `correctStateToken` | Parse raw query → `TokenizedQuery` |
| `scorer.ts` | `computeScore` | Single function: `similarity * (1 + ln(1 + confidenceNorm))` |
| `formatter.ts` | `buildDisplay`, `buildSearchText`, `AddressComponents`, `FLAT_TYPE_DISPLAY`, `STREET_TYPE_ABBREV` | Compose AU address string + search text |
| `corrector.ts` | `Corrector`, `ensureCorrector`, `getCorrector`, `resetCorrector`, `setCorrector` | SymSpell typo corrector (loaded from DB via `src/sql/corrector.ts`) |

## WHERE TO LOOK
- **Add new address pattern**: `tokenizer.ts` (e.g., new flat type → add to `FLAT_TYPE_LC`)
- **Add new street type abbreviation**: BOTH `STREET_TYPE_LC` (tokenizer) AND `STREET_TYPE_ABBREV` (formatter)
- **Change scoring**: `scorer.ts` AND `src/db/queries.ts` SQL ORDER BY (must match)
- **Add state corrector entry**: edit `correctStateToken` in `tokenizer.ts` — uses Levenshtein-1 against 9 AU state codes

## CONVENTIONS
- Corrector dictionaries are loaded from the MV via `src/sql/corrector.ts`
- Street corrector threshold: ≥4 chars; locality corrector: ≥3 chars
- State corrector uses Levenshtein-1 against 9 AU state codes
- All SQL for corrector loading is in `src/sql/corrector.ts` — not inline
- **Tier 1 btree prefix threshold is ≥1 char** (lowered from 3) — handled in `findPrefixToken()` in `tokenizer.ts`
- Tokenizer recognises G-NAF-specific patterns: `1/6 fortuna` (slash flat), `unit 1 6 fortuna` (space flat), `apt 5 george`, `1/2-3 main st` (number range)
- `findPrefixToken` rejects state-correction tokens ("nzw" → NSW) as street prefixes for ≥3 chars; 2-char tokens are too ambiguous
- `STREET_TYPE_LC` is the set of AU street types accepted as street names (some streets are named after street types: "Avenue", "Close", "Lane", "Way", "Glen")
- `correctStateToken` is conservative: only returns correction when exactly one valid state has distance ≤1 from input (e.g., "ns" rejected — distance 1 from NSW, NT, SA)
