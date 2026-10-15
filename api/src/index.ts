/**
 * 拾音 API 后端
 *
 * 只读接口:
 *   GET /                     健康检查(文本)
 *   GET /api/health           健康检查
 *   GET /api/rss?url=...      抓取并解析播客 RSS/Atom, 返回标准化 JSON
 *   GET /api/charts           Apple Podcasts 排行榜
 *   GET /api/genres           播客分类列表
 *
 * 云端同步 (需配置 SHIYIN_DB_* 环境变量, 见 src/db.ts):
 *   POST   /api/sync/code     生成同步码
 *   POST   /api/sync/rotate   换码 (x-sync-code)
 *   DELETE /api/sync/code     删除身份及全部数据 (x-sync-code)
 *   GET    /api/sync/pull     增量拉取 (x-sync-code)
 *   POST   /api/sync/push     增量推送 (x-sync-code)
 */
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { XMLParser } from 'fast-xml-parser'
import { migrate } from './migrate.js'
import { sync } from './sync.js'

const app = new Hono()
app.use('/api/*', cors())

const UA = 'shiyin/1.0 (+https://github.com/fansa91/shiyin)'
const FETCH_TIMEOUT = 15_000

/** XML 解析器: 保留属性和命名空间前缀 (itunes: / podcast: / content:) */
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true,
  allowBooleanAttributes: true,
  trimValues: true,
  // tag / 属性里带冒号的保留原样, 以便用 key "itunes:image" 直接取
  removeNSPrefix: false,
})

/** 带超时的 fetch, 显式 UA, 自动跟随重定向 */
async function fetchUpstream(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT)
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*', ...init?.headers },
    })
  } finally {
    clearTimeout(t)
  }
}

/** 简单内存缓存 */
function cacheGet<T>(map: Map<string, { at: number; data: T }>, key: string, ttl: number): T | null {
  const hit = map.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.data
  map.delete(key)
  return null
}

/* ---------------- RSS 解析 ---------------- */

/** 取节点的文本内容: string | { '#text': string } | undefined */
function textOf(v: any): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (typeof v === 'object') {
    if ('#text' in v) return textOf((v as any)['#text'])
    // fast-xml-parser 有时会把纯文本包成 { '#text' } 以外的样子, 兜底:
    if (Array.isArray(v)) return textOf(v[0])
  }
  return ''
}

/** 取节点的属性 */
function attrOf(v: any, name: string): string {
  if (v != null && typeof v === 'object' && `@_${name}` in v) {
    const a = (v as any)[`@_${name}`]
    return typeof a === 'string' || typeof a === 'number' ? String(a) : ''
  }
  return ''
}

const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v]

/** itunes:duration 可能是秒 / MM:SS / HH:MM:SS, 转为秒数 */
function parseDuration(v: string): number {
  const s = v.trim()
  if (!s) return 0
  if (/^\d+$/.test(s)) return Number(s)
  const parts = s.split(':').map((p) => Number(p))
  if (parts.some(Number.isNaN)) return 0
  let total = 0
  for (const p of parts) total = total * 60 + p
  return total
}

/** pubDate -> ISO 字符串, 解析失败则返回原文 */
function normPubDate(v: string): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toISOString()
}

/** guid 节点可能是 { '#text': xxx, '@_isPermaLink': ... } */
function normGuid(item: any): string {
  const g = item['guid']
  const t = textOf(g) || attrOf(g, 'url')
  if (t) return t
  return attrOf(item['enclosure'], 'url')
}

export interface Episode {
  guid: string
  title: string
  description: string
  pubDate: string
  duration: number
  audioUrl: string
  image: string
  chapters: { title: string; startTime: number; endTime: number | null }[]
}

export interface FeedResult {
  title: string
  link: string
  description: string
  image: string
  language: string
  episodes: Episode[]
}

/**
 * 播客章节 (podcast namespace):
 * RSS 里 podcast:chapters 指向一个 JSON 文件, 格式 { version, chapters: [{ title, startTime, endTime }] }.
 * best-effort: 失败或缺失则返回空数组, 永不导致整请求失败.
 */
