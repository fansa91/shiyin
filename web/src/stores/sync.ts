/**
 * 云端同步引擎 (Pinia)。
 *
 * 身份: 同步码 (localStorage shiyin-sync-code), 无注册。
 * - 本地订阅/稍后听/进度/设置变化 -> 防抖 5s push (library.ts/settings.ts 经 syncBus 通知)
 * - App 启动 + 页面回到前台 -> pull (since 增量)
 * - 首次绑定: 先 pull, 再把本地全量合并后 push (union, 行级 last-write-wins)
 * - 冲突: last-write-wins (updated_at 毫秒时间戳)
 * - 云端回写本地时置 syncState.applyingRemote, 抑制回环推送
 */
import { defineStore } from 'pinia'
import { computed, nextTick, ref } from 'vue'
import {
  syncApi,
  type SyncLaterRow,
  type SyncProgressRow,
  type SyncPullResult,
  type SyncPushBody,
  type SyncSubRow,
} from '../api'
import {
  addLater,
  getHistoryEntry,
  getHistoryList,
  getLater,
  getSubscriptions,
  removeLater,
  savePlayback,
  subscribe,
  unsubscribe,
  type LaterItem,
} from '../library'
import { setSettingsUpdatedAt, settings, settingsUpdatedAt } from '../settings'
import { onLocalChange } from '../syncBus'
import { syncState } from '../syncState'
import { clearTombstones, readTombstones } from '../syncTomb'
import { episodeKey } from '../utils/syncKey'

const CODE_KEY = 'shiyin-sync-code'
const SINCE_KEY = 'shiyin-sync-since'
const LAST_KEY = 'shiyin-sync-last'
const PUSH_DEBOUNCE = 5000

