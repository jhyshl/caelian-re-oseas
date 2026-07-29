import type {
  MvuCompanionState,
  MvuNarrativeState,
  SocialProgressRecord,
  StoryFlagRecord,
} from '@/domain/types';

export const MVU_SCHEMA_VERSION = 3 as const;
export const MVU_OWNER = 'caelian-alpha' as const;

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
  storyFlags?: Record<string, boolean>;
}

const DEFAULT_COMPANION: MvuCompanionState = {
  affinity: 0,
  mood: '平静',
  location: '圣德里安学院',
  clothing: '白色暗纹衬衫搭配红金色马甲',
  innerThought: '',
};

export function defaultMvuNarrative(): MvuNarrativeState {
  return {
    companion: { ...DEFAULT_COMPANION },
    storyFlags: {},
  };
}

export function relationshipStage(affinity: number): string {
  if (affinity >= 100) return '伴侣';
  if (affinity >= 81) return '恋人';
  if (affinity >= 51) return '暧昧对象';
  if (affinity >= 21) return '熟人';
  return '陌生人';
}

export function createMvuNarrative(
  social: SocialProgressRecord,
  storyFlags: StoryFlagRecord[],
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

  return {
    ...(Object.keys(companion).length > 0 ? { companion } : {}),
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
  return {
    ...(Object.keys(companion).length > 0 ? { companion } : {}),
    ...(patch.storyFlags
      ? { storyFlags: parseFlags(patch.storyFlags) }
      : {}),
  };
}

function parseNarrative(
  narrative: Record<string, unknown>,
): MvuNarrativePatch {
  const rawCompanion = asRecord(narrative.companion);
  const companion: Partial<MvuCompanionState> = {};
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
  const rawFlags = asRecord(narrative.storyFlags);
  return {
    ...(Object.keys(companion).length > 0 ? { companion } : {}),
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

function clampAffinity(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function cleanKey(value: string): string {
  return value.trim().slice(0, 80);
}

function cleanText(
  value: string,
  maximum: number,
  fallback: string,
): string {
  return value.trim().slice(0, maximum) || fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
