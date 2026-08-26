import type { EquipmentInstanceRecord } from '@/domain/types';

export interface NormalizedEquipmentStats {
  hpMax: number;
  mpMax: number;
  attack: number;
  defense: number;
  speed: number;
  lifesteal: number;
  actionPointsPerTurn: number;
  drawPerTurn: number;
}

type NormalizedEquipmentStat = keyof NormalizedEquipmentStats;

const EQUIPMENT_STAT_DISPLAY_NAMES: Record<string, string> = {
  hp: '生命上限',
  hpMax: '生命上限',
  hp_max: '生命上限',
  '生命': '生命上限',
  '生命上限': '生命上限',
  mp: '魔力上限',
  mpMax: '魔力上限',
  mp_max: '魔力上限',
  '魔力': '魔力上限',
  '魔力上限': '魔力上限',
  attack: '攻击',
  '攻击': '攻击',
  '攻击力': '攻击',
  defense: '防御',
  '防御': '防御',
  '防御力': '防御',
  speed: '速度',
  '速度': '速度',
  lifesteal: '吸血',
  life_steal: '吸血',
  lifeSteal: '吸血',
  lifesteal_percent: '吸血',
  '吸血': '吸血',
  ap: '每回合行动点',
  ap_per_turn: '每回合行动点',
  action_points: '每回合行动点',
  actionPointsPerTurn: '每回合行动点',
  '行动点': '每回合行动点',
  '每回合行动点': '每回合行动点',
  draw: '每回合抽牌',
  draw_per_turn: '每回合抽牌',
  drawPerTurn: '每回合抽牌',
  '抽牌': '每回合抽牌',
  '每回合抽牌': '每回合抽牌',
};

// Only remove a whole, standalone stat clause. Prose such as
// "命中后使目标攻击-1" must remain visible.
const LEGACY_STAT_DESCRIPTION_CLAUSE =
  /^(?:生命(?:上限)?|魔力(?:上限)?|攻击(?:力)?|防御(?:力)?|速度|吸血|行动点|每回合(?:AP|行动点|抽牌)|AP|抽牌|HP|MP)\s*[+＋−-]?\s*\d+(?:\.\d+)?(?:%|％)?(?:点)?[.。]?$/i;

const EQUIPMENT_STAT_ALIASES: Record<string, NormalizedEquipmentStat> = {
  hp: 'hpMax',
  hpMax: 'hpMax',
  hp_max: 'hpMax',
  '生命': 'hpMax',
  '生命上限': 'hpMax',
  mp: 'mpMax',
  mpMax: 'mpMax',
  mp_max: 'mpMax',
  '魔力': 'mpMax',
  '魔力上限': 'mpMax',
  attack: 'attack',
  '攻击': 'attack',
  '攻击力': 'attack',
  defense: 'defense',
  '防御': 'defense',
  '防御力': 'defense',
  speed: 'speed',
  '速度': 'speed',
  lifesteal: 'lifesteal',
  life_steal: 'lifesteal',
  lifeSteal: 'lifesteal',
  lifesteal_percent: 'lifesteal',
  '吸血': 'lifesteal',
  ap: 'actionPointsPerTurn',
  ap_per_turn: 'actionPointsPerTurn',
  action_points: 'actionPointsPerTurn',
  actionPointsPerTurn: 'actionPointsPerTurn',
  '行动点': 'actionPointsPerTurn',
  '每回合行动点': 'actionPointsPerTurn',
  draw: 'drawPerTurn',
  draw_per_turn: 'drawPerTurn',
  drawPerTurn: 'drawPerTurn',
  '抽牌': 'drawPerTurn',
  '每回合抽牌': 'drawPerTurn',
};

function emptyEquipmentStats(): NormalizedEquipmentStats {
  return {
    hpMax: 0,
    mpMax: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    lifesteal: 0,
    actionPointsPerTurn: 0,
    drawPerTurn: 0,
  };
}

export function normalizeEquipmentStats(
  stats: Readonly<Record<string, number>> | null | undefined,
): NormalizedEquipmentStats {
  const normalized = emptyEquipmentStats();
  for (const [rawKey, rawValue] of Object.entries(stats ?? {})) {
    const key = EQUIPMENT_STAT_ALIASES[rawKey];
    const value = Number(rawValue);
    if (!key || !Number.isFinite(value)) continue;
    normalized[key] += value;
  }
  return normalized;
}

export function aggregateEquipmentStats(
  equipment: Iterable<Pick<EquipmentInstanceRecord, 'stats'>>,
): NormalizedEquipmentStats {
  const total = emptyEquipmentStats();
  for (const item of equipment) {
    const stats = normalizeEquipmentStats(item.stats);
    for (const key of Object.keys(total) as NormalizedEquipmentStat[]) {
      total[key] += stats[key];
    }
  }
  return total;
}

/** Format an instance's persisted values, which are already star-scaled. */
export function formatEquipmentStats(
  stats: Readonly<Record<string, number>> | null | undefined,
): string {
  return Object.entries(stats ?? {})
    .flatMap(([key, rawValue]) => {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) return [];
      const name = EQUIPMENT_STAT_DISPLAY_NAMES[key] ?? key;
      const suffix = EQUIPMENT_STAT_ALIASES[key] === 'lifesteal' ? '%' : '';
      return [`${name} ${value >= 0 ? '+' : ''}${value}${suffix}`];
    })
    .join('，');
}

/**
 * Replace legacy/base-value stat clauses with the instance's actual values,
 * while retaining any non-stat equipment effect text.
 */
export function equipmentInstanceDescription(
  equipment: Pick<EquipmentInstanceRecord, 'stats' | 'description'>,
): string {
  const actualStats = formatEquipmentStats(equipment.stats);
  if (!actualStats) return equipment.description.trim();

  const extraDescription = equipment.description
    .split(/[,;，；\n]+/)
    .map((clause) => clause.trim())
    .filter(
      (clause) =>
        clause.length > 0 && !LEGACY_STAT_DESCRIPTION_CLAUSE.test(clause),
    )
    .join('，');

  return [actualStats, extraDescription].filter(Boolean).join('，');
}

export function equipmentStarMultiplier(stars: number): number {
  const numeric = Number(stars);
  const normalized = Number.isFinite(numeric)
    ? Math.max(1, Math.min(3, Math.floor(numeric)))
    : 1;
  return 2 ** (normalized - 1);
}

export function scaleEquipmentStatsByStars(
  baseStats: Readonly<Record<string, number>>,
  stars: number,
): Record<string, number> {
  const multiplier = equipmentStarMultiplier(stars);
  return Object.fromEntries(
    Object.entries(baseStats).map(([key, rawValue]) => {
      const value = Number(rawValue);
      return [key, Number.isFinite(value) ? Math.round(value * multiplier) : 0];
    }),
  );
}

/** Upgrade from the instance's actual values so legacy stars also double exactly. */
export function upgradeEquipmentStats(
  currentStats: Readonly<Record<string, number>>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(currentStats).map(([key, rawValue]) => {
      const value = Number(rawValue);
      return [key, Number.isFinite(value) ? value * 2 : 0];
    }),
  );
}
