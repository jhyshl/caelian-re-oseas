<script setup lang="ts">
/* global structuredClone */
/* eslint-disable vue/no-mutating-props */
import { computed } from 'vue';
import { WORKSHOP_EFFECT_OPTIONS } from '@/workshop';

type EditableEffect = Record<string, any>;

const props = defineProps<{
  effect: EditableEffect;
  nested?: boolean;
}>();
const emit = defineEmits<{ remove: [] }>();

const labels = Object.fromEntries(
  WORKSHOP_EFFECT_OPTIONS.map((option) => [option.type, option.label]),
);
const hasValue = computed(() =>
  [
    'damage',
    'shield',
    'heal',
    'draw',
    'gain_ap',
    'gain_mp',
    'apply_buff',
    'apply_debuff',
    'trap',
    'damage_per_debuff',
    'discard_all_damage',
    'generate_blank_to_draw',
    'blank_regen',
    'discard_blank_damage',
    'spend_mp_damage',
    'spend_mp_shield',
    'mp_to_ap',
    'thorns',
  ].includes(props.effect.type),
);
const hasAmount = computed(() =>
  [
    'cleanse',
    'dispel',
    'discard',
    'recover_discard',
    'destroy_summon',
    'spend_mp_damage',
    'spend_mp_shield',
    'mp_to_ap',
  ].includes(props.effect.type),
);
const hasTurns = computed(() =>
  ['apply_buff', 'apply_debuff', 'thorns', 'blank_regen'].includes(
    props.effect.type,
  ),
);
const hasTarget = computed(
  () =>
    ![
      'conditional_group',
      'summon',
      'draw',
      'gain_ap',
      'gain_mp',
      'discard',
      'recover_discard',
      'mp_to_ap',
      'reveal_intent',
      'generate_blank_to_draw',
      'blank_regen',
    ].includes(props.effect.type),
);

const basicNestedOptions = WORKSHOP_EFFECT_OPTIONS.filter(
  (option) =>
    ![
      'conditional_group',
      'summon',
      'spend_mp_damage',
      'spend_mp_shield',
      'mp_to_ap',
    ].includes(option.type),
);
const nestedOptionGroups = [
  {
    label: '即时效果',
    types: ['damage', 'shield', 'heal', 'draw', 'gain_ap', 'gain_mp'],
  },
  {
    label: '状态效果',
    types: ['apply_buff', 'apply_debuff', 'cleanse', 'dispel'],
  },
  {
    label: '特殊机制',
    types: [
      'strip_shield',
      'strip_buffs',
      'trap',
      'damage_from_shield',
      'damage_per_debuff',
      'discard',
      'recover_discard',
      'discard_all_damage',
      'generate_blank_to_draw',
      'blank_regen',
      'discard_blank_damage',
      'destroy_summon',
      'reveal_intent',
    ],
  },
].map((group) => ({
  ...group,
  options: basicNestedOptions.filter((option) =>
    group.types.includes(option.type),
  ),
}));
const summonSkillOptions = basicNestedOptions.filter((option) =>
  [
    'damage',
    'shield',
    'heal',
    'apply_buff',
    'apply_debuff',
    'cleanse',
    'dispel',
    'strip_shield',
    'strip_buffs',
    'trap',
    'damage_from_shield',
    'damage_per_debuff',
  ].includes(option.type),
);
const conditions = [
  ['self_has_shield', '自身有护盾'],
  ['self_no_shield', '自身无护盾'],
  ['enemy_has_shield', '敌人有护盾'],
  ['enemy_no_shield', '敌人无护盾'],
  ['enemy_has_debuff', '敌人有任意减益'],
  ['enemy_no_debuff', '敌人无减益'],
  ['enemy_has_specific_debuff', '敌人有指定减益'],
  ['enemy_no_specific_debuff', '敌人无指定减益'],
  ['self_has_buff', '自身有增益'],
  ['self_no_buff', '自身无增益'],
  ['self_full_hp', '自身满生命'],
  ['self_not_full_hp', '自身非满生命'],
  ['has_summon', '拥有召唤物'],
  ['no_summon', '没有召唤物'],
  ['same_card_played_this_turn', '本轮使用过同名卡牌'],
  ['previous_card_same_name', '上一张使用的是同名卡牌'],
  ['spend_mp', '支付 MP（换取可支配强度）'],
  ['spend_hp', '支付 HP（换取可支配强度）'],
  ['discard', '弃置手牌'],
  ['destroy_summon', '牺牲召唤物'],
];

