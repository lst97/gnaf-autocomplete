# Graph Report - .  (2026-06-18)

## Corpus Check
- 158 files · ~143,007 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 810 nodes · 1362 edges · 92 communities (43 shown, 49 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 43 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_API Auth Middleware|API Auth Middleware]]
- [[_COMMUNITY_Integration & Fixture Tests|Integration & Fixture Tests]]
- [[_COMMUNITY_DB Client & Health|DB Client & Health]]
- [[_COMMUNITY_API Key Management|API Key Management]]
- [[_COMMUNITY_SQL Schema & MV|SQL Schema & MV]]
- [[_COMMUNITY_Test UI Frontend|Test UI Frontend]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_G-NAF Data Loader|G-NAF Data Loader]]
- [[_COMMUNITY_Suggest Route Handler|Suggest Route Handler]]
- [[_COMMUNITY_Query Router & Tiers|Query Router & Tiers]]
- [[_COMMUNITY_Project Documentation|Project Documentation]]
- [[_COMMUNITY_TypeScript Configuration|TypeScript Configuration]]
- [[_COMMUNITY_DB Integration Tests|DB Integration Tests]]
- [[_COMMUNITY_Search & Tokenizer|Search & Tokenizer]]
- [[_COMMUNITY_Biome Linter Config|Biome Linter Config]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]

## God Nodes (most connected - your core abstractions)
1. `getSql()` - 45 edges
2. `sql()` - 35 edges
3. `routeQuery()` - 21 edges
4. `compilerOptions` - 20 edges
5. `closeDb()` - 18 edges
6. `getReadWriteSql()` - 16 edges
7. `sql/007_mv.sql — address_search_mv MV + 10 indexes` - 16 edges
8. `Corrector` - 15 edges
9. `scripts/load.ts` - 15 edges
10. `env` - 13 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `sql()`  [INFERRED]
  scripts/load.ts → src/db/queries.ts
- `runPipeline()` --calls--> `routeQuery()`  [EXTRACTED]
  tests/db/full-pipeline.test.ts → src/db/router.ts
- `main()` --calls--> `sql()`  [INFERRED]
  scripts/build-fixture.ts → src/db/queries.ts
- `fetchLatestRelease()` --calls--> `parseGnafReleasePage()`  [INFERRED]
  scripts/lib/gnaf-download.ts → src/lib/version-check.ts
- `main()` --calls--> `getSql()`  [EXTRACTED]
  scripts/update-gnaf.ts → src/db/client.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Benchmark Suite** — benchmark_bench, benchmark_tiers, benchmark_verifytiers [EXTRACTED 1.00]
- **G-NAF loader pipeline: TRUNCATE, 9 parallel workers, denormalize, pre-filter, REFRESH MV, parallel indexes, prewarm** — load.ts, load-worker.ts, buildWorkerList, copyStage, loadState, STAGE_CONFIG, AD_column_map, psvLineToCopyLine, 005_staging.sql, 006_staging_indexes.sql, 007_mv.sql, 005_prewarm.sql, 001_extensions.sql, 003b_abbrev_map.sql, 003c_expand_fn.sql, staging_state, staging_locality, staging_street_locality, staging_address_detail, staging_address_geocode, address_search_mv [EXTRACTED 1.00]
- **Test UI frontend: lazy-loaded tabs with common utilities** — common.js, detail.js, keys.js, suggest.js, system.js, apiFetch, setupTabs, fetchTabContent, esc_escAttr, showUpdateModal, getApiKey, STORAGE_KEY, tabCache, ERROR_MESSAGES_keys, handleApiError, dispatchKeyExpired, fmtExpiry, initDetail, doDetail, initSuggest, doSuggest, fetchSuggestions, renderSuggestPage, highlightNext, initKeyGate, initKeyGeneration, initKeyManagement, initKeyRecovery, sysFetch, initSystem [EXTRACTED 1.00]
- **address_search_mv 10-index set: 1 UNIQUE + 4 btree covering + 2 GIN trigram + 1 GIN trigram search_text + 1 GIN tsvector + 1 btree postcode prefix** — address_search_mv, idx_mv_address_detail_pid, idx_mv_tier0_state_postcode, idx_mv_tier0_number_first, idx_mv_tier0_state_locality, idx_mv_tier1_street_prefix, idx_mv_tier2_trgm, idx_mv_tier4_street_trgm, idx_mv_tier4_locality_trgm, idx_mv_tier3_fts, idx_mv_postcode_prefix [EXTRACTED 1.00]
- **G-NAF download and update pipeline** — create-gnaf.ts, update-gnaf.ts, gnaf-download.ts, findStandardDir, acquireLock, readDotEnv, downloadFile, verifyZip, extractZip, checkDiskSpace, fetchLatestRelease [EXTRACTED 1.00]
- **Staging tables FK dependency chain: state, locality, street_locality, address_detail, geocode** — staging_state, staging_locality, staging_street_locality, staging_address_detail, staging_address_geocode [EXTRACTED 1.00]

