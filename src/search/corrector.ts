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

/**
 * SymSpell corrector with two independent dictionaries.
 */
export class Corrector {
  // — Street dictionary —
  private readonly streetFrequency = new Map<string, number>();
  private readonly streetDeletes = new Map<string, string[]>();

  // — Locality dictionary —
  private readonly localityFrequency = new Map<string, number>();
  private readonly localityDeletes = new Map<string, string[]>();

  // ─────────────────────────────────────────────────────────────────────────
  //  Street methods
  // ─────────────────────────────────────────────────────────────────────────

  addStreet(word: string, freq: number = 1): void {
    this.addToDict(word, freq, this.streetFrequency, this.streetDeletes);
  }

  correctStreet(query: string): string | null {
    return this.lookup(query, this.streetFrequency, this.streetDeletes);
  }

  streetSize(): number {
    return this.streetFrequency.size;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Locality methods
  // ─────────────────────────────────────────────────────────────────────────

  addLocality(word: string, freq: number = 1): void {
    this.addToDict(word, freq, this.localityFrequency, this.localityDeletes);
  }

  correctLocality(query: string): string | null {
    return this.lookup(query, this.localityFrequency, this.localityDeletes);
  }

  localitySize(): number {
    return this.localityFrequency.size;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Internal
  // ─────────────────────────────────────────────────────────────────────────

  private addToDict(
    word: string,
    freq: number,
    frequency: Map<string, number>,
    deletes: Map<string, string[]>,
  ): void {
    if (!word || word.length < 3) return;
    const lc = word.toLowerCase();
    frequency.set(lc, (frequency.get(lc) ?? 0) + freq);
    for (const del of this.singleDeletes(lc)) {
      const list = deletes.get(del);
      if (list) {
        if (!list.includes(lc)) list.push(lc);
      } else {
        deletes.set(del, [lc]);
      }
    }
  }

  private lookup(
    query: string,
    frequency: Map<string, number>,
    deletes: Map<string, string[]>,
  ): string | null {
    if (!query || query.length < 3) return null;
    const lc = query.toLowerCase();
    if (frequency.has(lc)) return null;

    const candidates = new Map<string, number>();

    // Check if the query itself is a deletion variant of a dictionary word
    // (handles 1-char insertion typos: "wntirna" is a deletion of "wantirna").
    const qExactDeletions = deletes.get(lc);
    if (qExactDeletions) {
      for (const word of qExactDeletions) {
        if (Math.abs(word.length - lc.length) <= 1) {
          candidates.set(word, (candidates.get(word) ?? 0) + 10);
        }
      }
    }

    // Edit distance 1: single-deletion variants of the query.
    for (const del of this.singleDeletes(lc)) {
      const matches = deletes.get(del);
      if (!matches) continue;
      for (const word of matches) {
        candidates.set(word, (candidates.get(word) ?? 0) + 1);
      }
    }

    // Edit distance 2: combine query 2-deletes with dictionary 1-deletes.
    if (candidates.size === 0) {
      for (const del of this.doubleDeletes(lc)) {
        const matches = deletes.get(del);
        if (!matches) continue;
        for (const word of matches) {
          if (Math.abs(word.length - lc.length) > 2) continue;
          candidates.set(word, (candidates.get(word) ?? 0) + 1);
        }
      }
    }

    if (candidates.size === 0) return null;

    let best: string | null = null;
    let bestScore = -1;
    for (const [word, votes] of candidates) {
      const freq = frequency.get(word) ?? 0;
      const finalScore = votes * 1_000_000 + freq;
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
    } catch (err) {
      logger.error({ err }, "Failed to load corrector; queries will skip correction");
    }
    _corrector = corrector;
    _loadingPromise = null;
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

export function setCorrector(c: Corrector | null): void {
  _corrector = c;
  _loadingPromise = null;
}
