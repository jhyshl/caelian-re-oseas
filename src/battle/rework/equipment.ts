import type { EquipmentInstanceRecord } from '@/domain/types';
import { aggregateEquipmentStats, normalizeEquipmentStats } from '@/equipment-stats';
import type { CaelianDatabase } from '@/storage/database';

export const EQUIPMENT_RULES_VERSION = 1;
const RARITY_MULTIPLIERS: Record<string, number> = {
  common: 1, uncommon: 1.05, rare: 1.10, epic: 1.15, legendary: 1.20,
};
const GAINS = {
  hpMax: 10, attack: 2, defense: 5, speed: 1,
  critRate: 1, critDamage: 2, effectHit: 2, effectResist: 2,
} as const;
type ContinuousStat = keyof typeof GAINS;
const CONTINUOUS_STATS = Object.keys(GAINS) as ContinuousStat[];
export type ReworkEquipmentInstance = EquipmentInstanceRecord & {
  equipmentRulesVersion?: number;
  itemLevel?: number;
  /** Original persisted numbers before rebalancing; never overwritten by upgrades. */
  legacyStats?: Record<string, number>;
  /** Stable original affix proportions, retained to avoid accumulated rounding drift. */
  equipmentSourceStats?: Record<string, number>;
  metadata?: { itemLevel?: number; level?: number };
};
const finite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const levelValue = (value: unknown): number => Math.max(1, Math.min(999, Math.floor(finite(value, 1))));
const starsValue = (value: unknown): number => Math.max(1, Math.min(3, Math.floor(finite(value, 1))));
export const reworkEquipmentStarMultiplier = (stars: number): number => 1 + (starsValue(stars) - 1) * 0.1;
export function reworkEquipmentPointBudget(level: number, rarity: string): number {
  return (11.6 + 1.36 * levelValue(level)) / 3 * (RARITY_MULTIPLIERS[rarity] ?? 1);
}

/**
 * Inputs describe affix proportions, not authoritative output power. Therefore
 * legacy instances with old star-scaled numbers converge to the same budget as
 * fresh definitions. AP/draw affixes are discrete, not star-scaled. The bundled
 * catalog only grants one AP; that one-AP identity survives old 2x/4x instances.
 */
export function scaleReworkEquipment(
  stats: Readonly<Record<string, number>>,
  stars: number,
  level: number,
  rarity: string,
): Record<string, number> {
  const normalized = normalizeEquipmentStats(stats);
  const weights: Record<ContinuousStat, number> = {
    hpMax: normalized.hpMax / 10,
    attack: normalized.attack / 2,
    defense: normalized.defense / 5,
    speed: normalized.speed,
    critRate: normalized.critRate,
    critDamage: normalized.critDamage / 2,
    // Old MP allocation gained 5 MP per point; spend the same weight on EHR.
    effectHit: normalized.effectHit / 2 + normalized.mpMax / 5,
    // Old lifesteal cost 2 points per percentage point; preserve its weight.
    effectResist: normalized.effectResist / 2 + normalized.lifesteal * 2,
  };
  const result: Record<string, number> = {};
  // These describe the affix type: old star multiplication must not grant 4 AP.
  if (normalized.actionPointsPerTurn > 0) result.actionPointsPerTurn = 1;
  if (normalized.drawPerTurn > 0) result.drawPerTurn = 1;
  const discreteCost = (result.actionPointsPerTurn ?? 0) * 3 + (result.drawPerTurn ?? 0) * 5;
  const available = Math.max(0, reworkEquipmentPointBudget(level, rarity) - discreteCost)
    * reworkEquipmentStarMultiplier(stars);
  const weightTotal = CONTINUOUS_STATS.reduce((sum, key) => sum + Math.abs(weights[key]), 0);
  if (weightTotal > 0) {
    for (const key of CONTINUOUS_STATS) {
      if (!weights[key]) continue;
      const value = available * weights[key] / weightTotal * GAINS[key];
      // Keep two decimals to avoid changing an affix's weight at every upgrade.
      result[key] = Math.round(value * 100) / 100;
    }
  }
  // Preserve unrecognized extension affixes verbatim. They are not interpreted
  // as built-in combat stats; the raw backup preserves all original aliases too.
  for (const [key, value] of Object.entries(stats)) {
    const single = normalizeEquipmentStats({ [key]: value });
    if (Object.values(single).every((entry) => entry === 0)) {
      result[key] = finite(value);
    }
  }
  return result;
}

