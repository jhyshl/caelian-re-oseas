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
  cancel?(): boolean;
  isEvaluating?(): boolean;
}

export class QuestJudgeCancelledError extends Error {
  constructor() {
    super('玩家已终止副 API 判定');
    this.name = 'QuestJudgeCancelledError';
  }
}

export function isQuestJudgeCancelledError(
  error: unknown,
): error is QuestJudgeCancelledError {
  return error instanceof QuestJudgeCancelledError;
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
    const request = () =>
      fetcher(endpoint, {
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
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      response = await request();
    }
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

export function resolveChatEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new Error('副 API 地址格式无效');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/(?:chat\/completions|responses|completions)$/i.test(path)) {
    return url.href;
  }
  url.pathname = !path
    ? '/v1/chat/completions'
    : /\/v\d+$/i.test(path)
      ? `${path}/chat/completions`
      : path;
  return url.href;
}

export class OpenAiCompatibleQuestJudgeClient
  implements QuestJudgeClient
{
  private activeRequest?: {
    controller: AbortController;
    cancelledByPlayer: boolean;
  };

  constructor(
    private readonly config: OpenAiCompatibleJudgeConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  cancel(): boolean {
    const request = this.activeRequest;
    if (!request || request.controller.signal.aborted) return false;
    request.cancelledByPlayer = true;
    request.controller.abort();
    return true;
  }

  isEvaluating(): boolean {
    return Boolean(
      this.activeRequest && !this.activeRequest.controller.signal.aborted,
    );
  }

  async evaluate(
    input: QuestJudgePromptInput,
  ): Promise<QuestJudgeEvaluation> {
    const endpoint = resolveChatEndpoint(this.config.endpoint);
    const model = this.config.model.trim();
    if (!endpoint || !model) throw new Error('副 API 地址和模型不能为空');

    const request = {
      controller: new AbortController(),
      cancelledByPlayer: false,
    };
    this.activeRequest = request;
    const timeout = setTimeout(
      () => request.controller.abort(),
      this.config.timeoutMs ?? 30_000,
    );
    try {
      const messages = buildQuestJudgeMessages(input);
      const responsesApi = isResponsesEndpoint(endpoint);
      const response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey
            ? { Authorization: `Bearer ${this.config.apiKey}` }
            : {}),
          ...(this.config.headers ?? {}),
        },
        body: JSON.stringify(
          responsesApi
            ? {
                model,
                temperature: 0,
                input: messages,
                ...(this.config.jsonMode
                  ? { text: { format: { type: 'json_object' } } }
                  : {}),
              }
            : {
                model,
                temperature: 0,
                messages,
                ...(this.config.jsonMode
                  ? { response_format: { type: 'json_object' } }
                  : {}),
              },
        ),
        signal: request.controller.signal,
      });
      if (!response.ok) {
        const detail = await responseErrorDetail(response);
        throw new Error(
          `副 API 请求失败：HTTP ${response.status}${detail ? ` · ${detail}` : ''}`,
        );
      }
      const payload = await parseResponsePayload(response);
      const content = extractResponseText(payload);
      if (!content.trim()) {
        throw new Error('副 API 没有返回可解析的文本');
      }
      if (content.length > 20_000) throw new Error('副 API 返回内容过长');
      const parsed = parseJsonObject(content);
      return {
        result: questJudgeResultSchema.parse(normalizeJudgeResult(parsed)),
        rawResponse: content,
      };
    } catch (error) {
      if (request.controller.signal.aborted) {
        if (request.cancelledByPlayer) {
          throw new QuestJudgeCancelledError();
        }
        throw new Error('副 API 请求超时', { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.activeRequest === request) this.activeRequest = undefined;
    }
  }
}

function isResponsesEndpoint(endpoint: string): boolean {
  try {
    return /\/responses\/?$/i.test(new URL(endpoint).pathname);
  } catch {
    return false;
  }
}

