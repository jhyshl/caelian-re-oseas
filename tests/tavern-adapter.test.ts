import { describe, expect, it, vi } from 'vitest';
import type { AiProjection } from '@/domain/types';
import { resolveTavernHost, TavernAdapter } from '@/tavern/adapter';

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
      schemaVersion: 2,
      channel: 'alpha',
      revision: 1,
      player: {
        name: '测试者',
        profession: '炼金术士',
        level: 1,
        hp: 80,
        hpMax: 80,
        mp: 30,
        mpMax: 30,
        gold: 500,
      },
      world: {
        region: '圣德里安学院',
        location: '中央广场',
        gameDate: '',
        gameTime: '',
        weather: '',
        mainStage: 0,
        mainStep: 0,
      },
      guild: { rank: 'copper', activeQuests: [] },
      battle: {
        active: false,
        source: '',
        relatedQuestId: '',
        turn: 0,
      },
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

  it('把行动文字写入酒馆输入框并派发输入事件', () => {
    const textarea = document.createElement('textarea');
    textarea.id = 'send_textarea';
    const input = vi.fn();
    textarea.addEventListener('input', input);
    document.body.appendChild(textarea);

    const adapter = new TavernAdapter(window);
    expect(adapter.setUserInput('前往伊拉亚城')).toBe(true);
    expect(textarea.value).toBe('前往伊拉亚城');
    expect(input).toHaveBeenCalledTimes(1);

    textarea.remove();
  });

  it('普通 iframe 不会因为父窗口可访问就被误判为酒馆宿主', () => {
    const standalone = {
      parent: window,
    } as unknown as Window;

    expect(resolveTavernHost(standalone)).toBe(standalone);
  });
});
