/// <reference types="vite/client" />

declare const __CAELIAN_VERSION__: string;
declare const __CAELIAN_BUILD_ID__: string;

interface Window {
  Caelian?: import('./kernel/public-api').CaelianPublicApi;
  __CaelianRuntime?: unknown;
  Mvu?: MvuLike;
  SillyTavern?: {
    getContext?: () => TavernContext | Promise<TavernContext>;
  };
  eventOn?: (
    event: unknown,
    handler: (...args: unknown[]) => void,
  ) => unknown;
  tavern_events?: Record<string, unknown>;
  toastr?: {
    info?: (message: string, title?: string) => void;
    success?: (message: string, title?: string) => void;
    warning?: (message: string, title?: string) => void;
    error?: (message: string, title?: string) => void;
  };
}

interface MvuLike {
  getMvuData: (option: MvuOption) => Record<string, unknown>;
  replaceMvuData: (
    data: Record<string, unknown>,
    option: MvuOption,
  ) => void | Promise<unknown>;
}

interface MvuOption {
  type: 'message' | 'chat';
  message_id?: number | 'latest';
}

interface TavernContext {
  chatId?: string;
  chat_id?: string;
  chatID?: string;
  chatFile?: string;
  chatName?: string;
  characterId?: string | number;
  groupId?: string | number;
  name1?: string;
  name2?: string;
  chat?: Array<{
    mes?: string;
    message?: string;
    content?: string;
  }>;
  characters?: Array<{
    name?: string;
    avatar?: string;
  }>;
  chatMetadata?: {
    persona?: string;
  };
  powerUserSettings?: {
    default_persona?: string;
  };
  getThumbnailUrl?: (
    type: 'avatar' | 'persona',
    file: string,
    cacheBust?: boolean,
  ) => string;
}
