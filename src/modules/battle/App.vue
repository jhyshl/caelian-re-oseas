<script setup lang="ts">
/* global Document, HTMLElement, DOMRect, PointerEvent, setTimeout, requestAnimationFrame, cancelAnimationFrame */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  loadMonsterCatalog,
  type MonsterDefinition,
} from '@/content/catalogs/battle';
import { loadCardCatalog } from '@/content/catalogs/cards';
import type { CardDefinition } from '@/content/types';
import type {
  BattleAnimationEvent,
  BattleEnemyState,
  GameSnapshot,
  LocalBattleState,
} from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';
import MeterBar from '@/ui/adventurer/MeterBar.vue';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const monsters = ref<Record<string, MonsterDefinition>>({});
const cards = ref<Record<string, CardDefinition>>({});
const selectedTarget = ref(0);
const selectedHandIndex = ref<number | null>(null);
const showBattleInfo = ref(false);
const notice = ref('');
const busy = ref(false);
const animationPlaying = ref(false);
const activeActorKey = ref('');
const hitTargetKey = ref('');
const glowTargetKey = ref('');
const animationCaption = ref('');
const floatingEffects = ref<FloatingEffect[]>([]);
let disposeStateListener: (() => void) | undefined;
let dragSession: CardDragSession | null = null;
let suppressCardClick = false;
let floatingSequence = 0;

interface FloatingEffect {
  id: string;
  targetKey: string;
  kind: 'damage' | 'heal' | 'shield' | 'mp' | 'ap' | 'status' | 'draw';
  text: string;
}

interface CardDragSession {
  document: Document;
  source: HTMLElement;
  handIndex: number;
  cardId: string;
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  origin: DOMRect;
  clone: HTMLElement | null;
  dropTarget: HTMLElement | null;
  frame: number | null;
  moved: boolean;
}

const activeDeck = computed(() =>
  snapshot.value?.decks.find((deck) => deck.active),
);
const battle = computed(() => snapshot.value?.battle ?? null);
const state = computed<LocalBattleState | null>(
  () => battle.value?.state ?? null,
);
const aliveEnemies = computed(
  () => state.value?.enemies.filter((enemy) => enemy.hp > 0) ?? [],
);
const recentLog = computed(() =>
  [...(state.value?.log ?? [])].slice(-20).reverse(),
);
const regionalMonsterCount = computed(() => {
  const region = snapshot.value?.world.region;
  const regional = Object.values(monsters.value).filter((monster) =>
    monster.regions?.includes(region ?? ''),
  );
  return regional.length || Object.keys(monsters.value).length;
});
const difficultyLabel = computed(() => {
  const key = snapshot.value?.settings.battleDifficulty ?? 'normal';
  return (
    {
      easy: '简单 · ×0.8',
      normal: '普通 · ×1.0',
      hard: '困难 · ×1.5',
      hell: '地狱 · ×2.0',
    }[key] ?? key
  );
});
const selectedCard = computed(() => {
  if (selectedHandIndex.value === null) return null;
  return state.value?.player.hand[selectedHandIndex.value] ?? null;
});
const selectedCardDefinition = computed(() =>
  selectedCard.value ? cards.value[selectedCard.value.cardId] : undefined,
);
const resultTitle = computed(() => {
  if (state.value?.status === 'victory') return '战斗胜利';
  if (state.value?.status === 'defeat') return '战斗失败';
  if (state.value?.status === 'surrendered') return '已从战斗撤退';
  return '';
});

const statusNames: Record<string, string> = {
  strength: '力量',
  weak: '虚弱',
  vulnerable: '易伤',
  burn: '灼烧',
  poison: '中毒',
  freeze: '冻结',
  thorns: '荆棘',
  death_save: '不屈',
};
const typeNames: Record<string, string> = {
  attack: '攻击',
  defense: '防御',
  skill: '技能',
  spell: '法术',
  summon: '召唤',
  status: '状态',
};

function cardDefinition(cardId: string) {
  return cards.value[cardId];
}

function cardUnavailable(cardId: string) {
  const definition = cardDefinition(cardId);
  const player = state.value?.player;
  if (!definition || !player || state.value?.phase !== 'player') return true;
  return (
    player.ap < Math.max(0, Number(definition.cost) || 0) ||
    player.mp < Math.max(0, Number(definition.mpCost) || 0)
  );
}

function selectEnemy(index: number, enemy: BattleEnemyState) {
  if (busy.value || enemy.hp <= 0) return;
  selectedTarget.value = index;
}

function selectCard(index: number, cardId: string) {
  if (busy.value) return;
  if (cardUnavailable(cardId)) {
    const card = cardDefinition(cardId);
    notice.value =
      state.value?.phase !== 'player'
        ? '当前不是玩家行动阶段。'
        : (card?.mpCost ?? 0) > (state.value?.player.mp ?? 0)
          ? '魔力不足。'
          : '行动点不足。';
    return;
  }
  selectedHandIndex.value =
    selectedHandIndex.value === index ? null : index;
  notice.value = '';
}

function handleCardClick(index: number, cardId: string) {
  if (suppressCardClick) {
    suppressCardClick = false;
    return;
  }
  selectCard(index, cardId);
}

function cardStyle(index: number, total: number) {
  const offset = index - (total - 1) / 2;
  return {
    '--card-x': `${offset * 54}px`,
    '--card-x-mobile': `${offset * 35}px`,
    '--card-rot': `${offset * 1.8}deg`,
    '--card-rot-mobile': `${offset * 2.1}deg`,
    '--card-z': String(20 + index),
  };
}

function effectEntries(effects: LocalBattleState['player']['buffs']) {
  return Object.entries(effects);
}

function normalizeSelection() {
  selectedHandIndex.value = null;
  if (!state.value) return;
  selectedTarget.value =
    state.value.enemies[selectedTarget.value]?.hp &&
    state.value.enemies[selectedTarget.value]!.hp > 0
      ? selectedTarget.value
      : Math.max(
          0,
          state.value.enemies.findIndex((enemy) => enemy.hp > 0),
        );
}

async function refresh() {
  if (busy.value || animationPlaying.value) return;
  snapshot.value = await props.context.api.query('state');
  normalizeSelection();
}

async function execute(command: unknown, success = '') {
  if (busy.value) return false;
  busy.value = true;
  notice.value = '';
  try {
    const result = await props.context.api.execute(command);
    if (result.status === 'rejected') {
      notice.value = result.message ?? '操作没有成功';
      return false;
    }
    snapshot.value = await props.context.api.query('state');
    normalizeSelection();
    notice.value = success;
    return true;
  } finally {
    busy.value = false;
  }
}

function eventsAfter(
  finalState: LocalBattleState | null,
  previousEventId: string | undefined,
) {
  const events = finalState?.animations ?? [];
  if (!previousEventId) return events;
  const previousIndex = events.findIndex((event) => event.id === previousEventId);
  return previousIndex >= 0 ? events.slice(previousIndex + 1) : events;
}

function pause(milliseconds: number) {
  return new Promise<void>((resolve) => {
    const window = props.context.document.defaultView;
    if (window) window.setTimeout(resolve, milliseconds);
    else setTimeout(resolve, milliseconds);
  });
}

