import Dexie, { type Table } from 'dexie';

interface LocalAssetRecord {
  url: string;
  bytes: ArrayBuffer;
  mimeType: string;
  updatedAt: number;
}

interface ObjectUrlRecord {
  url: string;
}

const ASSET_DATABASE_NAME = 'caelian-local-assets-v1';
const ASSET_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;

class LocalAssetDatabase extends Dexie {
  assets!: Table<LocalAssetRecord, string>;

  constructor() {
    super(ASSET_DATABASE_NAME);
    this.version(1).stores({
      assets: 'url, updatedAt',
    });
  }
}

let database: LocalAssetDatabase | undefined;
let cleanupStarted = false;
const objectUrls = new Map<string, ObjectUrlRecord>();
const pending = new Map<string, Promise<string>>();

function assetDatabase(): LocalAssetDatabase {
  database ??= new LocalAssetDatabase();
  if (!cleanupStarted) {
    cleanupStarted = true;
    void database.assets
      .where('updatedAt')
      .below(Date.now() - ASSET_MAX_AGE_MS)
      .delete()
      .catch(() => undefined);
  }
  return database;
}

function canonicalAssetUrl(sourceUrl: string, host: Window): string {
  try {
    return new URL(sourceUrl, host.document.baseURI).href;
  } catch {
    return sourceUrl;
  }
}

function createObjectUrl(
  key: string,
  blob: Blob,
): string | undefined {
  if (typeof URL.createObjectURL !== 'function') return undefined;
  const url = URL.createObjectURL(blob);
  objectUrls.set(key, { url });
  return url;
}

function fetchForHost(host: Window): typeof fetch | undefined {
  if (typeof host.fetch === 'function') return host.fetch.bind(host);
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  return undefined;
}

/**
 * Returns a session-local object URL backed by a persistent IndexedDB Blob.
 * The original build URL is returned whenever storage or fetching is unavailable.
 */
export async function loadLocalAssetUrl(
  sourceUrl: string,
  host: Window,
): Promise<string> {
  if (!sourceUrl || sourceUrl.startsWith('data:') || sourceUrl.startsWith('blob:')) {
    return sourceUrl;
  }

  const key = canonicalAssetUrl(sourceUrl, host);
  const existing = objectUrls.get(key);
  if (existing) return existing.url;

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const task = (async () => {
    try {
      const cached = await assetDatabase().assets.get(key);
      if (cached?.bytes?.byteLength) {
        const blob = new Blob([cached.bytes], { type: cached.mimeType });
        return createObjectUrl(key, blob) ?? sourceUrl;
      }
    } catch {
      // Privacy-restricted webviews may deny IndexedDB access.
    }

    const fetchAsset = fetchForHost(host);
    if (!fetchAsset) return sourceUrl;

    try {
      const response = await fetchAsset(sourceUrl, {
        cache: 'force-cache',
        credentials: 'same-origin',
      });
      if (!response.ok) return sourceUrl;
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength) return sourceUrl;
      const mimeType = response.headers.get('content-type') ?? '';
      const blob = new Blob([bytes], { type: mimeType });

      try {
        await assetDatabase().assets.put({
          url: key,
          bytes,
          mimeType,
          updatedAt: Date.now(),
        });
      } catch {
        // A full or disabled local store must not block rendering.
      }

      return createObjectUrl(key, blob) ?? sourceUrl;
    } catch {
      return sourceUrl;
    }
  })().finally(() => pending.delete(key));

  pending.set(key, task);
  return task;
}

export function resolvedLocalAssetUrl(
  sourceUrl: string,
  host: Window,
): string | undefined {
  return objectUrls.get(canonicalAssetUrl(sourceUrl, host))?.url;
}

export function releaseLocalAssetObjectUrls(): void {
  for (const record of objectUrls.values()) {
    URL.revokeObjectURL?.(record.url);
  }
  objectUrls.clear();
}
