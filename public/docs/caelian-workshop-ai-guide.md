# 凯利安创意工坊 AI 制作手册

适用格式版本：`1`。把本文件完整交给 AI，并说明你想制作的职业、卡组或底层机制。AI 最终必须只输出一个可保存为 `.json` 的 JSON 对象，不要输出 Markdown 代码围栏或解释文字。代码机制的 JavaScript 必须放在 JSON 的 `source` 字符串中。导入的职业先保存为测试版，不会立即进入转职列表；必须在游戏内完成三轮真实战斗评定后才能启用或投稿。

## 最先复制给 AI 的制作指令

直接复制下面整段，并把方括号里的内容换成你的需求：

```text
请完整阅读我随后提供的《凯利安创意工坊 AI 制作手册》，严格按照格式版本 1 制作【职业包 / 效果预设扩展 / 声明式机制包 / 代码机制包】。

主题：【填写主题】
核心循环：【填写玩法循环】
强度目标：【填写偏保守 / 标准 / 较强但必须合法】
其他需求：【填写职业定位、卡牌风格或机制细节】

制作职业包时必须满足：
1. 使用 8–16 种不同名称、不同 ID 的卡牌，完整 cardPool 为 16–32 张，starterDeck 正好 15 张。
2. starterDeck 与 cardPool 只能引用本职业 cards 中的 ID，且每个 ID 的使用次数不能超过 cardPool 持有数。
3. 职业依赖新机制时，把完整机制放在职业包根级 mechanisms 中，并由 mechanismIds 引用。
4. 优先使用声明式机制。只有需求无法由现有效果、条件和动作表达时，才使用 `caelian_workshop_script_mechanism`；代码只能通过手册规定的输入和返回接口影响本场战斗。
5. 生成后必须先执行手册中的静态预算检查，并完成结构、引用、唯一性与循环风险检查；这只是导入前检查，不能代替游戏内三轮真实战斗评定。
6. 最终只输出一个有效 JSON 对象，不要输出校验过程、解释文字或 Markdown 代码围栏。
```

## 新职业制作流程（AI 必须按顺序完成）

### 1. 先把概念改写成可运行的核心循环

在生成 JSON 前，先在内部回答以下问题，不要把分析过程输出到最终文件：

1. 这个职业每回合最常做的动作是什么？例如积累资源、交替使用两类牌、维持召唤物、消耗护盾或承受减益。
2. 它如何获得优势，如何支付代价？只写“高伤害、能治疗、能防御”不是核心循环。
3. 玩家在手牌中需要做什么选择？至少应有“现在爆发还是继续积累”“保命还是推进循环”之一。
4. 职业最弱的局面是什么？不能同时拥有无条件的启动、爆发、回复、护盾、过牌和回 AP。
5. 哪些效果必须跨卡牌或跨回合记忆？只有这些内容才需要底层机制。

建议用一句内部设计式约束职业：

`通过【主要动作】积累【资源/状态】，在【触发时机】消耗它获得【收益】，代价是【限制或风险】。`

### 2. 选择最小实现层级

按以下顺序判断，能够在更上层完成时不要下沉：

- 一张牌立即造成伤害、治疗、护盾、抽牌、状态或召唤：使用普通 `effects`。
- 一张牌根据当前护盾、生命、状态或召唤物分支：使用 `conditional_group`。
- 多张牌或多个回合共享计数、资源和固定触发规则：使用声明式底层机制。
- 需要自行编写算法、读取玩家自定义卡牌标签、动态修改费用或伤害事件，且声明式规则无法表达：使用代码底层机制。
- 需要新面板、新动画、新网络请求、读取聊天/MVU/存档或改变非战斗系统：创意工坊机制不支持，不得伪造字段声称已经实现。

### 3. 先规划职业卡池，再写每张卡

职业需要 8–16 种不同卡牌。先在内部列出功能分工，避免多张牌只是改名换数值：

- 2–4 种循环启动牌：稳定产生职业资源或建立状态。
- 2–4 种循环收益牌：消耗或利用资源形成主要输出/防御。
- 1–3 种防御或恢复牌：让职业能度过弱势回合，但不能抹掉全部代价。
- 1–3 种过牌、调度或转换牌：改善手牌，但注意抽牌与回 AP 的高分值。
- 1–2 种高费用终结牌：提供明确爆发，不应成为低费无限循环。

