<script setup lang="ts">
/* global HTMLElement, PointerEvent */
import { computed, ref, useAttrs, watch } from 'vue';
import {
  readAvatarPreference,
  resetAvatarPreference,
  writeAvatarPreference,
  type AvatarViewPreference,
} from '@/ui/avatar-preferences';

const props = defineProps<{
  src?: string;
  alt: string;
  fallback: string;
  preferenceId: string;
}>();
const emit = defineEmits<{ imageError: [] }>();
defineOptions({ inheritAttrs: false });
const attrs = useAttrs();

const saved = ref<AvatarViewPreference>(
  readAvatarPreference(props.preferenceId),
);
const draft = ref<AvatarViewPreference>({ ...saved.value });
const open = ref(false);
const dragging = ref(false);
let pointerStart:
  | {
      x: number;
      y: number;
      preferenceX: number;
      preferenceY: number;
      width: number;
      height: number;
    }
  | undefined;

watch(
  () => props.preferenceId,
  (preferenceId) => {
    saved.value = readAvatarPreference(preferenceId);
    draft.value = { ...saved.value };
  },
);

const thumbnailStyle = computed(() => imageStyle(saved.value));
const previewStyle = computed(() => imageStyle(draft.value));

function imageStyle(preference: AvatarViewPreference) {
  return {
    objectPosition: `${preference.x}% ${preference.y}%`,
    transform: `scale(${preference.zoom})`,
    transformOrigin: `${preference.x}% ${preference.y}%`,
  };
}

function showEditor(): void {
  draft.value = { ...saved.value };
  open.value = true;
}

function closeEditor(): void {
  open.value = false;
  dragging.value = false;
  pointerStart = undefined;
}

function save(): void {
  saved.value = writeAvatarPreference(props.preferenceId, draft.value);
  closeEditor();
}

function reset(): void {
  saved.value = resetAvatarPreference(props.preferenceId);
  draft.value = { ...saved.value };
}

function pointerDown(event: PointerEvent): void {
  const element = event.currentTarget as HTMLElement;
  const rect = element.getBoundingClientRect();
  dragging.value = true;
  pointerStart = {
    x: event.clientX,
    y: event.clientY,
    preferenceX: draft.value.x,
    preferenceY: draft.value.y,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };
  element.setPointerCapture(event.pointerId);
}

function pointerMove(event: PointerEvent): void {
  if (!pointerStart) return;
  draft.value = {
    ...draft.value,
    x: Math.min(
      100,
      Math.max(
        0,
        pointerStart.preferenceX -
          ((event.clientX - pointerStart.x) / pointerStart.width) * 100,
      ),
    ),
    y: Math.min(
      100,
      Math.max(
        0,
        pointerStart.preferenceY -
          ((event.clientY - pointerStart.y) / pointerStart.height) * 100,
      ),
    ),
  };
}

function pointerUp(): void {
  dragging.value = false;
  pointerStart = undefined;
}
</script>

<template>
  <button
    v-bind="attrs"
    type="button"
    class="adjustable-avatar"
    aria-label="打开头像显示设置"
    title="点击调整头像大小和位置"
    @click="showEditor"
  >
    <span class="avatar-viewport">
      <img
        v-if="src"
        :src="src"
        :alt="alt"
        :style="thumbnailStyle"
        @error="emit('imageError')"
      />
      <span v-else class="avatar-fallback" aria-hidden="true">
        {{ fallback }}
      </span>
    </span>
    <i aria-hidden="true">⌘</i>
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      class="avatar-editor-backdrop"
      role="presentation"
      @click.self="closeEditor"
    >
      <section
        class="avatar-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-editor-title"
      >
        <header>
          <div>
            <small>AVATAR VIEW</small>
            <h2 id="avatar-editor-title">调整头像显示</h2>
          </div>
          <button type="button" aria-label="关闭" @click="closeEditor">×</button>
        </header>

        <div
          class="avatar-preview"
          :class="{ dragging }"
          @pointerdown="pointerDown"
          @pointermove="pointerMove"
          @pointerup="pointerUp"
          @pointercancel="pointerUp"
        >
          <img
            v-if="src"
            :src="src"
            :alt="alt"
            :style="previewStyle"
            draggable="false"
          />
          <span v-else>{{ fallback }}</span>
          <em>拖动图片调整展示位置</em>
        </div>

        <div class="avatar-controls">
          <label>
            <span>图片大小 <b>{{ Math.round(draft.zoom * 100) }}%</b></span>
            <input
              v-model.number="draft.zoom"
              type="range"
              min="1"
              max="3"
              step="0.01"
            />
          </label>
          <label>
            <span>水平位置 <b>{{ Math.round(draft.x) }}%</b></span>
            <input
              v-model.number="draft.x"
              type="range"
              min="0"
              max="100"
              step="1"
            />
          </label>
          <label>
            <span>垂直位置 <b>{{ Math.round(draft.y) }}%</b></span>
            <input
              v-model.number="draft.y"
              type="range"
              min="0"
              max="100"
              step="1"
            />
          </label>
        </div>

        <footer>
          <button type="button" class="ca-button" @click="reset">恢复默认</button>
          <span></span>
          <button type="button" class="ca-button" @click="closeEditor">
            取消
          </button>
          <button type="button" class="ca-button primary" @click="save">
            保存显示
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.adjustable-avatar {
  position: relative;
  padding: 0;
  border: 0;
  color: inherit;
  background: inherit;
  font: inherit;
  cursor: pointer;
}

