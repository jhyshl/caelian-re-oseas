export interface CardEffect {
  type: string;
  [key: string]: unknown;
}

export interface CardDefinition {
  name: string;
  type: string;
  cost: number;
  mpCost?: number;
  rarity: string;
  cat?: string;
  cls?: string;
  description: string;
  brief?: string;
  effects: CardEffect[];
  source?: string;
  [key: string]: unknown;
}

export interface ProfessionTalent {
  title: string;
  playstyle: string;
  talent: string;
}

export interface MainProfessionPresentation {
  id: string;
  name: string;
  icon: string;
  description: string;
  subclassIds: string[];
}

export interface RegionDefinition {
  id: string;
  name: string;
  unlocked: boolean;
  minLevel: number;
  x: number;
  y: number;
  desc: string;
}

export interface RegionPlaceDefinition {
  name: string;
  desc: string;
  [key: string]: unknown;
}

export interface EquipmentDefinition {
  id: string;
  name: string;
  slot: 'weapon' | 'armor' | 'accessory';
  rarity: string;
  stats: Record<string, number>;
  description: string;
}

export interface RelicDefinition {
  name: string;
  description: string;
  effect: CardEffect;
  unique?: boolean;
  levelReward?: boolean;
  source?: string;
  [key: string]: unknown;
}

export interface BattleItemDefinition {
  name: string;
  desc: string;
  effect?: CardEffect;
  category?: string;
  [key: string]: unknown;
}

export interface AchievementDefinition {
  id?: string;
  name: string;
  icon?: string;
  category?: string;
  tier?: number | string;
  hidden?: boolean;
  description: string;
  condition?: string;
  [key: string]: unknown;
}
