<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { loadItemCatalog, loadRelics } from '@/content/catalogs/inventory';
import type {
  BattleItemDefinition,
  RelicDefinition,
} from '@/content/types';
import type {
  EquipmentSlot,
  GameSnapshot,
  InventoryStackRecord,
} from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';
import {
  canApplyInventoryConsumable,
  childEffects,
  isBattleUsableEffect,
  isInventoryUsableEffect,
} from '@/battle/consumables';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const items = ref<Record<string, BattleItemDefinition>>({});
const relics = ref<Record<string, RelicDefinition>>({});
const tab = ref<'items' | 'consumables' | 'equipment' | 'relics'>('items');
const notice = ref('');
const noticeTone = ref<'error' | 'success'>('error');

const itemInventory = computed(() =>
  (snapshot.value?.inventory ?? []).filter(
    (stack) => !itemDefinition(stack.itemId, stack.name)?.effect,
  ),
);
const consumableInventory = computed(() =>
  (snapshot.value?.inventory ?? []).filter((stack) =>
    Boolean(itemDefinition(stack.itemId, stack.name)?.effect),
  ),
);

const carriedCount = computed(
  () => snapshot.value?.relics.filter((entry) => entry.carried).length ?? 0,
);
const equipped = computed(() => {
  const state = snapshot.value;
  if (!state) return { weapon: undefined, armor: undefined, accessory: undefined };
  return {
    weapon: state.equipment.find(
      (entry) => entry.id === state.loadout.weaponId,
    ),
    armor: state.equipment.find(
      (entry) => entry.id === state.loadout.armorId,
    ),
    accessory: state.equipment.find(
      (entry) => entry.id === state.loadout.accessoryId,
    ),
  };
});

function isEquipped(instanceId: string) {
  const loadout = snapshot.value?.loadout;
  return Boolean(
    loadout &&
      [loadout.weaponId, loadout.armorId, loadout.accessoryId].includes(
        instanceId,
      ),
  );
}

async function execute(command: unknown): Promise<boolean> {
  notice.value = '';
  noticeTone.value = 'error';
  const result = await props.context.api.execute(command);
  if (result.status === 'rejected') {
    notice.value = result.message ?? '操作失败';
    return false;
  }
  snapshot.value = await props.context.api.query('state');
  return true;
}

function equip(instanceId: string) {
  return execute({
    id: commandId('equipment.equip'),
    type: 'equipment.equip',
    payload: { instanceId },
  });
}

function unequip(slot: EquipmentSlot) {
  return execute({
    id: commandId('equipment.unequip'),
    type: 'equipment.unequip',
    payload: { slot },
  });
}

function setCarried(relicId: string, carried: boolean) {
  return execute({
    id: commandId('relic.set-carried'),
    type: 'relic.set-carried',
    payload: { relicId, carried },
  });
}

function itemDefinition(itemId: string, name: string) {
  return items.value[itemId] ?? items.value[name];
}

function isBattlePreparationItem(itemId: string, name: string) {
  const effect = itemDefinition(itemId, name)?.effect;
  if (!effect) return false;
  const effects = effect.type === 'multi' ? childEffects(effect) : [effect];
  return effects.some((child) =>
    ['next_battle_buff', 'next_battle_shield', 'next_battle_draw', 'next_battle_ap'].includes(
      child.type,
    ),
  );
}

function consumableAction(stack: InventoryStackRecord) {
  const effect = itemDefinition(stack.itemId, stack.name)?.effect;
  if (!effect) return 'unavailable';
  if (isInventoryUsableEffect(effect)) return 'restore';
  if (isBattlePreparationItem(stack.itemId, stack.name)) return 'prepare';
  if (isBattleUsableEffect(effect)) return 'battle';
  return 'unavailable';
}

function canUseRestorative(stack: InventoryStackRecord) {
  const state = snapshot.value;
  const effect = itemDefinition(stack.itemId, stack.name)?.effect;
  return Boolean(
    state &&
      !state.battle &&
      effect &&
      canApplyInventoryConsumable(effect, state.player),
  );
}

