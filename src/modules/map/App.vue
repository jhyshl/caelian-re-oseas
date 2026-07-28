<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  loadRegionLinks,
  loadRegionPlaces,
  loadRegions,
} from '@/content/catalogs/world';
import type {
  RegionDefinition,
  RegionPlaceDefinition,
} from '@/content/types';
import type { GameSnapshot } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const regions = ref<RegionDefinition[]>([]);
const links = ref<Array<[string, string]>>([]);
const places = ref<Record<string, RegionPlaceDefinition[]>>({});
const selectedId = ref('');
const notice = ref('');

const selectedRegion = computed(() =>
  regions.value.find((region) => region.id === selectedId.value),
);
const selectedPlaces = computed(() =>
  selectedRegion.value ? (places.value[selectedRegion.value.id] ?? []) : [],
);

function accessFor(region: RegionDefinition) {
  const access = snapshot.value?.regionAccess.find(
    (entry) => entry.regionId === region.id,
  );
  const levelReady = (snapshot.value?.player.level ?? 1) >= region.minLevel;
  return {
    accessible: (access?.accessible ?? region.unlocked) && levelReady,
    reason:
      access?.unlockCondition ||
      (!levelReady ? `需要玩家等级 Lv.${region.minLevel}` : ''),
  };
}

function coordinates(id: string) {
  const region = regions.value.find((entry) => entry.id === id);
  return region ? { x: region.x, y: region.y } : { x: 0, y: 0 };
}

async function travel(region: RegionDefinition, place?: RegionPlaceDefinition) {
  const access = accessFor(region);
  if (!access.accessible) {
    notice.value = access.reason || '该地区当前无法前往';
    return;
  }
  const prompt = place ? `前往${place.name}` : `前往${region.name}`;
  const result = await props.context.api.execute({
    id: commandId('world.move'),
    type: 'world.move',
    payload: {
      region: region.name,
      place: place?.name ?? '',
      location: place ? `${region.name}-${place.name}` : region.name,
    },
  });
  if (result.status === 'rejected') {
    notice.value = result.message ?? '移动失败';
    return;
  }
  const filled = props.context.api.setUserInput(prompt);
  snapshot.value = await props.context.api.query('state');
  notice.value = filled
    ? `已移动到${place?.name ?? region.name}，行动文本已填入酒馆输入框。`
    : `已移动到${place?.name ?? region.name}；当前页面未找到酒馆输入框。`;
}

