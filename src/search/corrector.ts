/**
 * Street-name and locality-name typo corrector (SymSpell-style deletion index).
 *
 * Why two dictionaries
 * ────────────────────
 * Streets and localities are both loaded from the MV but stored in independent
 * SymSpell indices. The tokenizer calls `correctStreet()` for the street prefix
 * slot and `correctLocality()` for the locality (suburb) slot. Entries that
 * happen to exist in both dictionaries are correcitble by either method; the
 * slot context at the call site disambiguates.
 *
 * State codes use a completely separate closed-set corrector (see
 * `tokenizer.ts:correctStateToken()`) — only 9 valid AU states, so a
 * dictionary is overkill.
 *
 * Algorithm: SymSpell deletion indexing.
 */
import { logger } from "../lib/logger";
import { fetchLocalities, fetchStreetNames } from "../sql/corrector";

/** A single SymSpell deletion-index dictionary. */
interface Dictionary {
  frequency: Map<string, number>;
  deletes: Map<string, string[]>;
}

function makeDictionary(): Dictionary {
  return { frequency: new Map(), deletes: new Map() };
}

/** Minimum word length for dictionary entry and lookup; shorter inputs are ignored. */
const MIN_WORD_LEN = 3;
/** Maximum length delta for single-deletion path candidates. */
const EDIT_1_LENGTH_DELTA = 1;
/** Maximum length delta for double-deletion path candidates. */
const EDIT_2_LENGTH_DELTA = 2;
/**
 * Vote count dominates frequency; a candidate with 1 more vote wins over any
 * frequency advantage smaller than this value.
 */
const VOTE_MULTIPLIER = 1_000_000;
/**
 * Bonus votes added when the query itself is a single-deletion variant of
 * a dictionary word — a stronger signal than a generic single-deletion match.
 */
const EXACT_DELETION_VOTE_BONUS = 10;

/**
 * SymSpell corrector with two independent dictionaries.
 */
export class Corrector {
  private readonly street = makeDictionary();
  private readonly locality = makeDictionary();

  addStreet(word: string, freq: number = 1): void {
    this.addToDict(word, freq, this.street);
  }

  correctStreet(query: string): string | null {
    return this.lookup(query, this.street);
  }

  streetSize(): number {
    return this.street.frequency.size;
  }

  addLocality(word: string, freq: number = 1): void {
    this.addToDict(word, freq, this.locality);
  }

  correctLocality(query: string): string | null {
    return this.lookup(query, this.locality);
  }

  localitySize(): number {
    return this.locality.frequency.size;
  }

  private addToDict(word: string, freq: number, dict: Dictionary): void {
    if (!word || word.length < MIN_WORD_LEN) return;
    const lc = word.toLowerCase();
    dict.frequency.set(lc, (dict.frequency.get(lc) ?? 0) + freq);
    for (const del of this.singleDeletes(lc)) {
      const list = dict.deletes.get(del);
      if (list) {
        if (!list.includes(lc)) list.push(lc);
      } else {
        dict.deletes.set(del, [lc]);
      }
    }
  }

  private lookup(query: string, dict: Dictionary): string | null {
    if (!query || query.length < MIN_WORD_LEN) return null;
    const lc = query.toLowerCase();
    if (dict.frequency.has(lc)) return null;

    const candidates = new Map<string, number>();

    // Check if the query itself is a deletion variant of a dictionary word
    // (handles 1-char insertion typos: "wntirna" is a deletion of "wantirna").
    const qExactDeletions = dict.deletes.get(lc);
    if (qExactDeletions) {
      for (const word of qExactDeletions) {
        if (Math.abs(word.length - lc.length) <= EDIT_1_LENGTH_DELTA) {
          candidates.set(word, (candidates.get(word) ?? 0) + EXACT_DELETION_VOTE_BONUS);
        }
      }
    }

    // Edit distance 1: single-deletion variants of the query.
    for (const del of this.singleDeletes(lc)) {
      const matches = dict.deletes.get(del);
      if (!matches) continue;
      for (const word of matches) {
        candidates.set(word, (candidates.get(word) ?? 0) + 1);
      }
    }

    // Edit distance 2: combine query 2-deletes with dictionary 1-deletes.
    if (candidates.size === 0) {
      for (const del of this.doubleDeletes(lc)) {
        const matches = dict.deletes.get(del);
        if (!matches) continue;
        for (const word of matches) {
          if (Math.abs(word.length - lc.length) > EDIT_2_LENGTH_DELTA) continue;
          candidates.set(word, (candidates.get(word) ?? 0) + 1);
        }
      }
    }

    if (candidates.size === 0) return null;

    let best: string | null = null;
    let bestScore = -1;
    for (const [word, votes] of candidates) {
      const freq = dict.frequency.get(word) ?? 0;
      const finalScore = votes * VOTE_MULTIPLIER + freq;
      if (finalScore > bestScore) {
        best = word;
        bestScore = finalScore;
      }
    }
    return best;
  }

  private singleDeletes(word: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < word.length; i++) {
      out.push(word.slice(0, i) + word.slice(i + 1));
    }
    return out;
  }

  private doubleDeletes(word: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < word.length; i++) {
      for (let j = i + 1; j < word.length; j++) {
        out.push(word.slice(0, i) + word.slice(i + 1, j) + word.slice(j + 1));
      }
    }
    return out;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Lazy singleton
// ──────────────────────────────────────────────────────────────────────────

let _corrector: Corrector | null = null;
let _loadingPromise: Promise<Corrector> | null = null;

export async function ensureCorrector(): Promise<Corrector> {
  if (_corrector) return _corrector;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    const corrector = new Corrector();
    try {
      // Street dictionary
      const streetRows = await fetchStreetNames();
      for (const row of streetRows) {
        corrector.addStreet(row.name, row.n);
      }
      logger.info({ entries: corrector.streetSize() }, "Street corrector loaded");

      // Locality dictionary
      const localityRows = await fetchLocalities();
      for (const row of localityRows) {
        corrector.addLocality(row.name, row.n);
      }
      logger.info({ entries: corrector.localitySize() }, "Locality corrector loaded");
      // Assign on success only: a half-populated corrector would silently
      // produce worse matches than no corrector at all.
      _corrector = corrector;
    } catch (err) {
      // Do not cache on failure. Throw so the caller can fall back to
      // uncorrected queries; next request starts a fresh load.
      logger.error({ err }, "Failed to load corrector; queries will skip correction");
      throw err;
    } finally {
      _loadingPromise = null;
    }
    return corrector;
  })();

  return _loadingPromise;
}

export function getCorrector(): Corrector | null {
  return _corrector;
}

export function resetCorrector(): void {
  _corrector = null;
  _loadingPromise = null;
}

/** @internal — test seam only. Use {@link ensureCorrector} in production code. */
export function setCorrector(c: Corrector | null): void {
  _corrector = c;
  _loadingPromise = null;
}
