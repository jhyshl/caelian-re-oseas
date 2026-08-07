import type { GuildRecord } from '@/domain/types';

const RANKS = [
  ['copper', 0],
  ['iron', 200],
  ['silver', 600],
  ['gold', 1_500],
  ['platinum', 3_500],
  ['mythril', 7_000],
  ['adamantite', 15_000],
] as const;

export function updateGuildRank(guild: GuildRecord): string {
  if (guild.rank === 'unregistered') return guild.rank;
  let next = 'copper';
  for (const [rank, experience] of RANKS) {
    if (guild.experience >= experience) next = rank;
  }
  guild.rank = next;
  return next;
}
