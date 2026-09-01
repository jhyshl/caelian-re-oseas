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

  it('按 Journey 最终结构用单层九宫格承载完整底纹且菜单保留入口名称', async () => {
    const css = await readFile('src/styles/alpha.css', 'utf8');
    const heartCss = css.slice(css.indexOf('/* Caelian affinity 250 theme'));
    const themeManager = await readFile('src/themes/theme-manager.ts', 'utf8');
    expect(heartCss).toContain(
      'body.caelian-theme-heart .caelian-shell-host .wheel {',
    );
    expect(heartCss).toContain(
      'border-image-source: var(--ca-heart-menu-frame)',
    );
    expect(heartCss).toContain(
      'border-image-source: var(--ca-heart-section-frame)',
    );
    expect(heartCss).toContain('border-image-slice: 200 190 190 190 fill');
    expect(heartCss).toContain('border-image-slice: 116 100 fill');
    expect(heartCss).toContain('border-image-width: 28px 24px');
    expect(heartCss).toContain('border-image-width: 24px 20px');
    expect(heartCss).toContain('border-image-width: 40px');
    expect(heartCss).toContain('border-image-width: 32px');
    expect(heartCss).toContain('box-sizing: border-box');
    expect(heartCss).toContain('width: min(302px, calc(100vw - 16px))');
    expect(heartCss).toContain('width: min(286px, calc(100vw - 8px))');
    expect(heartCss).toContain('padding: 22px 20px 17px');
    expect(heartCss).toContain('padding: 19px 16px 14px');
    expect(heartCss).toContain('content: none');
    expect(heartCss).toContain('display: none');
    expect(heartCss).toContain('aspect-ratio: 8 / 9');
    expect(heartCss).toContain(
      'background: transparent var(--ca-heart-menu-cell) center / contain no-repeat',
    );
    expect(heartCss).toContain('width: 52px');
    expect(heartCss).toContain('width: 48px');
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
    expect(heartCss).toContain('border-image-outset: 0');
    expect(heartCss).not.toContain('var(--ca-heart-frame-center-gem)');
    expect(heartCss).toContain('background-color: transparent');
    expect(heartCss).toContain('background-image: none');
    expect(heartCss).not.toContain(
      'border-image-source: var(--ca-heart-menu-cell)',
    );
    expect(heartCss).not.toContain('rgba(248, 252, 255, 0.75)');
    expect(heartCss).not.toContain('rgba(255, 255, 255, 0.75)');
    expect(heartCss).not.toContain('rgba(242, 249, 255, 0.75)');
    expect(heartCss).not.toContain('rgba(250, 253, 255, 0.75)');
    expect(heartCss).not.toContain('background-size: 100% 100%');
    expect(themeManager).toContain(
      "import caelianHeartMenuCell from '@/assets/themes/caelian-heart/menu-cell.png'",
    );
    expect(themeManager).not.toContain(
      "import caelianHeartPattern from '@/assets/themes/caelian-heart/pattern.png'",
    );
    expect(themeManager).not.toContain("property: '--ca-heart-pattern'");
    expect(themeManager).not.toContain(
      "import caelianHeartFrameCenterGem from '@/assets/themes/caelian-heart/frame-center-gem.png'",
    );
    expect(themeManager).not.toContain(
      "property: '--ca-heart-frame-center-gem'",
    );

    const shell = await readFile('src/modules/shell/App.vue', 'utf8');
    expect(shell).toContain('<span>{{ item.label }}</span>');
  });

  it('浅色纸面使用深蓝字且筛选按钮有清晰选中态', async () => {
    const css = await readFile('src/styles/alpha.css', 'utf8');
    const heartCss = css.slice(css.indexOf('/* Caelian affinity 250 theme'));
    expect(heartCss).toContain('--ca-heart-ink: #173d69');
    expect(heartCss).toContain('.card-grid .card');
    expect(heartCss).toContain('.gathering-card');
    expect(heartCss).toContain('.boundary-grid article');
    expect(heartCss).toContain('.achievement-grid article');
    expect(heartCss).toContain('.letter-paper p');
    expect(heartCss).toContain('.filters,');
    expect(heartCss).toContain('.achievement-filters,');
    expect(heartCss).toContain('button.active');
    expect(heartCss).toContain('.region-row.on :is(');
    expect(heartCss).toContain(
      'background: linear-gradient(145deg, #347fc8, #1a559b)',
    );
  });
});
