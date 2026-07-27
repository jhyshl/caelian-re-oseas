import { describe, expect, it, vi } from 'vitest';
import type { AiProjection } from '@/domain/types';
import { TavernAdapter } from '@/tavern/adapter';

describe('TavernAdapter', () => {
  it('只替换 stat_data.caelian，并保留其他 MVU 数据', async () => {
    const replaceMvuData = vi.fn();
    window.Mvu = {
      getMvuData: () => ({
        stat_data: {
          existing_system: { keep: true },
        },
        unrelated: 'preserved',
      }),
      replaceMvuData,
    };
    const adapter = new TavernAdapter(window);
    const projection: AiProjection = {
      schemaVersion: 1,
      channel: 'alpha',
      revision: 1,
      player: {
        name: '测试者',
        className: '未选择',
        subclass: '',
        level: 1,
      },
      world: {
        region: '圣德里安学院',
        location: '中央广场',
        gameDate: '',
        storyFlags: [],
      },
      guild: { activeQuests: [] },
      battle: { active: false },
    };

    await expect(adapter.writeProjection(projection)).resolves.toBe(true);
    expect(replaceMvuData).toHaveBeenCalledTimes(1);
    const next = replaceMvuData.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(next.unrelated).toBe('preserved');
    expect(next.stat_data).toEqual({
      existing_system: { keep: true },
      caelian: projection,
    });

    delete window.Mvu;
  });
});
