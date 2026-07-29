# Re∞：欧西亚斯重写架构方案

> 状态：Architecture Alpha Draft  
> 分析来源：`酒馆助手脚本文件夹-Re∞欧西亚斯1-2.json`  
> 目标：停止继续堆叠补丁，以浏览器本地数据库为唯一权威状态，拆分独立 Vue 模块，并通过 GitHub 的 Alpha / Beta / Release 通道自动发布。

## 1. 旧系统审计结论

旧导出包包含 27 个脚本，约 83,955 行代码、1,681 个命名函数。核心面板单体约 16,420 行、745 个函数，并承担人物、牌组、背包、装备、地图、任务、市场、合成、战斗、奖励、成就、MVU 同步和 UI 等几乎全部职责。

主要数据规模：

- 488 张卡牌；
- 24 套起始牌组；
- 105 个怪物；
- 97 套怪物技能配置；
- 72 个藏品；
- 55 个战斗道具；
- 30 件装备基础定义；
- 50 个合成配方；
- 10 个地区；
- 95 个成就。

已确认的结构性问题：

1. `CARD_DB` 与 `BATTLE_CARD_DB` 各保存 488 张完全相同的卡牌，存在整库重复。
2. 至少 12 个脚本的导出名称版本、脚本头版本或内部数据库版本不一致。
3. 约 174 个 `topWin.*` 全局入口，模块之间通过隐式全局对象耦合。
4. 185 次 `setTimeout`、20 次 `setInterval`，初始化和状态刷新高度依赖轮询与冷启动重试。
5. 多处包装或替换 `fetch`、`localStorage.setItem`、生成接口和 `console`。
6. 核心脚本为了阻止旧 iframe 写回过期战斗状态，已经发展出 V120 至 V140 的存储硬保护标记。
7. 每次本地存档写入后，完整状态会继续镜像到 MVU 的最新消息、第 0 楼和聊天变量三个作用域，形成多份状态互相覆盖。

结论：旧代码应当作为行为规格、内容数据和迁移输入保留，不应继续原地拆补丁。

## 2. 新系统硬约束

1. IndexedDB 是唯一权威游戏存档。
2. MVU 只保存 AI 真正需要阅读的精简投影。
3. 禁止 MVU 整体反向覆盖 IndexedDB。
4. AI 输出先转换为白名单领域命令，再通过 Schema、幂等和事务校验。
5. 每个主要界面是独立 Vue 应用，拥有独立 Pinia 和卸载生命周期。
6. UI 不得直接访问 MVU 或 IndexedDB 表，只能调用 Commands / Queries。
7. 模块之间不得互相导入 UI，只能通过类型化事件通信。
8. 全局只允许一个稳定入口 `window.Caelian`。
9. 稳态运行尽量零轮询，以酒馆事件和领域事件驱动更新。
10. Alpha、Beta、Release 使用独立浏览器数据库，开发版不能直接修改正式档。

## 3. 总体结构

```text
酒馆助手固定 Bridge
  ├─ Tavern Adapter：统一接收酒馆消息、发送、切换聊天和 MVU 事件
  ├─ Kernel：生命周期、模块加载、命令、查询、事件总线
  ├─ Storage：Dexie / IndexedDB、事务、迁移、快照
  ├─ MVU Projection：从本地权威状态生成 AI 精简投影
  ├─ Content Registry：卡牌、怪物、地区、物品、配方、成就内容包
  ├─ Worldbook Projection：地区、主线、支线世界书规则
  └─ Feature Apps：独立 Vue 应用与聊天 Custom Elements
```

建议技术栈：

- TypeScript；
- Vue 3 SFC；
- Vite 多入口构建；
- 每个应用独立 Pinia；
- Dexie / IndexedDB；
- Zod 运行时 Schema；
- Vitest、Vue Test Utils、Playwright；
- Web Worker 运行纯战斗引擎；
- GitHub Actions + GitHub Pages；
- 内容哈希、不可变构建和通道 manifest。

## 4. MVU 数据边界

### 4.1 保留在 MVU

