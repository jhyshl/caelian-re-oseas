<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getProfessionTalent, subclassNames } from '@/content/catalogs/professions';
import {
  loadEquipmentDefinitions,
  loadRelics,
} from '@/content/catalogs/inventory';
import type { EquipmentDefinition, RelicDefinition } from '@/content/types';
import type { GameSnapshot } from '@/domain/types';
import {
  aggregateEquipmentStats,
  equipmentInstanceDescription,
} from '@/equipment-stats';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import ProfessionDialog from '@/modules/character/ProfessionDialog.vue';
import {
  equipmentRewardEffect,
  equipmentRewardMeta,
  relicRewardEffect,
  rewardRarityName,
} from '@/rewards/reward-display';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';
import AdjustableAvatar from '@/ui/AdjustableAvatar.vue';
import MeterBar from '@/ui/adventurer/MeterBar.vue';
import {
  LIFESTEAL_CAP,
  LIFESTEAL_STAT_POINT_COST,
} from '@/player/progression';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const equipmentRewards = ref<Record<string, EquipmentDefinition>>({});
const relicRewards = ref<Record<string, RelicDefinition>>({});
const playerAvatarUrl = ref('');
const playerAvatarFallbackUrl = ref('');
const busyStat = ref('');
const busyReward = ref('');
const preparingRewards = ref(false);
const statEditMode = ref(false);
const professionDialog = ref<'create' | 'reclass'>();
const notice = ref('');
const disposers: Array<() => void> = [];

const player = computed(() => snapshot.value?.player);
const equippedStats = computed(() => {
  const value = snapshot.value;
  if (!value) return aggregateEquipmentStats([]);
  const equippedIds = new Set(
    [
      value.loadout.weaponId,
      value.loadout.armorId,
      value.loadout.accessoryId,
    ].filter((id): id is string => Boolean(id)),
  );
  return aggregateEquipmentStats(
    value.equipment.filter((item) => equippedIds.has(item.id)),
  );
});
const effectiveHpMax = computed(() =>
  Math.max(1, (player.value?.hpMax ?? 1) + equippedStats.value.hpMax),
);
const effectiveHp = computed(() =>
  Math.max(
    0,
    Math.min(
      effectiveHpMax.value,
      player.value?.hp ?? 0,
    ),
  ),
);
const effectiveMpMax = computed(() =>
  Math.max(0, (player.value?.mpMax ?? 0) + equippedStats.value.mpMax),
);
const effectiveMp = computed(() =>
  Math.max(
    0,
    Math.min(
      effectiveMpMax.value,
      player.value?.mp ?? 0,
    ),
  ),
);
const profession = computed(() =>
  player.value ? getProfessionTalent(player.value.subclass) : undefined,
);
const pendingLevelReward = computed(() =>
  snapshot.value?.player.pendingLevelRewards?.find(
    (entry) => !entry.equipmentClaimed || !entry.relicClaimed,
  ),
);
const experiencePercent = computed(() => {
  const value = player.value;
  if (!value || value.experienceToNext <= 0) return 0;
  return Math.round((value.experience / value.experienceToNext) * 100);
});
const affinityPercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(snapshot.value?.social.affinity ?? 0))),
);
const allocationTotal = computed(() => {
  const allocation = snapshot.value?.statAllocations;
  if (!allocation) return 0;
  return (
    allocation.hpMax +
    allocation.mpMax +
    allocation.attack +
    allocation.defense +
    allocation.speed +
    allocation.lifesteal * LIFESTEAL_STAT_POINT_COST +
    allocation.actionPointCosts.reduce((sum, value) => sum + value, 0)
  );
});

const statRows = [
  { id: 'hpMax', icon: '❤', label: '生命', note: '每点 +5' },
  { id: 'mpMax', icon: '◆', label: '魔力', note: '每点 +5' },
  { id: 'attack', icon: '⚔', label: '攻击', note: '每点 +1' },
  { id: 'defense', icon: '◈', label: '防御', note: '每点 +1' },
  { id: 'speed', icon: 'ϟ', label: '速度', note: '每点 +1' },
  {
    id: 'lifesteal',
    icon: '♢',
    label: '吸血',
    note: '消耗2点 +1%，最高30%',
  },
  {
    id: 'actionPointsPerTurn',
    icon: '◎',
    label: 'AP',
    note: '≤10消耗2点，之后消耗3点',
  },
] as const;

