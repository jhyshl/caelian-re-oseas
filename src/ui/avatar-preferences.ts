export interface AvatarViewPreference {
  zoom: number;
  x: number;
  y: number;
}

const DEFAULT_PREFERENCE: AvatarViewPreference = {
  zoom: 1,
  x: 50,
  y: 50,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeAvatarPreference(
  value?: Partial<AvatarViewPreference>,
): AvatarViewPreference {
  return {
    zoom: clamp(Number(value?.zoom) || DEFAULT_PREFERENCE.zoom, 1, 3),
    x: clamp(Number.isFinite(Number(value?.x)) ? Number(value?.x) : 50, 0, 100),
    y: clamp(Number.isFinite(Number(value?.y)) ? Number(value?.y) : 50, 0, 100),
  };
}

export function avatarPreferenceKey(preferenceId: string): string {
  return `caelian:avatar-view:v1:${preferenceId}`;
}

export function readAvatarPreference(
  preferenceId: string,
): AvatarViewPreference {
  try {
    const stored = localStorage.getItem(avatarPreferenceKey(preferenceId));
    if (!stored) return { ...DEFAULT_PREFERENCE };
    return normalizeAvatarPreference(
      JSON.parse(stored) as Partial<AvatarViewPreference>,
    );
  } catch {
    return { ...DEFAULT_PREFERENCE };
  }
}

export function writeAvatarPreference(
  preferenceId: string,
  preference: AvatarViewPreference,
): AvatarViewPreference {
  const normalized = normalizeAvatarPreference(preference);
  try {
    localStorage.setItem(
      avatarPreferenceKey(preferenceId),
      JSON.stringify(normalized),
    );
  } catch {
    // The preview still works when browser storage is unavailable.
  }
  return normalized;
}

export function resetAvatarPreference(
  preferenceId: string,
): AvatarViewPreference {
  try {
    localStorage.removeItem(avatarPreferenceKey(preferenceId));
  } catch {
    // Ignore restricted browser storage.
  }
  return { ...DEFAULT_PREFERENCE };
}
