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
    placesCache = { ...module.default, solavia: [...module.default.solavia,
      { name: '赛梅斯商会总部', desc: '位于索拉姆最繁华的地段，内部装潢金碧辉煌，设有拍卖行。' },
      { name: '金鸢赌场', desc: '位于赛梅斯商会总部对面，由皇室和梅尔维斯家族共同掌控，贵族与平民赌徒混迹其中。' },
    ] } as Record<string, RegionPlaceDefinition[]>;
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
