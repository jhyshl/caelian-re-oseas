<script setup lang="ts">
/* global Event, HTMLElement, MouseEvent, Node, PointerEvent, TouchEvent, Window, window */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { PanelContext, PanelName } from '@/kernel/public-api';
import {
  clampLauncherPosition,
  launcherSizeForViewport,
  resolveLauncherDrop,
  retractLauncherPosition,
  type DockSide,
  type LauncherPlacement,
  type LauncherPosition,
  type ViewportRect,
} from '@/modules/shell/floating-position';
import {
  horizontalSwipeDirection,
  launcherPageDirection,
  paginateLauncherItems,
} from '@/modules/shell/launcher-pagination';
import LauncherOrderDialog from '@/modules/shell/LauncherOrderDialog.vue';
import {
  LAUNCHER_ORDER_STORAGE_KEY,
  normalizeLauncherOrder,
  prioritizeLauncherPanels,
} from '@/modules/shell/launcher-order';

const props = defineProps<{ context: PanelContext }>();

const STORAGE_KEY = 'caelian_floating_wheel_position_v2';
const IDLE_DELAY = 3000;
const DRAG_THRESHOLD = 5;
const DOUBLE_ACTIVATION_DELAY = 280;

const viewport = ref(readViewport());
const launcherSize = ref(launcherSizeForViewport(viewport.value.width));
const initialPlacement = readStoredPlacement() ?? defaultPlacement();
const position = ref(initialPlacement.position);
const dockSide = ref<DockSide>(initialPlacement.dockSide);
const expanded = ref(false);
const dragging = ref(false);
const idle = ref(false);
const retracted = ref(initialPlacement.dockSide !== null);
const shellElement = ref<HTMLElement | null>(null);
const info = computed(() => props.context.api.getRuntimeInfo());
const pageIndex = ref(0);
const pageDirection = ref<-1 | 1>(1);
const ordering = ref(false);

let idleTimer: number | undefined;
let activationTimer: number | undefined;
let swipeStart:
  | {
      x: number;
      y: number;
    }
  | undefined;
let dragSession:
  | {
      pointerId: number;
      startX: number;
      startY: number;
      origin: LauncherPosition;
      startPosition: LauncherPosition;
      startDockSide: DockSide;
      moved: boolean;
      wasExpanded: boolean;
    }
  | undefined;

const primary: Array<{ panel: PanelName; icon: string; label: string }> = [
  { panel: 'character', icon: '♙', label: '角色' },
  { panel: 'affinity', icon: '♡', label: '凯利安' },
  { panel: 'deck', icon: '▱', label: '牌组' },
  { panel: 'card-square', icon: '▦', label: '卡牌广场' },
  { panel: 'inventory', icon: '◇', label: '背包' },
  { panel: 'crafting', icon: '⚗', label: '合成' },
  { panel: 'guild', icon: '⚔', label: '协会' },
  { panel: 'mailbox', icon: '✉', label: '邮箱' },
  { panel: 'market', icon: '¤', label: '集市' },
  { panel: 'map', icon: '⌖', label: '地图' },
  { panel: 'worldbook', icon: '▤', label: '世界书' },
  { panel: 'battle', icon: '✹', label: '战斗' },
  { panel: 'achievements', icon: '♛', label: '成就' },
  { panel: 'settings', icon: '⚙', label: '设置' },
  { panel: 'feedback', icon: '✎', label: '反馈' },
  { panel: 'surveys', icon: '◫', label: '问卷' },
  { panel: 'release-notes', icon: '◉', label: '公告' },
];
const defaultLauncherOrder = primary.map((item) => item.panel);
const launcherOrder = ref(readStoredLauncherOrder());
const orderDraft = ref<PanelName[]>([]);
const primaryByPanel = new Map(primary.map((item) => [item.panel, item]));

