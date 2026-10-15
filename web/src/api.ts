import type { Chapter } from './models'

/* ---------------- 后端 (同源 /api, 开发时经 vite proxy 转发) ---------------- */

async function apiGet<T>(path: string, headers?: Record<string, string>): Promise<T> {
  const r = await fetch(`/api${path}`, { headers })
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw syncError(r.status, body?.error)
  }
  return r.json()
}

async function apiPost<T>(
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) {
    const b = await r.json().catch(() => null)
    throw syncError(r.status, b?.error)
  }
  return r.json()
}

async function apiDelete<T>(
  path: string,
  headers?: Record<string, string>,
  body?: unknown,
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) {
    const b = await r.json().catch(() => null)
    throw syncError(r.status, b?.error)
  }
  return r.json()
}

/** 同步接口的错误翻译成中文 */
function syncError(status: number, detail?: string): Error {
  if (status === 409) return new Error('用户名已存在, 请换一个')
  if (status === 401) {
    if (detail === 'bad_credentials') return new Error('用户名或密码错误')
    if (detail === 'token_expired' || detail === 'invalid_token' || detail === 'missing_token')
      return new Error('登录已过期, 请重新登录')
    return new Error('未登录或登录已过期')
  }
  if (status === 400) {
    if (detail === 'bad_username') return new Error('用户名需 3-32 位字母/数字/_/-')
    if (detail === 'weak_password') return new Error('密码至少 8 位')
  }
  if (status === 429) return new Error('请求太频繁, 请稍后再试')
  if (status === 503) return new Error('后端未配置数据库, 云端同步不可用')
  return new Error(detail || `请求失败: ${status}`)
}

export interface RssEpisode {
  guid: string
  title: string
  description: string
  pubDate: string
  /** 秒 */
  duration: number
  audioUrl: string
  image?: string
  chapters: Chapter[]
}

export interface RssFeed {
  title: string
  link: string
  description: string
  image: string
  language: string
  episodes: RssEpisode[]
}

export interface ChartItem {
  collectionId: number
  collectionName: string
  artistName: string
  artworkUrl600: string
  genres: string[]
}

export interface Genre {
  id: number
  name: string
}

export const backend = {
  /** 解析 RSS: GET /api/rss?url=<urlencoded> */
  rss: (feedUrl: string) => apiGet<RssFeed>(`/rss?url=${encodeURIComponent(feedUrl)}`),
  /** 排行榜 */
  charts: (country: string, genre = 0, limit = 50) =>
    apiGet<ChartItem[]>(
      `/charts?country=${encodeURIComponent(country)}&genre=${genre}&limit=${limit}`,
    ),
  /** 播客分类 */
  genres: () => apiGet<Genre[]>('/genres'),
  health: () => apiGet<{ ok: boolean }>('/health'),
}

/* ---------------- iTunes Search API (CORS 允许, 前端直连, 无需 key) ---------------- */

export interface ITunesPodcast {
  collectionId: number
  collectionName: string
  artistName: string
  artworkUrl600?: string
  artworkUrl100?: string
  feedUrl?: string
  primaryGenreName?: string
  genres?: string[]
  trackCount?: number
}

export interface ITunesEpisode {
  trackId: number
  trackName: string
  description?: string
  shortDescription?: string
  releaseDate: string
  trackTimeMillis?: number
  episodeUrl?: string
  artworkUrl600?: string
  artworkUrl160?: string
  collectionName?: string
}

async function itunesGet<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`iTunes 请求失败: ${r.status}`)
  return r.json()
}

const ITUNES = 'https://itunes.apple.com'