async function fetchChapters(chaptersUrl: string): Promise<Episode['chapters']> {
  try {
    const r = await fetchUpstream(chaptersUrl)
    if (!r.ok) return []
    const data = await r.json()
    const list = data?.chapters ?? data?.podcastChapters
    return asArray(list)
      .map((ch) => ({
        title: String(ch?.title ?? ''),
        startTime: Number(ch?.startTime ?? 0),
        endTime: ch?.endTime == null ? null : Number(ch.endTime),
      }))
      .filter((ch) => ch.title && !Number.isNaN(ch.startTime))
  } catch {
    return []
  }
}

async function parseFeed(feedUrl: string): Promise<FeedResult> {
  const r = await fetchUpstream(feedUrl)
  if (!r.ok) throw new Error(`upstream ${r.status}`)
  const body = await r.text()

  let doc: any
  try {
    doc = xml.parse(body)
  } catch (e: any) {
    throw new Error(`xml parse failed: ${e?.message ?? e}`)
  }

  // 支持 RSS 2.0 (channel) 和 Atom (feed)
  const channel = doc?.rss?.channel ?? doc?.feed
  if (!channel) throw new Error('no channel/feed found in xml')

  const channelImage =
    attrOf(channel['itunes:image'], 'href') || textOf(channel['image']?.['url']) || ''

  const items = asArray(channel['item'] ?? channel['entry'])
  const episodes: Episode[] = []

  for (const item of items) {
    const audioUrl = attrOf(item['enclosure'], 'url')
    // Atom: <link rel="enclosure" href="..." />; 普通 link 也兜底
    const atomLink = asArray(item['link'])
      .map((l) => (typeof l === 'object' ? attrOf(l, 'href') : textOf(l)))
      .find(Boolean) as string | undefined
    const resolvedAudio = audioUrl || (atomLink && /\.(mp3|m4a|aac|ogg|wav|opus)(\?|$)/i.test(atomLink) ? atomLink : '')

    // 章节: podcast:chapters @url 指向 JSON
    const chaptersUrl = attrOf(item['podcast:chapters'], 'url')

    // 描述: 优先 content:encoded, 兜底 description / summary (保留 HTML 原样)
    const description =
      textOf(item['content:encoded']) || textOf(item['description']) || textOf(item['summary'])

    episodes.push({
      guid: normGuid(item) || resolvedAudio,
      title: textOf(item['title']),
      description,
      pubDate: normPubDate(textOf(item['pubDate']) || textOf(item['published']) || textOf(item['updated'])),
      duration: parseDuration(textOf(item['itunes:duration']) || textOf(item['duration'])),
      audioUrl: resolvedAudio,
      image: attrOf(item['itunes:image'], 'href') || channelImage,
      chapters: chaptersUrl ? await fetchChapters(chaptersUrl) : [],
    })
  }

  return {
    title: textOf(channel['title']),
    link: textOf(channel['link']) || attrOf(channel['link'], 'href') || '',
    description: textOf(channel['description']) || textOf(channel['subtitle']) || textOf(channel['itunes:summary']) || '',
    image: channelImage,
    language: textOf(channel['language']),
    episodes,
  }
}

const rssCache = new Map<string, { at: number; data: FeedResult }>()
const RSS_TTL = 15 * 60_000

app.get('/api/rss', async (c) => {
  const raw = (c.req.query('url') ?? '').trim()
  let u: URL
  try {
    u = new URL(raw)
    if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol')
  } catch {
    return c.json({ error: 'bad url' }, 400)
  }
  const key = u.toString()
  const hit = cacheGet(rssCache, key, RSS_TTL)
  if (hit) return c.json(hit)
  try {
    const data = await parseFeed(key)
    rssCache.set(key, { at: Date.now(), data })
    return c.json(data)
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e) }, 502)
  }
})

/* ---------------- Apple 排行榜 ---------------- */

interface ChartEntry {
  collectionId: number
  collectionName: string
  artistName: string
  artworkUrl600: string
  genres: string[]
}

const chartsCache = new Map<string, { at: number; data: ChartEntry[] }>()
const CHARTS_TTL = 3600_000