function targetKey(event: BattleAnimationEvent) {
  return event.targetSide === 'enemy' && event.targetId
    ? `enemy:${event.targetId}`
    : 'player';
}

function actorKey(event: BattleAnimationEvent) {
  return event.sourceSide === 'enemy' && event.sourceId
    ? `enemy:${event.sourceId}`
    : event.sourceSide === 'player'
      ? 'player'
      : '';
}

function visibleTarget(event: BattleAnimationEvent) {
  const current = state.value;
  if (!current) return null;
  if (event.targetSide === 'enemy') {
    return current.enemies.find((enemy) => enemy.id === event.targetId) ?? null;
  }
  return current.player;
}

function addFloat(
  event: BattleAnimationEvent,
  kind: FloatingEffect['kind'],
  text: string,
) {
  const effect: FloatingEffect = {
    id: `float:${Date.now()}:${floatingSequence++}`,
    targetKey: targetKey(event),
    kind,
    text,
  };
  floatingEffects.value.push(effect);
  return effect.id;
}

function removeFloat(id: string) {
  floatingEffects.value = floatingEffects.value.filter(
    (effect) => effect.id !== id,
  );
}

function floatsFor(key: string) {
  return floatingEffects.value.filter((effect) => effect.targetKey === key);
}

async function playAnimation(event: BattleAnimationEvent) {
  const current = state.value;
  if (!current) return;
  animationCaption.value = event.label;

  if (event.kind === 'card') {
    activeActorKey.value = 'player';
    if (event.apAfter !== undefined) current.player.ap = event.apAfter;
    if (event.mpAfter !== undefined) current.player.mp = event.mpAfter;
    const cardIndex = current.player.hand.findIndex(
      (card) => card.instanceId === event.cardInstanceId,
    );
    if (cardIndex >= 0) current.player.hand.splice(cardIndex, 1);
    selectedHandIndex.value = null;
    await pause(180);
    return;
  }

  if (event.kind === 'enemy-action') {
    activeActorKey.value = actorKey(event);
    await pause(210);
    return;
  }

  if (event.kind === 'turn') {
    if (event.phaseAfter) current.phase = event.phaseAfter;
    if (event.turnAfter !== undefined) current.turn = event.turnAfter;
    if (event.mpAfter !== undefined) current.player.mp = event.mpAfter;
    const floatId =
      event.targetSide === 'player' && event.mpAfter !== undefined
        ? addFloat(event, 'mp', 'MP 回复')
        : '';
    await pause(300);
    if (floatId) removeFloat(floatId);
    activeActorKey.value = '';
    return;
  }

  const target = visibleTarget(event);
  if (!target) {
    await pause(120);
    return;
  }
  if (event.kind === 'damage') {
    hitTargetKey.value = targetKey(event);
  } else {
    glowTargetKey.value = targetKey(event);
  }
  let floatId = '';
  if (event.kind === 'damage') {
    if (event.hpAfter !== undefined) target.hp = event.hpAfter;
    if (event.shieldAfter !== undefined) target.shield = event.shieldAfter;
    floatId = addFloat(event, 'damage', `−${event.amount ?? 0}`);
  } else if (event.kind === 'heal') {
    if (event.hpAfter !== undefined) target.hp = event.hpAfter;
    floatId = addFloat(event, 'heal', `+${event.amount ?? 0} HP`);
  } else if (event.kind === 'shield') {
    if (event.shieldAfter !== undefined) target.shield = event.shieldAfter;
    const amount = event.amount ?? 0;
    floatId = addFloat(
      event,
      'shield',
      `${amount >= 0 ? '+' : ''}${amount} 护盾`,
    );
  } else if (event.kind === 'mp') {
    if (event.mpAfter !== undefined && target === current.player) {
      current.player.mp = event.mpAfter;
    }
    floatId = addFloat(event, 'mp', `+${event.amount ?? 0} MP`);
  } else if (event.kind === 'ap') {
    if (event.apAfter !== undefined && target === current.player) {
      current.player.ap = event.apAfter;
    }
    floatId = addFloat(event, 'ap', `+${event.amount ?? 0} AP`);
  } else if (event.kind === 'status') {
    floatId = addFloat(
      event,
      'status',
      statusNames[event.label] ?? event.label,
    );
  } else if (event.kind === 'draw') {
    floatId = addFloat(event, 'draw', event.label);
  }
  await pause(event.kind === 'damage' ? 440 : 360);
  if (floatId) removeFloat(floatId);
  hitTargetKey.value = '';
  glowTargetKey.value = '';
  activeActorKey.value = '';
}

async function playAnimationQueue(events: BattleAnimationEvent[]) {
  for (const event of events) {
    await playAnimation(event);
  }
}

async function executeAnimated(command: unknown, success = '') {
  if (busy.value) return false;
  const previousEventId = state.value?.animations?.at(-1)?.id;
  busy.value = true;
  animationPlaying.value = true;
  notice.value = '';
  try {
    const result = await props.context.api.execute(command);
    if (result.status === 'rejected') {
      notice.value = result.message ?? '操作没有成功';
      return false;
    }
    const finalSnapshot = await props.context.api.query('state');
    const finalState = finalSnapshot.battle?.state ?? null;
    await playAnimationQueue(eventsAfter(finalState, previousEventId));
    snapshot.value = finalSnapshot;
    normalizeSelection();
    notice.value = success;
    return true;
  } finally {
    animationPlaying.value = false;
    busy.value = false;
    activeActorKey.value = '';
    hitTargetKey.value = '';
    glowTargetKey.value = '';
    animationCaption.value = '';
    floatingEffects.value = [];
  }
}

function setDropTarget(
  session: CardDragSession,
  target: HTMLElement | null,
) {
  if (session.dropTarget === target) return;
  session.dropTarget?.classList.remove('drag-over');
  session.dropTarget = target;
  session.dropTarget?.classList.add('drag-over');
}

function scheduleClonePosition(session: CardDragSession) {
  if (session.frame !== null) return;
  const window = session.document.defaultView;
  const update = () => {
    session.frame = null;
    if (!session.clone) return;
    const offsetX = session.currentX - session.startX;
    const offsetY = session.currentY - session.startY;
    session.clone.style.transform =
      `translate3d(${offsetX}px, ${offsetY}px, 0) scale(1.035) rotate(0deg)`;
  };
  session.frame = window
    ? window.requestAnimationFrame(update)
    : requestAnimationFrame(update);
}

function createDragClone(session: CardDragSession) {
  const clone = session.source.cloneNode(true) as HTMLElement;
  clone.classList.add('battle-drag-clone');
  clone.classList.remove('selected', 'unavailable');
  clone.removeAttribute('id');
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, {
    position: 'fixed',
    zIndex: '2147483647',
    left: `${session.origin.left}px`,
    top: `${session.origin.top}px`,
    right: 'auto',
    bottom: 'auto',
    width: `${session.origin.width}px`,
    height: `${session.origin.height}px`,
    margin: '0',
    opacity: '0.96',
    pointerEvents: 'none',
    transform: 'translate3d(0, 0, 0) scale(1.035) rotate(0deg)',
    transition: 'none',
  });
  session.document.body.append(clone);
  session.document.body.classList.add('caelian-card-dragging');
  session.source.style.opacity = '0.2';
  session.clone = clone;
}

