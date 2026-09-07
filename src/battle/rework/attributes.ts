import catalog from '@/battle/rework/catalog.json';
import type { PlayerRecord, StatAllocationRecord } from '@/domain/types';
import { aggregateEquipmentStats } from '@/equipment-stats';
import type { CaelianDatabase } from '@/storage/database';

export const COMBAT_RULES_VERSION = 1;
export const POINTS_PER_LEVEL = 10;
export const COMBAT_STAT_GAINS = {
  hpMax: 10, attack: 2, defense: 5, speed: 1,
  critRate: 1, critDamage: 2, effectHit: 2, effectResist: 2,
  actionPointsPerTurn: 1, drawPerTurn: 1,
} as const;
export type CombatAllocatableStat = keyof typeof COMBAT_STAT_GAINS;
export type CombatAttributes = Record<CombatAllocatableStat, number>;
export const COMBAT_PANEL_CAPS: Partial<CombatAttributes> = {
  critRate: 100, critDamage: 250, effectHit: 80, effectResist: 80, drawPerTurn: 5,
};
export type CombatPlayer = PlayerRecord & CombatAttributes & {
  combatRulesVersion?: number;
};
export type CombatAllocations = StatAllocationRecord & CombatAttributes;
export type HealthUpdateOptions = {
  health?: 'missing' | 'ratio' | 'clamp';
  equipmentHpMax?: number;
};
const STAT_KEYS = Object.keys(COMBAT_STAT_GAINS) as CombatAllocatableStat[];
const integer = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
};

/** Values exclude equipment and allocated points. Crit damage is additional %. */
export function baseAttributes(subclass: string, level: number): CombatAttributes {
  const definition = catalog.professions.find((entry) => entry.id === subclass);
  const proposal = definition?.baseStatsProposal;
  const multiplier = (expression: string | undefined) => {
    if (!expression) return 1;
    const match = /\*([0-9.]+)$/.exec(expression);
    if (!match || !Number.isFinite(Number(match[1]))) {
      throw new Error(`无法读取职业基础属性公式：${expression}`);
    }
    return Number(match[1]);
  };
  const growth = Math.max(1, integer(level)) - 1;
  return {
    hpMax: Math.round((300 + 20 * growth) * multiplier(proposal?.hp)),
    attack: Math.round((40 + 3 * growth) * multiplier(proposal?.attack)),
    defense: Math.round((30 + 2 * growth) * multiplier(proposal?.defense)),
    speed: proposal?.speed ?? 100,
    critRate: proposal?.crit ?? 5,
    critDamage: proposal?.critDamage ?? 50,
    effectHit: proposal?.ehr ?? 0,
    effectResist: proposal?.res ?? 0,
    actionPointsPerTurn: 5,
    drawPerTurn: 3,
  };
}

export function freshCombatAllocations(profileId: string, now = Date.now()): CombatAllocations {
  return {
    profileId, hpMax: 0, mpMax: 0, attack: 0, defense: 0, speed: 0,
    critRate: 0, critDamage: 0, effectHit: 0, effectResist: 0,
    actionPointsPerTurn: 0, drawPerTurn: 0, lifesteal: 0,
    actionPointCosts: [], updatedAt: now,
  };
}

/** Rebuild derived base values after level/class changes without erasing points. */
export function recomputePlayer(
  record: PlayerRecord,
  allocation: StatAllocationRecord,
  options: HealthUpdateOptions = {},
): CombatPlayer {
  const player = record as CombatPlayer;
  const invested = allocation as CombatAllocations;
  const bonusHp = options.equipmentHpMax ?? 0;
  const previousMaximum = Math.max(1, player.hpMax + bonusHp);
  const previousHp = Math.max(0, Math.min(previousMaximum, player.hp));
  const base = baseAttributes(player.subclass, player.level);
  for (const key of STAT_KEYS) {
    const value = base[key] + integer(invested[key]) * COMBAT_STAT_GAINS[key];
    player[key] = Math.min(COMBAT_PANEL_CAPS[key] ?? Infinity, value);
  }
  const maximum = Math.max(1, player.hpMax + bonusHp);
  const mode = options.health ?? 'missing';
  player.hp = previousHp === 0 ? 0 : Math.max(1, Math.min(maximum,
    mode === 'ratio' ? Math.round(maximum * previousHp / previousMaximum)
      : mode === 'clamp' ? previousHp
        : previousHp + maximum - previousMaximum,
  ));
  player.combatRulesVersion = COMBAT_RULES_VERSION;
  return player;
}

export function allocationCost(player: PlayerRecord, stat: CombatAllocatableStat): number {
  if (stat === 'drawPerTurn') return 5;
  if (stat === 'actionPointsPerTurn') return player.actionPointsPerTurn < 10 ? 2 : 3;
  return 1;
}

/** Sum point expenditure; allocation counters count purchases, not paid points. */
export function allocatedCombatPoints(allocation: StatAllocationRecord): number {
  const invested = allocation as CombatAllocations;
  let total = 0;
  for (const key of STAT_KEYS) {
    if (key === 'actionPointsPerTurn') continue;
    total += integer(invested[key]) * (key === 'drawPerTurn' ? 5 : 1);
  }
  for (let index = 0; index < integer(invested.actionPointsPerTurn); index += 1) {
    total += integer(invested.actionPointCosts[index]) || (index < 5 ? 2 : 3);
  }
  return total;
}

