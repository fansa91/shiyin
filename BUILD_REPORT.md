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

## 已知事项（未返工，需后续确认）

- 移动端真机音频后台播放未验证（shikwasa 的 MediaSession 在桌面 Chrome 逻辑上已接，真机待测）
- `/api/genres` 返回的分类名是 Apple 原文英文（"Arts" 等），只有上游失败时的兜底是中文；前端如需全中文需加映射表
- 章节显示依赖播客源在 RSS 里提供 `podcast:chapters`，没有的源则无章节（符合预期）
- `web/vite.config.ts` dev 代理指向 `localhost:3000`；本地联调 api 请用 `PORT=3000`（注意本机已有流影 api 占端口时需错开）
- 未做 `git init`/commit，留待仓库创建后一步完成
