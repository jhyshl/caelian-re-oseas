import type { AchievementDefinition } from '@/content/types';
import {
  achievementCategory,
  PAST_PRESENT_POEM_DEFINITION,
  PAST_PRESENT_POEM_ID,
} from '@/achievements/catalog';
import { PATCH_ACHIEVEMENT_DEFINITIONS } from '@/achievements/patch-registry';

let achievementCache:
  | Record<string, AchievementDefinition>
  | undefined;

export async function loadAchievementDefinitions() {
  if (!achievementCache) {
    const module = await import(
      '@/content/generated/achievements/definitions.json'
    );
    const legacy = module.default as unknown as Record<
      string,
      AchievementDefinition
    >;
    achievementCache = Object.fromEntries(
      Object.entries({
        ...legacy,
        ...PATCH_ACHIEVEMENT_DEFINITIONS,
        [PAST_PRESENT_POEM_ID]: PAST_PRESENT_POEM_DEFINITION,
      }).map(([id, definition]) => [
        id,
        {
          ...definition,
          id,
          ...(id === 'ach_caelian_affection_100'
            ? { condition: '凯利安好感度首次到达500' }
            : {}),
          category: definition.category ?? achievementCategory(id),
        },
      ]),
    );
  }
  return achievementCache;
}
