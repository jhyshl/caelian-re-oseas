import type {
  RegionDefinition,
  RegionPlaceDefinition,
} from '@/content/types';

let regionsCache: RegionDefinition[] | undefined;
let placesCache: Record<string, RegionPlaceDefinition[]> | undefined;
let linksCache: Array<[string, string]> | undefined;

export async function loadRegions(): Promise<RegionDefinition[]> {
  if (!regionsCache) {
    const module = await import('@/content/generated/world/regions.json');
    regionsCache = module.default as RegionDefinition[];
  }
  return regionsCache;
}

export async function loadRegionPlaces(): Promise<
  Record<string, RegionPlaceDefinition[]>
> {
  if (!placesCache) {
    const module = await import(
      '@/content/generated/world/region-places.json'
    );
    placesCache = module.default as Record<string, RegionPlaceDefinition[]>;
  }
  return placesCache;
}

export async function loadRegionLinks(): Promise<Array<[string, string]>> {
  if (!linksCache) {
    const module = await import('@/content/generated/world/region-links.json');
    linksCache = module.default as Array<[string, string]>;
  }
  return linksCache;
}
