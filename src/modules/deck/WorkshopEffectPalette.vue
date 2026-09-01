<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CardEffect } from '@/content/types';
import { WORKSHOP_EFFECT_OPTIONS } from '@/workshop';

type EffectGroup = 'instant' | 'ongoing' | 'status' | 'conditional' | 'special';

interface EffectBlock {
  id: string;
  group: EffectGroup;
  label: string;
  description: string;
  type: string;
  overrides?: Record<string, unknown>;
  cardTypes?: string[];
}

interface WorkshopResourceOption {
  mechanismId: string;
  resourceId: string;
  label: string;
}

interface WorkshopStatusOption {
  mechanismId: string;
  statusId: string;
  label: string;
  polarity: 'buff' | 'debuff';
}

const props = defineProps<{
  cardType: string;
  disabled?: boolean;
  resourceOptions?: WorkshopResourceOption[];
  statusOptions?: WorkshopStatusOption[];
}>();
const emit = defineEmits<{ add: [effect: CardEffect] }>();

const groups: Array<{ id: EffectGroup; label: string; hint: string }> = [
  { id: 'instant', label: '即时效果', hint: '伤害、护盾、治疗与资源' },
  { id: 'ongoing', label: '持续效果', hint: '按回合生效的强化' },
  { id: 'status', label: '状态效果', hint: '增益、减益与净化' },
  { id: 'conditional', label: '条件逻辑', hint: '当……且/或……则……否则……' },
  { id: 'special', label: '特殊机制', hint: '陷阱、弃牌、召唤等规则' },
];

