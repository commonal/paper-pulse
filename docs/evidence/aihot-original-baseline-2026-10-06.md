# AIHOT 原版基础运行验收

日期：2026-10-06。

后续：用户配置模型后，已完成三条真实内容的原版处理与网页展示，见 [真实内容小样本验收](aihot-real-content-2026-10-06.md)。下文保留初次基础启动时的状态与边界。

## 结果

原版 API、worker、网页已启动并保持运行。基础运行通过，真实来源采集与付费模型处理尚未验收。

- 上游：`https://github.com/KKKKhazix/AIHOT`。
- 提交：`ede7c7bf6fbf2fe3d1282732423f16d1fc7dbf08`。
- 源码：`.dev/references/aihot/`，位于忽略目录；`git status --short` 无输出，应用源码未修改。
- Node：24.14.1；npm：11.17.0。
- 网页：http://127.0.0.1:5310/，默认站名 MyHOT。
- 后台：http://127.0.0.1:5310/admin。
- API：http://127.0.0.1:4311/api/health。
- 数据库：独立容器 `aihot-original-db`，使用本机已有 `pgvector/pgvector:pg16` 镜像；独立数据卷 `aihot-original-pgdata`，仅绑定 `127.0.0.1:5544`，数据库 `aihot_original`。
- 本地配置：`.dev/aihot-original/runtime.env`。管理员密码为新生成随机值，只在本地 `ADMIN_PASSWORD` 字段中保存；不复制或修改旧项目 `.env`。

## 已执行的检查

| 检查 | 结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | 退出 0，安装 295 个依赖包 |
| `npm run typecheck` | 退出 0 |
| `npm run build -w @aihot/web` | 退出 0，客户端与 SSR 构建成功 |
| 原版 `scripts/migrate.ts` | 退出 0，57 个迁移成功 |
| 原版 `scripts/seed.ts` | 退出 0，18 个示范信源入库 |
| 原版 `scripts/smoke.ts --base http://127.0.0.1:5310` | 退出 0，30 项全部通过 |
| API 健康 | `ok=true`、`db=ok`、release=`baseline-ede7c7b` |
| 进程与心跳 | API、worker、web 三个 Node 进程在运行；数据库记录 API 与 worker 心跳 |
| 浏览器验证 | 首页实际加载，品牌、导航、筛选、搜索与空状态可见 |
| 付费调用 | `receipts` 数量 0 |

30 项冒烟检查覆盖 15 个页面，以及健康检查、公开 API、RSS、文本出口、站点地图、manifest、OpenAPI、分享图、图标和 MCP 初始化。

## 环境问题与处理

1. 原版 Docker 构建未成功：Docker Hub 的匿名授权请求超时，发生在拉取 Node 基础镜像阶段，尚未进入应用构建。
2. 改为本机 Node 运行三个应用进程，独立 PostgreSQL 16 容器提供数据库。上游非 Docker 文档推荐 Windows 使用 WSL2；本次 Windows 原生路径经上述检查通过，不代表所有运维脚本在 Windows 均兼容。
3. 首次网页启动端口 4310 被其他进程占用，报 `EADDRINUSE`。保留失败日志，只重启本次创建的 AIHOT 进程，将网页端口改为 5310 后重新执行整站冒烟检查，全部通过。

Compose 覆盖配置使用官方支持的 `!override` 替换端口和环境文件；该 Docker 应用路径本次未跑通，当前实际运行路径为本机 Node：[Docker 合并规则](https://docs.docker.com/reference/compose-file/merge/)。

## 当前内容与边界

- `COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`；飞书推送和 IndexNow 同样关闭。
- 18 个示范信源配置存在，但尚未抓取正文；文章数量为 0，所以首页为空。
- 未读取旧项目模型密钥，未发起付费模型调用，未写入伪造新闻或精选结果。
- 未运行完整 `npm test`；不将类型检查和冒烟检查表述为全部测试通过。
- 未创建 PaperPulse 的新仓库，未添加论文模块，未改动现有 Research Pulse 服务。

## 本地管理

在 Research Pulse 仓库根目录运行：

```powershell
# 三个 Node 服务运行状态保存在 .dev/aihot-original/processes.json。
# 停止本次启动的三个服务（不会停止数据库）：
& .dev/aihot-original/stop-native.ps1

# 重新启动三个服务：
& .dev/aihot-original/start-native.ps1

# 数据库单独启动/停止：
docker start aihot-original-db
docker stop aihot-original-db
```

运行配置、进程记录与日志均位于 `.dev/aihot-original/`。停止脚本核对进程命令行中的专属配置路径，避免 PID 被复用后误停其他进程。数据库卷保留，不执行删除。

浏览器截图：`.dev/aihot-original/home.png`。
