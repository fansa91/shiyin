/**
 * 云端同步接口 (挂载到 /api/sync)。
 *
 * 身份: 同步码方案, 无注册。客户端在请求头 x-sync-code 携带明文码,
 * 服务端只存 sha256(code_hash), 401 = 码缺失/无效, 503 = 后端未配置数据库。
 *
 *   POST   /api/sync/code    生成同步码 (明文只返回这一次, 请妥善保存)
 *   POST   /api/sync/rotate  换码 (需 x-sync-code)
 *   DELETE /api/sync/code    删除身份及全部云端数据 (需 x-sync-code)
 *   GET    /api/sync/pull?since=<ms>   增量拉取 (需 x-sync-code)
 *   POST   /api/sync/push    增量推送 (需 x-sync-code)
 *   GET    /api/sync/status  数据库连通性诊断 (免鉴权)
 *
 * 合并语义: 所有行按 updated_at(毫秒) last-write-wins;
 * 删除用 deleted=1 墓碑行传播, pull 会把墓碑一并返回。
 */
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'mysql2/promise'
import { getPool } from './db.js'

type SyncVars = {
  pool: Pool
  identityId: number
}

export const sync = new Hono<{ Variables: SyncVars }>()

const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/** 32 字符 url-safe 随机码: 24 字节 -> base64url 恰好 32 字符 */
function genCode(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * DB 错误统一返回: 只暴露 err.code (如 ECONNREFUSED / ETIMEDOUT /
 * ER_ACCESS_DENIED_ERROR / ER_NO_SUCH_TABLE), 绝不暴露 err.message / sql / 配置。
 * 完整错误打服务端日志。
 */
function dbError(c: Context<{ Variables: SyncVars }>, err: unknown) {
  console.error('[sync] db error:', err)
  const code = (err as { code?: unknown } | null)?.code
  return c.json({ error: 'db_error', code: typeof code === 'string' ? code : 'unknown' }, 500)
}

/* ---------------- 限流: pull/push 同 IP 1 分钟最多 30 次 ---------------- */

const rl = new Map<string, { count: number; reset: number }>()
const RL_LIMIT = 30
const RL_WINDOW = 60_000

function clientIp(c: Context<{ Variables: SyncVars }>): string {
  const fwd = c.req.header('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  // @hono/node-server 把原生请求放在 c.env.incoming
  const env = c.env as unknown as { incoming?: { socket?: { remoteAddress?: string } } }
  return env?.incoming?.socket?.remoteAddress ?? 'unknown'
}

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const e = rl.get(ip)
  if (!e || now > e.reset) {
    rl.set(ip, { count: 1, reset: now + RL_WINDOW })
    // 防止 Map 无限增长
    if (rl.size > 10_000) rl.clear()
    return false
  }
  e.count += 1
  return e.count > RL_LIMIT
}

/* ---------------- 认证中间件 ---------------- */

async function requireIdentity(c: Context<{ Variables: SyncVars }>, next: Next) {
  const pool: Pool | null = getPool()
  if (!pool) return c.json({ error: 'sync not configured (missing SHIYIN_DB_*)' }, 503)
  const code = (c.req.header('x-sync-code') ?? '').trim()
  if (!code) return c.json({ error: 'missing x-sync-code' }, 401)
  let rows: unknown
  try {
    ;[rows] = await pool.query('SELECT id FROM sync_identities WHERE code_hash = ?', [
      sha256hex(code),
    ])
  } catch (e) {
    return dbError(c, e)
  }
  const id = (rows as any[])[0]?.id
  if (!id) return c.json({ error: 'invalid sync code' }, 401)
  c.set('pool', pool)
  c.set('identityId', Number(id))
  await next()
}

/* ---------------- 状态诊断 (免鉴权) ---------------- */

sync.get('/status', async (c) => {
  const pool = getPool()
  if (!pool) return c.json({ db: 'unconfigured' })
  try {
    await pool.query('SELECT 1')
    return c.json({ db: 'ok' })
  } catch (e) {
    // 完整错误只打服务端日志, 不暴露给客户端
    console.error('[sync/status] db ping failed:', e)
    return c.json({ db: 'error' })
  }
})

/* ---------------- 建码 / 换码 / 删除 ---------------- */

sync.post('/code', async (c) => {
  const pool = getPool()
  if (!pool) return c.json({ error: 'sync not configured (missing SHIYIN_DB_*)' }, 503)
  // 哈希碰撞概率可忽略, 重试 5 次防唯一键冲突
  for (let i = 0; i < 5; i++) {
    const code = genCode()
    try {
      await pool.query('INSERT INTO sync_identities (code_hash) VALUES (?)', [sha256hex(code)])
      return c.json({ code })
    } catch (e: any) {
      if (e?.code === 'ER_DUP_ENTRY') continue
      return dbError(c, e)
    }
  }
  return c.json({ error: 'please retry' }, 500)
})

sync.post('/rotate', requireIdentity, async (c) => {
  const pool: Pool = c.get('pool')
  const identityId: number = c.get('identityId')
  for (let i = 0; i < 5; i++) {
    const code = genCode()
    try {
      await pool.query('UPDATE sync_identities SET code_hash = ? WHERE id = ?', [
        sha256hex(code),
        identityId,
      ])
      return c.json({ code })
    } catch (e: any) {
      if (e?.code === 'ER_DUP_ENTRY') continue
      return dbError(c, e)
    }
  }
  return c.json({ error: 'please retry' }, 500)
})

sync.delete('/code', requireIdentity, async (c) => {
  const pool: Pool = c.get('pool')
  const identityId: number = c.get('identityId')
  // 外键 ON DELETE CASCADE 级联清掉该身份全部数据
  try {
    await pool.query('DELETE FROM sync_identities WHERE id = ?', [identityId])
  } catch (e) {
    return dbError(c, e)
  }
  return c.json({ ok: true })
})

/* ---------------- 拉取 ---------------- */

sync.get('/pull', requireIdentity, async (c) => {
  if (rateLimited(clientIp(c))) return c.json({ error: 'rate limited, retry later' }, 429)
  const pool: Pool = c.get('pool')
  const identityId: number = c.get('identityId')
  const since = Number(c.req.query('since') ?? 0)
  if (!Number.isFinite(since) || since < 0) return c.json({ error: 'bad since' }, 400)

  try {
  const [subs] = await pool.query(
    'SELECT feed_key, feed_url, title, author, image, updated_at, deleted FROM subscriptions WHERE identity_id = ? AND updated_at > ?',
    [identityId, since],
  )
  const [later] = await pool.query(
    'SELECT episode_key, podcast_key, feed_url, podcast_title, title, image, audio_url, duration, updated_at, deleted FROM listen_later WHERE identity_id = ? AND updated_at > ?',
    [identityId, since],
  )
  const [prog] = await pool.query(
    'SELECT episode_key, position, duration, updated_at, title, podcast_title, artwork, audio_url, podcast_key, feed_url FROM progress WHERE identity_id = ? AND updated_at > ?',
    [identityId, since],
  )
  const [setRows] = await pool.query('SELECT data, updated_at FROM settings WHERE identity_id = ?', [
    identityId,
  ])

  await pool.query('UPDATE sync_identities SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [
    identityId,
  ])

  const subRows = subs as any[]
  const laterRows = later as any[]
  const setRow = (setRows as any[])[0]
  // mysql2 会把 JSON 列自动解析为对象, 兼容字符串形式
  const setData = setRow?.data == null ? null : typeof setRow.data === 'string' ? JSON.parse(setRow.data) : setRow.data

  return c.json({
    server_time: Date.now(),
    subscriptions: subRows,
    listen_later: laterRows,
    progress: prog,
    settings: setRow ? { data: setData, updated_at: Number(setRow.updated_at) } : null,
    tombstones: {
      subscriptions: subRows.filter((r) => r.deleted).map((r) => r.feed_key),
      listen_later: laterRows.filter((r) => r.deleted).map((r) => r.episode_key),
    },
  })
  } catch (e) {
    return dbError(c, e)
  }
})

