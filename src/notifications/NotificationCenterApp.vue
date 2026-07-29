<script setup lang="ts">
import type { NotificationViewModel } from '@/notifications/types';

defineProps<{
  model: NotificationViewModel;
  dismiss: (id: number) => void;
  activate: (id: number) => void;
  pause: (id: number) => void;
  resume: (id: number) => void;
  respond: (accepted: boolean) => void;
}>();
</script>

<template>
  <div class="notification-root">
    <div
      class="notification-stack"
      role="region"
      aria-label="欧西亚斯通知"
      aria-live="polite"
    >
      <article
        v-for="toast in model.toasts"
        :key="toast.id"
        class="notification-toast"
        :class="[
          toast.kind,
          {
            leaving: toast.leaving,
            paused: toast.paused,
            clickable: toast.clickable,
          },
        ]"
        :style="{ '--toast-duration': `${toast.duration}ms` }"
        :role="toast.clickable ? 'button' : 'status'"
        :tabindex="toast.clickable ? 0 : undefined"
        @click="toast.clickable && activate(toast.id)"
        @keydown.enter="toast.clickable && activate(toast.id)"
        @keydown.space.prevent="toast.clickable && activate(toast.id)"
        @mouseenter="pause(toast.id)"
        @mouseleave="resume(toast.id)"
        @focusin="pause(toast.id)"
        @focusout="resume(toast.id)"
      >
        <div class="ornament" aria-hidden="true"></div>
        <div class="notification-icon" aria-hidden="true">
          <span>{{ toast.icon }}</span>
        </div>
        <div class="notification-copy">
          <div class="notification-heading">
            <span>{{ toast.eyebrow }}</span>
            <b v-if="toast.meta">{{ toast.meta }}</b>
          </div>
          <strong>{{ toast.title }}</strong>
          <p v-if="toast.description">{{ toast.description }}</p>
        </div>
        <button
          type="button"
          class="notification-close"
          aria-label="关闭通知"
          @click.stop="dismiss(toast.id)"
        >
          ×
        </button>
        <div class="notification-timer" aria-hidden="true">
          <span></span>
        </div>
      </article>
    </div>

    <div
      v-if="model.confirmation"
      class="confirm-overlay"
      @click.self="respond(false)"
    >
      <section
        class="confirm-dialog"
        :class="model.confirmation.tone"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="caelian-confirm-title"
        aria-describedby="caelian-confirm-description"
      >
        <div class="confirm-sigil" aria-hidden="true">
          {{ model.confirmation.tone === 'danger' ? '!' : '✦' }}
        </div>
        <span>OSEAS CONFIRMATION</span>
        <h2 id="caelian-confirm-title">{{ model.confirmation.title }}</h2>
        <p id="caelian-confirm-description">
          {{ model.confirmation.description }}
        </p>
        <div class="confirm-actions">
          <button type="button" class="cancel" @click="respond(false)">
            {{ model.confirmation.cancelText }}
          </button>
          <button type="button" class="confirm" @click="respond(true)">
            {{ model.confirmation.confirmText }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.notification-root {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  font-family:
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
}

.notification-stack {
  position: absolute;
  top: max(14px, env(safe-area-inset-top));
  left: 50%;
  display: grid;
  width: min(560px, calc(100vw - 24px));
  gap: 9px;
  transform: translateX(-50%);
}

.notification-toast {
  --accent: #d4a843;
  --accent-light: #ffe08a;
  --surface-start: rgba(24, 19, 32, 0.985);
  --surface-end: rgba(48, 35, 62, 0.985);
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 66px;
  padding: 11px 12px 12px;
  overflow: hidden;
  border: 1px solid rgba(212, 168, 67, 0.62);
  border: 1px solid color-mix(in srgb, var(--accent) 62%, transparent);
  border-radius: 16px;
  color: #f6efe2;
  background:
    linear-gradient(120deg, var(--surface-start), var(--surface-end)),
    #17131f;
  box-shadow:
    0 18px 48px rgba(0, 0, 0, 0.44),
    0 0 0 1px rgba(255, 255, 255, 0.055) inset;
  backdrop-filter: blur(14px) saturate(145%);
  pointer-events: auto;
  animation: toast-enter 0.38s cubic-bezier(0.16, 1, 0.3, 1) both;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease,
    opacity 0.26s ease;
}

.notification-toast::before {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    105deg,
    transparent 18%,
    color-mix(in srgb, var(--accent-light) 12%, transparent) 43%,
    transparent 67%
  );
  transform: translateX(-120%);
  animation: toast-shine 1.1s 0.12s ease-out both;
  content: "";
  pointer-events: none;
}

