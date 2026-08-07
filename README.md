# Re∞：欧西亚斯发布通道

这是 Re∞：欧西亚斯的浏览器本地优先重写仓库，与旧版线上仓库完全隔离。

当前仓库同时维护 Alpha 与 Beta：

- Alpha 在 `main` 更新后自动验证、递增版本并发布；
- 仅在作者明确要求沿用当前 Alpha 版号的发布提交中使用 `[preserve-alpha]` 标记；下一次普通提交会恢复自动递增；
- Beta 仅能通过手动工作流发布，且构建脚本要求显式设置 `CAELIAN_BETA_RELEASE=1`；
- 两个通道使用独立清单、公告、接收器、回退记录与本地数据库；
- Beta 固定发布时的内容快照，不会自动吸收之后的 Alpha 内容更新。

运行时实现包括：

- 固定酒馆助手 Bridge 自动读取 Alpha 通道，不需要玩家修改版本号；
- `caelian-alpha` IndexedDB 是唯一权威状态；
- MVU 只接收凯利安叙事字段和剧情标记，并读取浏览器生成的最小状态摘要；
- 所有写入经过 Zod 白名单命令、幂等检查和 Dexie 事务；
- Shell、玩家、凯利安状态栏、牌组、背包、协会、地图、战斗等板块均为独立 Vue 应用；
- 面板按需加载并在关闭时完整卸载；
- GitHub Actions 验证后发布不可变构建，并移动 Alpha manifest 指针。

## 文档

- [Alpha v0.1 需求冻结](docs/alpha-v0.1-scope.md)
- [完整重写架构方案](docs/rewrite-architecture.md)

## 本地验证

```powershell
npm install
npm run check
npm test
npm run build:alpha
$env:CAELIAN_BETA_RELEASE='1'; npm run build:beta
npm run preview
```

构建结果：

```text
dist/channels/alpha.json
dist/channels/beta.json
dist/builds/<build-id>/
dist/tavern-helper/caelian-alpha.json
dist/tavern-helper/caelian-beta.json
```

> Alpha 目前用于验证新内核、存储边界、更新链路和独立 Vue 生命周期，尚未迁移旧版全部玩法数据。