async function refreshState() {
  snapshot.value = await props.context.api.query('state');
  if (!snapshot.value.player.created) professionDialog.value = 'create';
  await ensureLevelRewardChoices();
}

async function ensureLevelRewardChoices() {
  const reward = pendingLevelReward.value;
  if (!reward || preparingRewards.value) return;
  const needsChoices =
    (!reward.equipmentClaimed && reward.equipmentIds.length === 0) ||
    (!reward.relicClaimed && reward.relicIds.length === 0);
  if (!needsChoices) return;
  preparingRewards.value = true;
  try {
    const result = await props.context.api.execute({
      id: commandId('player.prepare-level-rewards'),
      type: 'player.prepare-level-rewards',
      payload: {},
    });
    if (result.status === 'rejected') throw new Error(result.message);
    snapshot.value = await props.context.api.query('state');
  } catch (caught) {
    notice.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    preparingRewards.value = false;
  }
}

async function refreshAvatar(force = false) {
  const next = await props.context.api.getAvatarUrls(
    force ? { refresh: 'user' } : undefined,
  );
  playerAvatarUrl.value = next.userOriginal || next.user;
  playerAvatarFallbackUrl.value =
    next.userOriginal && next.userOriginal !== next.user
      ? next.user
      : '';
}

async function refresh() {
  [equipmentRewards.value, relicRewards.value] = await Promise.all([
    loadEquipmentDefinitions(),
    loadRelics(),
  ]);
  await Promise.all([refreshState(), refreshAvatar(true)]);
}

function handlePlayerAvatarError() {
  playerAvatarUrl.value = '';
  playerAvatarFallbackUrl.value = '';
}

async function allocate(
  stat: (typeof statRows)[number]['id'],
  direction: 'add' | 'remove',
) {
  busyStat.value = `${stat}:${direction}`;
  notice.value = '';
  try {
    const result = await props.context.api.execute({
      id: commandId('player.allocate-stat'),
      type: 'player.allocate-stat',
      payload: { stat, direction },
    });
    if (result.status === 'rejected') throw new Error(result.message);
    await refreshState();
  } catch (caught) {
    notice.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busyStat.value = '';
  }
}

async function claimLevelReward(
  kind: 'equipment' | 'relic',
  choiceId?: string,
) {
  const reward = pendingLevelReward.value;
  if (!reward) return;
  busyReward.value = `${kind}:${choiceId ?? 'skip'}`;
  notice.value = '';
  try {
    const result = await props.context.api.execute({
      id: commandId('player.claim-level-reward'),
      type: 'player.claim-level-reward',
      payload: { rewardId: reward.id, kind, choiceId },
    });
    if (result.status === 'rejected') throw new Error(result.message);
    notice.value = choiceId ? '升级奖励已放入本地背包。' : '已跳过这项升级奖励。';
    await refreshState();
  } catch (caught) {
    notice.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busyReward.value = '';
  }
}

function statValue(id: (typeof statRows)[number]['id']): number {
  const base = snapshot.value?.player[id] ?? 0;
  return base + equippedStats.value[id];
}

function invested(id: (typeof statRows)[number]['id']): number {
  return snapshot.value?.statAllocations[id] ?? 0;
}

function equipmentBonus(id: (typeof statRows)[number]['id']): number {
  return equippedStats.value[id];
}

function statAddCost(id: (typeof statRows)[number]['id']): number {
  if (id === 'lifesteal') return LIFESTEAL_STAT_POINT_COST;
  if (id !== 'actionPointsPerTurn') return 1;
  return (snapshot.value?.player.actionPointsPerTurn ?? 0) <= 10 ? 2 : 3;
}

function canAddStat(id: (typeof statRows)[number]['id']): boolean {
  const value = snapshot.value;
  if (!value || value.player.statPoints < statAddCost(id)) return false;
  return id !== 'lifesteal' || value.player.lifesteal < LIFESTEAL_CAP;
}

function equipped(slot: 'weaponId' | 'armorId' | 'accessoryId') {
  const id = snapshot.value?.loadout[slot];
  return snapshot.value?.equipment.find((item) => item.id === id);
}

function equippedDescription(slot: 'weaponId' | 'armorId' | 'accessoryId') {
  const item = equipped(slot);
  return item ? equipmentInstanceDescription(item) : '';
}

async function professionApplied() {
  professionDialog.value = undefined;
  notice.value = '职业与预设牌组已保存到本地档案。';
  await refreshState();
}

