import type {
  InterruptHandler,
  QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import type {
  WorkshopMechanismManifest,
  WorkshopMechanismTrigger,
} from '@/workshop-mechanisms';

export interface WorkshopScriptBattleSnapshot {
  turn: number;
  phase: string;
  selectedTarget: number;
  player: Record<string, unknown>;
  enemies: Array<Record<string, unknown>>;
}

export interface WorkshopScriptInput {
  trigger: WorkshopMechanismTrigger;
  battle: WorkshopScriptBattleSnapshot;
  event: Record<string, unknown>;
  resources: Record<string, number>;
  random: number;
}

interface QuickJSBundle {
  module: QuickJSWASMModule;
  shouldInterruptAfterDeadline: (deadline: number | Date) => InterruptHandler;
}

let bundle: QuickJSBundle | undefined;
let bundlePromise: Promise<QuickJSBundle> | undefined;
// Parallel Vitest workers can leave this worker unscheduled long enough to trip a
// wall-clock interrupt. Production keeps the strict mobile-facing budget.
const SCRIPT_TIMEOUT_MS = import.meta.env.MODE === 'test' ? 1_000 : 50;
const VALIDATION_TIMEOUT_MS = import.meta.env.MODE === 'test' ? 1_000 : 250;

export async function prepareWorkshopScriptRuntime(): Promise<void> {
  if (bundle) return;
  bundlePromise ??= Promise.all([
    import('quickjs-emscripten-core'),
    import('@jitl/quickjs-wasmfile-release-sync'),
  ]).then(async ([core, variantModule]) => ({
    module: await core.newQuickJSWASMModuleFromVariant(variantModule.default),
    shouldInterruptAfterDeadline: core.shouldInterruptAfterDeadline,
  }));
  bundle = await bundlePromise;
}

function scriptError(value: unknown): string {
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const name = String(source.name ?? 'Error');
    const message = String(source.message ?? '代码机制执行失败');
    return `${name}: ${message}`;
  }
  return String(value ?? '代码机制执行失败');
}

function evaluate(
  mechanism: WorkshopMechanismManifest,
  expression: string,
  deadline?: number,
  timeoutMs = SCRIPT_TIMEOUT_MS,
): unknown {
  if (!bundle) throw new Error('代码机制沙箱尚未准备完成。');
  const runtime = bundle.module.newRuntime();
  runtime.setMemoryLimit(8 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  const context = runtime.newContext();
  runtime.setInterruptHandler(
    bundle.shouldInterruptAfterDeadline(
      Math.min(deadline ?? Number.POSITIVE_INFINITY, Date.now() + timeoutMs),
    ),
  );
  try {
    const result = context.evalCode(
      `"use strict";\n${mechanism.source ?? ''}\n${expression}`,
      `${mechanism.id}.js`,
    );
    if (result.error) {
      const dumped = context.dump(result.error);
      result.error.dispose();
      throw new Error(scriptError(dumped));
    }
    const output = context.dump(result.value);
    result.value.dispose();
    return output;
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

export async function validateWorkshopScriptMechanism(
  mechanism: WorkshopMechanismManifest,
): Promise<void> {
  await prepareWorkshopScriptRuntime();
  const entrypoint = mechanism.entrypoint ?? 'handle';
  const result = evaluate(
    mechanism,
    `if (typeof ${entrypoint} !== "function") { throw new TypeError("入口函数 ${entrypoint} 不存在"); }\ntrue;`,
    undefined,
    VALIDATION_TIMEOUT_MS,
  );
  if (result !== true) throw new Error('代码机制入口校验失败。');
}

export function executeWorkshopScriptMechanism(
  mechanism: WorkshopMechanismManifest,
  input: WorkshopScriptInput,
): unknown {
  const entrypoint = mechanism.entrypoint ?? 'handle';
  const serializedInput = JSON.stringify(input);
  const output = evaluate(
    mechanism,
    `if (typeof ${entrypoint} !== "function") { throw new TypeError("入口函数 ${entrypoint} 不存在"); }\n` +
      `JSON.stringify(${entrypoint}(JSON.parse(${JSON.stringify(serializedInput)})) ?? {});`,
  );
  if (typeof output !== 'string') return {};
  if (output.length > 64_000) throw new Error('代码机制返回的数据超过 64KB。');
  return JSON.parse(output) as unknown;
}
