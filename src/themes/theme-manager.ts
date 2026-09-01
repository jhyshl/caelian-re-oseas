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
import caelianHeartAchievementsIcon from '@/assets/themes/caelian-heart/icons/achievements.png';
import caelianHeartAffinityIcon from '@/assets/themes/caelian-heart/icons/affinity.png';
import caelianHeartBattleIcon from '@/assets/themes/caelian-heart/icons/battle.png';
import caelianHeartCardSquareIcon from '@/assets/themes/caelian-heart/icons/card-square.png';
import caelianHeartCharacterIcon from '@/assets/themes/caelian-heart/icons/character.png';
import caelianHeartCraftingIcon from '@/assets/themes/caelian-heart/icons/crafting.png';
import caelianHeartDeckIcon from '@/assets/themes/caelian-heart/icons/deck.png';
import caelianHeartFeedbackIcon from '@/assets/themes/caelian-heart/icons/feedback.png';
import caelianHeartGatheringIcon from '@/assets/themes/caelian-heart/icons/gathering.png';
import caelianHeartGuildIcon from '@/assets/themes/caelian-heart/icons/guild.png';
import caelianHeartInventoryIcon from '@/assets/themes/caelian-heart/icons/inventory.png';
import caelianHeartMailboxIcon from '@/assets/themes/caelian-heart/icons/mailbox.png';
import caelianHeartMapIcon from '@/assets/themes/caelian-heart/icons/map.png';
import caelianHeartMarketIcon from '@/assets/themes/caelian-heart/icons/market.png';
import caelianHeartReleaseNotesIcon from '@/assets/themes/caelian-heart/icons/release-notes.png';
import caelianHeartSettingsIcon from '@/assets/themes/caelian-heart/icons/settings.png';
import caelianHeartSurveysIcon from '@/assets/themes/caelian-heart/icons/surveys.png';
import caelianHeartWorldbookIcon from '@/assets/themes/caelian-heart/icons/worldbook.png';
import caelianHeartFrameCenterGem from '@/assets/themes/caelian-heart/frame-center-gem.png';
import caelianHeartLauncherFrame from '@/assets/themes/caelian-heart/launcher-frame.png';
import caelianHeartLauncherPreview from '@/assets/themes/caelian-heart/launcher-preview.png';
import caelianHeartMenuCell from '@/assets/themes/caelian-heart/menu-cell-9slice.png';
import caelianHeartMenuFrame from '@/assets/themes/caelian-heart/menu-frame-9slice.png';
import caelianHeartPattern from '@/assets/themes/caelian-heart/pattern.png';
import caelianHeartSectionFrame from '@/assets/themes/caelian-heart/section-frame-9slice.png';
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
  CaelianThemeAvailability,
  CaelianThemeId,
  CaelianThemeOption,
  CaelianThemeState,
} from '@/themes/types';

export const THEME_ENTITLEMENTS_EVENT =
  'caelian:theme-entitlements-changed';
export const THEME_ASSETS_EVENT = 'caelian:theme-assets-changed';
export const TAIL_TOWN_THEME_ID = 'tail-town-dog' as const;
export const JOURNEY_THEME_ID = 'journey-ticket' as const;
export const CAELIAN_HEART_THEME_ID = 'caelian-heart' as const;
export const CAELIAN_HEART_AFFINITY_THRESHOLD = 250;

const THEME_BODY_CLASSES = [
  'caelian-theme-tail-town',
  'caelian-theme-journey',
  'caelian-theme-heart',
] as const;
interface ThemeMenuIconAsset {
  position?: string;
  url: string;
}

type ThemeMenuIconAssets = Readonly<
  Partial<Record<PanelName, ThemeMenuIconAsset>>
>;

const TAIL_TOWN_ICON_ASSETS: ThemeMenuIconAssets = {
  character: { url: characterIcon },
  affinity: { url: affinityIcon },
  deck: { url: deckIcon },
  'card-square': { url: cardSquareIcon },
  inventory: { url: inventoryIcon },
  crafting: { url: craftingIcon },
  guild: { url: guildIcon },
  mailbox: { url: mailboxIcon },
  market: { url: marketIcon },
  map: { url: mapIcon },
  worldbook: { url: worldbookIcon },
  battle: { url: battleIcon },
  achievements: { url: achievementsIcon },
  settings: { url: settingsIcon },
  feedback: { url: feedbackIcon },
  surveys: { url: surveysIcon },
  'release-notes': { url: releaseNotesIcon },
};

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