onMounted(async () => {
  await refresh();
  disposers.push(
    props.context.api.on('state.changed', refreshState),
    props.context.api.on('tavern.changed', async ({ event }) => {
      await refreshState();
      if (
        event === 'CHAT_CHANGED' ||
        event === 'PERSONA_CHANGED' ||
        event === 'PERSONA_UPDATED'
      ) {
        await refreshAvatar();
      }
    }),
  );
});
onUnmounted(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="character"
    :date="
      snapshot
        ? `${snapshot.world.gameDate} · ${snapshot.world.gameTime} · ${snapshot.world.weather}`
        : ''
    "
  >
    <div v-if="!snapshot" class="ca-empty">正在读取冒险者档案……</div>

    <template v-else>
      <section class="ca-section identity-card">
        <AdjustableAvatar
          class="avatar"
          :src="playerAvatarUrl"
          :fallback-src="playerAvatarFallbackUrl"
          :alt="`${snapshot.player.name || '玩家'}的头像`"
          :fallback="snapshot.player.name.trim().slice(0, 1) || '冒'"
          preference-id="player"
          :teleport-target="context.document.body"
          @image-error="handlePlayerAvatarError"
        />
        <div class="identity">
          <h1>{{ snapshot.player.name || '未命名' }}</h1>
          <div class="badges">
            <span>Lv.{{ snapshot.player.level }}</span>
            <span v-if="snapshot.player.subclass !== 'none'" class="blue">
              {{
                subclassNames[snapshot.player.subclass] ??
                  snapshot.player.subclass
              }}
            </span>
            <span v-if="snapshot.guild.rank !== 'unregistered'" class="green">
              {{ snapshot.guild.rank === 'copper' ? '青铜' : snapshot.guild.rank
              }}冒险者
            </span>
          </div>
        </div>
        <div class="gold">
          <strong>{{ snapshot.player.gold.toLocaleString() }}</strong>
          <span>金币</span>
        </div>
        <div class="vitals">
          <MeterBar
            label="HP"
            :value="effectiveHp"
            :max="effectiveHpMax"
            color="var(--ca-green)"
          />
          <MeterBar
            label="MP"
            :value="effectiveMp"
            :max="effectiveMpMax"
            color="var(--ca-blue)"
          />
          <MeterBar
            :label="`EXP (${experiencePercent}%)`"
            :value="snapshot.player.experience"
            :max="snapshot.player.experienceToNext"
          />
        </div>
      </section>

      <section v-if="pendingLevelReward" class="ca-section level-rewards">
        <h2 class="ca-section-title">
          <span>升级奖励 <small>Lv.{{ pendingLevelReward.level }}</small></span>
        </h2>
        <p class="level-reward-copy">
          每提升一级都可分别选择一件 2★ 装备与一件藏品；未领取的奖励会保留在当前档案中。
        </p>
        <div v-if="!pendingLevelReward.equipmentClaimed" class="level-reward-group">
          <strong>装备 · 选择一件</strong>
          <div class="level-reward-grid">
            <button
              v-for="equipmentId in pendingLevelReward.equipmentIds"
              :key="equipmentId"
              type="button"
              :disabled="Boolean(busyReward)"
              @click="claimLevelReward('equipment', equipmentId)"
            >
              <b>{{ equipmentRewards[equipmentId]?.name ?? equipmentId }}</b>
              <small>{{ equipmentRewardMeta(equipmentRewards[equipmentId], 2) }}</small>
              <span>{{ equipmentRewardEffect(equipmentRewards[equipmentId], 2) }}</span>
            </button>
            <button
              type="button"
              class="skip"
              :disabled="Boolean(busyReward)"
              @click="claimLevelReward('equipment')"
            >
              跳过装备
            </button>
          </div>
        </div>
        <div v-if="!pendingLevelReward.relicClaimed" class="level-reward-group">
          <strong>藏品 · 选择一件</strong>
          <div class="level-reward-grid">
            <button
              v-for="relicId in pendingLevelReward.relicIds"
              :key="relicId"
              type="button"
              :disabled="Boolean(busyReward)"
              @click="claimLevelReward('relic', relicId)"
            >
              <b>{{ relicRewards[relicId]?.name ?? relicId }}</b>
              <small>{{ rewardRarityName(String(relicRewards[relicId]?.rarity ?? 'level')) }} · 藏品</small>
              <span>{{ relicRewardEffect(relicRewards[relicId]) }}</span>
            </button>
            <button
              type="button"
              class="skip"
              :disabled="Boolean(busyReward)"
              @click="claimLevelReward('relic')"
            >
              跳过藏品
            </button>
          </div>
        </div>
      </section>

      <section class="ca-section companion-summary">
        <div class="companion-copy">
          <span class="companion-kicker">同行者</span>
          <h2>凯利安</h2>
          <p>
            {{ snapshot.social.mood || '平静' }} ·
            {{ snapshot.social.relationshipStage || '陌生人' }}
          </p>
        </div>
        <div class="companion-affinity">
          <div>
            <span>好感度</span>
            <strong>{{ snapshot.social.affinity }}</strong>
            <small>/100</small>
          </div>
          <i><b :style="{ width: `${affinityPercent}%` }"></b></i>
        </div>
        <button
          type="button"
          class="ca-button"
          @click="context.api.navigatePanel('affinity')"
        >
          查看状态栏
        </button>
      </section>

      <section class="ca-section">
        <h2 class="ca-section-title">
          <span>职业天赋</span>
          <button
            v-if="snapshot.player.created"
            type="button"
            class="ca-button primary"
            @click="professionDialog = 'reclass'"
          >
            转职
          </button>
        </h2>
        <template v-if="profession">
          <h3 class="profession-title">{{ profession.title }}</h3>
          <p class="profession-copy">
            <b>主要玩法：</b>{{ profession.playstyle }}
          </p>
          <p class="profession-copy">
            <b>天赋技能：</b>{{ profession.talent }}
          </p>
        </template>
      </section>

      <section class="ca-section">
        <h2 class="ca-section-title">
          <span>
            属性
            <small v-if="snapshot.player.statPoints > 0">
              可分配 {{ snapshot.player.statPoints }}
            </small>
          </span>
          <button
            v-if="snapshot.player.statPoints > 0 || allocationTotal > 0"
            type="button"
            class="ca-button"
            @click="statEditMode = !statEditMode"
          >
            {{ statEditMode ? '完成编辑' : '编辑加点' }}
          </button>
        </h2>
        <div class="stats-grid">
          <article v-for="row in statRows" :key="row.id">
            <span>{{ row.icon }} {{ row.label }}</span>
            <strong>
              {{ statValue(row.id) }}{{ row.id === 'lifesteal' ? '%' : '' }}
            </strong>
            <small v-if="equipmentBonus(row.id)">
              装备 {{ equipmentBonus(row.id) > 0 ? '+' : ''
              }}{{ equipmentBonus(row.id) }}{{ row.id === 'lifesteal' ? '%' : '' }}
            </small>
          </article>
          <article>
            <span>▱ 补抽</span>
            <strong>
              {{ snapshot.player.drawPerTurn + equippedStats.drawPerTurn }}
            </strong>
            <small v-if="equippedStats.drawPerTurn">
              装备 {{ equippedStats.drawPerTurn > 0 ? '+' : ''
              }}{{ equippedStats.drawPerTurn }}
            </small>
          </article>
        </div>
        <div v-if="statEditMode" class="allocation-grid">
          <article v-for="row in statRows" :key="row.id">
            <div>
              <strong>{{ row.icon }} {{ row.label }}</strong>
              <span>{{ row.note }}｜已加：{{ invested(row.id) }}</span>
            </div>
            <div>
              <button
                type="button"
                class="ca-button"
                :disabled="
                  invested(row.id) <= 0 ||
                    busyStat === `${row.id}:remove`
                "
                @click="allocate(row.id, 'remove')"
              >
                −1
              </button>
              <button
                type="button"
                class="ca-button primary"
                :disabled="
                  !canAddStat(row.id) ||
                    busyStat === `${row.id}:add`
                "
                @click="allocate(row.id, 'add')"
              >
                +1
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="ca-section">
        <h2 class="ca-section-title">装备 <small>每类1件</small></h2>
        <div class="equipment-list">
          <article>
            <i>⚔</i>
            <div>
              <span>武器</span>
              <strong>{{ equipped('weaponId')?.name ?? '空' }}</strong>
              <small>{{ equippedDescription('weaponId') }}</small>
            </div>
          </article>
          <article>
            <i>◈</i>
            <div>
              <span>防具</span>
              <strong>{{ equipped('armorId')?.name ?? '空' }}</strong>
              <small>{{ equippedDescription('armorId') }}</small>
            </div>
          </article>
          <article>
            <i>◉</i>
            <div>
              <span>饰品</span>
              <strong>{{ equipped('accessoryId')?.name ?? '空' }}</strong>
              <small>{{ equippedDescription('accessoryId') }}</small>
            </div>
          </article>
        </div>
      </section>

      <section v-if="snapshot.passives.length" class="ca-section">
        <h2 class="ca-section-title">被动天赋</h2>
        <article
          v-for="passive in snapshot.passives"
          :key="passive.id"
          class="passive-row"
        >
          <i>P</i>
          <div>
            <strong>{{ passive.name }}</strong>
            <span>{{ passive.description }}</span>
          </div>
        </article>
      </section>

      <section class="ca-section">
        <h2 class="ca-section-title">
          藏品
          <small>
            {{ snapshot.relics.filter((item) => item.carried).length }}/5携带 ·
            {{ snapshot.relics.length }}已拥有
          </small>
        </h2>
        <div v-if="snapshot.relics.length === 0" class="ca-empty">
          当前没有拥有或携带的藏品
        </div>
      </section>

      <p v-if="notice" class="notice">{{ notice }}</p>
      <footer class="location">
        ⌖ {{ snapshot.world.region
        }}{{ snapshot.world.place ? ` · ${snapshot.world.place}` : '' }}
      </footer>

      <ProfessionDialog
        v-if="professionDialog"
        :context="context"
        :player="snapshot.player"
        :mode="professionDialog"
        @close="professionDialog = undefined"
        @applied="professionApplied"
      />
    </template>
  </AdventurerFrame>
</template>

<style scoped>
.identity-card {
  display: grid;
  grid-template:
    "avatar identity gold" auto
    "vitals vitals vitals" auto /
    auto 1fr auto;
  gap: 12px;
}

.level-rewards {
  border-color: rgba(212, 168, 67, 0.42);
  background:
    radial-gradient(circle at 0 0, rgba(212, 168, 67, 0.12), transparent 38%),
    var(--ca-surface);
}

.level-reward-copy {
  margin: 0 0 12px;
  color: var(--ca-muted);
  font-size: 11px;
  line-height: 1.55;
}

.level-reward-group + .level-reward-group {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ca-border);
}

