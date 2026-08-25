<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  loadCraftingRecipes,
  type CraftingRecipeDefinition,
} from '@/content/catalogs/crafting';
import type { EquipmentInstanceRecord, GameSnapshot } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const recipes = ref<readonly CraftingRecipeDefinition[]>([]);
const tab = ref<'items' | 'equipment'>('items');
const selectedRecipeId = ref('');
const craftCount = ref(1);
const notice = ref('');
const busy = ref(false);

const selectedRecipe = computed(
  () => recipes.value.find((recipe) => recipe.id === selectedRecipeId.value),
);

function owned(material: string): number {
  return (
    snapshot.value?.inventory
      .filter((stack) => stack.itemId === material || stack.name === material)
      .reduce((total, stack) => total + stack.quantity, 0) ?? 0
  );
}

function maxCrafts(recipe: CraftingRecipeDefinition): number {
  const limits = Object.entries(recipe.inputs).map(([material, count]) =>
    Math.floor(owned(material) / count),
  );
  return Math.min(99999, Math.max(0, Math.min(...limits)));
}

const selectedMax = computed(() =>
  selectedRecipe.value ? maxCrafts(selectedRecipe.value) : 0,
);

watch([selectedRecipeId, selectedMax], () => {
  craftCount.value = Math.max(1, Math.min(craftCount.value, selectedMax.value || 1));
});

const mergeGroups = computed(() => {
  const equipment = snapshot.value?.equipment ?? [];
  const groups = new Map<
    string,
    {
      baseId: string;
      stars: 1 | 2;
      name: string;
      entries: EquipmentInstanceRecord[];
    }
  >();
  for (const entry of equipment) {
    if (entry.stars !== 1 && entry.stars !== 2) continue;
    const key = `${entry.baseId}:${entry.stars}`;
    const group = groups.get(key) ?? {
      baseId: entry.baseId,
      stars: entry.stars,
      name: entry.name,
      entries: [],
    };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (left, right) =>
      Number(right.entries.length >= 3) - Number(left.entries.length >= 3) ||
      left.name.localeCompare(right.name, 'zh-CN') ||
      left.stars - right.stars,
  );
});

function selectRecipe(recipe: CraftingRecipeDefinition): void {
  selectedRecipeId.value = recipe.id;
  craftCount.value = Math.max(1, Math.min(craftCount.value, maxCrafts(recipe) || 1));
}

function normalizeCount(): void {
  craftCount.value = Math.max(
    1,
    Math.min(Math.round(Number(craftCount.value) || 1), selectedMax.value || 1),
  );
}

async function execute(command: unknown, success: string): Promise<void> {
  notice.value = '';
  busy.value = true;
  try {
    const result = await props.context.api.execute(command);
    if (result.status === 'rejected') {
      notice.value = result.message ?? '操作失败';
      return;
    }
    snapshot.value = await props.context.api.query('state');
    notice.value = success;
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '操作失败';
  } finally {
    busy.value = false;
  }
}

async function craftSelected(): Promise<void> {
  const recipe = selectedRecipe.value;
  if (!recipe) return;
  normalizeCount();
  const count = craftCount.value;
  await execute(
    {
      id: commandId('craft.item'),
      type: 'craft.item',
      payload: { recipeId: recipe.id, count },
    },
    `已合成 ${recipe.output} ×${recipe.count * count}`,
  );
}

async function mergeEquipment(baseId: string, stars: 1 | 2, name: string) {
  await execute(
    {
      id: commandId('craft.equipment'),
      type: 'craft.equipment',
      payload: { baseId, stars },
    },
    `${name} 已升至 ${stars + 1} 星`,
  );
}

