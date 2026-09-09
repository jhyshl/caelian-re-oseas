import { isCaelianCharacterName } from '@/content/character-identity';

type Character = NonNullable<TavernContext['characters']>[number];

export interface CharacterTarget {
  name: string;
  avatar: string;
  characterIndex: number;
  character: Character;
  requestHeaders: Record<string, string>;
  isCaelian: boolean;
  assertCurrent: () => void;
}

export class CharacterTargetError extends Error {
  constructor(
    readonly status: 'unavailable' | 'wrong-character',
    message: string,
  ) {
    super(message);
  }
}

const BRIDGE_IDS = new Set([
  // Bridge ids present in distributed character PNGs.
  'a5b20232-9d44-4570-ac96-9448a1df81fe',
  '9cdd3927-94ae-4fd7-89f6-db4163ecaafb',
  // Folder and standalone script exports in export-tavern-helper.mjs.
  '11dc566b-8d62-4892-912d-b9f5b25df1b0',
  'fd9cf9c7-fabe-47f8-beb4-63d17839f379',
  'f56df46e-b198-4d84-9e94-269079a31e17',
  '4cd6194c-ed4f-418c-a3e2-216351c95efe',
]);

function hasCaelianScript(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    const script = item as Record<string, unknown>;
    return (
      (typeof script.id === 'string' && BRIDGE_IDS.has(script.id)) ||
      hasCaelianScript(script.scripts)
    );
  });
}

export function isCaelianCharacter(character: Character): boolean {
  if (isCaelianCharacterName(character.name ?? character.data?.name)) return true;
  const helper = character.data?.extensions?.tavern_helper;
  return (
    typeof helper === 'object' && helper !== null &&
    hasCaelianScript((helper as Record<string, unknown>).scripts)
  );
}

function selected(context: TavernContext | undefined): {
  character: Character;
  index: number;
} | null {
  if (!context || (context.groupId !== undefined && context.groupId !== null && context.groupId !== '')) {
    return null;
  }
  const id = context.characterId;
  // Number(null), Number('') and Number(undefined) must never select card zero.
  if (id === undefined || id === null || id === '') return null;
  const index = Number(id);
  if (!Number.isInteger(index) || index < 0) return null;
  const character = context.characters?.[index];
  return character?.avatar ? { character, index } : null;
}

export function assertCurrentCharacter(host: Window, avatar: string): void {
  const context = host.SillyTavern?.getContext?.();
  if (context instanceof Promise || selected(context)?.character.avatar !== avatar) {
    throw new CharacterTargetError('unavailable', '角色正在切换，请稍后重试本次操作。');
  }
}

/** Capture at the click, before an earlier queued operation can change context. */
export function captureCharacterGuard(host: Window): (() => void) | undefined {
  const context = host.SillyTavern?.getContext?.();
  if (context instanceof Promise) return undefined;
  const current = selected(context);
  if (!current) return undefined;
  const avatar = current.character.avatar!;
  const world = current.character.data?.extensions?.world;
  return () => {
    assertCurrentCharacter(host, avatar);
    const latest = host.SillyTavern?.getContext?.();
    if (latest instanceof Promise || selected(latest)?.character.data?.extensions?.world !== world) {
      throw new CharacterTargetError('unavailable', '角色的世界书绑定已变化，请重新执行本次操作。');
    }
  };
}

/** Read the selected card record, never a helper's cached display name. */
export async function readCharacterTarget(
  host: Window,
  options: { hydrate?: boolean } = {},
): Promise<CharacterTarget> {
  let lastError: unknown;
  let expectedAvatar: string | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const context = await host.SillyTavern?.getContext?.();
      const current = selected(context);
      if (!context || !current) {
        throw new CharacterTargetError('unavailable', '酒馆尚未准备好当前角色，请稍后重试，无需刷新页面。');
      }
      const avatar = current.character.avatar!;
      const assertCurrent = captureCharacterGuard(host) ?? (() => assertCurrentCharacter(host, avatar));
      if (expectedAvatar && expectedAvatar !== avatar) {
        throw new CharacterTargetError('unavailable', '角色已切换，请重新执行本次操作。');
      }
      expectedAvatar = avatar;
      const requestHeaders = {
        ...context.getRequestHeaders?.(),
        'Content-Type': 'application/json',
      };
      let character = current.character;
      const scripts = character.data?.extensions?.tavern_helper;
      if (options.hydrate || (!isCaelianCharacter(character) && scripts === undefined)) {
        const response = await host.fetch('/api/characters/get', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({ avatar_url: avatar }),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`角色卡读取失败 (${response.status})`);
        const persisted = await response.json() as Character;
        if (!persisted?.data || (persisted.avatar && persisted.avatar !== avatar)) {
          throw new Error('角色卡读取结果与当前头像不一致');
        }
        character = { ...persisted, avatar };
      }
      assertCurrent();
      return {
        name: String(character.name ?? character.data?.name ?? '').trim(),
        avatar,
        characterIndex: current.index,
        character,
        requestHeaders,
        isCaelian: isCaelianCharacter(character),
        assertCurrent,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  if (lastError instanceof CharacterTargetError) throw lastError;
  throw new CharacterTargetError('unavailable', lastError instanceof Error ? lastError.message : '当前角色暂时无法读取，请重试。');
}

export function primaryWorldbook(target: CharacterTarget): string {
  const value = target.character.data?.extensions?.world;
  return typeof value === 'string' ? value.trim() : '';
}
