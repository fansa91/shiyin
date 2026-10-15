/**
 * 云端同步接口 (挂载到 /api/sync)。
 *
 * 身份: 账号密码。users 存用户名 + scrypt 密码哈希; 登录/注册成功后签发
 * Bearer token (库里只存 sha256, 90 天过期)。客户端在请求头
 * Authorization: Bearer <token> 携带 token。
 * 401 = 缺失/无效/过期 token, 409 = 用户名已存在, 503 = 后端未配置数据库。
 *
 *   POST   /api/sync/register  注册 {username, password} -> {token}
 *   POST   /api/sync/login     登录 {username, password} -> {token}
 *   POST   /api/sync/logout    注销当前 token (需 Bearer)
 *   DELETE /api/sync/account   删除账号及全部云端数据, body {password} 二次校验 (需 Bearer)
 *   GET    /api/sync/pull?since=<ms>   增量拉取 (需 Bearer)
 *   POST   /api/sync/push    增量推送 (需 Bearer)
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
import { hashPassword, verifyPassword } from './password.js'

type SyncVars = {
  pool: Pool
  userId: number
  username: string
  tokenHash: string
}

export const sync = new Hono<{ Variables: SyncVars }>()

const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/** 用户名 3-32 位, 字母/数字/_/- */
const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/
const MIN_PASSWORD_LEN = 8
/** token 有效期 90 天 */
const TOKEN_TTL = 'INTERVAL 90 DAY'

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

/* ---------------- 限流 (内存实现, 按场景分桶) ---------------- */

const rl = new Map<string, { count: number; reset: number }>()
const RL_WINDOW = 60_000
const RL_REGISTER = 10 // 注册: 同 IP 1 分钟 10 次
const RL_LOGIN = 20 // 登录: 同 IP 1 分钟 20 次
const RL_SYNC = 30 // pull/push: 同 IP 1 分钟 30 次