onMounted(async () => {
  [snapshot.value, recipes.value] = await Promise.all([
    props.context.api.query('state'),
    loadCraftingRecipes(),
  ]);
  selectedRecipeId.value = recipes.value[0]?.id ?? '';
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="crafting"
    :date="snapshot?.world.location"
  >
    <div v-if="!snapshot" class="ca-empty">正在读取本地合成数据……</div>
    <template v-else>
      <section class="ca-section crafting-head">
        <div>
          <span>LOCAL CRAFTING</span>
          <h1>合成台</h1>
          <p>配方与库存只在浏览器本地结算，材料和产物会在同一事务内写入。</p>
        </div>
        <div class="recipe-count">
          <strong>{{ recipes.length }}</strong>
          <span>物品配方</span>
        </div>
      </section>

      <nav class="crafting-tabs" aria-label="合成类型">
        <button :class="{ active: tab === 'items' }" @click="tab = 'items'">
          道具合成
        </button>
        <button
          :class="{ active: tab === 'equipment' }"
          @click="tab = 'equipment'"
        >
          装备升星
        </button>
      </nav>

      <p v-if="notice" class="crafting-notice" role="status">{{ notice }}</p>

      <div v-if="tab === 'items'" class="crafting-layout">
        <section class="ca-section recipe-list">
          <h2 class="ca-section-title">配方</h2>
          <button
            v-for="recipe in recipes"
            :key="recipe.id"
            type="button"
            :class="{ active: recipe.id === selectedRecipeId }"
            @click="selectRecipe(recipe)"
          >
            <span>
              <strong>{{ recipe.name }}</strong>
              <small>{{ recipe.category }} · {{ recipe.basePrice }} 金币</small>
            </span>
            <b>{{ maxCrafts(recipe) }}</b>
          </button>
        </section>

        <section v-if="selectedRecipe" class="ca-section recipe-detail">
          <div class="recipe-title">
            <div>
              <span>OUTPUT</span>
              <h2>{{ selectedRecipe.output }} ×{{ selectedRecipe.count }}</h2>
            </div>
            <strong>{{ selectedRecipe.basePrice }} G</strong>
          </div>
          <p class="effect-text">{{ selectedRecipe.effectText || '合成材料' }}</p>

          <h3>所需材料</h3>
          <div class="material-list">
            <div
              v-for="(need, material) in selectedRecipe.inputs"
              :key="material"
              :class="{ lacking: owned(material) < need * craftCount }"
            >
              <span>{{ material }}</span>
              <strong>{{ owned(material) }} / {{ need * craftCount }}</strong>
            </div>
          </div>

          <div class="batch-control">
            <label for="craft-count">合成数量</label>
            <input
              id="craft-count"
              v-model.number="craftCount"
              type="range"
              min="1"
              :max="Math.max(1, selectedMax)"
              :disabled="selectedMax === 0"
            />
            <input
              v-model.number="craftCount"
              type="number"
              min="1"
              :max="Math.max(1, selectedMax)"
              :disabled="selectedMax === 0"
              aria-label="合成数量数字输入"
              @change="normalizeCount"
            />
            <span>最多 {{ selectedMax }}</span>
          </div>

          <button
            type="button"
            class="ca-button primary craft-button"
            :disabled="busy || selectedMax === 0"
            @click="craftSelected"
          >
            {{ busy ? '合成中……' : `合成 ×${craftCount}` }}
          </button>
        </section>
      </div>

      <section v-else class="ca-section equipment-crafting">
        <div class="equipment-rule">
          <h2>三件同名同星装备 → 一件更高星装备</h2>
          <p>最高三星；每次升星属性翻倍（1★ ×1、2★ ×2、3★ ×4）。</p>
        </div>
        <div v-if="mergeGroups.length === 0" class="ca-empty">
          暂无可用于升星的装备
        </div>
        <div v-else class="merge-list">
          <article v-for="group in mergeGroups" :key="`${group.baseId}:${group.stars}`">
            <div>
              <span>{{ '★'.repeat(group.stars) }}</span>
              <strong>{{ group.name }}</strong>
              <small>
                拥有 {{ group.entries.length }} / 3 · 升至
                {{ '★'.repeat(group.stars + 1) }}
              </small>
            </div>
            <button
              type="button"
              class="ca-button primary"
              :disabled="busy || group.entries.length < 3"
              @click="mergeEquipment(group.baseId, group.stars, group.name)"
            >
              {{ group.entries.length < 3 ? `还缺 ${3 - group.entries.length} 件` : '升星' }}
            </button>
          </article>
        </div>
      </section>
    </template>
  </AdventurerFrame>
</template>

<style scoped>
.crafting-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
  background: radial-gradient(circle at 85% 15%, rgba(212, 168, 67, 0.16), transparent 35%), var(--ca-surface);
}
.crafting-head span, .recipe-title span { color: var(--ca-gold); font-size: 10px; letter-spacing: .22em; }
.crafting-head h1 { margin: 5px 0 6px; color: var(--ca-text-bright); font: 700 28px/1.1 var(--ca-serif); }
.crafting-head p { margin: 0; color: var(--ca-muted); font-size: 12px; }
.recipe-count { min-width: 92px; text-align: center; }
.recipe-count strong { display: block; color: var(--ca-gold-light); font: 700 30px/1 var(--ca-serif); }
.recipe-count span { letter-spacing: .08em; }
.crafting-tabs { display: flex; gap: 8px; margin-bottom: 14px; }
.crafting-tabs button { flex: 1; padding: 11px; border: 1px solid var(--ca-border); border-radius: 10px; color: var(--ca-muted); background: var(--ca-surface); cursor: pointer; }
.crafting-tabs button.active { border-color: var(--ca-gold-dark); color: var(--ca-gold-light); background: rgba(212,168,67,.1); }
.crafting-notice { margin: 0 0 14px; padding: 10px 13px; border: 1px solid rgba(56,169,107,.35); border-radius: 9px; color: #9de2ba; background: rgba(56,169,107,.08); }
.crafting-layout { display: grid; grid-template-columns: minmax(230px, .8fr) minmax(340px, 1.2fr); gap: 14px; }
.recipe-list { max-height: 600px; overflow: auto; }
.recipe-list > button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px; border: 0; border-bottom: 1px solid var(--ca-border); color: var(--ca-text); background: transparent; text-align: left; cursor: pointer; }
.recipe-list > button.active { color: var(--ca-gold-light); background: rgba(212,168,67,.09); }
.recipe-list button span { display: grid; gap: 4px; }
.recipe-list small { color: var(--ca-muted); font-size: 10px; }
.recipe-list b { min-width: 28px; padding: 4px; border-radius: 8px; color: var(--ca-gold); background: rgba(212,168,67,.08); text-align: center; }
.recipe-title { display: flex; justify-content: space-between; gap: 12px; }
.recipe-title h2 { margin: 4px 0 0; color: var(--ca-text-bright); font: 700 25px/1.2 var(--ca-serif); }
.recipe-title > strong { color: var(--ca-gold); }
.effect-text { padding: 12px; border-left: 3px solid var(--ca-gold-dark); color: var(--ca-text); background: rgba(255,255,255,.025); }
.recipe-detail h3 { margin: 20px 0 9px; color: var(--ca-gold-light); font-size: 13px; }
.material-list { display: grid; gap: 7px; }
.material-list div { display: flex; justify-content: space-between; padding: 9px 11px; border: 1px solid var(--ca-border); border-radius: 8px; }
.material-list .lacking strong { color: #df746e; }
.batch-control { display: grid; grid-template-columns: auto minmax(100px,1fr) 72px auto; align-items: center; gap: 10px; margin-top: 22px; color: var(--ca-muted); font-size: 11px; }
.batch-control input[type="number"] { width: 72px; padding: 8px; border: 1px solid var(--ca-border); border-radius: 8px; color: var(--ca-text); background: var(--ca-bg); }
.batch-control input[type="range"] { accent-color: var(--ca-gold); }
.craft-button { width: 100%; margin-top: 14px; }
.equipment-rule { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--ca-border); }
.equipment-rule h2 { margin: 0 0 5px; color: var(--ca-gold); font: 700 19px var(--ca-serif); }
.equipment-rule p { margin: 0; color: var(--ca-muted); font-size: 12px; }
.merge-list { display: grid; gap: 9px; }
.merge-list article { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px; border: 1px solid var(--ca-border); border-radius: 11px; background: rgba(255,255,255,.02); }
.merge-list article div { display: grid; gap: 4px; }
.merge-list article span { color: var(--ca-gold); letter-spacing: .12em; }
.merge-list article small { color: var(--ca-muted); }
@media (max-width: 760px) {
  .crafting-layout { grid-template-columns: 1fr; }
  .recipe-list { max-height: 260px; }
  .batch-control { grid-template-columns: 1fr 72px; }
  .batch-control label, .batch-control span { grid-column: span 1; }
  .merge-list article { align-items: stretch; flex-direction: column; }
}
</style>
