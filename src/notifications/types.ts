export type NotificationKind =
  | 'achievement'
  | 'task'
  | 'craft'
  | 'success'
  | 'info'
  | 'warning'
  | 'error';

export interface NotificationInput {
  kind?: NotificationKind;
  icon?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: string;
  duration?: number;
  priority?: number;
  onClick?: () => void | Promise<void>;
}

export interface ConfirmationInput {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'default' | 'danger';
}

export interface NotificationToastView {
  id: number;
  kind: NotificationKind;
  icon: string;
  eyebrow: string;
  title: string;
  description: string;
  meta: string;
  duration: number;
  priority: number;
  clickable: boolean;
  leaving: boolean;
  paused: boolean;
  createdAt: number;
}

export interface ConfirmationView {
  id: number;
  title: string;
  description: string;
  confirmText: string;
  cancelText: string;
  tone: 'default' | 'danger';
}

export interface QuestGuidanceInput {
  questName: string;
  status: string;
  stageTitle: string;
  sceneTitle: string;
  beatTitle: string;
  summary: string;
  objective: string;
  hint: string;
  clues?: string[];
  injectText?: string;
  onInject?: () => boolean;
}

export interface QuestGuidanceView {
  questName: string;
  status: string;
  stageTitle: string;
  sceneTitle: string;
  beatTitle: string;
  summary: string;
  objective: string;
  hint: string;
  clues: string[];
  injectable: boolean;
  injected: boolean;
}

export interface NotificationViewModel {
  toasts: NotificationToastView[];
  confirmation: ConfirmationView | null;
  questGuidance: QuestGuidanceView | null;
}
