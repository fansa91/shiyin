/**
 * 本地资料库: 订阅 / 稍后听 / 播放历史, 全部 localStorage 持久化。
 * 单集统一用 guid (无 guid 则用 audioUrl) 做稳定 key。
 */
import { rssKey } from './models'

/* ---------------- 订阅 ---------------- */

export interface Subscription {
  key: string
  feedUrl: string
  collectionId?: number
  title: string
  author: string
  artwork: string
  addedAt: number
}

const SUB_KEY = 'shiyin-subscriptions'

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '')
    return v ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function getSubscriptions(): Subscription[] {
  const v = readJson<Subscription[]>(SUB_KEY, [])
  return Array.isArray(v) ? v : []
}

export function isSubscribed(key: string): boolean {
  return getSubscriptions().some((s) => s.key === key)
}

export function subscribe(sub: Omit<Subscription, 'addedAt'>): void {
  const list = getSubscriptions().filter((s) => s.key !== sub.key)
  list.unshift({ ...sub, addedAt: Date.now() })
  writeJson(SUB_KEY, list)
}

export function unsubscribe(key: string): void {
  writeJson(
    SUB_KEY,
    getSubscriptions().filter((s) => s.key !== key),
  )
}

/** 供手动 RSS 使用: 由 feedUrl 生成 key */
export function subscriptionKeyFor(feedUrl: string, collectionId?: number): string {
  return collectionId ? String(collectionId) : rssKey(feedUrl)
}

/* ---------------- 稍后听 ---------------- */

export interface LaterItem {
  guid: string
  title: string
  podcastTitle: string
  artwork: string
  audioUrl: string
  podcastKey: string
  feedUrl: string
  addedAt: number
}

const LATER_KEY = 'shiyin-later'

export function getLater(): LaterItem[] {
  const v = readJson<LaterItem[]>(LATER_KEY, [])
  return Array.isArray(v) ? v : []
}

export function isInLater(guid: string): boolean {
  return getLater().some((l) => l.guid === guid)
}

export function addLater(item: Omit<LaterItem, 'addedAt'>): void {
  const list = getLater().filter((l) => l.guid !== item.guid)
  list.unshift({ ...item, addedAt: Date.now() })
  writeJson(LATER_KEY, list)
}

export function removeLater(guid: string): void {
  writeJson(
    LATER_KEY,
    getLater().filter((l) => l.guid !== guid),
  )
}

export function toggleLater(item: Omit<LaterItem, 'addedAt'>): boolean {
  if (isInLater(item.guid)) {
    removeLater(item.guid)
    return false
  }
  addLater(item)
  return true
}

/* ---------------- 播放历史 (断点续播) ---------------- */

export interface HistoryEntry {
  /** 秒, 该集内的播放进度 */
  position: number
  /** 秒 */
  duration: number
  updatedAt: number
  /** 元数据快照: 历史页直接渲染, 无需重新拉取 */
  title: string
  podcastTitle: string
  artwork: string
  audioUrl: string
  podcastKey: string
  feedUrl: string
  podcastAuthor: string
}

const HISTORY_KEY = 'shiyin-history'
/** 最多保留条数, 超出按 updatedAt 淘汰最旧的 */
const HISTORY_MAX = 200

type HistoryMap = Record<string, HistoryEntry>

function getHistoryMap(): HistoryMap {
  const v = readJson<HistoryMap>(HISTORY_KEY, {})
  return v && typeof v === 'object' ? v : {}
}

export function getHistoryEntry(guid: string): HistoryEntry | undefined {
  return getHistoryMap()[guid]
}

/** 是否值得断点续播: 进度 >10s 且离结尾 >10s */
export function resumable(e: HistoryEntry | undefined): boolean {
  return !!e && e.position > 10 && e.duration - e.position > 10
}

export function savePlayback(guid: string, entry: HistoryEntry): void {
  const map = getHistoryMap()
  map[guid] = { ...entry, updatedAt: Date.now() }
  // LRU: 按 updatedAt 排序, 只保留最新 HISTORY_MAX 条
  const keys = Object.keys(map).sort((a, b) => map[b].updatedAt - map[a].updatedAt)
  for (const k of keys.slice(HISTORY_MAX)) delete map[k]
  writeJson(HISTORY_KEY, map)
}

/** 按更新时间倒序的列表, 供历史页渲染 */
export function getHistoryList(): { guid: string; entry: HistoryEntry }[] {
  const map = getHistoryMap()
  return Object.keys(map)
    .map((guid) => ({ guid, entry: map[guid] }))
    .sort((a, b) => b.entry.updatedAt - a.entry.updatedAt)
}

export function removeHistoryEntry(guid: string): void {
  const map = getHistoryMap()
  delete map[guid]
  writeJson(HISTORY_KEY, map)
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    /* ignore */
  }
}
