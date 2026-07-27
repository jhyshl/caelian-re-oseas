# Alpha v0.1 需求冻结

> 版本：`0.1.0-alpha.1`
> 目的：验证新架构的第一条可运行纵切片，不追求旧版功能覆盖率。

## 本版必须完成

1. 酒馆助手只导入一个固定 Bridge；Bridge 每次启动读取 `channels/alpha.json`，玩家不填写业务版本号。
2. GitHub Pages 发布不可变的 `builds/<git-sha>/`，Alpha manifest 只移动指针。
3. `caelian-alpha` IndexedDB 是唯一权威状态；MVU 不得反向覆盖本地状态。
4. 所有写操作经过 Zod 白名单命令、幂等检查和 Dexie 事务。
5. MVU 只写人物、世界、任务和战斗摘要，不写完整背包或内容数据库。
6. 全局只暴露 `window.Caelian`。
7. Shell、人物、背包和诊断分别使用独立 Vue 根节点与独立 Pinia。
8. 面板按需加载，关闭后卸载 Vue 应用和 DOM。
9. 检测到旧 `window.__CaelianRuntime` 时停止本地/MVU 写入，并提示版本冲突。
10. 提供类型检查、单元测试、构建检查和 GitHub Pages Alpha 发布工作流。

## 本版提供的领域能力

- 初始化当前聊天对应的 Alpha 档案；
- 修改人物基础摘要；
- 修改当前地区和位置；
- 调整本地背包堆叠，并证明背包详情不会进入 MVU；
- 手动重新生成 MVU 精简投影；
- 查看构建、数据库、MVU 和最近领域事件诊断。

## 明确不在本版

- 488 张卡牌、105 个怪物和全部旧内容迁移；
- 完整任务、市场、合成、装备、成就和社交玩法；
- 战斗引擎与 Web Worker；
- 旧存档自动迁移；
- Beta/Release 玩家入口与通道晋级；
- 与旧脚本同时运行的兼容层。

## 验收标准

- `npm run check`、`npm test`、`npm run build:alpha` 全部通过；
- 构建产物包含 Alpha manifest、不可变构建目录和单脚本酒馆助手接入口；
- 相同命令 ID 重放不会重复增加背包数量；
- MVU 投影测试确认不存在背包明细；
- 四个 Vue 模块之间不互相导入 UI 组件；
- Bridge 中不存在硬编码业务版本号，更新只依赖 Alpha manifest。
