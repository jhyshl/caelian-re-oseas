import {
  buildQuestJudgeMessages,
  type QuestJudgePromptInput,
} from '@/quests/prompt-builder';
import {
  questJudgeResultSchema,
  type QuestJudgeResult,
} from '@/quests/schema';

export interface QuestJudgeEvaluation {
  result: QuestJudgeResult;
  rawResponse: string;
}

export interface QuestJudgeClient {
  evaluate(input: QuestJudgePromptInput): Promise<QuestJudgeEvaluation>;
}

export interface OpenAiCompatibleJudgeConfig {
  endpoint: string;
  modelsEndpoint?: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  jsonMode?: boolean;
}

export interface QuestJudgeModel {
  id: string;
  ownedBy?: string;
}

export interface QuestJudgeModelListConfig {
  endpoint: string;
  modelsEndpoint?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function fetchOpenAiCompatibleModels(
  config: QuestJudgeModelListConfig,
  fetcher: typeof fetch = fetch,
): Promise<QuestJudgeModel[]> {
  const endpoint = resolveModelsEndpoint(config);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? 20_000,
  );
  try {
    const response = await fetcher(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(config.apiKey
          ? { Authorization: `Bearer ${config.apiKey}` }
          : {}),
        ...(config.headers ?? {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`模型列表请求失败：HTTP ${response.status}`);
    }
    return parseModelList(await response.json());
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('模型列表请求超时', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function deriveModelsEndpoint(chatEndpoint: string): string {
  let url: URL;
  try {
    url = new URL(chatEndpoint.trim());
  } catch {
    throw new Error('副 API 地址格式无效');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/(?:chat\/completions|responses|completions)$/i.test(path)) {
    url.pathname = path.replace(
      /\/(?:chat\/completions|responses|completions)$/i,
      '/models',
    );
  } else if (/\/v\d+$/i.test(path)) {
    url.pathname = `${path}/models`;
  } else {
    url.pathname = `${path || ''}/models`;
  }
  url.search = '';
  url.hash = '';
  return url.href;
}

export class OpenAiCompatibleQuestJudgeClient
  implements QuestJudgeClient
{
  constructor(
    private readonly config: OpenAiCompatibleJudgeConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async evaluate(
    input: QuestJudgePromptInput,
  ): Promise<QuestJudgeEvaluation> {
    const endpoint = this.config.endpoint.trim();
    const model = this.config.model.trim();
    if (!endpoint || !model) throw new Error('副 API 地址和模型不能为空');

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 30_000,
    );
    try {
      const response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey
            ? { Authorization: `Bearer ${this.config.apiKey}` }
            : {}),
          ...(this.config.headers ?? {}),
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: buildQuestJudgeMessages(input),
          ...(this.config.jsonMode
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`副 API 请求失败：HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('副 API 没有返回可解析的文本');
      }
      if (content.length > 20_000) throw new Error('副 API 返回内容过长');
      return {
        result: questJudgeResultSchema.parse(parseJsonObject(content)),
        rawResponse: content,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseJsonObject(source: string): unknown {
  const trimmed = source.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('副 API 返回的不是 JSON');
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      throw new Error('副 API 返回的 JSON 格式无效');
    }
  }
}

function resolveModelsEndpoint(
  config: QuestJudgeModelListConfig,
): string {
  const custom = config.modelsEndpoint?.trim();
  if (!custom) return deriveModelsEndpoint(config.endpoint);
  try {
    return new URL(custom).href;
  } catch {
    throw new Error('模型列表地址格式无效');
  }
}

function parseModelList(payload: unknown): QuestJudgeModel[] {
  const record = asRecord(payload);
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : null;
  if (!source) throw new Error('模型列表返回格式无法识别');

  const models = new Map<string, QuestJudgeModel>();
  for (const item of source.slice(0, 2_000)) {
    const model = asRecord(item);
    const id =
      typeof item === 'string'
        ? item.trim()
        : firstText(model?.id, model?.model, model?.name);
    if (!id || id.length > 300) continue;
    const ownedBy = firstText(model?.owned_by, model?.ownedBy);
    models.set(id, {
      id,
      ...(ownedBy ? { ownedBy } : {}),
    });
  }
  const result = [...models.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (result.length === 0) throw new Error('接口没有返回可用模型');
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