.level-reward-group > strong {
  display: block;
  margin-bottom: 7px;
  color: var(--ca-gold-light);
  font-size: 11px;
}

.level-reward-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 7px;
}

.level-reward-grid button {
  min-height: 92px;
  display: grid;
  align-content: start;
  gap: 4px;
  padding: 9px;
  border: 1px solid rgba(212, 168, 67, 0.34);
  border-radius: 9px;
  color: var(--ca-text);
  background: rgba(212, 168, 67, 0.07);
  text-align: left;
  cursor: pointer;
}

.level-reward-grid button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.level-reward-grid b {
  color: var(--ca-text-bright);
  font-size: 12px;
}

.level-reward-grid small {
  color: var(--ca-gold-light);
  font-size: 9px;
}

.level-reward-grid span {
  color: var(--ca-muted);
  font-size: 10px;
  line-height: 1.45;
}

.level-reward-grid .skip {
  min-height: 40px;
  place-content: center;
  color: var(--ca-muted);
  text-align: center;
}

.avatar {
  grid-area: avatar;
  width: 58px;
  height: 58px;
  overflow: hidden;
  display: grid;
  place-items: center;
  border: 1px solid rgba(212, 168, 67, 0.5);
  border-radius: 13px;
  color: var(--ca-gold-light);
  background:
    radial-gradient(circle at 30% 20%, rgba(240, 214, 138, 0.25), transparent 36%),
    #292116;
  font: 700 28px/1 var(--ca-serif);
}