function enemyDropTarget(
  document: Document,
  clientX: number,
  clientY: number,
) {
  const element = document.elementFromPoint(clientX, clientY);
  const target = element?.closest<HTMLElement>('[data-enemy-index]');
  if (!target || target.hasAttribute('disabled')) return null;
  const index = Number(target.dataset.enemyIndex);
  return state.value?.enemies[index]?.hp && state.value.enemies[index]!.hp > 0
    ? target
    : null;
}

function handleDragMove(event: PointerEvent) {
  const session = dragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  session.currentX = event.clientX;
  session.currentY = event.clientY;
  const distance = Math.hypot(
    event.clientX - session.startX,
    event.clientY - session.startY,
  );
  if (!session.moved && distance > 7) {
    session.moved = true;
    createDragClone(session);
  }
  if (!session.moved) return;
  event.preventDefault();
  scheduleClonePosition(session);
  setDropTarget(
    session,
    enemyDropTarget(session.document, event.clientX, event.clientY),
  );
}

function detachDragListeners(session: CardDragSession) {
  session.document.removeEventListener('pointermove', handleDragMove);
  session.document.removeEventListener('pointerup', handleDragEnd);
  session.document.removeEventListener('pointercancel', handleDragCancel);
}

function cleanupDrag(session: CardDragSession) {
  detachDragListeners(session);
  if (session.frame !== null) {
    const window = session.document.defaultView;
    if (window) window.cancelAnimationFrame(session.frame);
    else cancelAnimationFrame(session.frame);
  }
  session.dropTarget?.classList.remove('drag-over');
  session.source.style.opacity = '';
  session.clone?.remove();
  session.document.body.classList.remove('caelian-card-dragging');
  if (dragSession === session) dragSession = null;
}

async function settleDragClone(
  session: CardDragSession,
  target: HTMLElement | null,
) {
  if (!session.clone) return;
  const clone = session.clone;
  clone.style.transition =
    'transform 180ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease';
  if (target) {
    const targetRect = target.getBoundingClientRect();
    const offsetX =
      targetRect.left +
      targetRect.width / 2 -
      (session.origin.left + session.origin.width / 2);
    const offsetY =
      targetRect.top +
      targetRect.height / 2 -
      (session.origin.top + session.origin.height / 2);
    clone.style.transform =
      `translate3d(${offsetX}px, ${offsetY}px, 0) scale(.28) rotate(0deg)`;
    clone.style.opacity = '0';
  } else {
    clone.style.transform = 'translate3d(0, 0, 0) scale(1) rotate(0deg)';
    clone.style.opacity = '0.72';
  }
  await pause(190);
}

function suppressGeneratedClick(document: Document) {
  suppressCardClick = true;
  document.defaultView?.setTimeout(() => {
    suppressCardClick = false;
  }, 0);
}

async function handleDragEnd(event: PointerEvent) {
  const session = dragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  suppressGeneratedClick(session.document);
  if (!session.moved) {
    cleanupDrag(session);
    selectCard(session.handIndex, session.cardId);
    return;
  }
  event.preventDefault();
  const target =
    enemyDropTarget(session.document, event.clientX, event.clientY) ??
    session.dropTarget;
  const targetIndex = target ? Number(target.dataset.enemyIndex) : -1;
  await settleDragClone(session, target);
  cleanupDrag(session);
  if (targetIndex >= 0) {
    selectedTarget.value = targetIndex;
    await playCardAt(session.handIndex, targetIndex);
  } else {
    notice.value = '把卡牌拖到仍存活的怪物身上即可打出。';
  }
}

function handleDragCancel(event: PointerEvent) {
  const session = dragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  suppressGeneratedClick(session.document);
  void settleDragClone(session, null).finally(() => cleanupDrag(session));
}

function beginCardPointer(
  event: PointerEvent,
  handIndex: number,
  cardId: string,
) {
  if (
    event.button !== 0 ||
    busy.value ||
    animationPlaying.value ||
    cardUnavailable(cardId)
  ) {
    return;
  }
  if (dragSession) cleanupDrag(dragSession);
  const source = event.currentTarget as HTMLElement;
  const document = source.ownerDocument;
  dragSession = {
    document,
    source,
    handIndex,
    cardId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    origin: source.getBoundingClientRect(),
    clone: null,
    dropTarget: null,
    frame: null,
    moved: false,
  };
  source.setPointerCapture?.(event.pointerId);
  document.addEventListener('pointermove', handleDragMove, { passive: false });
  document.addEventListener('pointerup', handleDragEnd);
  document.addEventListener('pointercancel', handleDragCancel);
}

async function exploreBattle() {
  await execute(
    {
      id: commandId('battle.explore'),
      type: 'battle.explore',
      payload: {},
    },
    '已经从当前地区生成本地遭遇。',
  );
}

async function playSelectedCard() {
  if (!battle.value || selectedHandIndex.value === null) return;
  await playCardAt(selectedHandIndex.value, selectedTarget.value);
}

async function playCardAt(handIndex: number, targetIndex: number) {
  if (!battle.value) return;
  await executeAnimated({
    id: commandId('battle.play-card'),
    type: 'battle.play-card',
    payload: {
      battleId: battle.value.id,
      handIndex,
      targetIndex,
    },
  });
}

async function endTurn() {
  if (!battle.value) return;
  await executeAnimated({
    id: commandId('battle.end-turn'),
    type: 'battle.end-turn',
    payload: { battleId: battle.value.id },
  });
}

async function discardHand() {
  if (!battle.value) return;
  await execute({
    id: commandId('battle.discard-hand'),
    type: 'battle.discard-hand',
    payload: { battleId: battle.value.id },
  });
}

async function surrender() {
  if (!battle.value) return;
  const confirmed = await props.context.api.confirm({
    title: '确认从战斗中撤退？',
    description: '撤退会损失当前生命与一部分金币，本轮战斗也会立即结束。',
    confirmText: '确认撤退',
    cancelText: '继续战斗',
    tone: 'danger',
  });
  if (!confirmed) return;
  await execute({
    id: commandId('battle.surrender'),
    type: 'battle.surrender',
    payload: { battleId: battle.value.id },
  });
}

async function closeResult() {
  if (!battle.value) return;
  await execute({
    id: commandId('battle.finish'),
    type: 'battle.finish',
    payload: { battleId: battle.value.id },
  });
}

onMounted(async () => {
  [snapshot.value, monsters.value, cards.value] = await Promise.all([
    props.context.api.query('state'),
    loadMonsterCatalog(),
    loadCardCatalog(),
  ]);
  selectedTarget.value = state.value?.selectedTarget ?? 0;
  disposeStateListener = props.context.api.on('state.changed', refresh);
});

onUnmounted(() => {
  disposeStateListener?.();
  if (dragSession) cleanupDrag(dragSession);
});
</script>