onMounted(async () => {
  [snapshot.value, regions.value, places.value, links.value] = await Promise.all(
    [
      props.context.api.query('state'),
      loadRegions(),
      loadRegionPlaces(),
      loadRegionLinks(),
    ],
  );
  selectedId.value =
    regions.value.find((region) => region.name === snapshot.value?.world.region)
      ?.id ??
    regions.value[0]?.id ??
    '';
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="map"
    :date="snapshot?.world.location"
  >
    <div v-if="!snapshot" class="ca-empty">正在绘制欧西亚斯大陆……</div>
    <template v-else>
      <section class="ca-section">
        <h1 class="ca-section-title">大陆地图</h1>
        <div class="world-map">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <g class="grid-lines">
              <line
                v-for="index in 9"
                :key="`h-${index}`"
                x1="0"
                :y1="index * 10"
                x2="100"
                :y2="index * 10"
              />
              <line
                v-for="index in 9"
                :key="`v-${index}`"
                :x1="index * 10"
                y1="0"
                :x2="index * 10"
                y2="100"
              />
            </g>
            <g class="region-links">
              <line
                v-for="([from, to], index) in links"
                :key="index"
                :x1="coordinates(from).x"
                :y1="coordinates(from).y"
                :x2="coordinates(to).x"
                :y2="coordinates(to).y"
              />
            </g>
          </svg>
          <button
            v-for="region in regions"
            :key="region.id"
            type="button"
            class="region-node"
            :class="{
              current: region.name === snapshot.world.region,
              selected: region.id === selectedId,
              locked: !accessFor(region).accessible,
            }"
            :style="{ left: `${region.x}%`, top: `${region.y}%` }"
            @click="selectedId = region.id"
          >
            <i></i>
            <span>
              {{ region.name }}
              <b v-if="!accessFor(region).accessible">⌕</b>
            </span>
          </button>
        </div>
        <p class="map-hint">
          点击地区查看可前往的建筑与地点；“前往”会更新本地世界状态，并将行动文本填入酒馆输入框。
        </p>
      </section>

      <section v-if="selectedRegion" class="ca-section region-details">
        <header>
          <div>
            <h2>{{ selectedRegion.name }}</h2>
            <p>{{ selectedRegion.desc }}</p>
          </div>
          <span v-if="selectedRegion.name === snapshot.world.region">
            当前地区
          </span>
          <span v-else>Lv.{{ selectedRegion.minLevel }}</span>
        </header>

        <div v-if="!accessFor(selectedRegion).accessible" class="locked-panel">
          <strong>地区暂不可前往</strong>
          <p>
            限制条件：{{
              accessFor(selectedRegion).reason || '条件尚未满足'
            }}
          </p>
        </div>
        <template v-else>
          <h3>可前往建筑 / 地点</h3>
          <button
            v-if="selectedPlaces.length === 0"
            type="button"
            class="place-row"
            @click="travel(selectedRegion)"
          >
            <div>
              <strong>{{ selectedRegion.name }}入口</strong>
              <span>该地区暂未配置具体地点，可先前往地区入口。</span>
            </div>
            <b>前往</b>
          </button>
          <button
            v-for="place in selectedPlaces"
            v-else
            :key="place.name"
            type="button"
            class="place-row"
            @click="travel(selectedRegion, place)"
          >
            <div>
              <strong>{{ place.name }}</strong>
              <span>{{ place.desc }}</span>
            </div>
            <b>前往</b>
          </button>
        </template>
      </section>
      <p v-if="notice" class="map-notice">{{ notice }}</p>
    </template>
  </AdventurerFrame>
</template>

<style scoped>
.world-map {
  position: relative;
  height: 430px;
  overflow: hidden;
  border: 1px solid var(--ca-border);
  border-radius: 13px;
  background:
    radial-gradient(circle at 36% 52%, rgba(77, 91, 92, 0.22), transparent 22%),
    radial-gradient(circle at 67% 35%, rgba(82, 70, 102, 0.18), transparent 25%),
    radial-gradient(ellipse at center, #1a1e2a, #0d0f14);
}

.world-map svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.grid-lines line {
  stroke: rgba(212, 168, 67, 0.055);
  stroke-width: 0.2;
}

.region-links line {
  stroke: rgba(212, 168, 67, 0.22);
  stroke-width: 0.35;
  stroke-dasharray: 1.2 1.2;
}

.region-node {
  position: absolute;
  display: grid;
  justify-items: center;
  transform: translate(-50%, -50%);
  border: 0;
  color: var(--ca-text);
  background: transparent;
  font: 700 11px/1 var(--ca-ui);
  cursor: pointer;
}

.region-node i {
  width: 14px;
  height: 14px;
  margin-bottom: 4px;
  border: 2px solid var(--ca-gold);
  border-radius: 50%;
  background: rgba(212, 168, 67, 0.55);
  box-shadow: 0 0 12px rgba(212, 168, 67, 0.2);
}

.region-node.current i {
  width: 19px;
  height: 19px;
  border-color: var(--ca-gold-light);
  background: var(--ca-gold);
  box-shadow: 0 0 17px rgba(212, 168, 67, 0.55);
}

.region-node.selected span {
  color: var(--ca-gold-light);
}

.region-node.locked {
  color: #5f6168;
}

.region-node.locked i {
  border-color: #3b3e46;
  background: #282b32;
  box-shadow: none;
}

.region-node span {
  white-space: nowrap;
  text-shadow: 0 2px 4px #000;
}

.region-node span b {
  font-size: 9px;
}

.map-hint {
  margin: 11px 2px 0;
  color: var(--ca-muted);
  font-size: 10px;
  line-height: 1.5;
}

.region-details header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.region-details h2 {
  margin: 0;
  color: var(--ca-text-bright);
  font: 700 21px var(--ca-serif);
}

.region-details header p {
  margin: 5px 0 0;
  color: var(--ca-muted);
  font-size: 12px;
  line-height: 1.5;
}

.region-details header > span {
  flex: 0 0 auto;
  padding: 4px 9px;
  border-radius: 999px;
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.12);
  font-size: 10px;
}

.region-details h3 {
  margin: 17px 0 5px;
  color: var(--ca-gold);
  font-size: 12px;
}

.place-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 3px;
  border: 0;
  border-top: 1px solid var(--ca-border);
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.place-row > div {
  display: grid;
  gap: 3px;
}

.place-row strong {
  color: var(--ca-text-bright);
  font-size: 13px;
}

.place-row span {
  color: var(--ca-muted);
  font-size: 10px;
}

.place-row > b {
  flex: 0 0 auto;
  padding: 7px 10px;
  border-radius: 8px;
  color: #1b150c;
  background: var(--ca-gold);
  font-size: 11px;
}

.locked-panel {
  margin-top: 14px;
  padding: 13px;
  border: 1px solid rgba(201, 74, 67, 0.35);
  border-radius: 11px;
  background: rgba(201, 74, 67, 0.07);
}

.locked-panel strong {
  color: #ff9792;
}

.locked-panel p {
  margin: 5px 0 0;
  color: var(--ca-muted);
  font-size: 11px;
}

.map-notice {
  color: #9bdfb9;
  font-size: 11px;
  text-align: center;
}

@media (max-width: 620px) {
  .world-map {
    height: 310px;
  }

  .region-node {
    font-size: 8px;
  }
}
</style>
