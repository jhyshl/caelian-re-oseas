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
import journeyPattern from '@/assets/themes/journey/journey-pattern-v2.png';
import journeyTicket from '@/assets/themes/journey/launcher-ticket-transparent.png';
import journeyTicketStub from '@/assets/themes/journey/launcher-stub-transparent.png';
import journeyMenuCell from '@/assets/themes/journey/menu-cell-alpha.png';
import journeyMenuFrame from '@/assets/themes/journey/menu-frame-alpha.png';
import journeyAchievementsIcon from '@/assets/themes/journey/icons-rgba/achievements.png';
import journeyAffinityIcon from '@/assets/themes/journey/icons-rgba/affinity.png';
import journeyBattleIcon from '@/assets/themes/journey/icons-rgba/battle.png';
import journeyCardSquareIcon from '@/assets/themes/journey/icons-rgba/card-square.png';
import journeyCharacterIcon from '@/assets/themes/journey/icons-rgba/character.png';
import journeyCraftingIcon from '@/assets/themes/journey/icons-rgba/crafting.png';
import journeyDeckIcon from '@/assets/themes/journey/icons-rgba/deck.png';
import journeyFeedbackIcon from '@/assets/themes/journey/icons-rgba/feedback.png';
import journeyGuildIcon from '@/assets/themes/journey/icons-rgba/guild.png';
import journeyInventoryIcon from '@/assets/themes/journey/icons-rgba/inventory.png';
import journeyMailboxIcon from '@/assets/themes/journey/icons-rgba/mailbox.png';
import journeyMapIcon from '@/assets/themes/journey/icons-rgba/map.png';
import journeyMarketIcon from '@/assets/themes/journey/icons-rgba/market.png';
import journeyReleaseNotesIcon from '@/assets/themes/journey/icons-rgba/release-notes.png';
import journeySettingsIcon from '@/assets/themes/journey/icons-rgba/settings.png';
import journeySurveysIcon from '@/assets/themes/journey/icons-rgba/surveys.png';
import journeyWorldbookIcon from '@/assets/themes/journey/icons-rgba/worldbook.png';
import journeySectionFrame from '@/assets/themes/journey/section-frame-alpha.png';
import {
  loadLocalAssetUrl,
  resolvedLocalAssetUrl,
} from '@/assets/local-asset-cache';
import type { PanelName } from '@/kernel/public-api';
import type {
  CaelianThemeId,
  CaelianThemeOption,
  CaelianThemeState,
} from '@/themes/types';

export const THEME_ENTITLEMENTS_EVENT =
  'caelian:theme-entitlements-changed';
export const THEME_ASSETS_EVENT = 'caelian:theme-assets-changed';
export const TAIL_TOWN_THEME_ID = 'tail-town-dog' as const;
export const JOURNEY_THEME_ID = 'journey-ticket' as const;

const THEME_BODY_CLASSES = [
  'caelian-theme-tail-town',
  'caelian-theme-journey',
] as const;
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
interface ThemeMenuIconAsset {
  position?: string;
  url: string;
}

const JOURNEY_ICON_ASSETS: Readonly<
  Partial<Record<PanelName, ThemeMenuIconAsset>>
> = {
  character: { url: journeyCharacterIcon },
  affinity: { url: journeyAffinityIcon },
  deck: { url: journeyDeckIcon },
  'card-square': { url: journeyCardSquareIcon },
  inventory: { url: journeyInventoryIcon },
  crafting: { url: journeyCraftingIcon },
  guild: { url: journeyGuildIcon },
  mailbox: { url: journeyMailboxIcon },
  market: { url: journeyMarketIcon },
  map: { url: journeyMapIcon },
  worldbook: { url: journeyWorldbookIcon },
  battle: { url: journeyBattleIcon },
  achievements: { url: journeyAchievementsIcon },
  settings: { url: journeySettingsIcon },
  feedback: { url: journeyFeedbackIcon },
  diagnostics: { url: journeyFeedbackIcon },
  surveys: { url: journeySurveysIcon },
  'release-notes': { url: journeyReleaseNotesIcon },
};

interface ThemeCssAsset {
  property: string;
  sourceUrl: string;
}

const TAIL_TOWN_CSS_ASSETS: readonly ThemeCssAsset[] = [
  { property: '--ca-tail-town-launcher-image', sourceUrl: launcherBone },
  { property: '--ca-tail-town-paw-pattern', sourceUrl: pawPattern },
];

const JOURNEY_CSS_ASSETS: readonly ThemeCssAsset[] = [
  { property: '--ca-journey-launcher-ticket', sourceUrl: journeyTicket },
  { property: '--ca-journey-launcher-stub', sourceUrl: journeyTicketStub },
  { property: '--ca-journey-pattern', sourceUrl: journeyPattern },
  { property: '--ca-journey-menu-frame', sourceUrl: journeyMenuFrame },
  { property: '--ca-journey-menu-cell', sourceUrl: journeyMenuCell },
  { property: '--ca-journey-section-frame', sourceUrl: journeySectionFrame },
];

const themeLoadRevision = new WeakMap<Window, number>();

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
  unlockPrompt: {
    badge: '前往尾巴镇领取',
    notice: '需要前往尾巴镇领取并导入专属奖励脚本后，才能使用小狗主题。',
    title: '小狗主题尚未解锁',
    description: '请前往尾巴镇领取专属奖励脚本，导入后此主题会自动解锁。',
  },
};