## Communities (92 total, 49 thin omitted)

### Community 0 - "API Auth Middleware"
Cohesion: 0.05
Nodes (55): DB row shape for API key lookup, addressRoute, authDerive(), authPlugin, extractHostname(), hostnameMatches(), checkUpdateRoute, checkKeygenRateLimit() (+47 more)

### Community 1 - "Integration & Fixture Tests"
Cohesion: 0.06
Nodes (49): validateStateParam(), allAddresses, FIXTURE_PATH, FixtureAddr, FLAT_TYPE_LC, runPipeline(), tier0LocalityQuery(), tier0NumberQuery() (+41 more)

### Community 2 - "DB Client & Health"
Cohesion: 0.08
Nodes (48): healthRoute, closeDb(), getReadWriteSql(), getSql(), sql(), ensureKey(), resetKeyWindow(), touchKey() (+40 more)

### Community 3 - "API Key Management"
Cohesion: 0.05
Nodes (54): keygenIpMap, verifyIpMap, openapiConfig, authDerive, checkKeygenRateLimit, checkVerifyRateLimit, closeDb, extractHostname (+46 more)

### Community 4 - "SQL Schema & MV"
Cohesion: 0.07
Nodes (48): sql/001_extensions.sql — pg_trgm + unaccent extensions, sql/003b_abbrev_map.sql — address_abbrev_map table, sql/003c_expand_fn.sql — expand_address_abbrevs() function, sql/005_prewarm.sql — pg_prewarm on MV and 6 indexes, sql/005_staging.sql — 5 UNLOGGED staging tables, sql/006_staging_indexes.sql — 3 staging JOIN indexes, sql/007_mv.sql — address_search_mv MV + 10 indexes, sql/008_drop_unused.sql — drop idx_mv_confidence (+40 more)

### Community 5 - "Test UI Frontend"
Cohesion: 0.08
Nodes (22): apiFetch(), esc(), escAttr(), fetchTabContent(), getApiKey(), maskKey(), setupTabs(), showUpdateModal() (+14 more)

### Community 6 - "Package Dependencies"
Cohesion: 0.06
Nodes (32): dependencies, elysia, elysia-rate-limit, @elysiajs/cors, @elysiajs/openapi, linkedom, pino, postgres (+24 more)

### Community 7 - "G-NAF Data Loader"
Cohesion: 0.14
Nodes (29): acquireLock(), checkDiskSpace(), cleanupTempFiles(), downloadFile(), extractZip(), fetchLatestRelease(), GnafReleaseInfo, promptUser() (+21 more)

### Community 8 - "Suggest Route Handler"
Cohesion: 0.11
Nodes (14): isValidAddressQuery(), parseSuggestParams(), sanitizeQuery(), SuggestParams, SuggestResponseBody, suggestRoute, timingWindow, ValidatedState (+6 more)

### Community 9 - "Query Router & Tiers"
Cohesion: 0.12
Nodes (28): formatSuggestResponse, isValidAddressQuery, parseSuggestParams, recordTiming, routeQuery, sanitizeQuery, tier0LocalityQuery, tier0NumberQuery (+20 more)

### Community 10 - "Project Documentation"
Cohesion: 0.09
Nodes (27): AGENTS.md, CODE_OF_CONDUCT.md, cls:Corrector, concept:parseLimit, concept:parseOffset, concept:tier_routing, config.yml, fn:buildDisplay (+19 more)

### Community 11 - "TypeScript Configuration"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, lib, module, moduleResolution (+14 more)