`cardPool` 是安装后拥有的 16–32 张完整职业牌池，允许同一种牌重复；`starterDeck` 是其中正好 15 张的初始出战构筑。先决定每种牌在卡池中的持有数，再从中取基础构筑，不能让基础构筑使用的某张牌多于卡池持有数。

### 4. 为机制分类牌，而不是滥用基础 type

基础 `type` 只决定引擎既有结算：`attack`、`defense`、`skill`、`summon`。近战、远程、法术、武器技、元素等属于玩家机制分类，应写入 `tags`，例如：

```json
"tags": ["melee", "weapon", "fire"]
```

同一张牌可以有多个标签。标签最多 12 个，支持中英文；同一职业中要保持拼写一致。不要把所有 `attack` 自动视为近战，也不要把所有 `skill` 自动视为法术。

### 5. 设计机制依赖与便携导入

职业使用底层机制时：

1. 为机制使用带作者前缀的稳定 ID。
2. 在职业 `mechanismIds` 中引用该 ID。
3. 推荐把完整机制放进职业包根级 `mechanisms`，这样一个 JSON 即可安装。
4. 若机制准备被多个职业复用，也可以单独导入机制包；职业包只保存引用。
5. 代码机制必须在 `triggers` 中只声明实际需要的事件，避免每个事件都执行。

### 6. 完成后执行四轮内部自检

1. **结构检查**：格式、版本、ID、引用、卡牌数量、卡池数量、15 张构筑和唯一性全部合法。
2. **静态预算检查**：逐个效果算分，逐张对照费用上限，再计算天赋总分；该结果不代表职业实战强度。
3. **运行检查**：逐条模拟首回合、普通循环、资源上限、资源不足、无目标、满手牌、空弃牌堆、多个敌人和战斗结束。
4. **循环检查**：确认没有 0 AP 回 AP 无限循环、伤害触发伤害的无限递归、无条件永久增长或同一事件不断自触发。

最终 JSON 只保留实际需要的字段。说明文字与真实执行必须一致：无法由卡牌效果或机制代码实现的描述必须删除，不能只把预期效果写进 `description`。

## 游戏内三轮真实战斗评定

职业通过结构检查后只会保存为测试版，可以在测试场自由选择训练木桩、随机单怪或随机怪群。点击“三轮评定并启用”后，系统使用真实战斗引擎自动完成以下黑盒测试：

- 每轮固定复现低难单怪、高难单怪、低难三怪和高难三怪四种场景；三轮只改变敌方承压倍率，避免随机抽怪差异干扰结果。
- 自动评定准备 8 套完整 `990` 点 Lv.100 属性：均衡档，以及生命、魔力、攻击、防御、速度、行动点、吸血 7 个边界档，避免只在极端合法加点下爆发的机制漏检。
- 构筑覆盖初始构筑、卡池爆发构筑、卡池效率构筑与确定性轮换覆盖构筑。8–15 种卡牌会由一套覆盖构筑纳入；16 种卡牌会用三套 15 卡轮换构筑覆盖全部卡牌及全部两两共现。内容相同的构筑会自动合并，所以总场次数由职业的实际卡池决定并在界面实时显示。
- 基础评定使用 10 回合真实战斗和确定性的二阶覆盖矩阵：构筑、属性模板、承压轮次、敌人场景中任取两个因子，其全部组合都会至少出现一次；每个“轮次 × 场景”格也至少执行两场。这样不是抽几个平均样本，也不需要把四个因子做成数百场笛卡尔积。
- 第三轮的高难单怪和高难怪群另有 3 回合爆发探针；每个属性模板下都会覆盖全部职业卡，能够复用的基础实战证据不会重复执行。同一个合法属性模板若在两种高难场景中都于 3 回合内获胜，即使整轮没有达到三胜，也会直接判为超过上限。
- 每一种职业卡都必须至少一次被正式战斗引擎成功打出；只进入牌库、抽到手牌或被脚本拒绝都不算完成覆盖。缺少任一卡牌的真实执行记录时，评定按异常处理并阻止启用。
- 三轮敌方承压倍率依次为 `0.85`、`1.10`、`1.35`；每轮四种场景至少胜三种才算通过。每种场景取不同合法构筑与属性档位中的最佳结果，判断职业在合理构筑下能够承受的战斗压力。
- 自动脚本只观察真实手牌、行动是否合法、生命和胜负，不按玩家声明的机制名称加减权重；卡牌效果、天赋、声明式机制与代码机制全部走正式结算链。
- 结果显示为敌方承压倍率区间：`0.50–0.85`、`0.85–1.10`、`1.10–1.35`；第三轮仍通过会显示 `≥1.35`，代表超过允许上限，职业不会启用。较弱职业可以启用，但会明确标注区间。
- 任一机制执行报错、被安全系统停用、单回合出现无法收敛的动作链、超过十回合或整组测试超过安全时限，都会作为异常阻止启用，而不是伪装成低强度。
- 每种固定场景使用独立临时数据库；其中每套构筑与属性组合都会新建确定性随机的战斗仓库，并在下一组开始前完成会话清理。评定不读取装备、藏品、道具或凯利安协战，不发奖励、不推进任务，也不会改写正式角色。
- 报告绑定职业、卡牌、构筑、引用机制与评定器版本的 SHA-256 内容指纹；其中任一内容发生改动，旧报告都会失效。

