# 凯利安创意工坊 AI 制作手册

## 可复制给 AI 的制作指令

请为《凯利安》生成一个可直接导入创意工坊的职业包，并只输出一个 JSON 对象。

- 顶层格式必须是 `caelian_workshop_class_pack`，`version` 必须为 `1`。
- 每个职业包含名称、大类、说明、天赋、8–16 种不同卡牌、16–32 张职业卡池和正好 15 张基础构筑。
- 卡牌稀有度由作者选择：`common`、`uncommon`、`rare`、`epic` 或 `legendary`。
- 只使用本手册列出的效果、目标和条件字段。
- 同一张卡牌不要重复使用同类效果；需要多个步骤时使用不同效果或一个条件效果组。
- 引用自定义资源、状态或代码机制时，把对应机制放进顶层 `mechanisms`，并把机制 ID 加入职业的 `mechanismIds`。
- 描述文本要与实际 JSON 效果一致。
- 不要输出 Markdown 代码围栏、解释或额外文字。

## 导入与保存

职业包通过结构、引用和脚本沙箱校验后会直接保存并启用，可立即用于新建角色、转职、可选测试场和卡牌广场投稿。隔离测试场是作者主动使用的工具，不是保存步骤。

旧版本留在本机测试区的有效职业会在首次打开新版时自动迁移到正式职业目录。

## 职业包格式

```json
{
  "format": "caelian_workshop_class_pack",
  "version": 1,
  "packName": "星辉旅者职业包",
  "author": "作者名",
  "classes": [
    {
      "id": "custom_class_starlight_walker",
      "main": "mage",
      "name": "星辉旅者",
      "description": "操纵星辉、护盾与抽牌。",
      "talent": {
        "name": "星轨",
        "description": "战斗开始获得护盾。",
        "effects": [
          { "type": "battle_start_shield", "value": 12 }
        ]
      },
      "cards": [
        {
          "id": "starlight_card_01",
          "name": "星芒",
          "type": "attack",
          "cost": 1,
          "rarity": "common",
          "description": "造成伤害。",
          "tags": ["星辉", "法术"],
          "effects": [
            { "type": "damage", "value": 12, "target": "enemy" }
          ]
        },
        {
          "id": "starlight_card_02",
          "name": "星幕",
          "type": "defense",
          "cost": 1,
          "rarity": "common",
          "description": "获得护盾。",
          "tags": ["星辉", "护盾"],
          "effects": [
            { "type": "shield", "value": 12, "target": "self" }
          ]
        },
        {
          "id": "starlight_card_03",
          "name": "观星",
          "type": "skill",
          "cost": 1,
          "rarity": "uncommon",
          "description": "抽两张牌。",
          "tags": ["星辉", "抽牌"],
          "effects": [
            { "type": "draw", "value": 2, "target": "self" }
          ]
        },
        {
          "id": "starlight_card_04",
          "name": "星愈",
          "type": "skill",
          "cost": 1,
          "rarity": "rare",
          "description": "恢复生命。",
          "tags": ["星辉", "回复"],
          "effects": [
            { "type": "heal", "value": 18, "target": "self" }
          ]
        },
        {
          "id": "starlight_card_05",
          "name": "流星雨",
          "type": "attack",
          "cost": 3,
          "rarity": "epic",
          "description": "对所有敌人造成伤害。",
          "tags": ["星辉", "群攻"],
          "effects": [
            { "type": "damage", "value": 24, "target": "all_enemies" }
          ]
        },
        {
          "id": "starlight_card_06",
          "name": "星尘",
          "type": "skill",
          "cost": 0,
          "rarity": "common",
          "description": "恢复魔力。",
          "tags": ["星辉", "资源"],
          "effects": [
            { "type": "gain_mp", "value": 8, "target": "self" }
          ]
        },
        {
          "id": "starlight_card_07",
          "name": "星锁",
          "type": "skill",
          "cost": 2,
          "rarity": "rare",
          "description": "对敌人施加缠绕。",
          "tags": ["星辉", "控制"],
          "effects": [
            {
              "type": "apply_debuff",
              "debuff": "entangle",
              "turns": 2,
              "target": "enemy"
            }
          ]
        },
        {
          "id": "starlight_card_08",
          "name": "星灵",
          "type": "summon",
          "cost": 3,
          "rarity": "legendary",
          "description": "召唤星灵。",
          "tags": ["星辉", "召唤"],
          "effects": [
            {
              "type": "summon",
              "name": "星灵",
              "attackable": true,
              "hp_ratio": 40,
              "unique_by_name": true,
              "skills": [
                {
                  "name": "星击",
                  "weight": 1,
                  "effects": [
                    { "type": "damage", "value": 10, "target": "enemy" }
                  ]
                }
              ]
            }
          ]
        }
      ],
      "cardPool": [
        "starlight_card_01", "starlight_card_01",
        "starlight_card_02", "starlight_card_02",
        "starlight_card_03", "starlight_card_03",
        "starlight_card_04", "starlight_card_04",
        "starlight_card_05", "starlight_card_05",
        "starlight_card_06", "starlight_card_06",
        "starlight_card_07", "starlight_card_07",
        "starlight_card_08", "starlight_card_08"
      ],
      "starterDeck": [
        "starlight_card_01", "starlight_card_01",
        "starlight_card_02", "starlight_card_02",
        "starlight_card_03", "starlight_card_03",
        "starlight_card_04", "starlight_card_04",
        "starlight_card_05", "starlight_card_05",
        "starlight_card_06", "starlight_card_06",
        "starlight_card_07", "starlight_card_07",
        "starlight_card_08"
      ],
      "mechanismIds": []
    }
  ]
}
```