### Community 12 - "DB Integration Tests"
Cohesion: 0.10
Nodes (16): ADDRESSES_WITH_NUMBER, allAddresses, CORRECTOR_TARGETS, FIXTURE_PATH, FixtureAddr, FLAT_ADDRESSES, FLAT_CONFLICT_ADDRS, FLAT_CONFLICT_STREETS (+8 more)

### Community 13 - "Search & Tokenizer"
Cohesion: 0.16
Nodes (19): All G-NAF address component fields for display building, FLAT_TYPE_LC — flat/unit type keyword set, Record mapping user-typed street variants to canonical abbrev (st→st, street→st, …), STREET_TYPE_LC — street type keyword set for conflict detection, Parsed query shape with all extracted address fields, VALID_STATES — 9 AU state codes set, Lowercase version of VALID_STATES, Compose uppercase AU address string from components (+11 more)

### Community 14 - "Biome Linter Config"
Cohesion: 0.11
Nodes (17): noUnusedImports, noUnusedVariables, formatter, enabled, indentStyle, indentWidth, lineWidth, linter (+9 more)

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (13): sql/008_gnaf_release.sql — gnaf_release_info singleton table, Result of checking for new G-NAF release on data.gov.au, DB row shape for gnaf_release_info table, Fetch + parse data.gov.au and compare against current version, Read gnaf_release_info singleton row, gnaf_release_info — singleton G-NAF version tracking table, Pino structured-logger singleton, Parse data.gov.au HTML for G-NAF GDA2020 release info (+5 more)

### Community 16 - "Community 16"
Cohesion: 0.29
Nodes (6): SAMPLE_QUERIES, Cache Bypass Benchmark Pattern, TIERS, Tier Routing Verification, p95 < 50ms Latency Target, 7-Tier Query Router