function restorativeButtonLabel(stack: InventoryStackRecord) {
  const state = snapshot.value;
  if (state?.battle) return '战斗中请使用战斗背包';
  if (canUseRestorative(stack)) return '使用';
  const effect = itemDefinition(stack.itemId, stack.name)?.effect;
  const effects =
    effect?.type === 'multi' ? childEffects(effect) : effect ? [effect] : [];
  const restoresHp = effects.some((child) =>
    ['heal', 'heal_mp'].includes(child.type),
  );
  const restoresMp = effects.some((child) =>
    ['gain_mp', 'heal_mp'].includes(child.type),
  );
  if (restoresHp && !restoresMp) return '生命已满';
  if (restoresMp && !restoresHp) return '魔力已满';
  return '生命与魔力已满';
}

async function useConsumable(stack: InventoryStackRecord) {
  const beforeHp = snapshot.value?.player.hp;
  const beforeMp = snapshot.value?.player.mp;
  const applied = await execute({
    id: commandId('inventory.use-consumable'),
    type: 'inventory.use-consumable',
    payload: { itemId: stack.itemId },
  });
  if (
    !applied ||
    beforeHp === undefined ||
    beforeMp === undefined ||
    !snapshot.value
  ) return;
  const after = snapshot.value.player;
  const restored = [
    after.hp > beforeHp ? `生命 +${after.hp - beforeHp}` : '',
    after.mp > beforeMp ? `魔力 +${after.mp - beforeMp}` : '',
  ].filter(Boolean);
  noticeTone.value = 'success';
  notice.value = `已使用「${stack.name}」${restored.length ? `：${restored.join('，')}` : ''}`;
}

async function prepareBattleItem(stack: InventoryStackRecord) {
  const applied = await execute({
    id: commandId('battle.prepare-item'),
    type: 'battle.prepare-item',
    payload: { itemId: stack.itemId },
  });
  if (applied) {
    noticeTone.value = 'success';
    notice.value = `已使用「${stack.name}」，效果将在下场战斗生效。`;
  }
}

