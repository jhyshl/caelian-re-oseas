import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationCenter } from '@/notifications/notification-center';

let center: NotificationCenter | undefined;

afterEach(() => {
  center?.destroy();
  center = undefined;
  document
    .querySelectorAll('[data-caelian-notification-center]')
    .forEach((element) => element.remove());
});

describe('NotificationCenter', () => {
  it('显示旧版语义的美化成就通知，并支持点击进入对应功能', async () => {
    const onClick = vi.fn();
    center = new NotificationCenter(document);
    center.show({
      kind: 'achievement',
      icon: '♛',
      title: '荣耀一路同行',
      description: '直到永远，永远',
      meta: '★★★★★',
      onClick,
    });

    await expect
      .poll(
        () =>
          document.querySelector<HTMLElement>(
            '.notification-toast.achievement',
          )?.textContent,
      )
      .toContain('荣耀一路同行');
    const toast = document.querySelector<HTMLElement>(
      '.notification-toast.achievement',
    );
    toast?.click();

    await expect.poll(() => onClick.mock.calls.length).toBe(1);
  });

  it('使用统一美化确认框代替浏览器原生 confirm', async () => {
    center = new NotificationCenter(document);
    const response = center.confirm({
      title: '确认从战斗中撤退？',
      description: '撤退会损失当前生命与一部分金币。',
      confirmText: '确认撤退',
      cancelText: '继续战斗',
      tone: 'danger',
    });

    await expect
      .poll(
        () =>
          document.querySelector<HTMLElement>('.confirm-dialog.danger')
            ?.textContent,
      )
      .toContain('确认从战斗中撤退');
    document
      .querySelector<HTMLButtonElement>('.confirm-actions .confirm')
      ?.click();

    await expect(response).resolves.toBe(true);
  });

  it('高优先级剧情提示不会被四条普通通知长时间挡在队列里', async () => {
    center = new NotificationCenter(document);
    for (let index = 0; index < 4; index += 1) {
      center.show({ kind: 'achievement', title: `普通通知 ${index}` });
    }
    center.show({
      kind: 'warning',
      title: '剧情推进器尚未启用',
      priority: 94,
    });

    await expect
      .poll(() => document.body.textContent)
      .toContain('剧情推进器尚未启用');
  });

  it('为进行中的副 API 判定显示独立终止按钮', async () => {
    const onClick = vi.fn();
    center = new NotificationCenter(document);
    center.show({
      kind: 'task',
      title: '正在推进剧情',
      actionText: '终止副 API',
      onClick,
    });

    await expect
      .poll(
        () =>
          document.querySelector<HTMLButtonElement>('.notification-action')
            ?.textContent,
      )
      .toContain('终止副 API');
    document
      .querySelector<HTMLButtonElement>('.notification-action')
      ?.click();
    await expect.poll(() => onClick.mock.calls.length).toBe(1);
  });

  it('显示常驻剧情引导卡，并把完整引导填入输入框但不自动发送', async () => {
    const onInject = vi.fn(() => true);
    center = new NotificationCenter(document);
    center.showQuestGuidance({
      questName: '芙萝拉说',
      status: '已推进一个节拍',
      stageTitle: '相遇',
      sceneTitle: '中央商业区',
      beatTitle: '卖花少女',
      summary: '玩家答应帮助芙萝拉。',
      objective: '帮助芙萝拉卖完鲜花。',
      hint: '围绕卖花行动推进当前节拍。',
      clues: ['可以购买花束', '也可以帮忙吆喝'],
      injectText: '我选择继续推进任务「芙萝拉说」。',
      onInject,
    });

    await expect
      .poll(
        () =>
          document.querySelector<HTMLElement>(
            '[data-caelian-quest-guidance]',
          )?.textContent,
      )
      .toContain('帮助芙萝拉卖完鲜花');
    document
      .querySelector<HTMLButtonElement>('.quest-guidance footer button')
      ?.click();

    expect(onInject).toHaveBeenCalledOnce();
    await expect
      .poll(
        () =>
          document.querySelector<HTMLElement>(
            '[data-caelian-quest-guidance]',
          )?.textContent,
      )
      .toContain('已填入输入框');

    document
      .querySelector<HTMLButtonElement>('.quest-guidance-close')
      ?.click();
    await expect
      .poll(() =>
        document.querySelector('[data-caelian-quest-guidance]'),
      )
      .toBeNull();
  });
});
