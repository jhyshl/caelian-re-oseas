import {
  WORKSHOP_MECHANISM_FORMAT,
  type WorkshopMechanismAction,
  type WorkshopMechanismManifest,
  type WorkshopMechanismStatusEffect,
  type WorkshopMechanismTrigger,
} from '@/workshop-mechanisms';

export type VisualMechanismTarget = 'player' | 'all_enemies' | 'all_summons';
export type VisualResourceOutcomeType =
  | 'damage'
  | 'heal'
  | 'shield'
  | 'apply_buff'
  | 'apply_debuff';

export interface VisualResourceOutcomeDraft {
  type: VisualResourceOutcomeType;
  target: VisualMechanismTarget;
  value: number;
  turns?: number;
  status?: string;
}

export interface VisualResourceGainDraft {
  trigger: Extract<
    WorkshopMechanismTrigger,
    | 'battle_start'
    | 'turn_start'
    | 'after_card'
    | 'player_damaged'
    | 'enemy_damaged'
    | 'summon_created'
    | 'summon_removed'
  >;
  amount: number;
  cardType?: 'attack' | 'defense' | 'skill' | 'summon' | '';
  once?: 'never' | 'battle' | 'turn';
}

export interface VisualResourceThresholdDraft {
  value: number;
  consume: 'none' | 'fixed' | 'all';
  consumeValue?: number;
  outcome: VisualResourceOutcomeDraft;
}

export interface VisualWorkshopResourceDraft {
  id?: string;
  resourceId?: string;
  name: string;
  description?: string;
  min: number;
  max: number;
  initial: number;
  visible: boolean;
  gains: VisualResourceGainDraft[];
  thresholds: VisualResourceThresholdDraft[];
}

export interface VisualWorkshopStatusDraft {
  id?: string;
  statusId?: string;
  name: string;
  description?: string;
  polarity: 'buff' | 'debuff';
  effects: WorkshopMechanismStatusEffect[];
}

function finite(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function clamp(value: unknown, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, finite(value, minimum)));
}

function safeId(value: unknown, fallback: string): string {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || fallback
  );
}

function visualMechanismId(
  value: unknown,
  name: string,
  kind: 'status' | 'resource',
): string {
  const fallback = `visual-${Date.now().toString(36)}`;
  const normalized = safeId(value ?? name, fallback);
  return normalized.startsWith('visual.')
    ? normalized
    : `visual.${kind}.${normalized}`;
}

function outcomeAction(
  outcome: VisualResourceOutcomeDraft,
): WorkshopMechanismAction {
  const value = clamp(outcome.value, 0, 999_999);
  if (outcome.type === 'apply_buff' || outcome.type === 'apply_debuff') {
    return {
      type: outcome.type,
      target: outcome.target,
      value: Math.max(1, value),
      turns: clamp(outcome.turns ?? 1, 1, 99),
      status: safeId(
        outcome.status,
        outcome.type === 'apply_buff' ? 'strength' : 'weak',
      ),
    };
  }
  return { type: outcome.type, target: outcome.target, value };
}

export function compileVisualWorkshopStatus(
  draft: VisualWorkshopStatusDraft,
): WorkshopMechanismManifest {
  const name = String(draft.name ?? '').trim().slice(0, 40);
  const mechanismId = visualMechanismId(draft.id, name, 'status');
  const statusId = safeId(draft.statusId ?? name, 'status');
  return {
    format: WORKSHOP_MECHANISM_FORMAT,
    version: 1,
    engine: 'declarative',
    id: mechanismId,
    name,
    author: '玩家自定义',
    description: String(draft.description ?? '').trim().slice(0, 240),
    resources: [],
    statuses: [
      {
        id: statusId,
        label: name.slice(0, 30) || '自定义状态',
        description: String(draft.description ?? '').trim().slice(0, 120),
        polarity: draft.polarity,
        effects: draft.effects.slice(0, 8).map((effect) => ({
          type: effect.type,
          value:
            effect.type === 'debuff_immunity'
              ? 1
              : clamp(
                  effect.value,
                  0,
                  effect.type === 'damage_reduction' ? 100 : 999_999,
                ),
        })),
      },
    ],
    rules: [],
  };
}

export function compileVisualWorkshopResource(
  draft: VisualWorkshopResourceDraft,
): WorkshopMechanismManifest {
  const name = String(draft.name ?? '').trim().slice(0, 40);
  const mechanismId = visualMechanismId(draft.id, name, 'resource');
  const resourceId = safeId(draft.resourceId ?? name, 'resource');
  const minimum = clamp(draft.min, -999_999, 999_999);
  const maximum = clamp(draft.max, minimum, 999_999);
  const rules: WorkshopMechanismManifest['rules'] = [];

  for (const [index, gain] of draft.gains.slice(0, 6).entries()) {
    const cardCondition =
      gain.trigger === 'after_card' && gain.cardType
        ? ({ type: 'card_type', value: gain.cardType } as const)
        : undefined;
    rules.push({
      id: `${mechanismId}.gain-${index + 1}`,
      trigger: gain.trigger,
      priority: 40,
      once: gain.once ?? 'never',
      ...(cardCondition ? { condition: cardCondition } : {}),
      actions: [
        {
          type: 'resource_add',
          resource: resourceId,
          value: clamp(gain.amount, -999_999, 999_999),
        },
      ],
    });
  }

  for (const [index, threshold] of draft.thresholds.slice(0, 4).entries()) {
    const thresholdValue = clamp(threshold.value, minimum, maximum);
    const actions = [outcomeAction(threshold.outcome)];
    if (threshold.consume === 'all') {
      actions.push({
        type: 'resource_set',
        resource: resourceId,
        value: minimum,
      });
    } else if (threshold.consume === 'fixed') {
      actions.push({
        type: 'resource_add',
        resource: resourceId,
        value: -clamp(threshold.consumeValue ?? thresholdValue, 1, 999_999),
      });
    }
    rules.push({
      id: `${mechanismId}.threshold-${index + 1}`,
      trigger: 'resource_changed',
      priority: 30,
      once: 'never',
      condition: {
        type: 'all',
        conditions: [
          {
            type: 'compare',
            left: { op: 'event', key: 'before' },
            operator: 'lt',
            right: thresholdValue,
          },
          {
            type: 'compare',
            left: { op: 'event', key: 'after' },
            operator: 'gte',
            right: thresholdValue,
          },
        ],
      },
      actions,
    });
  }

  return {
    format: WORKSHOP_MECHANISM_FORMAT,
    version: 1,
    engine: 'declarative',
    id: mechanismId,
    name,
    author: '玩家自定义',
    description: String(draft.description ?? '').trim().slice(0, 240),
    resources: [
      {
        id: resourceId,
        label: name.slice(0, 30) || '自定义资源',
        description: String(draft.description ?? '').trim().slice(0, 120),
        min: minimum,
        max: maximum,
        initial: clamp(draft.initial, minimum, maximum),
        visible: draft.visible !== false,
      },
    ],
    statuses: [],
    rules,
  };
}