onMounted(async () => {
  [snapshot.value, items.value, relics.value] = await Promise.all([
    props.context.api.query('state'),
    loadItemCatalog(),
    loadRelics(),
  ]);
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="inventory"
    :date="snapshot?.world.location"
  >
    <div v-if="!snapshot" class="ca-empty">正在读取本地背包……</div>
    <template v-else>
      <section class="ca-section inventory-head">
        <div>
          <span>LOCAL INVENTORY</span>
          <h1>冒险者背包</h1>
          <p>物品、装备实例和藏品完整状态只保存在浏览器 IndexedDB。</p>
        </div>
        <div class="inventory-count">
          <strong>{{ snapshot.inventory.length }}</strong>
          <span>物品种类</span>
        </div>
      </section>

      <nav class="inventory-tabs">
        <button :class="{ active: tab === 'items' }" @click="tab = 'items'">
          物品 {{ itemInventory.length }}
        </button>
        <button
          :class="{ active: tab === 'consumables' }"
          @click="tab = 'consumables'"
        >
          消耗品 {{ consumableInventory.length }}
        </button>
        <button
          :class="{ active: tab === 'equipment' }"
          @click="tab = 'equipment'"
        >
          装备
        </button>
        <button :class="{ active: tab === 'relics' }" @click="tab = 'relics'">
          藏品
        </button>
      </nav>

      <p
        v-if="notice"
        class="inventory-notice"
        :class="{ success: noticeTone === 'success' }"
      >
        {{ notice }}
      </p>

      <section v-if="tab === 'items'" class="ca-section">
        <h2 class="ca-section-title">物品背包</h2>
        <div v-if="itemInventory.length === 0" class="ca-empty">
          背包中暂时没有物品
        </div>
        <div v-else class="item-grid">
          <article v-for="stack in itemInventory" :key="stack.id">
            <i>◆</i>
            <div>
              <strong>{{ stack.name }}</strong>
              <span v-if="itemDefinition(stack.itemId, stack.name)?.desc">
                {{ itemDefinition(stack.itemId, stack.name)?.desc }}
              </span>
            </div>
            <b>×{{ stack.quantity }}</b>
          </article>
        </div>
      </section>

      <section v-else-if="tab === 'consumables'" class="ca-section">
        <div class="consumable-heading">
          <div>
            <h2 class="ca-section-title">消耗品</h2>
            <p>恢复药剂可直接使用；战前与战斗道具会保留各自的使用时机。</p>
          </div>
          <div class="resource-status" aria-label="当前生命与魔力">
            <span>HP <b>{{ snapshot.player.hp }}/{{ snapshot.player.hpMax }}</b></span>
            <span>MP <b>{{ snapshot.player.mp }}/{{ snapshot.player.mpMax }}</b></span>
          </div>
        </div>
        <div v-if="consumableInventory.length === 0" class="ca-empty">
          背包中暂时没有消耗品
        </div>
        <div v-else class="consumable-grid">
          <article
            v-for="stack in consumableInventory"
            :key="stack.id"
            class="consumable-card"
          >
            <i>✚</i>
            <div>
              <strong>{{ stack.name }}</strong>
              <span>{{ itemDefinition(stack.itemId, stack.name)?.desc }}</span>
            </div>
            <b>×{{ stack.quantity }}</b>
            <button
              v-if="consumableAction(stack) === 'restore'"
              type="button"
              class="ca-button primary"
              :disabled="!canUseRestorative(stack)"
              @click="useConsumable(stack)"
            >
              {{ restorativeButtonLabel(stack) }}
            </button>
            <button
              v-else-if="consumableAction(stack) === 'prepare'"
              type="button"
              class="ca-button primary"
              :disabled="Boolean(snapshot.battle)"
              @click="prepareBattleItem(stack)"
            >
              {{ snapshot.battle ? '战斗中不可用' : '用于下场战斗' }}
            </button>
            <small v-else-if="consumableAction(stack) === 'battle'">
              战斗中从战斗背包使用
            </small>
            <small v-else>暂不支持直接使用</small>
          </article>
        </div>
      </section>

      <template v-else-if="tab === 'equipment'">
        <section class="ca-section">
          <h2 class="ca-section-title">当前装备</h2>
          <div class="loadout-grid">
            <article>
              <i>⚔</i>
              <span>武器</span>
              <strong>
                {{ equipped.weapon?.name ?? '空' }}
              </strong>
              <button
                v-if="snapshot.loadout.weaponId"
                type="button"
                class="ca-button"
                @click="unequip('weapon')"
              >
                卸下
              </button>
            </article>
            <article>
              <i>◈</i>
              <span>防具</span>
              <strong>
                {{ equipped.armor?.name ?? '空' }}
              </strong>
              <button
                v-if="snapshot.loadout.armorId"
                type="button"
                class="ca-button"
                @click="unequip('armor')"
              >
                卸下
              </button>
            </article>
            <article>
              <i>◉</i>
              <span>饰品</span>
              <strong>
                {{ equipped.accessory?.name ?? '空' }}
              </strong>
              <button
                v-if="snapshot.loadout.accessoryId"
                type="button"
                class="ca-button"
                @click="unequip('accessory')"
              >
                卸下
              </button>
            </article>
          </div>
        </section>
        <section class="ca-section">
          <h2 class="ca-section-title">装备背包</h2>
          <div v-if="snapshot.equipment.length === 0" class="ca-empty">
            暂无装备实例
          </div>
          <div v-else class="equipment-list">
            <article v-for="entry in snapshot.equipment" :key="entry.id">
              <i>◇</i>
              <div>
                <strong>{{ entry.name }} {{ '★'.repeat(entry.stars) }}</strong>
                <span>{{ entry.description }}</span>
              </div>
              <button
                type="button"
                class="ca-button"
                :disabled="isEquipped(entry.id)"
                @click="equip(entry.id)"
              >
                {{ isEquipped(entry.id) ? '已装备' : '装备' }}
              </button>
            </article>
          </div>
        </section>
      </template>

      <section v-else class="ca-section">
        <h2 class="ca-section-title">
          藏品
          <small>{{ carriedCount }}/5携带</small>
        </h2>
        <p class="relic-note">
          每个档案中的藏品唯一拥有；只有正在携带的藏品会在战斗中生效。
        </p>
        <div v-if="snapshot.relics.length === 0" class="ca-empty">
          暂未获得藏品
        </div>
        <div v-else class="equipment-list">
          <article v-for="entry in snapshot.relics" :key="entry.id">
            <i>✦</i>
            <div>
              <strong>{{ relics[entry.relicId]?.name ?? entry.relicId }}</strong>
              <span>{{ relics[entry.relicId]?.description ?? '' }}</span>
            </div>
            <button
              type="button"
              class="ca-button"
              :class="{ primary: !entry.carried }"
              :disabled="!entry.carried && carriedCount >= 5"
              @click="setCarried(entry.relicId, !entry.carried)"
            >
              {{ entry.carried ? '卸下' : '携带' }}
            </button>
          </article>
        </div>
      </section>
    </template>
  </AdventurerFrame>
</template>

<style scoped>
.inventory-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.inventory-head > div:first-child > span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.18em;
}

.inventory-head h1 {
  margin: 4px 0;
  color: var(--ca-text-bright);
  font: 700 23px/1.1 var(--ca-serif);
}

.inventory-head p,
.relic-note {
  margin: 0;
  color: var(--ca-muted);
  font-size: 11px;
}

.inventory-count {
  display: grid;
  text-align: center;
}

.inventory-count strong {
  color: var(--ca-gold-light);
  font: 700 27px/1 var(--ca-serif);
}

.inventory-count span {
  margin-top: 4px;
  color: var(--ca-muted);
  font-size: 9px;
}

.inventory-tabs {
  display: flex;
  gap: 6px;
  margin: 13px 0;
}

.inventory-tabs button {
  flex: 1;
  padding: 8px;
  border: 1px solid var(--ca-border);
  border-radius: 9px;
  color: var(--ca-muted);
  background: var(--ca-surface);
  font: 700 12px var(--ca-ui);
  cursor: pointer;
}

.inventory-tabs button.active {
  border-color: var(--ca-gold);
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.1);
}

