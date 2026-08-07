export const MVU_SCHEMA_SCRIPT_ID =
  'edfcaddc-2475-46e8-a0d9-f14a2e6558b2';

export const mvuSchemaContent = `import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.looseObject({
  caelian: z.looseObject({
    _meta: z.looseObject({
      schemaVersion: z.literal(3).prefault(3),
      owner: z.literal('caelian-alpha').prefault('caelian-alpha'),
      channel: z.enum(['alpha', 'beta', 'release']).prefault('alpha'),
      revision: z.coerce.number().int().prefault(0),
    }).prefault({}),

    // state 由浏览器内核整体生成，AI 只读。数组仅用于匹配前端只读摘要，禁止 AI 按索引更新。
    state: z.looseObject({
      player: z.looseObject({
        name: z.string().prefault('冒险者'),
        profession: z.string().prefault('未选择'),
        level: z.coerce.number().int().prefault(1),
        hp: z.coerce.number().prefault(80),
        hpMax: z.coerce.number().prefault(80),
        mp: z.coerce.number().prefault(30),
        mpMax: z.coerce.number().prefault(30),
        gold: z.coerce.number().int().prefault(500),
      }).prefault({}),
      world: z.looseObject({
        region: z.string().prefault('伊拉亚城'),
        location: z.string().prefault('圣德里安学院-宿舍楼'),
        gameDate: z.string().prefault('新圣约历1385-09-01'),
        gameTime: z.string().prefault('08:00'),
        weather: z.string().prefault('晴朗'),
        accessibleRegions: z.array(z.string()).prefault([]),
      }).prefault({}),
      guild: z.looseObject({
        rank: z.string().prefault('unregistered'),
        activeQuests: z.array(z.looseObject({
          id: z.string().prefault(''),
          kind: z.string().prefault('task'),
          title: z.string().prefault(''),
          region: z.string().prefault(''),
          objective: z.string().prefault(''),
          status: z.string().prefault('active'),
          currentStage: z.coerce.number().int().prefault(0),
          totalStages: z.coerce.number().int().prefault(1),
        })).prefault([]),
      }).prefault({}),
      battle: z.looseObject({
        active: z.boolean().prefault(false),
        status: z.string().prefault('none'),
        phase: z.string().prefault('none'),
        source: z.string().prefault(''),
        relatedQuestId: z.string().prefault(''),
        turn: z.coerce.number().int().prefault(0),
        enemies: z.array(z.looseObject({
          name: z.string().prefault(''),
          hp: z.coerce.number().prefault(0),
          hpMax: z.coerce.number().prefault(0),
        })).prefault([]),
        result: z.looseObject({
          experience: z.coerce.number().int().prefault(0),
          gold: z.coerce.number().int().prefault(0),
          items: z.array(z.string()).prefault([]),
        }).nullable().prefault(null),
      }).prefault({}),
      companion: z.looseObject({
        relationshipStage: z.string().prefault('陌生人'),
      }).prefault({}),
    }).prefault({}),

    // narrative 是唯一允许 AI 更新的区域；浏览器只读取、校验并显示。
    narrative: z.looseObject({
      companion: z.looseObject({
        affinity: z.coerce.number()
          .transform(value => _.clamp(Math.round(value), 0, 100))
          .prefault(0),
        mood: z.string().transform(value => value.slice(0, 80)).prefault('平静'),
        location: z.string().transform(value => value.slice(0, 120)).prefault('圣德里安学院'),
        clothing: z.string().transform(value => value.slice(0, 240)).prefault('白色暗纹衬衫搭配红金色马甲'),
        innerThought: z.string().transform(value => value.slice(0, 500)).prefault(''),
      }).prefault({}),
      world: z.looseObject({
        region: z.string().transform(value => value.slice(0, 120)).prefault('伊拉亚城'),
        place: z.string().transform(value => value.slice(0, 120)).prefault('宿舍楼'),
        location: z.string().transform(value => value.slice(0, 180)).prefault('圣德里安学院-宿舍楼'),
        gameDate: z.string().transform(value => value.slice(0, 80)).prefault('新圣约历1385-09-01'),
        gameTime: z.string().transform(value => value.slice(0, 40)).prefault('08:00'),
        weather: z.string().transform(value => value.slice(0, 80)).prefault('晴朗'),
      }).prefault({}),
      storyFlags: z.record(z.string(), z.boolean()).prefault({}),
    }).prefault({}),
  }).prefault({}),
}).prefault({});

$(() => {
  registerMvuSchema(Schema);
});`;

export const initvarContent = `caelian:
  _meta:
    schemaVersion: 3
    owner: caelian-alpha
    channel: alpha
    revision: 0
  state:
    player:
      name: 冒险者
      profession: 未选择
      level: 1
      hp: 80
      hpMax: 80
      mp: 30
      mpMax: 30
      gold: 500
    world:
      region: 伊拉亚城
      location: 圣德里安学院-宿舍楼
      gameDate: 新圣约历1385-09-01
      gameTime: "08:00"
      weather: 晴朗
      accessibleRegions: []
    guild:
      rank: unregistered
      activeQuests: []
    battle:
      active: false
      status: none
      phase: none
      source: ""
      relatedQuestId: ""
      turn: 0
      enemies: []
      result: null
    companion:
      relationshipStage: 陌生人
  narrative:
    companion:
      affinity: 0
      mood: 平静
      location: 圣德里安学院
      clothing: 白色暗纹衬衫搭配红金色马甲
      innerThought: ""
    world:
      region: 伊拉亚城
      place: 宿舍楼
      location: 圣德里安学院-宿舍楼
      gameDate: 新圣约历1385-09-01
      gameTime: "08:00"
      weather: 晴朗
    storyFlags: {}`;

