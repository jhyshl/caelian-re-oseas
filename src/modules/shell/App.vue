<script setup lang="ts">
/* global Event, HTMLElement, MouseEvent, Node, PointerEvent, Window, window */
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

const props = defineProps<{ context: PanelContext }>();

const STORAGE_KEY = 'caelian_floating_wheel_position_v2';
const IDLE_DELAY = 3000;
const DRAG_THRESHOLD = 5;

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

let idleTimer: number | undefined;
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
  { panel: 'deck', icon: '▱', label: '牌组' },
  { panel: 'inventory', icon: '◇', label: '背包' },
  { panel: 'guild', icon: '⚔', label: '协会' },
  { panel: 'map', icon: '⌖', label: '地图' },
  { panel: 'battle', icon: '✹', label: '战斗' },
  { panel: 'achievements', icon: '♛', label: '成就' },
];

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
    : '打开或拖动 Re∞：欧西亚斯悬浮入口';
});

function hostWindow(): Window {
  return props.context.document.defaultView ?? window;
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
  expanded.value = true;
}

function closeWheel(): void {
  expanded.value = false;
  scheduleIdle();
}

function toggleWheel(): void {
  if (expanded.value) closeWheel();
  else openWheel();
}

function open(panel: PanelName): void {
  if (info.value.status !== 'ready' && panel !== 'diagnostics') return;
  void props.context.api.navigatePanel(panel);
  closeWheel();
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
  } else if (session.wasExpanded) {
    closeWheel();
  } else {
    openWheel();
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
  scheduleIdle();
}

function handleClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (event.detail === 0) toggleWheel();
}

function handleOutsidePointerDown(event: Event): void {
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
    <div v-if="expanded" class="wheel" :class="wheelClasses" role="menu">
      <header>
        <span>RE∞ OSEAS</span>
        <small>{{ info.version }} · {{ info.channel }}</small>
      </header>
      <p v-if="info.status !== 'ready'" class="warning">
        {{ info.lastError || `内核状态：${info.status}` }}
      </p>
      <div class="wheel-grid">
        <button
          v-for="item in primary"
          :key="item.panel"
          type="button"
          role="menuitem"
          :disabled="info.status !== 'ready'"
          @click="open(item.panel)"
        >
          <b>{{ item.icon }}</b>
          <span>{{ item.label }}</span>
        </button>
      </div>
      <footer>
        <button type="button" role="menuitem" @click="open('settings')">
          ⚙ 设置
        </button>
        <button type="button" role="menuitem" @click="open('feedback')">
          ✎ 反馈
        </button>
        <button type="button" role="menuitem" @click="open('diagnostics')">
          ◈ 诊断
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

header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 4px 5px 12px;
}

header span {
  color: #d4a843;
  font: 700 14px Georgia, serif;
  letter-spacing: 0.12em;
}

header small {
  color: #837d72;
  font-size: 9px;
}

.wheel-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
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

footer {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 7px;
}

footer button {
  padding: 8px;
  border: 1px solid #292d37;
  border-radius: 9px;
  color: #938d82;
  background: transparent;
  font: 600 10px inherit;
  cursor: pointer;
}

footer button:hover {
  color: #f0d68a;
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
  .wheel {
    animation: none;
    transition: none;
  }
}
</style>