function cloneOption(type: string): EditableEffect {
  const option = WORKSHOP_EFFECT_OPTIONS.find((entry) => entry.type === type);
  if (!option) return { type: 'damage', value: 1, target: 'enemy' };
  const clone = structuredClone(option) as EditableEffect;
  delete clone.label;
  return clone;
}

function addNested(key: 'then_effects' | 'else_effects', type: string): void {
  const list = Array.isArray(props.effect[key]) ? props.effect[key] : [];
  if (list.length >= 8) return;
  props.effect[key] = [...list, cloneOption(type)];
}

function addCondition(): void {
  const list = Array.isArray(props.effect.conditions)
    ? props.effect.conditions
    : [];
  if (list.length >= 8) return;
  props.effect.conditions = [...list, { type: 'self_has_shield' }];
}

function addSummonSkill(): void {
  const skills = Array.isArray(props.effect.skills) ? props.effect.skills : [];
  if (skills.length >= 3) return;
  props.effect.skills = [
    ...skills,
    {
      name: `技能${skills.length + 1}`,
      weight: 1,
      effects: [{ type: 'damage', value: 4, target: 'enemy' }],
    },
  ];
}

function addSummonSkillEffect(skill: EditableEffect, type: string): void {
  const effects = Array.isArray(skill.effects) ? skill.effects : [];
  if (effects.length >= 3) return;
  skill.effects = [...effects, cloneOption(type)];
}
</script>