## 静态预算参考（生成后必须执行，但不是最终强度评定）

这部分逐项抄录自创意工坊当前实际使用的 `cardScore`、`cardLimit`、`rarityFromScore` 和 `talentScore`。它只负责拦截明显越界的基础数值并生成稀有度，不能识别脚本改写、无限循环、跨卡联动和多目标实战收益；最终结论只由游戏内真实战斗评定产生。

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
| `generate_blank_to_draw` | `value × 6` |
| `blank_regen` | `value × 6 × turns × D` |
| `discard_blank_damage` | `value × 5 × M` |
| `reveal_intent` | `5` |

`apply_debuff`：基础分依次为 `freeze=14`、`entangle=10`、`weak=7`、`vulnerable=8`、`burn=4`、`poison=4`；分数为 `基础分 × turns × M`。

`apply_buff`：每回合基础分依次为 `strength=6`、`fortitude=5`、`agility=5`、`regen=4`、`thorns=4`、`ap_regen=9`、`draw_regen=7`、`shield_regen=3`、`heal_regen=3.5`、`damage_bonus=4`、`spell_damage_bonus=4`、`damage_reduce=4`、`mp_regen=1.2`、`blood_burn=3`。分数为 `基础分 × max(1, value) × turns × D × M`；`blood_burn` 最后再乘 `0.72`。

`conditional_group`：分别汇总 `then_effects` 与 `else_effects`。每个条件使用默认折扣：`self_has_shield=0.86`、`self_no_shield=0.9`、`enemy_has_shield=0.86`、`enemy_no_shield=0.9`、`enemy_has_debuff=0.84`、`enemy_no_debuff=0.92`、`enemy_has_specific_debuff=0.8`、`enemy_no_specific_debuff=0.9`、`self_has_buff=0.9`、`self_no_buff=0.92`、`self_full_hp=0.82`、`self_not_full_hp=0.88`、`has_summon=0.82`、`no_summon=0.95`、`same_card_played_this_turn=0.78`、`previous_card_same_name=0.72`、`spend_mp=0.74`、`spend_hp` 按支付 1–20 HP 从 `0.896` 递减到 `0.44`、`discard=0.78`、`destroy_summon=0.62`。`and` 将折扣相乘，`or` 取最大折扣；最终分数为 `max(then 总分 × 条件折扣, else 总分)`。

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
- `hand_limit_bonus`：`value × 3`

### 3. 最终检查清单

- 所有包、职业、卡牌、机制、资源和规则 ID 唯一，引用目标全部存在。
- 每张卡最多 8 个效果；同一张卡中，同类效果、同名 buff/debuff 和同条件加成不重复。
- 召唤牌必须含 `summon`，非召唤牌不得含 `summon`；召唤物最多 3 个技能，每个技能最多 3 个效果。
- 卡牌种类、cardPool、starterDeck 数量与重复次数全部合法。
- 天赋总分不超过 24，每张卡总分不超过费用上限；若超限，优先提高 cost 或降低数值，不得伪造 `powerScore`。
- 机制不存在同一触发器下无条件互相触发的循环；资源有明确上下限，规则能够解释并可在测试场验证。

