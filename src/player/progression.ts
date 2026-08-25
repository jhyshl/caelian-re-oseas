import type { PlayerRecord } from '@/domain/types';

export const STAT_POINTS_PER_LEVEL = 10;
export const LIFESTEAL_STAT_POINT_COST = 2;
export const LIFESTEAL_CAP = 30;

type ExperienceState = Pick<
  PlayerRecord,
  | 'experience'
  | 'experienceToNext'
  | 'level'
  | 'statPoints'
  | 'pendingLevelRewards'
>;

export function grantPlayerExperience(
  player: ExperienceState,
  experience: number,
): number {
  const startingLevel = player.level;
  player.experience += experience;
  while (player.experience >= player.experienceToNext) {
    player.experience -= player.experienceToNext;
    player.level += 1;
    player.statPoints += STAT_POINTS_PER_LEVEL;
    player.experienceToNext = 100 + (player.level - 1) * 50;
    player.pendingLevelRewards ??= [];
    player.pendingLevelRewards.push({
      id: `level-${player.level}`,
      level: player.level,
      equipmentIds: [],
      relicIds: [],
      equipmentClaimed: false,
      relicClaimed: false,
    });
  }
  return player.level - startingLevel;
}