.notification-toast.clickable {
  cursor: pointer;
}

.notification-toast.clickable:hover,
.notification-toast.clickable:focus-visible {
  border-color: rgba(255, 224, 138, 0.78);
  border-color: color-mix(in srgb, var(--accent-light) 78%, transparent);
  box-shadow:
    0 22px 55px rgba(0, 0, 0, 0.5),
    0 0 24px color-mix(in srgb, var(--accent) 14%, transparent);
  outline: none;
  transform: translateY(-2px);
}

.notification-toast.leaving {
  opacity: 0;
  transform: translateY(-12px) scale(0.98);
}

.notification-toast.task {
  --accent: #4aa3ff;
  --accent-light: #b8dcff;
  --surface-start: rgba(16, 26, 39, 0.985);
  --surface-end: rgba(32, 40, 59, 0.985);
}

.notification-toast.craft {
  --accent: #c99043;
  --accent-light: #ffe1a0;
  --surface-start: rgba(38, 31, 24, 0.985);
  --surface-end: rgba(25, 22, 28, 0.985);
}

.notification-toast.success,
.notification-toast.info {
  --accent: #cfa655;
  --accent-light: #f7dc91;
  --surface-start: rgba(31, 42, 55, 0.985);
  --surface-end: rgba(43, 31, 55, 0.985);
}

.notification-toast.warning,
.notification-toast.error {
  --accent: #ef765f;
  --accent-light: #ffc09f;
  --surface-start: rgba(56, 29, 31, 0.985);
  --surface-end: rgba(34, 19, 30, 0.985);
}

.ornament {
  position: absolute;
  top: -23px;
  right: 54px;
  width: 82px;
  height: 82px;
  border: 1px solid color-mix(in srgb, var(--accent) 16%, transparent);
  border-radius: 50%;
  box-shadow:
    0 0 0 8px color-mix(in srgb, var(--accent) 4%, transparent),
    0 0 0 18px color-mix(in srgb, var(--accent) 3%, transparent);
  pointer-events: none;
}

.notification-icon {
  position: relative;
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 1px solid rgba(255, 224, 138, 0.72);
  border: 1px solid color-mix(in srgb, var(--accent-light) 72%, transparent);
  border-radius: 12px;
  color: #1b1205;
  background:
    radial-gradient(circle at 30% 22%, #fff3bb, var(--accent-light) 34%, var(--accent) 74%);
  box-shadow:
    0 0 19px color-mix(in srgb, var(--accent) 24%, transparent),
    0 1px 0 rgba(255, 255, 255, 0.45) inset;
  font: 900 20px/1 Georgia, serif;
}

.notification-icon::after {
  position: absolute;
  inset: 3px;
  border: 1px solid rgba(55, 31, 7, 0.25);
  border-radius: 9px;
  content: "";
}

.notification-copy {
  min-width: 0;
}

.notification-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.notification-heading span {
  overflow: hidden;
  color: var(--accent-light);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-heading b {
  flex-shrink: 0;
  color: var(--accent-light);
  font: 700 8px Georgia, serif;
  letter-spacing: 0.06em;
}

.notification-copy > strong {
  display: block;
  overflow: hidden;
  color: #fff4dd;
  font: 700 14px/1.35 Georgia, "Noto Serif SC", serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-copy p {
  margin: 3px 0 0;
  overflow: hidden;
  color: rgba(229, 218, 230, 0.78);
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-close {
  align-self: start;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: rgba(245, 233, 215, 0.54);
  background: rgba(255, 255, 255, 0.055);
  font: 400 17px/22px sans-serif;
  cursor: pointer;
}

.notification-close:hover,
.notification-close:focus-visible {
  color: #fff2d7;
  background: rgba(255, 255, 255, 0.12);
  outline: none;
}

.notification-timer {
  position: absolute;
  right: 10px;
  bottom: 0;
  left: 10px;
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}

.notification-timer span {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, var(--accent-light));
  transform-origin: left;
  animation: toast-countdown var(--toast-duration) linear forwards;
}

.notification-toast.paused .notification-timer span {
  animation-play-state: paused;
}

.confirm-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: max(16px, env(safe-area-inset-top))
    max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom))
    max(16px, env(safe-area-inset-left));
  background: rgba(8, 7, 12, 0.7);
  backdrop-filter: blur(7px);
  pointer-events: auto;
  animation: overlay-enter 0.2s ease both;
}

