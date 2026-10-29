# t4y-key-broker 开发指南

产品行为见 [README.md](./README.md)。这是**独立服务**，不是 DSH Cordis 插件。

## 源码与部署

| | 位置 |
|---|---|
| **源码（本仓库）** | `tsy-custom-plugins/t4y-key-broker/` |
| **运行机** | `192.10.51.138`（容器名 `t4y-key-broker`，`--network host`，端口 `4010`） |
| **部署目录** | `/home/zhao-nian-xi/new_api_eval/key-broker`（只读挂到容器 `/app`；状态在同级 `data/state.json` → `/data`） |
| **管理台** | `http://192.10.51.138:4010/admin`（需 `BROKER_ADMIN_TOKEN`） |

改本目录后拷到上述部署目录并重建 / 重启容器（见下方「发布注意」）。勿把 `.env` 或 `data/` 提交进仓库。

## 职责

用企业 access token 校验身份后，为企业成员签发 / 查询 / 撤销 **New API** 推理 Key（按登录一把）；DSH 侧由 `t4y-identity` Host 调用，并把 Key 写入本机槽 `T4Y_NEW_API_KEY`。

## 依赖

- New API **管理面**账号（不是 `sk-` 推理 Key）。
- 企业 `getInfo` 可到达。
- 调用方：`t4y-identity` 的 `brokerBaseUrl`。

## 目录

| 文件 | 说明 |
|---|---|
| `server.py` | 主实现（推荐） |
| `admin.html` | `/admin` 管理台（由 `server.py` 直接提供） |
| `server.mjs` | Node 原型（无管理台） |
| `.env.example` | 环境变量模板 |

## 本地开发

```sh
cd tsy-custom-plugins/t4y-key-broker
cp .env.example .env   # 填 New API 根管理员等；文件权限收紧
# Python 或 Node 按 README 启动，例如监听 4010
```

Docker 建议 `--network host`；`NEW_API_BASE_URL` 用宿主机可达地址。

DSH 联调：identity `brokerBaseUrl` 指向该服务（如 `http://192.x.x.x:4010`）。

## 验证

- `POST /v1/session/issue` + 有效企业 Token → 返回 New API Key 与 `expiresAt`。
- 同一未过期 Token 再 issue → 同一 Key、不续期。
- 会话已过期再 issue → 失败；需新的企业登录 Token。
- `POST /v1/session/status` → 只读本地账本；撤销或过期后 `active: false`。
- 错误管理凭据 → 启动或签发失败要有明确日志。
- 设置 `BROKER_ADMIN_TOKEN` 后打开 `/admin`：能按项目看到映射与会话；错误 Token 返回 401；吊销后 overview 减少对应行。

## 发布注意

- 公网必须 HTTPS + 来源限制；内网试跑的宽松 CORS 不能上生产。
- 状态文件勿提交仓库；备份按运维规范。

## 常见坑

- 用推理 `sk-` 调管理 API 会失败；Broker 缓存的是 root JWT。
- session-status 不保证与 New API 远端实时一致；远端 Key 被删时以聊天 401 → DSH 清 `T4Y_NEW_API_KEY` → 回登录为准。
- 不要期望「Key 过期后自动续期」；产品路径是回登录再签发。
- New API 对 Token 名冲突会回 HTTP 409：Broker 会改查已有 Token 或换名重建；`expired_time` 用 `-1`（本地仍按 `expiresAt` 判定过期）。
- New API 默认 `USER_SESSION_ACTIVE_LIMIT=50`（`0` 无效会回退 50）。线上 `new-api-eval` 已在 `/home/zhao-nian-xi/new_api_eval/.env` 提到 `1000000`；改完需重建容器带上 `--env-file`。
- Broker 状态文件被清空但 New API 仍留有 `ent_*` 用户时，会尝试接管该用户而不是直接失败。
- 线上 Broker 目录示例：`/home/zhao-nian-xi/new_api_eval/key-broker`（挂进 `t4y-key-broker` 容器 `/app`）；改 `server.py` 后 `docker restart t4y-key-broker`。
