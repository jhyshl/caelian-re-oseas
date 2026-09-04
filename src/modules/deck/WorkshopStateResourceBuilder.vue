<script setup lang="ts">
import { ref } from 'vue';
import type {
  WorkshopMechanismManifest,
  WorkshopMechanismStatusEffect,
} from '@/workshop-mechanisms';
import {
  compileVisualWorkshopResource,
  compileVisualWorkshopStatus,
  type VisualResourceGainDraft,
  type VisualResourceOutcomeDraft,
  type VisualWorkshopResourceDraft,
  type VisualWorkshopStatusDraft,
} from '@/workshop-visual-builder';

const emit = defineEmits<{ save: [mechanism: WorkshopMechanismManifest] }>();
const mode = ref<'status' | 'resource'>('status');
const error = ref('');

const statusEffectOptions = [
  ['damage_reduction', '百分比减伤'],
  ['debuff_immunity', '免疫减益'],
  ['turn_heal', '每回合治疗'],
  ['turn_shield', '每回合护盾'],
  ['turn_damage', '每回合失去生命'],
  ['damage_bonus', '造成伤害提升'],
] as const;
const gainTriggers = [
  ['battle_start', '战斗开始'],
  ['turn_start', '回合开始'],
  ['after_card', '使用卡牌后'],
  ['player_damaged', '玩家受伤后'],
  ['enemy_damaged', '怪物受伤后'],
  ['summon_created', '召唤物登场'],
  ['summon_removed', '召唤物离场'],
] as const;
const outcomeTypes = [
  ['damage', '造成伤害'],
  ['heal', '恢复生命'],
  ['shield', '获得护盾'],
  ['apply_buff', '施加基础增益'],
  ['apply_debuff', '施加基础减益'],
] as const;
const targets = [
  ['player', '玩家'],
  ['all_enemies', '所有怪物'],
  ['all_summons', '所有召唤物'],
] as const;
const buffOptions = [
  ['strength', '力量'],
  ['fortitude', '坚韧'],
  ['agility', '敏捷'],
  ['regen', '再生'],
  ['damage_bonus', '增伤'],
  ['damage_reduce', '固定减伤'],
] as const;
const debuffOptions = [
  ['burn', '灼烧'],
  ['poison', '中毒'],
  ['weak', '虚弱'],
  ['vulnerable', '易伤'],
  ['freeze', '冻结'],
  ['entangle', '缠绕'],
] as const;

function createStatusDraft(): VisualWorkshopStatusDraft {
  return {
    name: '',
    description: '',
    polarity: 'buff',
    effects: [],
  };
}

function createResourceDraft(): VisualWorkshopResourceDraft {
  return {
    name: '',
    description: '',
    min: 0,
    max: 10,
    initial: 0,
    visible: true,
    gains: [],
    thresholds: [],
  };
}

const statusDraft = ref(createStatusDraft());
const resourceDraft = ref(createResourceDraft());

function addStatusEffect(): void {
  if (statusDraft.value.effects.length >= 8) return;
  statusDraft.value.effects.push({ type: 'damage_reduction', value: 10 });
}

function setStatusEffectType(
  effect: WorkshopMechanismStatusEffect,
  type: WorkshopMechanismStatusEffect['type'],
): void {
  effect.type = type;
  effect.value = type === 'debuff_immunity' ? 1 : 10;
}

function addGain(): void {
  if (resourceDraft.value.gains.length >= 6) return;
  resourceDraft.value.gains.push({
    trigger: 'after_card',
    amount: 1,
    cardType: '',
    once: 'never',
  });
}

function setGainTrigger(
  gain: VisualResourceGainDraft,
  trigger: VisualResourceGainDraft['trigger'],
): void {
  gain.trigger = trigger;
  if (trigger !== 'after_card') gain.cardType = '';
}

function defaultOutcome(): VisualResourceOutcomeDraft {
  return {
    type: 'damage',
    target: 'all_enemies',
    value: 10,
    turns: 1,
    status: 'weak',
  };
}

function addThreshold(): void {
  if (resourceDraft.value.thresholds.length >= 4) return;
  resourceDraft.value.thresholds.push({
    value: Math.max(1, resourceDraft.value.max),
    consume: 'fixed',
    consumeValue: Math.max(1, resourceDraft.value.max),
    outcome: defaultOutcome(),
  });
}

