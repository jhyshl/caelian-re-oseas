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

export interface WorldbookDeletionConflict {
  entry: DeltaEntry;
  originalName: string;
  differences: string[];
}
export interface WorldbookDeletionDecision extends WorldbookDeletionConflict {
  remove: boolean;
}
export interface DeltaResult {
  entries: DeltaEntry[];
  applied: number;
  conflicts: string[];
  preserved: string[];
  deletions: WorldbookDeletionConflict[];
}

/** Collapse follow-up author revisions so old additions cannot restore obsolete text. */
export function combineWorldbookDeltas(deltas: WorldbookDelta[]): WorldbookDelta {
  const combined: WorldbookDelta = { revision: deltas.at(-1)?.revision ?? '', additions: [], removals: [], changes: [] };
  for (const delta of deltas) {
    for (const removed of delta.removals) {
      combined.additions = combined.additions.filter(entry => entry.name !== removed.name);
      const changed = combined.changes.find(change => change.after.name === removed.name);
      combined.removals.push(changed?.before ?? removed);
      combined.changes = combined.changes.filter(change => change !== changed);
    }
    for (const change of delta.changes) {
      const added = combined.additions.findIndex(entry => entry.name === change.before.name);
      if (added >= 0) combined.additions[added] = change.after;
      const previous = combined.changes.find(row => row.after.name === change.before.name);
      if (previous) previous.after = change.after;
      else combined.changes.push(structuredClone(change));
    }
    combined.additions.push(...structuredClone(delta.additions));
  }
  return combined;
}

export function applyWorldbookDelta(entries: DeltaEntry[], delta: WorldbookDelta, decisions: WorldbookDeletionDecision[] = []): DeltaResult {
  const result: DeltaResult = { entries: structuredClone(entries), applied: 0, conflicts: [], preserved: [], deletions: [] };
  const preserve = (name: unknown, reason = '正文或设置有本地修改，已保留') => {
    const message = `${String(name)}：${reason}`;
    if (!result.preserved.includes(message)) result.preserved.push(message);
  };
  const matches = (name: unknown) => {
    const identified = result.entries.filter(entry => entry.extra?.caelianManagedEntry === name);
    return identified.length ? identified : result.entries.filter(entry => entry.name === name);
  };
  for (const before of delta.removals) {
    const candidates = matches(before.name);
    for (const entry of candidates) {
      const differences = originalDifferences(entry, before);
      if (candidates.length > 1) differences.push('存在多个同名条目');
      if (differences.length) {
        const decision = decisions.find(choice => choice.originalName === before.name && String(choice.entry.uid) === String(entry.uid) && equal(semanticEntry(choice.entry), semanticEntry(entry)));
        if (!decision) {
          result.deletions.push({ entry: structuredClone(entry), originalName: String(before.name), differences });
          result.conflicts.push(`${entry.name}：新版需删除此条目，但本地存在改动（${differences.join('、')}），等待选择保留或删除`);
          continue;
        }
        if (!decision.remove) { preserve(entry.name, '已选择保留新版拟删除的本地条目'); continue; }
      }
      result.entries = result.entries.filter(current => current !== entry);
      result.applied += 1;
    }
  }
  for (const { before, after } of delta.changes) {
    const candidates = matches(before.name);
    if (!candidates.length && delta.additions.some(entry => entry.name === after.name)) continue;
    if (candidates.length !== 1) { preserve(before.name, candidates.length ? '存在多个同名条目，均已保留' : '本地不存在原条目，未重建或覆盖其他条目'); continue; }
    const entry = candidates[0]!;
    if (!equal(entry.content, before.content) && !equal(entry.content, after.content)) { preserve(entry.name); continue; }
    const merge = (current: Record<string, unknown>, old: Record<string, unknown>, next: Record<string, unknown>) => {
      for (const key of Object.keys(next)) {
        if (equal(old[key], next[key])) continue;
        if (record(old[key]) && record(next[key]) && record(current[key])) merge(current[key], old[key], next[key]);
        else if (equal(current[key], old[key])) { current[key] = structuredClone(next[key]); result.applied += 1; }
        else if (!equal(current[key], next[key])) preserve(`${entry.name} / ${key}`);
      }
    };
    merge(entry, before, after);
  }
  for (const addition of delta.additions) {
    const candidates = matches(addition.name);
    if (candidates.length) {
      if ((candidates.length !== 1 || !equal(candidates[0]!.content, addition.content)) && !result.preserved.some(reason => reason.startsWith(String(addition.name) + '：'))) preserve(addition.name, '本地已有此条目，保留本地内容；新增更新不会覆盖它');
      continue;
    }
    const used = new Set(result.entries.map(entry => String(entry.uid)));
    let uid = 0;
    while (used.has(String(uid))) uid += 1;
    result.entries.push({ uid, name: '', content: '', ...structuredClone(addition), extra: { ...((addition.extra ?? {}) as Record<string, unknown>), caelianManagedEntry: addition.name } });
    result.applied += 1;
  }
  return result;
}

/** Compare complete semantic snapshots after writing; unknown player fields are included. */
export function worldbookEntriesMatch(actual: DeltaEntry[], expected: DeltaEntry[]): boolean {
  return actual.length === expected.length && expected.every(entry => actual.some(current => String(current.uid) === String(entry.uid) && equal(semanticEntry(current), semanticEntry(entry)) && equal(current.extra?.caelianManagedEntry, entry.extra?.caelianManagedEntry)));
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
  if (record(result.extra)) { result.extra = { ...result.extra }; delete (result.extra as Record<string, unknown>).caelianManagedEntry; }
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
