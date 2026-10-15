# 拾音 ShiYin

Web 播客播放器: Apple Podcasts 风格 × Material 3 (M3)。
前端直接调 iTunes Search API (搜索/节目详情/排行榜, 无需密钥且支持 CORS),
RSS 订阅源解析经后端 Hono 做代理, 避免跨域和防盗链。
播放器基于 shikwasa (章节/倍速/快进快退), 播放队列用 Pinia 管理。

## 目录结构

```
shiyin/
├── web/                        # 前端 (Vite + Vue3 + Vuetify3 M3 + shikwasa + Pinia)
│   └── src/
│       ├── views/              # 首页/搜索/排行榜/分类/订阅/稍后听/播放历史/设置
│       ├── components/         # 播放器/节目卡片/单集列表等
│       └── stores/             # Pinia: 播放队列/订阅/设置等
├── api/                        # 后端 (Hono + TypeScript)
│   └── src/index.ts            # /api/rss (RSS 代理解析) / /api/health
├── .github/workflows/build.yml # CI: 分别打出 web-dist / api-dist, 发到 rolling latest Release
└── deploy/
    ├── Caddyfile               # 静态托管 + /api 反代 (手动配置)
    └── shiyin-api.service      # systemd 单元模板
```

## 功能

- 发现: 首页推荐 / 全文搜索 / 排行榜 / 分类浏览 (iTunes Search API)
- 资料库: 订阅 / 稍后听 / 播放历史 (localStorage 持久化)
- 播放: shikwasa 播放器 — 章节跳转、倍速、快进/快退, 播放队列连续播放
- 断点续播: 记录每集收听进度, 下次自动续播
- 云端同步 (可选): 账号密码登录, 多设备同步订阅/稍后听/播放进度/设置, 需后端配置 MySQL
- 外观: M3 seed color 完整 light/dark 配色, 跟随系统/浅色/深色切换
- 响应式布局: ≥1280px 完整侧边栏 / 960–1280 图标栏 / <960 底部导航

## 后端接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/rss?url=` | RSS 订阅源代理: 拉取并解析为节目/单集 JSON |
| `GET /api/charts` | Apple Podcasts 排行榜代理 |
| `GET /api/genres` | 播客分类列表 |
| `POST /api/sync/register` | 注册 `{username, password}` → `{token}` (用户名 3–32 位字母/数字/`_`/`-`, 密码 ≥8 位) |
| `POST /api/sync/login` | 登录 `{username, password}` → `{token}` (失败统一 401, 防用户名枚举) |
| `POST /api/sync/logout` | 注销当前 token (需 `Authorization: Bearer`) |
| `DELETE /api/sync/account` | 删除账号及全部云端数据, body `{password}` 二次校验 (需 `Authorization: Bearer`) |
| `GET /api/sync/status` | 数据库连通性诊断 `{db:"ok" \| "unconfigured" \| "error"}` (免鉴权) |
| `GET /api/sync/pull?since=` | 增量拉取 (需 `Authorization: Bearer`) |
| `POST /api/sync/push` | 增量推送, 行级 last-write-wins (需 `Authorization: Bearer`) |

前端 iTunes Search API 部分 (搜索/排行榜/分类/节目详情) 直接在浏览器调用,
无需经过后端。同步接口需后端配置 MySQL, 否则返回 503。

## 云端同步

设置页 → 云端同步: 注册/登录账号, 即可跨设备同步订阅、稍后听、播放进度和设置。
密码经 scrypt 加盐哈希存储 (服务端不存明文); 登录签发的 Bearer token 90 天过期,
库里只存 token 的 sha256。首次登录自动把本机数据合并上云。

后端需要 MySQL 8 (SSL 连接)。环境变量:

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SHIYIN_DB_HOST` | 是 | 数据库主机 (未设置 = 同步功能关闭) |
| `SHIYIN_DB_PORT` | 否 | 端口, 默认 3306 |
| `SHIYIN_DB_USER` | 是 | 用户名 |
| `SHIYIN_DB_PASSWORD` | 是 | 密码 |
| `SHIYIN_DB_NAME` | 是 | 库名 |
| `SHIYIN_DB_SSL_CA` | 否 | CA 证书文件路径 (服务端 CA 不在系统 CA 池内时必填, 如 Oracle 自签 CA) |
| `SHIYIN_DB_SSL_VERIFY` | 否 | 是否校验服务端证书, 默认 `true`。设为 `false` 关闭校验 (降级选项, 有中间人风险, 仅建议自建内网/可信网络使用; 如 Oracle MySQL 自签证书链报 HANDSHAKE_SSL_ERROR 时可临时关闭) |

SSL 默认开启并校验服务端证书。部署时用 deploy.sh 的 `--db-host/--db-port/--db-user/--db-password/--db-name/--db-ssl-ca/--db-ssl-verify`
参数传入, 会写入 `<dir>/api/db.env` (0600 权限) 并由 systemd 加载。
Oracle Cloud MySQL: 需在安全列表中对 API 服务器 IP 放行 3306 入站, 并确认实例启用了 SSL。

## 本地开发

```bash
# 后端 :3001 (vite 已配好 /api 代理到 localhost:3001)
cd api && npm ci && npm run dev

# 前端
cd web && npm ci && npm run dev
```

## 部署

每次 push 到 main 会自动构建, 并把部署包发布到
[Release (tag: latest)](https://github.com/fansa91/shiyin/releases/tag/latest)。

```bash
# 在服务器上: 下载部署脚本, 一键部署 (包会自动从 Release 下载)
curl -sSL -o deploy.sh https://github.com/fansa91/shiyin/releases/download/latest/deploy.sh
chmod +x deploy.sh
sudo ./deploy.sh --dir /srv/shiyin --download
```

也可以用本地包: `sudo ./deploy.sh --dir /srv/shiyin --web-dist ./web-dist --api-dist ./api-dist`,
或指定仓库/标签: `--repo owner/name --tag v1.0.0`。Caddy 手动配置, 参考 `deploy/Caddyfile`。

脚本会: 拷贝前端到 `<dir>/web`, 后端到 `<dir>/api` 并 `npm ci --omit=dev`,
按 `--dir/--user/--port` 生成 systemd 单元并启动。

启用云端同步 (示例, Oracle Cloud 免费 MySQL):

```bash
sudo ./deploy.sh --dir /srv/shiyin --download \
  --db-host <mysql-host> --db-port 3306 \
  --db-user shiyin --db-password 'xxx' --db-name shiyin \
  --db-ssl-ca /srv/shiyin/api/ca.pem
```

不传 `--db-host` 则不同步相关配置, 同步接口返回 503, 不影响 RSS/排行榜。
查看状态: `systemctl status shiyin-api`, 日志: `journalctl -u shiyin-api -f`。

> 端口说明: 拾音后端默认跑 **3001**, 与流影的 3000 共存于同一台服务器。
> Caddy 的 `/api` 反代要指向 127.0.0.1:3001。