const launcherItems = computed(() => {
  const ordered = launcherOrder.value.flatMap((panel) => {
    const item = primaryByPanel.get(panel);
    return item ? [item] : [];
  });
  if (info.value.status === 'ready') return ordered;
  return ordered.map((item) =>
    item.panel === 'feedback'
      ? { panel: 'diagnostics' as const, icon: '◈', label: '诊断' }
      : item,
  );
});
const orderingItems = computed(() =>
  launcherOrder.value.flatMap((panel) => {
    const item = primaryByPanel.get(panel);
    return item ? [item] : [];
  }),
);
const launcherPages = computed(() =>
  paginateLauncherItems(launcherItems.value),
);
const currentPage = computed(
  () => launcherPages.value[pageIndex.value] ?? launcherPages.value[0]!,
);
const pageTransitionName = computed(() =>
  pageDirection.value > 0 ? 'launcher-next' : 'launcher-previous',
);

const renderedPosition = computed(() => {
  if (dockSide.value && retracted.value) {
    return retractLauncherPosition(
      position.value,
      viewport.value,
      launcherSize.value,
      dockSide.value,
    );
  }
  return position.value;
});

const shellStyle = computed<Record<string, string>>(() => ({
  '--launcher-size': `${launcherSize.value}px`,
  left: `${Math.round(renderedPosition.value.x)}px`,
  top: `${Math.round(renderedPosition.value.y)}px`,
}));

const wheelClasses = computed(() => {
  const centerX = position.value.x + launcherSize.value / 2;
  const centerY = position.value.y + launcherSize.value / 2;
  const viewportCenterX =
    viewport.value.offsetLeft + viewport.value.width / 2;
  const viewportCenterY =
    viewport.value.offsetTop + viewport.value.height / 2;

  return {
    'opens-right': centerX < viewportCenterX,
    'opens-left': centerX >= viewportCenterX,
    'opens-down': centerY < viewportCenterY,
    'opens-up': centerY >= viewportCenterY,
  };
});

const launcherLabel = computed(() => {
  if (dragging.value) return '正在移动 Re∞：欧西亚斯悬浮入口';
  if (dockSide.value) {
    return expanded.value
      ? '关闭 Re∞：欧西亚斯冒险者面板'
      : '展开侧边栏中的 Re∞：欧西亚斯悬浮入口';
  }
  return expanded.value
    ? '关闭 Re∞：欧西亚斯冒险者面板'
    : '打开或拖动 Re∞：欧西亚斯悬浮入口；双击查看凯利安状态';
});

function hostWindow(): Window {
  return props.context.document.defaultView ?? window;
}

function readStoredLauncherOrder(): PanelName[] {
  try {
    const raw = hostWindow().localStorage.getItem(LAUNCHER_ORDER_STORAGE_KEY);
    return normalizeLauncherOrder(
      raw ? JSON.parse(raw) : undefined,
      defaultLauncherOrder,
    );
  } catch {
    return [...defaultLauncherOrder];
  }
}

function persistLauncherOrder(): void {
  try {
    hostWindow().localStorage.setItem(
      LAUNCHER_ORDER_STORAGE_KEY,
      JSON.stringify(launcherOrder.value),
    );
  } catch {
    // Local storage may be unavailable in privacy-restricted webviews.
  }
}

function readViewport(): ViewportRect {
  const win = hostWindow();
  const visualViewport = win.visualViewport;
  const documentElement = props.context.document.documentElement;
  return {
    width: Math.max(
      320,
      Math.floor(
        visualViewport?.width || win.innerWidth || documentElement.clientWidth || 360,
      ),
    ),
    height: Math.max(
      320,
      Math.floor(
        visualViewport?.height ||
          win.innerHeight ||
          documentElement.clientHeight ||
          640,
      ),
    ),
    offsetLeft: Math.floor(visualViewport?.offsetLeft || 0),
    offsetTop: Math.floor(visualViewport?.offsetTop || 0),
  };
}

