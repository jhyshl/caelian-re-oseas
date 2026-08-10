<script setup lang="ts">
import type { PanelContext, PanelName } from '@/kernel/public-api';

const props = withDefaults(
  defineProps<{
    context: PanelContext;
    active: PanelName;
    date?: string;
    pageMode?: 'standard' | 'battle';
  }>(),
  {
    date: '',
    pageMode: 'standard',
  },
);

const navigation: Array<{
  id: PanelName;
  icon: string;
  label: string;
}> = [
  { id: 'character', icon: '♙', label: '角色' },
  { id: 'deck', icon: '▱', label: '牌组' },
  { id: 'inventory', icon: '◇', label: '背包' },
  { id: 'crafting', icon: '⚗', label: '合成' },
  { id: 'guild', icon: '⚔', label: '协会' },
];

function navigate(panel: PanelName) {
  if (panel === props.active) return;
  void props.context.api.navigatePanel(panel);
}
</script>

<template>
  <div class="ca-backdrop" @mousedown.self="context.api.closePanel(active)">
    <section
      class="ca-frame"
      :class="`ca-frame--${pageMode}`"
      aria-label="欧西亚斯冒险者面板"
    >
      <header class="ca-header">
        <div class="ca-brand">
          <strong>ADVENTURER</strong>
          <span>RE∞ OSEAS</span>
        </div>
        <div class="ca-date">{{ date || '欧西亚斯大陆' }}</div>
        <button
          type="button"
          class="ca-header-button ca-close"
          aria-label="关闭面板"
          @click="context.api.closePanel(active)"
        >
          ×
        </button>
      </header>

      <nav class="ca-navigation" aria-label="冒险者面板导航">
        <button
          v-for="item in navigation"
          :key="item.id"
          type="button"
          class="ca-nav-button"
          :class="{ active: item.id === active }"
          :aria-current="item.id === active ? 'page' : undefined"
          @click="navigate(item.id)"
        >
          <span class="ca-nav-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <main class="ca-page">
        <slot />
      </main>
    </section>
  </div>
</template>

<style>
:root {
  --ca-bg: #0d0f14;
  --ca-surface: #161a24;
  --ca-surface-soft: #1b202c;
  --ca-border: #2a2f3d;
  --ca-border-light: #3a4055;
  --ca-gold: #d4a843;
  --ca-gold-dark: #9d7528;
  --ca-gold-light: #f0d68a;
  --ca-red: #c94a43;
  --ca-green: #38a96b;
  --ca-blue: #3a8bc0;
  --ca-purple: #9c61bb;
  --ca-text: #e8e0d4;
  --ca-text-bright: #fff5e6;
  --ca-muted: #938d82;
  --ca-serif: "Crimson Text", "Noto Serif SC", Georgia, serif;
  --ca-ui: "Alegreya Sans", "Noto Sans SC", "Microsoft YaHei", sans-serif;
}

.ca-backdrop,
.ca-backdrop * {
  box-sizing: border-box;
}

.ca-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 14px;
  color: var(--ca-text);
  background: rgba(3, 5, 8, 0.78);
  font-family: var(--ca-ui);
  backdrop-filter: blur(6px);
}

.ca-frame {
  width: min(1180px, 100%);
  height: min(840px, calc(100dvh - 28px));
  display: grid;
  grid-template:
    "header header" auto
    "nav page" minmax(0, 1fr) /
    174px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(212, 168, 67, 0.3);
  border-radius: 18px;
  background: var(--ca-bg);
  box-shadow: 0 32px 100px rgba(0, 0, 0, 0.68);
}

.ca-frame--battle {
  width: min(1320px, 100%);
  height: min(900px, calc(100dvh - 20px));
}

.ca-frame--battle .ca-page {
  position: relative;
  overflow: hidden;
  padding: 16px 18px 24px;
}

.ca-header {
  grid-area: header;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 66px;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(212, 168, 67, 0.24);
  background:
    radial-gradient(circle at 16% -20%, rgba(212, 168, 67, 0.17), transparent 30%),
    linear-gradient(135deg, #17130f, #2a2016 50%, #17130f);
}

.ca-brand {
  display: grid;
  min-width: 190px;
}

.ca-brand strong {
  color: var(--ca-gold);
  font: 700 25px/1 var(--ca-serif);
  letter-spacing: 0.13em;
}

.ca-brand span {
  margin-top: 5px;
  color: rgba(240, 214, 138, 0.55);
  font-size: 9px;
  letter-spacing: 0.28em;
}

.ca-date {
  flex: 1;
  color: var(--ca-muted);
  font-size: 12px;
  text-align: right;
}

.ca-header-button {
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid var(--ca-border);
  border-radius: 8px;
  color: var(--ca-muted);
  background: rgba(255, 255, 255, 0.025);
  font: inherit;
  cursor: pointer;
}

.ca-header-button:hover {
  border-color: rgba(212, 168, 67, 0.45);
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.08);
}

.ca-close {
  width: 35px;
  padding: 0;
  font-size: 22px;
}

