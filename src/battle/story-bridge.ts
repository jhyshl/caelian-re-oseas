import type { BattleSessionRecord } from '@/domain/types';

export interface StoryBattleRequest {
  monster: string;
  count: number;
  reason?: string;
  userInvolved: true;
  caelianPresent: boolean;
}

const BATTLE_START_PATTERN = /<BattleStart\b[^>]*>([\s\S]*?)<\/BattleStart>/i;

function field(block: string, names: string[]): string {
  for (const name of names) {
    const match = block.match(
      new RegExp(`(?:^|\\n)\\s*${name}\\s*[：:]\\s*(.+?)\\s*(?=\\n|$)`, 'i'),
    );
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

export function parseStoryBattleStart(text: string): StoryBattleRequest | null {
  const block = text.match(BATTLE_START_PATTERN)?.[1];
  if (!block) return null;
  const monster = field(block, ['monster', 'enemy', '怪物', '敌人']);
  if (!monster) return null;
  const userInvolved = field(block, [
    'user_involved',
    'player_involved',
    '用户参战',
    '玩家参战',
  ]).toLowerCase();
  if (!['true', '1', 'yes', '是'].includes(userInvolved)) return null;
  const rawCount = Number(field(block, ['count', '数量']));
  const count = Number.isFinite(rawCount)
    ? Math.max(1, Math.min(12, Math.floor(rawCount)))
    : 1;
  const reason = field(block, ['reason', 'source', '原因', '来源']);
  const caelianPresent = field(block, [
    'caelian_present',
    'caelian_nearby',
    '凯利安在场',
    '凯利安同行',
  ]).toLowerCase();
  return {
    monster,
    count,
    reason: reason || undefined,
    userInvolved: true,
    caelianPresent: ['true', '1', 'yes', '是'].includes(caelianPresent),
  };
}

export function formatStoryBattleResult(session: BattleSessionRecord): string {
  const state = session.state;
  const rewards = state.rewards;
  const enemyNames = [...new Set(state.enemies.map((enemy) => enemy.name))];
  const usedItems = state.log
    .filter((entry) => entry.kind === 'player' && /使用.+(?:药|剂|瓶|道具)/.test(entry.text))
    .map((entry) => entry.text.replace(/[。.]$/, ''));
  const loot = rewards?.items
    .map((item) => `${item.name}×${item.quantity}`)
    .join('、');
  const companion = state.companion;
  const trelio = companion?.summons.find((summon) => summon.id === 'trelio');
  return [
    '<BattleResult>',
    `status: ${state.status === 'surrendered' ? 'escaped' : state.status}`,
    `enemy: ${enemyNames.join('、') || '未知敌人'}`,
    `turns: ${state.turn}`,
    `hp: ${state.player.hp}/${state.player.hpMax}`,
    `mp: ${state.player.mp}/${state.player.mpMax}`,
    `caelian: ${companion ? (companion.injured ? 'injured' : 'active') : 'absent'}`,
    `caelian_hp: ${companion ? `${companion.hp}/${companion.hpMax}` : 'n/a'}`,
    `trelio_hp: ${trelio ? `${trelio.hp}/${trelio.hpMax}` : 'n/a'}`,
    `rewards_xp: ${rewards?.experience ?? 0}`,
    `rewards_gold: ${rewards?.gold ?? 0}`,
    `rewards_guild_xp: ${rewards?.guildExperience ?? 0}`,
    `loot: ${loot || '无'}`,
    `used_items: ${usedItems.join('；') || '无'}`,
    `source: ${session.source || '剧情遭遇'}`,
    '</BattleResult>',
  ].join('\n');
}
