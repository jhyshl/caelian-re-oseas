import { loadRegions } from '@/content/catalogs/world';
import type { ProfileRecord, RegionAccessRecord } from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';
import {
  defaultGuild,
  defaultGlobalSettings,
  defaultLoadout,
  defaultPlayer,
  defaultSettings,
  defaultSocialProgress,
  defaultStatAllocations,
  defaultWorld,
  GLOBAL_SETTINGS_ID,
} from '@/storage/defaults';

export class ProfileRepository {
  constructor(private readonly db: CaelianDatabase) {}

  async ensure(
    chatId: string,
    defaults: { playerName?: string } = {},
  ): Promise<ProfileRecord> {
    const existing = await this.db.profiles.where('chatId').equals(chatId).first();
    if (existing) {
      const socialId = `${existing.id}:caelian`;
      if (!(await this.db.socialProgress.get(socialId))) {
        await this.db.socialProgress.add(
          defaultSocialProgress(existing.id, Date.now()),
        );
      }
      return existing;
    }

    const now = Date.now();
    const id = `profile:${encodeURIComponent(chatId)}`;
    const profile: ProfileRecord = {
      id,
      chatId,
      createdAt: now,
      updatedAt: now,
    };
    const regions = await loadRegions();
    const access: RegionAccessRecord[] = regions.map((region) => ({
      id: `${id}:${region.id}`,
      profileId: id,
      regionId: region.id,
      accessible: !['abyss_sea', 'holy_mt', 'north'].includes(
        region.id,
      ),
      unlockCondition:
        region.id === 'abyss_sea'
          ? '完成奈亚索斯城所有剧情任务'
          : ['holy_mt', 'north'].includes(region.id)
            ? '当前区域暂未开放，请等待版本更新。'
            : '',
      updatedAt: now,
    }));

    await this.db.transaction(
      'rw',
      [
        this.db.profiles,
        this.db.playerStates,
        this.db.statAllocations,
        this.db.worldStates,
        this.db.regionAccess,
        this.db.guildStates,
        this.db.equipmentLoadouts,
        this.db.socialProgress,
        this.db.settings,
      ],
      async () => {
        await this.db.profiles.add(profile);
        await this.db.playerStates.add(
          defaultPlayer(id, defaults.playerName ?? '', now),
        );
        await this.db.statAllocations.add(defaultStatAllocations(id, now));
        await this.db.worldStates.add(defaultWorld(id, now));
        await this.db.regionAccess.bulkAdd(access);
        await this.db.guildStates.add(defaultGuild(id, now));
        await this.db.equipmentLoadouts.add(defaultLoadout(id, now));
        await this.db.socialProgress.add(defaultSocialProgress(id, now));
        await this.db.settings.add(defaultSettings(id, now));
      },
    );

    return profile;
  }

  async resolve(
    chatId: string,
    defaults: {
      playerName?: string;
      legacyPreserveAdventureSave?: boolean;
    } = {},
  ): Promise<ProfileRecord> {
    const global = await this.ensureGlobalSettings(
      defaults.legacyPreserveAdventureSave,
    );
    if (global.preserveAdventureSave && global.sharedProfileId) {
      const shared = await this.db.profiles.get(global.sharedProfileId);
      if (shared) return shared;
    }

    const profile = await this.ensure(chatId, defaults);
    if (global.preserveAdventureSave && !global.sharedProfileId) {
      await this.db.settings.update(GLOBAL_SETTINGS_ID, {
        sharedProfileId: profile.id,
        updatedAt: Date.now(),
      });
    }
    return profile;
  }

  async ensureGlobalSettings(legacyValue = false) {
    const existing = await this.db.settings.get(GLOBAL_SETTINGS_ID);
    if (existing) return existing;
    const now = Date.now();
    const inferred = await this.db.settings
      .toCollection()
      .filter(
        (entry) =>
          entry.id !== GLOBAL_SETTINGS_ID &&
          entry.preserveAdventureSave,
      )
      .first();
    const settings = defaultGlobalSettings(
      now,
      inferred?.preserveAdventureSave ?? legacyValue,
    );
    if (settings.preserveAdventureSave) {
      settings.sharedProfileId = inferred?.profileId;
    }
    await this.db.settings.add(settings);
    return settings;
  }

  async displaySettings(profileId: string) {
    const [profileSettings, global] = await Promise.all([
      this.db.settings.get(profileId),
      this.ensureGlobalSettings(),
    ]);
    if (!profileSettings) throw new Error('设置记录不存在');
    return {
      ...profileSettings,
      preserveAdventureSave: global.preserveAdventureSave,
      sharedProfileId: global.sharedProfileId,
      uiTheme: profileSettings.uiTheme ?? 'default',
    };
  }

  async updateSettings(
    profileId: string,
    changes: {
      preserveAdventureSave?: boolean;
      battleDifficulty?: 'easy' | 'normal' | 'hard' | 'hell';
      uiTheme?: import('@/themes/types').CaelianThemeId;
    },
  ): Promise<void> {
    const now = Date.now();
    if (changes.battleDifficulty !== undefined) {
      await this.db.settings.update(profileId, {
        battleDifficulty: changes.battleDifficulty,
        updatedAt: now,
      });
    }
    if (changes.uiTheme !== undefined) {
      await this.db.settings.update(profileId, {
        uiTheme: changes.uiTheme,
        updatedAt: now,
      });
    }
    if (changes.preserveAdventureSave !== undefined) {
      const global = await this.ensureGlobalSettings();
      await this.db.settings.put({
        ...global,
        preserveAdventureSave: changes.preserveAdventureSave,
        sharedProfileId: changes.preserveAdventureSave
          ? profileId
          : global.sharedProfileId,
        updatedAt: now,
      });
      await this.db.settings
        .toCollection()
        .modify((entry) => {
          entry.preserveAdventureSave = changes.preserveAdventureSave ?? false;
          entry.updatedAt = now;
        });
    }
  }
}
