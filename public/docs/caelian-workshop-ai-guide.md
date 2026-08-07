# 凯利安创意工坊 AI 制作手册

适用格式版本：`1`。把本文件完整交给 AI，并说明你想制作的职业、卡组或底层机制。AI 最终必须只输出一个可保存为 `.json` 的 JSON 对象，不要输出 JavaScript、Markdown 代码围栏或解释文字。保存后在“创意工坊 → 导入”中校验；职业与底层机制公开到卡牌广场前需要作者审核。

## 最先复制给 AI 的制作指令

直接复制下面整段，并把方括号里的内容换成你的需求：

```text
请完整阅读我随后提供的《凯利安创意工坊 AI 制作手册》，严格按照格式版本 1 制作【职业包 / 效果预设扩展 / 底层机制包】。

主题：【填写主题】
核心循环：【填写玩法循环】
强度目标：【填写偏保守 / 标准 / 较强但必须合法】
其他需求：【填写职业定位、卡牌风格或机制细节】

制作职业包时必须满足：
1. 使用 8–16 种不同名称、不同 ID 的卡牌，完整 cardPool 为 16–32 张，starterDeck 正好 15 张。
2. starterDeck 与 cardPool 只能引用本职业 cards 中的 ID，且每个 ID 的使用次数不能超过 cardPool 持有数。
3. 职业依赖新机制时，把完整机制放在职业包根级 mechanisms 中，并由 mechanismIds 引用。
4. 只使用手册列出的字段、效果、条件、触发器、公式和动作，不得输出任意代码或未定义效果。
5. 生成后必须在内部执行手册中的“AI 强度校验器”：逐张计算卡牌强度和费用上限，计算天赋总强度，并完成结构、引用、唯一性与循环风险检查。任何一项失败都要先自行修改并重新校验，直到全部通过。
6. 最终只输出一个有效 JSON 对象，不要输出校验过程、解释文字或 Markdown 代码围栏。
```

## AI 强度校验器（生成后必须执行）

这部分逐项抄录自创意工坊当前实际使用的 `cardScore`、`cardLimit`、`rarityFromScore` 和 `talentScore`，不是另一套近似规则。AI 必须在输出最终 JSON 前在内部完成计算；`powerScore` 和 `rarity` 即使填写，导入时也会按同一组函数重新计算。

### 1. 卡牌费用上限

先把一张卡所有效果的分数相加，只有 `总分 ≤ 对应 cost 上限` 才通过：

| cost | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 上限 | 10 | 22 | 36 | 52 | 68 | 86 | 106 | 128 | 152 | 178 | 206 |

目标倍率 `M`：单体或自身为 `1`；`all_enemies=1.6`；`all_allies=1.5`；`all_summons=1.4`；`random_enemy`/`random_allies` 为 `0.85 × target_count`；`selected_allies` 为 `1 + 0.55 × (target_count - 1)`；`random_summons` 为 `0.75 × target_count`；`selected_summons` 为 `0.9 × target_count`。

持续回合折扣 `D`：1 回合为 `1`，2 回合为 `0.85`，3 回合为 `0.75`，4 回合为 `0.65`，5 回合及以上为 `0.6`。

常规效果分数：

| 效果 | 分数公式 |
| --- | --- |
| `damage` | `(value + lifesteal_ratio × 12) × M` |
| `shield` | `value × 0.75 × M` |
| `heal` | `value × 0.85 × M` |
| `draw` | `value × 6` |
| `gain_ap` | `value × 9` |
| `gain_mp` | `value × 0.75` |
| `mp_to_ap` | `max(0, value × 9 - amount × 0.65)` |
| `spend_mp_damage` | `max(0, value × max(1, amount) × 0.85 - amount × 0.55) × M` |
| `spend_mp_shield` | `max(0, value × max(1, amount) × 0.62 - amount × 0.55) × M` |
| `cleanse` | 单个 `amount × 6`，`all=18`，再乘 `M` |
| `dispel` | 单个 `amount × 6`，`all=14`，再乘 `M` |
| `strip_shield` / `strip_buffs` | `8 × M` / `14 × M` |
| `trap` | `value × 0.8 × M` |
| `damage_from_shield` | `ratio × 16 × M` |
| `damage_per_debuff` | `value × 2.2 × M` |
| `discard` | 单张 `amount × 2`，`all=6` |
| `recover_discard` | 单张 `amount × 5`，`all=18` |
| `destroy_summon` | 单个 `-amount × 14`，`all=-30` |
| `discard_all_damage` | `value × 5 × M` |
| `reveal_intent` | `5` |

