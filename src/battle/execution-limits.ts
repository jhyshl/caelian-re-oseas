/**
 * Synchronous effect fan-out is bounded to keep imported content from blocking
 * the battle loop. This is an execution-safety boundary, not a balance budget.
 */
export const MAX_CARD_EFFECT_HITS = 64;

export function safeCardEffectHits(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(MAX_CARD_EFFECT_HITS, Math.floor(parsed)));
}