const CAELIAN_HEART_ICON_ASSETS: ThemeMenuIconAssets = {
  character: { url: caelianHeartCharacterIcon },
  affinity: { url: caelianHeartAffinityIcon },
  deck: { url: caelianHeartDeckIcon },
  'card-square': { url: caelianHeartCardSquareIcon },
  inventory: { url: caelianHeartInventoryIcon },
  crafting: { url: caelianHeartCraftingIcon },
  guild: { url: caelianHeartGuildIcon },
  mailbox: { url: caelianHeartMailboxIcon },
  market: { url: caelianHeartMarketIcon },
  gathering: { url: caelianHeartGatheringIcon },
  map: { url: caelianHeartMapIcon },
  worldbook: { url: caelianHeartWorldbookIcon },
  battle: { url: caelianHeartBattleIcon },
  achievements: { url: caelianHeartAchievementsIcon },
  settings: { url: caelianHeartSettingsIcon },
  feedback: { url: caelianHeartFeedbackIcon },
  diagnostics: { url: caelianHeartFeedbackIcon },
  surveys: { url: caelianHeartSurveysIcon },
  'release-notes': { url: caelianHeartReleaseNotesIcon },
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

const CAELIAN_HEART_CSS_ASSETS: readonly ThemeCssAsset[] = [
  { property: '--ca-heart-launcher-frame', sourceUrl: caelianHeartLauncherFrame },
  { property: '--ca-heart-launcher-main', sourceUrl: caelianHeartBattleIcon },
  { property: '--ca-heart-launcher-stub', sourceUrl: caelianHeartReleaseNotesIcon },
  { property: '--ca-heart-pattern', sourceUrl: caelianHeartPattern },
  { property: '--ca-heart-menu-frame', sourceUrl: caelianHeartMenuFrame },
  { property: '--ca-heart-frame-center-gem', sourceUrl: caelianHeartFrameCenterGem },
  { property: '--ca-heart-menu-cell', sourceUrl: caelianHeartMenuCell },
  { property: '--ca-heart-section-frame', sourceUrl: caelianHeartSectionFrame },
];

const THEME_CSS_ASSETS: Readonly<
  Partial<Record<CaelianThemeId, readonly ThemeCssAsset[]>>
> = {
  [TAIL_TOWN_THEME_ID]: TAIL_TOWN_CSS_ASSETS,
  [JOURNEY_THEME_ID]: JOURNEY_CSS_ASSETS,
  [CAELIAN_HEART_THEME_ID]: CAELIAN_HEART_CSS_ASSETS,
};

const THEME_ICON_ASSETS: Readonly<
  Partial<Record<CaelianThemeId, ThemeMenuIconAssets>>
> = {
  [TAIL_TOWN_THEME_ID]: TAIL_TOWN_ICON_ASSETS,
  [JOURNEY_THEME_ID]: JOURNEY_ICON_ASSETS,
  [CAELIAN_HEART_THEME_ID]: CAELIAN_HEART_ICON_ASSETS,
};

const THEME_BODY_CLASS: Readonly<
  Partial<Record<CaelianThemeId, (typeof THEME_BODY_CLASSES)[number]>>
> = {
  [TAIL_TOWN_THEME_ID]: 'caelian-theme-tail-town',
  [JOURNEY_THEME_ID]: 'caelian-theme-journey',
  [CAELIAN_HEART_THEME_ID]: 'caelian-theme-heart',
};

const DEFAULT_THEME_AVAILABILITY: CaelianThemeAvailability = {
  caelianHeartThemeUnlocked: false,
};

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

const CAELIAN_HEART_THEME: CaelianThemeOption = {
  id: CAELIAN_HEART_THEME_ID,
  name: '心动主题',
  description: '以蓝白金与凯利安的同行身影装点冒险界面。',
  badge: '好感度 250 奖励',
  locked: true,
  previewUrl: caelianHeartLauncherPreview,
  unlockPrompt: {
    badge: '好感度 250 解锁',
    notice: '凯利安好感度达到 250 后，心动主题会在本地永久解锁。',
    title: '心动主题尚未解锁',
    description: '继续与凯利安相处；好感度达到 250 后即可永久使用这个主题。',
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

export function listAvailableThemes(
  host: Window,
  availability: CaelianThemeAvailability = DEFAULT_THEME_AVAILABILITY,
): CaelianThemeOption[] {
  const entitlements = entitlementIds(host);
  return [
    { ...DEFAULT_THEME },
    {
      ...TAIL_TOWN_THEME,
      previewUrl: resolvedLocalAssetUrl(launcherBone, host) ?? launcherBone,
      locked: !entitlements.has(TAIL_TOWN_THEME_ID),
    },
    {
      ...JOURNEY_THEME,
      previewUrl: resolvedLocalAssetUrl(journeyTicket, host) ?? journeyTicket,
      locked: !entitlements.has(JOURNEY_THEME_ID),
    },
    {
      ...CAELIAN_HEART_THEME,
      previewUrl:
        resolvedLocalAssetUrl(caelianHeartLauncherPreview, host) ??
        caelianHeartLauncherPreview,
      locked: availability.caelianHeartThemeUnlocked !== true,
    },
  ];
}

export function themeIsAvailable(
  host: Window,
  theme: CaelianThemeId,
  availability: CaelianThemeAvailability = DEFAULT_THEME_AVAILABILITY,
): boolean {
  return listAvailableThemes(host, availability).some(
    (candidate) => candidate.id === theme && !candidate.locked,
  );
}

export function resolveAvailableTheme(
  host: Window,
  preferred: CaelianThemeId | undefined,
  availability: CaelianThemeAvailability = DEFAULT_THEME_AVAILABILITY,
): CaelianThemeId {
  return preferred && themeIsAvailable(host, preferred, availability)
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
  availability: CaelianThemeAvailability = DEFAULT_THEME_AVAILABILITY,
): CaelianThemeState {
  const active = resolveAvailableTheme(host, preferred, availability);
  const body = host.document.body;
  if (body) {
    body.classList.remove(...THEME_BODY_CLASSES);
    clearThemeAssets(body);
    body.dataset.caelianTheme = active;
    const bodyClass = THEME_BODY_CLASS[active];
    if (bodyClass) body.classList.add(bodyClass);
    void hydrateThemeAssets(host, active);
  }
  return { active, available: listAvailableThemes(host, availability) };
}

export function clearAppliedTheme(host: Window): void {
  const body = host.document.body;
  if (!body) return;
  body.classList.remove(...THEME_BODY_CLASSES);
  delete body.dataset.caelianTheme;
  clearThemeAssets(body);
}

function clearThemeAssets(body: HTMLElement): void {
  for (const assets of Object.values(THEME_CSS_ASSETS)) {
    for (const asset of assets) body.style.removeProperty(asset.property);
  }
}

export function themeMenuIconAsset(
  host: Window,
  theme: CaelianThemeId,
  panel: PanelName,
): ThemeMenuIconAsset | undefined {
  const asset = THEME_ICON_ASSETS[theme]?.[panel];
  if (!asset) return undefined;
  const url = resolvedLocalAssetUrl(asset.url, host) ?? asset.url;
  return { ...asset, url };
}

async function hydrateThemeAssets(
  host: Window,
  theme: CaelianThemeId,
): Promise<void> {
  const revision = (themeLoadRevision.get(host) ?? 0) + 1;
  themeLoadRevision.set(host, revision);
  if (theme === 'default') return;

  const cssAssets = THEME_CSS_ASSETS[theme] ?? [];
  const iconAssets = Object.values(THEME_ICON_ASSETS[theme] ?? {}).map(
    (asset) => asset.url,
  );

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
    loadLocalAssetUrl(caelianHeartLauncherPreview, host),
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
