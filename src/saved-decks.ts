import { z } from 'zod';

export const SAVED_DECKS_STORAGE_KEY = 'caelian_saved_deck_builds_v1';
export const SAVED_DECK_FORMAT = 'caelian_saved_deck_build';

export interface SavedDeckBuild {
  format: typeof SAVED_DECK_FORMAT;
  version: 1;
  id: string;
  name: string;
  professionId: string;
  professionName: string;
  mainClass: string;
  cardIds: string[];
  createdAt: string;
  updatedAt: string;
}

const identifier = z.string().trim().min(1).max(100).regex(/^[\w.-]+$/);
const savedDeckSchema = z.object({
  format: z.literal(SAVED_DECK_FORMAT),
  version: z.literal(1),
  id: identifier,
  name: z.string().trim().min(2).max(50),
  professionId: identifier,
  professionName: z.string().trim().min(1).max(40),
  mainClass: identifier,
  cardIds: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

type StorageWindow = Pick<Window, 'localStorage'>;

function storage(sourceWindow?: StorageWindow): Storage | undefined {
  try {
    return sourceWindow?.localStorage ?? globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function normalizeSavedDeckBuild(value: unknown): SavedDeckBuild {
  return savedDeckSchema.parse(value);
}

export function readSavedDeckBuilds(sourceWindow?: StorageWindow): SavedDeckBuild[] {
  try {
    const values = JSON.parse(
      storage(sourceWindow)?.getItem(SAVED_DECKS_STORAGE_KEY) ?? '[]',
    ) as unknown;
    if (!Array.isArray(values)) return [];
    return values
      .flatMap((value) => {
        const parsed = savedDeckSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function saveNamedDeckBuild(
  value: Omit<SavedDeckBuild, 'format' | 'version' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
  },
  sourceWindow?: StorageWindow,
): SavedDeckBuild {
  const now = new Date().toISOString();
  const normalized = normalizeSavedDeckBuild({
    ...value,
    format: SAVED_DECK_FORMAT,
    version: 1,
    createdAt: value.createdAt ?? now,
    updatedAt: now,
  });
  const kept = readSavedDeckBuilds(sourceWindow).filter(
    (entry) => entry.id !== normalized.id,
  );
  const targetStorage = storage(sourceWindow);
  if (!targetStorage) {
    throw new Error('当前酒馆窗口无法使用本地存储。');
  }
  targetStorage.setItem(
    SAVED_DECKS_STORAGE_KEY,
    JSON.stringify([normalized, ...kept].slice(0, 100)),
  );
  if (
    !readSavedDeckBuilds(sourceWindow).some(
      (entry) => entry.id === normalized.id,
    )
  ) {
    throw new Error('构筑没有成功写入当前酒馆窗口。');
  }
  return normalized;
}

export function deleteSavedDeckBuild(
  id: string,
  sourceWindow?: StorageWindow,
): boolean {
  const current = readSavedDeckBuilds(sourceWindow);
  const next = current.filter((entry) => entry.id !== id);
  if (next.length === current.length) return false;
  storage(sourceWindow)?.setItem(SAVED_DECKS_STORAGE_KEY, JSON.stringify(next));
  return true;
}