- 世界：当前地区、当前位置、游戏日期、必要剧情标记、可访问地区摘要；
- 玩家：名字、职业、子职业、等级、必要剧情状态，金币按场景决定是否暴露；
- 协会：等级、当前主线摘要、支线摘要、委托摘要和当前目标；
- 战斗：是否在战斗、敌人、回合、必要状态、最近结果；
- 互动：AI 确实需要知道的好感和关系阶段。

### 4.2 只保存到浏览器本地

- 完整卡牌、怪物、物品、装备和藏品数据库；
- 卡牌收藏、牌组、完整背包、装备实例和升星状态；
- 集市库存、价格因子、合成配方和工坊草稿；
- 成就定义、完整成就进度、教程状态；
- 回档快照、诊断日志、UI 设置；
- 抽牌堆、弃牌堆、战斗动画、奖励选择队列；
- 幂等命令记录、内容缓存和版本元数据。

### 4.3 AI 写入模型

推荐逐步从任意 JSON Patch 迁移到明确命令：

```json
{
  "id": "message-123:command-1",
  "type": "inventory.adjust",
  "payload": {
    "itemId": "mat_mandrake_root",
    "delta": 2
  }
}
```

处理顺序：Schema 校验 → 命令白名单 → 幂等检查 → IndexedDB 事务 → 领域规则 → 重新生成 MVU 投影。

## 5. Vue 模块拆分

建议独立应用：

- `shell-wheel`
- `character-panel`
- `deck-panel`
- `inventory-panel`
- `equipment-relic-panel`
- `quest-panel`
- `map-travel-panel`
- `market-panel`
- `craft-workshop-panel`
- `battle-panel`
- `achievement-panel`
- `social-panel`
- `onboarding-panel`
- `rollback-admin-panel`
- `diagnostics-panel`
- `chat-card-elements`

聊天中的战斗、委托、主线、支线和剧情互动卡片统一由一个解析入口管理，渲染为带 Shadow DOM 的 Vue Custom Elements，不再让五个脚本分别扫描聊天楼层。

## 6. 旧脚本到新模块的映射

| 旧部分 | 新模块 |
| --- | --- |
| 共享运行时、悬浮轮盘 | `kernel`、`shell-wheel` |
| 卡牌数据库、地图道具数据库 | `content-cards`、`content-world` |
| 成就系统、扩展监听、特殊补丁 | `domain-achievements`、`ui-achievements` |
| 核心面板 | 拆分人物、牌组、库存、任务、地图、市场、合成、战斗和奖励领域 |
| AI 可见过滤 | `mvu-projection` |
| 新手教程 | `feature-onboarding` 状态机 |
| 五类聊天互动卡片 | `feature-chat-cards` |
| 回档与任务异常管理 | `snapshot-service`、`ui-admin-quests` |
| 全量备份迁移 | `backup-service` |
| 凯利安与特莱奥互动 | `domain-social`、`ui-social` |
| 三个世界书脚本 | `worldbook-projection` |
| 旅行守卫 | `travel-policy` |
| 诊断日志 | `diagnostics` |
| 背包双向同步 | 删除，由本地命令处理器取代 |

## 7. IndexedDB 设计

建议按通道隔离数据库：

```text
caelian-alpha
caelian-beta
caelian-release
```

建议表：

```text
profiles
characters
worldStates
questRecords
inventoryStacks
equipmentInstances
ownedCards
decks
ownedRelics
battleSessions
rewardClaims
marketStates
achievementProgress
socialProgress
tutorialProgress
rollbackSnapshots
commandInbox
eventLog
settings
contentVersions
legacySnapshots
```

奖励、购买、合成、任务提交、战斗结算必须使用事务；所有 AI 命令保存唯一 ID，防止楼层重新生成导致重复执行。

## 8. GitHub 三通道与自动更新

酒馆助手只保留固定 Bridge，不包含具体业务版本号。三个玩家入口只固定通道：

```text
bridge-alpha
bridge-beta
bridge-release
```

对应：

```text
channels/alpha.json
channels/beta.json
channels/release.json
```

Manifest 示例：

