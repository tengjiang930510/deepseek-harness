# t4y-mobile-cowatch

手机同看策略插件：**手机只遥控电脑上的 DSH**，不单独做企业登录，不调用内网 Broker / 大模型。

## 行为

| 端 | 行为 |
|----|------|
| 电脑（桌面 UA） | **完全不激活**：清理实验室标记与历史内联样式；`t4y-identity` 负责登录 |
| 手机（UA 含 Mobile） | 等待电脑 `host-session`；复用 Host 模型 Key |

> 桌面「移动访问」不得被等待层或侧栏改写影响。`?t4yMobile=1` **仅真实手机 UA** 生效。

手机侧当前仅保留：

- 等待电脑登录的遮罩（仅手机 UA）
- 设置 Tab 横滑、菜单快捷键文案隐藏、底栏轻量溢出处理
- fetch 拦截（不签发/撤销电脑模型 Key、不清 host-session）

**不做** AppFrame 栅格改写、会话宽度覆盖、快捷栏座位迁移（避免误伤桌面 / 发布链路问题）。手机排版另案再议。

## 依赖

需同时加载 `t4y-identity`（提供 `host-session`）。联调 overlay 见 `tenant-identity.overlay.yml`。

Client 改动后必须：`pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-mobile-cowatch`，再重启 Web。

## 接口

| 路由 | 说明 |
|------|------|
| `GET /api/t4y-mobile-cowatch/credential-status` | Host 是否已有 `T4Y_NEW_API_KEY` |
