/**
 * 启动时建表 (幂等)。DB 未配置 (无 SHIYIN_DB_HOST) 则跳过并打印提示,
 * 不影响 rss/charts 等只读接口。
 *
 * 全部标准 MySQL 8 语法: InnoDB + utf8mb4, 外键级联删除。
 * updated_at 统一存毫秒时间戳 (BIGINT), 由客户端上报, last-write-wins 依据。
 */
import { getPool, dbConfigured } from './db.js'

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS sync_identities (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP NULL DEFAULT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    identity_id BIGINT NOT NULL,
    feed_key VARCHAR(512) NOT NULL,
    feed_url TEXT,
    title VARCHAR(512) NOT NULL DEFAULT '',
    author VARCHAR(512) NOT NULL DEFAULT '',
    image TEXT,
    updated_at BIGINT NOT NULL,
    deleted TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (identity_id, feed_key),
    CONSTRAINT fk_sub_identity FOREIGN KEY (identity_id)
      REFERENCES sync_identities (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS listen_later (
    identity_id BIGINT NOT NULL,
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
    PRIMARY KEY (identity_id, episode_key),
    CONSTRAINT fk_later_identity FOREIGN KEY (identity_id)
      REFERENCES sync_identities (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS progress (
    identity_id BIGINT NOT NULL,
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
    PRIMARY KEY (identity_id, episode_key),
    CONSTRAINT fk_progress_identity FOREIGN KEY (identity_id)
      REFERENCES sync_identities (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS settings (
    identity_id BIGINT NOT NULL PRIMARY KEY,
    data JSON,
    updated_at BIGINT NOT NULL,
    CONSTRAINT fk_settings_identity FOREIGN KEY (identity_id)
      REFERENCES sync_identities (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
]

/** 建表成功返回 true; 未配置返回 false; 连接失败抛异常 (调用方决定是否致命) */
export async function migrate(): Promise<boolean> {
  if (!dbConfigured()) {
    console.log('[shiyin] SHIYIN_DB_HOST 未设置, 跳过建表, 云端同步接口将返回 503')
    return false
  }
  const pool = getPool()!
  for (const sql of DDL) {
    await pool.query(sql)
  }
  console.log('[shiyin] sync 表结构就绪')
  return true
}
