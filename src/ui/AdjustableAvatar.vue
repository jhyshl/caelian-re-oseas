<script setup lang="ts">
/* global HTMLElement, PointerEvent, Storage */
import { computed, ref, useAttrs, watch } from 'vue';
import {
  normalizeAvatarPreference,
  readAvatarPreference,
  writeAvatarPreference,
  type AvatarViewPreference,
} from '@/ui/avatar-preferences';

const props = defineProps<{
  src?: string;
  fallbackSrc?: string;
  alt: string;
  fallback: string;
  preferenceId: string;
  teleportTarget?: string | HTMLElement;
}>();
const emit = defineEmits<{ imageError: []; imageLoad: [] }>();
defineOptions({ inheritAttrs: false });
const attrs = useAttrs();
const activeSrc = ref(props.src || props.fallbackSrc || '');

function storage(): Storage | undefined {
  if (
    props.teleportTarget &&
    typeof props.teleportTarget !== 'string'
  ) {
    try {
      return (
        props.teleportTarget.ownerDocument.defaultView?.localStorage ??
        undefined
      );
    } catch {
      return undefined;
    }
  }
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

const saved = ref<AvatarViewPreference>(
  readAvatarPreference(props.preferenceId, storage()),
);
const draft = ref<AvatarViewPreference>({ ...saved.value });
const open = ref(false);
const dragging = ref(false);
const saveError = ref('');
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
  () => [props.preferenceId, props.teleportTarget] as const,
  ([preferenceId]) => {
    saved.value = readAvatarPreference(preferenceId, storage());
    draft.value = { ...saved.value };
  },
);
watch(
  () => [props.src, props.fallbackSrc] as const,
  ([src, fallbackSrc]) => {
    activeSrc.value = src || fallbackSrc || '';
  },
);

const thumbnailStyle = computed(() =>
  imageStyle(open.value ? draft.value : saved.value),
);
const previewStyle = computed(() => imageStyle(draft.value));

function imageStyle(
  preference: AvatarViewPreference,
): Record<string, string> {
  return {
    '--ca-avatar-position': `${preference.x}% ${preference.y}%`,
    '--ca-avatar-origin': `${preference.x}% ${preference.y}%`,
    '--ca-avatar-zoom': String(preference.zoom),
  };
}

function showEditor(): void {
  draft.value = { ...saved.value };
  saveError.value = '';
  open.value = true;
}

function closeEditor(): void {
  open.value = false;
  dragging.value = false;
  saveError.value = '';
  pointerStart = undefined;
}

function save(): void {
  const next = writeAvatarPreference(
    props.preferenceId,
    draft.value,
    storage(),
  );
  const persisted = readAvatarPreference(
    props.preferenceId,
    storage(),
  );
  if (JSON.stringify(next) !== JSON.stringify(persisted)) {
    saveError.value = '浏览器阻止了本地保存，请检查站点存储权限。';
    return;
  }
  saved.value = next;
  draft.value = { ...next };
  closeEditor();
}

function reset(): void {
  draft.value = normalizeAvatarPreference();
  saveError.value = '';
}

