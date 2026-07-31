import { afterEach, describe, expect, it } from 'vitest';
import {
  avatarPreferenceKey,
  normalizeAvatarPreference,
  readAvatarPreference,
  resetAvatarPreference,
  writeAvatarPreference,
} from '@/ui/avatar-preferences';

afterEach(() => localStorage.clear());

describe('头像显示偏好', () => {
  it('限制缩放与位置范围并按头像分别保存', () => {
    expect(
      normalizeAvatarPreference({ zoom: 9, x: -20, y: 120 }),
    ).toEqual({ zoom: 3, x: 0, y: 100 });

    writeAvatarPreference('player', { zoom: 1.5, x: 35, y: 64 });
    expect(readAvatarPreference('player')).toEqual({
      zoom: 1.5,
      x: 35,
      y: 64,
    });
    expect(localStorage.getItem(avatarPreferenceKey('caelian'))).toBeNull();

    expect(resetAvatarPreference('player')).toEqual({
      zoom: 1,
      x: 50,
      y: 50,
    });
  });

  it('可明确保存到酒馆父窗口提供的本地存储', () => {
    const values = new Map<string, string>();
    const hostStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };

    writeAvatarPreference(
      'caelian',
      { zoom: 2.2, x: 18, y: 82 },
      hostStorage,
    );

    expect(readAvatarPreference('caelian', hostStorage)).toEqual({
      zoom: 2.2,
      x: 18,
      y: 82,
    });
    expect(localStorage.getItem(avatarPreferenceKey('caelian'))).toBeNull();
  });
});