function defaultPlacement(): LauncherPlacement {
  const size = launcherSize.value;
  return {
    position: clampLauncherPosition(
      {
        x: viewport.value.offsetLeft + viewport.value.width - size - 22,
        y: viewport.value.offsetTop + viewport.value.height - size - 126,
      },
      viewport.value,
      size,
    ),
    dockSide: null,
  };
}

function readStoredPlacement(): LauncherPlacement | null {
  try {
    const raw = hostWindow().localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      x?: unknown;
      y?: unknown;
      dockSide?: unknown;
    };
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const storedDockSide: DockSide =
      parsed.dockSide === 'left' || parsed.dockSide === 'right'
        ? parsed.dockSide
        : null;
    const restored = clampLauncherPosition(
      { x, y },
      viewport.value,
      launcherSize.value,
    );
    if (storedDockSide) {
      const snapped = resolveLauncherDrop(
        {
          x:
            storedDockSide === 'left'
              ? viewport.value.offsetLeft
              : viewport.value.offsetLeft + viewport.value.width,
          y: restored.y,
        },
        viewport.value,
        launcherSize.value,
      );
      return { position: snapped.position, dockSide: storedDockSide };
    }
    return { position: restored, dockSide: null };
  } catch {
    return null;
  }
}

function persistPlacement(): void {
  try {
    hostWindow().localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        x: Math.round(position.value.x),
        y: Math.round(position.value.y),
        dockSide: dockSide.value,
      }),
    );
  } catch {
    // Local storage may be unavailable in privacy-restricted webviews.
  }
}

function clearIdleTimer(): void {
  if (idleTimer === undefined) return;
  hostWindow().clearTimeout(idleTimer);
  idleTimer = undefined;
}

function clearActivationTimer(): void {
  if (activationTimer === undefined) return;
  hostWindow().clearTimeout(activationTimer);
  activationTimer = undefined;
}

function wake(): void {
  clearIdleTimer();
  idle.value = false;
  retracted.value = false;
}

function scheduleIdle(): void {
  clearIdleTimer();
  if (expanded.value || dragging.value) return;
  idleTimer = hostWindow().setTimeout(() => {
    idleTimer = undefined;
    if (expanded.value || dragging.value) return;
    idle.value = true;
    retracted.value = dockSide.value !== null;
  }, IDLE_DELAY);
}

function recordActivity(): void {
  if (dragging.value) return;
  wake();
  if (!expanded.value) scheduleIdle();
}

function openWheel(): void {
  wake();
  if (pageIndex.value >= launcherPages.value.length) pageIndex.value = 0;
  expanded.value = true;
}

function closeWheel(): void {
  ordering.value = false;
  orderDraft.value = [];
  expanded.value = false;
  scheduleIdle();
}

function toggleWheel(): void {
  if (expanded.value) closeWheel();
  else openWheel();
}

function activateLauncher(wasExpanded: boolean): void {
  if (activationTimer !== undefined) {
    clearActivationTimer();
    open('affinity');
    return;
  }

  activationTimer = hostWindow().setTimeout(() => {
    activationTimer = undefined;
    if (wasExpanded) closeWheel();
    else openWheel();
  }, DOUBLE_ACTIVATION_DELAY);
}

function open(panel: PanelName): void {
  if (info.value.status !== 'ready' && panel !== 'diagnostics') return;
  void props.context.api.navigatePanel(panel).catch((error) => {
    props.context.api.notify({
      kind: 'error',
      title: '页面打开失败',
      description:
        error instanceof Error
          ? `${error.message}。请再试一次。`
          : '页面挂载失败，请再试一次。',
      duration: 6_000,
    });
  });
  closeWheel();
}

function beginOrdering(): void {
  orderDraft.value = [];
  ordering.value = true;
  recordActivity();
}

function cancelOrdering(): void {
  orderDraft.value = [];
  ordering.value = false;
  recordActivity();
}

