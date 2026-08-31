import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Gathering UI contract', () => {
  it('registers the gathering shortcut directly after the market shortcut', async () => {
    const shell = await readFile('src/modules/shell/App.vue', 'utf8');
    const market = "{ panel: 'market', icon: '¤', label: '集市' }";
    const gathering = "{ panel: 'gathering', icon: '♧', label: '采集' }";
    const map = "{ panel: 'map', icon: '⌖', label: '地图' }";

    expect(shell).toContain(gathering);
    expect(shell.indexOf(gathering)).toBeGreaterThan(shell.indexOf(market));
    expect(shell.indexOf(gathering)).toBeLessThan(shell.indexOf(map));
  });

  it('uses the standard panel frame and announces collection results accessibly', async () => {
    const component = await readFile(
      'src/modules/gathering/App.vue',
      'utf8',
    );

    expect(component).toContain('active="gathering"');
    expect(component).toContain('aria-live="assertive"');
    expect(component).toContain(':aria-live=');
    expect(component).toContain("query('gathering')");
    expect(component).toContain("type: 'gather.collect'");
  });

  it('keeps resource surfaces theme-driven without fixed dark or white fills', async () => {
    const component = await readFile(
      'src/modules/gathering/App.vue',
      'utf8',
    );

    for (const variable of [
      '--ca-surface',
      '--ca-surface-soft',
      '--ca-border',
      '--ca-text',
      '--ca-text-bright',
      '--ca-muted',
      '--ca-gold',
    ]) {
      expect(component).toContain(`var(${variable})`);
    }
    expect(component).not.toMatch(
      /background(?:-color)?\s*:\s*(?:#[\da-f]{3,8}|rgba?\()/i,
    );
  });

  it('switches to one column at 700px and keeps controls touch-sized', async () => {
    const component = await readFile(
      'src/modules/gathering/App.vue',
      'utf8',
    );

    expect(component).toMatch(
      /@media \(max-width: 700px\) \{[\s\S]*?\.gathering-grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(component).toMatch(
      /\.resource-action input \{[\s\S]*?min-height: 44px;/,
    );
    expect(component).toMatch(
      /\.resource-action \.ca-button \{[\s\S]*?min-height: 44px;/,
    );
  });
});
