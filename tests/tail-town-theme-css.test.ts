import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Tail Town theme coverage', () => {
  it('covers every standalone surface that previously kept the dark theme', async () => {
    const css = await readFile('src/styles/alpha.css', 'utf8');

    for (const selector of [
      '.mail-layout',
      '.market-grid article',
      '.worldbook-floater',
      '.feedback-dialog',
      '.survey-dialog',
      '.release-dialog',
    ]) {
      expect(css).toContain(selector);
    }

    expect(css).toContain(
      'linear-gradient(rgba(255, 248, 233, 0.7), rgba(255, 248, 233, 0.7))',
    );
    expect(css).toContain('var(--ca-tail-town-paw-pattern)');
  });
});
