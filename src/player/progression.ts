import type { PlayerRecord } from '@/domain/types';

export const STAT_POINTS_PER_LEVEL = 8;

type ExperienceState = Pick<
  PlayerRecord,
  'experience' | 'experienceToNext' | 'level' | 'statPoints'
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
  }
  return player.level - startingLevel;
}