.avatar-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  display: grid;
  place-items: center;
  border-radius: inherit;
}

.avatar-viewport img,
.avatar-preview img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  transition: transform 160ms ease;
  user-select: none;
}

.avatar-fallback {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
}

.adjustable-avatar > i {
  position: absolute;
  right: -4px;
  bottom: -4px;
  z-index: 2;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(212, 168, 67, 0.6);
  border-radius: 50%;
  color: #f0d68a;
  background: #251b10;
  font: 700 9px/1 sans-serif;
  opacity: 0;
  transition: opacity 160ms ease;
}

.adjustable-avatar:hover > i,
.adjustable-avatar:focus-visible > i {
  opacity: 1;
}

.avatar-editor-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(7, 6, 5, 0.78);
  backdrop-filter: blur(8px);
}

.avatar-editor {
  width: min(460px, 100%);
  max-height: calc(100vh - 36px);
  overflow: auto;
  padding: 18px;
  border: 1px solid rgba(212, 168, 67, 0.38);
  border-radius: 18px;
  color: var(--ca-text, #e9dfce);
  background:
    radial-gradient(circle at 50% 0, rgba(212, 168, 67, 0.13), transparent 42%),
    #17130f;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.58);
}

.avatar-editor header,
.avatar-editor footer,
.avatar-controls label > span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.avatar-editor header small {
  color: var(--ca-gold, #d4a843);
  font-size: 9px;
  letter-spacing: 0.18em;
}

.avatar-editor h2 {
  margin: 2px 0 0;
  color: var(--ca-text-bright, #fff8e8);
  font: 700 21px/1.2 var(--ca-serif, Georgia, serif);
}

.avatar-editor header > button {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(212, 168, 67, 0.24);
  border-radius: 50%;
  color: #d4c5ac;
  background: rgba(255, 255, 255, 0.035);
  font-size: 21px;
  cursor: pointer;
}

.avatar-preview {
  position: relative;
  width: min(290px, 76vw);
  aspect-ratio: 1;
  overflow: hidden;
  display: grid;
  place-items: center;
  margin: 18px auto;
  border: 1px solid rgba(212, 168, 67, 0.48);
  border-radius: 18px;
  color: #f0d68a;
  background: #292116;
  font: 700 72px/1 Georgia, serif;
  cursor: grab;
  touch-action: none;
}

.avatar-preview.dragging {
  cursor: grabbing;
}

.avatar-preview em {
  position: absolute;
  right: 9px;
  bottom: 9px;
  left: 9px;
  padding: 6px 8px;
  border-radius: 8px;
  color: #f4ead7;
  background: rgba(8, 7, 6, 0.65);
  font: normal 10px/1.2 sans-serif;
  text-align: center;
  pointer-events: none;
}

.avatar-controls {
  display: grid;
  gap: 12px;
}

.avatar-controls label {
  display: grid;
  gap: 7px;
  color: #cfc0aa;
  font-size: 11px;
}

.avatar-controls b {
  color: #e6c76e;
  font-weight: 700;
}

.avatar-controls input {
  width: 100%;
  accent-color: #d4a843;
}

.avatar-editor footer {
  margin-top: 18px;
}

.avatar-editor footer > span {
  flex: 1;
}

@media (max-width: 480px) {
  .avatar-editor {
    padding: 15px;
  }

  .avatar-editor footer {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .avatar-editor footer > span {
    display: none;
  }
}
</style>