async function responseErrorDetail(response: Response): Promise<string> {
  const text = (await response.text()).trim();
  if (!text) return '';
  try {
    const payload = asRecord(JSON.parse(text));
    const error = asRecord(payload?.error);
    return firstText(error?.message, payload?.message).slice(0, 500);
  } catch {
    return text.replace(/\s+/g, ' ').slice(0, 500);
  }
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new Error('副 API 返回的响应不是 JSON', { cause: error });
  }
}

function extractResponseText(payload: unknown): string {
  const root = asRecord(payload);
  const direct = firstText(root?.output_text);
  if (direct) return direct;

  const choices = Array.isArray(root?.choices) ? root.choices : [];
  for (const choiceValue of choices) {
    const choice = asRecord(choiceValue);
    const message = asRecord(choice?.message);
    const text = textFromContent(message?.content);
    if (text) return text;
  }

  const output = Array.isArray(root?.output) ? root.output : [];
  for (const itemValue of output) {
    const item = asRecord(itemValue);
    const text = textFromContent(item?.content);
    if (text) return text;
  }
  return '';
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((partValue) => {
      if (typeof partValue === 'string') return partValue;
      const part = asRecord(partValue);
      return firstText(part?.text, part?.output_text);
    })
    .filter(Boolean)
    .join('\n')
    .trim();
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

function normalizeJudgeResult(value: unknown): unknown {
  const source = asRecord(value);
  if (!source) return value;

  const matchedTransitionId = nullableText(source.matchedTransitionId);
  const suggestedNodeId = nullableText(source.suggestedNodeId);
  const completionGateSatisfied = booleanValue(
    source.completionGateSatisfied,
  );
  const transitionSupported = Boolean(
    completionGateSatisfied && matchedTransitionId && suggestedNodeId,
  );
  const progress =
    source.progress === 'transition' ||
    (source.progress !== 'stay' && transitionSupported)
      ? transitionSupported
        ? 'transition'
        : 'stay'
      : 'stay';
  const sceneState = JUDGE_SCENE_STATES.has(String(source.sceneState))
    ? source.sceneState
    : 'uncertain';
  const evidenceSource = Array.isArray(source.evidence)
    ? source.evidence
    : [source.evidence];
  const evidence = evidenceSource
    .flatMap((item) =>
      typeof item === 'string' && item.trim()
        ? [item.trim().slice(0, 500)]
        : [],
    )
    .slice(0, 8);
  const confidenceValue = Number(source.confidence);
  const summary = firstText(source.summary, evidence[0]).slice(0, 2_000);
  const giftItems = normalizeJudgeItems(source.giftItems, 20);
  const requiredItemSubmission = normalizeJudgeItems(
    source.requiredItemSubmission ? [source.requiredItemSubmission] : [],
    1,
  )[0] ?? null;

  return {
    ...source,
    sceneState,
    progress,
    completionGateSatisfied,
    matchedTransitionId: progress === 'transition' ? matchedTransitionId : null,
    suggestedNodeId: progress === 'transition' ? suggestedNodeId : null,
    confidence: Number.isFinite(confidenceValue)
      ? Math.min(1, Math.max(0, confidenceValue))
      : 0,
    evidence,
    summary: summary || '本轮没有确认新的任务进度。',
    giftItems,
    requiredItemSubmission:
      progress === 'transition' ? requiredItemSubmission : null,
  };
}

function normalizeJudgeItems(
  value: unknown,
  limit: number,
): Array<{ itemId: string; count: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      const item = asRecord(entry);
      const itemId = firstText(item?.itemId, item?.id).slice(0, 160);
      const count = Math.floor(Number(item?.count));
      return itemId && Number.isFinite(count) && count > 0
        ? [{ itemId, count: Math.min(999_999, count) }]
        : [];
    })
    .slice(0, limit);
}

const JUDGE_SCENE_STATES = new Set([
  'in_scene',
  'temporary_detour',
  'left_scene',
  'drifted',
  'uncertain',
  'candidate_complete',
  'candidate_failed',
]);

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 160)
    : null;
}

function booleanValue(value: unknown): boolean {
  if (value === true || value === 'true' || value === 1) return true;
  return false;
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
