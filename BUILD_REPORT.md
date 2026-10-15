# 拾音 (shiyin) — 构建报告

构建日期: 2026-10-15
位置: `~/workspace/shiyin`
目标仓库: `github.com/fansa91/shiyin`（尚未创建，**未推送**）

## 构建内容

Web 播客播放器，Apple Podcasts 风格布局 × M3，monorepo 三部分：

- **web/** — Vite + Vue 3 + Vuetify 3 (M3) + Pinia + Vue Router
  - 8 导航项：发现 [首页 /、搜索 /search、排行榜 /charts、分类 /categories]，资料库 [订阅 /subscriptions、稍后听 /later、播放历史 /history]，底部 设置 /settings；另有 播客详情 /podcast/:id
  - 响应式：≥1280px 完整侧边栏 / 960–1280 图标 rail / <960 顶部栏 + 底部 5 项导航
  - 播放器：全局单例 shikwasa（v2.2.1，API 已按 node_modules 源码核实，README 过时），底部 MiniPlayer + 点击展开全屏 PlayerOverlay（常驻 DOM，实例只建一次）；队列由 Pinia store 管理（ended→自动下一首、上一首/下一首/±30s/倍速）；Chapter 插件接 RSS 章节数据；M3 明暗主题通过 CSS 变量同步到 shikwasa
  - 数据：iTunes Search API 前端直连（搜索/详情/单集兜底）；RSS 只走后端 `/api/rss`
  - localStorage：`shiyin-settings`（主题/seedColor/倍速/地区）、`shiyin-subscriptions`（支持"添加 RSS"手动订阅）、`shiyin-later`、`shiyin-history`（{guid: {position, duration, 元数据快照}}，200 条 LRU，断点续播：播放时 seek 到保存位置，timeupdate 每 5s 持久化）
  - 封面图：QueuedImage 并发 6 + IntersectionObserver 懒加载（复用流影模式）
- **api/** — Hono TypeScript（镜像流影结构）
  - `GET /api/health` → `{ok:true}`
  - `GET /api/rss?url=` → 服务端抓取+解析 RSS/Atom，归一化 `{title, link, description, image, language, episodes: [{guid, title, description, pubDate, duration(秒), audioUrl, image, chapters:[{title,startTime,endTime}]}]}`；itunes:duration 解析秒/MM:SS/HH:MM:SS；podcast:chapters JSON best-effort 拉取；15 分钟内存缓存；400/502 错误码
  - `GET /api/charts?country=&genre=&limit=` → Apple toppodcasts 榜单简化；1 小时缓存
  - `GET /api/genres` → Apple 播客分类树（首位"全部"）；24h 缓存，上游失败返回硬编码中文兜底
- **deploy/ + .github/workflows/** — 一键部署脚本（`--dir/--download/--repo/--tag/--user/--port/--node`，默认端口 **3001** 以便与流影共存）、systemd 模板、 Caddyfile（`/api/*` 反代 3001，SPA fallback）、CI：push main 构建 web+api 并发布 rolling `latest` Release（6 个资产）

## 验证证据（全部通过）

| 检查 | 命令 | 结果 |
|---|---|---|
| web 构建 | `cd web && npm ci && npm run build` | ✅ 通过（18.6s，dist 产物正常） |
| web 类型 | `npx vue-tsc --noEmit` | ✅ 零错误 |
| api 构建 | `cd api && npm ci && npm run build` (tsc) | ✅ 通过 |
| api 健康 | `curl :3210/api/health` | ✅ `{"ok":true}` |
| api RSS | `curl ":3210/api/rss?url=https://talkpython.fm/episodes/rss"` | ✅ 200，title "Talk Python To Me"，564 episodes，首集 duration 为 number、audioUrl 有效 |
| api charts | `/api/charts?country=cn&limit=5` | ✅ 5 条，collectionId/artworkUrl600 正常；坏参数 → 400 |
| api genres | `/api/genres` | ✅ 首位 `{id:0,name:'全部'}` |
| api 错误处理 | `/api/rss?url=notaurl` | ✅ 400 `{"error":"bad url"}` |
| deploy 脚本 | `bash -n deploy/deploy.sh` | ✅ 无语法错误 |
| systemd 模板 | sed 替换 @USER@/@DIR@/@NODE@/@PORT@ 后检查 | ✅ 无残留占位符，ExecStart=/usr/bin/node dist/index.js，WorkingDirectory=/srv/shiyin/api |
| CI workflow | `python3 yaml.safe_load(build.yml)` | ✅ 解析正常 |

依赖版本（全部 `npm view` 确认后 pin）：`@hono/node-server ^2.1.5`、`hono ^4.13.13`、`fast-xml-parser ^5.11.2`、`@material/material-color-utilities` **精确 0.3.0**（0.4.0 坏包，不升）、`shikwasa 2.2.1`。

## Deploy 公钥（加到 repo Settings → Deploy keys，勾选 Allow write access）

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAKmud4nQxmsCezgE5wv7a8K3GN+4Ocx1K+HHyKtTeAn shiyin-deploy
```

私钥在 `~/.ssh/shiyin_deploy`（无 passphrase）。

## 剩余手动步骤

1. 用户在 GitHub 创建空公开仓库 `fansa91/shiyin`
2. 上面公钥加为 deploy key（write 权限）
3. 本机推送：
   ```
   cd ~/workspace/shiyin && git init -b main && git add -A && git commit -m "拾音 v0.1.0"
   GIT_SSH_COMMAND="ssh -i ~/.ssh/shiyin_deploy -o ProxyCommand='socat STDIO PROXY:hatch-egress-proxy:ssh.github.com:443,proxyport=3128' -o IdentitiesOnly=yes" \
     git remote add origin git@ssh.github.com:fansa91/shiyin.git
   GIT_SSH_COMMAND=... git push -u origin main
   ```
   （ssh.github.com:443 egress-proxy 走法，参考 AGENTS.md；需 Muse 设置中 Direct network protocols → other_tcp 为 Ask）
4. push 后 CI 自动构建并发布 `latest` Release
5. 服务器部署：
   ```
   curl -sSL -o deploy.sh https://github.com/fansa91/shiyin/releases/download/latest/deploy.sh
   sudo bash deploy.sh --dir /srv/shiyin --download
   ```
   然后按 `deploy/Caddyfile` 手动配 Caddy（把 `listen.example.com` 换成真实域名）

## 云端同步身份体系变更：同步码 → 账号密码（2026-10-15，用户明确要求不用同步码）

**api/ 改动**
- 新增 `src/password.ts`：`node:crypto` scrypt（N=16384,r=8,p=1,64 字节 key,16 字节盐），存储格式 `scrypt$16384$8$1$<saltHex>$<hashHex>`，`verifyPassword` 用 `timingSafeEqual`；不引入 bcrypt/argon2（避免 native 依赖）
- `src/migrate.ts` 重写 schema：`users(id, username UNIQUE, password_hash, created_at, last_seen)`、`sessions(token_hash PK, user_id, created_at, expires_at, last_seen)`；四张业务表外键改挂 `users(id)`（`identity_id`→`user_id`，约束改名 `fk_*_user`）；开头 `DROP TABLE IF EXISTS sync_identities`（废弃同步码表，从未在用户库建成功过，清残留）
- `src/sync.ts` 重写：删除 `/code`、`/rotate`、`x-sync-code` 及旧限流；新增 `POST /register`（用户名 3–32 位 `[A-Za-z0-9_-]`，密码 ≥8 位；已存在 → 409 `username_taken`）、`POST /login`（失败统一 401 `bad_credentials`，防用户名枚举）、`POST /logout`（删当前 token）、`DELETE /account`（body `{password}` 二次校验，级联删全部数据）；token 为 32 字节 base64url（库里只存 sha256），`expires_at = NOW()+90天`，每次使用更新 last_seen，过期 token 删除并 401；认证头 `Authorization: Bearer`；限流：register 10/分钟、login 20/分钟、pull/push 30/分钟（内存，按场景分桶）；DB 错误仍 `{error:"db_error", code}` 500，未配置仍 503；`/status`、`/pull`、`/push` 逻辑不变（身份从 Bearer 解析）
- `src/index.ts`：接口注释同步更新

**web/ 改动**
- 设置页「云端同步」重做：未登录 → 登录/注册 tab（用户名+密码）；已登录 → 显示用户名、上次同步时间、立即同步、退出登录、删除账号（密码二次确认弹窗）；删除所有同步码文案
- `stores/sync.ts`：token 存 `shiyin-sync-token`（+ `shiyin-sync-username`），`register/login/logout/deleteAccount` 替换 `generateCode/bindCode/rotateCode/deleteRemote/unbind`；同步引擎（防抖 push、启动/前台 pull、首次合并）不变
- `api.ts`：`syncApi` 改 Bearer；错误映射更新（409 用户名已存在、401 区分密码错误/登录过期、400 用户名/密码格式）；`apiDelete` 支持 body

**验证证据**
| 检查 | 结果 |
|---|---|
| api `tsc --noEmit` | ✅ 零错误 |
| web `vue-tsc --noEmit` | ✅ 零错误 |
| web `npm run build` | ✅ 通过（仅既有 chunk 体积警告） |
| password 模块直测 | ✅ 格式正确；正确密码 true；错误/畸形 false |
| api 启动（无 DB） | ✅ `/api/sync/status` → `{"db":"unconfigured"}`；`POST /api/sync/register` → 503；`POST /api/sync/login` → 503；`/pull` 无 token → 503 |
| **真实 MySQL 实测** | ❌ 未做——本机无 docker。SQL 为标准 MySQL 8（`INSERT … AS new` 需 8.0.19+，Oracle HeatWave 满足）。上线后建议完整走一遍 register→login→push→pull→logout |

**剩余手动步骤**
1. push 后 CI 发版，服务器 `deploy.sh --download --db-host … --db-ssl-verify=false` 重部署（会 restart 服务，启动时自动建库建表；旧同步码表如存在会被 DROP）
2. `GET /api/sync/status` → `{"db":"ok"}` 后，在设置页注册账号 → 另一台设备登录 → 验证订阅/进度互相同步
3. 注意：旧同步码身份已废弃，如之前生成过同步码，需重新注册账号

## 已知事项（未返工，需后续确认）

- 移动端真机音频后台播放未验证（shikwasa 的 MediaSession 在桌面 Chrome 逻辑上已接，真机待测）
- `/api/genres` 返回的分类名是 Apple 原文英文（"Arts" 等），只有上游失败时的兜底是中文；前端如需全中文需加映射表
- 章节显示依赖播客源在 RSS 里提供 `podcast:chapters`，没有的源则无章节（符合预期）
- `web/vite.config.ts` dev 代理指向 `localhost:3000`；本地联调 api 请用 `PORT=3000`（注意本机已有流影 api 占端口时需错开）
- 未做 `git init`/commit，留待仓库创建后一步完成
