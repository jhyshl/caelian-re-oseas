# Re∞：欧西亚斯 Alpha

这是 Re∞：欧西亚斯的浏览器本地优先重写仓库，与旧版线上仓库完全隔离。

当前版本实现第一条可运行 Alpha 纵切片：

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
npm run preview
```

构建结果：

```text
dist/channels/alpha.json
dist/builds/<build-id>/
dist/tavern-helper/caelian-alpha.json
```

> Alpha 目前用于验证新内核、存储边界、更新链路和独立 Vue 生命周期，尚未迁移旧版全部玩法数据。