export const useSyncStore = defineStore('sync', () => {
  const code = ref<string>(safeGet(CODE_KEY) ?? '')
  const bound = computed(() => code.value.length > 0)
  const syncing = ref(false)
  const lastSyncAt = ref(Number(safeGet(LAST_KEY) ?? 0) || 0)
  const lastError = ref('')

  let pushTimer: ReturnType<typeof setTimeout> | null = null
  /** push 进行中又有新变更: 结束后补一次 */
  let queued = false

  function safeGet(k: string): string | null {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  }
  function safeSet(k: string, v: string): void {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* ignore */
    }
  }

  function setCode(v: string): void {
    code.value = v
    try {
      if (v) localStorage.setItem(CODE_KEY, v)
      else localStorage.removeItem(CODE_KEY)
    } catch {
      /* ignore */
    }
  }

  /* ---------------- 身份 ---------------- */

  /** 生成同步码 (明文只返回这一次, 调用方负责展示 + 提示保存) */
  async function generateCode(): Promise<string> {
    const r = await syncApi.createCode()
    return r.code
  }

  /** 用同步码绑定本机: 先 pull, 再本地全量合并 push */
  async function bindCode(input: string): Promise<void> {
    const c = input.trim()
    if (!c) throw new Error('同步码不能为空')
    setCode(c)
    lastError.value = ''
    try {
      await pull()
    } catch (e) {
      setCode('') // 码无效则不保留
      throw e
    }
    await pushNow()
  }

  /** 解绑: 仅断开, 本地数据保留 */
  function unbind(): void {
    if (pushTimer !== null) {
      clearTimeout(pushTimer)
      pushTimer = null
    }
    queued = false
    setCode('')
    lastError.value = ''
  }

  /** 换码: 旧码立即作废, 返回新码 */
  async function rotateCode(): Promise<string> {
    const r = await syncApi.rotate(code.value)
    setCode(r.code)
    return r.code
  }

  /** 删除云端身份及全部数据, 并解绑本机 */
  async function deleteRemote(): Promise<void> {
    await syncApi.remove(code.value)
    unbind()
  }

  /* ---------------- 推送 ---------------- */

  function pushSoon(): void {
    if (!bound.value || syncState.applyingRemote) return
    if (pushTimer !== null) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      pushTimer = null
      pushNow().catch(() => {
        /* lastError 已记录 */
      })
    }, PUSH_DEBOUNCE)
  }

  async function buildPushBody(): Promise<SyncPushBody> {
    const subs: SyncSubRow[] = getSubscriptions().map((s) => ({
      feed_key: s.key,
      feed_url: s.feedUrl,
      title: s.title,
      author: s.author,
      image: s.artwork,
      updated_at: s.addedAt,
      deleted: 0,
    }))
    const tomb = readTombstones()
    for (const [k, ts] of Object.entries(tomb.subscriptions)) {
      subs.push({ feed_key: k, feed_url: '', title: '', author: '', image: '', updated_at: ts, deleted: 1 })
    }

    const later: SyncLaterRow[] = []
    for (const l of getLater()) {
      later.push({
        episode_key: await episodeKey(l.guid, l.audioUrl),
        podcast_key: l.podcastKey,
        feed_url: l.feedUrl,
        podcast_title: l.podcastTitle,
        title: l.title,
        image: l.artwork,
        audio_url: l.audioUrl,
        duration: 0,
        updated_at: l.addedAt,
        deleted: 0,
      })
    }
    for (const [k, ts] of Object.entries(tomb.listen_later)) {
      later.push({
        episode_key: k,
        podcast_key: '',
        feed_url: '',
        podcast_title: '',
        title: '',
        image: '',
        audio_url: '',
        duration: 0,
        updated_at: ts,
        deleted: 1,
      })
    }

    const progress: SyncProgressRow[] = []
    for (const { guid, entry } of getHistoryList()) {
      progress.push({
        episode_key: await episodeKey(guid, entry.audioUrl),
        position: entry.position,
        duration: entry.duration,
        updated_at: entry.updatedAt,
        title: entry.title,
        podcast_title: entry.podcastTitle,
        artwork: entry.artwork,
        audio_url: entry.audioUrl,
        podcast_key: entry.podcastKey,
        feed_url: entry.feedUrl,
      })
    }

    return {
      subscriptions: subs,
      listen_later: later,
      progress,
      settings: { data: { ...settings }, updated_at: settingsUpdatedAt() },
    }
  }

  async function pushNow(): Promise<void> {
    if (!bound.value) return
    if (syncing.value) {
      queued = true
      return
    }
    syncing.value = true
    try {
      const body = await buildPushBody()
      const r = await syncApi.push(code.value, body)
      clearTombstones()
      lastSyncAt.value = r.server_time
      safeSet(LAST_KEY, String(r.server_time))
      lastError.value = ''
    } catch (e: any) {
      lastError.value = e?.message ?? '同步失败'
      throw e
    } finally {
      syncing.value = false
      if (queued) {
        queued = false
        // 补推一次, 错误已在内部记录
        pushNow().catch(() => {})
      }
    }
  }

  /* ---------------- 拉取 ---------------- */

  /** 按 episode_key 找本地稍后听 (guid 直连优先, 兜底 sha256 比对) */
  async function findLaterByKey(key: string): Promise<LaterItem | undefined> {
    const list = getLater()
    const direct = list.find((l) => l.guid === key)
    if (direct) return direct
    for (const l of list) {
      if ((await episodeKey(l.guid, l.audioUrl)) === key) return l
    }
    return undefined
  }

  async function applyPull(data: SyncPullResult): Promise<void> {
    syncState.applyingRemote = true
    try {
      // 订阅: 墓碑先删, 其余 newer-wins
      for (const k of data.tombstones.subscriptions) unsubscribe(k)
      for (const r of data.subscriptions) {
        if (r.deleted) {
          unsubscribe(r.feed_key)
          continue
        }
        const local = getSubscriptions().find((s) => s.key === r.feed_key)
        if (!local || r.updated_at > local.addedAt) {
          subscribe({
            key: r.feed_key,
            feedUrl: r.feed_url || local?.feedUrl || '',
            collectionId: /^\d+$/.test(r.feed_key) ? Number(r.feed_key) : undefined,
            title: r.title || local?.title || '',
            author: r.author || local?.author || '',
            artwork: r.image || local?.artwork || '',
          })
        }
      }

      // 稍后听
      for (const k of data.tombstones.listen_later) {
        const found = await findLaterByKey(k)
        if (found) removeLater(found.guid)
      }
      for (const r of data.listen_later) {
        if (r.deleted) {
          const found = await findLaterByKey(r.episode_key)
          if (found) removeLater(found.guid)
          continue
        }
        const found = await findLaterByKey(r.episode_key)
        if (!found || r.updated_at > found.addedAt) {
          addLater({
            guid: r.episode_key,
            title: r.title,
            podcastTitle: r.podcast_title,
            artwork: r.image || '',
            audioUrl: r.audio_url || '',
            podcastKey: r.podcast_key || '',
            feedUrl: r.feed_url || '',
          })
        }
      }

      // 播放进度 -> 本地历史
      for (const r of data.progress) {
        const local = getHistoryEntry(r.episode_key)
        if (!local || r.updated_at > local.updatedAt) {
          savePlayback(r.episode_key, {
            position: r.position,
            duration: r.duration,
            updatedAt: r.updated_at,
            title: r.title || local?.title || '',
            podcastTitle: r.podcast_title || local?.podcastTitle || '',
            artwork: r.artwork || local?.artwork || '',
            audioUrl: r.audio_url || local?.audioUrl || '',
            podcastKey: r.podcast_key || local?.podcastKey || '',
            feedUrl: r.feed_url || local?.feedUrl || '',
            podcastAuthor: local?.podcastAuthor || '',
          })
        }
      }

      // 设置: 整包 newer-wins
      if (data.settings && data.settings.updated_at > settingsUpdatedAt()) {
        Object.assign(settings, data.settings.data)
        setSettingsUpdatedAt(data.settings.updated_at)
      }

      // settings 的 watch 是异步触发, 等它跑完再复位标记, 防止回环推送
      await nextTick()
    } finally {
      syncState.applyingRemote = false
    }
  }

  async function pull(): Promise<void> {
    if (!bound.value || syncing.value) return
    syncing.value = true
    try {
      const since = Number(safeGet(SINCE_KEY) ?? 0) || 0
      const data = await syncApi.pull(code.value, since)
      await applyPull(data)
      safeSet(SINCE_KEY, String(data.server_time))
      lastSyncAt.value = data.server_time
      safeSet(LAST_KEY, String(data.server_time))
      lastError.value = ''
    } catch (e: any) {
      lastError.value = e?.message ?? '同步失败'
      throw e
    } finally {
      syncing.value = false
    }
  }

  /* ---------------- 生命周期 ---------------- */

  async function startup(): Promise<void> {
    if (!bound.value) return
    try {
      await pull()
    } catch {
      /* lastError 已记录, 静默 */
    }
  }

  // 本地变更 -> 防抖推送
  onLocalChange(() => pushSoon())

  // 回到前台 -> 拉取
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pull().catch(() => {})
    })
  }

  return {
    code,
    bound,
    syncing,
    lastSyncAt,
    lastError,
    generateCode,
    bindCode,
    unbind,
    rotateCode,
    deleteRemote,
    pull,
    pushNow,
    startup,
  }
})