.item-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.consumable-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.consumable-heading p {
  margin: -3px 0 0;
  color: var(--ca-muted);
  font-size: 10px;
}

.resource-status {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
}

.resource-status span {
  padding: 6px 8px;
  border: 1px solid var(--ca-border);
  border-radius: 8px;
  color: var(--ca-muted);
  background: rgba(255, 255, 255, 0.025);
  font-size: 9px;
}

.resource-status b {
  margin-left: 3px;
  color: var(--ca-text-bright);
}

.consumable-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.consumable-card {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px 10px;
  padding: 10px;
  border: 1px solid var(--ca-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
}

.consumable-card > i {
  width: 34px;
  height: 34px;
  display: grid;
  grid-row: 1 / span 2;
  place-items: center;
  border-radius: 8px;
  color: #ffb5ab;
  background: rgba(203, 76, 65, 0.12);
  font-style: normal;
}

.consumable-card > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.consumable-card strong {
  color: var(--ca-text-bright);
  font-size: 12px;
}

.consumable-card span {
  overflow: hidden;
  color: var(--ca-muted);
  font-size: 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.consumable-card > b {
  color: var(--ca-gold-light);
}

.consumable-card > button,
.consumable-card > small {
  grid-column: 2 / -1;
  justify-self: end;
}

.consumable-card > small {
  color: var(--ca-muted);
  font-size: 9px;
}

.item-grid article,
.equipment-list article {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--ca-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
}

.item-grid i,
.equipment-list i {
  width: 34px;
  height: 34px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  color: var(--ca-gold);
  background: rgba(212, 168, 67, 0.1);
  font-style: normal;
}

.item-grid article > div,
.equipment-list article > div {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 3px;
}

.item-grid strong,
.equipment-list strong {
  color: var(--ca-text-bright);
  font-size: 12px;
}

.item-grid span,
.equipment-list span {
  overflow: hidden;
  color: var(--ca-muted);
  font-size: 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.item-grid b {
  color: var(--ca-gold-light);
}

.loadout-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.loadout-grid article {
  display: grid;
  justify-items: center;
  gap: 5px;
  padding: 13px;
  border: 1px solid var(--ca-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  text-align: center;
}

.loadout-grid i {
  color: var(--ca-gold);
  font-size: 23px;
  font-style: normal;
}

.loadout-grid span {
  color: var(--ca-muted);
  font-size: 9px;
}

.loadout-grid strong {
  color: var(--ca-text-bright);
  font-size: 12px;
}

.equipment-list {
  display: grid;
  gap: 7px;
}

.relic-note {
  margin: -3px 0 12px;
  line-height: 1.5;
}

.inventory-notice {
  margin: 0 0 12px;
  padding: 9px 11px;
  border: 1px solid rgba(201, 74, 67, 0.4);
  border-radius: 9px;
  color: #ffaaa5;
  background: rgba(201, 74, 67, 0.08);
  font-size: 11px;
  text-align: center;
}

.inventory-notice.success {
  border-color: rgba(56, 169, 107, 0.4);
  color: #a9ddb5;
  background: rgba(56, 169, 107, 0.08);
}

@media (max-width: 600px) {
  .item-grid,
  .consumable-grid,
  .loadout-grid {
    grid-template-columns: 1fr;
  }

  .inventory-tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .consumable-heading {
    display: grid;
  }
}
</style>
