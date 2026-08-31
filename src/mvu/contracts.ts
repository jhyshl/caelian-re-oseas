import type {
  MvuCompanionState,
  MvuNarrativeState,
  MvuNarrativeWorldState,
  SocialProgressRecord,
  StoryFlagRecord,
  WorldStateRecord,
} from '@/domain/types';

export const MVU_SCHEMA_VERSION = 3 as const;
export const MVU_OWNER = 'caelian-alpha' as const;
export const AFFINITY_MAX = 500;

export const RELATIONSHIP_MILESTONES = [
  { threshold: 101, label: '伙伴' },
  { threshold: 251, label: '暧昧对象' },
  { threshold: 401, label: '恋人' },
  { threshold: 500, label: '伴侣' },
] as const;

export const LEGACY_STAT_DATA_KEYS = [
  '世界',
  '地区剧情',
  '凯利安',
  '玩家',
  '协会',
  '战斗',
] as const;

export interface MvuNarrativePatch {
  companion?: Partial<MvuCompanionState>;
  world?: Partial<MvuNarrativeWorldState>;
  storyFlags?: Record<string, boolean>;
}

const DEFAULT_COMPANION: MvuCompanionState = {
  affinity: 0,
  mood: '平静',
  location: '圣德里安学院',
  clothing: '白色暗纹衬衫搭配红金色马甲',
  innerThought: '',
};

const DEFAULT_WORLD: MvuNarrativeWorldState = {
  region: '伊拉亚城',
  place: '宿舍楼',
  location: '圣德里安学院-宿舍楼',
  gameDate: '新圣约历1385-09-01',
  gameTime: '08:00',
  weather: '晴朗',
};

export function defaultMvuNarrative(): MvuNarrativeState {
  return {
    companion: { ...DEFAULT_COMPANION },
    world: { ...DEFAULT_WORLD },
    storyFlags: {},
  };
}

export function relationshipStage(affinity: number): string {
  if (affinity >= 500) return '伴侣';
  if (affinity >= 401) return '恋人';
  if (affinity >= 251) return '暧昧对象';
  if (affinity >= 101) return '伙伴';
  return '陌生人';
}

export function createMvuNarrative(
  social: SocialProgressRecord,
  storyFlags: StoryFlagRecord[],
  world: WorldStateRecord,
): MvuNarrativeState {
  return {
    companion: {
      affinity: clampAffinity(social.affinity),
      mood: cleanText(social.mood, 80, DEFAULT_COMPANION.mood),
      location: cleanText(
        social.location,
        120,
        DEFAULT_COMPANION.location,
      ),
      clothing: cleanText(
        social.clothing,
        240,
        DEFAULT_COMPANION.clothing,
      ),
      innerThought: cleanText(social.innerThought, 500, ''),
    },
    world: {
      region: cleanText(world.region, 120, DEFAULT_WORLD.region),
      place: cleanText(world.place, 120, '', true),
      location: cleanText(world.location, 180, DEFAULT_WORLD.location),
      gameDate: cleanText(world.gameDate, 80, DEFAULT_WORLD.gameDate),
      gameTime: cleanText(world.gameTime, 40, DEFAULT_WORLD.gameTime),
      weather: cleanText(world.weather, 80, DEFAULT_WORLD.weather),
    },
    storyFlags: Object.fromEntries(
      storyFlags
        .filter((flag) => flag.value)
        .slice(0, 64)
        .flatMap((flag) => {
          const key = cleanKey(flag.key);
          return key ? ([[key, true]] as Array<[string, boolean]>) : [];
        }),
    ),
  };
}

export function extractMvuNarrativePatch(
  mvuData: Record<string, unknown>,
): MvuNarrativePatch | null {
  const statData = asRecord(mvuData.stat_data);
  const caelian = asRecord(statData.caelian);
  const narrative = asRecord(caelian.narrative);
  if (Object.keys(narrative).length > 0) {
    return parseNarrative(narrative);
  }

  const legacyCompanion = asRecord(statData['凯利安']);
  const legacyWorld = asRecord(statData['世界']);
  const legacyFlags = asRecord(legacyWorld['剧情标记']);
  if (
    Object.keys(legacyCompanion).length === 0 &&
    Object.keys(legacyFlags).length === 0
  ) {
    return null;
  }

  const companion: Partial<MvuCompanionState> = {};
  assignNumber(companion, 'affinity', legacyCompanion['好感度']);
  assignText(companion, 'mood', legacyCompanion['情绪'], 80);
  assignText(companion, 'location', legacyCompanion['当前位置'], 120);
  assignText(companion, 'clothing', legacyCompanion['衣着'], 240);
  assignText(
    companion,
    'innerThought',
    legacyCompanion['内心想法'],
    500,
    true,
  );
  const world: Partial<MvuNarrativeWorldState> = {};
  assignWorldText(world, 'region', legacyWorld['当前地区'], 120);
  assignWorldText(world, 'place', legacyWorld['当前地点'], 120, true);
  assignWorldText(world, 'location', legacyWorld['当前位置'], 180);
  assignWorldText(world, 'gameDate', legacyWorld['日期'], 80);
  assignWorldText(world, 'gameTime', legacyWorld['时间'], 40);
  assignWorldText(world, 'weather', legacyWorld['天气'], 80);

  return {
    ...(Object.keys(companion).length > 0 ? { companion } : {}),
    ...(Object.keys(world).length > 0 ? { world } : {}),
    ...(Object.keys(legacyFlags).length > 0
      ? { storyFlags: parseFlags(legacyFlags) }
      : {}),
  };
}

