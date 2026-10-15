#!/usr/bin/env bash
#
# 拾音一键部署脚本
#
# 两种用法:
#   1) 自动下载 (推荐): sudo ./deploy.sh --dir /srv/shiyin --download
#      从 GitHub Release (默认 fansa91/shiyin 的 latest) 下载部署包
#   2) 本地包: sudo ./deploy.sh --dir /srv/shiyin \
#                --web-dist ./web-dist --api-dist ./api-dist
#
# 可选: --repo owner/name --tag latest --user root --port 3001 --node /usr/bin/node
# Caddy 请手动配置, 参考 deploy/Caddyfile (注意把 /api 反代到 --port)
#
set -euo pipefail

DIR="/srv/shiyin"
WEB_DIST=""
API_DIST=""
DOWNLOAD=0
REPO="fansa91/shiyin"
TAG="latest"
USER="root"
PORT="3001"
NODE_BIN=""
# 云端同步数据库 (可选, 不传则不同步相关环境变量, 后端 sync 接口返回 503)
DB_HOST=""
DB_PORT="3306"
DB_USER=""
DB_PASSWORD=""
DB_NAME=""
DB_SSL_CA=""

usage() {
  cat <<'EOF'
拾音一键部署脚本

用法:
  sudo ./deploy.sh --dir /srv/shiyin --download [--repo owner/name] [--tag latest]
  sudo ./deploy.sh --dir /srv/shiyin --web-dist ./web-dist --api-dist ./api-dist

选项:
  --dir       安装目录 (默认 /srv/shiyin), 下面会生成 web/ 和 api/
  --download  从 GitHub Release 自动下载部署包 (与 --web-dist/--api-dist 互斥)
  --repo      仓库 (默认 fansa91/shiyin, 仅 --download 用)
  --tag       Release 标签 (默认 latest, 仅 --download 用)
  --web-dist  前端 dist 目录 (默认 <repo>/web/dist)
  --api-dist  后端目录, 里面需有 dist/ + package.json (默认 <repo>/api)
  --user      运行用户 (默认 root, 不存在会自动创建)
  --port      后端端口 (默认 3001, 与流影的 3000 共存)
  --node      node 可执行文件路径 (默认自动探测 command -v node)
  --db-host   MySQL 主机 (云端同步用; 不传则不启用同步)
  --db-port   MySQL 端口 (默认 3306)
  --db-user   MySQL 用户名
  --db-password MySQL 密码
  --db-name   MySQL 库名
  --db-ssl-ca MySQL CA 证书路径 (可选, 默认用系统 CA 校验)

Caddy 请手动配置, 参考 deploy/Caddyfile (注意把 /api 反代到 --port)
云端同步: Oracle Cloud MySQL 需对本机 IP 放行 3306 入站并启用 SSL
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)      DIR="$2";      shift 2 ;;
    --web-dist) WEB_DIST="$2"; shift 2 ;;
    --api-dist) API_DIST="$2"; shift 2 ;;
    --download) DOWNLOAD=1;    shift ;;
    --repo)     REPO="$2";     shift 2 ;;
    --tag)      TAG="$2";      shift 2 ;;
    --user)     USER="$2";     shift 2 ;;
    --port)     PORT="$2";     shift 2 ;;
    --node)     NODE_BIN="$2"; shift 2 ;;
    --db-host)     DB_HOST="$2";     shift 2 ;;
    --db-port)     DB_PORT="$2";     shift 2 ;;
    --db-user)     DB_USER="$2";     shift 2 ;;
    --db-password) DB_PASSWORD="$2"; shift 2 ;;
    --db-name)     DB_NAME="$2";     shift 2 ;;
    --db-ssl-ca)   DB_SSL_CA="$2";   shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "未知参数: $1"; usage; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SERVICE_TEMPLATE="$SCRIPT_DIR/shiyin-api.service"

dl() { # dl <url> <dest>
  echo "下载 $1"
  curl -sSL --fail --retry 3 -o "$2" "$1"
  [[ -s "$2" ]] || { echo "下载失败或文件为空: $1"; exit 1; }
}

WORK=""
cleanup() { [[ -n "$WORK" && -d "$WORK" ]] && rm -rf "$WORK"; }
trap cleanup EXIT