function setOutcomeType(
  outcome: VisualResourceOutcomeDraft,
  type: VisualResourceOutcomeDraft['type'],
): void {
  outcome.type = type;
  if (type === 'apply_buff') outcome.status = 'strength';
  if (type === 'apply_debuff') outcome.status = 'weak';
}

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}必须是有效数值。`);
  }
  return value;
}

function saveStatus(): void {
  error.value = '';
  try {
    if (!statusDraft.value.name.trim()) throw new Error('请填写状态名称。');
    if (!statusDraft.value.effects.length) {
      throw new Error('自定义状态至少需要一个特殊效果。');
    }
    statusDraft.value.effects.forEach((effect, index) => {
      requireFinite(effect.value, `第 ${index + 1} 条状态效果数值`);
    });
    emit('save', compileVisualWorkshopStatus(statusDraft.value));
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

function saveResource(): void {
  error.value = '';
  try {
    if (!resourceDraft.value.name.trim()) throw new Error('请填写资源名称。');
    const minimum = requireFinite(resourceDraft.value.min, '资源最小值');
    const maximum = requireFinite(resourceDraft.value.max, '资源最大值');
    requireFinite(resourceDraft.value.initial, '资源初始值');
    if (maximum <= minimum) {
      throw new Error('资源最大值必须大于最小值。');
    }
    resourceDraft.value.gains.forEach((gain, index) => {
      requireFinite(gain.amount, `第 ${index + 1} 条自动增减数量`);
    });
    resourceDraft.value.thresholds.forEach((threshold, index) => {
      const prefix = `第 ${index + 1} 条阈值`;
      requireFinite(threshold.value, `${prefix}数值`);
      if (threshold.consume === 'fixed') {
        requireFinite(threshold.consumeValue, `${prefix}扣除数量`);
      }
      requireFinite(threshold.outcome.value, `${prefix}效果数值`);
      if (
        threshold.outcome.type === 'apply_buff' ||
        threshold.outcome.type === 'apply_debuff'
      ) {
        requireFinite(threshold.outcome.turns, `${prefix}持续回合`);
      }
    });
    emit('save', compileVisualWorkshopResource(resourceDraft.value));
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}
</script>

<template>
  <section class="builder">
    <nav>
      <button type="button" :class="{ active: mode === 'status' }" @click="mode = 'status'">
        自定义状态（Buff / Debuff）
      </button>
      <button type="button" :class="{ active: mode === 'resource' }" @click="mode = 'resource'">
        自定义资源（获取 / 消耗 / 用途）
      </button>
    </nav>

    <template v-if="mode === 'status'">
      <header>
        <div>
          <strong>创建真正的战斗状态</strong>
          <p>状态会挂入目标的增益或减益栏，分别可被驱散或净化，并独立计算层数与持续回合。</p>
        </div>
        <button type="button" class="ca-button primary" @click="saveStatus">保存状态</button>
      </header>
      <div class="base-grid">
        <label><span>状态性质</span><select v-model="statusDraft.polarity"><option value="buff">Buff（增益）</option><option value="debuff">Debuff（减益）</option></select></label>
        <label><span>状态名称</span><input v-model="statusDraft.name" maxlength="30" placeholder="例如：月蚀加护" /></label>
        <label class="wide"><span>状态说明</span><input v-model="statusDraft.description" maxlength="120" /></label>
      </div>
      <section class="rule-section">
        <header>
          <div><strong>特殊状态效果</strong><small>作用于持有该状态的玩家、怪物或召唤物；最多 8 条。</small></div>
          <button type="button" @click="addStatusEffect">＋ 添加效果</button>
        </header>
        <div v-for="(effect, index) in statusDraft.effects" :key="index" class="rule-row">
          <select :value="effect.type" @change="setStatusEffectType(effect, ($event.target as HTMLSelectElement).value as WorkshopMechanismStatusEffect['type'])">
            <option v-for="[type, label] in statusEffectOptions" :key="type" :value="type">{{ label }}</option>
          </select>
          <input v-if="effect.type !== 'debuff_immunity'" v-model.number="effect.value" type="number" min="0" :max="effect.type === 'damage_reduction' ? 100 : undefined" />
          <span v-else>完全免疫新减益</span>
          <button type="button" @click="statusDraft.effects.splice(index, 1)">×</button>
        </div>
      </section>
    </template>

    <template v-else>
      <header>
        <div>
          <strong>创建独立职业资源</strong>
          <p>资源不会作为 Buff/Debuff；可配置自动获取、卡牌增减、阈值用途与指定/全部支付。</p>
        </div>
        <button type="button" class="ca-button primary" @click="saveResource">保存资源</button>
      </header>
      <div class="base-grid">
        <label><span>资源名称</span><input v-model="resourceDraft.name" maxlength="30" placeholder="例如：圣印" /></label>
        <label class="wide"><span>资源说明</span><input v-model="resourceDraft.description" maxlength="120" /></label>
        <label><span>最小值</span><input v-model.number="resourceDraft.min" type="number" /></label>
        <label><span>最大值</span><input v-model.number="resourceDraft.max" type="number" /></label>
        <label><span>初始值</span><input v-model.number="resourceDraft.initial" type="number" /></label>
        <label class="toggle"><input v-model="resourceDraft.visible" type="checkbox" /><span>战斗中显示</span></label>
      </div>

      <section class="rule-section">
        <header><div><strong>自动获取 / 减少</strong><small>负数代表减少；也可通过卡牌积木主动修改。</small></div><button type="button" @click="addGain">＋ 添加条件</button></header>
        <div v-for="(gain, index) in resourceDraft.gains" :key="index" class="rule-row gains">
          <select :value="gain.trigger" @change="setGainTrigger(gain, ($event.target as HTMLSelectElement).value as VisualResourceGainDraft['trigger'])"><option v-for="[trigger, label] in gainTriggers" :key="trigger" :value="trigger">{{ label }}</option></select>
          <select v-if="gain.trigger === 'after_card'" v-model="gain.cardType"><option value="">任意卡牌</option><option value="attack">攻击牌</option><option value="defense">防御牌</option><option value="skill">技能牌</option><option value="summon">召唤牌</option></select>
          <input v-model.number="gain.amount" type="number" step="1" aria-label="资源增减量" />
          <select v-model="gain.once"><option value="never">每次触发</option><option value="turn">每回合一次</option><option value="battle">每场一次</option></select>
          <button type="button" @click="resourceDraft.gains.splice(index, 1)">×</button>
        </div>
      </section>

      <section class="rule-section">
        <header><div><strong>达到阈值后的用途</strong><small>资源跨过阈值时执行效果，并可保留、定量扣除或全部消耗。</small></div><button type="button" @click="addThreshold">＋ 添加阈值</button></header>
        <div v-for="(threshold, index) in resourceDraft.thresholds" :key="index" class="threshold-row">
          <label><span>阈值</span><input v-model.number="threshold.value" type="number" /></label>
          <label><span>触发后</span><select v-model="threshold.consume"><option value="none">保留资源</option><option value="fixed">扣除指定数量</option><option value="all">消耗全部</option></select></label>
          <label v-if="threshold.consume === 'fixed'"><span>扣除</span><input v-model.number="threshold.consumeValue" type="number" min="1" /></label>
          <label><span>用途</span><select :value="threshold.outcome.type" @change="setOutcomeType(threshold.outcome, ($event.target as HTMLSelectElement).value as VisualResourceOutcomeDraft['type'])"><option v-for="[type, label] in outcomeTypes" :key="type" :value="type">{{ label }}</option></select></label>
          <label><span>目标</span><select v-model="threshold.outcome.target"><option v-for="[target, label] in targets" :key="target" :value="target">{{ label }}</option></select></label>
          <label><span>数值</span><input v-model.number="threshold.outcome.value" type="number" min="0" /></label>
          <label v-if="threshold.outcome.type === 'apply_buff'"><span>增益</span><select v-model="threshold.outcome.status"><option v-for="[status, label] in buffOptions" :key="status" :value="status">{{ label }}</option></select></label>
          <label v-if="threshold.outcome.type === 'apply_debuff'"><span>减益</span><select v-model="threshold.outcome.status"><option v-for="[status, label] in debuffOptions" :key="status" :value="status">{{ label }}</option></select></label>
          <label v-if="threshold.outcome.type === 'apply_buff' || threshold.outcome.type === 'apply_debuff'"><span>持续回合</span><input v-model.number="threshold.outcome.turns" type="number" min="1" max="99" /></label>
          <button type="button" @click="resourceDraft.thresholds.splice(index, 1)">删除阈值</button>
        </div>
      </section>
    </template>

    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>

<style scoped>
.builder { display: grid; gap: 13px; padding: 14px; border: 1px solid rgba(212, 168, 67, 0.3); border-radius: 14px; background: rgba(15, 12, 10, 0.55); }
.builder > nav { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.builder > nav button { padding: 9px; border: 1px solid var(--ca-border); border-radius: 9px; color: var(--ca-muted); background: transparent; }
.builder > nav button.active { border-color: var(--ca-gold); color: var(--ca-gold-light); background: rgba(212, 168, 67, 0.09); }
.builder > header, .rule-section > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.builder p, .builder small { margin: 3px 0 0; color: var(--ca-muted); }
.base-grid, .threshold-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.base-grid label, .threshold-row label { display: grid; gap: 4px; }
.base-grid .wide { grid-column: span 2; }
.base-grid .toggle { display: flex; align-items: center; }
.rule-section { display: grid; gap: 7px; padding-top: 11px; border-top: 1px solid var(--ca-border); }
.rule-section header div { display: grid; gap: 2px; }
.rule-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto; gap: 6px; }
.rule-row.gains { grid-template-columns: repeat(4, minmax(0, 1fr)) auto; }
.threshold-row { padding: 9px; border: 1px solid var(--ca-border); border-radius: 9px; }
.error { color: #ff9d9d !important; }
@media (max-width: 760px) {
  .base-grid, .threshold-row, .rule-row, .rule-row.gains { grid-template-columns: 1fr 1fr; }
  .builder > header, .rule-section > header { align-items: flex-start; flex-direction: column; }
}
</style>
