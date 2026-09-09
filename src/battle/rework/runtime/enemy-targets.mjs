/** Equal chance per living, attackable actor. Announced targets stay locked. */
export function enemyTargetPool(g, source, respectTaunt = false) {
  const available = [...new Map([g.player, ...(g.allies ?? []), ...(g.playerAllies ?? []), ...(g.enemies ?? [])].filter(Boolean).map(a => [a.id, a])).values()]
    .filter(a => a.side !== source.side && a.hp > 0 && a.attackable !== false);
  const taunters = respectTaunt ? available.filter(a => g.hasStatus(a, 'taunt')) : [];
  return taunters.length ? taunters : available;
}
export function chooseEnemyTarget(g, source, lockedId, previousPoolIds) {
  const pool = enemyTargetPool(g, source, true);
  const samePool = !previousPoolIds || (previousPoolIds.length === pool.length && pool.every(a => previousPoolIds.includes(a.id)));
  const locked = samePool ? pool.find(a => a.id === lockedId) : undefined;
  if (locked) return locked;
  if (pool.length < 2) return pool[0];
  return pool[Math.min(pool.length - 1, Math.floor((g.targetRng ?? g.rng)() * pool.length))];
}
