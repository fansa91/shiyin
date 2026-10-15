/**
 * 启动时建表 (幂等)。DB 未配置 (无 SHIYIN_DB_HOST) 则跳过并打印提示,
 * 不影响 rss/charts 等只读接口。
 *
 * 身份体系: 账号密码。users 存用户名 + scrypt 密码哈希, sessions 存
 * Bearer token 的 sha256 (90 天过期)。云端同步四张表外键挂 users(id)。
 *
 * 全部标准 MySQL 8 语法: InnoDB + utf8mb4, 外键级联删除。
 * updated_at 统一存毫秒时间戳 (BIGINT), 由客户端上报, last-write-wins 依据。
 */
import { getPool, dbConfigured, getServerConfig } from './db.js'
import mysql from 'mysql2/promise'

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP NULL DEFAULT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    last_seen TIMESTAMP NULL DEFAULT NULL,
    CONSTRAINT fk_session_user FOREIGN KEY (user_id)
      REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    user_id BIGINT NOT NULL,
    feed_key VARCHAR(512) NOT NULL,
    feed_url TEXT,
    title VARCHAR(512) NOT NULL DEFAULT '',
    author VARCHAR(512) NOT NULL DEFAULT '',
    image TEXT,
    updated_at BIGINT NOT NULL,
    deleted TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, feed_key),
    CONSTRAINT fk_sub_user FOREIGN KEY (user_id)
      REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS listen_later (
    user_id BIGINT NOT NULL,
    episode_key VARCHAR(512) NOT NULL,
    podcast_key VARCHAR(512) NOT NULL DEFAULT '',
    feed_url TEXT,
    podcast_title VARCHAR(512) NOT NULL DEFAULT '',
    title VARCHAR(512) NOT NULL DEFAULT '',
    image TEXT,
    audio_url TEXT,
    duration DOUBLE NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    deleted TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, episode_key),
    CONSTRAINT fk_later_user FOREIGN KEY (user_id)
      REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS progress (
    user_id BIGINT NOT NULL,
    episode_key VARCHAR(512) NOT NULL,
    position DOUBLE NOT NULL DEFAULT 0,
    duration DOUBLE NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    title VARCHAR(512) NOT NULL DEFAULT '',
    podcast_title VARCHAR(512) NOT NULL DEFAULT '',
    artwork TEXT,
    audio_url TEXT,
    podcast_key VARCHAR(512) NOT NULL DEFAULT '',
    feed_url TEXT,
    PRIMARY KEY (user_id, episode_key),
    CONSTRAINT fk_progress_user FOREIGN KEY (user_id)
      REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS settings (
    user_id BIGINT NOT NULL PRIMARY KEY,
    data JSON,
    updated_at BIGINT NOT NULL,
    CONSTRAINT fk_settings_user FOREIGN KEY (user_id)
      REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]

/** 库名白名单: 防注入, 插值进 SQL 前必须校验 */
const DB_NAME_RE = /^[A-Za-z0-9_]+$/

/**
 * 清理废弃的同步码方案残留表 (过渡逻辑)。
 *
 * 背景: 同步码方案从未在线上真正跑通 (migrate 因 SSL 失败, 表没建全就报废了),
 * 残留的旧表 (subscriptions/listen_later/progress/settings 带 identity_id 外键
 * 指向 sync_identities) 无真实用户数据, 可安全删除。
 *
 * 检测: 若 `subscriptions` 表存在 `identity_id` 列 → 判定为旧 schema, 按依赖
 * 顺序 (子表先删) 逐个 DROP; 否则跳过, 绝不碰新 schema 或空库的数据。
 */
async function dropLegacySyncCodeSchema(pool: mysql.Pool): Promise<void> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'subscriptions' AND column_name = 'identity_id'`
  )
  const hasLegacy = Number((rows as Array<{ n: unknown }>)[0]?.n ?? 0) > 0
  if (!hasLegacy) {
    console.log('[shiyin] 未检测到旧同步码 schema, 跳过残留清理')
    return
  }
  console.log('[shiyin] 检测到旧同步码 schema (identity_id), 删除残留表')
  const legacyTables = [
    'settings',
    'progress',
    'listen_later',
    'subscriptions',
    'sessions',
    'sync_identities',
  ]
  for (const t of legacyTables) {
    await pool.query(`DROP TABLE IF EXISTS \`${t}\``)
  }
  console.log('[shiyin] 旧同步码残留表已清理')
}

/**
 * 库不存在则自动建库 (CREATE DATABASE IF NOT EXISTS, 幂等)。
 * 用不带 database 的临时连接, 复用同一 host/port/user/password/ssl 配置。
 * 库名非法直接抛错拒绝; 建库失败 (如用户无 CREATE 权限) 由调用方捕获打日志,
 * 继续原有建表流程 (migrate 失败不致命)。
 */
async function ensureDatabase(name: string): Promise<void> {
  const conn = await mysql.createConnection(getServerConfig())
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
    console.log(`[shiyin] 数据库 ${name} 就绪`)
  } finally {
    await conn.end()
  }
}

/** 建表成功返回 true; 未配置返回 false; 连接失败抛异常 (调用方决定是否致命) */
export async function migrate(): Promise<boolean> {
  if (!dbConfigured()) {
    console.log('[shiyin] SHIYIN_DB_HOST 未设置, 跳过建表, 云端同步接口将返回 503')
    return false
  }
  const dbName = process.env.SHIYIN_DB_NAME
  if (!dbName || !DB_NAME_RE.test(dbName)) {
    throw new Error(`[shiyin] 非法的 SHIYIN_DB_NAME: ${JSON.stringify(dbName ?? '')}, 只允许字母/数字/下划线`)
  }
  try {
    await ensureDatabase(dbName)
  } catch (e) {
    // 建库失败不致命 (如用户无 CREATE 权限), 继续原有建表流程
    console.warn('[shiyin] 自动建库失败, 继续建表:', (e as Error).message)
  }
  const pool = getPool()!
  // 废弃同步码 schema 过渡清理 (检测 identity_id, 新 schema/空库不受影响)
  await dropLegacySyncCodeSchema(pool)
  for (const sql of DDL) {
    await pool.query(sql)
  }
  console.log('[shiyin] sync 表结构就绪')
  return true
}