<template>
  <AdventurerFrame
    :context="context"
    active="battle"
    :date="snapshot?.world.location"
    page-mode="battle"
  >
    <div v-if="!snapshot" class="ca-empty">正在装载本地战斗引擎……</div>

    <template v-else-if="state && battle">
      <section v-if="state.status !== 'ongoing'" class="battle-result">
        <span>LOCAL BATTLE RESULT</span>
        <h1>{{ resultTitle }}</h1>
        <p>本次战斗已经在浏览器本地完成结算。</p>
        <div v-if="state.rewards" class="reward-grid">
          <article>
            <small>经验</small>
            <strong>+{{ state.rewards.experience }}</strong>
          </article>
          <article>
            <small>金币</small>
            <strong>+{{ state.rewards.gold }}</strong>
          </article>
          <article>
            <small>协会经验</small>
            <strong>+{{ state.rewards.guildExperience }}</strong>
          </article>
          <article>
            <small>战利品</small>
            <strong>{{ state.rewards.items.length }}</strong>
          </article>
        </div>
        <ul v-if="state.rewards?.items.length" class="reward-items">
          <li v-for="item in state.rewards.items" :key="item.id">
            {{ item.name }} ×{{ item.quantity }}
          </li>
        </ul>
        <button
          type="button"
          class="battle-main-button"
          :disabled="busy"
          @click="closeResult"
        >
          返回探索
        </button>
      </section>

      <div v-else class="legacy-battle-shell">
        <header class="battle-topbar">
          <div>
            <strong>
              第 {{ state.turn }} 回合 ·
              {{ state.phase === 'player' ? '玩家行动' : '敌方行动' }}
              <em v-if="animationPlaying"> · 动画结算中</em>
            </strong>
            <span>{{ battle.source }}</span>
          </div>
          <div>
            <button type="button" @click="showBattleInfo = !showBattleInfo">
              战况
            </button>
            <button type="button" class="escape" :disabled="busy" @click="surrender">
              逃跑
            </button>
          </div>
        </header>

        <section
          class="enemy-zone"
          :data-count="Math.min(state.enemies.length, 6)"
        >
          <div class="enemy-layout">
            <button
              v-for="(enemy, index) in state.enemies"
              :key="enemy.id"
              type="button"
              class="enemy-card"
              :class="{
                selected: index === selectedTarget,
                defeated: enemy.hp <= 0,
                acting: activeActorKey === `enemy:${enemy.id}`,
                hit: hitTargetKey === `enemy:${enemy.id}`,
                glow: glowTargetKey === `enemy:${enemy.id}`,
              }"
              :data-enemy-index="index"
              :disabled="enemy.hp <= 0"
              @click="selectEnemy(index, enemy)"
            >
              <div class="enemy-card-title">
                <strong>{{ enemy.name }}</strong>
                <span v-if="index === selectedTarget">锁定</span>
              </div>
              <small>
                攻 {{ enemy.attack }} · 防 {{ enemy.defense }} · 盾 {{ enemy.shield }}
              </small>
              <MeterBar
                label="怪物生命"
                :value="enemy.hp"
                :max="enemy.hpMax"
                color="var(--ca-red)"
              />
              <div v-if="enemy.intent" class="intent">
                <b>{{ enemy.intent.kind }} · {{ enemy.intent.name }}</b>
                <span v-if="enemy.intent.amount">
                  预计 {{ enemy.intent.amount
                  }}{{ enemy.intent.hits > 1 ? ` × ${enemy.intent.hits}` : '' }}
                </span>
              </div>
              <div class="status-row">
                <span v-if="enemy.shield">护盾 {{ enemy.shield }}</span>
                <span
                  v-for="[name, effect] in effectEntries(enemy.buffs)"
                  :key="`eb:${name}`"
                >
                  {{ statusNames[name] ?? name }} {{ effect.value }}·{{ effect.turns }}
                </span>
                <span
                  v-for="[name, effect] in effectEntries(enemy.debuffs)"
                  :key="`ed:${name}`"
                  class="negative"
                >
                  {{ statusNames[name] ?? name }} {{ effect.value }}·{{ effect.turns }}
                </span>
              </div>
              <div class="battle-float-layer" aria-hidden="true">
                <span
                  v-for="effect in floatsFor(`enemy:${enemy.id}`)"
                  :key="effect.id"
                  :data-kind="effect.kind"
                >
                  {{ effect.text }}
                </span>
              </div>
            </button>
          </div>
        </section>

        <section
          class="battle-mid"
          :class="{
            acting: activeActorKey === 'player',
            hit: hitTargetKey === 'player',
            glow: glowTargetKey === 'player',
          }"
        >
          <div class="summon-strip">
            <template v-if="state.player.summons.length">
              <article
                v-for="summon in state.player.summons"
                :key="summon.id"
              >
                <strong>{{ summon.name }}</strong>
                <span>{{ summon.duration }} 回合</span>
              </article>
            </template>
            <span v-else>暂无召唤物</span>
          </div>

          <div class="battle-field-row">
            <b>场上状态</b>
            <div class="status-row">
              <span
                v-for="[name, effect] in effectEntries(state.player.buffs)"
                :key="`pb:${name}`"
              >
                {{ statusNames[name] ?? name }} {{ effect.value }}·{{ effect.turns }}
              </span>
              <span
                v-for="[name, effect] in effectEntries(state.player.debuffs)"
                :key="`pd:${name}`"
                class="negative"
              >
                {{ statusNames[name] ?? name }} {{ effect.value }}·{{ effect.turns }}
              </span>
              <span v-if="!Object.keys(state.player.buffs).length && !Object.keys(state.player.debuffs).length">
                暂无状态
              </span>
            </div>
            <small>
              攻 {{ state.player.attack }} · 防 {{ state.player.defense }} · 速 {{ state.player.speed }}
            </small>
          </div>

          <div class="player-bars">
            <MeterBar
              label="玩家生命"
              :value="state.player.hp"
              :max="state.player.hpMax"
              color="var(--ca-red)"
            />
            <MeterBar
              label="玩家魔力"
              :value="state.player.mp"
              :max="state.player.mpMax"
              color="var(--ca-blue)"
            />
          </div>
          <div class="battle-float-layer player-floats" aria-hidden="true">
            <span
              v-for="effect in floatsFor('player')"
              :key="effect.id"
              :data-kind="effect.kind"
            >
              {{ effect.text }}
            </span>
          </div>
        </section>

        <section
          class="hand-zone"
          :class="{ 'card-raised': selectedHandIndex !== null }"
        >
          <div class="ap-orb">
            <strong>{{ state.player.ap }}</strong>
            <span>/{{ state.player.apMax }} AP</span>
          </div>

          <div class="hand-actions">
            <button
              type="button"
              class="discard"
              :disabled="busy || state.player.ap < 1 || state.player.hand.length === 0"
              @click="discardHand"
            >
              弃牌 1AP
            </button>
            <button
              type="button"
              class="end-turn"
              :disabled="busy || aliveEnemies.length === 0"
              @click="endTurn"
            >
              结束回合
            </button>
          </div>

          <button
            type="button"
            class="pile-button"
            @click="showBattleInfo = !showBattleInfo"
          >
            手牌 {{ state.player.hand.length }}/{{ state.player.handLimit }}<br>
            牌堆 {{ state.player.drawPile.length }} · 弃牌 {{ state.player.discardPile.length }}
          </button>

          <div class="fan-hand">
            <button
              v-for="(card, index) in state.player.hand"
              :key="card.instanceId"
              type="button"
              class="fan-card"
              :class="{
                selected: selectedHandIndex === index,
                unavailable: cardUnavailable(card.cardId),
              }"
              :data-rarity="cardDefinition(card.cardId)?.rarity"
              :style="cardStyle(index, state.player.hand.length)"
              @pointerdown="beginCardPointer($event, index, card.cardId)"
              @click="handleCardClick(index, card.cardId)"
            >
              <div class="fan-cost">
                <span>AP <b>{{ cardDefinition(card.cardId)?.cost ?? 0 }}</b></span>
                <span>MP <b>{{ cardDefinition(card.cardId)?.mpCost ?? 0 }}</b></span>
              </div>
              <strong>{{ cardDefinition(card.cardId)?.name ?? card.cardId }}</strong>
              <small>
                {{ typeNames[cardDefinition(card.cardId)?.type ?? ''] ?? '卡牌' }}
                · {{ cardDefinition(card.cardId)?.rarity ?? 'common' }}
              </small>
              <p>{{ cardDefinition(card.cardId)?.description ?? '卡牌数据缺失' }}</p>
            </button>
          </div>
        </section>

        <button
          type="button"
          class="play-selected-floating"
          :disabled="busy || !selectedCard"
          @click="playSelectedCard"
        >
          <span>打出</span>
          <strong>
            {{ selectedCardDefinition?.name ?? '选择手牌' }}
          </strong>
        </button>

        <aside v-if="showBattleInfo" class="battle-info">
          <header>
            <div>
              <strong>战斗记录</strong>
              <span>
                抽牌 {{ state.player.drawPile.length }} · 弃牌 {{ state.player.discardPile.length }}
                · 吟诵 {{ state.player.chants.length }}
              </span>
            </div>
            <button type="button" @click="showBattleInfo = false">×</button>
          </header>
          <ol>
            <li
              v-for="entry in recentLog"
              :key="entry.id"
              :data-kind="entry.kind"
            >
              <span>T{{ entry.turn }}</span>{{ entry.text }}
            </li>
          </ol>
        </aside>

        <div v-if="animationPlaying && animationCaption" class="animation-caption">
          {{ animationCaption }}
        </div>
      </div>
    </template>

    <section v-else class="exploration-ready">
      <div class="exploration-copy">
        <span>AUTOMATIC LOCAL ENCOUNTER</span>
        <h1>{{ snapshot.world.region }} · 探索战斗</h1>
        <p>
          点击后脚本会从当前地区自动抽取一个或一组怪物。怪物会按玩家等级、当前装备战力、地区系数和冒险难度实时缩放。
        </p>
      </div>

      <div class="exploration-stats">
        <article>
          <small>玩家等级</small>
          <strong>Lv.{{ snapshot.player.level }}</strong>
        </article>
        <article>
          <small>冒险难度</small>
          <strong>{{ difficultyLabel }}</strong>
        </article>
        <article>
          <small>地区怪物池</small>
          <strong>{{ regionalMonsterCount }} 种</strong>
        </article>
        <article>
          <small>出战牌组</small>
          <strong>{{ activeDeck?.cardIds.length ?? 0 }} 张</strong>
        </article>
      </div>

      <div class="encounter-rule">
        <strong>本次遭遇由脚本自动决定</strong>
        <p>
          低等级怪物权重更高，但不会硬性排除高等级怪物；困难与地狱难度更容易出现群体战。群怪会应用旧版的数量补正，避免简单叠加成数值墙。
        </p>
      </div>

      <button
        type="button"
        class="explore-button"
        :disabled="busy || !activeDeck?.cardIds.length"
        @click="exploreBattle"
      >
        <span>⚔</span>
        <strong>{{ busy ? '正在生成遭遇……' : '探索战斗' }}</strong>
        <small>从 {{ snapshot.world.region }} 自动抽取敌人</small>
      </button>
    </section>

    <p v-if="notice" class="battle-notice">{{ notice }}</p>
  </AdventurerFrame>