/** Mutates only the supplied records. Caller writes both in its command transaction. */
export function mutateAllocation(
  record: PlayerRecord,
  allocation: StatAllocationRecord,
  stat: CombatAllocatableStat,
  direction: 'add' | 'remove',
  equipment: Partial<CombatAttributes> = {},
): void {
  if (!(stat in COMBAT_STAT_GAINS)) throw new Error('该属性不能分配点数');
  const player = record as CombatPlayer;
  const invested = allocation as CombatAllocations;
  const count = integer(invested[stat]);
  if (direction === 'add') {
    const cost = allocationCost(player, stat);
    const cap = COMBAT_PANEL_CAPS[stat];
    if (cap !== undefined && player[stat] + (equipment[stat] ?? 0) >= cap) {
      throw new Error(`该属性已达到面板上限 ${cap}`);
    }
    if (player.statPoints < cost) throw new Error('可分配属性点不足');
    player.statPoints -= cost;
    invested[stat] = count + 1;
    if (stat === 'actionPointsPerTurn') invested.actionPointCosts.push(cost);
  } else {
    if (count === 0) throw new Error('该属性没有可返还的投入点');
    const refund = stat === 'actionPointsPerTurn'
      ? invested.actionPointCosts.pop() ?? (5 + count - 1 < 10 ? 2 : 3)
      : stat === 'drawPerTurn' ? 5 : 1;
    invested[stat] = count - 1;
    player.statPoints += refund;
  }
  recomputePlayer(player, invested, { health: 'clamp', equipmentHpMax: equipment.hpMax });
  player.updatedAt = invested.updatedAt = Date.now();
}

/** Old AP <=10 pricing is intentionally retained here for exact historical refunds. */
export function legacyAllocationRefund(allocation: StatAllocationRecord): number {
  const old = allocation as CombatAllocations;
  let refund = ['hpMax', 'mpMax', 'attack', 'defense', 'speed',
    'critRate', 'critDamage', 'effectHit', 'effectResist']
    .reduce((sum, key) => sum + integer(old[key as keyof CombatAllocations]), 0);
  refund += integer(old.lifesteal) * 2 + integer(old.drawPerTurn) * 5;
  for (let index = 0; index < integer(old.actionPointsPerTurn); index += 1) {
    refund += integer(old.actionPointCosts?.[index]) || (5 + index <= 10 ? 2 : 3);
  }
  return refund;
}

/**
 * Call before snapshot/command transactions, or include all these stores in the
 * outer transaction. The existing GameRepository.writeTables omits rollbackSnapshots.
 * No DB version bump is required for non-indexed fields; the per-profile marker
 * also protects profiles imported after the schema was upgraded.
 */
export async function migrateCombatAttributes(
  db: CaelianDatabase,
  profileId: string,
): Promise<boolean> {
  return db.transaction('rw', [db.playerStates, db.statAllocations,
    db.ownedCards, db.battleSessions, db.rollbackSnapshots,
    db.equipmentInstances, db.equipmentLoadouts, db.profiles], async () => {
    const current = await db.playerStates.get(profileId) as CombatPlayer | undefined;
    if (!current) throw new Error('玩家档案不存在');
    if (current.combatRulesVersion === COMBAT_RULES_VERSION) return false;
    const now = Date.now();
    const oldAllocation = await db.statAllocations.get(profileId)
      ?? freshCombatAllocations(profileId, now);
    const cards = await db.ownedCards.where('profileId').equals(profileId).toArray();
    const activeBattles = await db.battleSessions.where('profileId').equals(profileId)
      .filter((session) => session.active).toArray();
    const backupId = `${profileId}:combat-before-v${COMBAT_RULES_VERSION}`;
    if (!(await db.rollbackSnapshots.get(backupId))) {
      await db.rollbackSnapshots.add({
        id: backupId, profileId, reason: 'combat-rules-migration', createdAt: now,
        snapshot: { player: current, statAllocations: oldAllocation, cards, activeBattles },
      });
    }
    const loadout = await db.equipmentLoadouts.get(profileId);
    const equippedIds = new Set(loadout
      ? [loadout.weaponId, loadout.armorId, loadout.accessoryId].filter(Boolean) : []);
    const equipment = await db.equipmentInstances.where('profileId').equals(profileId).toArray();
    const equipped = aggregateEquipmentStats(equipment.filter((entry) => equippedIds.has(entry.id)));
    const allocation = freshCombatAllocations(profileId, now);
    // Preserve valid extra sources: never replace a larger existing total with level budget.
    current.statPoints = Math.max(POINTS_PER_LEVEL * Math.max(0, integer(current.level) - 1),
      integer(current.statPoints) + legacyAllocationRefund(oldAllocation));
    recomputePlayer(current, allocation, { health: 'ratio', equipmentHpMax: equipped.hpMax });
    // Legacy MP stays available for saved Workshop effects; it is no longer allocatable.
    current.lifesteal = 0;
    current.updatedAt = now;
    await db.playerStates.put(current);
    await db.statAllocations.put(allocation);
    for (const entry of cards) {
      const starEntry = entry as typeof entry & { stars?: number };
      starEntry.stars = Math.max(1, Math.min(3, integer(starEntry.stars) || 1));
      starEntry.updatedAt = now;
      await db.ownedCards.put(starEntry);
    }
    // Keep the historical session and backup, but never resume an incompatible engine.
    // No battle.finish call: that would incorrectly grant victory/defeat rewards.
    for (const session of activeBattles) {
      await db.battleSessions.update(session.id, { active: false, updatedAt: now });
    }
    await db.profiles.update(profileId, { updatedAt: now });
    return true;
  });
}
