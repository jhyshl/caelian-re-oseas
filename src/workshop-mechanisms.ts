import type { LocalBattleState } from '@/domain/types';

export const WORKSHOP_MECHANISM_FORMAT = 'caelian_workshop_mechanism';
export const WORKSHOP_SCRIPT_MECHANISM_FORMAT =
  'caelian_workshop_script_mechanism';
export const WORKSHOP_MECHANISM_STORAGE_KEY =
  'caelian_custom_workshop_mechanisms_v1';

export type WorkshopMechanismTrigger =
  | 'battle_start'
  | 'turn_start'
  | 'turn_end'
  | 'before_card'
  | 'after_card'
  | 'before_damage'
  | 'before_debuff'
  | 'resource_changed'
  | 'before_enemy_turn'
  | 'after_enemy_turn'
  | 'player_damaged'
  | 'enemy_damaged'
  | 'summon_created'
  | 'summon_removed'
  | 'battle_victory'
  | 'battle_defeat';

export type WorkshopFormula =
  | number
  | {
      op:
        | 'stat'
        | 'resource'
        | 'event'
        | 'add'
        | 'sub'
        | 'mul'
        | 'div'
        | 'min'
        | 'max'
        | 'floor'
        | 'ceil'
        | 'clamp';
      path?: string;
      id?: string;
      key?: string;
      args?: WorkshopFormula[];
      value?: WorkshopFormula;
      min?: WorkshopFormula;
      max?: WorkshopFormula;
    };

export interface WorkshopMechanismCondition {
  type:
    | 'compare'
    | 'all'
    | 'any'
    | 'not'
    | 'chance'
    | 'card_type'
    | 'has_buff'
    | 'has_debuff';
  left?: WorkshopFormula;
  operator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
  right?: WorkshopFormula;
  conditions?: WorkshopMechanismCondition[];
  condition?: WorkshopMechanismCondition;
  value?: string | number;
  target?: 'player' | 'selected_enemy';
}

export interface WorkshopMechanismAction {
  type:
    | 'resource_add'
    | 'resource_set'
    | 'damage'
    | 'heal'
    | 'shield'
    | 'draw'
    | 'gain_ap'
    | 'gain_mp'
    | 'apply_buff'
    | 'apply_debuff'
    | 'apply_status'
    | 'cleanse'
    | 'discard_random'
    | 'recover_discard'
    | 'event_multiply'
    | 'event_cancel'
    | 'log';
  resource?: string;
  target?: 'player' | 'selected_enemy' | 'all_enemies' | 'all_summons';
  value?: WorkshopFormula;
  turns?: WorkshopFormula;
  status?: string;
  message?: string;
}

export interface WorkshopMechanismResource {
  id: string;
  label: string;
  description: string;
  min: number;
  max: number;
  initial: number;
  visible: boolean;
}

export interface WorkshopMechanismStatusEffect {
  type:
    | 'damage_reduction'
    | 'debuff_immunity'
    | 'turn_heal'
    | 'turn_shield'
    | 'turn_damage'
    | 'damage_bonus';
  value: number;
}

export interface WorkshopMechanismStatus {
  id: string;
  label: string;
  description: string;
  polarity: 'buff' | 'debuff';
  effects: WorkshopMechanismStatusEffect[];
}

export interface WorkshopMechanismRule {
  id: string;
  trigger: WorkshopMechanismTrigger;
  priority: number;
  once: 'never' | 'battle' | 'turn';
  condition?: WorkshopMechanismCondition;
  actions: WorkshopMechanismAction[];
}

export interface WorkshopMechanismManifest {
  format:
    | typeof WORKSHOP_MECHANISM_FORMAT
    | typeof WORKSHOP_SCRIPT_MECHANISM_FORMAT;
  version: 1;
  engine: 'declarative' | 'script';
  id: string;
  name: string;
  author: string;
  description: string;
  resources: WorkshopMechanismResource[];
  statuses: WorkshopMechanismStatus[];
  rules: WorkshopMechanismRule[];
  /** Script mechanisms run inside an isolated QuickJS runtime. */
  source?: string;
  entrypoint?: string;
  triggers?: WorkshopMechanismTrigger[];
  priority?: number;
}