</template>

<style scoped>
.legacy-battle-shell {
  --battle-line: rgba(217, 180, 98, 0.38);
  position: relative;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(100px, 0.88fr) minmax(104px, 0.72fr) minmax(215px, 1.18fr);
  gap: 6px;
  overflow: hidden;
  padding: 7px;
  border: 1px solid rgba(217, 180, 98, 0.3);
  border-radius: 15px;
  color: #f7ead0;
  background:
    radial-gradient(circle at 50% -10%, rgba(217, 180, 98, 0.2), transparent 35%),
    linear-gradient(180deg, #2c2119, #111a28 38%, #080d15);
  box-shadow: inset 0 1px rgba(255, 241, 182, 0.12);
}

.battle-topbar {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 9px;
  border: 1px solid rgba(217, 180, 98, 0.44);
  border-radius: 13px;
  background: linear-gradient(180deg, rgba(55, 40, 27, 0.96), rgba(26, 22, 20, 0.94));
}

.battle-topbar > div:first-child {
  display: grid;
  min-width: 0;
}

.battle-topbar strong {
  color: #fff2bf;
  font-size: 13px;
}

.battle-topbar strong em {
  color: #ffd868;
  font-size: 9px;
  font-style: normal;
}

.battle-topbar span {
  overflow: hidden;
  color: rgba(245, 231, 199, 0.65);
  font-size: 9px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.battle-topbar > div:last-child {
  display: flex;
  gap: 6px;
}

.battle-topbar button {
  min-height: 31px;
  padding: 6px 10px;
  border: 1px solid var(--battle-line);
  border-radius: 11px;
  color: #f7ead0;
  background: rgba(255, 255, 255, 0.06);
  font: 800 10px var(--ca-ui);
  cursor: pointer;
}

.battle-topbar button.escape {
  border-color: rgba(255, 209, 150, 0.32);
  color: #fff3d2;
  background: linear-gradient(180deg, #ff3b34, #c71414);
}

.enemy-zone,
.summon-strip,
.battle-field-row,
.hand-zone {
  border: 1px solid var(--battle-line);
  background:
    linear-gradient(180deg, rgba(255, 244, 212, 0.1), rgba(255, 244, 212, 0.03)),
    linear-gradient(180deg, rgba(27, 38, 54, 0.96), rgba(18, 25, 36, 0.98));
  box-shadow: inset 0 1px rgba(255, 241, 182, 0.1);
}

.enemy-zone {
  min-height: 0;
  overflow: hidden;
  padding: 7px;
  border-radius: 17px;
}

.enemy-layout {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  place-content: stretch center;
}

.enemy-zone[data-count="1"] .enemy-card {
  grid-column: 2;
}

.enemy-card {
  position: relative;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
  border: 2px solid rgba(255, 241, 182, 0.55);
  border-radius: 14px;
  color: #2a1a0d;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.34), transparent 28%),
    radial-gradient(circle at 50% 18%, #fff4b6, #f5cf70 52%, #d69b35);
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow: inset 0 2px rgba(255, 255, 255, 0.34), 0 9px 18px rgba(0, 0, 0, 0.22);
}

.enemy-card:hover,
.enemy-card.selected {
  border-color: #fff4ad;
  box-shadow:
    inset 0 2px rgba(255, 255, 255, 0.4),
    0 0 0 3px rgba(255, 230, 128, 0.2),
    0 12px 25px rgba(0, 0, 0, 0.26);
  transform: translateY(-1px);
}

.enemy-card.drag-over {
  border-color: #92ff9e;
  box-shadow:
    inset 0 0 24px rgba(115, 255, 135, 0.34),
    0 0 0 4px rgba(115, 255, 135, 0.24),
    0 0 32px rgba(115, 255, 135, 0.42);
  transform: translateY(-3px) scale(1.025);
}

.enemy-card.acting {
  animation: enemy-attack 0.5s cubic-bezier(.2, .75, .24, 1);
}

.enemy-card.hit {
  animation: battle-hit 0.42s ease;
}

.enemy-card.glow {
  animation: battle-glow 0.48s ease;
}

.enemy-card.defeated {
  filter: grayscale(1) brightness(0.72);
  opacity: 0.46;
}

.enemy-card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.enemy-card-title strong {
  overflow: hidden;
  font: 900 clamp(11px, 1.6vw, 16px) var(--ca-serif);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.enemy-card-title span {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 999px;
  color: #fff8df;
  background: #c80f0f;
  font-size: 8px;
}

.enemy-card > small {
  display: block;
  margin: 3px 0;
  color: rgba(45, 28, 12, 0.67);
  font-size: 8px;
  font-weight: 800;
}

.intent {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  margin-top: 4px;
  color: #7d170e;
  font-size: 8px;
}

.intent b,
.intent span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.battle-mid {
  position: relative;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(38px, 0.7fr) auto minmax(34px, auto);
  gap: 3px;
}

.battle-mid.acting {
  animation: player-action 0.46s cubic-bezier(.2, .75, .24, 1);
}

.battle-mid.hit {
  animation: battle-hit 0.42s ease;
}

.battle-mid.glow {
  animation: battle-glow 0.48s ease;
}

.summon-strip {
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  padding: 5px;
  border-radius: 12px;
}

.summon-strip > span {
  width: 100%;
  color: rgba(245, 231, 199, 0.55);
  font-size: 9px;
  text-align: center;
}

.summon-strip article {
  min-width: 102px;
  display: grid;
  padding: 5px 7px;
  border: 1px solid rgba(125, 238, 158, 0.34);
  border-radius: 9px;
  background: rgba(73, 230, 109, 0.08);
}

.summon-strip strong {
  color: #eaffdf;
  font-size: 9px;
}

.summon-strip article span {
  color: rgba(224, 255, 225, 0.7);
  font-size: 8px;
}

.battle-field-row {
  min-height: 27px;
  display: flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  padding: 4px 7px;
  border-radius: 10px;
}

.battle-field-row > b {
  flex: 0 0 auto;
  color: #e1c073;
  font-size: 9px;
}

.battle-field-row > .status-row {
  flex: 1;
  min-width: 0;
}

.battle-field-row > small {
  flex: 0 0 auto;
  color: rgba(245, 231, 199, 0.62);
  font-size: 8px;
}

.player-bars {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  min-height: 0;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 15px;
  overflow: hidden;
}

.status-row span {
  flex: 0 0 auto;
  padding: 2px 5px;
  border: 1px solid rgba(73, 230, 109, 0.3);
  border-radius: 999px;
  color: #225e30;
  background: rgba(73, 230, 109, 0.13);
  font-size: 7px;
  font-weight: 800;
}

.battle-field-row .status-row span {
  color: #bce9c7;
}

.status-row span.negative {
  border-color: rgba(201, 20, 20, 0.34);
  color: #a31212;
  background: rgba(255, 55, 48, 0.12);
}

.battle-field-row .status-row span.negative {
  color: #ffaaa5;
}

.hand-zone {
  position: relative;
  z-index: 40;
  min-height: 0;
  overflow: hidden;
  border-radius: 17px;
}

.hand-zone.card-raised {
  z-index: 600;
  overflow: visible;
}

.ap-orb {
  position: absolute;
  z-index: 80;
  left: 8px;
  top: 8px;
  width: 58px;
  height: 58px;
  display: grid;
  place-content: center;
  border: 1px solid rgba(255, 246, 185, 0.68);
  border-radius: 50%;
  color: #211405;
  background: radial-gradient(circle at 35% 24%, #fff7a4, #f2cf4e 68%, #c58e23);
  box-shadow: inset 0 2px rgba(255, 255, 255, 0.45), 0 8px 18px rgba(0, 0, 0, 0.26);
  text-align: center;
}

.ap-orb strong {
  font: 900 19px/1 var(--ca-serif);
}

.ap-orb span {
  font-size: 7px;
  font-weight: 900;
}

.hand-actions {
  position: absolute;
  z-index: 80;
  top: 9px;
  left: 50%;
  display: flex;
  gap: 5px;
  max-width: calc(100% - 142px);
  transform: translateX(-50%);
}

.hand-actions button {
  min-height: 31px;
  padding: 7px 9px;
  border: 1px solid rgba(255, 241, 182, 0.28);
  border-radius: 11px;
  color: #211405;
  font: 900 9px var(--ca-ui);
  white-space: nowrap;
  cursor: pointer;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.22), 0 6px 13px rgba(0, 0, 0, 0.23);
}

.hand-actions .discard {
  color: #fff7d7;
  background: linear-gradient(180deg, #ff3b34, #cf1212);
}

.hand-actions .end-turn {
  background: linear-gradient(180deg, #fff58a, #e4bf38);
}

.hand-actions button:disabled {
  cursor: not-allowed;
  filter: grayscale(0.5);
  opacity: 0.44;
}

.pile-button {
  position: absolute;
  z-index: 80;
  left: 7px;
  bottom: 8px;
  padding: 5px 6px;
  border: 1px solid rgba(217, 180, 98, 0.28);
  border-radius: 8px;
  color: #f1ddb0;
  background: rgba(255, 241, 182, 0.07);
  font: 800 8px/1.35 var(--ca-ui);
  text-align: left;
  cursor: pointer;
}

.fan-hand {
  position: absolute;
  inset: 38px 0 0;
  min-height: 0;
}

.fan-card {
  position: absolute;
  z-index: var(--card-z);
  left: 50%;
  bottom: 5px;
  width: clamp(102px, 15.5vw, 142px);
  aspect-ratio: 0.66;
  display: flex;
  flex-direction: column;
  padding: 10px 9px 8px;
  overflow: hidden;
  border: 3px solid #a08d72;
  border-radius: 12px;
  color: #2b2118;
  background:
    radial-gradient(circle at 50% 0, rgba(255, 255, 255, 0.55), transparent 24%),
    linear-gradient(160deg, #f5e7c8, #d6bc8c);
  font: inherit;
  text-align: center;
  touch-action: none;
  user-select: none;
  cursor: pointer;
  box-shadow: 0 13px 22px rgba(0, 0, 0, 0.3);
  transform:
    translateX(calc(-50% + var(--card-x)))
    rotate(var(--card-rot));
  transform-origin: 50% 100%;
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.fan-card[data-rarity="uncommon"] { border-color: #4fa36d; }
.fan-card[data-rarity="rare"] { border-color: #4f91c5; }
.fan-card[data-rarity="epic"] { border-color: #a35bb9; }
.fan-card[data-rarity="legendary"] { border-color: #d4a843; }

.fan-card:hover {
  z-index: 420;
  box-shadow: 0 19px 34px rgba(0, 0, 0, 0.4), 0 0 0 4px rgba(255, 232, 122, 0.25);
  transform:
    translateX(calc(-50% + var(--card-x)))
    translateY(-12%)
    scale(1.07)
    rotate(0);
}

.fan-card.selected {
  z-index: 700;
  box-shadow:
    0 25px 44px rgba(0, 0, 0, 0.5),
    0 0 0 4px rgba(255, 232, 122, 0.3);
  transform:
    translateX(-50%)
    translateY(-55%)
    scale(1.2)
    rotate(0);
}

.fan-card.unavailable {
  filter: saturate(0.55) brightness(0.78);
}

.battle-drag-clone {
  contain: layout paint style;
  will-change: transform, opacity;
  cursor: grabbing;
  box-shadow:
    0 24px 50px rgba(0, 0, 0, 0.55),
    0 0 0 4px rgba(255, 236, 151, 0.32);
}

.play-selected-floating {
  position: absolute;
  z-index: 1000;
  right: 9px;
  bottom: 9px;
  width: min(170px, 30%);
  min-height: 42px;
  display: grid;
  gap: 1px;
  padding: 7px 12px;
  overflow: hidden;
  border: 1px solid rgba(210, 239, 255, 0.65);
  border-radius: 13px;
  color: #e8f7ff;
  background: linear-gradient(180deg, #42a9dc, #155b8d);
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow:
    inset 0 1px rgba(255, 255, 255, 0.3),
    0 10px 22px rgba(0, 0, 0, 0.42),
    0 0 0 3px rgba(66, 169, 220, 0.13);
}

.play-selected-floating span {
  font-size: 7px;
  font-weight: 900;
  letter-spacing: 0.14em;
}

.play-selected-floating strong {
  overflow: hidden;
  font-size: 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.play-selected-floating:disabled {
  cursor: not-allowed;
  filter: grayscale(0.55);
  opacity: 0.48;
}

.battle-float-layer {
  position: absolute;
  z-index: 900;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

.battle-float-layer span {
  position: absolute;
  left: 50%;
  top: 45%;
  min-width: max-content;
  color: #ff3b34;
  font: 900 clamp(14px, 2.4vw, 24px)/1 var(--ca-serif);
  text-shadow:
    0 2px 0 rgba(255, 255, 255, 0.8),
    0 4px 12px rgba(0, 0, 0, 0.5);
  transform: translate(-50%, -50%);
  animation: battle-float 0.78s cubic-bezier(.16, .78, .25, 1) forwards;
}

.battle-float-layer span[data-kind="heal"] {
  color: #29cf64;
}

.battle-float-layer span[data-kind="shield"] {
  color: #d7efff;
}

.battle-float-layer span[data-kind="mp"] {
  color: #55bfff;
}

.battle-float-layer span[data-kind="ap"],
.battle-float-layer span[data-kind="draw"] {
  color: #ffe36e;
}

.battle-float-layer span[data-kind="status"] {
  color: #f2c872;
  font-size: clamp(11px, 1.8vw, 18px);
}

.player-floats {
  z-index: 160;
}

.animation-caption {
  position: absolute;
  z-index: 560;
  left: 50%;
  top: 48%;
  max-width: 78%;
  padding: 5px 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 232, 137, 0.32);
  border-radius: 999px;
  color: #fff0b0;
  background: rgba(13, 17, 24, 0.82);
  font: 900 9px var(--ca-ui);
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

@keyframes enemy-attack {
  0% { transform: translateY(0) scale(1); }
  38% { transform: translateY(11px) scale(1.045); filter: brightness(1.14); }
  62% { transform: translateY(7px) scale(1.03); }
  100% { transform: translateY(0) scale(1); }
}

@keyframes player-action {
  0% { transform: translateY(0) scale(1); filter: brightness(1); }
  42% { transform: translateY(-7px) scale(1.018); filter: brightness(1.18); }
  100% { transform: translateY(0) scale(1); filter: brightness(1); }
}

@keyframes battle-hit {
  0%, 100% { transform: translate(0, 0); filter: brightness(1); }
  18% { transform: translate(-5px, 1px); filter: brightness(1.45) saturate(1.45); }
  38% { transform: translate(5px, -1px); }
  58% { transform: translate(-3px, 0); }
  78% { transform: translate(2px, 0); }
}

@keyframes battle-glow {
  0%, 100% { filter: brightness(1); }
  45% {
    filter: brightness(1.3) saturate(1.2);
    box-shadow: 0 0 24px rgba(112, 235, 161, 0.38);
  }
}

@keyframes battle-float {
  0% { opacity: 0; transform: translate(-50%, -20%) scale(.72); }
  20% { opacity: 1; transform: translate(-50%, -60%) scale(1.14); }
  72% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -150%) scale(.96); }
}

.fan-cost {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  margin-bottom: 9px;
}

.fan-cost span {
  padding: 3px 5px;
  border: 1px solid rgba(55, 42, 28, 0.46);
  border-radius: 999px;
  background: rgba(246, 237, 206, 0.9);
  font-size: 7px;
  font-weight: 900;
}

.fan-cost b {
  font-size: 10px;
}

.fan-card > strong {
  font: 900 12px/1.1 var(--ca-serif);
}

.fan-card > small {
  margin-top: 4px;
  color: #6f5a43;
  font-size: 7px;
  font-weight: 800;
}

.fan-card > p {
  flex: 1;
  margin: 10px 0 0;
  overflow: hidden;
  font-size: 8px;
  font-weight: 700;
  line-height: 1.35;
}

.battle-info {
  position: absolute;
  z-index: 180;
  inset: 52px 9px 9px auto;
  width: min(360px, calc(100% - 18px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(217, 180, 98, 0.52);
  border-radius: 14px;
  background: rgba(10, 15, 24, 0.96);
  box-shadow: 0 16px 38px rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(12px);
}

.battle-info header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid rgba(217, 180, 98, 0.25);
}

.battle-info header > div {
  display: grid;
}

.battle-info header strong {
  color: #fff2bf;
  font-size: 12px;
}

.battle-info header span {
  color: rgba(245, 231, 199, 0.6);
  font-size: 8px;
}

.battle-info header button {
  border: 0;
  color: #f7ead0;
  background: transparent;
  font-size: 22px;
  cursor: pointer;
}

.battle-info ol {
  margin: 0;
  padding: 9px 12px;
  overflow: auto;
  list-style: none;
}

.battle-info li {
  padding: 4px 0;
  color: rgba(245, 231, 199, 0.65);
  font-size: 9px;
  line-height: 1.35;
}

.battle-info li span {
  margin-right: 5px;
  color: #d9b462;
  font-weight: 900;
}

.battle-info li[data-kind="player"],
.battle-info li[data-kind="reward"] { color: #b8d9c3; }
.battle-info li[data-kind="enemy"] { color: #e5a09b; }

.exploration-ready,
.battle-result {
  width: min(720px, 100%);
  margin: max(12px, 4vh) auto;
  padding: clamp(18px, 4vw, 32px);
  border: 1px solid rgba(212, 168, 67, 0.38);
  border-radius: 18px;
  background:
    radial-gradient(circle at 0 0, rgba(212, 168, 67, 0.14), transparent 38%),
    var(--ca-surface);
}

.exploration-copy > span,
.battle-result > span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.16em;
}

.exploration-copy h1,
.battle-result h1 {
  margin: 6px 0;
  color: var(--ca-text-bright);
  font: 700 clamp(23px, 4vw, 34px) var(--ca-serif);
}

.exploration-copy p,
.encounter-rule p,
.battle-result p {
  margin: 0;
  color: var(--ca-muted);
  font-size: 11px;
  line-height: 1.6;
}

.exploration-stats,
.reward-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 20px 0;
}

.exploration-stats article,
.reward-grid article {
  display: grid;
  gap: 4px;
  padding: 11px 8px;
  border: 1px solid var(--ca-border);
  border-radius: 10px;
  background: var(--ca-surface-soft);
  text-align: center;
}

.exploration-stats small,
.reward-grid small {
  color: var(--ca-muted);
  font-size: 8px;
}

.exploration-stats strong,
.reward-grid strong {
  overflow: hidden;
  color: var(--ca-gold-light);
  font: 700 14px var(--ca-serif);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.encounter-rule {
  padding: 12px;
  border: 1px dashed rgba(212, 168, 67, 0.3);
  border-radius: 11px;
  background: rgba(212, 168, 67, 0.05);
}

.encounter-rule strong {
  color: var(--ca-text-bright);
  font-size: 11px;
}

.encounter-rule p {
  margin-top: 5px;
  font-size: 9px;
}

.explore-button {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  gap: 1px 10px;
  align-items: center;
  margin-top: 18px;
  padding: 13px 17px;
  border: 1px solid var(--ca-gold-dark);
  border-radius: 13px;
  color: #241a0b;
  background: linear-gradient(135deg, #f0d68a, #d4a843);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.explore-button > span {
  grid-row: 1 / 3;
  font-size: 28px;
}

.explore-button strong {
  font-size: 14px;
}

.explore-button small {
  font-size: 9px;
  opacity: 0.72;
}

.explore-button:disabled {
  cursor: not-allowed;
  filter: grayscale(0.6);
  opacity: 0.5;
}

.battle-result {
  text-align: center;
}

.reward-items {
  margin: 0 0 15px;
  padding: 0;
  color: var(--ca-text);
  font-size: 10px;
  list-style: none;
}

.battle-main-button {
  min-height: 38px;
  padding: 9px 18px;
  border: 1px solid var(--ca-gold-dark);
  border-radius: 10px;
  color: #211405;
  background: linear-gradient(180deg, #fff58a, #d4a843);
  font: 900 11px var(--ca-ui);
  cursor: pointer;
}

.battle-notice {
  position: absolute;
  z-index: 220;
  left: 50%;
  bottom: 10px;
  max-width: 90%;
  margin: 0;
  padding: 7px 11px;
  border: 1px solid rgba(217, 180, 98, 0.42);
  border-radius: 999px;
  color: #fff2bf;
  background: rgba(24, 22, 18, 0.94);
  font-size: 9px;
  text-align: center;
  transform: translateX(-50%);
}

@media (max-width: 980px) {
  .legacy-battle-shell {
    grid-template-rows: auto minmax(100px, 0.9fr) minmax(100px, 0.75fr) minmax(205px, 1.15fr);
  }

  .fan-card {
    width: clamp(96px, 17vw, 128px);
  }
}

@media (max-width: 759px) {
  .legacy-battle-shell {
    grid-template-rows: auto minmax(98px, 0.86fr) minmax(105px, 0.82fr) minmax(190px, 1.05fr);
    gap: 4px;
    padding: 4px;
    border-radius: 0;
  }

  .battle-topbar {
    min-height: 38px;
    padding: 4px 6px;
    border-radius: 10px;
  }

  .battle-topbar strong {
    font-size: 11px;
  }

  .enemy-zone {
    padding: 4px;
    border-radius: 12px;
  }

  .enemy-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
  }

  .enemy-zone[data-count="1"] .enemy-card {
    grid-column: 1 / 3;
    width: min(270px, 78%);
    justify-self: center;
  }

  .enemy-card {
    padding: 6px;
    border-radius: 10px;
  }

  .enemy-card-title strong {
    font-size: 11px;
  }

  .enemy-card > small,
  .intent {
    font-size: 7px;
  }

  .player-bars {
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .battle-field-row > small {
    display: none;
  }

  .ap-orb {
    width: 48px;
    height: 48px;
    left: 5px;
    top: 5px;
  }

  .ap-orb strong {
    font-size: 16px;
  }

  .hand-actions {
    top: 6px;
    gap: 3px;
    max-width: calc(100% - 108px);
  }

  .hand-actions button {
    min-height: 28px;
    padding: 6px;
    border-radius: 9px;
    font-size: 8px;
  }

  .pile-button {
    left: 4px;
    bottom: 5px;
    padding: 4px;
    font-size: 7px;
  }

  .fan-hand {
    inset: 33px 0 0;
  }

  .fan-card {
    width: clamp(84px, 25vw, 110px);
    padding: 7px 6px;
    border-width: 2px;
    transform:
      translateX(calc(-50% + var(--card-x-mobile)))
      rotate(var(--card-rot-mobile));
  }

  .fan-card:hover {
    transform:
      translateX(calc(-50% + var(--card-x-mobile)))
      translateY(-12%)
      scale(1.06)
      rotate(0);
  }

  .fan-card.selected {
    transform:
      translateX(-50%)
      translateY(-56%)
      scale(1.16)
      rotate(0);
  }

  .play-selected-floating {
    right: 5px;
    bottom: 5px;
    width: min(126px, 36%);
    min-height: 38px;
    padding: 6px 9px;
    border-radius: 11px;
  }

  .fan-card > strong {
    font-size: 10px;
  }

  .fan-card > p {
    margin-top: 7px;
    font-size: 7px;
  }

  .fan-cost {
    margin-bottom: 5px;
  }

  .fan-cost span {
    padding: 2px 3px;
    font-size: 6px;
  }

  .battle-info {
    inset: 45px 5px 5px auto;
  }

  .exploration-ready,
  .battle-result {
    margin: 5px auto;
    padding: 16px;
    border-radius: 13px;
  }

  .exploration-stats,
  .reward-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 14px 0;
  }
}

@media (max-width: 390px) {
  .legacy-battle-shell {
    grid-template-rows: auto minmax(94px, 0.85fr) minmax(100px, 0.8fr) minmax(178px, 1fr);
  }

  .hand-actions .discard {
    display: none;
  }

  .hand-actions {
    max-width: calc(100% - 98px);
  }

  .enemy-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .status-row {
    max-height: 16px;
  }
}
</style>
