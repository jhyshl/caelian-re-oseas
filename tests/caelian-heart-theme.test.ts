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
      'launcher-frame.png',
      'launcher-preview.png',
      'menu-frame.png',
      'menu-frame-9slice.png',
      'frame-center-gem.png',
      'menu-cell.png',
      'menu-cell-9slice.png',
      'section-frame.png',
      'section-frame-9slice.png',
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
    const expectedDimensions: Record<string, readonly [number, number]> = {
      'launcher-frame.png': [512, 640],
      'launcher-preview.png': [512, 640],
      'menu-frame-9slice.png': [1024, 640],
      'frame-center-gem.png': [512, 156],
      'menu-cell-9slice.png': [1024, 640],
      'section-frame-9slice.png': [712, 560],
    };
    for (const [asset, dimensions] of Object.entries(expectedDimensions)) {
      const png = await readFile(`src/assets/themes/caelian-heart/${asset}`);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(dimensions);
    }
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
    expect(heartCss).toContain('border-image-slice: 200 190 190 190 fill');
    expect(heartCss).toContain('border-image-slice: 116 100 fill');
    expect(heartCss).toContain('border-image-width: 28px 24px');
    expect(heartCss).toContain('border-image-width: 24px 20px');
    expect(heartCss).toContain('border-image-width: 17px');
    expect(heartCss).toContain('border-image-width: 15px');
    expect(heartCss).toContain('border-image-width: 40px');
    expect(heartCss).toContain('border-image-width: 32px');
    expect(heartCss).toContain(
      'linear-gradient(rgba(248, 252, 255, 0.75), rgba(239, 248, 255, 0.75))',
    );
    expect(heartCss).toContain(
      'linear-gradient(rgba(255, 255, 255, 0.75), rgba(237, 247, 255, 0.75))',
    );
    expect(heartCss).toContain(
      'linear-gradient(rgba(242, 249, 255, 0.75), rgba(225, 240, 252, 0.75))',
    );
    expect(heartCss).toContain(
      'linear-gradient(rgba(250, 253, 255, 0.75), rgba(244, 250, 255, 0.75))',
    );
    expect(heartCss).toContain('inset: 12px');
    expect(heartCss).toContain('inset: 10px');
    expect(heartCss).toContain('padding: 28px 24px 22px');
    expect(heartCss).toContain('padding: 24px 20px 20px');
    expect(heartCss).toContain('width: min(320px, calc(100vw - 16px))');
    expect(heartCss).toContain('width: min(306px, calc(100vw - 8px))');
    expect(heartCss).toContain('min-height: 94px');
    expect(heartCss).toContain('min-height: 90px');
    expect(heartCss).toContain('inset: -23px');
    expect(heartCss).toContain('inset: -17px');
    expect(heartCss).toContain('top: -35px');
    expect(heartCss).toContain('bottom: -35px');
    expect(heartCss).toContain('top: -20px');
    expect(heartCss).toContain('bottom: -20px');
    expect(heartCss).toContain('.ca-section.ca-section');
    expect(heartCss).toContain('grid-template-columns: 58px minmax(0, 1fr)');
    expect(heartCss).toContain(
      'background: transparent var(--ca-heart-launcher-frame) center / contain no-repeat',
    );
    expect(heartCss).toContain(
      'background: transparent var(--ca-heart-launcher-main) center / contain no-repeat',
    );
    expect(heartCss).toContain(
      'background-image: var(--ca-heart-launcher-stub)',
    );
    expect(heartCss).toContain('var(--ca-heart-frame-center-gem)');
    expect(heartCss).toContain('border-image-outset: 14px');
    expect(heartCss).toContain('z-index: 3');
    expect(heartCss).not.toContain('background-size: 100% 100%');

    const shell = await readFile('src/modules/shell/App.vue', 'utf8');
    expect(shell).toContain('<span>{{ item.label }}</span>');
  });
});
