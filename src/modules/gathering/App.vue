<script setup lang="ts">
/* global Window */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { GatheringItem, GatheringView } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();

const gathering = ref<GatheringView>();
const quantities = ref<Record<string, number>>({});
const busy = ref('');
const notice = ref('');
const noticeTone = ref<'success' | 'error'>('success');
const error = ref('');
const clock = ref(Date.now());
const disposers: Array<() => void> = [];
let refreshTimer: number | undefined;
let clockTimer: number | undefined;
let refreshSequence = 0;
let refreshPromise: Promise<void> | undefined;
let mounted = false;

const soldOut = computed(
  () =>
    Boolean(gathering.value?.items.length) &&
    gathering.value!.items.every((item) => item.remaining <= 0),
);

const refreshAtLabel = computed(() => {
  if (!gathering.value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(gathering.value.nextRefreshAt);
});

const refreshCountdown = computed(() => {
  if (!gathering.value) return '';
  const remaining = Math.max(
    0,
    gathering.value.nextRefreshAt - clock.value,
  );
  if (remaining < 60_000) return '不足 1 分钟';
  const totalMinutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
});

function hostWindow(): Window {
  return props.context.document.defaultView ?? globalThis.window;
}

function scheduleRefresh(nextRefreshAt: number): void {
  if (refreshTimer !== undefined) {
    hostWindow().clearTimeout(refreshTimer);
  }
  const untilRefresh = nextRefreshAt - Date.now();
  const delay = untilRefresh > 0 ? untilRefresh + 150 : 60_000;
  refreshTimer = hostWindow().setTimeout(() => {
    refreshTimer = undefined;
    clock.value = Date.now();
    void refresh();
  }, delay);
}

function refresh(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  const sequence = ++refreshSequence;
  refreshPromise = (async () => {
    try {
      const next = await props.context.api.query('gathering');
      if (sequence !== refreshSequence) return;
      gathering.value = next;
      error.value = '';
      clock.value = Date.now();
      scheduleRefresh(next.nextRefreshAt);
    } catch (caught) {
      if (sequence !== refreshSequence) return;
      error.value = caught instanceof Error ? caught.message : String(caught);
    }
  })().finally(() => {
    refreshPromise = undefined;
  });
  return refreshPromise;
}

function quantityFor(item: GatheringItem): number {
  if (item.remaining <= 0) return 0;
  return Math.max(
    1,
    Math.min(item.remaining, quantities.value[item.listingKey] ?? 1),
  );
}

function setQuantity(item: GatheringItem, value: string): void {
  quantities.value[item.listingKey] = Math.max(
    1,
    Math.min(item.remaining, Math.floor(Number(value) || 1)),
  );
}

function categoryLabel(category: string): string {
  return (
    {
      consumable: '可用物品',
      material: '采集材料',
    }[category] ?? category
  );
}

function rarityLabel(rarity: string): string {
  return (
    {
      common: '普通',
      uncommon: '优秀',
      rare: '稀有',
      epic: '史诗',
      legendary: '传说',
    }[rarity] ?? rarity
  );
}

function progressLabel(item: GatheringItem): string {
  return item.action === 'search' ? '搜寻中' : '采集中';
}

async function collect(item: GatheringItem): Promise<void> {
  const quantity = quantityFor(item);
  if (quantity <= 0 || busy.value) return;

  busy.value = item.listingKey;
  notice.value = '';
  try {
    const result = await props.context.api.execute({
      id: commandId('gather.collect'),
      type: 'gather.collect',
      payload: {
        listingKey: item.listingKey,
        quantity,
      },
    });
    if (result.status === 'rejected') {
      throw new Error(result.message ?? `${item.actionLabel}失败`);
    }
    noticeTone.value = 'success';
    notice.value = `已${item.actionLabel}「${item.name}」×${quantity}，物品已放入背包。`;
    quantities.value[item.listingKey] = 1;
    await refresh();
  } catch (caught) {
    noticeTone.value = 'error';
    notice.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = '';
  }
}

onMounted(async () => {
  mounted = true;
  await refresh();
  if (!mounted) return;
  disposers.push(props.context.api.on('state.changed', refresh));
  clockTimer = hostWindow().setInterval(() => {
    clock.value = Date.now();
    if (
      gathering.value &&
      clock.value >= gathering.value.nextRefreshAt &&
      !refreshPromise
    ) {
      void refresh();
    }
  }, 30_000);
});

onUnmounted(() => {
  mounted = false;
  refreshSequence += 1;
  for (const dispose of disposers.splice(0)) dispose();
  if (refreshTimer !== undefined) hostWindow().clearTimeout(refreshTimer);
  if (clockTimer !== undefined) hostWindow().clearInterval(clockTimer);
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="gathering"
    :date="gathering?.location || '区域采集'"
  >
    <div v-if="!gathering && !error" class="ca-empty">
      正在查看当前地区可采集的资源……
    </div>

    <section v-else-if="!gathering" class="ca-section gathering-error" role="alert">
      <strong>采集数据读取失败</strong>
      <span>{{ error }}</span>
      <button type="button" class="ca-button" @click="refresh">
        重新读取
      </button>
    </section>

    <template v-else>
      <header class="ca-section gathering-heading">
        <div>
          <span>REGIONAL GATHERING</span>
          <h1>{{ gathering.regionId }}采集</h1>
          <p>
            仅显示当前区域与现有物品数据库中同时存在的特产，获得后会直接存入背包。
          </p>
        </div>
        <div class="refresh-status">
          <span>区域资源刷新</span>
          <strong>每日 00:00</strong>
          <small>{{ refreshAtLabel }} · {{ refreshCountdown }}后</small>
        </div>
      </header>

      <p
        v-if="error"
        class="gathering-notice error"
        role="alert"
        aria-live="assertive"
      >
        {{ error }}
      </p>

      <p
        v-if="notice"
        class="gathering-notice"
        :class="noticeTone"
        :role="noticeTone === 'error' ? 'alert' : 'status'"
        :aria-live="noticeTone === 'error' ? 'assertive' : 'polite'"
      >
        {{ notice }}
      </p>

      <section
        v-if="!gathering.availableRegion"
        class="ca-section gathering-empty"
      >
        <strong>当前地点暂未开放采集</strong>
        <p>
          {{ gathering.location || gathering.regionId }}没有对应的区域采集资料，系统不会临时生成不存在的物品。
        </p>
      </section>

      <section v-else class="ca-section gathering-resources">
        <h2 class="ca-section-title">
          今日区域资源
          <small>{{ gathering.items.length }} 种</small>
        </h2>

        <div v-if="gathering.items.length === 0" class="ca-empty">
          当前区域的物品数据库中没有可采集资源
        </div>

        <p v-else-if="soldOut" class="sold-out-status" role="status">
          今日资源已经全部采完，请在每日零点刷新后再来。
        </p>

        <div v-if="gathering.items.length > 0" class="gathering-grid">
          <article
            v-for="item in gathering.items"
            :key="item.listingKey"
            class="gathering-card"
            :class="[`rarity-${item.rarity}`, { depleted: item.remaining <= 0 }]"
          >
            <div class="resource-icon" aria-hidden="true">
              {{ item.action === 'search' ? '⌕' : '♧' }}
            </div>
            <div class="resource-copy">
              <div class="resource-meta">
                <span>{{ categoryLabel(item.category) }}</span>
                <small>{{ rarityLabel(item.rarity) }}</small>
              </div>
              <h3>{{ item.name }}</h3>
              <p>{{ item.description }}</p>
              <div class="resource-counts">
                <span>今日剩余 <b>{{ item.remaining }}/{{ item.initialStock }}</b></span>
                <span>背包已有 <b>{{ item.ownedCount }}</b></span>
              </div>
            </div>
            <div class="resource-action">
              <label>
                <span>数量</span>
                <input
                  type="number"
                  inputmode="numeric"
                  min="1"
                  :max="item.remaining"
                  :value="quantityFor(item)"
                  :disabled="item.remaining <= 0 || busy !== ''"
                  :aria-label="`${item.name}${item.actionLabel}数量`"
                  @input="
                    setQuantity(
                      item,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </label>
              <button
                type="button"
                class="ca-button primary"
                :disabled="item.remaining <= 0 || busy !== ''"
                @click="collect(item)"
              >
                <template v-if="busy === item.listingKey">
                  {{ progressLabel(item) }}
                </template>
                <template v-else-if="item.remaining <= 0">
                  今日已采完
                </template>
                <template v-else>
                  {{ item.actionLabel }} ×{{ quantityFor(item) }}
                </template>
              </button>
            </div>
          </article>
        </div>
      </section>
    </template>
  </AdventurerFrame>
</template>

<style scoped>
.gathering-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.gathering-heading > div:first-child {
  min-width: 0;
}

.gathering-heading > div:first-child > span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.2em;
}

.gathering-heading h1 {
  margin: 5px 0;
  color: var(--ca-text-bright);
  font: 700 27px/1.1 var(--ca-serif);
  overflow-wrap: anywhere;
}

.gathering-heading p,
.gathering-empty p {
  margin: 0;
  color: var(--ca-muted);
  font-size: 10px;
  line-height: 1.55;
}

.refresh-status {
  min-width: 176px;
  display: grid;
  flex: 0 0 auto;
  gap: 3px;
  padding: 12px 15px;
  border: 1px solid var(--ca-border);
  border-radius: 12px;
  color: var(--ca-muted);
  background: var(--ca-surface);
  text-align: right;
}

.refresh-status span,
.refresh-status small {
  font-size: 9px;
}

.refresh-status strong {
  color: var(--ca-gold);
  font: 700 15px/1.2 var(--ca-serif);
}

.gathering-resources {
  min-width: 0;
}

.gathering-resources .ca-section-title small {
  margin-left: auto;
  color: var(--ca-muted);
  font: 600 10px/1 var(--ca-ui);
  white-space: nowrap;
}

.gathering-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.gathering-card {
  --gather-rarity: var(--ca-border-light);
  min-width: 0;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 10px;
  padding: 13px;
  border: 1px solid var(--ca-border);
  border-left: 3px solid var(--gather-rarity);
  border-radius: 12px;
  color: var(--ca-text);
  background: var(--ca-surface);
}

.gathering-card.rarity-uncommon { --gather-rarity: var(--ca-green); }
.gathering-card.rarity-rare { --gather-rarity: var(--ca-blue); }
.gathering-card.rarity-epic { --gather-rarity: var(--ca-purple); }
.gathering-card.rarity-legendary { --gather-rarity: var(--ca-gold); }

.gathering-card.depleted {
  opacity: 0.66;
}

.resource-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border: 1px solid var(--ca-border);
  border-radius: 10px;
  color: var(--ca-gold);
  background: var(--ca-surface-soft);
  font: 400 24px/1 var(--ca-serif);
}

.resource-copy {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 5px;
}

.resource-meta,
.resource-counts,
.resource-action {
  display: flex;
  align-items: center;
  gap: 8px;
}

.resource-meta {
  justify-content: space-between;
  color: var(--ca-gold);
  font-size: 9px;
}

.resource-meta small {
  color: var(--ca-muted);
}

.resource-copy h3 {
  margin: 0;
  color: var(--ca-text-bright);
  font: 700 16px/1.25 var(--ca-serif);
  overflow-wrap: anywhere;
}

.resource-copy > p {
  min-height: 2.9em;
  margin: 0;
  color: var(--ca-muted);
  font-size: 10px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.resource-counts {
  flex-wrap: wrap;
  color: var(--ca-muted);
  font-size: 9px;
}

.resource-counts b {
  color: var(--ca-gold);
}

.resource-action {
  grid-column: 1 / -1;
  justify-content: flex-end;
  flex-wrap: wrap;
  padding-top: 3px;
}

.resource-action label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
  color: var(--ca-muted);
  font-size: 9px;
}

.resource-action input {
  width: 64px;
  min-height: 44px;
  padding: 7px;
  border: 1px solid var(--ca-border);
  border-radius: 8px;
  color: var(--ca-text);
  background: var(--ca-surface-soft);
  font: inherit;
}

.resource-action .ca-button {
  min-width: 112px;
  min-height: 44px;
}

.gathering-notice,
.sold-out-status,
.gathering-error,
.gathering-empty {
  overflow-wrap: anywhere;
}

.gathering-notice,
.sold-out-status {
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px solid var(--ca-border);
  border-radius: 10px;
  color: var(--ca-muted);
  background: var(--ca-surface);
  font-size: 11px;
  text-align: center;
}

.gathering-notice.success {
  border-color: var(--ca-green);
  color: var(--ca-green);
}

.gathering-notice.error,
.gathering-error {
  border-color: var(--ca-red);
  color: var(--ca-red);
}

.gathering-error,
.gathering-empty {
  display: grid;
  justify-items: start;
  gap: 8px;
}

.gathering-error span {
  color: var(--ca-muted);
  font-size: 11px;
}

.gathering-error .ca-button {
  min-height: 44px;
}

.gathering-empty strong {
  color: var(--ca-text-bright);
}

@media (max-width: 700px) {
  .gathering-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .refresh-status {
    min-width: 0;
    text-align: left;
  }

  .gathering-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .resource-action {
    align-items: stretch;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(112px, auto);
  }

  .resource-action label {
    min-width: 0;
    margin: 0;
  }

  .resource-action input {
    width: min(78px, 100%);
  }
}

@media (max-width: 380px) {
  .resource-action {
    grid-template-columns: minmax(0, 1fr);
  }

  .resource-action .ca-button {
    width: 100%;
  }
}
</style>