`apply_debuff`：基础分依次为 `freeze=14`、`entangle=10`、`weak=7`、`vulnerable=8`、`burn=4`、`poison=4`；分数为 `基础分 × turns × M`。

`apply_buff`：每回合基础分依次为 `strength=6`、`fortitude=5`、`agility=5`、`regen=4`、`thorns=4`、`ap_regen=9`、`draw_regen=7`、`shield_regen=3`、`heal_regen=3.5`、`damage_bonus=4`、`spell_damage_bonus=4`、`damage_reduce=4`、`mp_regen=1.2`、`blood_burn=3`。分数为 `基础分 × max(1, value) × turns × D × M`；`blood_burn` 最后再乘 `0.72`。

`conditional_group`：分别汇总 `then_effects` 与 `else_effects`。每个条件使用默认折扣：`self_has_shield=0.86`、`self_no_shield=0.9`、`enemy_has_shield=0.86`、`enemy_no_shield=0.9`、`enemy_has_debuff=0.84`、`enemy_no_debuff=0.92`、`enemy_has_specific_debuff=0.8`、`enemy_no_specific_debuff=0.9`、`self_has_buff=0.9`、`self_no_buff=0.92`、`self_full_hp=0.82`、`self_not_full_hp=0.88`、`has_summon=0.82`、`no_summon=0.95`、`spend_mp=0.74`、`discard=0.78`、`destroy_summon=0.62`。`and` 将折扣相乘，`or` 取最大折扣；最终分数为 `max(then 总分 × 条件折扣, else 总分)`。

`summon`：先把技能 `weight` 归一化为总和 1，再算单回合期望分 `E=Σ(技能内效果分 × 归一化 weight)`。可攻击召唤物的预计存活回合按 `hp_ratio` 计算：`≤20→1`、`≤35→2`、`≤50→3`、`≤75→4`、`>75→5`，总分为 `hp_ratio × 0.28 + E × 预计回合`；不可攻击召唤物为 `E × max(1,duration) × 1.15`。

自动稀有度：总分 `<30` 为 `common`，`30–57.999` 为 `uncommon`，`58–89.999` 为 `rare`，`90–129.999` 为 `epic`，`≥130` 为 `legendary`。

### 2. 天赋上限

天赋最多 4 个不同类型词条，总分必须 `≤24`：

- `battle_start_shield`：`value × 0.7`
- `turn_start_heal`、`attack_bonus`：`value × 4`
- `shield_bonus`：`value × 35`
- `extra_draw`、`first_turn_ap`：`value × 9`
- `damage_reduction`：`value × 6`
- `always_reveal_intent`：`8`
- `turn_start_cleanse`：`value × 10`
- `turn_start_debuff_shield`：`value × 1.2`

### 3. 最终检查清单

- 所有包、职业、卡牌、机制、资源和规则 ID 唯一，引用目标全部存在。
- 每张卡最多 8 个效果；同一张卡中，同类效果、同名 buff/debuff 和同条件加成不重复。
- 召唤牌必须含 `summon`，非召唤牌不得含 `summon`；召唤物最多 3 个技能，每个技能最多 3 个效果。
- 卡牌种类、cardPool、starterDeck 数量与重复次数全部合法。
- 天赋总分不超过 24，每张卡总分不超过费用上限；若超限，优先提高 cost 或降低数值，不得伪造 `powerScore`。
- 机制不存在同一触发器下无条件互相触发的循环；资源有明确上下限，规则能够解释并可在测试场验证。

## 安全边界

- 扩展只能使用下面列出的声明式字段，不能执行任意 JavaScript、访问网络、读取聊天记录或修改存档。
- ID 只使用小写英文字母、数字、点、下划线、冒号和短横线，并加上作者前缀避免重名。
- 单个职业必须包含 8–16 种不同名称的卡牌；`cardPool` 总计 16–32 张，`starterDeck` 必须正好 15 张，且两者只能引用本职业卡牌 ID。
- 数值会被导入器限制，超限、未知字段或不支持的效果会被拒绝或移除。
- 新底层机制应保持可解释、可预估，避免无限循环；运行时还有嵌套深度和动作数量上限。

## 一、职业包

根格式：

```json
{
  "format": "caelian_workshop_class_pack",
  "version": 1,
  "packName": "星辉守望者职业包",
  "author": "作者名或匿名冒险者",
  "exported_at": "2026-08-07T00:00:00.000Z",
  "classes": [],
  "mechanisms": []
}
```