### Community 17 - "Community 17"
Cohesion: 0.28
Nodes (9): Base application error with statusCode + ErrorCode, Authenticated context: keyPrefix + domain (injected by auth middleware), Registry of 20 uppercase-snake error codes, Union type of all ERROR_CODES values, Standard error response shape: error, code, meta, Standard response metadata: took_ms, request_id, timestamp, 400 VALIDATION_ERROR shorthand, errors.ts — AppError hierarchy + ERROR_CODES registry (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.29
Nodes (8): apiFetch() — fetch wrapper with X-API-Key header + cache:no-store, doDetail() — lookup address by address_detail_pid, doSuggest() — advanced search form submission, fetchSuggestions() — autocomplete live fetch with AbortController, getApiKey()/maskKey() — localStorage API key helpers, highlightNext() — keyboard-arrow autocomplete nav, initDetail() — initialize detail tab handlers, initSuggest() — suggest tab init with _suggestInitialized guard

### Community 19 - "Community 19"
Cohesion: 0.36
Nodes (5): generateRequestId(), getOrGenerateRequestId(), isValidUuid(), _store, buildResponseMeta()

### Community 20 - "Community 20"
Cohesion: 0.32
Nodes (5): AddressComponents, buildDisplay(), FLAT_TYPE_DISPLAY, formatOptionalNum(), STREET_TYPE_ABBREV

### Community 21 - "Community 21"
Cohesion: 0.47
Nodes (6): Shape of a cached suggest response entry, Generic O(1) TTL LRU cache backed by Map insertion-order, Normalise cache key from query params (pipe-separated), Singleton getter for suggest-result LRU cache, Reset cache singleton for tests, cache.ts — LRU cache singleton + cached response type

### Community 22 - "Community 22"
Cohesion: 0.40
Nodes (5): ERROR_MESSAGES — API error code to message mapping, handleApiError() — translate error codes to messages, initKeyGeneration() — API key generation UI, initKeyManagement() — key management UI (list/revoke), initKeyRecovery() — DNS-based key recovery flow

### Community 23 - "Community 23"
Cohesion: 0.40
Nodes (5): Key detail for key management UI, Key hash/domain/status row, Key status with domain/created_at/last_verified_at, Key verification row: domain, token, status, keys.ts — key CRUD, revoke, activate, DNS-recovery queries

### Community 24 - "Community 24"
Cohesion: 0.40
Nodes (5): Biome Configuration, Docker Entrypoint Script, Husky Shared Hook Runner, Husky Git Hook Infrastructure, Package Configuration

### Community 25 - "Community 25"
Cohesion: 0.40
Nodes (5): pages/assets/common.js, pages/assets/detail.js, pages/assets/keys.js, pages/assets/suggest.js, pages/assets/system.js

### Community 26 - "Community 26"
Cohesion: 0.50
Nodes (4): Row with address count from pg_class, Aggregated key statistics from api_keys table, Top domain with aggregated requests + key details, stats.ts — aggregated usage statistics queries

### Community 27 - "Community 27"
Cohesion: 0.50
Nodes (4): Row shape for MV populated check (reltuples + ispopulated), Check MV ispopulated + row estimate via pg_class, SELECT 1 DB liveness check, health.ts — DB ping + MV populated check queries

### Community 28 - "Community 28"
Cohesion: 0.50
Nodes (4): scripts/create-gnaf.ts, findStandardDir() — find G-NAF Standard/ dir in extracted ZIP, scripts/lib/gnaf-download.ts, scripts/update-gnaf.ts

### Community 29 - "Community 29"
Cohesion: 0.50
Nodes (4): file:tests/db/full-pipeline.test.ts, file:tests/db/integration-suite.test.ts, file:tests/fixture/autocomplete.test.ts, file:tests/fixtures/addresses.json

### Community 31 - "Community 31"
Cohesion: 0.67
Nodes (3): sql/008_api_keys.sql — api_keys table (SHA-256, domain-bound), sql/009_domain_verify.sql — DNS TXT domain verification, api_keys — SHA-256 hashed, domain-bound API key table

### Community 34 - "Community 34"
Cohesion: 0.67
Nodes (3): concept:generateKeyPrefix, concept:validateDomain, test_keys.ts

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (3): copyStage() — COPY FROM STDIN for one table stage, loadState() — load all 5 stages for one state, psvLineToCopyLine() — PSV to COPY TSV line converter

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (3): fetchTabContent() — lazy-fetch tab HTML, setupTabs() — lazy-load tab switching, tabCache — lazy-load tab HTML cache object

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (3): fixture_data-gov-au-page.html, fn:parseGnafReleasePage, test_version-check.ts

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (3): fn:generateRequestId, fn:getOrGenerateRequestId, test_request.ts

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (3): fn:hashKey, fn:verifyKey, test_key-hash.ts

### Community 40 - "Community 40"
Cohesion: 0.67
Nodes (3): Generate fresh UUID (no header check), Get-or-generate request ID (honours inbound X-Request-Id), request.ts — request-scoped UUID generation (honours X-Request-Id)

### Community 41 - "Community 41"
Cohesion: 1.00
Nodes (3): SHA-256 hash of raw API key → 64-char hex, key-hash.ts — SHA-256 API key hashing + constant-time verification, window.verifyKey — DNS verification trigger

### Community 43 - "Community 43"
Cohesion: 0.67
Nodes (3): Reset key's rate-limit window to new window, touch-key.ts — key rate-limit window touch + reset, Increment key's rate-limit window count + extend expiry

## Knowledge Gaps
- **189 isolated node(s):** `husky.sh script`, `SAMPLE_QUERIES`, `TIERS`, `QUERIES`, `$schema` (+184 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **49 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getSql()` connect `DB Client & Health` to `API Auth Middleware`, `Integration & Fixture Tests`, `DB Integration Tests`, `G-NAF Data Loader`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `LruCache` connect `Suggest Route Handler` to `API Auth Middleware`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Are the 26 inferred relationships involving `sql()` (e.g. with `ensureKey()` and `resetKeyWindow()`) actually correct?**
  _`sql()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **What connects `husky.sh script`, `SAMPLE_QUERIES`, `TIERS` to the rest of the system?**
  _190 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `API Auth Middleware` be split into smaller, more focused modules?**
  _Cohesion score 0.05030643513789581 - nodes in this community are weakly interconnected._
- **Should `Integration & Fixture Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.060694579681921455 - nodes in this community are weakly interconnected._
- **Should `DB Client & Health` be split into smaller, more focused modules?**
  _Cohesion score 0.07800511508951406 - nodes in this community are weakly interconnected._