.identity {
  grid-area: identity;
}

.identity h1 {
  margin: 2px 0 7px;
  color: var(--ca-text-bright);
  font: 700 22px/1.1 var(--ca-serif);
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.badges span,
.ca-section-title small {
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.13);
  font: 700 10px/1 var(--ca-ui);
  letter-spacing: 0;
}

.badges .blue {
  color: #8dcaed;
  background: rgba(58, 139, 192, 0.14);
}

.badges .green {
  color: #8cd9ae;
  background: rgba(56, 169, 107, 0.14);
}

.gold {
  grid-area: gold;
  display: grid;
  align-content: center;
  text-align: center;
}

.gold strong {
  color: var(--ca-gold-light);
  font: 700 21px/1 var(--ca-serif);
}

.gold span {
  margin-top: 4px;
  color: var(--ca-muted);
  font-size: 9px;
}

.vitals {
  grid-area: vitals;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.companion-summary {
  display: grid;
  grid-template-columns: minmax(150px, 0.7fr) minmax(180px, 1.3fr) auto;
  align-items: center;
  gap: 18px;
  border-color: rgba(212, 168, 67, 0.28);
  background:
    radial-gradient(circle at 0 50%, rgba(212, 168, 67, 0.11), transparent 32%),
    var(--ca-surface);
}

.companion-kicker {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.18em;
}

.companion-copy h2 {
  margin: 4px 0 3px;
  color: var(--ca-text-bright);
  font: 700 20px/1 var(--ca-serif);
}

.companion-copy p {
  margin: 0;
  color: var(--ca-muted);
  font-size: 10px;
}

.companion-affinity > div {
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.companion-affinity span {
  color: var(--ca-muted);
  font-size: 10px;
}

.companion-affinity strong {
  color: var(--ca-gold-light);
  font: 700 22px/1 var(--ca-serif);
}

.companion-affinity small {
  color: #746d62;
  font-size: 9px;
}

.companion-affinity > i {
  height: 6px;
  display: block;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(212, 168, 67, 0.12);
}

.companion-affinity > i > b {
  height: 100%;
  display: block;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--ca-gold-dark), var(--ca-gold-light));
}