function normChartEntry(entry: any): ChartEntry {
  const images = asArray(entry?.['im:image'])
  // im:image 按尺寸递增排列, 取最后一个(最大); item 形如 { label: url, attributes: { height } }
  const last = images.length ? images[images.length - 1] : undefined
  const artwork = typeof last === 'object' ? String(last?.label ?? '') : textOf(last)
  // 本 feed 用 entry.id (label 是播客页面 URL), 非 entry['im:id']
  const idAttr =
    entry?.['id']?.attributes?.['im:id'] ??
    entry?.['im:id']?.attributes?.['im:id'] ??
    entry?.['id']?.label ??
    entry?.['im:id']?.label
  return {
    collectionId: Number(idAttr ?? 0),
    collectionName: entry?.['im:name']?.label ?? '',
    artistName: entry?.['im:artist']?.label ?? '',
    artworkUrl600: artwork,
    genres: asArray(entry?.['category']).map((cat) => cat?.attributes?.label).filter(Boolean) as string[],
  }
}

app.get('/api/charts', async (c) => {
  const country = (c.req.query('country') ?? 'cn').toLowerCase()
  const genre = c.req.query('genre') ?? '0'
  const limit = Number(c.req.query('limit') ?? '50')
  if (!/^[a-z]{2}$/.test(country) || !/^\d+$/.test(genre) || !Number.isInteger(limit) || limit < 1 || limit > 200) {
    return c.json({ error: 'bad params' }, 400)
  }
  const cacheKey = `${country}:${genre}:${limit}`
  const hit = cacheGet(chartsCache, cacheKey, CHARTS_TTL)
  if (hit) return c.json(hit)
  const apiUrl = `https://itunes.apple.com/${country}/rss/toppodcasts/limit=${limit}/genre=${genre}/json`
  try {
    const r = await fetchUpstream(apiUrl)
    if (!r.ok) throw new Error(`upstream ${r.status}`)
    const data = await r.json()
    const entries = asArray(data?.feed?.entry).map(normChartEntry)
    chartsCache.set(cacheKey, { at: Date.now(), data: entries })
    return c.json(entries)
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e) }, 502)
  }
})

/* ---------------- 播客分类 ---------------- */

interface Genre {
  id: number
  name: string
}

const genresCache = new Map<string, { at: number; data: Genre[] }>()
const GENRES_TTL = 24 * 3600_000

/** 上游失败时的兜底分类 (Apple Podcasts 官方分类 ID) */
const FALLBACK_GENRES: Genre[] = [
  { id: 0, name: '全部' },
  { id: 1301, name: '艺术' },
  { id: 1303, name: '喜剧' },
  { id: 1304, name: '教育' },
  { id: 1321, name: '商业' },
  { id: 1310, name: '音乐' },
  { id: 1311, name: '新闻' },
  { id: 1314, name: '科技' },
  { id: 1315, name: '健康' },
  { id: 1323, name: '社会与文化' },
]

app.get('/api/genres', async (c) => {
  const hit = cacheGet(genresCache, 'all', GENRES_TTL)
  if (hit) return c.json(hit)
  try {
    // id=26: Podcasts 商店的分类树
    const r = await fetchUpstream('https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/genres?id=26')
    if (!r.ok) throw new Error(`upstream ${r.status}`)
    const data = await r.json()
    const subs = Object.values<any>(data?.['26']?.subgenres ?? {})
    const list: Genre[] = subs
      .map((g) => ({ id: Number(g?.id ?? 0), name: String(g?.name ?? '') }))
      .filter((g) => g.id && g.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    const result: Genre[] = [{ id: 0, name: '全部' }, ...list]
    if (list.length) genresCache.set('all', { at: Date.now(), data: result })
    return c.json(result)
  } catch {
    // 上游失败: 返回硬编码兜底, 仍然 200
    return c.json(FALLBACK_GENRES)
  }
})

/* ---------------- 基础 ---------------- */

app.get('/', (c) => c.text('shiyin api ok'))

app.get('/api/health', (c) => c.json({ ok: true }))

/* 云端同步: /api/sync/* (DB 未配置时各接口返回 503) */
app.route('/api/sync', sync)

const port = Number(process.env.PORT ?? 3000)
console.log(`[shiyin] api listening on :${port}`)
// 启动时建表; 失败不致命 (只读接口照常服务, sync 接口按需报错)
migrate()
  .then((ok) => ok && console.log('[shiyin] sync ready'))
  .catch((e) => console.error('[shiyin] migrate failed:', e?.message ?? e))
serve({ fetch: app.fetch, port })