<template>
  <article class="effect-editor" :class="{ nested }">
    <header>
      <strong>{{ labels[effect.type] ?? effect.type }}</strong>
      <button type="button" aria-label="删除效果" @click="emit('remove')">
        删除
      </button>
    </header>

    <div
      v-if="effect.type !== 'conditional_group' && effect.type !== 'summon'"
      class="effect-fields"
    >
      <label v-if="hasValue">
        <span>数值</span>
        <input v-model.number="effect.value" type="number" min="0" step="1" />
      </label>
      <label v-if="hasAmount">
        <span>数量 / 消耗</span>
        <input v-model.number="effect.amount" type="number" min="1" step="1" />
      </label>
      <label v-if="hasTurns">
        <span>持续回合</span>
        <input v-model.number="effect.turns" type="number" min="1" max="99" />
      </label>
      <label v-if="effect.type === 'damage_from_shield'">
        <span>护盾比例</span>
        <input
          v-model.number="effect.ratio"
          type="number"
          min="0"
          max="1"
          step="0.05"
        />
      </label>
      <label v-if="effect.type === 'damage'">
        <span>吸血比例</span>
        <input
          v-model.number="effect.lifesteal_ratio"
          type="number"
          min="0"
          max="0.6"
          step="0.05"
        />
      </label>
      <label v-if="effect.type === 'apply_buff'">
        <span>增益</span>
        <select v-model="effect.buff">
          <option value="strength">力量</option>
          <option value="fortitude">坚韧</option>
          <option value="agility">敏捷</option>
          <option value="regen">再生</option>
          <option value="thorns">反伤</option>
          <option value="ap_regen">回能</option>
          <option value="draw_regen">灵感</option>
          <option value="shield_regen">护佑</option>
          <option value="heal_regen">愈合</option>
          <option value="damage_bonus">增伤</option>
          <option value="spell_damage_bonus">法术强化</option>
          <option value="damage_reduce">减伤</option>
          <option value="mp_regen">每回合魔力</option>
          <option value="blood_burn">烧血</option>
        </select>
      </label>
      <label v-if="effect.type === 'apply_debuff'">
        <span>减益</span>
        <select v-model="effect.debuff">
          <option value="burn">灼烧</option>
          <option value="poison">中毒</option>
          <option value="weak">虚弱</option>
          <option value="vulnerable">易伤</option>
          <option value="freeze">冻结</option>
          <option value="entangle">缠绕</option>
        </select>
      </label>
      <label v-if="hasTarget">
        <span>目标</span>
        <select v-model="effect.target">
          <option value="self">自身</option>
          <option value="enemy">指定敌人</option>
          <option value="all_enemies">所有敌人</option>
          <option value="random_enemy">随机敌人</option>
          <option value="all_allies">所有友方</option>
          <option value="random_allies">随机友方</option>
          <option value="selected_allies">指定友方</option>
          <option value="all_summons">所有召唤物</option>
          <option value="random_summons">随机召唤物</option>
          <option value="selected_summons">指定召唤物</option>
        </select>
      </label>
      <label
        v-if="
          ['random_enemy', 'random_allies', 'selected_allies', 'random_summons', 'selected_summons'].includes(
            effect.target,
          )
        "
      >
        <span>目标数量</span>
        <input v-model.number="effect.target_count" type="number" min="1" />
      </label>
    </div>

    <div v-else-if="effect.type === 'conditional_group'" class="condition-editor">
      <label>
        <span>条件关系</span>
        <select v-model="effect.logic">
          <option value="and">全部满足（AND）</option>
          <option value="or">任一满足（OR）</option>
        </select>
      </label>
      <div
        v-for="(condition, index) in effect.conditions"
        :key="index"
        class="condition-row"
      >
        <select v-model="condition.type">
          <option
            v-for="[type, label] in conditions"
            :key="type"
            :value="type"
          >
            {{ label }}
          </option>
        </select>
        <select
          v-if="String(condition.type).includes('specific_debuff')"
          v-model="condition.debuff"
        >
          <option value="burn">灼烧</option>
          <option value="poison">中毒</option>
          <option value="weak">虚弱</option>
          <option value="vulnerable">易伤</option>
          <option value="freeze">冻结</option>
          <option value="entangle">缠绕</option>
        </select>
        <input
          v-if="['spend_mp', 'spend_hp', 'discard', 'destroy_summon'].includes(condition.type)"
          v-model.number="condition.amount"
          type="number"
          min="1"
          :max="condition.type === 'spend_hp' ? 20 : undefined"
        />
        <button
          type="button"
          @click="effect.conditions.splice(index, 1)"
        >
          ×
        </button>
      </div>
      <button
        type="button"
        class="minor-action"
        :disabled="effect.conditions?.length >= 8"
        @click="addCondition"
      >
        + 添加条件
      </button>

      <h5>则（满足条件时）</h5>
      <WorkshopEffectEditor
        v-for="(child, index) in effect.then_effects"
        :key="`then:${index}`"
        :effect="child"
        nested
        @remove="effect.then_effects.splice(index, 1)"
      />
      <select
        class="add-effect"
        value=""
        @change="
          addNested(
            'then_effects',
            ($event.target as HTMLSelectElement).value,
          );
          ($event.target as HTMLSelectElement).value = '';
        "
      >
        <option value="" disabled>+ 添加触发效果</option>
        <optgroup
          v-for="group in nestedOptionGroups"
          :key="group.label"
          :label="group.label"
        >
          <option
            v-for="option in group.options"
            :key="option.type"
            :value="option.type"
          >
            {{ option.label }}
          </option>
        </optgroup>
      </select>

      <h5>否则（不满足时，可选）</h5>
      <WorkshopEffectEditor
        v-for="(child, index) in effect.else_effects"
        :key="`else:${index}`"
        :effect="child"
        nested
        @remove="effect.else_effects.splice(index, 1)"
      />
      <select
        class="add-effect"
        value=""
        @change="
          addNested(
            'else_effects',
            ($event.target as HTMLSelectElement).value,
          );
          ($event.target as HTMLSelectElement).value = '';
        "
      >
        <option value="" disabled>+ 添加备选效果</option>
        <optgroup
          v-for="group in nestedOptionGroups"
          :key="group.label"
          :label="group.label"
        >
          <option
            v-for="option in group.options"
            :key="option.type"
            :value="option.type"
          >
            {{ option.label }}
          </option>
        </optgroup>
      </select>
    </div>

    <div v-else class="summon-editor">
      <div class="effect-fields">
        <label>
          <span>召唤物名称</span>
          <input v-model="effect.name" maxlength="18" />
        </label>
        <label>
          <span>形态</span>
          <select v-model="effect.attackable">
            <option :value="true">可被攻击</option>
            <option :value="false">机械 / 不可攻击</option>
          </select>
        </label>
        <label v-if="effect.attackable">
          <span>生命比例</span>
          <input
            v-model.number="effect.hp_ratio"
            type="number"
            min="1"
            max="200"
          />
        </label>
        <label v-else>
          <span>持续回合</span>
          <input v-model.number="effect.duration" type="number" min="1" />
        </label>
      </div>

      <section
        v-for="(skill, skillIndex) in effect.skills"
        :key="skillIndex"
        class="summon-skill"
      >
        <header>
          <input v-model="skill.name" maxlength="16" placeholder="技能名" />
          <label>
            权重
            <input
              v-model.number="skill.weight"
              type="number"
              min="0.01"
              step="0.01"
            />
          </label>
          <button type="button" @click="effect.skills.splice(skillIndex, 1)">
            删除技能
          </button>
        </header>
        <WorkshopEffectEditor
          v-for="(child, childIndex) in skill.effects"
          :key="childIndex"
          :effect="child"
          nested
          @remove="skill.effects.splice(childIndex, 1)"
        />
        <select
          class="add-effect"
          value=""
          @change="
            addSummonSkillEffect(
              skill,
              ($event.target as HTMLSelectElement).value,
            );
            ($event.target as HTMLSelectElement).value = '';
          "
        >
          <option value="" disabled>+ 添加技能效果</option>
          <option
            v-for="option in summonSkillOptions"
            :key="option.type"
            :value="option.type"
          >
            {{ option.label }}
          </option>
        </select>
      </section>
      <button
        type="button"
        class="minor-action"
        :disabled="effect.skills?.length >= 3"
        @click="addSummonSkill"
      >
        + 添加技能（最多 3 个）
      </button>
    </div>
  </article>