.confirm-dialog {
  position: relative;
  width: min(410px, calc(100vw - 32px));
  padding: 24px;
  overflow: hidden;
  border: 1px solid rgba(212, 168, 67, 0.56);
  border-radius: 20px;
  color: #eee6d8;
  background:
    radial-gradient(circle at 92% 0, rgba(212, 168, 67, 0.14), transparent 31%),
    linear-gradient(155deg, #201927, #101218 62%);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.64);
  text-align: center;
  animation: dialog-enter 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.confirm-dialog.danger {
  border-color: rgba(225, 102, 78, 0.62);
  background:
    radial-gradient(circle at 92% 0, rgba(225, 102, 78, 0.15), transparent 31%),
    linear-gradient(155deg, #291a20, #101218 62%);
}

.confirm-sigil {
  display: grid;
  width: 50px;
  height: 50px;
  margin: 0 auto 12px;
  place-items: center;
  border: 1px solid #d4a843;
  border-radius: 50%;
  color: #ffe39b;
  background: rgba(212, 168, 67, 0.09);
  box-shadow: 0 0 28px rgba(212, 168, 67, 0.14);
  font: 700 22px Georgia, serif;
}

.danger .confirm-sigil {
  border-color: #dc705c;
  color: #ffc3ad;
  background: rgba(220, 112, 92, 0.1);
  box-shadow: 0 0 28px rgba(220, 112, 92, 0.14);
}

.confirm-dialog > span {
  color: #b58c3e;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.danger > span {
  color: #d47a68;
}

.confirm-dialog h2 {
  margin: 6px 0 8px;
  color: #fff3db;
  font: 700 21px Georgia, "Noto Serif SC", serif;
}

.confirm-dialog p {
  margin: 0;
  color: #aaa297;
  font-size: 12px;
  line-height: 1.65;
}

.confirm-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
  margin-top: 21px;
}

.confirm-actions button {
  min-height: 40px;
  border-radius: 10px;
  font: 700 11px inherit;
  cursor: pointer;
}

.confirm-actions .cancel {
  border: 1px solid #3a3c45;
  color: #bbb3a7;
  background: rgba(255, 255, 255, 0.035);
}

.confirm-actions .confirm {
  border: 1px solid #d4a843;
  color: #1b1408;
  background: linear-gradient(180deg, #e3bd61, #af7d25);
}

.danger .confirm-actions .confirm {
  border-color: #e17d68;
  color: #fff2eb;
  background: linear-gradient(180deg, #c45948, #84362f);
}

@keyframes toast-enter {
  from {
    opacity: 0;
    transform: translateY(-14px) scale(0.98);
  }
}

@keyframes toast-shine {
  to {
    transform: translateX(120%);
  }
}

@keyframes toast-countdown {
  to {
    transform: scaleX(0);
  }
}

@keyframes overlay-enter {
  from {
    opacity: 0;
  }
}

@keyframes dialog-enter {
  from {
    opacity: 0;
    transform: translateY(9px) scale(0.94);
  }
}

@media (max-width: 600px) {
  .notification-stack {
    top: max(8px, env(safe-area-inset-top));
    width: calc(100vw - 16px);
    gap: 7px;
  }

  .notification-toast {
    min-height: 62px;
    padding: 10px 10px 11px;
    border-radius: 14px;
  }

  .notification-icon {
    width: 36px;
    height: 36px;
    font-size: 18px;
  }

  .notification-copy > strong {
    font-size: 13px;
  }

  .notification-copy p {
    font-size: 10px;
  }

  .confirm-dialog {
    padding: 21px 17px 17px;
    border-radius: 17px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .notification-toast,
  .notification-toast::before,
  .confirm-overlay,
  .confirm-dialog {
    animation: none;
  }

  .notification-toast {
    transition: opacity 0.15s ease;
  }

  .confirm-overlay {
    backdrop-filter: none;
  }
}
</style>
