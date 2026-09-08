import type { CardDefinition, CardEffect } from '@/content/types';

export interface StarScale { flat: number; ratio: number }
export interface WorkshopStarScaling { version: 1; levels: [StarScale, StarScale, StarScale] }
export interface WorkshopStarTemplate { id: string; name: string; scaling: WorkshopStarScaling }
const STORAGE_KEY = 'caelian_workshop_star_templates_v1';
export const DEFAULT_STAR_SCALING: WorkshopStarScaling = { version: 1, levels: [{ flat: 1, ratio: 1 }, { flat: 1.1, ratio: 1.1 }, { flat: 1.2, ratio: 1.2 }] };
export function normalizeStarScaling(value: unknown): WorkshopStarScaling | undefined {
  if (value === undefined || value === null) return undefined;
  const data = value as WorkshopStarScaling;
  if (data.version !== 1 || !Array.isArray(data.levels) || data.levels.length !== 3 || data.levels.some(row => !row || [row.flat, row.ratio].some(n => typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 100))) {
    throw new Error('星级模板需要完整的一至三星配置，固定值和属性倍率系数均须大于0且不超过100');
  }
  return { version: 1, levels: data.levels.map(row => ({ flat: row.flat, ratio: row.ratio })) as WorkshopStarScaling['levels'] };
}
export function needsWorkshopStars(card?: CardDefinition): boolean {
  if (card?.custom !== true) return false;
  try { return !normalizeStarScaling(card.starScaling); } catch { return true; }
}
const GROWING = new Set(['damage', 'heal', 'shield', 'trap', 'damage_per_debuff', 'discard_all_damage', 'discard_blank_damage', 'spend_mp_damage', 'spend_mp_shield', 'heal_overflow_shield', 'thorns']);
export function scaleWorkshopCard(card: CardDefinition, stars = 1): CardDefinition {
  if (card.custom !== true || needsWorkshopStars(card)) return card;
  const config = normalizeStarScaling(card.starScaling)!;
  const scale = config.levels[Math.max(0, Math.min(2, Math.floor(stars) - 1))]!;
  function effect(raw: CardEffect): CardEffect {
    const next = JSON.parse(JSON.stringify(raw)) as CardEffect;
    if (GROWING.has(raw.type) || raw.type === 'apply_debuff' && ['poison', 'burn', 'bleed', 'corrosion', 'curse'].includes(String(raw.debuff))) {
      if (typeof next.value === 'number') next.value *= scale.flat;
      if (next.scaling && typeof next.scaling === 'object') {
        const scaling = next.scaling as { percent?: number };
        if (typeof scaling.percent === 'number') scaling.percent *= scale.ratio;
        next.starRatioMultiplier = scale.ratio;
      }
      if (typeof next.ratio === 'number') next.ratio *= scale.ratio;
    }
    for (const key of ['effects', 'then_effects', 'else_effects']) if (Array.isArray(next[key])) next[key] = (next[key] as CardEffect[]).map(effect);
    if (Array.isArray(next.skills)) next.skills = next.skills.map(skill => ({ ...skill, effects: (skill.effects ?? []).map(effect) }));
    return next;
  }
  return { ...card, effects: card.effects.map(effect), resolvedStarScale: scale };
}
export function workshopStarDescription(card: CardDefinition, stars: number): string {
  if (needsWorkshopStars(card)) return '旧版自定义卡牌：请到创意工坊配置一至三星数值';
  const row = normalizeStarScaling(card.starScaling)?.levels[Math.max(0, Math.min(2, stars - 1))];
  return row ? `${card.description}｜${stars}★：基础值×${row.flat}，属性倍率×${row.ratio}` : card.description;
}
export function readStarTemplates(): WorkshopStarTemplate[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(row => { try { const scaling = normalizeStarScaling(row.scaling); return scaling && typeof row.id === 'string' && typeof row.name === 'string' ? [{ id: row.id, name: row.name, scaling }] : []; } catch { return []; } });
  } catch { return []; }
}
export function saveStarTemplate(name: string, scaling: WorkshopStarScaling): void {
  name = name.trim().slice(0, 40); if (!name) throw new Error('请填写模板名称');
  const templates = readStarTemplates().filter(row => row.name !== name);
  templates.push({ id: `custom:${name}`, name, scaling: normalizeStarScaling(scaling)! });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}
let pendingEditorCard = '';
export function requestStarEditor(cardId: string): void {
  pendingEditorCard = cardId;
  window.dispatchEvent(new CustomEvent('caelian:workshop-star-editor'));
}
export function takeStarEditorRequest(): string { const id = pendingEditorCard; pendingEditorCard = ''; return id; }