const JOURNEY_THEME: CaelianThemeOption = {
  id: JOURNEY_THEME_ID,
  name: '旅程主题',
  description: '以蓝色车票、星轨与远行印记装点冒险界面。',
  badge: '旅程专属',
  locked: true,
  previewUrl: journeyTicket,
  unlockPrompt: {
    badge: '前往旅程领取',
    notice: '需要前往旅程社区领取并导入专属奖励脚本后，才能使用旅程主题。',
    title: '旅程主题尚未解锁',
    description: '请前往旅程社区领取专属奖励脚本，导入后此主题会自动解锁。',
  },
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
  const entitlements = entitlementIds(host);
  return [
    { ...DEFAULT_THEME },
    {
      ...TAIL_TOWN_THEME,
      previewUrl: resolvedLocalAssetUrl(launcherBone, host),
      locked: !entitlements.has(TAIL_TOWN_THEME_ID),
    },
    {
      ...JOURNEY_THEME,
      previewUrl: resolvedLocalAssetUrl(journeyTicket, host),
      locked: !entitlements.has(JOURNEY_THEME_ID),
    },
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

function dispatchThemeAssetsChanged(host: Window): void {
  const event = host.document.createEvent('CustomEvent');
  event.initCustomEvent(THEME_ASSETS_EVENT, false, false, undefined);
  host.dispatchEvent(event);
}

export function applyTheme(
  host: Window,
  preferred: CaelianThemeId | undefined,
): CaelianThemeState {
  const active = resolveAvailableTheme(host, preferred);
  const body = host.document.body;
  if (body) {
    body.classList.remove(...THEME_BODY_CLASSES);
    clearThemeAssets(body);
    body.dataset.caelianTheme = active;
    if (active === TAIL_TOWN_THEME_ID) {
      body.classList.add('caelian-theme-tail-town');
    } else if (active === JOURNEY_THEME_ID) {
      body.classList.add('caelian-theme-journey');
    }
    void hydrateThemeAssets(host, active);
  }
  return { active, available: listAvailableThemes(host) };
}

export function clearAppliedTheme(host: Window): void {
  const body = host.document.body;
  if (!body) return;
  body.classList.remove(...THEME_BODY_CLASSES);
  delete body.dataset.caelianTheme;
  clearThemeAssets(body);
}

function clearThemeAssets(body: HTMLElement): void {
  body.style.removeProperty('--ca-tail-town-launcher-image');
  body.style.removeProperty('--ca-tail-town-paw-pattern');
  body.style.removeProperty('--ca-journey-launcher-ticket');
  body.style.removeProperty('--ca-journey-launcher-stub');
  body.style.removeProperty('--ca-journey-pattern');
  body.style.removeProperty('--ca-journey-menu-frame');
  body.style.removeProperty('--ca-journey-menu-cell');
  body.style.removeProperty('--ca-journey-section-frame');
}

export function themeMenuIconAsset(
  host: Window,
  theme: CaelianThemeId,
  panel: PanelName,
): ThemeMenuIconAsset | undefined {
  if (theme === TAIL_TOWN_THEME_ID) {
    const sourceUrl = TAIL_TOWN_ICON_URLS[panel];
    const url = sourceUrl
      ? resolvedLocalAssetUrl(sourceUrl, host)
      : undefined;
    return url ? { url } : undefined;
  }
  if (theme === JOURNEY_THEME_ID) {
    const asset = JOURNEY_ICON_ASSETS[panel];
    if (!asset) return undefined;
    const url = resolvedLocalAssetUrl(asset.url, host);
    return url ? { ...asset, url } : undefined;
  }
  return undefined;
}

async function hydrateThemeAssets(
  host: Window,
  theme: CaelianThemeId,
): Promise<void> {
  const revision = (themeLoadRevision.get(host) ?? 0) + 1;
  themeLoadRevision.set(host, revision);
  if (theme === 'default') return;

  const cssAssets = theme === TAIL_TOWN_THEME_ID
    ? TAIL_TOWN_CSS_ASSETS
    : JOURNEY_CSS_ASSETS;
  const iconAssets = theme === TAIL_TOWN_THEME_ID
    ? Object.values(TAIL_TOWN_ICON_URLS)
    : Object.values(JOURNEY_ICON_ASSETS).map((asset) => asset.url);

  for (const asset of cssAssets) {
    const url = await loadLocalAssetUrl(asset.sourceUrl, host);
    const body = host.document.body;
    if (
      themeLoadRevision.get(host) !== revision ||
      body?.dataset.caelianTheme !== theme
    ) return;
    body.style.setProperty(asset.property, cssUrl(url));
  }

  await Promise.all(iconAssets.map((url) => loadLocalAssetUrl(url, host)));
  if (
    themeLoadRevision.get(host) === revision &&
    host.document.body?.dataset.caelianTheme === theme
  ) {
    dispatchThemeAssetsChanged(host);
  }
}

export async function prepareThemePreviews(host: Window): Promise<void> {
  await Promise.all([
    loadLocalAssetUrl(launcherBone, host),
    loadLocalAssetUrl(journeyTicket, host),
  ]);
  dispatchThemeAssetsChanged(host);
}

export function subscribeThemeAssets(
  host: Window,
  handler: () => void,
): () => void {
  const listener = () => handler();
  host.addEventListener(THEME_ASSETS_EVENT, listener);
  return () => host.removeEventListener(THEME_ASSETS_EVENT, listener);
}

export function subscribeThemeEntitlements(
  host: Window,
  handler: () => void,
): () => void {
  const listener = () => handler();
  host.addEventListener(THEME_ENTITLEMENTS_EVENT, listener);
  return () => host.removeEventListener(THEME_ENTITLEMENTS_EVENT, listener);
}
