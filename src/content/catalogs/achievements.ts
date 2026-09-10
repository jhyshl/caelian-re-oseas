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
        ach_imperial_night_and_dawn: {
          id: 'ach_imperial_night_and_dawn', name: '暗夜与黎明', star: 5,
          condition: '完成支线「动荡的皇权」', description: '拥有权力的缺点：期待奇迹的出现', category: 'story', source: 'imperial_succession',
        },
        ach_imperial_long_stair: {
          id: 'ach_imperial_long_stair', name: '谁人登临长阶', star: 5,
          condition: '在「动荡的皇权」中亲自继承皇位', description: '我来，我见，我征服', category: 'special', source: 'imperial_succession',
        },
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
