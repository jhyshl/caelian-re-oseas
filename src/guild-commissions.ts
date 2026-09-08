import regions from '@/content/generated/world/regions.json';
import type { GuildTaskDefinition } from '@/content/catalogs/guild';
import type { RegionAccessRecord, QuestRecord } from '@/domain/types';
import { normalizeRegion } from '@/worldbook/region-switcher';

export function escortDestinations(origin: string, access: RegionAccessRecord[]): string[] {
  const unlocked = new Set(access.filter(row => row.accessible).map(row => row.regionId));
  return regions.filter(row => unlocked.has(row.id) && normalizeRegion(row.name) !== normalizeRegion(origin)).map(row => normalizeRegion(row.name));
}

export function commissionCatalog(tasks: GuildTaskDefinition[]): GuildTaskDefinition[] {
  return tasks.map(raw => {
    const task = { ...raw, id: `${raw.name}:${raw.region}` };
    if (raw.type !== 'investigate') return task;
    const moon = normalizeRegion(raw.region) === '银月之城';
    return { ...task, type: 'combat_gather', target: moon ? '银血蝠' : '林间潜伏者', count: 2,
      items: [{ itemId: moon ? '怨念残留' : '食人花花粉', count: 3 }],
      desc: moon ? '击败银血蝠 ×2，并提交怨念残留 ×3。' : '击败林间潜伏者 ×2，并提交食人花花粉 ×3，完成搜救委托。' };
  });
}

export function commissionBoard(tasks: GuildTaskDefinition[], access: RegionAccessRecord[], day = new Date().toLocaleDateString('sv-SE')): GuildTaskDefinition[] {
  return tasks.flatMap(task => {
    if (task.type !== 'escort') return [task];
    const choices = escortDestinations(task.region, access);
    if (!choices.length) return [];
    let hash = 0;
    for (const char of `${task.id ?? task.name}:${day}`) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    const destination = choices[hash % choices.length]!;
    return [{ ...task, destination, name: `护送${task.name.includes('学者') ? '学者' : '商队'}前往${destination}`,
      desc: `从${normalizeRegion(task.region)}出发，护送至已解锁地区「${destination}」后交付。`, count: 1 }];
  });
}

export function commissionCombatPending(quest: QuestRecord): boolean {
  return ['combat', 'combat_gather'].includes(quest.commissionType ?? '') && (quest.commissionKills ?? quest.currentStage) < quest.totalStages;
}

export function commissionGoalsMet(quest: QuestRecord): boolean {
  if (quest.commissionVersion !== 2) return false;
  if (quest.commissionType === 'combat') return !commissionCombatPending(quest);
  if (quest.commissionType === 'gather') return quest.commissionItemsSubmitted === true;
  if (quest.commissionType === 'combat_gather') return !commissionCombatPending(quest) && quest.commissionItemsSubmitted === true;
  if (quest.commissionType === 'escort') return Boolean(quest.escortArrived && quest.escortDestination && normalizeRegion(quest.escortDestination) !== normalizeRegion(quest.region));
  return false;
}