```json
{
  "channel": "release",
  "version": "1.0.0",
  "buildId": "<git-sha>",
  "bridgeApi": 1,
  "schemaVersion": 4,
  "modules": {
    "shell": {
      "url": "/builds/<git-sha>/shell.<hash>.js",
      "integrity": "sha384-..."
    },
    "battle": {
      "url": "/builds/<git-sha>/battle.<hash>.js",
      "integrity": "sha384-..."
    }
  }
}
```

发布流程：

1. 合并 `main` 后构建一次不可变的 `builds/<git-sha>/`；
2. CI 自动让 Alpha 指向该 buildId；
3. 基础测试通过后，把同一 buildId 提升到 Beta；
4. Beta 验收结束后，经人工批准把同一 buildId 提升到 Release；
5. 出现故障时把通道 manifest 指回上一个 buildId；
6. 不在战斗、导入或未保存事务中热切换版本。

必须提升同一个构建产物，不能让 Alpha、Beta、Release 各自重新构建。

## 9. 优化预案

- Bridge 保持极小，只负责加载、鉴权和酒馆事件适配；
- 面板按需加载，关闭后卸载 Vue、监听器和观察器；
- 卡牌和长列表使用虚拟滚动；
- 卡牌按职业、怪物和资源按地区拆分内容包；
- 战斗引擎使用可注入随机种子，确保 bug 可复现；
- 战斗计算放入 Web Worker；
- 静态资源使用内容哈希和长期缓存；
- 日志使用有限大小的本地环形缓冲区；
- Manifest 支持单模块 kill switch；
- 每次升级前创建迁移恢复点。

CI 数据检查：

- 卡牌 ID 唯一；
- 起始牌组中的卡牌全部存在；
- effect 类型合法；
- 怪物 pattern 引用的技能存在；
- 地区连接、集市物品、配方、任务奖励引用有效；
- 成就触发器引用的成就存在；
- 数据版本、manifest 和发布标签一致。

## 10. 旧存档迁移

迁移器必须：

1. 读取全部 `adv_panel_*`、`caelian_*` localStorage；
2. 读取 MVU 的最新消息、第 0 楼和聊天变量快照；
3. 原样保存旧数据到 `legacySnapshots`；
4. 以旧本地冒险存档为主要来源；
5. MVU 只迁移凯利安叙事字段与 AI 必需的布尔剧情标记，不允许覆盖浏览器中的世界、背包、装备、任务或战斗状态；
6. 合并全局成就与特殊藏品；
7. 生成冲突和迁移报告；
8. 在单个 IndexedDB 事务中导入；
9. 验证失败则整体回滚；
10. 不自动删除或覆盖旧 localStorage。

如果检测到旧 `__CaelianRuntime`，新系统应停止写入并提示旧版与新版不能同时启用。

## 11. 实施阶段

### Phase 1：规则冻结

抽取旧内容数据、建立旧存档样本、战斗黄金测试和数据引用检查。

### Phase 2：新内核

实现 Bridge、Tavern Adapter、IndexedDB、Commands / Queries、事件总线、MVU Projection 和 Alpha manifest。

### Phase 3：非战斗模块

实现人物、背包、装备、地图、集市、合成、成就和独立 Vue 生命周期。

### Phase 4：任务与世界书

实现统一标签解析、任务领域模型、聊天卡片、世界书投影和回档快照。

### Phase 5：战斗重写

实现纯 TypeScript 战斗引擎、Web Worker、独立战斗 Vue、原子结算和首领机制插件。

### Phase 6：迁移与发布

实现旧存档迁移、全量导入导出、Beta 回归测试，并把同一构建物提升到 Release。

## 12. 当前决定

保留：世界观内容、卡牌数据、战斗规则、任务协议和玩家旧存档。

废弃：全量 MVU 镜像、多权威状态、轮询初始化、大量 `topWin.__xxx`、运行时包装 `fetch` / `console` / `localStorage.setItem`、单体核心和补丁式版本守卫。

重写的第一优先级是确立 `IndexedDB 单一权威状态 + MVU 精简投影 + 类型化领域命令`，其次才是 Vue 界面拆分。