export interface WorkshopScriptMechanismResult {
  actions: WorkshopMechanismAction[];
  resources: Record<string, number>;
  event: Record<string, number | boolean | string | string[]>;
}

export interface WorkshopMechanismRuntimeContext {
  state: LocalBattleState;
  resources: Record<string, number>;
  event: Record<string, unknown>;
  random: () => number;
}

type UnknownRecord = Record<string, unknown>;

const TRIGGERS = new Set<WorkshopMechanismTrigger>([
  'battle_start',
  'turn_start',
  'turn_end',
  'before_card',
  'after_card',
  'before_damage',
  'before_debuff',
  'resource_changed',
  'before_enemy_turn',
  'after_enemy_turn',
  'player_damaged',
  'enemy_damaged',
  'summon_created',
  'summon_removed',
  'battle_victory',
  'battle_defeat',
]);
const ACTIONS = new Set<WorkshopMechanismAction['type']>([
  'resource_add',
  'resource_set',
  'damage',
  'heal',
  'shield',
  'draw',
  'gain_ap',
  'gain_mp',
  'apply_buff',
  'apply_debuff',
  'apply_status',
  'cleanse',
  'discard_random',
  'recover_discard',
  'event_multiply',
  'event_cancel',
  'log',
]);
const SAFE_STATS = new Set([
  'player.hp',
  'player.hpMax',
  'player.mp',
  'player.mpMax',
  'player.shield',
  'player.attack',
  'player.defense',
  'player.speed',
  'player.ap',
  'player.apMax',
  'battle.turn',
  'enemy.hp',
  'enemy.hpMax',
  'enemy.shield',
  'enemy.attack',
  'enemy.defense',
  'enemies.alive',
  'summons.count',
  'hand.count',
  'discard.count',
]);

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function limitedText(value: unknown, maximum: number): string {
  return String(value ?? '').trim().slice(0, maximum);
}

function safeId(value: unknown, fallback = ''): string {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || fallback
  );
}

