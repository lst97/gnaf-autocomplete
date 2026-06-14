# pages

Static test UI. HTML + vanilla JS + CSS. No build step, no framework.

## OVERVIEW
A thin-shell `main.html` with 6 lazy-loaded tab panels (fetched on first click).
Tab content is in separate `*-tab.html` fragment files. JavaScript is split by
domain concern into `assets/*.js` modules. `analytics.html` is a standalone page
that shares the same CSS design system.

## STRUCTURE
| File | Served at | Purpose |
|------|-----------|---------|
| `main.html` | `/` | Thin shell: header, tab bar, panel containers, footer |
| `suggest-tab.html` | `/suggest-tab.html` | Suggest panel (live autocomplete + advanced search + tier examples) |
| `detail-tab.html` | `/detail-tab.html` | Address Detail panel (PID lookup) |
| `keys-tab.html` | `/keys-tab.html` | API Keys panel (generate, manage, DNS recovery) |
| `guide-tab.html` | `/guide-tab.html` | Getting Started Guide (authentication, endpoints, config) |
| `loader-tab.html` | `/loader-tab.html` | Loader panel (phase timings, state progress, row counts, SQL debug) |
| `system-tab.html` | `/system-tab.html` | System panel (health checks, query tiers, code reference, schema comparison) |
| `analytics.html` | `/analytics` | Standalone public analytics dashboard |
| `style.css` | `/style.css` | Solarized Light design system via CSS custom properties |
| `assets/common.js` | `/assets/common.js` | Shared: tab switching, esc()/escAttr(), lazy-load fetch, API base detection |
| `assets/suggest.js` | `/assets/suggest.js` | Suggest: doSuggest(), autocomplete dropdown, tier buttons |
| `assets/detail.js` | `/assets/detail.js` | Detail: doDetail() address lookup |
| `assets/system.js` | `/assets/system.js` | System: sysFetch() for healthz/readyz/warmup |
| `assets/keys.js` | `/assets/keys.js` | Keys: key generation, Turnstile, key management, DNS recovery |

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Update tier examples | Edit `data-q` attributes on `.btn-tier` buttons in `suggest-tab.html`; verify with `benchmark/verify-tiers.ts` |
| Update tier latency table | Copy new rows from `benchmark/tiers.ts` output → paste into the `<tbody>` in `system-tab.html` |
| Change debounce | `AC_DEBOUNCE` constant in `assets/suggest.js` (default 250ms) |
| Change result limit | `&limit=15` in `fetchSuggestions()` in `assets/suggest.js` |
| Add/modify tab | Create `foo-tab.html`, add route in `src/index.ts`, add `.tab` to tab bar in `main.html` |
| Modify key management | `assets/keys.js` — 3 IIFEs: generation, management, recovery |

## CONVENTIONS
- **API base detection**: `const API = ...` in `assets/common.js`
- **XSS prevention**: ALL user data through `esc()` (HTML) or `escAttr()` (attribute) before injection
- **Debounce**: 250ms via `setTimeout` + `clearTimeout` in input handler
- **AbortController**: cancel in-flight requests on new keystroke
- **Tier-coded buttons**: left border color indicates tier (green=tier0, yellow=tier0c, red=tier1, blue=cache)
- **No build step**: edit HTML/JS/CSS directly, refresh browser
- **Min query length**: 2 chars (`AC_MIN` constant)
- **Result limit**: 15 results per autocomplete dropdown (`&limit=15`)
- **Lazy-load**: Tab content fetched once on first click, cached in `tabCache`, no re-fetch
- **Script loading order**: `common.js` first (shared utilities), then tab-specific modules

## ANTI-PATTERNS
- **NEVER** inject user data without `esc()` / `escAttr()` — XSS risk
- **NEVER** use a build step (webpack, vite, etc.) — keep it static
- **NEVER** use `innerHTML` with user data unescaped
- **NEVER** rely on a framework (React/Vue/etc.) — keep it vanilla
- **NEVER** commit hardcoded tier labels in buttons without verifying with `verify-tiers.ts`

## GOTCHAS
- `tier` field in response drives the yellow color in `.meta-line .tier` class
- `cache_status` is only present for first-page queries — paginated calls never have it
- "Clicked:" line appears in `suggestMeta` when user clicks a dropdown item
- The `data-q` buttons fire `doSuggest()` immediately on click
- `verify-tiers.ts` mismatches mean either the tokenizer/router changed OR the test UI is stale — sync both
- `tier-button` classes: `tier-0` (green border), `tier-0c` (yellow), `tier-1` (red), `tier-2` (gray), `tier-4` (gray), `tier-cache` (blue)
- `data-state` attribute on tier buttons: usually `""` (any state) but can be set to filter
- `esc()` only escapes `& < >`; `escAttr()` additionally escapes `"` for attribute values
- API base falls back to `http://localhost:8000` when opened via `file://` protocol
- Tab content loads via `fetch('/foo-tab.html')` — server routes are in `src/index.ts`
- Tab-specific JS initializes via `tab-loaded` custom event dispatched after content injection
- The old monolithic `main.js` was split into 5 domain modules in `assets/`
- Tab navigation via `?tab=xxx` URL param is preserved