export const itunes = {
  /** 搜索播客 */
  search: (term: string, country: string, limit = 25) =>
    itunesGet<{ resultCount: number; results: ITunesPodcast[] }>(
      `${ITUNES}/search?term=${encodeURIComponent(term)}&media=podcast&entity=podcast&limit=${limit}&country=${encodeURIComponent(country)}`,
    ),
  /** 播客详情 (results[0], 含 feedUrl) */
  lookup: (id: number | string, country: string) =>
    itunesGet<{ resultCount: number; results: ITunesPodcast[] }>(
      `${ITUNES}/lookup?id=${id}&entity=podcast&country=${encodeURIComponent(country)}`,
    ),
  /** 单集列表 (results[0] 是播客本身, 其余是单集; RSS 失败时的兜底) */
  episodes: (id: number | string, country: string, limit = 200) =>
    itunesGet<{ resultCount: number; results: (ITunesPodcast | ITunesEpisode)[] }>(
      `${ITUNES}/lookup?id=${id}&entity=podcastEpisode&limit=${limit}&country=${encodeURIComponent(country)}`,
    ),
}

/* ---------------- 云端同步 (需 Authorization: Bearer <token>) ---------------- */

export interface SyncSubRow {
  feed_key: string
  feed_url: string
  title: string
  author: string
  image: string
  updated_at: number
  deleted: number
}

export interface SyncLaterRow {
  episode_key: string
  podcast_key: string
  feed_url: string
  podcast_title: string
  title: string
  image: string
  audio_url: string
  duration: number
  updated_at: number
  deleted: number
}

export interface SyncProgressRow {
  episode_key: string
  position: number
  duration: number
  updated_at: number
  title: string
  podcast_title: string
  artwork: string
  audio_url: string
  podcast_key: string
  feed_url: string
}

export interface SyncPullResult {
  server_time: number
  subscriptions: SyncSubRow[]
  listen_later: SyncLaterRow[]
  progress: SyncProgressRow[]
  settings: { data: Record<string, unknown>; updated_at: number } | null
  tombstones: { subscriptions: string[]; listen_later: string[] }
}

export interface SyncPushBody {
  subscriptions: SyncSubRow[]
  listen_later: SyncLaterRow[]
  progress: SyncProgressRow[]
  settings: { data: Record<string, unknown>; updated_at: number }
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` })

export const syncApi = {
  /** 注册 -> {token}, 直接登录态 */
  register: (username: string, password: string) =>
    apiPost<{ token: string }>('/sync/register', { username, password }),
  /** 登录 -> {token} */
  login: (username: string, password: string) =>
    apiPost<{ token: string }>('/sync/login', { username, password }),
  /** 注销当前 token */
  logout: (token: string) => apiPost<{ ok: boolean }>('/sync/logout', undefined, authHeaders(token)),
  /** 删除账号及全部云端数据 (需密码二次校验) */
  deleteAccount: (token: string, password: string) =>
    apiDelete<{ ok: boolean }>('/sync/account', authHeaders(token), { password }),
  /** 增量拉取 */
  pull: (token: string, since: number) =>
    apiGet<SyncPullResult>(`/sync/pull?since=${since}`, authHeaders(token)),
  /** 增量推送 */
  push: (token: string, body: SyncPushBody) =>
    apiPost<{ ok: boolean; server_time: number }>('/sync/push', body, authHeaders(token)),
}

/* ---------------- 小工具 ---------------- */

/** iTunes 封面默认 100x100, 换成 600x600 */
export function artwork(url: string | undefined, size = 600): string {
  if (!url) return ''
  return url.replace(/\/\d+x\d+bb\.jpg$/, `/${size}x${size}bb.jpg`)
}

/** RSS / iTunes 的 description 常带 HTML, 转纯文本摘要 */
export function stripHtml(html: string | undefined): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n')
}

/** 秒 → 1:02:03 / 45:12 */
export function formatDuration(sec: number | undefined): string {
  if (!sec || sec <= 0 || !isFinite(sec)) return '--:--'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? h + ':' : ''}${mm}:${String(r).padStart(2, '0')}`
}

/** 日期 → 2026-10-15 */
export function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 86400 * 2) return '昨天'
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