</template>

<style scoped>
.effect-editor {
  display: grid;
  gap: 9px;
  padding: 10px;
  border: 1px solid rgba(212, 168, 67, 0.2);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
}

.effect-editor.nested {
  padding: 8px;
  background: rgba(0, 0, 0, 0.12);
}

.effect-editor > header,
.summon-skill > header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.effect-editor > header strong {
  flex: 1;
  color: var(--ca-gold-light);
  font-size: 11px;
}

.effect-editor button {
  border: 0;
  color: #d99b91;
  background: transparent;
  font-size: 10px;
  cursor: pointer;
}

.effect-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.effect-fields label,
.condition-editor > label {
  display: grid;
  gap: 4px;
  color: var(--ca-muted);
  font-size: 9px;
}

input,
select {
  min-width: 0;
  padding: 6px 7px;
  border: 1px solid var(--ca-border);
  border-radius: 7px;
  color: var(--ca-text);
  background: #1c1813;
  font: inherit;
}

.condition-editor,
.summon-editor,
.summon-skill {
  display: grid;
  gap: 8px;
}

.condition-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(70px, auto) auto;
  gap: 6px;
}

.condition-editor h5 {
  margin: 5px 0 0;
  color: var(--ca-text-bright);
  font-size: 10px;
}

.minor-action,
.add-effect {
  width: 100%;
  padding: 7px;
  border: 1px dashed rgba(212, 168, 67, 0.35) !important;
  border-radius: 8px;
  color: var(--ca-gold-light) !important;
  background: rgba(212, 168, 67, 0.045) !important;
}

.summon-skill {
  padding: 9px;
  border-left: 2px solid rgba(212, 168, 67, 0.36);
}

.summon-skill > header input:first-child {
  flex: 1;
}

.summon-skill > header label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--ca-muted);
  font-size: 9px;
}

.summon-skill > header label input {
  width: 58px;
}

@media (max-width: 560px) {
  .effect-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .summon-skill > header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