function finite(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function normalizeFormula(value: unknown, depth = 0): WorkshopFormula {
  if (depth > 8) throw new Error('机制公式嵌套超过 8 层。');
  if (typeof value === 'number') return Math.max(-999_999, Math.min(999_999, value));
  const source = record(value);
  const op = String(source.op ?? '');
  if (![
    'stat', 'resource', 'event', 'add', 'sub', 'mul', 'div', 'min', 'max',
    'floor', 'ceil', 'clamp',
  ].includes(op)) throw new Error(`不支持的公式操作：${op || '空'}`);
  if (op === 'stat') {
    const path = String(source.path ?? '');
    if (!SAFE_STATS.has(path)) throw new Error(`公式不能读取状态：${path}`);
    return { op, path };
  }
  if (op === 'resource') return { op, id: safeId(source.id, 'resource') };
  if (op === 'event') {
    const key = safeId(source.key, 'value');
    return { op, key };
  }
  if (op === 'floor' || op === 'ceil') {
    return { op, value: normalizeFormula(source.value, depth + 1) };
  }
  if (op === 'clamp') {
    return {
      op,
      value: normalizeFormula(source.value, depth + 1),
      min: normalizeFormula(source.min ?? 0, depth + 1),
      max: normalizeFormula(source.max ?? 999_999, depth + 1),
    };
  }
  const args = (Array.isArray(source.args) ? source.args : [])
    .slice(0, 8)
    .map((entry) => normalizeFormula(entry, depth + 1));
  if (!args.length) throw new Error(`公式操作 ${op} 缺少参数。`);
  return {
    op: op as 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max',
    args,
  };
}

function normalizeCondition(
  value: unknown,
  depth = 0,
): WorkshopMechanismCondition {
  if (depth > 6) throw new Error('机制条件嵌套超过 6 层。');
  const source = record(value);
  const type = String(source.type ?? '') as WorkshopMechanismCondition['type'];
  if (!['compare', 'all', 'any', 'not', 'chance', 'card_type', 'has_buff', 'has_debuff'].includes(type)) {
    throw new Error(`不支持的机制条件：${type || '空'}`);
  }
  if (type === 'compare') {
    const operator = String(source.operator ?? 'gte') as WorkshopMechanismCondition['operator'];
    if (!['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(operator ?? '')) {
      throw new Error(`不支持的比较符：${operator}`);
    }
    return {
      type,
      operator,
      left: normalizeFormula(source.left ?? 0),
      right: normalizeFormula(source.right ?? 0),
    };
  }
  if (type === 'all' || type === 'any') {
    const conditions = (Array.isArray(source.conditions) ? source.conditions : [])
      .slice(0, 8)
      .map((entry) => normalizeCondition(entry, depth + 1));
    if (!conditions.length) throw new Error(`${type} 条件不能为空。`);
    return { type, conditions };
  }
  if (type === 'not') {
    return { type, condition: normalizeCondition(source.condition, depth + 1) };
  }
  if (type === 'chance') {
    return { type, value: Math.max(0, Math.min(1, finite(source.value, 0.5))) };
  }
  return {
    type,
    value: limitedText(source.value, 40),
    target: source.target === 'selected_enemy' ? 'selected_enemy' : 'player',
  };
}

function normalizeAction(value: unknown): WorkshopMechanismAction {
  const source = record(value);
  const type = String(source.type ?? '') as WorkshopMechanismAction['type'];
  if (!ACTIONS.has(type)) throw new Error(`不支持的机制动作：${type || '空'}`);
  const target = ['player', 'selected_enemy', 'all_enemies', 'all_summons'].includes(
    String(source.target),
  )
    ? (source.target as WorkshopMechanismAction['target'])
    : 'player';
  const result: WorkshopMechanismAction = { type, target };
  if (source.value !== undefined) result.value = normalizeFormula(source.value);
  if (source.turns !== undefined) result.turns = normalizeFormula(source.turns);
  if (source.resource !== undefined) result.resource = safeId(source.resource);
  if (source.status !== undefined) result.status = safeId(source.status);
  if (source.message !== undefined) result.message = limitedText(source.message, 120);
  if (type === 'log' && !result.message) throw new Error('日志动作缺少 message。');
  if ((type === 'resource_add' || type === 'resource_set') && !result.resource) {
    throw new Error(`${type} 动作缺少 resource。`);
  }
  if (type === 'apply_status' && !result.status) {
    throw new Error('apply_status 动作缺少 status。');
  }
  return result;
}

function collectFormulaResourceIds(
  formula: WorkshopFormula | undefined,
  result: Set<string>,
): void {
  if (formula === undefined || typeof formula === 'number') return;
  if (formula.op === 'resource' && formula.id) result.add(formula.id);
  for (const child of formula.args ?? []) {
    collectFormulaResourceIds(child, result);
  }
  collectFormulaResourceIds(formula.value, result);
  collectFormulaResourceIds(formula.min, result);
  collectFormulaResourceIds(formula.max, result);
}

function collectConditionResourceIds(
  condition: WorkshopMechanismCondition | undefined,
  result: Set<string>,
): void {
  if (!condition) return;
  collectFormulaResourceIds(condition.left, result);
  collectFormulaResourceIds(condition.right, result);
  for (const child of condition.conditions ?? []) {
    collectConditionResourceIds(child, result);
  }
  collectConditionResourceIds(condition.condition, result);
}

function validateDeclarativeReferences(
  name: string,
  resources: WorkshopMechanismResource[],
  statuses: WorkshopMechanismStatus[],
  rules: WorkshopMechanismRule[],
): void {
  const resourceIds = new Set(resources.map((entry) => entry.id));
  const statusIds = new Set(statuses.map((entry) => entry.id));
  for (const rule of rules) {
    const formulaResourceIds = new Set<string>();
    collectConditionResourceIds(rule.condition, formulaResourceIds);
    for (const action of rule.actions) {
      if (
        (action.type === 'resource_add' || action.type === 'resource_set') &&
        !resourceIds.has(action.resource ?? '')
      ) {
        throw new Error(
          `机制「${name}」的规则「${rule.id}」引用了不存在的资源 ${action.resource ?? ''}。`,
        );
      }
      if (
        action.type === 'apply_status' &&
        !statusIds.has(action.status ?? '')
      ) {
        throw new Error(
          `机制「${name}」的规则「${rule.id}」引用了不存在的状态 ${action.status ?? ''}。`,
        );
      }
      collectFormulaResourceIds(action.value, formulaResourceIds);
      collectFormulaResourceIds(action.turns, formulaResourceIds);
    }
    const missingFormulaResource = [...formulaResourceIds].find(
      (resourceId) => !resourceIds.has(resourceId),
    );
    if (missingFormulaResource) {
      throw new Error(
        `机制「${name}」的规则「${rule.id}」公式引用了不存在的资源 ${missingFormulaResource}。`,
      );
    }
  }
}

const SCRIPT_EVENT_PATCHES: Partial<
  Record<WorkshopMechanismTrigger, ReadonlySet<string>>
> = {
  before_card: new Set(['cardCost', 'mpCost']),
  before_damage: new Set(['amount', 'ignoreDefense', 'cancel']),
};

export function normalizeWorkshopScriptResult(
  value: unknown,
  manifest: WorkshopMechanismManifest,
  trigger: WorkshopMechanismTrigger,
): WorkshopScriptMechanismResult {
  const source = record(value);
  const actions = (Array.isArray(source.actions) ? source.actions : [])
    .slice(0, 16)
    .map(normalizeAction);
  const resourceValues = record(source.resources);
  const resources: Record<string, number> = {};
  for (const definition of manifest.resources) {
    if (!(definition.id in resourceValues)) continue;
    resources[definition.id] = Math.max(
      definition.min,
      Math.min(definition.max, finite(resourceValues[definition.id], definition.initial)),
    );
  }
  const eventSource = record(source.event);
  const allowedPatches = SCRIPT_EVENT_PATCHES[trigger] ?? new Set<string>();
  const event: WorkshopScriptMechanismResult['event'] = {};
  for (const key of allowedPatches) {
    if (!(key in eventSource)) continue;
    if (key === 'cancel' || key === 'ignoreDefense') {
      event[key] = eventSource[key] === true;
      continue;
    }
    event[key] = Math.max(
      -999_999,
      Math.min(999_999, finite(eventSource[key])),
    );
  }
  return { actions, resources, event };
}

function normalizeResources(
  value: unknown,
  mechanismId: string,
): WorkshopMechanismResource[] {
  const resources = (Array.isArray(value) ? value : [])
    .slice(0, 12)
    .map((entry, index) => {
      const resource = record(entry);
      const min = Math.max(-999_999, finite(resource.min));
      const max = Math.min(999_999, Math.max(min, finite(resource.max, 100)));
      return {
        id: safeId(resource.id, `${mechanismId}.resource-${index + 1}`),
        label: limitedText(resource.label ?? resource.name, 30) || `资源${index + 1}`,
        description: limitedText(resource.description, 120),
        min,
        max,
        initial: Math.max(min, Math.min(max, finite(resource.initial))),
        visible: resource.visible !== false,
      };
    });
  if (new Set(resources.map((entry) => entry.id)).size !== resources.length) {
    throw new Error('底层机制包含重复的资源 ID。');
  }
  return resources;
}

function normalizeStatuses(value: unknown): WorkshopMechanismStatus[] {
  const statuses = (Array.isArray(value) ? value : [])
    .slice(0, 12)
    .map((entry, index) => {
      const status = record(entry);
      const effects = (Array.isArray(status.effects) ? status.effects : [])
        .slice(0, 8)
        .map((rawEffect) => {
          const effect = record(rawEffect);
          const type = String(effect.type) as WorkshopMechanismStatusEffect['type'];
          if (![
            'damage_reduction',
            'debuff_immunity',
            'turn_heal',
            'turn_shield',
            'turn_damage',
            'damage_bonus',
          ].includes(type)) {
            throw new Error(`不支持的自定义状态效果：${type || '空'}`);
          }
          return {
            type,
            value:
              type === 'debuff_immunity'
                ? 1
                : Math.max(
                    0,
                    Math.min(
                      type === 'damage_reduction' ? 100 : 999_999,
                      finite(effect.value),
                    ),
                  ),
          };
        });
      if (!effects.length) {
        throw new Error(`自定义状态 ${index + 1} 至少需要一个效果。`);
      }
      return {
        id: safeId(status.id, `status-${index + 1}`),
        label: limitedText(status.label ?? status.name, 30) || `状态${index + 1}`,
        description: limitedText(status.description, 120),
        polarity: status.polarity === 'debuff' ? 'debuff' as const : 'buff' as const,
        effects,
      };
    });
  if (new Set(statuses.map((entry) => entry.id)).size !== statuses.length) {
    throw new Error('底层机制包含重复的状态 ID。');
  }
  return statuses;
}

export function workshopStatusKey(
  mechanismId: string,
  statusId: string,
): string {
  return `workshop_status:${mechanismId}:${statusId}`;
}

export function isWorkshopScriptMechanism(
  mechanism: WorkshopMechanismManifest,
): boolean {
  return (
    mechanism.engine === 'script' ||
    mechanism.format === WORKSHOP_SCRIPT_MECHANISM_FORMAT
  );
}

export function normalizeWorkshopMechanism(
  value: unknown,
): WorkshopMechanismManifest {
  const source = record(value);
  const name = limitedText(source.name, 40);
  if (!name) throw new Error('底层机制缺少名称。');
  const id = safeId(source.id, `mechanism-${Date.now().toString(36)}`);
  const resources = normalizeResources(source.resources, id);
  const statuses = normalizeStatuses(source.statuses);
  const script =
    source.format === WORKSHOP_SCRIPT_MECHANISM_FORMAT ||
    source.engine === 'script';

  if (script) {
    const code = String(source.source ?? '').trim();
    if (!code) throw new Error(`代码机制「${name}」缺少 source。`);
    if (code.length > 24_000) {
      throw new Error(`代码机制「${name}」超过 24000 个字符。`);
    }
    const requestedEntrypoint = String(source.entrypoint ?? 'handle').trim();
    const entrypoint = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(
      requestedEntrypoint,
    )
      ? requestedEntrypoint
      : 'handle';
    const triggers = [
      ...new Set(
        (Array.isArray(source.triggers) ? source.triggers : [])
          .map(String)
          .filter((trigger): trigger is WorkshopMechanismTrigger =>
            TRIGGERS.has(trigger as WorkshopMechanismTrigger),
          ),
      ),
    ].slice(0, TRIGGERS.size);
    if (!triggers.length) {
      throw new Error(`代码机制「${name}」至少需要一个有效触发器。`);
    }
    return {
      format: WORKSHOP_SCRIPT_MECHANISM_FORMAT,
      version: 1,
      engine: 'script',
      id,
      name,
      author: limitedText(source.author ?? '匿名作者', 40),
      description: limitedText(source.description, 240),
      resources,
      statuses,
      rules: [],
      source: code,
      entrypoint,
      triggers,
      priority: Math.max(
        -100,
        Math.min(100, Math.trunc(finite(source.priority))),
      ),
    };
  }

  const rules = (Array.isArray(source.rules) ? source.rules : [])
    .slice(0, 40)
    .map((entry, index) => {
      const rule = record(entry);
      const trigger = String(rule.trigger ?? '') as WorkshopMechanismTrigger;
      if (!TRIGGERS.has(trigger)) throw new Error(`规则 ${index + 1} 的触发器无效。`);
      const actions = (Array.isArray(rule.actions) ? rule.actions : [])
        .slice(0, 16)
        .map(normalizeAction);
      if (!actions.length) throw new Error(`规则 ${index + 1} 没有动作。`);
      return {
        id: safeId(rule.id, `${id}.rule-${index + 1}`),
        trigger,
        priority: Math.max(-100, Math.min(100, Math.trunc(finite(rule.priority)))),
        once: ['battle', 'turn'].includes(String(rule.once))
          ? (rule.once as 'battle' | 'turn')
          : ('never' as const),
        condition: rule.condition
          ? normalizeCondition(rule.condition)
          : undefined,
        actions,
      };
    });
  if (!rules.length && !resources.length && !statuses.length) {
    throw new Error(`机制「${name}」没有状态、资源或规则。`);
  }
  if (new Set(rules.map((entry) => entry.id)).size !== rules.length) {
    throw new Error(`机制「${name}」包含重复的规则 ID。`);
  }
  validateDeclarativeReferences(name, resources, statuses, rules);
  return {
    format: WORKSHOP_MECHANISM_FORMAT,
    version: 1,
    engine: 'declarative',
    id,
    name,
    author: limitedText(source.author ?? '匿名作者', 40),
    description: limitedText(source.description, 240),
    resources,
    statuses,
    rules,
  };
}

export function readWorkshopMechanisms(): WorkshopMechanismManifest[] {
  try {
    const values = JSON.parse(
      localStorage.getItem(WORKSHOP_MECHANISM_STORAGE_KEY) ?? '[]',
    ) as unknown;
    return Array.isArray(values)
      ? values.flatMap((entry) => {
          try {
            return [normalizeWorkshopMechanism(entry)];
          } catch {
            return [];
          }
        })
      : [];
  } catch {
    return [];
  }
}

export function saveWorkshopMechanism(value: unknown): WorkshopMechanismManifest {
  const normalized = saveWorkshopMechanisms([value]);
  return normalized[0]!;
}

export function saveWorkshopMechanisms(
  values: readonly unknown[],
): WorkshopMechanismManifest[] {
  const normalized = [
    ...new Map(
      values
        .map((value) => normalizeWorkshopMechanism(value))
        .map((value) => [value.id, value]),
    ).values(),
  ];
  const existing = readWorkshopMechanisms();
  const replacing = new Set(normalized.map((entry) => entry.id));
  const kept = existing.filter((entry) => !replacing.has(entry.id));
  if (kept.length + normalized.length > 40) {
    throw new Error('自定义状态与资源已达到 40 个，请先删除一个再保存。');
  }
  localStorage.setItem(
    WORKSHOP_MECHANISM_STORAGE_KEY,
    JSON.stringify([...kept, ...normalized]),
  );
  return normalized;
}

export function deleteWorkshopMechanism(id: string): boolean {
  const values = readWorkshopMechanisms();
  const next = values.filter((entry) => entry.id !== id);
  if (next.length === values.length) return false;
  localStorage.setItem(WORKSHOP_MECHANISM_STORAGE_KEY, JSON.stringify(next));
  return true;
}

function statValue(context: WorkshopMechanismRuntimeContext, path: string): number {
  const { state } = context;
  const enemy = state.enemies[state.selectedTarget] ?? state.enemies.find((entry) => entry.hp > 0);
  const values: Record<string, number> = {
    'player.hp': state.player.hp,
    'player.hpMax': state.player.hpMax,
    'player.mp': state.player.mp,
    'player.mpMax': state.player.mpMax,
    'player.shield': state.player.shield,
    'player.attack': state.player.attack,
    'player.defense': state.player.defense,
    'player.speed': state.player.speed,
    'player.ap': state.player.ap,
    'player.apMax': state.player.apMax,
    'battle.turn': state.turn,
    'enemy.hp': enemy?.hp ?? 0,
    'enemy.hpMax': enemy?.hpMax ?? 0,
    'enemy.shield': enemy?.shield ?? 0,
    'enemy.attack': enemy?.attack ?? 0,
    'enemy.defense': enemy?.defense ?? 0,
    'enemies.alive': state.enemies.filter((entry) => entry.hp > 0).length,
    'summons.count': state.player.summons.length,
    'hand.count': state.player.hand.length,
    'discard.count': state.player.discardPile.length,
  };
  return values[path] ?? 0;
}

export function evaluateWorkshopFormula(
  formula: WorkshopFormula | undefined,
  context: WorkshopMechanismRuntimeContext,
  depth = 0,
): number {
  if (depth > 10 || formula === undefined) return 0;
  if (typeof formula === 'number') return formula;
  if (formula.op === 'stat') return statValue(context, formula.path ?? '');
  if (formula.op === 'resource') return context.resources[formula.id ?? ''] ?? 0;
  if (formula.op === 'event') return finite(context.event[formula.key ?? '']);
  if (formula.op === 'floor' || formula.op === 'ceil') {
    const value = evaluateWorkshopFormula(formula.value, context, depth + 1);
    return formula.op === 'floor' ? Math.floor(value) : Math.ceil(value);
  }
  if (formula.op === 'clamp') {
    const value = evaluateWorkshopFormula(formula.value, context, depth + 1);
    const min = evaluateWorkshopFormula(formula.min, context, depth + 1);
    const max = evaluateWorkshopFormula(formula.max, context, depth + 1);
    return Math.max(min, Math.min(max, value));
  }
  const args = (formula.args ?? []).map((entry) =>
    evaluateWorkshopFormula(entry, context, depth + 1),
  );
  if (formula.op === 'add') return args.reduce((sum, value) => sum + value, 0);
  if (formula.op === 'sub') return args.slice(1).reduce((value, part) => value - part, args[0] ?? 0);
  if (formula.op === 'mul') return args.reduce((value, part) => value * part, 1);
  if (formula.op === 'div') return args.slice(1).reduce((value, part) => part === 0 ? value : value / part, args[0] ?? 0);
  if (formula.op === 'min') return Math.min(...args);
  if (formula.op === 'max') return Math.max(...args);
  return 0;
}

export function evaluateWorkshopCondition(
  condition: WorkshopMechanismCondition | undefined,
  context: WorkshopMechanismRuntimeContext,
  depth = 0,
): boolean {
  if (!condition) return true;
  if (depth > 8) return false;
  if (condition.type === 'all') return (condition.conditions ?? []).every((entry) => evaluateWorkshopCondition(entry, context, depth + 1));
  if (condition.type === 'any') return (condition.conditions ?? []).some((entry) => evaluateWorkshopCondition(entry, context, depth + 1));
  if (condition.type === 'not') return !evaluateWorkshopCondition(condition.condition, context, depth + 1);
  if (condition.type === 'chance') return context.random() < finite(condition.value);
  if (condition.type === 'card_type') return String(context.event.cardType ?? '') === String(condition.value ?? '');
  const enemy = context.state.enemies[context.state.selectedTarget];
  if (condition.type === 'has_buff') {
    const effects = condition.target === 'selected_enemy' ? enemy?.buffs : context.state.player.buffs;
    return Boolean(effects?.[String(condition.value ?? '')]);
  }
  if (condition.type === 'has_debuff') {
    const effects = condition.target === 'selected_enemy' ? enemy?.debuffs : context.state.player.debuffs;
    return Boolean(effects?.[String(condition.value ?? '')]);
  }
  const left = evaluateWorkshopFormula(condition.left, context);
  const right = evaluateWorkshopFormula(condition.right, context);
  if (condition.operator === 'eq') return left === right;
  if (condition.operator === 'ne') return left !== right;
  if (condition.operator === 'gt') return left > right;
  if (condition.operator === 'lt') return left < right;
  if (condition.operator === 'lte') return left <= right;
  return left >= right;
}