export function hasLegacyMvuState(
  mvuData: Record<string, unknown>,
): boolean {
  const statData = asRecord(mvuData.stat_data);
  return LEGACY_STAT_DATA_KEYS.some((key) => key in statData);
}

export function normalizeNarrativePatch(
  patch: MvuNarrativePatch,
): MvuNarrativePatch {
  const companion: Partial<MvuCompanionState> = {};
  const world: Partial<MvuNarrativeWorldState> = {};
  if (patch.companion) {
    assignNumber(companion, 'affinity', patch.companion.affinity);
    assignText(companion, 'mood', patch.companion.mood, 80);
    assignText(companion, 'location', patch.companion.location, 120);
    assignText(companion, 'clothing', patch.companion.clothing, 240);
    assignText(
      companion,
      'innerThought',
      patch.companion.innerThought,
      500,
      true,
    );
  }
  if (patch.world) {
    assignWorldText(world, 'region', patch.world.region, 120);
    assignWorldText(world, 'place', patch.world.place, 120, true);
    assignWorldText(world, 'location', patch.world.location, 180);
    assignWorldText(world, 'gameDate', patch.world.gameDate, 80);
    assignWorldText(world, 'gameTime', patch.world.gameTime, 40);
    assignWorldText(world, 'weather', patch.world.weather, 80);
  }
  return {
    ...(Object.keys(companion).length > 0 ? { companion } : {}),
    ...(Object.keys(world).length > 0 ? { world } : {}),
    ...(patch.storyFlags
      ? { storyFlags: parseFlags(patch.storyFlags) }
      : {}),
  };
}

function parseNarrative(
  narrative: Record<string, unknown>,
): MvuNarrativePatch {
  const rawCompanion = asRecord(narrative.companion);
  const rawWorld = asRecord(narrative.world);
  const companion: Partial<MvuCompanionState> = {};
  const world: Partial<MvuNarrativeWorldState> = {};
  assignNumber(companion, 'affinity', rawCompanion.affinity);
  assignText(companion, 'mood', rawCompanion.mood, 80);
  assignText(companion, 'location', rawCompanion.location, 120);
  assignText(companion, 'clothing', rawCompanion.clothing, 240);
  assignText(
    companion,
    'innerThought',
    rawCompanion.innerThought,
    500,
    true,
  );
  assignWorldText(world, 'region', rawWorld.region, 120);
  assignWorldText(world, 'place', rawWorld.place, 120, true);
  assignWorldText(world, 'location', rawWorld.location, 180);
  assignWorldText(world, 'gameDate', rawWorld.gameDate, 80);
  assignWorldText(world, 'gameTime', rawWorld.gameTime, 40);
  assignWorldText(world, 'weather', rawWorld.weather, 80);
  const rawFlags = asRecord(narrative.storyFlags);
  return {
    ...(Object.keys(companion).length > 0 ? { companion } : {}),
    ...(Object.keys(world).length > 0 ? { world } : {}),
    ...(Object.keys(rawFlags).length > 0
      ? { storyFlags: parseFlags(rawFlags) }
      : {}),
  };
}

function parseFlags(value: Record<string, unknown>): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 64)
      .flatMap(([rawKey, flag]) => {
        const key = cleanKey(rawKey);
        return key
          ? ([[key, flag === true]] as Array<[string, boolean]>)
          : [];
      }),
  );
}

function assignNumber<K extends keyof MvuCompanionState>(
  target: Partial<MvuCompanionState>,
  key: K,
  value: unknown,
): void {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  target[key] = clampAffinity(number) as MvuCompanionState[K];
}

function assignText<K extends keyof MvuCompanionState>(
  target: Partial<MvuCompanionState>,
  key: K,
  value: unknown,
  maximum: number,
  allowEmpty = false,
): void {
  if (typeof value !== 'string') return;
  const text = value.trim().slice(0, maximum);
  if (!text && !allowEmpty) return;
  target[key] = text as MvuCompanionState[K];
}

function assignWorldText<K extends keyof MvuNarrativeWorldState>(
  target: Partial<MvuNarrativeWorldState>,
  key: K,
  value: unknown,
  maximum: number,
  allowEmpty = false,
): void {
  if (typeof value !== 'string') return;
  const text = value.trim().slice(0, maximum);
  if (!text && !allowEmpty) return;
  target[key] = text as MvuNarrativeWorldState[K];
}

function clampAffinity(value: number): number {
  const clamped = Math.max(0, Math.min(AFFINITY_MAX, value));
  return Math.round(clamped * 2) / 2;
}

function cleanKey(value: string): string {
  return value.trim().slice(0, 80);
}

function cleanText(
  value: string,
  maximum: number,
  fallback: string,
  allowEmpty = false,
): string {
  const text = value.trim().slice(0, maximum);
  return text || (allowEmpty ? '' : fallback);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