/* ---------------- 推送 ---------------- */

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown, max = 2000): string =>
  typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max)

sync.post('/push', requireIdentity, async (c) => {
  if (rateLimited(clientIp(c))) return c.json({ error: 'rate limited, retry later' }, 429)
  const pool: Pool = c.get('pool')
  const identityId: number = c.get('identityId')

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'bad json' }, 400)
  }
  if (!body || typeof body !== 'object') return c.json({ error: 'bad body' }, 400)

  const subs = Array.isArray(body.subscriptions) ? body.subscriptions.slice(0, 5000) : []
  const later = Array.isArray(body.listen_later) ? body.listen_later.slice(0, 5000) : []
  const prog = Array.isArray(body.progress) ? body.progress.slice(0, 5000) : []
  const settingsBody = body.settings

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    for (const s of subs) {
      const feedKey = str(s?.feed_key, 512)
      if (!feedKey) continue
      // 标准 MySQL 8 行别名写法 (8.0.19+): 仅 incoming.updated_at 更大时覆盖
      await conn.query(
        `INSERT INTO subscriptions (identity_id, feed_key, feed_url, title, author, image, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE
           feed_url = IF(new.updated_at > subscriptions.updated_at, new.feed_url, subscriptions.feed_url),
           title = IF(new.updated_at > subscriptions.updated_at, new.title, subscriptions.title),
           author = IF(new.updated_at > subscriptions.updated_at, new.author, subscriptions.author),
           image = IF(new.updated_at > subscriptions.updated_at, new.image, subscriptions.image),
           deleted = IF(new.updated_at > subscriptions.updated_at, new.deleted, subscriptions.deleted),
           updated_at = IF(new.updated_at > subscriptions.updated_at, new.updated_at, subscriptions.updated_at)`,
        [identityId, feedKey, str(s?.feed_url, 65535), str(s?.title, 512), str(s?.author, 512), str(s?.image, 65535), num(s?.updated_at), s?.deleted ? 1 : 0],
      )
    }

    for (const l of later) {
      const episodeKey = str(l?.episode_key, 512)
      if (!episodeKey) continue
      await conn.query(
        `INSERT INTO listen_later (identity_id, episode_key, podcast_key, feed_url, podcast_title, title, image, audio_url, duration, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE
           podcast_key = IF(new.updated_at > listen_later.updated_at, new.podcast_key, listen_later.podcast_key),
           feed_url = IF(new.updated_at > listen_later.updated_at, new.feed_url, listen_later.feed_url),
           podcast_title = IF(new.updated_at > listen_later.updated_at, new.podcast_title, listen_later.podcast_title),
           title = IF(new.updated_at > listen_later.updated_at, new.title, listen_later.title),
           image = IF(new.updated_at > listen_later.updated_at, new.image, listen_later.image),
           audio_url = IF(new.updated_at > listen_later.updated_at, new.audio_url, listen_later.audio_url),
           duration = IF(new.updated_at > listen_later.updated_at, new.duration, listen_later.duration),
           deleted = IF(new.updated_at > listen_later.updated_at, new.deleted, listen_later.deleted),
           updated_at = IF(new.updated_at > listen_later.updated_at, new.updated_at, listen_later.updated_at)`,
        [
          identityId,
          episodeKey,
          str(l?.podcast_key, 512),
          str(l?.feed_url, 65535),
          str(l?.podcast_title, 512),
          str(l?.title, 512),
          str(l?.image, 65535),
          str(l?.audio_url, 65535),
          num(l?.duration),
          num(l?.updated_at),
          l?.deleted ? 1 : 0,
        ],
      )
    }

    for (const p of prog) {
      const episodeKey = str(p?.episode_key, 512)
      if (!episodeKey) continue
      await conn.query(
        `INSERT INTO progress (identity_id, episode_key, position, duration, updated_at, title, podcast_title, artwork, audio_url, podcast_key, feed_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE
           position = IF(new.updated_at > progress.updated_at, new.position, progress.position),
           duration = IF(new.updated_at > progress.updated_at, new.duration, progress.duration),
           updated_at = IF(new.updated_at > progress.updated_at, new.updated_at, progress.updated_at),
           title = IF(new.updated_at > progress.updated_at, new.title, progress.title),
           podcast_title = IF(new.updated_at > progress.updated_at, new.podcast_title, progress.podcast_title),
           artwork = IF(new.updated_at > progress.updated_at, new.artwork, progress.artwork),
           audio_url = IF(new.updated_at > progress.updated_at, new.audio_url, progress.audio_url),
           podcast_key = IF(new.updated_at > progress.updated_at, new.podcast_key, progress.podcast_key),
           feed_url = IF(new.updated_at > progress.updated_at, new.feed_url, progress.feed_url)`,
        [
          identityId,
          episodeKey,
          num(p?.position),
          num(p?.duration),
          num(p?.updated_at),
          str(p?.title, 512),
          str(p?.podcast_title, 512),
          str(p?.artwork, 65535),
          str(p?.audio_url, 65535),
          str(p?.podcast_key, 512),
          str(p?.feed_url, 65535),
        ],
      )
    }

    if (settingsBody && typeof settingsBody === 'object' && settingsBody.data && typeof settingsBody.data === 'object') {
      await conn.query(
        `INSERT INTO settings (identity_id, data, updated_at)
         VALUES (?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE
           data = IF(new.updated_at > settings.updated_at, new.data, settings.data),
           updated_at = IF(new.updated_at > settings.updated_at, new.updated_at, settings.updated_at)`,
        [identityId, JSON.stringify(settingsBody.data), num(settingsBody.updated_at)],
      )
    }

    await conn.commit()
    return c.json({ ok: true, server_time: Date.now() })
  } catch (e: any) {
    try {
      await conn.rollback()
    } catch {
      /* 回滚失败也不掩盖原始异常, 继续返回 DB 错误 */
    }
    return dbError(c, e)
  } finally {
    conn.release()
  }
})
