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
- 外观: M3 seed color 完整 light/dark 配色, 跟随系统/浅色/深色切换
- 响应式布局: ≥1280px 完整侧边栏 / 960–1280 图标栏 / <960 底部导航

## 后端接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/rss?url=` | RSS 订阅源代理: 拉取并解析为节目/单集 JSON |

前端 iTunes Search API 部分 (搜索/排行榜/分类/节目详情) 直接在浏览器调用,
无需经过后端。

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
查看状态: `systemctl status shiyin-api`, 日志: `journalctl -u shiyin-api -f`。

> 端口说明: 拾音后端默认跑 **3001**, 与流影的 3000 共存于同一台服务器。
> Caddy 的 `/api` 反代要指向 127.0.0.1:3001。