## 安全边界

- 效果预设与声明式机制不执行代码。代码机制运行在独立 QuickJS 沙箱中，只能读取本场战斗快照并返回受控结果，不能访问页面、网络、聊天记录、变量管理器、浏览器存储或玩家存档。
- ID 只使用小写英文字母、数字、点、下划线、冒号和短横线，并加上作者前缀避免重名。
- 单个职业必须包含 8–16 种不同名称的卡牌；`cardPool` 总计 16–32 张，`starterDeck` 必须正好 15 张，且两者只能引用本职业卡牌 ID。
- 数值会被导入器限制，超限、未知字段或不支持的效果会被拒绝或移除。
- 代码机制不参与自动强度评分，导入时会单独警告。每次执行限制为 50ms、8MB 沙箱内存和 64KB 返回值；递归与动作链最多 64 步，连续失败 3 次会在本场战斗停用。

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
- `hand_limit_bonus`：提高手牌上限，`value` 0–5；基础上限 10，因此最多提高到 15。

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
  "tags": ["ranged", "arcane"],
  "effects": [{ "type": "damage", "value": 8, "target": "enemy" }],
  "custom": true,
  "powerScore": 8
}
```

卡牌 `type` 使用 `attack`、`defense`、`skill`、`summon`；`rarity` 使用 `common`、`uncommon`、`rare`、`epic`、`legendary`。`tags` 最多 12 个，由玩家自由定义，例如 `melee`、`ranged`、`spell`、`weapon`，代码机制可据此判断哪张牌属于近战、远程、法术或其他自定义类别。`powerScore` 只是建议值，导入时会重新校验。

常用卡牌效果：

- `damage`、`shield`、`heal`、`draw`、`gain_ap`、`gain_mp`：使用 `value`；目标常用 `enemy` 或 `self`。
- `apply_buff`：`buff` 可用 `strength`、`fortitude`、`agility`、`regen`、`thorns`、`ap_regen`、`draw_regen`、`shield_regen`、`heal_regen`、`damage_bonus`、`spell_damage_bonus`、`damage_reduce`、`mp_regen`、`blood_burn`；使用 `value`、`turns`。
- `apply_debuff`：`debuff` 可用 `burn`、`poison`、`weak`、`vulnerable`、`freeze`、`entangle`；使用 `value`、`turns`。
- `cleanse`、`dispel`、`discard`、`recover_discard`、`destroy_summon`：使用 `amount`。
- `strip_shield`、`strip_buffs`、`reveal_intent`：无需数值。
- `trap`、`damage_per_debuff`、`discard_all_damage`：使用 `value`。
- `generate_blank_to_draw`：把 `value` 张空白牌洗入抽牌堆；空白牌在手牌、抽牌堆与弃牌堆中合计最多同时存在 8 张。
- `blank_regen`：之后每个玩家回合开始、正常抽牌前把 `value` 张空白牌洗入抽牌堆，使用 `turns`；每次施加都会建立独立效果，允许叠加，达到 8 张上限时仍会消耗持续回合。
- `discard_blank_damage`：只揭晓并移除手中的空白牌，每张造成 `value` 点伤害；这是唯一可以处理空白牌的弃牌效果。
- `damage_from_shield`：使用 `ratio`。
- `spend_mp_damage`、`spend_mp_shield`：`amount` 为消耗 MP，`value` 为每点倍率。
- `mp_to_ap`：`amount` 为消耗 MP，`value` 为获得 AP。
- `summon`：使用 `name`、`attackable`、`hp_ratio`、`unique_by_name`、`skills`；每个技能含 `name`、`weight`、`effects`。
- `conditional_group`：使用 `logic`（`and`/`or`）、`conditions`、`then_effects`、`else_effects`。

条件类型可用：`self_has_shield`、`self_no_shield`、`enemy_has_shield`、`enemy_no_shield`、`enemy_has_debuff`、`enemy_no_debuff`、`enemy_has_specific_debuff`、`enemy_no_specific_debuff`、`self_has_buff`、`self_no_buff`、`self_full_hp`、`self_not_full_hp`、`has_summon`、`no_summon`、`same_card_played_this_turn`、`previous_card_same_name`、`spend_mp`、`spend_hp`、`discard`、`destroy_summon`。两个同名卡牌条件都以当前正在使用的卡牌名称为准，只统计玩家此前主动打出的牌：前者检查本回合是否已经用过同名牌，后者只检查紧邻的上一张牌。`spend_mp` 与 `spend_hp` 是资源限制积木：先支付资源，再执行“则”中的任意效果；它们通过强度折扣换取更大的原始效果空间，不会凭空产生伤害或护盾。支付 HP 必须至少保留 1 HP。

空白牌没有可执行效果，不能直接打出，也不能被 1 AP 弃牌按钮、普通 `discard`、`discard_all_damage`、随机弃牌或敌方弃牌移走。普通弃牌作为费用时，必须有足够数量的非空白牌才可打出对应卡牌。空白牌仅存在于本场战斗，不进入职业 `cards`、`cardPool`、`starterDeck`、收藏、市场或战后奖励。

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

## 三、声明式底层机制包

声明式机制是受限的“事件 → 条件 → 动作”规则，不执行代码。完整示例：

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

触发器：`battle_start`、`turn_start`、`turn_end`、`before_card`、`after_card`、`before_damage`、`before_enemy_turn`、`after_enemy_turn`、`player_damaged`、`enemy_damaged`、`summon_created`、`summon_removed`、`battle_victory`、`battle_defeat`。

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

## 四、代码底层机制包

只有声明式机制无法表达新算法时才使用代码机制。它是职业包可携带、也可单独导入的 JSON；`source` 中写普通同步 JavaScript，并提供指定入口函数：

```json
{
  "format": "caelian_workshop_script_mechanism",
  "version": 1,
  "id": "author.melee-combo",
  "name": "近战连击",
  "author": "作者名",
  "description": "连续使用近战牌会逐步提高本次伤害。",
  "entrypoint": "handle",
  "priority": 10,
  "triggers": ["before_damage"],
  "resources": [
    {
      "id": "combo",
      "label": "连击",
      "description": "最多 5 层。",
      "min": 0,
      "max": 5,
      "initial": 0,
      "visible": true
    }
  ],
  "source": "function handle(ctx) {\n  const tags = Array.isArray(ctx.event.cardTags) ? ctx.event.cardTags : [];\n  if (!tags.includes('melee')) return {};\n  const combo = Math.min(5, ctx.resources.combo + 1);\n  return {\n    resources: { combo },\n    event: { amount: ctx.event.amount * (1 + combo / 10) },\n    actions: [{ type: 'log', message: '近战连击生效' }]\n  };\n}"
}
```

入口函数接收 `ctx`：

- `ctx.trigger`：当前触发器。
- `ctx.battle`：只读战斗快照，包含回合、阶段、玩家公开战斗数值、手牌摘要、召唤物和敌人状态。
- `ctx.event`：事件数据。`before_card` 含 `cardId`、`cardName`、`cardType`、`cardTags`、`cardCost`、`mpCost`；`before_damage` 还含伤害值、攻防双方与当前卡牌标签。
- `ctx.resources`：该机制自己的资源值。
- `ctx.random`：本次事件提供的 0–1 随机数。

入口函数返回一个普通对象，可包含：

- `resources`：更新本机制已声明的资源，最终值仍受 `min` / `max` 限制。
- `actions`：与声明式机制相同的受控战斗动作；每次最多 16 个。
- `event`：修改当前底层事件。`before_card` 可修改 `cardCost`、`mpCost`；`before_damage` 可修改 `amount`、`ignoreDefense`、`cancel`。

代码可以自由使用函数、分支、循环、数组、对象和数学计算来定义新算法，但不能使用异步函数、模块导入或宿主对象。沙箱内没有 `window`、`document`、`fetch`、`localStorage`、IndexedDB、酒馆接口或变量管理器。机制文件超过 24000 个字符会被拒绝；单个机制调用最多运行 50ms，同一次事件链最多执行 64 个受控步骤。

职业若依赖新机制，把声明式或代码机制对象放在职业包根级 `mechanisms` 中，并让职业的 `mechanismIds` 引用机制 ID；也可以先单独导入机制，再导入只引用 ID 的职业包。导入后应在“创意工坊 → 测试场”配置木桩与 Lv.100 属性点进行隔离测试。
