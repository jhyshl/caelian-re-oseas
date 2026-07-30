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
});