function saveOrdering(): void {
  launcherOrder.value = prioritizeLauncherPanels(
    launcherOrder.value,
    orderDraft.value,
  );
  orderDraft.value = [];
  persistLauncherOrder();
  ordering.value = false;
  pageIndex.value = 0;
  recordActivity();
}

function resetOrdering(): void {
  orderDraft.value = [...defaultLauncherOrder];
  recordActivity();
}

function toggleOrder(panel: PanelName): void {
  const index = orderDraft.value.indexOf(panel);
  orderDraft.value =
    index >= 0
      ? orderDraft.value.filter((candidate) => candidate !== panel)
      : [...orderDraft.value, panel];
  recordActivity();
}

function clearOrdering(): void {
  orderDraft.value = [];
  recordActivity();
}

function changePage(direction: -1 | 1): void {
  const count = launcherPages.value.length;
  if (count <= 1) return;
  pageDirection.value = direction;
  pageIndex.value = (pageIndex.value + direction + count) % count;
  recordActivity();
}

function goToPage(target: number): void {
  const count = launcherPages.value.length;
  if (target < 0 || target >= count || target === pageIndex.value) return;
  pageDirection.value = launcherPageDirection(
    pageIndex.value,
    target,
    count,
  );
  pageIndex.value = target;
  recordActivity();
}

function handleWheelTouchStart(event: TouchEvent): void {
  if (ordering.value) return;
  const touch = event.changedTouches.item(0);
  if (!touch) return;
  swipeStart = { x: touch.clientX, y: touch.clientY };
  recordActivity();
}

function handleWheelTouchEnd(event: TouchEvent): void {
  if (ordering.value) return;
  const start = swipeStart;
  swipeStart = undefined;
  const touch = event.changedTouches.item(0);
  if (!start || !touch) return;
  const direction = horizontalSwipeDirection(
    touch.clientX - start.x,
    touch.clientY - start.y,
  );
  if (direction) changePage(direction);
}

function handlePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  wake();
  dragging.value = true;
  dragSession = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    origin: { ...position.value },
    startPosition: { ...position.value },
    startDockSide: dockSide.value,
    moved: false,
    wasExpanded: expanded.value,
  };
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is not exposed by some embedded mobile webviews.
  }
  event.preventDefault();
  event.stopPropagation();
}

function handlePointerMove(event: PointerEvent): void {
  const session = dragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  const deltaX = event.clientX - session.startX;
  const deltaY = event.clientY - session.startY;
  if (Math.abs(deltaX) + Math.abs(deltaY) > DRAG_THRESHOLD) {
    session.moved = true;
  }
  if (session.moved) {
    clearActivationTimer();
    expanded.value = false;
    dockSide.value = null;
    retracted.value = false;
    position.value = clampLauncherPosition(
      {
        x: session.origin.x + deltaX,
        y: session.origin.y + deltaY,
      },
      viewport.value,
      launcherSize.value,
    );
  }
  event.preventDefault();
  event.stopPropagation();
}

function handlePointerUp(event: PointerEvent): void {
  const session = dragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  dragging.value = false;
  dragSession = undefined;
  try {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  } catch {
    // Pointer capture is optional in embedded webviews.
  }

  if (session.moved) {
    const settled = resolveLauncherDrop(
      position.value,
      viewport.value,
      launcherSize.value,
    );
    position.value = settled.position;
    dockSide.value = settled.dockSide;
    retracted.value = settled.dockSide !== null;
    expanded.value = false;
    persistPlacement();
    scheduleIdle();
  } else {
    activateLauncher(session.wasExpanded);
  }
  event.preventDefault();
  event.stopPropagation();
}

function handlePointerCancel(event: PointerEvent): void {
  const session = dragSession;
  if (!session || event.pointerId !== session.pointerId) return;
  position.value = session.startPosition;
  dockSide.value = session.startDockSide;
  retracted.value = session.startDockSide !== null;
  dragging.value = false;
  dragSession = undefined;
  clearActivationTimer();
  scheduleIdle();
}

function handleClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (event.detail === 0) {
    clearActivationTimer();
    toggleWheel();
  }
}

function handleOutsidePointerDown(event: Event): void {
  if (ordering.value) return;
  const target = event.target;
  if (
    expanded.value &&
    target instanceof Node &&
    !shellElement.value?.contains(target)
  ) {
    closeWheel();
  }
}

function handleResize(): void {
  viewport.value = readViewport();
  launcherSize.value = launcherSizeForViewport(viewport.value.width);
  const clamped = clampLauncherPosition(
    position.value,
    viewport.value,
    launcherSize.value,
  );
  if (dockSide.value) {
    position.value = resolveLauncherDrop(
      {
        x:
          dockSide.value === 'left'
            ? viewport.value.offsetLeft
            : viewport.value.offsetLeft + viewport.value.width,
        y: clamped.y,
      },
      viewport.value,
      launcherSize.value,
    ).position;
  } else {
    position.value = clamped;
  }
  persistPlacement();
}

onMounted(() => {
  const win = hostWindow();
  props.context.document.addEventListener(
    'pointerdown',
    handleOutsidePointerDown,
    { passive: true },
  );
  win.addEventListener('resize', handleResize);
  win.visualViewport?.addEventListener('resize', handleResize);
  win.visualViewport?.addEventListener('scroll', handleResize);
  scheduleIdle();
});

onUnmounted(() => {
  const win = hostWindow();
  clearIdleTimer();
  clearActivationTimer();
  props.context.document.removeEventListener(
    'pointerdown',
    handleOutsidePointerDown,
  );
  win.removeEventListener('resize', handleResize);
  win.visualViewport?.removeEventListener('resize', handleResize);
  win.visualViewport?.removeEventListener('scroll', handleResize);
});
</script>

<template>
  <div
    ref="shellElement"
    class="shell"
    :class="{
      expanded,
      dragging,
      idle,
      retracted,
      'docked-left': dockSide === 'left',
      'docked-right': dockSide === 'right',
    }"
    :style="shellStyle"
    @pointerenter="recordActivity"
    @pointermove="recordActivity"
    @pointerleave="scheduleIdle"
    @focusin="recordActivity"
  >
    <div
      v-if="expanded"
      class="wheel"
      :class="wheelClasses"
      role="menu"
      @touchstart.passive="handleWheelTouchStart"
      @touchend.passive="handleWheelTouchEnd"
    >
      <header class="wheel-header">
        <div>
          <span>RE∞ OSEAS</span>
          <small>{{ info.version }} · {{ info.channel }}</small>
        </div>
        <button
          type="button"
          class="order-trigger"
          aria-label="自定义入口顺序"
          title="自定义入口顺序"
          @click.stop="beginOrdering"
        >
          ☷
          <em>排序</em>
        </button>
      </header>
      <p v-if="info.status !== 'ready'" class="warning">
        {{ info.lastError || `内核状态：${info.status}` }}
      </p>
      <div class="wheel-page-viewport">
        <Transition :name="pageTransitionName" mode="out-in">
          <div :key="pageIndex" class="wheel-grid">
            <button
              v-for="item in currentPage"
              :key="item.panel"
              type="button"
              role="menuitem"
              :disabled="
                info.status !== 'ready' && item.panel !== 'diagnostics'
              "
              @click="open(item.panel)"
            >
              <b>{{ item.icon }}</b>
              <span>{{ item.label }}</span>
            </button>
          </div>
        </Transition>
      </div>
      <footer class="page-controls">
        <button
          type="button"
          aria-label="上一页"
          @click="changePage(-1)"
        >
          ‹
        </button>
        <div aria-label="悬浮窗页码">
          <button
            v-for="(_, index) in launcherPages"
            :key="index"
            type="button"
            :class="{ active: pageIndex === index }"
            :aria-label="`第 ${index + 1} 页`"
            @click="goToPage(index)"
          ></button>
        </div>
        <button
          type="button"
          aria-label="下一页"
          @click="changePage(1)"
        >
          ›
        </button>
      </footer>
    </div>
    <button
      type="button"
      class="orb"
      :aria-expanded="expanded"
      :aria-label="launcherLabel"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerCancel"
      @click="handleClick"
    >
      <span>∞</span>
      <i :class="{ ready: info.status === 'ready' }"></i>
    </button>
  </div>

  <LauncherOrderDialog
    v-if="ordering"
    :items="orderingItems"
    :selected="orderDraft"
    :teleport-target="context.document.body"
    @toggle="toggleOrder"
    @clear="clearOrdering"
    @reset="resetOrdering"
    @cancel="cancelOrdering"
    @save="saveOrdering"
  />
