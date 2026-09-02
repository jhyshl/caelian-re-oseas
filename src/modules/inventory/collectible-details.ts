import { ACHIEVEMENT_PATCHES } from '@/achievements/patch-registry';
import type { RelicDefinition } from '@/content/types';
import type {
  OwnedRelicRecord,
  SpecialCollectibleRecord,
} from '@/domain/types';

export interface CollectibleDetails {
  id: string;
  kind: 'ordinary' | 'special';
  name: string;
  displayText: string;
  effectText?: string;
}

const SPECIAL_EFFECT_TEXT = new Map(
  ACHIEVEMENT_PATCHES.flatMap((patch) => {
    const collectible = patch.reward.collectible;
    return collectible
      ? ([[collectible.id, collectible.effectText]] as const)
      : [];
  }),
);

function cleanText(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function definitionEffectText(
  definition: RelicDefinition | undefined,
  displayText: string,
): string {
  const description = definition?.description.trim() ?? '';
  if (!description) return '无额外效果。';
  if (!description.startsWith(displayText)) return description;
  return description.slice(displayText.length).trim() || '无额外效果。';
}

export function collectibleDetailsFromRecord(
  record: SpecialCollectibleRecord,
  definition?: RelicDefinition,
): CollectibleDetails {
  const displayText = cleanText(record.summary, '暂无展示文本。');
  const effectText = SPECIAL_EFFECT_TEXT.get(record.collectibleId);
  const special =
    record.collectibleId.startsWith('special_') || Boolean(effectText);
  if (!special) {
    return {
      id: record.id,
      kind: 'ordinary',
      name: record.name,
      displayText,
    };
  }
  return {
    id: record.id,
    kind: 'special',
    name: record.name,
    displayText,
    effectText:
      cleanText(effectText, '') || definitionEffectText(definition, displayText),
  };
}

export function collectibleDetailsFromRelic(
  record: OwnedRelicRecord,
  definition?: RelicDefinition,
  collectible?: SpecialCollectibleRecord,
): CollectibleDetails {
  if (collectible) {
    return collectibleDetailsFromRecord(collectible, definition);
  }
  return {
    id: record.id,
    kind: 'ordinary',
    name: definition?.name ?? record.relicId,
    displayText: cleanText(definition?.description, '暂无展示文本。'),
  };
}
