import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { PanelName } from '@/kernel/public-api';
import {
  CAELIAN_HEART_AFFINITY_THRESHOLD,
  CAELIAN_HEART_THEME_ID,
  listAvailableThemes,
  themeMenuIconAsset,
} from '@/themes/theme-manager';

const launcherPanels: PanelName[] = [
  'character',
  'affinity',
  'deck',
  'card-square',
  'inventory',
  'crafting',
  'guild',
  'mailbox',
  'market',
  'gathering',
  'map',
  'worldbook',
  'battle',
  'achievements',
  'settings',
  'feedback',
  'surveys',
  'release-notes',
];

describe('心动主题资源与解锁合同', () => {
  it('只接受永久解锁标志且保留 250 好感度门槛文案', () => {
    expect(CAELIAN_HEART_AFFINITY_THRESHOLD).toBe(250);
    expect(
      listAvailableThemes(window).find(
        (theme) => theme.id === CAELIAN_HEART_THEME_ID,
      ),
    ).toMatchObject({
      name: '心动主题',
      locked: true,
      unlockPrompt: {
        badge: '好感度 250 解锁',
      },
    });
    expect(
      listAvailableThemes(window, {
        caelianHeartThemeUnlocked: true,
      }).find((theme) => theme.id === CAELIAN_HEART_THEME_ID),
    ).toMatchObject({ locked: false });
  });

  it('为全部快捷入口提供独立透明人物图标并让诊断复用反馈', () => {
    for (const panel of launcherPanels) {
      expect(
        themeMenuIconAsset(window, CAELIAN_HEART_THEME_ID, panel)?.url,
      ).toBeTruthy();
    }
    expect(
      themeMenuIconAsset(window, CAELIAN_HEART_THEME_ID, 'diagnostics')?.url,
    ).toBe(
      themeMenuIconAsset(window, CAELIAN_HEART_THEME_ID, 'feedback')?.url,
    );
  });

  it('人物、主题框架与启动器均为带 alpha 通道的 PNG', async () => {
    const transparentAssets = [
      'launcher-main.png',
      'launcher-stub.png',
      'menu-frame.png',
      'menu-cell.png',
      'section-frame.png',
      ...launcherPanels.map((panel) => `icons/${panel}.png`),
    ];
    for (const asset of transparentAssets) {
      const png = await readFile(`src/assets/themes/caelian-heart/${asset}`);
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(png[25]).toBe(6);
    }
    const pattern = await readFile(
      'src/assets/themes/caelian-heart/pattern.png',
    );
    expect(pattern.subarray(1, 4).toString('ascii')).toBe('PNG');
    const sectionFrame = await readFile(
      'src/assets/themes/caelian-heart/section-frame.png',
    );
    expect([
      sectionFrame.readUInt32BE(16),
      sectionFrame.readUInt32BE(20),
    ]).toEqual([712, 560]);
  });

  it('所有主题边框使用 Journey 同类九宫格切片且菜单保留入口名称', async () => {
    const css = await readFile('src/styles/alpha.css', 'utf8');
    const heartCss = css.slice(css.indexOf('/* Caelian affinity 250 theme'));
    expect(heartCss).toContain(
      'body.caelian-theme-heart .caelian-shell-host .wheel {',
    );
    expect(heartCss).toContain(
      'border-image-source: var(--ca-heart-menu-frame)',
    );
    expect(heartCss).toContain(
      'border-image-source: var(--ca-heart-menu-cell)',
    );
    expect(heartCss).toContain(
      'border-image-source: var(--ca-heart-section-frame)',
    );
    expect(heartCss).toContain('border-image-slice: 112 128 fill');
    expect(heartCss).toContain('border-image-slice: 108 92 fill');
    expect(heartCss).toContain('border-image-slice: 64 84 fill');
    expect(heartCss).not.toContain('background-size: 100% 100%');

    const shell = await readFile('src/modules/shell/App.vue', 'utf8');
    expect(shell).toContain('<span>{{ item.label }}</span>');
  });
});