.profession-title {
  margin: 0 0 6px;
  color: var(--ca-text-bright);
  font-size: 14px;
}

.profession-copy {
  margin: 5px 0 0;
  color: var(--ca-muted);
  font-size: 12px;
  line-height: 1.55;
}

.profession-copy b {
  color: var(--ca-text);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.stats-grid article {
  min-width: 0;
  padding: 11px 5px;
  border: 1px solid rgba(255, 255, 255, 0.055);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  text-align: center;
}

.stats-grid span {
  display: block;
  overflow: hidden;
  color: var(--ca-muted);
  font-size: 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.stats-grid strong {
  display: block;
  margin-top: 5px;
  color: var(--ca-gold-light);
  font: 700 21px/1 var(--ca-serif);
}

.stats-grid small {
  display: block;
  margin-top: 4px;
  color: var(--ca-green);
  font-size: 8px;
}

.allocation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid rgba(212, 168, 67, 0.26);
  border-radius: 12px;
  background: rgba(212, 168, 67, 0.06);
}

.allocation-grid article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.17);
}

.allocation-grid article > div:first-child {
  display: grid;
  min-width: 0;
}

.allocation-grid strong {
  color: var(--ca-text-bright);
  font-size: 12px;
}

.allocation-grid span {
  margin-top: 3px;
  color: var(--ca-muted);
  font-size: 9px;
}

.allocation-grid article > div:last-child {
  display: flex;
  gap: 4px;
}

.equipment-list article,
.passive-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 0;
  border-bottom: 1px solid var(--ca-border);
}

.equipment-list article:last-child,
.passive-row:last-child {
  border-bottom: 0;
}

.equipment-list i,
.passive-row i {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--ca-gold);
  background: rgba(212, 168, 67, 0.1);
  font-style: normal;
}

.equipment-list article > div,
.passive-row > div {
  display: grid;
  gap: 3px;
}

.equipment-list span,
.passive-row span {
  color: var(--ca-muted);
  font-size: 10px;
}

.equipment-list strong,
.passive-row strong {
  color: var(--ca-text-bright);
  font-size: 13px;
}

.notice {
  margin: 12px 0 0;
  padding: 9px 12px;
  border: 1px solid rgba(56, 169, 107, 0.25);
  border-radius: 9px;
  color: #9bdfb9;
  background: rgba(56, 169, 107, 0.08);
  font-size: 12px;
}

.location {
  padding: 17px 8px 2px;
  color: var(--ca-muted);
  font-size: 11px;
  text-align: center;
}

@media (max-width: 840px) {
  .stats-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .companion-summary {
    grid-template-columns: 1fr auto;
    gap: 12px;
  }

  .companion-affinity {
    grid-column: 1 / 3;
    grid-row: 2;
  }

  .vitals {
    grid-template-columns: 1fr 1fr;
  }

  .vitals > :last-child {
    grid-column: 1 / 3;
  }

  .stats-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .allocation-grid {
    grid-template-columns: 1fr;
  }
}
</style>