</template>

<style scoped>
.shell {
  --launcher-size: 58px;
  position: fixed;
  z-index: 2147483646;
  width: var(--launcher-size);
  height: var(--launcher-size);
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
  transition:
    left 0.28s cubic-bezier(0.2, 0.9, 0.2, 1),
    top 0.28s cubic-bezier(0.2, 0.9, 0.2, 1);
  will-change: left, top;
}

.shell.dragging {
  transition: none;
}

.orb {
  position: relative;
  width: var(--launcher-size);
  height: var(--launcher-size);
  padding: 0;
  border: 1px solid rgba(212, 168, 67, 0.75);
  border-radius: 50%;
  appearance: none;
  color: #f4d988;
  background:
    radial-gradient(circle at 32% 24%, rgba(255, 241, 183, 0.55), transparent 8%),
    radial-gradient(circle at center, #58411f, #19140d 68%);
  box-shadow:
    0 14px 34px rgba(3, 3, 4, 0.58),
    inset 0 0 0 4px rgba(212, 168, 67, 0.07);
  cursor: grab;
  opacity: 1;
  transform: scale(1);
  transition:
    border-radius 0.28s ease,
    box-shadow 0.18s ease,
    filter 0.18s ease,
    opacity 0.35s ease,
    transform 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}

.orb:hover,
.orb:focus-visible {
  outline: none;
  border-color: rgba(244, 217, 136, 0.95);
  filter: brightness(1.07);
}

.shell.idle:not(.expanded):not(.dragging) .orb {
  opacity: 0.46;
  filter: saturate(0.85) brightness(0.98);
  box-shadow:
    0 6px 18px rgba(0, 0, 0, 0.2),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.shell.dragging .orb {
  cursor: grabbing;
  opacity: 1;
  filter: brightness(1.08);
  transform: scale(1.05);
}

.shell.expanded .orb {
  opacity: 1;
  transform: scale(1.04);
  box-shadow:
    0 14px 34px rgba(0, 0, 0, 0.4),
    0 0 0 6px rgba(212, 168, 67, 0.1);
}

.shell.retracted.docked-left .orb {
  border-radius: 0 50% 50% 0;
}

.shell.retracted.docked-right .orb {
  border-radius: 50% 0 0 50%;
}

.orb span {
  font: 700 31px/1 Georgia, serif;
}

.orb i {
  position: absolute;
  right: 2px;
  bottom: 5px;
  width: 10px;
  height: 10px;
  border: 2px solid #17130d;
  border-radius: 50%;
  background: #e8a347;
}

.orb i.ready {
  background: #67d49a;
}

.wheel {
  position: absolute;
  width: min(288px, calc(100vw - 24px));
  max-height: calc(100vh - 84px);
  overflow-y: auto;
  padding: 13px;
  border: 1px solid rgba(212, 168, 67, 0.42);
  border-radius: 17px;
  color: #e8e0d4;
  background:
    radial-gradient(circle at 0 0, rgba(212, 168, 67, 0.12), transparent 35%),
    rgba(13, 15, 20, 0.97);
  box-shadow: 0 18px 55px rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(14px);
  touch-action: auto;
  animation: wheel-in 0.18s ease-out;
}

.wheel.opens-left {
  right: 0;
}

.wheel.opens-right {
  left: 0;
}

.wheel.opens-up {
  bottom: calc(var(--launcher-size) + 12px);
}

.wheel.opens-down {
  top: calc(var(--launcher-size) + 12px);
}

.wheel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 5px 12px;
}

.wheel-header > div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.wheel-header span {
  color: #d4a843;
  font: 700 14px Georgia, serif;
  letter-spacing: 0.12em;
}

.wheel-header small {
  color: #837d72;
  font-size: 9px;
}

.order-trigger {
  min-width: 50px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 7px;
  border: 1px solid rgba(212, 168, 67, 0.28);
  border-radius: 8px;
  color: #b7ad9c;
  background: rgba(212, 168, 67, 0.05);
  font: 700 15px/1 inherit;
  cursor: pointer;
}

.order-trigger:hover,
.order-trigger:focus-visible {
  outline: none;
  border-color: rgba(212, 168, 67, 0.62);
  color: #f0d68a;
}

.order-trigger em {
  font: normal 9px/1 inherit;
}

.wheel-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.wheel-page-viewport {
  min-height: 124px;
  overflow: hidden;
}

.launcher-next-enter-active,
.launcher-next-leave-active,
.launcher-previous-enter-active,
.launcher-previous-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.2s cubic-bezier(0.22, 0.8, 0.3, 1);
}

