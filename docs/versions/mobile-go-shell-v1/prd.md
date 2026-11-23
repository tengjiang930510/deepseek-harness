# 武汉地铁 · 手机同看简易壳（仿 Go）PRD

| 字段 | 内容 |
|---|---|
| 版本 | mobile-go-shell-v1 |
| 日期 | 2026-11-05 |
| 基线分支 | `feat/t4y-mobile-cowatch` |
| 读者 | 产品 / 交付 / 前端 |
| 状态 | 已确认，进入原型与实现 |

---

## 1. 结论前置

在手机 UA 下，将电脑同源 Web Client 收成 **仿 dsh-Go 的简易对话壳**：只保留对话与底部圆角输入；**模型选择固定顶栏右上角**；**企业插件快捷以胶囊条挂在输入框上方**；支持 **左滑快捷入口**。能力仍在电脑 Host 执行。实现仅落在 `t4y-mobile-cowatch`，不改 `t4y-capability-hub` 桌面布局。

---

## 2. 需求与优先级

| 优先级 | 需求 | 验收口径 |
|---|---|---|
| P0 | 简易对话框 | 手机隐藏侧栏/右栏/底栏冗余；中间消息 + 底部圆角输入可用 |
| P0 | 模型右上角 | 顶栏右侧可切换当前会话模型（沿用 Host `conversation.input.model`） |
| P0 | 输入框上胶囊条 | Hub 已勾选快捷以横向胶囊展示在输入框上方；工具行不再挤插件按钮 |
| P0 | 桌面零误伤 | 桌面 UA 不激活壳；历史实验样式可 scrub |
| P0 | 等电脑登录 | 保留现有 WaitGate / host-session 策略 |
| P1 | 左滑快捷 | 聊天页从右向左滑出面板：插件授权、设置、会话列表入口 |
| P2 | Go 语音/生成图/左滑可配置项 | 不做 |

---

## 3. 对标 Go 与差异

| 项 | dsh-Go 手机 | 本需求 |
|---|---|---|
| 顶栏 | 菜单 + 标题；手机顶栏一般不钉模型 | 右上角 **固定模型胶囊** |
| 输入 | 圆角悬浮框 + `+` + 发送 | 同构简化，复用 Web composer |
| 模型入口 | 点进输入后，模型在输入框下方 | **顶栏右上** |
| 企业快捷 | 无 Hub 胶囊 | **输入框上方胶囊条** |
| 左滑 | 有快捷入口面板 | **要做**（插件 / 设置 / 会话） |

参考：[dsh-Go 对话指南](https://github.com/ccch1mneyyy/dsh-Go/blob/master/docs/guide/zh/01-chat.md)。

---

## 4. 信息架构

```mermaid
flowchart TB
  Top[顶栏: 菜单开侧栏草稿 | 标题 | 右上角模型]
  Msg[消息列表]
  Cap[企业快捷胶囊条]
  Box[简易圆角对话框]
  Rail[左滑: 插件 / 设置 / 会话]
  Top --> Msg --> Cap --> Box
  Msg -.-> Rail
```

---

## 5. 场景

### 5.1 正常流程

1. 手机打开同源 Web（含 cowatch），电脑已企业登录。
2. WaitGate 消失，进入简易壳。
3. 顶栏切换模型；胶囊点插件命令插入输入框；发送后 Host 执行。
4. 左滑打开快捷，点「设置 / 授权插件 / 会话」跳转对应 Web 入口。

### 5.2 边界

| 情况 | 行为 |
|---|---|
| 无勾选快捷 | 胶囊条不占位 |
| 输入框有草稿/附件 | 胶囊按钮禁用（与 Hub 一致） |
| 窄宽旋转 | 壳保持单栏；胶囊横向滑动 |
| `?t4yMobile=0` | 强制关闭壳 |

### 5.3 异常兜底

| 情况 | 行为 |
|---|---|
| 电脑未登录 / 无模型 Key | WaitGate，不进壳 |
| 模型菜单打不开 | 保留原 composer 内模型控件可点（顶栏为增强定位） |
| 左滑与横向滚动冲突 | 仅从右缘 ≤24px 起滑才打开；内容区横滑不触发 |

---

## 6. 非目标

- 不改 Go / Remote 原生壳。
- 不在 Hub 写手机专用座位或桌面双槽。
- 不做语音输入、生成图、宠物。
- 不自建 Remote Server（本迭代）。

---

## 7. 实现边界

| 包 | 允许 |
|---|---|
| `t4y-mobile-cowatch` | 手机 UA 壳 CSS、顶栏模型定位、胶囊重排、左滑面板、WaitGate |
| `t4y-capability-hub` | **不改**桌面 `conversation.input.left` 逻辑；手机仅 CSS/壳层消费既有 `.t4y-shortcut-bar` |
| 官方 `ui-*` | 不改源码；仅选择器适配 |

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| CSS Modules 类名哈希 | 用 `data-*` / 属性选择器 / `class*=` 稳健匹配 |
| 顶栏挪模型破坏 focus | 优先 `position` 视觉挪位，点击仍落在原 trigger |
| 左滑误触 | 右缘手势 + 打开后遮罩点击关闭 |
| 与 dsh-mobile 双门 | 保持 WaitGate 仅手机；桌面 scrub |

---

## 9. 交付物

| 顺序 | 交付 | 路径 |
|---|---|---|
| 1 | 本 PRD | `docs/versions/mobile-go-shell-v1/prd.md` / `prd.html` |
| 2 | 线框原型 | `prototype/versions/mobile-go-shell-v1/pages/mobile_chat.html` |
| 3 | 泳道图 | `prototype/versions/mobile-go-shell-v1/pages/flow_core_swimlane.html` |
| 4 | 实现 | `tsy-custom-plugins/t4y-mobile-cowatch/` |
| 5 | Web 测试 | 浏览器 390 宽 + 手机 UA |

---

## 10. 已确认项

1. 方案：简易壳 + 右上角模型 + 胶囊条 — **是**
2. 仅改 cowatch — **是**
3. 做左滑快捷 — **是**
4. 流程：PRD → 原型 → 实现 → Web 测试 — **是**
