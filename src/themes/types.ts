export const CAELIAN_THEME_IDS = [
  'default',
  'tail-town-dog',
  'journey-ticket',
] as const;

export type CaelianThemeId = (typeof CAELIAN_THEME_IDS)[number];

export interface CaelianThemeOption {
  id: CaelianThemeId;
  name: string;
  description: string;
  badge: string;
  locked: boolean;
  previewUrl?: string;
  unlockPrompt?: {
    badge: string;
    notice: string;
    title: string;
    description: string;
  };
}

export interface CaelianThemeState {
  active: CaelianThemeId;
  available: readonly CaelianThemeOption[];
}