const blocks: EffectBlock[] = [
  { id: 'damage', group: 'instant', label: '造成伤害', description: '对目标造成伤害。', type: 'damage' },
  { id: 'shield', group: 'instant', label: '获得护盾', description: '为自身或友方提供护盾。', type: 'shield' },
  { id: 'heal', group: 'instant', label: '恢复生命', description: '恢复目标生命。', type: 'heal' },
  { id: 'draw', group: 'instant', label: '抽取卡牌', description: '立即抽取卡牌。', type: 'draw' },
  { id: 'gain_ap', group: 'instant', label: '获得 AP', description: '立即获得行动点。', type: 'gain_ap' },
  { id: 'gain_mp', group: 'instant', label: '恢复 MP', description: '立即恢复魔力。', type: 'gain_mp' },

  { id: 'ap_regen', group: 'ongoing', label: '持续获得 AP', description: '若干回合内获得额外 AP。', type: 'apply_buff', overrides: { buff: 'ap_regen', value: 1, turns: 3 } },
  { id: 'draw_regen', group: 'ongoing', label: '持续抽牌', description: '若干回合内额外抽牌。', type: 'apply_buff', overrides: { buff: 'draw_regen', value: 1, turns: 3 } },
  { id: 'mp_regen', group: 'ongoing', label: '持续恢复 MP', description: '若干回合内恢复魔力。', type: 'apply_buff', overrides: { buff: 'mp_regen', value: 2, turns: 3 } },
  { id: 'heal_regen', group: 'ongoing', label: '持续治疗', description: '若干回合内恢复生命。', type: 'apply_buff', overrides: { buff: 'heal_regen', value: 2, turns: 3 } },
  { id: 'shield_regen', group: 'ongoing', label: '持续护盾', description: '若干回合内获得护盾。', type: 'apply_buff', overrides: { buff: 'shield_regen', value: 2, turns: 3 } },
  { id: 'damage_bonus', group: 'ongoing', label: '持续增伤', description: '若干回合内提高造成的伤害。', type: 'apply_buff', overrides: { buff: 'damage_bonus', value: 1, turns: 3 } },
  { id: 'spell_damage_bonus', group: 'ongoing', label: '法术强化', description: '若干回合内提高法术伤害。', type: 'apply_buff', overrides: { buff: 'spell_damage_bonus', value: 1, turns: 3 } },
  { id: 'damage_reduce', group: 'ongoing', label: '持续减伤', description: '若干回合内降低受到的伤害。', type: 'apply_buff', overrides: { buff: 'damage_reduce', value: 1, turns: 3 } },
  { id: 'defense_reflect', group: 'ongoing', label: '防反', description: '有护盾时按攻击前80%护盾×防御力百分比反伤（上限150%）；重复施加仅延长回合。', type: 'apply_buff', overrides: { buff: 'defense_reflect', value: 1, turns: 3 } },
  { id: 'counterattack', group: 'ongoing', label: '反击', description: '受攻击后反击一次；可与职业天赋叠加。', type: 'apply_buff', overrides: { buff: 'counterattack', value: 1, turns: 3 } },
  { id: 'blood_burn', group: 'ongoing', label: '烧血', description: '每次行动前损失生命并提高本次伤害。', type: 'apply_buff', overrides: { buff: 'blood_burn', value: 20, turns: 3 } },

  { id: 'buff', group: 'status', label: '施加增益', description: '选择一种增益、数值和持续回合。', type: 'apply_buff' },
  { id: 'debuff', group: 'status', label: '施加减益', description: '选择一种减益、数值和持续回合。', type: 'apply_debuff' },
  { id: 'cleanse', group: 'status', label: '净化', description: '移除己方减益。', type: 'cleanse' },
  { id: 'dispel', group: 'status', label: '驱散', description: '移除敌方增益。', type: 'dispel' },
  { id: 'apply_workshop_status', group: 'status', label: '施加自定义状态', description: '把玩家创建的 Buff 或 Debuff 施加给玩家、怪物或召唤物。', type: 'apply_workshop_status' },

  {
    id: 'conditional_group',
    group: 'conditional',
    label: '当……则……',
    description: '组合多个且/或条件；满足时执行“则”，不满足时可执行“否则”。支付 MP 或 HP 也在这里设置。',
    type: 'conditional_group',
  },

  { id: 'trap', group: 'special', label: '设置陷阱', description: '在敌方行动时触发。', type: 'trap' },
  { id: 'damage_from_shield', group: 'special', label: '护盾转伤害', description: '按现有护盾比例造成伤害。', type: 'damage_from_shield' },
  { id: 'damage_per_debuff', group: 'special', label: '减益增伤', description: '根据目标减益数量造成伤害。', type: 'damage_per_debuff' },
  { id: 'discard', group: 'special', label: '弃置手牌', description: '弃置指定数量的手牌。', type: 'discard' },
  { id: 'discard_all_damage', group: 'special', label: '弃尽手牌伤害', description: '弃置全部手牌并按数量造成伤害。', type: 'discard_all_damage' },
  { id: 'recover_discard', group: 'special', label: '回收弃牌', description: '从弃牌堆回收卡牌。', type: 'recover_discard' },
  { id: 'destroy_summon', group: 'special', label: '牺牲召唤物', description: '牺牲召唤物；若用作代价，请放入条件组。', type: 'destroy_summon' },
  { id: 'reveal_intent', group: 'special', label: '洞察意图', description: '显示敌人的行动意图。', type: 'reveal_intent' },
  { id: 'workshop_resource_change', group: 'special', label: '增减自定义资源', description: '增加、减少或设置已启用的独立职业资源。', type: 'workshop_resource_change' },
  { id: 'summon', group: 'special', label: '创建召唤物', description: '配置召唤物生命和技能。', type: 'summon', cardTypes: ['summon'] },
];

const activeGroup = ref<EffectGroup>('instant');
const visibleBlocks = computed(() =>
  blocks.filter(
    (block) =>
      block.group === activeGroup.value &&
      (!block.cardTypes || block.cardTypes.includes(props.cardType)),
  ),
);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function addBlock(block: EffectBlock): void {
  if (props.disabled) return;
  const option = WORKSHOP_EFFECT_OPTIONS.find(
    (entry) => entry.type === block.type,
  );
  if (!option) return;
  const effect = {
    ...clone(option),
    ...(block.overrides ?? {}),
  } as unknown as CardEffect & { label?: string };
  if (block.type === 'workshop_resource_change') {
    const resource = props.resourceOptions?.[0];
    if (!resource) return;
    effect.mechanismId = resource.mechanismId;
    effect.resourceId = resource.resourceId;
  }
  if (block.type === 'apply_workshop_status') {
    const status = props.statusOptions?.[0];
    if (!status) return;
    effect.mechanismId = status.mechanismId;
    effect.statusId = status.statusId;
    effect.target = status.polarity === 'debuff' ? 'enemy' : 'self';
  }
  delete effect.label;
  emit('add', effect);
}
</script>

