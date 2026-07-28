import type { AchievementDefinition } from '@/content/types';

let achievementCache:
  | Record<string, AchievementDefinition>
  | undefined;

export async function loadAchievementDefinitions() {
  if (!achievementCache) {
    const module = await import(
      '@/content/generated/achievements/definitions.json'
    );
    achievementCache = module.default as unknown as Record<
      string,
      AchievementDefinition
    >;
  }
  return achievementCache;
}
