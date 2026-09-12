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
  const conflict = (name: unknown, reason = '当前内容或设置与作者原版不同，已保留本地内容') => {
    const message = `${String(name)}：${reason}`;
    if (!result.conflicts.includes(message)) result.conflicts.push(message);
  };
  for (const before of delta.removals) {
    const matches = result.entries.filter(entry => entry.name === before.name);
    if (!matches.length) continue;
    // Deletion needs the entire original semantic entry, including user settings.
    if (matches.length !== 1) {
      conflict(before.name, '存在多个同名条目，无法确定要删除哪一项'); continue;
    }
    const differences = originalDifferences(matches[0]!, before);
    if (differences.length) {
      conflict(before.name, `未删除；与原版不同的字段：${differences.join('、')}`); continue;
    }
    result.entries = result.entries.filter(entry => entry !== matches[0]);
    result.applied += 1;
  }
  for (const { before, after } of delta.changes) {
    const matches = result.entries.filter(entry => entry.name === before.name);
    if (matches.length !== 1) { conflict(before.name); continue; }
    const entry = matches[0]!;
    // A player-edited text is preserved in full, even if some author hunks match.
    if (!equal(entry.content, before.content) && !equal(entry.content, after.content)) {
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
      if (matches.length !== 1 || !equal(matches[0]!.content, addition.content)) conflict(addition.name);
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

function originalDifferences(entry: DeltaEntry, original: Omit<DeltaEntry, 'uid'>): string[] {
  const actual = semanticEntry(entry), expected = semanticEntry(original);
  const differences: string[] = [];
  const visit = (a: Record<string, unknown>, b: Record<string, unknown>, path = '') => {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const label = path ? `${path}.${key}` : key;
      if (record(a[key]) && record(b[key])) visit(a[key], b[key], label);
      else if (!equal(a[key], b[key])) differences.push(label);
    }
  };
  visit(actual, expected);
  return differences;
}

// Defaults from Tavern Helper's worldbook round trip. Only documented defaults
// are filled; unknown fields and real player settings remain comparison inputs.
function semanticEntry(entry: Omit<DeltaEntry, 'uid'>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    addMemo: true, matchPersonaDescription: false, matchCharacterDescription: false,
    matchCharacterPersonality: false, matchCharacterDepthPrompt: false,
    matchScenario: false, matchCreatorNotes: false, group: '', groupOverride: false,
    groupWeight: 100, caseSensitive: null, matchWholeWords: null, useGroupScoring: null,
    automationId: '', ignoreBudget: false, outletName: '', triggers: [],
    characterFilter: { isExclude: false, names: [], tags: [] }, extra: {},
    ...Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)),
  };
  delete result.uid;
  delete result.displayIndex;
  for (const key of ['effect', 'recursion']) {
    if (!record(result[key])) continue;
    const nested = { ...result[key] };
    result[key] = nested;
    const fields = key === 'effect' ? ['sticky', 'cooldown', 'delay'] : ['delay_until'];
    for (const field of fields) {
      const value = nested[field];
      if (value === undefined || value === null || value === false || value === 0) nested[field] = null;
    }
  }
  return result;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'string' && typeof b === 'string') return a.replaceAll('\r\n', '\n') === b.replaceAll('\r\n', '\n');
  if (a instanceof RegExp || b instanceof RegExp) return String(a) === String(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  return record(a) && record(b) && Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(key => equal(a[key], b[key]));
}
