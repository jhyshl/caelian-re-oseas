# Re∞：欧西亚斯重写

这是 Re∞：欧西亚斯的全新重写仓库，与旧版线上仓库隔离。

## 重写目标

- 以浏览器 IndexedDB 作为唯一权威游戏存档；
- MVU 只保留 AI 确实需要读取的精简投影；
- 人物、牌组、背包、装备、任务、地图、市场、合成、战斗等板块使用独立 Vue 应用；
- 通过固定 Bridge 接入酒馆助手，业务代码和内容由 GitHub 托管；
- 使用 Alpha、Beta、Release 三个独立发布通道，并由通道 manifest 自动更新；
- 保留旧数据和规则，废弃多权威状态、全量 MVU 镜像和补丁式全局脚本结构。

## 当前状态

当前处于 **Architecture Alpha Draft** 阶段，仓库内暂未提供可运行版本，请勿将其作为 Alpha 玩家入口导入。

完整审计与重写方案见：[docs/rewrite-architecture.md](docs/rewrite-architecture.md)。

后续将先完成规则冻结、内容抽取、存档样本与测试基线，再建设新内核和独立 Vue 模块。
