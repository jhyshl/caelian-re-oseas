import type { BattleSessionRecord } from '@/domain/types';

export interface StoryBattleRequest {
  monster: string;
  count: number;
  reason?: string;
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
  const rawCount = Number(field(block, ['count', '数量']));
  const count = Number.isFinite(rawCount)
    ? Math.max(1, Math.min(12, Math.floor(rawCount)))
    : 1;
  const reason = field(block, ['reason', 'source', '原因', '来源']);
  return { monster, count, reason: reason || undefined };
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
  return [
    '<BattleResult>',
    `status: ${state.status === 'surrendered' ? 'escaped' : state.status}`,
    `enemy: ${enemyNames.join('、') || '未知敌人'}`,
    `turns: ${state.turn}`,
    `hp: ${state.player.hp}/${state.player.hpMax}`,
    `mp: ${state.player.mp}/${state.player.mpMax}`,
    `rewards_xp: ${rewards?.experience ?? 0}`,
    `rewards_gold: ${rewards?.gold ?? 0}`,
    `rewards_guild_xp: ${rewards?.guildExperience ?? 0}`,
    `loot: ${loot || '无'}`,
    `used_items: ${usedItems.join('；') || '无'}`,
    `source: ${session.source || '剧情遭遇'}`,
    '</BattleResult>',
  ].join('\n');
}
