import { describe, expect, it } from 'vitest';
import {
  formatStoryBattleResult,
  parseStoryBattleStart,
} from '@/battle/story-bridge';
import type { BattleSessionRecord } from '@/domain/types';

describe('story battle bridge', () => {
  it('解析中英文字段并限制敌人数量', () => {
    expect(
      parseStoryBattleStart(`<!--\n<BattleStart>\n怪物：血狼\n数量：99\n原因：林间伏击\n玩家参战：是\n凯利安同行：是\n</BattleStart>\n-->`),
    ).toEqual({
      monster: '血狼',
      count: 12,
      reason: '林间伏击',
      userInvolved: true,
      caelianPresent: true,
    });
    expect(parseStoryBattleStart('普通剧情')).toBeNull();
  });

  it('只在user明确参战时接受战斗标记', () => {
    expect(
      parseStoryBattleStart(
        '<BattleStart>\nmonster: mon_slime\ncount: 1\ncaelian_present: true\n</BattleStart>',
      ),
    ).toBeNull();
    expect(
      parseStoryBattleStart(
        '<BattleStart>\nmonster: mon_slime\nuser_involved: false\ncaelian_present: true\n</BattleStart>',
      ),
    ).toBeNull();
    expect(
      parseStoryBattleStart(
        '<BattleStart>\nmonster: mon_slime\nuser_involved: true\ncaelian_present: false\n</BattleStart>',
      ),
    ).toMatchObject({ userInvolved: true, caelianPresent: false });
  });

  it('把已经结算的本地战斗压缩成主 API 可读结果', () => {
    const session = {
      source: '护送委托',
      state: {
        status: 'victory',
        turn: 3,
        player: { hp: 44, hpMax: 60, mp: 12, mpMax: 20 },
        enemies: [{ name: '血狼' }, { name: '血狼' }],
        rewards: {
          experience: 30,
          gold: 50,
          guildExperience: 10,
          items: [{ id: 'fang', name: '狼牙', quantity: 2 }],
        },
        log: [],
      },
    } as unknown as BattleSessionRecord;
    const result = formatStoryBattleResult(session);
    expect(result).toContain('status: victory');
    expect(result).toContain('enemy: 血狼');
    expect(result).toContain('loot: 狼牙×2');
    expect(result).toContain('caelian: absent');
  });
});