function clientIp(c: Context<{ Variables: SyncVars }>): string {
  const fwd = c.req.header('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  // @hono/node-server 把原生请求放在 c.env.incoming
  const env = c.env as unknown as { incoming?: { socket?: { remoteAddress?: string } } }
  return env?.incoming?.socket?.remoteAddress ?? 'unknown'
}

function rateLimited(bucket: string, ip: string, limit: number): boolean {
  const key = `${bucket}|${ip}`
  const now = Date.now()
  const e = rl.get(key)
  if (!e || now > e.reset) {
    rl.set(key, { count: 1, reset: now + RL_WINDOW })
    // 防止 Map 无限增长
    if (rl.size > 10_000) rl.clear()
    return false
  }
  e.count += 1
  return e.count > limit
}

/* ---------------- token 签发 ---------------- */

/** 32 字节 -> base64url 43 字符; 库里只存 sha256(token) */
async function issueToken(pool: Pool, userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), ${TOKEN_TTL}))`,
    [sha256hex(token), userId],
  )
  return token
}

/* ---------------- 认证中间件 ---------------- */

async function requireUser(c: Context<{ Variables: SyncVars }>, next: Next) {
  const pool: Pool | null = getPool()
  if (!pool) return c.json({ error: 'sync not configured (missing SHIYIN_DB_*)' }, 503)
  const m = /^Bearer\s+(.+)$/i.exec((c.req.header('authorization') ?? '').trim())
  if (!m) return c.json({ error: 'missing_token' }, 401)
  const tokenHash = sha256hex(m[1])
  let rows: unknown
  try {
    ;[rows] = await pool.query(
      'SELECT s.user_id, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
      [tokenHash],
    )
  } catch (e) {
    return dbError(c, e)
  }
  const row = (rows as any[])[0]
  if (!row) return c.json({ error: 'invalid_token' }, 401)
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    try {
      await pool.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash])
    } catch (e) {
      return dbError(c, e)
    }
    return c.json({ error: 'token_expired' }, 401)
  }
  try {
    await pool.query('UPDATE sessions SET last_seen = CURRENT_TIMESTAMP WHERE token_hash = ?', [
      tokenHash,
    ])
    await pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [row.user_id])
  } catch (e) {
    return dbError(c, e)
  }
  c.set('pool', pool)
  c.set('userId', Number(row.user_id))
  c.set('username', String(row.username))
  c.set('tokenHash', tokenHash)
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

/* ---------------- 注册 / 登录 / 注销 / 删号 ---------------- */

async function readJson(c: Context): Promise<any> {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

sync.post('/register', async (c) => {
  const pool = getPool()
  if (!pool) return c.json({ error: 'sync not configured (missing SHIYIN_DB_*)' }, 503)
  if (rateLimited('register', clientIp(c), RL_REGISTER))
    return c.json({ error: 'rate limited, retry later' }, 429)
  const body = await readJson(c)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!USERNAME_RE.test(username)) return c.json({ error: 'bad_username' }, 400)
  if (password.length < MIN_PASSWORD_LEN) return c.json({ error: 'weak_password' }, 400)
  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [username])
    if ((rows as any[])[0]) return c.json({ error: 'username_taken' }, 409)
    const passwordHash = await hashPassword(password)
    const [res] = await pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [
      username,
      passwordHash,
    ])
    const token = await issueToken(pool, Number((res as any).insertId))
    return c.json({ token })
  } catch (e: any) {
    // 并发注册同一用户名: 唯一键冲突同样视为已存在
    if (e?.code === 'ER_DUP_ENTRY') return c.json({ error: 'username_taken' }, 409)
    return dbError(c, e)
  }
})

sync.post('/login', async (c) => {
  const pool = getPool()
  if (!pool) return c.json({ error: 'sync not configured (missing SHIYIN_DB_*)' }, 503)
  if (rateLimited('login', clientIp(c), RL_LOGIN))
    return c.json({ error: 'rate limited, retry later' }, 429)
  const body = await readJson(c)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  // 用户名不存在与密码错误统一返回, 防用户名枚举
  try {
    const [rows] = await pool.query('SELECT id, password_hash FROM users WHERE username = ?', [
      username,
    ])
    const row = (rows as any[])[0]
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      return c.json({ error: 'bad_credentials' }, 401)
    }
    const token = await issueToken(pool, Number(row.id))
    await pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [row.id])
    return c.json({ token })
  } catch (e) {
    return dbError(c, e)
  }
})

sync.post('/logout', requireUser, async (c) => {
  const pool: Pool = c.get('pool')
  const tokenHash: string = c.get('tokenHash')
  try {
    await pool.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash])
  } catch (e) {
    return dbError(c, e)
  }
  return c.json({ ok: true })
})

sync.delete('/account', requireUser, async (c) => {
  const pool: Pool = c.get('pool')
  const userId: number = c.get('userId')
  const body = await readJson(c)
  const password = typeof body?.password === 'string' ? body.password : ''
  try {
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId])
    const row = (rows as any[])[0]
    // 密码二次校验, 失败统一口径
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      return c.json({ error: 'bad_credentials' }, 401)
    }
    // 外键 ON DELETE CASCADE 级联清掉该用户全部数据
    await pool.query('DELETE FROM users WHERE id = ?', [userId])
    return c.json({ ok: true })
  } catch (e) {
    return dbError(c, e)
  }
})

/* ---------------- 拉取 ---------------- */

sync.get('/pull', requireUser, async (c) => {
  if (rateLimited('sync', clientIp(c), RL_SYNC))
    return c.json({ error: 'rate limited, retry later' }, 429)
  const pool: Pool = c.get('pool')
  const userId: number = c.get('userId')
  const since = Number(c.req.query('since') ?? 0)
  if (!Number.isFinite(since) || since < 0) return c.json({ error: 'bad since' }, 400)

  try {
    const [subs] = await pool.query(
      'SELECT feed_key, feed_url, title, author, image, updated_at, deleted FROM subscriptions WHERE user_id = ? AND updated_at > ?',
      [userId, since],
    )
    const [later] = await pool.query(
      'SELECT episode_key, podcast_key, feed_url, podcast_title, title, image, audio_url, duration, updated_at, deleted FROM listen_later WHERE user_id = ? AND updated_at > ?',
      [userId, since],
    )
    const [prog] = await pool.query(
      'SELECT episode_key, position, duration, updated_at, title, podcast_title, artwork, audio_url, podcast_key, feed_url FROM progress WHERE user_id = ? AND updated_at > ?',
      [userId, since],
    )
    const [setRows] = await pool.query('SELECT data, updated_at FROM settings WHERE user_id = ?', [
      userId,
    ])

    const subRows = subs as any[]
    const laterRows = later as any[]
    const setRow = (setRows as any[])[0]
    // mysql2 会把 JSON 列自动解析为对象, 兼容字符串形式
    const setData =
      setRow?.data == null
        ? null
        : typeof setRow.data === 'string'
          ? JSON.parse(setRow.data)
          : setRow.data

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

sync.post('/push', requireUser, async (c) => {
  if (rateLimited('sync', clientIp(c), RL_SYNC))
    return c.json({ error: 'rate limited, retry later' }, 429)
  const pool: Pool = c.get('pool')
  const userId: number = c.get('userId')

  const body = await readJson(c)
  if (!body) return c.json({ error: 'bad body' }, 400)

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
        `INSERT INTO subscriptions (user_id, feed_key, feed_url, title, author, image, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE
           feed_url = IF(new.updated_at > subscriptions.updated_at, new.feed_url, subscriptions.feed_url),
           title = IF(new.updated_at > subscriptions.updated_at, new.title, subscriptions.title),
           author = IF(new.updated_at > subscriptions.updated_at, new.author, subscriptions.author),
           image = IF(new.updated_at > subscriptions.updated_at, new.image, subscriptions.image),
           deleted = IF(new.updated_at > subscriptions.updated_at, new.deleted, subscriptions.deleted),
           updated_at = IF(new.updated_at > subscriptions.updated_at, new.updated_at, subscriptions.updated_at)`,
        [
          userId,
          feedKey,
          str(s?.feed_url, 65535),
          str(s?.title, 512),
          str(s?.author, 512),
          str(s?.image, 65535),
          num(s?.updated_at),
          s?.deleted ? 1 : 0,
        ],
      )
    }

    for (const l of later) {
      const episodeKey = str(l?.episode_key, 512)
      if (!episodeKey) continue
      await conn.query(
        `INSERT INTO listen_later (user_id, episode_key, podcast_key, feed_url, podcast_title, title, image, audio_url, duration, updated_at, deleted)
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
          userId,
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
        `INSERT INTO progress (user_id, episode_key, position, duration, updated_at, title, podcast_title, artwork, audio_url, podcast_key, feed_url)
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
          userId,
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

    if (
      settingsBody &&
      typeof settingsBody === 'object' &&
      settingsBody.data &&
      typeof settingsBody.data === 'object'
    ) {
      await conn.query(
        `INSERT INTO settings (user_id, data, updated_at)
         VALUES (?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE
           data = IF(new.updated_at > settings.updated_at, new.data, settings.data),
           updated_at = IF(new.updated_at > settings.updated_at, new.updated_at, settings.updated_at)`,
        [userId, JSON.stringify(settingsBody.data), num(settingsBody.updated_at)],
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
