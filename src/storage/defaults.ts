import type {
  EquipmentLoadoutRecord,
  GuildRecord,
  PlayerRecord,
  SettingsRecord,
  SocialProgressRecord,
  StatAllocationRecord,
  WorldStateRecord,
} from '@/domain/types';

export const GLOBAL_SETTINGS_ID = '__caelian_global_settings__';

export function defaultPlayer(
  profileId: string,
  playerName: string,
  now: number,
): PlayerRecord {
  return {
    profileId,
    created: false,
    name: playerName.trim() || '冒险者',
    classMain: 'none',
    subclass: 'none',
    level: 1,
    experience: 0,
    experienceToNext: 100,
    hp: 80,
    hpMax: 80,
    mp: 30,
    mpMax: 30,
    attack: 8,
    defense: 5,
    speed: 5,
    actionPointsPerTurn: 5,
    drawPerTurn: 5,
    lifesteal: 0,
    statPoints: 0,
    gold: 500,
    reclassCount: 0,
    pendingLevelRewards: [],
    updatedAt: now,
  };
}

export function defaultStatAllocations(
  profileId: string,
  now: number,
): StatAllocationRecord {
  return {
    profileId,
    hpMax: 0,
    mpMax: 0,
    attack: 0,
    defense: 0,
    speed: 0,
    actionPointsPerTurn: 0,
    lifesteal: 0,
    actionPointCosts: [],
    updatedAt: now,
  };
}

export function defaultWorld(
  profileId: string,
  now: number,
): WorldStateRecord {
  return {
    profileId,
    region: '伊拉亚城',
    place: '',
    location: '伊拉亚城',
    gameDate: '新圣约历1385-09-01',
    gameTime: '08:00',
    weather: '晴朗',
    mainStage: 0,
    mainStep: 0,
    updatedAt: now,
  };
}

export function defaultGuild(profileId: string, now: number): GuildRecord {
  return {
    profileId,
    rank: 'unregistered',
    experience: 0,
    completedTaskCount: 0,
    updatedAt: now,
  };
}

export function defaultLoadout(
  profileId: string,
  now: number,
): EquipmentLoadoutRecord {
  return {
    profileId,
    weaponId: null,
    armorId: null,
    accessoryId: null,
    updatedAt: now,
  };
}

export function defaultSettings(
  profileId: string,
  now: number,
): SettingsRecord {
  return {
    id: profileId,
    profileId,
    preserveAdventureSave: false,
    battleDifficulty: 'normal',
    updatedAt: now,
  };
}

export function defaultGlobalSettings(
  now: number,
  preserveAdventureSave = false,
): SettingsRecord {
  return {
    id: GLOBAL_SETTINGS_ID,
    profileId: GLOBAL_SETTINGS_ID,
    preserveAdventureSave,
    sharedProfileId: undefined,
    battleDifficulty: 'normal',
    updatedAt: now,
  };
}

export function defaultSocialProgress(
  profileId: string,
  now: number,
): SocialProgressRecord {
  return {
    id: `${profileId}:caelian`,
    profileId,
    characterId: 'caelian',
    affinity: 0,
    mood: '平静',
    location: '圣德里安学院',
    clothing: '白色暗纹衬衫搭配红金色马甲',
    innerThought: '',
    relationshipStage: '陌生人',
    updatedAt: now,
  };
}
