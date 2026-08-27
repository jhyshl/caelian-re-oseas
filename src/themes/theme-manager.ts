import achievementsIcon from '@/assets/themes/tail-town/achievements.png';
import affinityIcon from '@/assets/themes/tail-town/affinity.png';
import battleIcon from '@/assets/themes/tail-town/battle.png';
import cardSquareIcon from '@/assets/themes/tail-town/card-square.png';
import characterIcon from '@/assets/themes/tail-town/character.png';
import craftingIcon from '@/assets/themes/tail-town/crafting.png';
import deckIcon from '@/assets/themes/tail-town/deck.png';
import feedbackIcon from '@/assets/themes/tail-town/feedback.png';
import guildIcon from '@/assets/themes/tail-town/guild.png';
import inventoryIcon from '@/assets/themes/tail-town/inventory.png';
import launcherBone from '@/assets/themes/tail-town/launcher-bone.png';
import mailboxIcon from '@/assets/themes/tail-town/mailbox.png';
import mapIcon from '@/assets/themes/tail-town/map.png';
import marketIcon from '@/assets/themes/tail-town/market.png';
import pawPattern from '@/assets/themes/tail-town/paw-pattern.webp';
import releaseNotesIcon from '@/assets/themes/tail-town/release-notes.png';
import settingsIcon from '@/assets/themes/tail-town/settings.png';
import surveysIcon from '@/assets/themes/tail-town/surveys.png';
import worldbookIcon from '@/assets/themes/tail-town/worldbook.png';
import type { PanelName } from '@/kernel/public-api';
import type {
  CaelianThemeId,
  CaelianThemeOption,
  CaelianThemeState,
} from '@/themes/types';

export const THEME_ENTITLEMENTS_EVENT =
  'caelian:theme-entitlements-changed';
export const TAIL_TOWN_THEME_ID = 'tail-town-dog' as const;

const THEME_BODY_CLASSES = ['caelian-theme-tail-town'] as const;
const TAIL_TOWN_ICON_URLS: Readonly<Partial<Record<PanelName, string>>> = {
  character: characterIcon,
  affinity: affinityIcon,
  deck: deckIcon,
  'card-square': cardSquareIcon,
  inventory: inventoryIcon,
  crafting: craftingIcon,
  guild: guildIcon,
  mailbox: mailboxIcon,
  market: marketIcon,
  map: mapIcon,
  worldbook: worldbookIcon,
  battle: battleIcon,
  achievements: achievementsIcon,
  settings: settingsIcon,
  feedback: feedbackIcon,
  surveys: surveysIcon,
  'release-notes': releaseNotesIcon,
};

const DEFAULT_THEME: CaelianThemeOption = {
  id: 'default',
  name: '欧西亚斯经典',
  description: '原版金紫冒险者界面。',
  badge: '默认',
  locked: false,
};

const TAIL_TOWN_THEME: CaelianThemeOption = {
  id: TAIL_TOWN_THEME_ID,
  name: '小狗主题',
  description: '尾巴镇专属的阳光、明媚与活泼风格。',
  badge: '尾巴镇专属',
  locked: true,
  previewUrl: launcherBone,
};

function entitlementIds(host: Window): Set<string> {
  const registry = host.__CaelianThemeEntitlements;
  if (Array.isArray(registry)) {
    return new Set(registry.filter((value): value is string =>
      typeof value === 'string',
    ));
  }
  if (!registry || typeof registry !== 'object') return new Set();
  const ids = Array.isArray(registry.ids) ? registry.ids : [];
  return new Set(ids.filter((value): value is string =>
    typeof value === 'string',
  ));
}

export function listAvailableThemes(host: Window): CaelianThemeOption[] {
  const tailTownUnlocked = entitlementIds(host).has(TAIL_TOWN_THEME_ID);
  return [
    { ...DEFAULT_THEME },
    { ...TAIL_TOWN_THEME, locked: !tailTownUnlocked },
  ];
}

export function themeIsAvailable(
  host: Window,
  theme: CaelianThemeId,
): boolean {
  return listAvailableThemes(host).some(
    (candidate) => candidate.id === theme && !candidate.locked,
  );
}

export function resolveAvailableTheme(
  host: Window,
  preferred: CaelianThemeId | undefined,
): CaelianThemeId {
  return preferred && themeIsAvailable(host, preferred)
    ? preferred
    : 'default';
}

function cssUrl(url: string): string {
  return `url("${url.replaceAll('"', '%22')}")`;
}

export function applyTheme(
  host: Window,
  preferred: CaelianThemeId | undefined,
): CaelianThemeState {
  const active = resolveAvailableTheme(host, preferred);
  const body = host.document.body;
  if (body) {
    body.classList.remove(...THEME_BODY_CLASSES);
    body.dataset.caelianTheme = active;
    if (active === TAIL_TOWN_THEME_ID) {
      body.classList.add('caelian-theme-tail-town');
      body.style.setProperty(
        '--ca-tail-town-launcher-image',
        cssUrl(launcherBone),
      );
      body.style.setProperty(
        '--ca-tail-town-paw-pattern',
        cssUrl(pawPattern),
      );
    } else {
      body.style.removeProperty('--ca-tail-town-launcher-image');
      body.style.removeProperty('--ca-tail-town-paw-pattern');
    }
  }
  return { active, available: listAvailableThemes(host) };
}

export function clearAppliedTheme(host: Window): void {
  const body = host.document.body;
  if (!body) return;
  body.classList.remove(...THEME_BODY_CLASSES);
  delete body.dataset.caelianTheme;
  body.style.removeProperty('--ca-tail-town-launcher-image');
  body.style.removeProperty('--ca-tail-town-paw-pattern');
}

export function themeMenuIconUrl(
  theme: CaelianThemeId,
  panel: PanelName,
): string | undefined {
  return theme === TAIL_TOWN_THEME_ID
    ? TAIL_TOWN_ICON_URLS[panel]
    : undefined;
}

export function subscribeThemeEntitlements(
  host: Window,
  handler: () => void,
): () => void {
  const listener = () => handler();
  host.addEventListener(THEME_ENTITLEMENTS_EVENT, listener);
  return () => host.removeEventListener(THEME_ENTITLEMENTS_EVENT, listener);
}
