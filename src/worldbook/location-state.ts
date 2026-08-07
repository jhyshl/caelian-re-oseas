import type { WorldStateRecord } from '@/domain/types';
import { normalizeRegion, REGION_ALIASES } from '@/worldbook/region-switcher';

type WorldLocationFields = Pick<
  WorldStateRecord,
  'region' | 'place' | 'location'
>;

const KNOWN_REGIONS = new Set<string>(Object.keys(REGION_ALIASES));

export function canonicalWorldLocation(
  current: WorldLocationFields,
  patch: Partial<WorldLocationFields>,
): WorldLocationFields {
  const explicitRegion = knownRegion(patch.region);
  const locationRegion = knownRegion(patch.location);
  const placeRegion = knownRegion(patch.place);
  const currentRegion = knownRegion(current.region) || normalizeRegion(current.region);
  const region =
    explicitRegion || locationRegion || placeRegion || currentRegion || current.region;

  let place =
    patch.place !== undefined
      ? clean(patch.place)
      : patch.location !== undefined
        ? placeFromLocation(patch.location, region)
        : region !== currentRegion
          ? ''
          : clean(current.place);

  const normalizedPlace = knownRegion(place);
  if (explicitRegion && normalizedPlace && normalizedPlace !== region) {
    place = '';
  }
  if (place === region) place = '';

  return {
    region,
    place,
    location: place ? `${region} · ${place}` : region,
  };
}

function knownRegion(raw: unknown): string {
  const normalized = normalizeRegion(raw);
  return KNOWN_REGIONS.has(normalized) ? normalized : '';
}

function placeFromLocation(raw: unknown, region: string): string {
  const text = clean(raw);
  if (!text || text === region) return '';
  const aliases = REGION_ALIASES[region as keyof typeof REGION_ALIASES] ?? [];
  const leading = [...aliases]
    .sort((left, right) => right.length - left.length)
    .find((alias) => text.startsWith(alias));
  if (!leading) return text;
  return text
    .slice(leading.length)
    .replace(/^[\s·・—:：>＞/\\-]+/, '')
    .trim();
}

function clean(raw: unknown): string {
  return String(raw ?? '').trim();
}