每个 `classes` 成员：

```json
{
  "id": "author.star-warden",
  "main": "mage",
  "name": "星辉守望者",
  "description": "积累星辉并在关键回合爆发。",
  "talent": {
    "name": "观星者",
    "description": "每场战斗开始获得 1 点额外抽牌。",
    "effects": [{ "type": "extra_draw", "value": 1 }]
  },
  "cards": [],
  "cardPool": [],
  "starterDeck": [],
  "mechanismIds": ["author.starlight"],
  "custom": true
}
```

`main` 只能为 `knight`、`mage`、`artisan`、`freelance`。`cards` 放 8–16 个不同名称的卡牌定义；`cardPool` 按卡牌 ID 重复填写 16–32 项，代表玩家安装或转职后得到的完整职业卡池；`starterDeck` 从该卡池中取正好 15 项作为基础构筑。基础构筑以外的卡也会进入卡牌收藏，玩家可继续自行修改构筑；使用自制职业战斗胜利后的卡牌三选一只会从该职业卡池抽取。

`mechanismIds` 可省略。职业依赖新机制时，把完整机制对象放入职业包根级的 `mechanisms` 数组；导入、下载或从卡牌广场安装职业时会同时安装这些机制。仍可单独导入同 ID 的机制包。

天赋效果可选：

- `battle_start_shield`：战斗开始获得护盾，`value` 0–20。
- `turn_start_heal`：回合开始恢复生命，`value` 0–5。
- `attack_bonus`：攻击牌额外伤害，`value` 0–5。
- `shield_bonus`：护盾效果比例加成，`value` 0–0.5。
- `extra_draw`：每回合额外抽牌，`value` 0–2。
- `first_turn_ap`：第一回合额外 AP，`value` 0–2。
- `damage_reduction`：受到伤害降低，`value` 0–3。
- `always_reveal_intent`：始终显示敌人意图，`value` 为 0。
- `turn_start_cleanse`：回合开始净化，`value` 为 1。
- `turn_start_debuff_shield`：有减益时获得护盾，`value` 0–8。

卡牌格式：

```json
{
  "id": "author.star-warden.star-bolt",
  "name": "星辉弹",
  "type": "attack",
  "cost": 1,
  "mpCost": 0,
  "rarity": "common",
  "description": "造成 8 点伤害。",
  "effects": [{ "type": "damage", "value": 8, "target": "enemy" }],
  "custom": true,
  "powerScore": 8
}
```

卡牌 `type` 使用 `attack`、`defense`、`skill`、`summon`；`rarity` 使用 `common`、`uncommon`、`rare`、`epic`、`legendary`。`powerScore` 只是建议值，导入时会重新校验。

常用卡牌效果：

- `damage`、`shield`、`heal`、`draw`、`gain_ap`、`gain_mp`：使用 `value`；目标常用 `enemy` 或 `self`。
- `apply_buff`：`buff` 可用 `strength`、`fortitude`、`agility`、`regen`、`thorns`、`ap_regen`、`draw_regen`、`shield_regen`、`heal_regen`、`damage_bonus`、`spell_damage_bonus`、`damage_reduce`、`mp_regen`、`blood_burn`；使用 `value`、`turns`。
- `apply_debuff`：`debuff` 可用 `burn`、`poison`、`weak`、`vulnerable`、`freeze`、`entangle`；使用 `value`、`turns`。
- `cleanse`、`dispel`、`discard`、`recover_discard`、`destroy_summon`：使用 `amount`。
- `strip_shield`、`strip_buffs`、`reveal_intent`：无需数值。
- `trap`、`damage_per_debuff`、`discard_all_damage`：使用 `value`。
- `damage_from_shield`：使用 `ratio`。
- `spend_mp_damage`、`spend_mp_shield`：`amount` 为消耗 MP，`value` 为每点倍率。
- `mp_to_ap`：`amount` 为消耗 MP，`value` 为获得 AP。
- `summon`：使用 `name`、`attackable`、`hp_ratio`、`unique_by_name`、`skills`；每个技能含 `name`、`weight`、`effects`。
- `conditional_group`：使用 `logic`（`and`/`or`）、`conditions`、`then_effects`、`else_effects`。

条件类型可用：`self_has_shield`、`self_no_shield`、`enemy_has_shield`、`enemy_no_shield`、`enemy_has_debuff`、`enemy_no_debuff`、`enemy_has_specific_debuff`、`enemy_no_specific_debuff`、`self_has_buff`、`self_no_buff`、`self_full_hp`、`self_not_full_hp`、`has_summon`、`no_summon`、`spend_mp`、`discard`、`destroy_summon`。

