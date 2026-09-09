import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from '@/kernel/create-kernel';
import { MessageUpdateBatch } from '@/kernel/message-update-batch';
import { TavernAdapter } from '@/tavern/adapter';
import type { TavernEventPayload } from '@/tavern/adapter';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.classList.remove('caelian-generating');
});

describe('正文输出开销', () => {
  it('正文连续渲染不会搜索信件，晚插入的旧玩家信件仍正常检测', async () => {
    const adapter = new TavernAdapter(window);
    const changed = vi.fn();
    const chat = document.createElement('div');
    chat.id = 'chat';
    const output = document.createElement('div');
    chat.append(output);
    document.body.append(chat);
    adapter.subscribe(changed);
    const search = vi.spyOn(document, 'querySelector');
    for (let index = 0; index < 100; index++) {
      output.innerHTML = `<p>正文第 ${index} 次更新</p>`;
      await Promise.resolve();
    }
    const selector = '#caelian_special_patch_old_player_v2_letter_overlay';
    expect(search.mock.calls.filter(([value]) => value === selector)).toHaveLength(0);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<div id="${selector.slice(1)}"></div>`;
    document.body.append(wrapper);
    await Promise.resolve();
    expect(changed).toHaveBeenCalledWith('ACHIEVEMENT_PATCH_CHANGED');
    adapter.unsubscribeAll();
    chat.remove();
    wrapper.remove();
  });

  it('合并同一楼层的被动通知，同时保留其他楼层和事件边界', () => {
    const batch = new MessageUpdateBatch();
    const first = batch.add('MESSAGE_UPDATED', { messageId: 3 })!;
    expect(batch.add('CHARACTER_MESSAGE_RENDERED', { messageId: 3 })).toBeNull();
    expect(batch.add('MESSAGE_RECEIVED', { messageId: 3 })).toBeNull();
    expect(first.eventName).toBe('MESSAGE_RECEIVED');
    expect(batch.add('MESSAGE_UPDATED', { messageId: 4 })).not.toBeNull();
    expect(batch.accepts('MESSAGE_EDITED')).toBe(false);
    batch.clear();
    const next = batch.add('MESSAGE_UPDATED', { messageId: 3 });
    batch.take(first);
    expect(batch.add('MESSAGE_UPDATED', { messageId: 3 })).toBeNull();
    expect(next).not.toBe(first);
  });

  it('生成期间跳过全量扫描、保留剧情战斗入口，停止后补齐同步', async () => {
    const kernel = createKernel({
      channel: 'alpha', version: '0.2.0-alpha.test', buildId: 'performance-events',
      databaseName: `performance-events-${crypto.randomUUID()}`, sourceWindow: window,
    });
    const internal = kernel as unknown as {
      status: string;
      projectionWriteInProgress: boolean;
      queueTavernUpdate: (event: string, payload?: TavernEventPayload) => void;
      pendingTavernUpdates: Set<Promise<void>>;
      reconcileQuestFloors: () => Promise<void>;
      ingestMvuNarrative: () => Promise<boolean>;
      syncQuestContext: () => Promise<boolean>;
      scanCurrentAchievements: () => Promise<void>;
      triggerStoryBattle: () => Promise<void>;
      retryPendingAffinityProjection: () => Promise<boolean>;
      panels: { closeAll: () => Promise<void> };
    };
    internal.status = 'ready';
    const reconcile = vi.spyOn(internal, 'reconcileQuestFloors').mockResolvedValue();
    vi.spyOn(internal, 'ingestMvuNarrative').mockResolvedValue(false);
    const context = vi.spyOn(internal, 'syncQuestContext').mockResolvedValue(true);
    const scan = vi.spyOn(internal, 'scanCurrentAchievements').mockResolvedValue();
    const battle = vi.spyOn(internal, 'triggerStoryBattle').mockResolvedValue();
    vi.spyOn(internal, 'retryPendingAffinityProjection').mockResolvedValue(false);
    const projection = vi.spyOn(kernel, 'syncProjection').mockResolvedValue(true);
    const drain = () => Promise.all([...internal.pendingTavernUpdates]);
    internal.queueTavernUpdate('GENERATION_STARTED');
    expect(document.body.classList.contains('caelian-generating')).toBe(true);
    await drain();
    expect(context).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 100; index++) {
      internal.queueTavernUpdate('MESSAGE_UPDATED', { messageId: 3 });
    }
    internal.queueTavernUpdate('CHARACTER_MESSAGE_RENDERED', { messageId: 3 });
    expect(internal.pendingTavernUpdates.size).toBe(1);
    await drain();
    expect(battle).toHaveBeenCalledTimes(1);
    expect(reconcile).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
    expect(projection).not.toHaveBeenCalled();
    internal.queueTavernUpdate('GENERATION_STOPPED');
    await drain();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(projection).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('caelian-generating')).toBe(false);
    internal.projectionWriteInProgress = true;
    internal.queueTavernUpdate('MESSAGE_UPDATED', { messageId: 3 });
    internal.projectionWriteInProgress = false;
    expect(internal.pendingTavernUpdates.size).toBe(0);
    await internal.panels.closeAll();
  });
});
