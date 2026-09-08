import { commissionCatalog } from '@/guild-commissions';

export interface GuildTaskDefinition {
  id?: string;
  destination?: string;
  items?: Array<{ itemId: string; count: number }>;
  name: string;
  type: string;
  difficulty: string;
  desc: string;
  region: string;
  target?: string;
  count?: number;
  xp: number;
  gold: number;
  gxp: number;
  lvl: number;
  [key: string]: unknown;
}

export interface GuildRankRequirement {
  xp: number;
  tasks: number;
}

let taskCache: GuildTaskDefinition[] | undefined;
let rankNameCache: Record<string, string> | undefined;
let rankRequirementCache: Record<string, GuildRankRequirement> | undefined;
let typeNameCache: Record<string, string> | undefined;
let typeIconCache: Record<string, string> | undefined;
let difficultyNameCache: Record<string, string> | undefined;

export async function loadGuildCatalogs() {
  if (
    !taskCache ||
    !rankNameCache ||
    !rankRequirementCache ||
    !typeNameCache ||
    !typeIconCache ||
    !difficultyNameCache
  ) {
    const [tasks, rankNames, rankRequirements, typeNames, typeIcons, difficulties] =
      await Promise.all([
        import('@/content/generated/quests/task-pool.json'),
        import('@/content/generated/quests/rank-names.json'),
        import(
          '@/content/generated/progression/guild-rank-requirements.json'
        ),
        import('@/content/generated/quests/type-names.json'),
        import('@/content/generated/quests/type-icons.json'),
        import('@/content/generated/quests/difficulty-names.json'),
      ]);
    taskCache = commissionCatalog(tasks.default as GuildTaskDefinition[]);
    rankNameCache = rankNames.default as Record<string, string>;
    rankRequirementCache = rankRequirements.default as Record<
      string,
      GuildRankRequirement
    >;
    typeNameCache = { ...typeNames.default, gather: '提交物品', combat_gather: '战斗＋提交物品', escort: '跨区护送' };
    typeIconCache = { ...typeIcons.default, combat_gather: '⚔', escort: '🚩' };
    difficultyNameCache = difficulties.default as Record<string, string>;
  }
  return {
    tasks: taskCache,
    rankNames: rankNameCache,
    rankRequirements: rankRequirementCache,
    typeNames: typeNameCache,
    typeIcons: typeIconCache,
    difficultyNames: difficultyNameCache,
  };
}
