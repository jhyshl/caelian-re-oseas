import { questDefinitionSchema } from '@/quests/schema';
import { IMPERIAL_QUEST_ID } from './constants';

/** No authored nodes, stages, transitions or storyline. Active/ready are storage states only. */
export const imperialQuestDefinition = questDefinitionSchema.parse({
  id: IMPERIAL_QUEST_ID, name: '动荡的皇权', kind: 'side', trackingMode: 'imperial',
  region: '全大陆', availableRegions: ['*'], visibility: 'public', minimumLevel: 6,
  publicSummary: '皇位之争牵动多方势力。自由选择立场，或亲自争位；没有预设路线，直到有人继承皇位。完成后获得剧情成就「暗夜与黎明」，亲自登基另获特殊成就「谁人登临长阶」。',
  rewards: { default: { experience: 0, gold: 0, guildExperience: 0, collectibles: [] }, endings: {} },
  pacing: {}, startNodeId: 'imperial:active', nodes: [],
});
