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

export interface NotificationViewModel {
  toasts: NotificationToastView[];
  confirmation: ConfirmationView | null;
}