if [[ "$DOWNLOAD" -eq 1 ]]; then
  command -v curl >/dev/null || { echo "需要先安装 curl"; exit 1; }
  command -v tar >/dev/null || { echo "需要先安装 tar"; exit 1; }
  if [[ -n "$WEB_DIST" || -n "$API_DIST" ]]; then
    echo "--download 不能与 --web-dist/--api-dist 同时使用"; exit 1
  fi
  WORK="$(mktemp -d)"
  BASE="https://github.com/${REPO}/releases/download/${TAG}"
  mkdir -p "$WORK/web-dist" "$WORK/api-dist"
  dl "$BASE/shiyin-web-dist.tar.gz" "$WORK/web-dist.tar.gz"
  dl "$BASE/shiyin-api-dist.tar.gz"  "$WORK/api-dist.tar.gz"
  dl "$BASE/shiyin-api.service"      "$WORK/shiyin-api.service"
  tar -xzf "$WORK/web-dist.tar.gz" -C "$WORK/web-dist"
  tar -xzf "$WORK/api-dist.tar.gz"  -C "$WORK/api-dist"
  WEB_DIST="$WORK/web-dist"
  API_DIST="$WORK/api-dist"
  SERVICE_TEMPLATE="$WORK/shiyin-api.service"
fi

[[ -z "$WEB_DIST" ]] && WEB_DIST="$REPO_ROOT/web/dist"
[[ -z "$API_DIST" ]] && API_DIST="$REPO_ROOT/api"

[[ "$EUID" -eq 0 ]] || { echo "请用 root 运行 (需要写 /etc/systemd)"; exit 1; }
[[ -n "$DIR" && "$DIR" != "/" ]] || { echo "--dir 非法"; exit 1; }
[[ -d "$WEB_DIST" ]] || { echo "找不到前端 dist: $WEB_DIST"; exit 1; }
[[ -d "$API_DIST/dist" ]] || { echo "找不到后端构建产物: $API_DIST/dist"; exit 1; }
[[ -f "$SERVICE_TEMPLATE" ]] || { echo "找不到 systemd 模板: $SERVICE_TEMPLATE"; exit 1; }

# node 路径自动探测
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || { echo "找不到可执行的 node, 请先安装 node 或用 --node 指定路径"; exit 1; }
echo "使用 node: $NODE_BIN"

echo "==> 部署到 $DIR"

# 运行用户
if ! id "$USER" >/dev/null 2>&1; then
  useradd -r -s /usr/sbin/nologin "$USER"
  echo "创建系统用户 $USER"
fi

# 前端静态文件
mkdir -p "$DIR/web"
rm -rf "${DIR:?}/web"/*
cp -r "$WEB_DIST"/. "$DIR/web"/
echo "前端 -> $DIR/web"

# 后端
mkdir -p "$DIR/api"
rm -rf "${DIR:?}/api/dist"
cp -r "$API_DIST/dist" "$DIR/api/dist"
cp "$API_DIST/package.json" "$API_DIST/package-lock.json" "$DIR/api/"
(cd "$DIR/api" && npm ci --omit=dev --no-audit --no-fund >/dev/null)
if [[ "$USER" != "root" ]]; then
  chown -R "$USER:$USER" "$DIR"
fi
echo "后端 -> $DIR/api (端口 $PORT, 用户 $USER)"

# 云端同步数据库配置 (可选): 只在给了 --db-host 时写 db.env,
# systemd 用 EnvironmentFile=- 前缀按需加载 (文件不存在也不报错)。
# 用 EnvironmentFile 而不用 Environment= 写密码: 避免密码出现在 systemctl show 输出里。
if [[ -n "$DB_HOST" ]]; then
  DB_ENV="$DIR/api/db.env"
  {
    echo "SHIYIN_DB_HOST=$DB_HOST"
    echo "SHIYIN_DB_PORT=$DB_PORT"
    [[ -n "$DB_USER" ]] && echo "SHIYIN_DB_USER=$DB_USER"
    [[ -n "$DB_PASSWORD" ]] && echo "SHIYIN_DB_PASSWORD=$DB_PASSWORD"
    [[ -n "$DB_NAME" ]] && echo "SHIYIN_DB_NAME=$DB_NAME"
    [[ -n "$DB_SSL_CA" ]] && echo "SHIYIN_DB_SSL_CA=$DB_SSL_CA"
  } > "$DB_ENV"
  chmod 600 "$DB_ENV"
  if [[ "$USER" != "root" ]]; then
    chown "$USER:$USER" "$DB_ENV"
  fi
  echo "数据库配置 -> $DB_ENV (0600, 仅 $USER 可读)"
fi

# systemd
sed -e "s|@DIR@|$DIR|g" -e "s|@USER@|$USER|g" -e "s|@PORT@|$PORT|g" -e "s|@NODE@|$NODE_BIN|g" \
  "$SERVICE_TEMPLATE" > /etc/systemd/system/shiyin-api.service
systemctl daemon-reload
systemctl enable shiyin-api.service >/dev/null
systemctl restart shiyin-api.service
echo "systemd 服务 shiyin-api 已启动"

echo
echo "完成. Caddy 请手动配置 (参考 deploy/Caddyfile), /api 反代到 127.0.0.1:$PORT"
echo "查看状态: systemctl status shiyin-api | 日志: journalctl -u shiyin-api -f"