## 二、效果预设扩展

效果预设不会创造新的运行时代码，只把一组现有卡牌效果加入工坊的快捷选择器。

```json
{
  "format": "caelian_workshop_extension",
  "version": 1,
  "id": "author.starlight-presets",
  "name": "星辉效果预设",
  "author": "作者名",
  "description": "星辉守望者常用效果组合。",
  "presets": [
    {
      "id": "author.star-guard",
      "label": "星辉守护",
      "description": "获得护盾并抽一张牌。",
      "cardTypes": ["defense", "skill"],
      "effects": [
        { "type": "shield", "value": 8, "target": "self" },
        { "type": "draw", "value": 1, "target": "self" }
      ]
    }
  ]
}
```

## 三、底层机制包

底层机制是受限的“事件 → 条件 → 动作”规则，不允许脚本。完整示例：

```json
{
  "format": "caelian_workshop_mechanism",
  "version": 1,
  "id": "author.starlight",
  "name": "星辉",
  "author": "作者名",
  "description": "打出技能牌获得星辉，达到 3 点时消耗并造成伤害。",
  "resources": [
    {
      "id": "starlight",
      "label": "星辉",
      "description": "最多积累 5 点。",
      "min": 0,
      "max": 5,
      "initial": 0,
      "visible": true
    }
  ],
  "rules": [
    {
      "id": "author.starlight.gain",
      "trigger": "after_card",
      "priority": 10,
      "once": "never",
      "condition": { "type": "card_type", "value": "skill" },
      "actions": [{ "type": "resource_add", "resource": "starlight", "value": 1 }]
    },
    {
      "id": "author.starlight.burst",
      "trigger": "after_card",
      "priority": 0,
      "once": "never",
      "condition": {
        "type": "compare",
        "left": { "op": "resource", "id": "starlight" },
        "operator": "gte",
        "right": 3
      },
      "actions": [
        { "type": "resource_add", "resource": "starlight", "value": -3 },
        { "type": "damage", "target": "selected_enemy", "value": 9 },
        { "type": "log", "message": "星辉迸发！" }
      ]
    }
  ]
}
```

触发器：`battle_start`、`turn_start`、`turn_end`、`before_card`、`after_card`、`before_enemy_turn`、`after_enemy_turn`、`player_damaged`、`enemy_damaged`、`summon_created`、`summon_removed`、`battle_victory`、`battle_defeat`。

`once` 为 `never`、`turn` 或 `battle`。同一触发器按 `priority` 从高到低执行。

条件：

- `compare`：`left`、`operator`、`right`，比较符为 `eq`、`ne`、`gt`、`gte`、`lt`、`lte`。
- `all` / `any`：`conditions` 数组。
- `not`：单个 `condition`。
- `chance`：`value` 为 0–1。
- `card_type`：`value` 为卡牌类型。
- `has_buff` / `has_debuff`：`value` 为状态 ID，`target` 为 `player` 或 `selected_enemy`。

动作：`resource_add`、`resource_set`、`damage`、`heal`、`shield`、`draw`、`gain_ap`、`gain_mp`、`apply_buff`、`apply_debuff`、`cleanse`、`discard_random`、`recover_discard`、`log`。目标可为 `player`、`selected_enemy`、`all_enemies`；状态动作使用 `status` 和 `turns`。

数值可以直接写数字，也可以使用公式：

```json
{ "op": "mul", "args": [{ "op": "stat", "path": "player.attack" }, 0.5] }
```

公式操作：`stat`、`resource`、`event`、`add`、`sub`、`mul`、`div`、`min`、`max`、`floor`、`ceil`、`clamp`。

可读取状态：`player.hp`、`player.hpMax`、`player.mp`、`player.mpMax`、`player.shield`、`player.attack`、`player.defense`、`player.speed`、`player.ap`、`player.apMax`、`battle.turn`、`enemy.hp`、`enemy.hpMax`、`enemy.shield`、`enemy.attack`、`enemy.defense`、`enemies.alive`、`summons.count`、`hand.count`、`discard.count`。

职业若依赖新机制，优先把机制对象放在职业包根级 `mechanisms` 中，并让职业的 `mechanismIds` 引用机制 ID，以便一个 JSON 完整上传、下载和安装。导入后可在“创意工坊 → 测试场”配置木桩与 Lv.100 属性点进行隔离测试。
