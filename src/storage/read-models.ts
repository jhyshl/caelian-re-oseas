import type { GameSnapshot } from '@/domain/types';

export type BattleSnapshot = Pick<
  GameSnapshot, 'player' | 'world' | 'decks' | 'inventory' | 'battle' | 'relics' | 'settings'
>;

export type ThemeSnapshot = Pick<GameSnapshot, 'social' | 'settings'>;
