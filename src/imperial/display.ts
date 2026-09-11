/** Runs before Markdown/HTML rendering, never on AI prompt history. */
export const IMPERIAL_DISPLAY_REGEX = {
  id: 'caelian-imperial-state-display-v2',
  script_name: '凯利安 · 隐藏皇权连续性记录（仅显示）',
  enabled: true, run_on_edit: true,
  find_regex: '/(?:<caelian-imperial-state\\b[^>]*>[\\s\\S]*?<\\/caelian-imperial-state>|&lt;caelian-imperial-state\\b[\\s\\S]*?&lt;\\/caelian-imperial-state&gt;|<!-- CAELIAN_IMPERIAL_STATE:v1\\b[\\s\\S]*?-->)/gi',
  trim_strings: [] as string[], replace_string: '',
  source: { user_input: false, ai_output: true, slash_command: false, world_info: false },
  destination: { display: true, prompt: false },
  min_depth: null, max_depth: null,
};

export interface ImperialRegexApi {
  getTavernRegexes?: (options: {type:'global'}) => Array<Record<string, unknown>>;
  updateTavernRegexesWith?: (updater: (rules: Array<Record<string, unknown>>) => Array<Record<string, unknown>>, options: {type:'global'}) => Promise<unknown>;
}

export async function ensureImperialDisplayRegex(api: ImperialRegexApi): Promise<boolean> {
  if (!api.getTavernRegexes || !api.updateTavernRegexesWith) return false;
  const rules = api.getTavernRegexes({type:'global'});
  const first = rules[0];
  if (first?.id === IMPERIAL_DISPLAY_REGEX.id && Object.entries(IMPERIAL_DISPLAY_REGEX).every(([key,value]) => sameValue(first[key], value))) return true;
  // First position hides the raw tag before other display decorations can escape or strip it.
  await api.updateTavernRegexesWith(current => [structuredClone(IMPERIAL_DISPLAY_REGEX), ...current.filter(rule => rule.id !== IMPERIAL_DISPLAY_REGEX.id)], {type:'global'});
  return true;
}

export function playerText(text: string, playerName: string): string {
  return text.replace(/\{\{user\}\}|\buser\b/gi, () => playerName || '玩家');
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value,index) => sameValue(actual[index],value));
  if (expected && typeof expected === 'object') return !!actual && typeof actual === 'object' && Object.entries(expected).every(([key,value]) => sameValue((actual as Record<string,unknown>)[key],value));
  return actual === expected;
}