## 顶层与职业字段

- `format`：固定为 `caelian_workshop_class_pack`。
- `version`：固定为 `1`。
- `packName`、`author`：职业包展示信息。
- `classes`：一个或多个职业。
- `mechanisms`：可选，随包携带的声明式或代码机制。
- `main`：`knight`、`mage`、`artisan` 或 `freelance`。
- `id`：稳定且唯一，建议以 `custom_class_` 开头。
- `talent.effects`：最多 4 个互不重复的天赋效果。
- `cards`：8–16 种名称和 ID 均不重复的卡牌。
- `cardPool`：16–32 个卡牌 ID，且每种职业卡至少出现一次。
- `starterDeck`：正好 15 个卡牌 ID，数量不能超过 `cardPool` 中的持有数量。同名卡可放入任意份数，只要卡池持有量足够。
- `mechanismIds`：该职业启用的机制 ID。

## 卡牌字段

每张卡牌包含：

- `id`、`name`、`description`。
- `type`：`attack`、`defense`、`skill` 或 `summon`。
- `cost`：非负 AP 费用。
- `rarity`：作者选择的五档稀有度之一；省略时为 `common`。
- `tags`：最多 12 个作者自定义标签，代码机制可读取。
- `effects`：1–8 个效果。召唤牌必须含 `summon`，其他类型不能含 `summon`。
- `damage.hits`：多段伤害次数；为防止同步执行阻塞页面，单个效果最多执行 64 段。

支持的常用效果类型：

`damage`、`shield`、`heal`、`draw`、`gain_ap`、`gain_mp`、`apply_buff`、`apply_debuff`、`cleanse`、`dispel`、`strip_shield`、`strip_buffs`、`thorns`、`trap`、`damage_from_shield`、`damage_per_debuff`、`discard`、`recover_discard`、`discard_all_damage`、`generate_blank_to_draw`、`blank_regen`、`discard_blank_damage`、`destroy_summon`、`spend_mp_damage`、`spend_mp_shield`、`mp_to_ap`、`reveal_intent`、`summon`、`conditional_bonus`、`conditional_group`、`workshop_resource_change`、`apply_workshop_status`。

数值效果可使用固定值，也可增加属性公式：

```json
{
  "type": "damage",
  "value": 8,
  "target": "enemy",
  "scaling": { "stat": "attack", "percent": 125 }
}
```

`stat` 可用：`hp`、`attack`、`shield`、`defense`、`mp`。

常用目标：