<template>
  <section class="effect-palette">
    <header>
      <div>
        <strong>效果积木台</strong>
        <small>先选择积木组，再添加积木；加入后只编辑这个积木需要的参数。</small>
      </div>
      <span>已恢复旧版搭建顺序</span>
    </header>

    <nav aria-label="效果积木分组">
      <button
        v-for="group in groups"
        :key="group.id"
        type="button"
        :class="[group.id, { active: activeGroup === group.id }]"
        @click="activeGroup = group.id"
      >
        <strong>{{ group.label }}</strong>
        <small>{{ group.hint }}</small>
      </button>
    </nav>

    <div class="block-tray" :class="activeGroup">
      <button
        v-for="block in visibleBlocks"
        :key="block.id"
        type="button"
        class="effect-block"
        :disabled="disabled || (block.type === 'workshop_resource_change' && !resourceOptions?.length) || (block.type === 'apply_workshop_status' && !statusOptions?.length)"
        @click="addBlock(block)"
      >
        <span class="connector" aria-hidden="true"></span>
        <strong>{{ block.label }}</strong>
        <small>{{ block.description }}</small>
        <b>＋</b>
      </button>
    </div>
    <p v-if="activeGroup === 'conditional'" class="resource-note">
      “消耗 MP”与“消耗 HP”是支付条件：资源足够时才执行“则”，并降低强度占用，让玩家自行分配更强的后续效果；支付 HP 后至少保留 1 点生命。
    </p>
  </section>
</template>

<style scoped>
.effect-palette {
  display: grid;
  gap: 10px;
  padding: 11px;
  border: 1px solid rgba(212, 168, 67, 0.26);
  border-radius: 12px;
  background: rgba(10, 8, 7, 0.24);
}

.effect-palette > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.effect-palette > header div {
  display: grid;
  gap: 2px;
}

.effect-palette > header strong {
  color: var(--ca-gold-light);
  font-size: 12px;
}

.effect-palette > header small,
.effect-palette > header span,
.resource-note {
  color: var(--ca-muted);
  font-size: 9px;
}

.effect-palette > header span {
  padding: 4px 7px;
  border: 1px solid rgba(94, 180, 126, 0.3);
  border-radius: 999px;
  color: #91d2a8;
}

nav {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 5px;
}

nav button {
  display: grid;
  gap: 2px;
  padding: 7px;
  border: 1px solid var(--ca-border);
  border-radius: 8px;
  color: var(--ca-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

nav button small {
  color: var(--ca-muted);
  font-size: 8px;
}

nav button.active {
  border-color: var(--block-color, var(--ca-gold));
  background: color-mix(in srgb, var(--block-color, var(--ca-gold)) 12%, transparent);
}

.instant { --block-color: #cf8c51; }
.ongoing { --block-color: #5ea87a; }
.status { --block-color: #8179c9; }
.conditional { --block-color: #caaf55; }
.special { --block-color: #b46f9f; }

.block-tray {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.effect-block {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 8px;
  padding: 9px 10px 9px 17px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--block-color) 65%, transparent);
  border-radius: 5px 9px 9px 5px;
  color: var(--ca-text-bright);
  background: color-mix(in srgb, var(--block-color) 16%, #17120f);
  text-align: left;
  cursor: pointer;
}

.effect-block::before,
.effect-block::after {
  content: '';
  position: absolute;
  left: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--block-color);
}

.effect-block::before { top: 7px; }
.effect-block::after { bottom: 7px; }

.effect-block strong {
  font-size: 10px;
}

.effect-block small {
  grid-column: 1;
  color: var(--ca-muted);
  font-size: 8px;
}

.effect-block b {
  grid-column: 2;
  grid-row: 1 / 3;
  align-self: center;
  color: var(--block-color);
  font-size: 16px;
}

.effect-block:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.resource-note {
  margin: 0;
  padding: 8px 9px;
  border-left: 3px solid var(--block-color);
  background: rgba(202, 175, 85, 0.08);
  line-height: 1.55;
}

@media (max-width: 760px) {
  nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .block-tray {
    grid-template-columns: 1fr;
  }

  .effect-palette > header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
