# 《凯利安：奥西斯再临》创意工坊 AI 制作手册

适用格式版本：`1`。把本文件完整交给 AI，并说明你想制作的职业、卡组或底层机制。AI 最终必须只输出一个可保存为 `.json` 的 JSON 对象，不要输出 JavaScript、Markdown 代码围栏或解释文字。保存后在“创意工坊 → 导入”中校验；职业与底层机制公开到卡牌广场前需要作者审核。

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

## 四、给 AI 的推荐指令

复制以下内容并补充你的需求：

> 严格遵守《凯利安创意工坊 AI 制作手册》。请制作【职业包 / 效果预设扩展 / 底层机制包】。主题是……，核心循环是……，强度目标是……。职业包必须有 8–16 种不同名卡牌、16–32 张职业卡池和正好 15 张基础构筑。先在内部检查 ID 唯一、引用完整、基础构筑没有超过卡池持有数、没有未列出的效果或任意代码。最终只输出一个有效 JSON 对象，不要输出解释或 Markdown 代码围栏。

职业若依赖新机制，优先让 AI 把机制对象放在职业包根级 `mechanisms` 中，并让职业的 `mechanismIds` 引用机制 ID，以便一个 JSON 完整上传、下载和安装。导入后可在“创意工坊 → 测试场”配置木桩与 Lv.100 属性点进行隔离测试。