export const variableRulesContent = `---
变量更新规则:
  stat_data.caelian.narrative:
    check:
      - stat_data.caelian 是供 AI 读取的最小投影，不是完整存档。
      - stat_data.caelian._meta 与 stat_data.caelian.state 完全由浏览器内核生成，AI 禁止更新、插入或删除。
      - AI 只能更新 stat_data.caelian.narrative；JSON Patch 以 stat_data 为根，因此 path 从 /caelian/narrative/ 开始。
      - 背包、装备、卡牌、牌组、任务进度、战斗过程、市场、合成、成就与设置保存在浏览器本地，禁止在 MVU 中复制或新建。

    companion:
      affinity:
        type: number
        range: 0~100
        check:
          - 根据玩家在当前场景中对凯利安的行为调整 ±1~5；只有重大情感事件可以调整 ±6~10。
          - 凯利安不在场且无法得知事件时保持原值。
      mood:
        check:
          - 仅在情绪确实变化时更新，使用不超过80字的短语。
      location:
        check:
          - 凯利安实际移动后更新；不能因为玩家计划前往某处就提前改写。
      clothing:
        check:
          - 仅在换装或服装明显改变时更新，使用不超过240字的简短描述。
      innerThought:
        check:
          - 每轮必须更新为凯利安当下真实的1~2句私密想法，玩家角色无法直接得知，不超过500字。

    world:
      type: |-
        { region: string; place: string; location: string; gameDate: string; gameTime: string; weather: string }
      check:
        - 只在正文已经确认实际移动后更新；地图快捷前往会由浏览器先写入统一地点，AI 应沿用该值继续描写，不能改回出发地。
        - region 必须且只能填写以下标准大地区名之一：圣德里安学院、伊拉亚城、索拉维亚、奈亚索斯城、阿必塞海、艾瑟拉森林、炉心城、远古圣山、银月之城、极北之地。
        - 索拉姆、索拉姆城、皇都、皇城统一写为“索拉维亚”；学院、宿舍、教学楼等地点所属大地区统一写为“圣德里安学院”。禁止把别名或具体建筑写进 region。
        - place 只填写 region 内的具体建筑、街区或场景；没有明确小地点时写空字符串，禁止把另一个大地区写进 place。
        - location 不得自由发挥，必须严格等于“region · place”；place 为空时 location 必须严格等于 region。
        - 玩家实际移动时，region、place、location 必须在同一个 JSONPatch 中一起 replace，三者不得互相矛盾。
        - gameDate、gameTime 按剧情中实际经过的时间更新；weather 只在天气确实变化时更新。

    storyFlags:
      type: "{ [标记名: string]: boolean }"
      check:
        - 只记录避免剧情重复所必需的一次性布尔标记；标记名稳定、简短、明确，最多64个。
        - 禁止写入任务对象、物品、数值进度、日志或整段剧情文本。`;

export const variableListContent = `---
<status_current_variables>
{{format_message_variable::stat_data}}
</status_current_variables>`;

export const variableOutputContent = `---
变量输出格式:
  rule:
    - 必须在每次回复末尾输出且只输出一个 <UpdateVariable> 块，不得省略。
    - <Analysis> 只简要核对本轮实际变化与路径，最多80字，不展开推理过程。
    - <JSONPatch> 必须是合法 JSON 数组，只允许 replace、delta、insert、remove、move。
    - JSON Patch 以 stat_data 为根；所有 path 必须以 /caelian/narrative/ 开头，禁止添加 /stat_data 前缀。
    - 禁止修改 /caelian/_meta、/caelian/state 或任何旧版顶层变量。
    - innerThought 每轮使用 replace 更新；其他字段没有实际变化时不要输出。
    - 世界地点发生变化时，必须同时 replace /caelian/narrative/world/region、/place、/location；location 只能由 region 与 place 按“地区 · 地点”拼成。
    - affinity 优先使用 delta；新剧情标记使用 insert，已有标记使用 replace，删除无效标记可使用 remove。
    - move 只允许在 /caelian/narrative/storyFlags/ 内重命名错误标记，通常不应使用。
  format: |-
    <UpdateVariable>
    <Analysis>
    {{用不超过80字说明本轮哪些可写变量发生变化，并确认所有路径均在 /caelian/narrative/ 下。}}
    </Analysis>
    <JSONPatch>
    [
      { "op": "replace", "path": "/caelian/narrative/companion/innerThought", "value": "凯利安当下真实的1~2句私密想法" }
    ]
    </JSONPatch>
    </UpdateVariable>`;

export const phaseControllerContent = `<%_
if (typeof kailianFavor === 'undefined') var kailianFavor = getvar('stat_data.caelian.narrative.companion.affinity', { defaults: 0 });
_%>

<%_ if (kailianFavor >= 100) { _%>
<%- await getwi(null, '凯利安_阶段05_伴侣') %>
<%_ } else if (kailianFavor >= 81) { _%>
<%- await getwi(null, '凯利安_阶段04_恋人') %>
<%_ } else if (kailianFavor >= 51) { _%>
<%- await getwi(null, '凯利安_阶段03_暧昧对象') %>
<%_ } else if (kailianFavor >= 21) { _%>
<%- await getwi(null, '凯利安_阶段02_伙伴') %>
<%_ } else { _%>
<%- await getwi(null, '凯利安_阶段01_陌生人') %>
<%_ } _%>`;