.ca-navigation {
  grid-area: nav;
  display: flex;
  flex-direction: column;
  padding: 10px 0;
  border-right: 1px solid rgba(212, 168, 67, 0.18);
  background: linear-gradient(180deg, #111318, #0d0f14);
}

.ca-nav-button {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 0 18px;
  border: 0;
  border-left: 3px solid transparent;
  color: var(--ca-muted);
  background: transparent;
  font: 600 14px/1 var(--ca-ui);
  cursor: pointer;
}

.ca-nav-button:hover {
  color: var(--ca-text);
  background: rgba(255, 255, 255, 0.03);
}

.ca-nav-button.active {
  border-left-color: var(--ca-gold);
  color: var(--ca-gold);
  background: rgba(212, 168, 67, 0.1);
}

.ca-nav-icon {
  width: 22px;
  color: currentColor;
  font-size: 21px;
  text-align: center;
}

.ca-page {
  grid-area: page;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 22px 24px 34px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.ca-section {
  padding: 18px;
  border: 1px solid var(--ca-border);
  border-radius: 14px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.025), transparent 65%),
    var(--ca-surface);
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.025);
}

.ca-section + .ca-section {
  margin-top: 14px;
}

.ca-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 13px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(212, 168, 67, 0.23);
  color: var(--ca-gold);
  font: 700 18px/1.2 var(--ca-serif);
  letter-spacing: 0.05em;
}

.ca-button {
  min-height: 34px;
  padding: 7px 13px;
  border: 1px solid var(--ca-border-light);
  border-radius: 9px;
  color: var(--ca-text);
  background: rgba(255, 255, 255, 0.035);
  font: 700 12px/1 var(--ca-ui);
  cursor: pointer;
}

.ca-button:hover:not(:disabled) {
  border-color: var(--ca-gold);
  color: var(--ca-gold-light);
}

.ca-button.primary {
  border-color: var(--ca-gold-dark);
  color: #1c160d;
  background: linear-gradient(135deg, var(--ca-gold-light), var(--ca-gold));
}

.ca-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.ca-empty {
  padding: 34px 16px;
  color: var(--ca-muted);
  text-align: center;
}

@media (min-width: 760px) and (max-width: 980px) {
  .ca-frame {
    grid-template:
      "header header" auto
      "nav page" minmax(0, 1fr) /
      76px minmax(0, 1fr);
  }

  .ca-brand {
    min-width: 155px;
  }

  .ca-brand strong {
    font-size: 20px;
  }

  .ca-nav-button {
    min-height: 58px;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 5px 2px;
    font-size: 9px;
  }

  .ca-nav-icon {
    width: auto;
    font-size: 18px;
  }

  .ca-page {
    padding: 16px 18px 28px;
  }

  .ca-frame--battle .ca-page {
    padding: 12px 13px 20px;
  }
}

@media (max-width: 759px) {
  .ca-backdrop {
    padding: 0;
  }

  .ca-frame {
    width: 100%;
    height: 100dvh;
    grid-template:
      "header" auto
      "page" minmax(0, 1fr)
      "nav" auto /
      minmax(0, 1fr);
    border: 0;
    border-radius: 0;
  }

  .ca-header {
    min-height: 55px;
    padding:
      max(9px, env(safe-area-inset-top))
      max(12px, env(safe-area-inset-right))
      9px
      max(12px, env(safe-area-inset-left));
  }

  .ca-brand {
    min-width: 0;
  }

  .ca-brand strong {
    font-size: 17px;
  }

  .ca-brand span,
  .ca-date,
  .ca-header-button span {
    display: none;
  }

  .ca-navigation {
    flex-direction: row;
    padding:
      0
      max(3px, env(safe-area-inset-right))
      env(safe-area-inset-bottom)
      max(3px, env(safe-area-inset-left));
    overflow-x: auto;
    border-top: 1px solid rgba(212, 168, 67, 0.2);
    border-right: 0;
  }

  .ca-nav-button {
    min-width: 54px;
    min-height: 55px;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 5px 2px;
    border-top: 2px solid transparent;
    border-left: 0;
    font-size: 9px;
  }

  .ca-nav-button.active {
    border-top-color: var(--ca-gold);
    border-left-color: transparent;
  }

  .ca-nav-icon {
    width: auto;
    font-size: 16px;
  }

  .ca-page {
    padding:
      12px
      max(13px, env(safe-area-inset-right))
      24px
      max(13px, env(safe-area-inset-left));
    scrollbar-gutter: auto;
  }

  .ca-section {
    padding: 14px;
    border-radius: 11px;
  }

  .ca-section-title {
    font-size: 14px;
  }

  .ca-frame--battle .ca-page {
    padding:
      8px
      max(8px, env(safe-area-inset-right))
      15px
      max(8px, env(safe-area-inset-left));
  }
}

@media (max-width: 900px) and (max-height: 520px) and (orientation: landscape) {
  .ca-frame {
    grid-template:
      "header header" auto
      "nav page" minmax(0, 1fr) /
      64px minmax(0, 1fr);
  }

  .ca-header {
    min-height: 44px;
    padding-block: 5px;
  }

  .ca-navigation {
    flex-direction: column;
    padding: 3px 0;
    overflow-y: auto;
    border-top: 0;
    border-right: 1px solid rgba(212, 168, 67, 0.2);
  }

  .ca-nav-button {
    min-width: 0;
    min-height: 46px;
    flex: 0 0 auto;
    padding: 3px;
    border-top: 0;
    border-left: 2px solid transparent;
  }

  .ca-nav-button.active {
    border-top-color: transparent;
    border-left-color: var(--ca-gold);
  }

  .ca-page,
  .ca-frame--battle .ca-page {
    padding: 8px 10px 14px;
  }
}
</style>
