import type { CardDefinition } from '@/content/types';
import { WORKSHOP_STATUS_LIBRARY } from '@/workshop-status-library';
import { workshopStatusKey, type WorkshopMechanismManifest } from '@/workshop-mechanisms';
import type { RuleProgram } from '@/workshop-program';
import rawBattleCatalog from '@/battle/rework/catalog.json';

export interface WorkshopObjectChoice { id: string; name: string; group: string }
export interface WorkshopObjectCatalog {
  cards: WorkshopObjectChoice[];
  statuses: WorkshopObjectChoice[];
  resources: WorkshopObjectChoice[];
}
export const emptyWorkshopObjectCatalog = (): WorkshopObjectCatalog => ({ cards: [], statuses: [], resources: [] });
export function workshopObjectCatalog(
  cards: Record<string, CardDefinition>,
  mechanisms: WorkshopMechanismManifest[],
  draft?: { cards: Array<CardDefinition & { id: string }>; talent: { effects: unknown[] } },
): WorkshopObjectCatalog {
  const statuses: WorkshopObjectChoice[] = WORKSHOP_STATUS_LIBRARY.map(s => ({ id: s.id, name: s.name, group: s.polarity }));
  const resources: WorkshopObjectChoice[] = [['ap', '行动点 AP'], ['energy', '能量']].map(([id, name]) => ({ id: id!, name: name!, group: '基础资源' }));
  const nativeResources = new Set<string>();
  const scanResources = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const resource = (value as { resource?: unknown }).resource;
    if (typeof resource === 'string' && resource.length < 20 && resource !== 'AP') nativeResources.add(resource);
    Object.values(value).forEach(scanResources);
  };
  scanResources(rawBattleCatalog.cards);
  resources.push(...[...nativeResources].map(id => ({ id, name: id, group: '职业资源' })));
  for (const m of mechanisms) {
    statuses.push(...m.statuses.map(s => ({ id: workshopStatusKey(m.id, s.id), name: s.label, group: m.name })));
    resources.push(...m.resources.map(r => ({ id: `workshop_resource:${m.id}:${r.id}`, name: r.label, group: m.name })));
  }
  const scan = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if ((value as RuleProgram).version === 2 && Array.isArray((value as RuleProgram).statuses)) {
      const program = value as RuleProgram;
      statuses.push(...program.statuses.map(s => ({ id: `program_status:${program.id}:${s.id}`, name: s.name, group: program.name })));
    }
    for (const child of Object.values(value)) scan(child);
  };
  scan(cards); scan(draft);
  const unique = (list: WorkshopObjectChoice[]) => [...new Map(list.map(item => [item.id, item])).values()];
  return {
    cards: unique([...rawBattleCatalog.cards.map(c=>({id:c.id,name:c.name,group:'官方卡牌'})), ...Object.entries(cards).map(([id, c]) => ({ id, name: c.name, group: c.battleOnly ? '战斗专用牌' : '卡牌' })), ...(draft?.cards ?? []).map(c => ({ id: c.id, name: c.name, group: c.battleOnly ? '草稿·战斗专用牌' : '草稿卡牌' }))]),
    statuses: unique(statuses), resources: unique(resources),
  };
}
