# 独立酒馆 Alpha 80 回归

此环境仅用于合成存档测试。不要把回归脚本加载到玩家自己的浏览器存档或常用酒馆。

## 已验证的依赖

- SillyTavern 1.18.0，release 提交 `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`。
- 酒馆助手 JS-Slash-Runner 4.9.5，提交 `cd9f523d08d147057043b9939397de8a61be91e4`。
- Node 22、候选 Alpha 80；测试未配置主 API、真实副 API 或 MVU。

在空目录克隆官方 SillyTavern release，固定以上提交并执行 `npm ci`。将助手发行文件 `dist/`、`lib/`、`i18n/`、`manifest.json` 放入新酒馆的 `data/default-user/extensions/tavern-helper/`。启动 `node server.js --port 8010 --browserLaunchEnabled false`，保留默认 CSRF 与环回白名单。需要远程浏览器时使用所在环境提供的内部预览服务；本次服务只用于测试，未发布公共酒馆。

## 加载候选与回归工具

在 Caelian 仓库执行：

```sh
npm ci
npm run build:alpha
npx vite build --config scripts/tavern-qa.vite.mjs
```

复制完整 `dist/` 到测试酒馆 `public/caelian-candidate/`，复制 `.tavern-qa/qa.js` 到 `public/caelian-qa/qa.js`。

用发行角色数据建立独立的「凯利安」测试副本，保留内嵌世界书和绑定，删除该副本中的助手脚本，设定简单的测试开场白。不要导入个人 API Key 或玩家存档。打开副本聊天并确认导入世界书。

在此测试酒馆创建唯一启用的全局助手脚本，按 `dist/channels/alpha.json` 的 runtime URL 与 CSS URL 替换下面两个占位路径；去除公共域名前缀，改为 `/caelian-candidate/`：

```js
const root = window.parent;
const css = root.document.createElement('link');
css.rel = 'stylesheet';
css.href = '/caelian-candidate/builds/BUILD_ID/assets/STYLE.css';
root.document.head.append(css);
await import(root.location.origin + '/caelian-candidate/builds/BUILD_ID/assets/ALPHA.js');
await import(root.location.origin + '/caelian-qa/qa.js');
```

先点击「安装测试职业（首次后刷新）」，刷新后重新打开测试聊天，等存档切换完成再点「初始化测试」。逐个执行回归按钮，等上一项完成再继续。工具通过真实候选的公共 API 执行战斗与任务，通过助手读写测试世界书和聊天，通过实际 IndexedDB 建立合成测试初始状态。

「运行伤害回归」会留下一个可亲自选牌、出牌的战斗。「手动剧情回归」使用模拟副 API 的 stay 响应，运行结束还原 fetch；「更新明细回归」使用仅含不存在测试条目的清单，验证真实更新器及设置界面，不替换角色正文。查看游戏界面时先折叠左上测试工具，避免遮住控件。测试输出直接显示在工具框中，不自动发送到反馈后台。

代码不会进入正常 Alpha 发布产物：独立 Vite 配置禁用 publicDir，产物 `.tavern-qa/` 已被 Git 忽略；正常 Vite 构建不引用测试工具。

实机结果及限制见 [修复记录](../fixes/reviewed-feedback-alpha80.md)。