- 敌方：`enemy`、`all_enemies`、`random_enemy`。
- 友方：`self`、`all_allies`、`random_allies`、`selected_allies`。
- 召唤物：`all_summons`、`random_summons`、`selected_summons`。

随机或指定多个目标时使用 `target_count`。

## 条件效果组

`conditional_group` 至少需要一个条件和一个 `then_effects` 效果：

```json
{
  "type": "conditional_group",
  "logic": "and",
  "conditions": [
    { "type": "spend_mp", "amount": 4 },
    { "type": "enemy_has_debuff" }
  ],
  "then_effects": [
    { "type": "damage", "value": 30, "target": "enemy" }
  ],
  "else_effects": [
    { "type": "shield", "value": 8, "target": "self" }
  ]
}
```

条件类型：

`self_has_shield`、`self_no_shield`、`enemy_has_shield`、`enemy_no_shield`、`enemy_has_debuff`、`enemy_no_debuff`、`enemy_has_specific_debuff`、`enemy_no_specific_debuff`、`self_has_buff`、`self_no_buff`、`self_full_hp`、`self_not_full_hp`、`has_summon`、`no_summon`、`same_card_played_this_turn`、`previous_card_same_name`、`spend_mp`、`spend_hp`、`discard`、`destroy_summon`、`spend_workshop_resource`。

支付 HP 后至少保留 1 HP。条件只决定是否执行“则”，不会自行产生战斗效果。

## 天赋效果

可用类型：

`battle_start_shield`、`turn_start_heal`、`attack_bonus`、`shield_bonus`、`extra_draw`、`first_turn_ap`、`damage_reduction`、`always_reveal_intent`、`turn_start_cleanse`、`turn_start_debuff_shield`、`hand_limit_bonus`、`defense_reflect`、`counterattack`、`apply_workshop_status`、`workshop_resource_change`。

`always_reveal_intent`、`defense_reflect` 和 `counterattack` 是开关型效果，不需要 `value`。

## 自定义状态与资源

引用自定义状态：

```json
{
  "type": "apply_workshop_status",
  "mechanismId": "author.star-system",
  "statusId": "starlit",
  "value": 3,
  "turns": 4,
  "target": "self"
}
```

修改自定义资源：

```json
{
  "type": "workshop_resource_change",
  "mechanismId": "author.star-system",
  "resourceId": "stardust",
  "mode": "add",
  "value": 5,
  "target": "self"
}
```

声明式机制格式固定为 `caelian_workshop_mechanism`，可定义资源、状态和触发规则。资源包含 `min`、`max`、`initial`；状态包含性质、说明和状态效果；规则包含触发时机、可选条件和动作列表。

## 代码机制与沙箱

只有现有积木和声明式规则无法表达设计时，才使用代码机制。格式固定为 `caelian_workshop_script_mechanism`，脚本接收只读战斗快照并返回受控动作，不直接修改页面或存档。

沙箱边界：

- 无页面、聊天记录、存档、变量管理器、网络或浏览器存储权限。
- 单次执行限时 50ms，沙箱内存 8MB，返回值 64KB。
- 递归与动作链最多 64 步；连续失败 3 次后，本场战斗停用该机制。
- 导入前显示明确确认框并执行语法与返回结构校验。
- 无限循环、超大返回值、未知动作或损坏引用会被拒绝或停止执行。

脚本返回的动作仍必须使用游戏开放的受控指令，例如伤害、护盾、治疗、状态、资源变动、弃牌、回收或日志。

## 导出前检查

1. JSON 能被解析，顶层格式和版本正确。
2. 职业、卡牌和机制 ID 稳定且不重复。
3. 卡牌数、卡池数和基础构筑数满足格式要求。
4. 基础构筑中的每张牌都存在于卡池，卡池中的每种卡都存在于 `cards`。
5. 效果类型、目标、条件和天赋类型来自本手册。
6. 机制、资源和状态引用均有对应定义，且职业已在 `mechanismIds` 中启用。
7. 召唤技能至少一个，权重大于零。
8. 代码机制通过沙箱确认与校验。
