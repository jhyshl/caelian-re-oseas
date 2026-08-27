export const CAELIAN_THEME_IDS = ['default', 'tail-town-dog'] as const;

export type CaelianThemeId = (typeof CAELIAN_THEME_IDS)[number];

export interface CaelianThemeOption {
  id: CaelianThemeId;
  name: string;
  description: string;
  badge: string;
  locked: boolean;
  previewUrl?: string;
}

export interface CaelianThemeState {
  active: CaelianThemeId;
  available: readonly CaelianThemeOption[];
}