function pointerDown(event: PointerEvent): void {
  event.preventDefault();
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
  event.preventDefault();
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

function handleImageError(): void {
  if (
    activeSrc.value === props.src &&
    props.fallbackSrc &&
    props.fallbackSrc !== props.src
  ) {
    activeSrc.value = props.fallbackSrc;
    return;
  }
  emit('imageError');
}
</script>

<template>
  <span
    v-bind="attrs"
    class="adjustable-avatar-host"
  >
    <button
      type="button"
      class="adjustable-avatar"
      aria-label="打开头像显示设置"
      title="点击调整头像大小和位置"
      @click="showEditor"
    >
      <span class="avatar-viewport">
        <img
          v-if="activeSrc"
          :src="activeSrc"
          :alt="alt"
          :style="thumbnailStyle"
          @load="emit('imageLoad')"
          @error="handleImageError"
        />
        <span v-else class="avatar-fallback" aria-hidden="true">
          {{ fallback }}
        </span>
      </span>
      <i aria-hidden="true">⌘</i>
    </button>

    <Teleport :to="teleportTarget ?? 'body'">
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

          <div class="avatar-preview-grid">
            <figure class="avatar-source-preview">
              <div>
                <img
                  v-if="activeSrc"
                  class="avatar-source-image"
                  :src="activeSrc"
                  :alt="`${alt}完整原图`"
                  style="object-fit: contain !important; object-position: 50% 50% !important; transform: none !important"
                  draggable="false"
                />
                <span v-else>{{ fallback }}</span>
              </div>
              <figcaption>完整原图</figcaption>
            </figure>

            <figure class="avatar-crop-preview">
              <div
                class="avatar-preview"
                :class="{ dragging }"
                @pointerdown="pointerDown"
                @pointermove="pointerMove"
                @pointerup="pointerUp"
                @pointercancel="pointerUp"
              >
                <img
                  v-if="activeSrc"
                  :src="activeSrc"
                  :alt="alt"
                  :style="previewStyle"
                  draggable="false"
                />
                <span v-else>{{ fallback }}</span>
                <em>拖动图片调整展示位置</em>
              </div>
              <figcaption>面板实际取景</figcaption>
            </figure>
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
            <span class="avatar-save-status" role="status">
              {{ saveError }}
            </span>
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
  </span>
</template>

<style scoped>
.adjustable-avatar-host {
  position: relative;
}

.adjustable-avatar {
  position: relative;
  width: 100%;
  height: 100%;
  display: block;
  padding: 0;
  border: 0;
  border-radius: inherit;
  color: inherit;
  background: transparent;
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
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  display: block !important;
  object-fit: cover;
  object-position: var(--ca-avatar-position, 50% 50%) !important;
  transform: scale(var(--ca-avatar-zoom, 1)) !important;
  transform-origin: var(--ca-avatar-origin, 50% 50%) !important;
  transition:
    object-position 120ms ease,
    transform 120ms ease;
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
  right: 2px;
  bottom: 2px;
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
  width: min(660px, 100%);
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

.avatar-preview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  margin: 18px 0;
}

.avatar-source-preview,
.avatar-crop-preview {
  min-width: 0;
  margin: 0;
}

.avatar-source-preview > div {
  width: 100%;
  height: min(290px, 48vh);
  overflow: hidden;
  display: grid;
  place-items: center;
  border: 1px solid rgba(212, 168, 67, 0.28);
  border-radius: 18px;
  color: #f0d68a;
  background:
    linear-gradient(45deg, rgba(255, 255, 255, 0.025) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.025) 25%, transparent 25%),
    #100e0b;
  background-size: 18px 18px;
  font: 700 72px/1 Georgia, serif;
}

.avatar-source-preview img {
  position: static !important;
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  max-height: 100% !important;
  display: block !important;
  object-fit: contain !important;
  object-position: 50% 50% !important;
  transform: none !important;
  user-select: none;
}

.avatar-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  display: grid;
  place-items: center;
  margin: 0 auto;
  border: 1px solid rgba(212, 168, 67, 0.48);
  border-radius: 18px;
  color: #f0d68a;
  background: #292116;
  font: 700 72px/1 Georgia, serif;
  cursor: grab;
  touch-action: none;
}

.avatar-source-preview figcaption,
.avatar-crop-preview figcaption {
  margin-top: 7px;
  color: #9e8e77;
  font: normal 10px/1.3 sans-serif;
  text-align: center;
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

.avatar-save-status {
  color: #ef9c91;
  font-size: 10px;
  line-height: 1.35;
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

  .avatar-preview-grid {
    grid-template-columns: 1fr;
  }

  .avatar-source-preview > div {
    height: min(240px, 34vh);
  }
}
</style>
