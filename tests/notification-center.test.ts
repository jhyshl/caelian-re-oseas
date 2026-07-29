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
});
