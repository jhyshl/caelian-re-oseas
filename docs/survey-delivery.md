# Alpha 问卷投放

问卷清单位于 `public/managed-content/surveys/alpha.json`。只修改并推送这个文件即可投放或停止问卷，不需要修改 Alpha 版本号。已经运行的角色卡会每两分钟无缓存检查一次；发现未处理的新问卷后，显示“查看 / 忽略”弹窗。

## 投放规则

- 每一份新问卷必须使用从未用过的 `id`。玩家是否已处理以 `id` 为准；修改同一 `id` 的 `revision` 不会让已经忽略或提交的玩家再次收到提醒。
- `active: true` 才会收集回答。设为 `false` 可立即停止新的提醒和提交，已经提交的玩家仍可查看本地答案。
- `kind: "single"` 是单项意见收集，只能有一个问题；普通多问题问卷使用 `kind: "survey"`。
- Discord ID 不需要写进问题列表。前端会在每份问卷最后自动加入一个选填项。
- 提交后服务器和玩家端均不允许修改。问卷答案不会进入 MVU。

## 完整示例

```json
{
  "schemaVersion": 1,
  "channel": "alpha",
  "revision": "2026-08-03.1",
  "surveys": [
    {
      "id": "2026-08-battle-ui",
      "revision": 1,
      "kind": "survey",
      "title": "本地战斗操作体验调查",
      "description": "用于了解当前移动端与 PC 端的操作问题。",
      "active": true,
      "startsAt": "2026-08-03T00:00:00+08:00",
      "endsAt": "2026-08-10T23:59:59+08:00",
      "questions": [
        {
          "id": "device",
          "type": "single-choice",
          "title": "你主要在哪种设备上游玩？",
          "required": true,
          "options": [
            { "value": "mobile", "label": "手机或平板" },
            { "value": "pc", "label": "电脑" }
          ]
        },
        {
          "id": "pain-points",
          "type": "multiple-choice",
          "title": "哪些操作最需要改进？",
          "required": true,
          "minSelections": 1,
          "maxSelections": 3,
          "options": [
            { "value": "hand", "label": "手牌选择" },
            { "value": "drag", "label": "拖牌目标" },
            { "value": "animation", "label": "动画节奏" }
          ]
        },
        {
          "id": "details",
          "type": "long-text",
          "title": "还有哪些具体建议？",
          "required": false,
          "maxLength": 1200
        }
      ]
    }
  ]
}
```

支持的问题类型：`single-choice`、`multiple-choice`、`short-text`、`long-text`。选择题的 `value` 只使用小写英文字母、数字、点、下划线、冒号或短横线。
