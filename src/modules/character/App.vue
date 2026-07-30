<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getProfessionTalent, subclassNames } from '@/content/catalogs/professions';
import type { GameSnapshot } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import ProfessionDialog from '@/modules/character/ProfessionDialog.vue';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';
import AdjustableAvatar from '@/ui/AdjustableAvatar.vue';
import MeterBar from '@/ui/adventurer/MeterBar.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const playerAvatarUrl = ref('');
const busyStat = ref('');
const statEditMode = ref(false);
const professionDialog = ref<'create' | 'reclass'>();
const notice = ref('');
const disposers: Array<() => void> = [];

const player = computed(() => snapshot.value?.player);
const profession = computed(() =>
  player.value ? getProfessionTalent(player.value.subclass) : undefined,
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
    id: 'actionPointsPerTurn',
    icon: '◎',
    label: 'AP',
    note: '≤10消耗2点，之后消耗3点',
  },
] as const;

async function refreshState() {
  snapshot.value = await props.context.api.query('state');
  if (!snapshot.value.player.created) professionDialog.value = 'create';
}

async function refreshAvatar() {
  playerAvatarUrl.value = (
    await props.context.api.getAvatarUrls()
  ).user;
}

async function refresh() {
  await Promise.all([refreshState(), refreshAvatar()]);
}

function handlePlayerAvatarError() {
  playerAvatarUrl.value = '';
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

function statValue(id: (typeof statRows)[number]['id']): number {
  return snapshot.value?.player[id] ?? 0;
}

function invested(id: (typeof statRows)[number]['id']): number {
  return snapshot.value?.statAllocations[id] ?? 0;
}

function equipped(slot: 'weaponId' | 'armorId' | 'accessoryId') {
  const id = snapshot.value?.loadout[slot];
  return snapshot.value?.equipment.find((item) => item.id === id);
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
          :alt="`${snapshot.player.name || '玩家'}的头像`"
          :fallback="snapshot.player.name.trim().slice(0, 1) || '冒'"
          preference-id="player"
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
            :value="snapshot.player.hp"
            :max="snapshot.player.hpMax"
            color="var(--ca-green)"
          />
          <MeterBar
            label="MP"
            :value="snapshot.player.mp"
            :max="snapshot.player.mpMax"
            color="var(--ca-blue)"
          />
          <MeterBar
            :label="`EXP (${experiencePercent}%)`"
            :value="snapshot.player.experience"
            :max="snapshot.player.experienceToNext"
          />
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
            <strong>{{ statValue(row.id) }}</strong>
          </article>
          <article>
            <span>▱ 补抽</span>
            <strong>{{ snapshot.player.drawPerTurn }}</strong>
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
                  snapshot.player.statPoints <= 0 ||
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
              <small>{{ equipped('weaponId')?.description ?? '' }}</small>
            </div>
          </article>
          <article>
            <i>◈</i>
            <div>
              <span>防具</span>
              <strong>{{ equipped('armorId')?.name ?? '空' }}</strong>
              <small>{{ equipped('armorId')?.description ?? '' }}</small>
            </div>
          </article>
          <article>
            <i>◉</i>
            <div>
              <span>饰品</span>
              <strong>{{ equipped('accessoryId')?.name ?? '空' }}</strong>
              <small>{{ equipped('accessoryId')?.description ?? '' }}</small>
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
