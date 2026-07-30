<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { loadItemCatalog, loadRelics } from '@/content/catalogs/inventory';
import type {
  BattleItemDefinition,
  RelicDefinition,
} from '@/content/types';
import type { EquipmentSlot, GameSnapshot } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const items = ref<Record<string, BattleItemDefinition>>({});
const relics = ref<Record<string, RelicDefinition>>({});
const tab = ref<'items' | 'equipment' | 'relics'>('items');
const notice = ref('');

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

async function execute(command: unknown) {
  notice.value = '';
  const result = await props.context.api.execute(command);
  if (result.status === 'rejected') {
    notice.value = result.message ?? '操作失败';
    return;
  }
  snapshot.value = await props.context.api.query('state');
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
          物品
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

      <section v-if="tab === 'items'" class="ca-section">
        <h2 class="ca-section-title">物品背包</h2>
        <div v-if="snapshot.inventory.length === 0" class="ca-empty">
          背包中暂时没有物品
        </div>
        <div v-else class="item-grid">
          <article v-for="stack in snapshot.inventory" :key="stack.id">
            <i>◆</i>
            <div>
              <strong>{{ stack.name }}</strong>
              <span>
                {{
                  items[stack.itemId]?.desc ||
                    '旧版物品库未提供额外说明。'
                }}
              </span>
            </div>
            <b>×{{ stack.quantity }}</b>
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
      <p v-if="notice" class="inventory-notice">{{ notice }}</p>
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
  color: #ffaaa5;
  font-size: 11px;
  text-align: center;
}

@media (max-width: 600px) {
  .item-grid,
  .loadout-grid {
    grid-template-columns: 1fr;
  }
}
</style>
