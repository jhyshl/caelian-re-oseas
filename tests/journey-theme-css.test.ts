import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Journey theme coverage', () => {
  it('uses separate full-ticket and validated-stub launcher states', async () => {
    const css = await readFile('src/styles/alpha.css', 'utf8');

    expect(css).toContain('var(--ca-journey-launcher-ticket)');
    expect(css).toContain(
      '.caelian-shell-host .shell.expanded .orb',
    );
    expect(css).toContain('var(--ca-journey-launcher-stub)');
    expect(css).toContain('var(--ca-journey-pattern)');
    expect(css).toContain('var(--ca-journey-menu-frame)');
    expect(css).toContain('var(--ca-journey-menu-cell)');
    expect(css).toContain('var(--ca-journey-section-frame)');
    expect(css).toContain('--ca-bg: #061321');
    expect(css).toContain('.caelian-shell-host .wheel::before');
    expect(css).toContain('border-image-slice: 88 96 fill');
    expect(css).toContain('border-image-slice: 92 fill');
    expect(css).toContain('border-image-slice: 74 80 fill');
    expect(css).toContain('backdrop-filter: none');
    expect(css).toContain(
      '.caelian-shell-host.caelian-page-panel-open .shell',
    );
    expect(css).not.toContain(
      'body.caelian-theme-journey:has(.caelian-panel-host .ca-frame)',
    );
    expect(css).toContain('.guild-card .rank-panel');
    expect(css).toContain('.crafting-layout > .ca-section + .ca-section');
    expect(css).not.toContain('.enemy-card');
    expect(css).not.toContain('.fan-card');
    expect(css).not.toContain('.consumable-card');

    const sectionAssetSelectors = Array.from(
      css.matchAll(/([^{}]+)\{[^{}]*var\(--ca-journey-section-frame\)/g),
      (match) => match[1],
    ).join('\n');
    expect(sectionAssetSelectors).not.toContain('.market-grid article');
    expect(sectionAssetSelectors).not.toContain('.sell-list article');
    expect(css).toMatch(
      /@media \(max-width: 759px\)[\s\S]*?\.caelian-panel-host \.ca-frame \{[\s\S]*?border-image-slice: 88 96 fill/,
    );
  });

  it('covers standalone surfaces, both viewport layouts and painted raster assets', async () => {
    const css = await readFile('src/styles/alpha.css', 'utf8');

    for (const selector of [
      '.mail-layout',
      '.market-grid article',
      '.worldbook-floater',
      '.feedback-dialog',
      '.survey-dialog',
      '.release-dialog',
      '@media (max-width: 759px)',
    ]) {
      expect(css).toContain(selector);
    }

    const manager = await readFile('src/themes/theme-manager.ts', 'utf8');
    expect(manager).toContain("id: JOURNEY_THEME_ID");
    for (const asset of [
      'icons-rgba/character.png',
      'icons-rgba/affinity.png',
      'icons-rgba/deck.png',
      'icons-rgba/inventory.png',
      'icons-rgba/guild.png',
      'icons-rgba/settings.png',
      'menu-frame-alpha.png',
      'menu-cell-alpha.png',
      'section-frame-alpha.png',
    ]) {
      expect(manager).toContain(`assets/themes/journey/${asset}`);
    }
    expect(manager).not.toContain('menu-icons-page-1.png');
    expect(manager).not.toContain('menu-icons-page-2.png');
    expect(manager).not.toContain('menu-icons-page-3.png');
    expect(manager).not.toContain('ticket-frame.svg');
    expect(manager).not.toContain('ticket-cell.svg');
    expect(manager).not.toContain('assets/themes/journey/items/');
    expect(manager).not.toContain('assets/themes/journey/cards/');
    expect(manager).not.toContain('assets/themes/journey/monsters/');
  });

  it('ships true-alpha PNG launchers, frames and menu icons', async () => {
    for (const asset of [
      'src/assets/themes/journey/launcher-ticket-transparent.png',
      'src/assets/themes/journey/launcher-stub-transparent.png',
      'src/assets/themes/journey/menu-frame-alpha.png',
      'src/assets/themes/journey/menu-cell-alpha.png',
      'src/assets/themes/journey/section-frame-alpha.png',
      'src/assets/themes/journey/icons-rgba/character.png',
      'src/assets/themes/journey/icons-rgba/affinity.png',
      'src/assets/themes/journey/icons-rgba/deck.png',
    ]) {
      const png = await readFile(asset);
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(png[25]).toBe(6);
    }
  });

  it('keeps the worldbook quick switcher inside the Journey frame', async () => {
    const css = await readFile('src/styles/alpha.css', 'utf8');
    const component = await readFile('src/modules/worldbook/App.vue', 'utf8');
    const genericFrameRules = css.lastIndexOf(
      '/* Journey final fit pass: keep painted paper inside the real ticket silhouette. */',
    );
    const worldbookFitRules = css.lastIndexOf(
      '/* Journey worldbook final fit: keep controls inside the painted frame at every row count. */',
    );

    expect(worldbookFitRules).toBeGreaterThan(genericFrameRules);
    const fit = css.slice(worldbookFitRules);
    expect(fit).toContain('--ca-journey-worldbook-frame-inset: 28px');
    expect(fit).toContain('--ca-journey-worldbook-frame-inset: 18px');
    expect(fit).toContain(
      'border-image-width: var(--ca-journey-worldbook-frame-inset) !important',
    );
    expect(fit).toContain('grid-template-columns: minmax(0, 1fr) !important');
    expect(fit).toContain('min-height: 0 !important');
    expect(fit).toContain('background: transparent !important');
    expect(fit).toContain('align-content: start !important');
    expect(fit).toContain('grid-auto-rows: max-content !important');
    expect(fit).toContain(
      'grid-template-columns: minmax(0, 1fr) auto !important',
    );
    expect(fit).toContain('white-space: nowrap !important');
    expect(fit).toContain('overflow-wrap: anywhere !important');
    expect(fit).toContain('env(safe-area-inset-top, 0px)');
    expect(fit).toContain('env(safe-area-inset-right, 0px)');
    expect(fit).toContain('env(safe-area-inset-bottom, 0px)');
    expect(fit).toContain('env(safe-area-inset-left, 0px)');
    expect(fit).toContain('100dvh - var(--ca-journey-worldbook-top)');

    for (const className of [
      'worldbook-header',
      'worldbook-heading',
      'worldbook-close',
      'region-row',
      'region-copy',
      'region-action',
      'worldbook-footer',
    ]) {
      expect(component).toContain(className);
    }
  });
});
