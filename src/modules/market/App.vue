<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type {
  MarketListing,
  MarketListingTab,
  MarketView,
} from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();
const market = ref<MarketView>();
const mode = ref<'buy' | 'sell'>('buy');
const category = ref<'all' | MarketListingTab>('all');
const quantities = ref<Record<string, number>>({});
const sellQuantities = ref<Record<string, number>>({});
const busy = ref('');
const notice = ref('');
const error = ref('');
const disposers: Array<() => void> = [];
let refreshSequence = 0;

const categories: Array<{
  id: 'all' | MarketListingTab;
  label: string;
}> = [
  { id: 'all', label: '全部' },
  { id: 'specialty', label: '区域特产' },
  { id: 'cooking', label: '料理' },
  { id: 'gear', label: '装备与藏品' },
  { id: 'loot', label: '材料' },
  { id: 'cards', label: '通用卡牌' },
];

const visibleListings = computed(() =>
  (market.value?.listings ?? []).filter(
    (listing) =>
      category.value === 'all' || listing.tab === category.value,
  ),
);

const visibleSellItems = computed(() =>
  (market.value?.sellItems ?? []).filter(
    (entry) => category.value === 'all' || entry.tab === category.value,
  ),
);

const visibleSellEquipment = computed(() =>
  category.value === 'all' || category.value === 'gear'
    ? market.value?.sellEquipment ?? []
    : [],
);

const hasVisibleSellEntries = computed(
  () =>
    visibleSellItems.value.length + visibleSellEquipment.value.length > 0 ||
    category.value === 'all' ||
    category.value === 'gear',
);

