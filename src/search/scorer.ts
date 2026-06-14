/**
 * Score formula: similarity(search_text_expanded, query) * (1 + ln(confidence_norm + 1))
 *
 * - similarity: 0-1 from pg_trgm (Tier 2) or ts_rank (Tier 3)
 * - confidence_norm: 0-1, where 1 = highest G-NAF confidence (6)
 * - ln(1 + confidence_norm): gently boosts high-confidence addresses
 * - Range: 0 to ~1.69 (when sim=1 and confidence_norm=1)
 */
export function computeScore(similarity: number, confidenceNorm: number): number {
  return similarity * (1 + Math.log(confidenceNorm + 1));
}
