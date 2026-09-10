/** Three-way author delta. Runtime UIDs are never author identities. */
export interface DeltaEntry {
  uid: number | string;
  name: string;
  content: string;
  enabled?: boolean;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorldbookDelta {
  revision: string;
  additions: Omit<DeltaEntry, 'uid'>[];
  removals: Omit<DeltaEntry, 'uid'>[];
  changes: Array<{ before: Omit<DeltaEntry, 'uid'>; after: Omit<DeltaEntry, 'uid'> }>;
}

export interface DeltaResult {
  entries: DeltaEntry[];
  applied: number;
  conflicts: string[];
}

export function applyWorldbookDelta(entries: DeltaEntry[], delta: WorldbookDelta): DeltaResult {
  const result: DeltaResult = { entries: structuredClone(entries), applied: 0, conflicts: [] };
  const conflict = (name: unknown) => result.conflicts.push(`保留玩家内容：${String(name)}`);
  for (const before of delta.removals) {
    const matches = result.entries.filter(entry => entry.name === before.name);
    if (!matches.length) continue;
    // Deletion needs the entire original semantic entry, including user settings.
    if (matches.length !== 1 || !matchesOriginal(matches[0]!, before)) {
      conflict(before.name); continue;
    }
    result.entries = result.entries.filter(entry => entry !== matches[0]);
    result.applied += 1;
  }
  for (const { before, after } of delta.changes) {
    const matches = result.entries.filter(entry => entry.name === before.name);
    if (matches.length !== 1) { conflict(before.name); continue; }
    const entry = matches[0]!;
    // A player-edited text is preserved in full, even if some author hunks match.
    if (entry.content !== before.content && entry.content !== after.content) {
      conflict(before.name); continue;
    }
    const merge = (current: Record<string, unknown>, old: Record<string, unknown>, next: Record<string, unknown>) => {
      for (const key of Object.keys(next)) {
        if (equal(old[key], next[key])) continue;
        if (record(old[key]) && record(next[key]) && record(current[key])) {
          merge(current[key], old[key], next[key]);
        } else if (equal(current[key], old[key])) {
          current[key] = structuredClone(next[key]); result.applied += 1;
        } else if (!equal(current[key], next[key])) conflict(`${String(before.name)} / ${key}`);
      }
    };
    merge(entry, before, after);
  }
  for (const addition of delta.additions) {
    const matches = result.entries.filter(entry => entry.name === addition.name);
    if (matches.length) {
      if (matches.length !== 1 || matches[0]!.content !== addition.content) conflict(addition.name);
      continue;
    }
    // Allocate against live UIDs; the source UID can have been reused by either author or player.
    const used = new Set(result.entries.map(entry => String(entry.uid)));
    let uid = 0;
    while (used.has(String(uid))) uid += 1;
    result.entries.push({ uid, name: '', content: '', ...structuredClone(addition) });
    result.applied += 1;
  }
  return result;
}

function matchesOriginal(entry: DeltaEntry, original: Omit<DeltaEntry, 'uid'>): boolean {
  const compare = (actual: Record<string, unknown>, expected: Record<string, unknown>): boolean =>
    Object.entries(expected).every(([key, value]) =>
      equal(actual[key], value));
  if (!compare(entry, original)) return false;
  if (Object.keys(entry).some(key => key !== 'uid' && key !== 'extra' && !(key in original) && entry[key] !== undefined)) return false;
  const expectedExtra = (original.extra ?? {}) as Record<string, unknown>;
  return Object.keys(entry.extra ?? {}).every(key => key in expectedExtra);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  return record(a) && record(b) && Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(key => equal(a[key], b[key]));
}