/** Caller owns item consumption, replacement ID, and the crafting transaction. */
export function upgradeReworkEquipment(instance: EquipmentInstanceRecord): ReworkEquipmentInstance {
  const current = instance as ReworkEquipmentInstance;
  if (current.equipmentRulesVersion !== EQUIPMENT_RULES_VERSION || !current.itemLevel) {
    throw new Error('请先完成装备数值迁移');
  }
  const stars = starsValue(current.stars);
  if (stars >= 3) throw new Error('三星装备已达到最高星级');
  const nextStars = stars + 1;
  const ratio = reworkEquipmentStarMultiplier(nextStars) / reworkEquipmentStarMultiplier(stars);
  const stats = current.equipmentSourceStats
    ? scaleReworkEquipment(current.equipmentSourceStats, nextStars, current.itemLevel, current.rarity)
    : Object.fromEntries(Object.entries(current.stats).map(([key, value]) => [key,
      key === 'actionPointsPerTurn' || key === 'drawPerTurn'
        ? value : Math.round(value * ratio * 100) / 100,
    ]));
  return {
    ...current, stars: nextStars, stats, updatedAt: Date.now(),
    // All markers/backups/level stay attached, so the post-command migration skips it.
    equipmentRulesVersion: EQUIPMENT_RULES_VERSION,
  };
}

/**
 * Call after attribute migration and before public snapshots/commands. Also call
 * after successful commands (before state.changed) to normalize newly created
 * loot/market/reward instances. Existing marked items never scale a second time.
 * Call outside a narrower outer transaction unless its stores include this list.
 */
export async function migrateCombatEquipment(db: CaelianDatabase, profileId: string): Promise<number> {
  return db.transaction('rw', [db.playerStates, db.equipmentInstances,
    db.equipmentLoadouts, db.profiles], async () => {
    const player = await db.playerStates.get(profileId);
    if (!player) throw new Error('玩家档案不存在');
    const equipment = await db.equipmentInstances.where('profileId').equals(profileId).toArray() as ReworkEquipmentInstance[];
    const pending = equipment.filter((entry) => entry.equipmentRulesVersion !== EQUIPMENT_RULES_VERSION);
    if (pending.length === 0) return 0;
    const loadout = await db.equipmentLoadouts.get(profileId);
    const equippedIds = new Set(loadout
      ? [loadout.weaponId, loadout.armorId, loadout.accessoryId].filter(Boolean) : []);
    const oldBonus = aggregateEquipmentStats(equipment.filter((entry) => equippedIds.has(entry.id)));
    const oldMaximum = Math.max(1, player.hpMax + oldBonus.hpMax);
    const previousHp = Math.max(0, Math.min(oldMaximum, finite(player.hp)));
    const now = Date.now();
    for (const entry of pending) {
      const itemLevel = levelValue(entry.itemLevel ?? entry.metadata?.itemLevel ?? entry.metadata?.level ?? player.level);
      const source = { ...(entry.equipmentSourceStats ?? entry.stats) };
      entry.legacyStats ??= { ...entry.stats };
      entry.equipmentSourceStats = source;
      entry.itemLevel = itemLevel;
      entry.stats = scaleReworkEquipment(source, entry.stars, itemLevel, entry.rarity);
      entry.equipmentRulesVersion = EQUIPMENT_RULES_VERSION;
      entry.updatedAt = now;
      await db.equipmentInstances.put(entry);
    }
    const nextBonus = aggregateEquipmentStats(equipment.filter((entry) => equippedIds.has(entry.id)));
    const nextMaximum = Math.max(1, player.hpMax + nextBonus.hpMax);
    // One-time migration preserves actual health percentage, including equipped HP.
    // Normal equip/unequip and crafting keep their existing clamp-only behavior.
    player.hp = previousHp === 0 ? 0 : nextMaximum === oldMaximum ? previousHp : Math.max(1, Math.min(nextMaximum,
      Math.round(previousHp / oldMaximum * nextMaximum),
    ));
    player.mp = Math.max(0, Math.min(player.mp, player.mpMax + nextBonus.mpMax));
    player.updatedAt = now;
    await db.playerStates.put(player);
    await db.profiles.update(profileId, { updatedAt: now });
    return pending.length;
  });
}