.launcher-next-enter-from,
.launcher-previous-leave-to {
  opacity: 0;
  transform: translateX(34px);
}

.launcher-next-leave-to,
.launcher-previous-enter-from {
  opacity: 0;
  transform: translateX(-34px);
}

.wheel-grid button {
  min-height: 59px;
  display: grid;
  place-items: center;
  gap: 1px;
  padding: 7px 3px;
  border: 1px solid #292d37;
  border-radius: 10px;
  color: #aaa397;
  background: rgba(255, 255, 255, 0.025);
  font: inherit;
  cursor: pointer;
}

.wheel-grid button:hover:not(:disabled) {
  border-color: rgba(212, 168, 67, 0.55);
  color: #f0d68a;
  background: rgba(212, 168, 67, 0.08);
}

.wheel-grid button b {
  font-size: 19px;
  font-weight: 400;
}

.wheel-grid button span {
  font-size: 9px;
}

.wheel-grid button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.page-controls {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 34px;
  align-items: center;
  gap: 6px;
  margin-top: 9px;
}

.page-controls > button {
  height: 30px;
  padding: 0;
  border: 1px solid #292d37;
  border-radius: 9px;
  color: #938d82;
  background: transparent;
  font: 700 21px/1 inherit;
  cursor: pointer;
}

.page-controls > button:hover {
  color: #f0d68a;
}

.page-controls > div {
  display: flex;
  justify-content: center;
  gap: 6px;
}

.page-controls > div button {
  width: 7px;
  height: 7px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #4c4f57;
  cursor: pointer;
}

.page-controls > div button.active {
  background: #d4a843;
  box-shadow: 0 0 0 3px rgba(212, 168, 67, 0.12);
}

.warning {
  margin: 0 2px 9px;
  padding: 9px;
  border-radius: 8px;
  color: #ffd9bf;
  background: rgba(156, 71, 42, 0.25);
  font-size: 11px;
  line-height: 1.4;
}

@keyframes wheel-in {
  from {
    opacity: 0;
    transform: scale(0.94);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .shell,
  .orb,
  .wheel,
  .launcher-next-enter-active,
  .launcher-next-leave-active,
  .launcher-previous-enter-active,
  .launcher-previous-leave-active {
    animation: none;
    transition: none;
  }
}
</style>