const refreshLabel = computed(() => {
  if (!market.value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(market.value.nextRefreshAt);
});

async function refresh(): Promise<void> {
  const sequence = ++refreshSequence;
  try {
    const next = await props.context.api.query('market');
    if (sequence !== refreshSequence) return;
    market.value = next;
    error.value = '';
  } catch (caught) {
    if (sequence !== refreshSequence) return;
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

function quantityFor(listing: MarketListing): number {
  if (listing.kind !== 'item') return 1;
  return Math.max(
    1,
    Math.min(listing.stock, quantities.value[listing.key] ?? 1),
  );
}

function setQuantity(listing: MarketListing, value: string): void {
  quantities.value[listing.key] = Math.max(
    1,
    Math.min(listing.stock, Math.floor(Number(value) || 1)),
  );
}

function sellQuantityFor(entry: MarketView['sellItems'][number]): number {
  return Math.max(
    1,
    Math.min(entry.quantity, sellQuantities.value[entry.itemId] ?? 1),
  );
}

function setSellQuantity(
  entry: MarketView['sellItems'][number],
  value: string,
): void {
  sellQuantities.value[entry.itemId] = Math.max(
    1,
    Math.min(entry.quantity, Math.floor(Number(value) || 1)),
  );
}

async function execute(
  key: string,
  command: Record<string, unknown>,
  success: string,
): Promise<void> {
  busy.value = key;
  notice.value = '';
  try {
    const result = await props.context.api.execute(command);
    if (result.status === 'rejected') {
      throw new Error(result.message ?? '集市操作失败');
    }
    notice.value = success;
    await refresh();
  } catch (caught) {
    notice.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = '';
  }
}

function buy(listing: MarketListing): Promise<void> {
  const quantity = quantityFor(listing);
  return execute(
    `buy:${listing.key}`,
    {
      id: commandId('market.buy'),
      type: 'market.buy',
      payload: { listingKey: listing.key, quantity },
    },
    `已购买 ${listing.name} ×${quantity}`,
  );
}

function sellItem(itemId: string, quantity: number, name: string) {
  return execute(
    `sell-item:${itemId}`,
    {
      id: commandId('market.sell-item'),
      type: 'market.sell-item',
      payload: { itemId, quantity },
    },
    `已出售 ${name} ×${quantity}`,
  );
}

function sellEquipment(instanceId: string, name: string) {
  return execute(
    `sell-equipment:${instanceId}`,
    {
      id: commandId('market.sell-equipment'),
      type: 'market.sell-equipment',
      payload: { instanceId },
    },
    `已出售 ${name}`,
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

onMounted(async () => {
  await refresh();
  disposers.push(props.context.api.on('state.changed', refresh));
});

onUnmounted(() => {
  refreshSequence += 1;
  for (const dispose of disposers.splice(0)) dispose();
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="market"
    :date="market ? `${market.regionId} · 区域集市` : '区域集市'"
  >
    <div v-if="!market && !error" class="ca-empty">
      正在从本地数据库整理本轮商品……
    </div>
    <section v-else-if="error" class="market-error" role="alert">
      <strong>集市数据库读取失败</strong>
      <span>{{ error }}</span>
      <button type="button" class="ca-button" @click="refresh">重新读取</button>
    </section>
    <template v-else-if="market">
      <header class="market-heading">
        <div>
          <span>REGIONAL BAZAAR</span>
          <h1>{{ market.regionId }}集市</h1>
          <p>
            商品来自区域、料理、装备、藏品、采集、掉落、合成与通用卡牌数据库
          </p>
        </div>
        <div class="market-wallet">
          <span>持有金币</span>
          <strong>{{ market.gold }}</strong>
          <small>下次刷新 {{ refreshLabel }}</small>
        </div>
      </header>

      <nav class="market-mode">
        <button :class="{ active: mode === 'buy' }" @click="mode = 'buy'">
          购买
        </button>
        <button :class="{ active: mode === 'sell' }" @click="mode = 'sell'">
          出售
        </button>
      </nav>

      <nav class="market-categories">
        <button
          v-for="entry in categories"
          :key="entry.id"
          :class="{ active: category === entry.id }"
          @click="category = entry.id"
        >
          {{ entry.label }}
        </button>
      </nav>

      <template v-if="mode === 'buy'">
        <div v-if="visibleListings.length === 0" class="ca-empty">
          本轮该分类没有商品
        </div>
        <section v-else class="market-grid">
          <article
            v-for="listing in visibleListings"
            :key="listing.key"
            :class="`rarity-${listing.rarity}`"
          >
            <div class="goods-top">
              <span>{{ listing.source }}</span>
              <small>{{ rarityLabel(listing.rarity) }}</small>
            </div>
            <h2>{{ listing.name }}</h2>
            <p v-if="listing.detail">{{ listing.detail }}</p>
            <div class="goods-bottom">
              <div>
                <b>¤ {{ listing.price }}</b>
                <span>库存 {{ listing.stock }}</span>
              </div>
              <label v-if="listing.kind === 'item'">
                <span>数量</span>
                <input
                  type="number"
                  min="1"
                  :max="listing.stock"
                  :value="quantityFor(listing)"
                  @input="
                    setQuantity(
                      listing,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </label>
              <button
                type="button"
                class="ca-button primary"
                :disabled="busy !== '' || listing.stock <= 0"
                @click="buy(listing)"
              >
                {{ busy === `buy:${listing.key}` ? '交易中' : '购买' }}
              </button>
            </div>
          </article>
        </section>
      </template>

      <template v-else>
        <div v-if="!hasVisibleSellEntries" class="ca-empty">
          当前分类没有可出售内容
        </div>
        <section
          v-if="visibleSellItems.length > 0"
          class="ca-section sell-section"
        >
          <h2 class="ca-section-title">物品背包</h2>
          <div class="sell-list">
            <article v-for="entry in visibleSellItems" :key="entry.itemId">
              <div>
                <strong>{{ entry.name }} ×{{ entry.quantity }}</strong>
                <span v-if="entry.detail">{{ entry.detail }}</span>
              </div>
              <div class="sell-price">
                <b>¤ {{ entry.price }}/件</b>
                <small>
                  合计 ¤ {{ entry.price * sellQuantityFor(entry) }}
                </small>
              </div>
              <label class="sell-quantity">
                <span>数量</span>
                <input
                  type="number"
                  min="1"
                  :max="entry.quantity"
                  :value="sellQuantityFor(entry)"
                  @input="
                    setSellQuantity(
                      entry,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </label>
              <button
                type="button"
                class="ca-button"
                :disabled="busy !== ''"
                @click="
                  sellItem(
                    entry.itemId,
                    sellQuantityFor(entry),
                    entry.name,
                  )
                "
              >
                {{ busy === `sell-item:${entry.itemId}` ? '交易中' : '出售' }}
              </button>
            </article>
          </div>
        </section>

        <section
          v-if="category === 'all' || category === 'gear'"
          class="ca-section sell-section"
        >
          <h2 class="ca-section-title">装备背包</h2>
          <p v-if="!market.isMerchant" class="merchant-note">
            沿用旧版规则：只有商人职业可以出售未装备的装备。
          </p>
          <div
            v-else-if="visibleSellEquipment.length === 0"
            class="ca-empty"
          >
            没有可出售的未装备装备
          </div>
          <div v-else class="sell-list">
            <article
              v-for="entry in visibleSellEquipment"
              :key="entry.instanceId"
            >
              <div>
                <strong>{{ entry.name }}</strong>
                <span>{{ entry.description }}</span>
              </div>
              <b>¤ {{ entry.price }}</b>
              <button
                type="button"
                class="ca-button"
                :disabled="busy !== ''"
                @click="sellEquipment(entry.instanceId, entry.name)"
              >
                出售装备
              </button>
            </article>
          </div>
        </section>
      </template>

      <p v-if="notice" class="market-notice">{{ notice }}</p>
    </template>
  </AdventurerFrame>
</template>

<style scoped>
.market-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
  padding: 4px;
}

.market-heading > div:first-child > span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.2em;
}

.market-heading h1 {
  margin: 5px 0;
  color: var(--ca-text-bright);
  font: 700 27px/1.1 var(--ca-serif);
}

.market-heading p,
.market-wallet span,
.market-wallet small {
  margin: 0;
  color: var(--ca-muted);
  font-size: 10px;
}

.market-wallet {
  min-width: 150px;
  display: grid;
  gap: 2px;
  padding: 12px 16px;
  border: 1px solid rgba(212, 168, 67, 0.3);
  border-radius: 15px;
  background: rgba(212, 168, 67, 0.07);
  text-align: right;
}

.market-wallet strong {
  color: var(--ca-gold-light);
  font: 700 25px/1.1 Georgia, serif;
}

.market-mode,
.market-categories {
  display: flex;
  gap: 7px;
  margin-bottom: 12px;
  overflow-x: auto;
}

.market-mode button,
.market-categories button {
  flex: 0 0 auto;
  padding: 8px 13px;
  border: 1px solid var(--ca-border);
  border-radius: 999px;
  color: var(--ca-muted);
  background: var(--ca-surface);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.market-mode button.active,
.market-categories button.active {
  border-color: rgba(212, 168, 67, 0.55);
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.12);
}

.market-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.market-grid article {
  min-width: 0;
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--ca-border);
  border-left: 3px solid #777;
  border-radius: 14px;
  background: linear-gradient(145deg, var(--ca-surface), #11141c);
}

.market-grid article.rarity-uncommon { border-left-color: #56aa78; }
.market-grid article.rarity-rare { border-left-color: #4f91cf; }
.market-grid article.rarity-epic { border-left-color: #9b61bc; }
.market-grid article.rarity-legendary { border-left-color: #d4a843; }

.goods-top,
.goods-bottom,
.sell-list article {
  display: flex;
  align-items: center;
  gap: 9px;
}

.goods-top {
  justify-content: space-between;
  color: var(--ca-gold);
  font-size: 9px;
}

.goods-top small {
  color: var(--ca-muted);
}

.market-grid h2 {
  margin: 0;
  color: var(--ca-text-bright);
  font: 700 16px/1.2 var(--ca-serif);
}

.market-grid p {
  min-height: 2.8em;
  margin: 0;
  color: var(--ca-muted);
  font-size: 10px;
  line-height: 1.45;
}

.goods-bottom {
  margin-top: auto;
}

.goods-bottom > div {
  display: grid;
  margin-right: auto;
}

.goods-bottom b,
.sell-list b {
  color: var(--ca-gold-light);
  font-size: 12px;
  white-space: nowrap;
}

.goods-bottom span {
  color: var(--ca-muted);
  font-size: 9px;
}

.goods-bottom label {
  display: grid;
  gap: 2px;
}

.goods-bottom input {
  width: 55px;
  padding: 5px;
  border: 1px solid var(--ca-border);
  border-radius: 7px;
  color: var(--ca-text);
  background: #0c0f15;
}

.sell-section + .sell-section {
  margin-top: 12px;
}

.sell-list {
  display: grid;
  gap: 8px;
}

.sell-list article {
  padding: 11px;
  border: 1px solid var(--ca-border);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.02);
}

.sell-list article > div:first-child {
  min-width: 0;
  display: grid;
  gap: 3px;
  margin-right: auto;
}

.sell-list strong {
  color: var(--ca-text-bright);
  font-size: 12px;
}

.sell-list span,
.merchant-note {
  color: var(--ca-muted);
  font-size: 10px;
}

.sell-price {
  flex: 0 0 auto;
  display: grid;
  gap: 2px;
  text-align: right;
}

.sell-price small {
  color: var(--ca-muted);
  font-size: 9px;
  white-space: nowrap;
}

.sell-quantity {
  display: grid;
  gap: 2px;
  color: var(--ca-muted);
  font-size: 9px;
}

.sell-quantity input {
  width: 68px;
  padding: 6px;
  border: 1px solid var(--ca-border);
  border-radius: 7px;
  color: var(--ca-text);
  background: #0c0f15;
}

.market-notice,
.market-error {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(212, 168, 67, 0.3);
  border-radius: 10px;
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.08);
  font-size: 11px;
}

.market-error {
  display: grid;
  justify-items: start;
  gap: 8px;
  color: #e9b1ad;
  border-color: rgba(201, 74, 67, 0.35);
  background: rgba(201, 74, 67, 0.09);
}

@media (max-width: 700px) {
  .market-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .market-wallet {
    min-width: 0;
    text-align: left;
  }

  .market-grid {
    grid-template-columns: 1fr;
  }

  .sell-list article {
    align-items: stretch;
    flex-direction: column;
  }

  .sell-list article > div:first-child {
    margin: 0;
  }

  .sell-price {
    text-align: left;
  }
}
</style>
