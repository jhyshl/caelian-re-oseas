import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const guide = readFileSync(
  resolve(process.cwd(), 'public/docs/caelian-workshop-ai-guide.md'),
  'utf8',
);
const currentWorkshopSurfaces = [
  'src/modules/deck/WorkshopDialog.vue',
  'src/modules/deck/WorkshopEffectEditor.vue',
  'src/modules/deck/WorkshopEffectPalette.vue',
  'src/modules/deck/CardSquareDialog.vue',
]
  .map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
  .join('\n');

describe('创意工坊 AI 制作手册', () => {
  it('把可复制指令放在职业格式之前，并说明保存后直接启用', () => {
    expect(guide.startsWith('# 凯利安创意工坊 AI 制作手册')).toBe(true);
    expect(guide.indexOf('## 可复制给 AI 的制作指令')).toBeLessThan(
      guide.indexOf('## 职业包格式'),
    );
    expect(guide).toContain('直接保存并启用');
    expect(guide).toContain('隔离测试场是作者主动使用的工具，不是保存步骤');
  });

  it('只说明结构、引用与沙箱规则，不再提供评分或折扣字段', () => {
    expect(guide).not.toMatch(/强度|平衡|评定|静态预算|powerScore|discount/);
    expect(guide).toContain('稀有度由作者选择');
    expect(guide).toContain('同名卡可放入任意份数');
    expect(guide).toContain('结构、引用和脚本沙箱校验');
  });

  it('当前工坊界面不再展示强度门槛或旧同名卡限制', () => {
    expect(currentWorkshopSurfaces).not.toMatch(
      /三轮评定|强度评分|强度限制|数值平衡|静态预算|可支配强度|同名卡最多\s*3/,
    );
  });

  it('说明玩家标签、条件格式、代码机制和沙箱边界', () => {
    expect(guide).toContain('代码机制可读取');
    expect(guide).toContain('conditional_group');
    expect(guide).toContain('caelian_workshop_script_mechanism');
    expect(guide).toContain('单次执行限时 50ms');
    expect(guide).toContain('沙箱内存 8MB');
    expect(guide).toContain('返回值 64KB');
    expect(guide).toContain('动作链最多 64 步');
  });
});
