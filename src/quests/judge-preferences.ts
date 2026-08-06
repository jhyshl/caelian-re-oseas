import type { OpenAiCompatibleJudgeConfig } from '@/quests/judge-client';

const PREFERENCES_KEY = 'caelian_quest_judge_preferences_v1';
const SESSION_KEY = 'caelian_quest_judge_api_key_session_v1';

interface StoredQuestJudgePreferences {
  endpoint: string;
  modelsEndpoint?: string;
  model: string;
  jsonMode: boolean;
}

export function loadQuestJudgePreferences(
  host: Window,
): OpenAiCompatibleJudgeConfig | null {
  try {
    const source = host.localStorage.getItem(PREFERENCES_KEY);
    if (!source) return null;
    const parsed = JSON.parse(source) as Partial<StoredQuestJudgePreferences>;
    if (
      typeof parsed.endpoint !== 'string' ||
      !parsed.endpoint.trim() ||
      typeof parsed.model !== 'string' ||
      !parsed.model.trim()
    ) {
      return null;
    }
    const modelsEndpoint =
      typeof parsed.modelsEndpoint === 'string' &&
      parsed.modelsEndpoint.trim()
        ? parsed.modelsEndpoint.trim()
        : undefined;
    const apiKey = host.sessionStorage.getItem(SESSION_KEY)?.trim();
    return {
      endpoint: parsed.endpoint.trim(),
      ...(modelsEndpoint ? { modelsEndpoint } : {}),
      model: parsed.model.trim(),
      jsonMode: parsed.jsonMode !== false,
      ...(apiKey ? { apiKey } : {}),
    };
  } catch {
    return null;
  }
}

export function saveQuestJudgePreferences(
  host: Window,
  config: OpenAiCompatibleJudgeConfig,
): void {
  try {
    const stored: StoredQuestJudgePreferences = {
      endpoint: config.endpoint.trim(),
      ...(config.modelsEndpoint?.trim()
        ? { modelsEndpoint: config.modelsEndpoint.trim() }
        : {}),
      model: config.model.trim(),
      jsonMode: config.jsonMode !== false,
    };
    host.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(stored));
    const apiKey = config.apiKey?.trim();
    if (apiKey) host.sessionStorage.setItem(SESSION_KEY, apiKey);
    else host.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Private browsing or a restricted host may reject browser storage.
  }
}

export function clearQuestJudgePreferences(host: Window): void {
  try {
    host.localStorage.removeItem(PREFERENCES_KEY);
    host.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Runtime configuration still clears even when storage is unavailable.
  }
}
