import { Chapter, Player } from 'shikwasa'
import 'shikwasa/dist/style.css'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Episode } from '../models'
import { getHistoryEntry, resumable, savePlayback } from '../library'
import { settings } from '../settings'

/** 章节插件只需注册一次, 且必须在 new Player 之前 */
Player.use(Chapter)

/** 进度上报节流: 每 5s 写一次 localStorage */
const SAVE_INTERVAL = 5000

export const usePlayerStore = defineStore('player', () => {
  /* ---------- 状态 ---------- */
  const queue = ref<Episode[]>([])
  const currentIndex = ref(-1)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const speed = ref(settings.defaultSpeed)
  /** 展开的全屏播放器是否可见 */
  const expanded = ref(false)
  /** shikwasa 是否已挂载 */
  const ready = ref(false)

  let player: Player | null = null
  /** 底部播放坞挂载点 (App.vue, 常驻) */
  let dockEl: HTMLElement | null = null
  /** 展开视图挂载点 (PlayerOverlay, 常驻) */
  let expandedEl: HTMLElement | null = null
  /** 断点续播: metadata 就绪后要跳到的秒数 */
  let pendingSeek = 0
  let lastSave = 0
  /** 最近一次的主题色, 供实例延迟创建时补应用 */
  let lastColors: Record<string, string> | null = null
  let lastDark = false

  const current = computed<Episode | null>(() =>
    currentIndex.value >= 0 && currentIndex.value < queue.value.length
      ? queue.value[currentIndex.value]
      : null,
  )
  const hasPrev = computed(() => currentIndex.value > 0)
  const hasNext = computed(
    () => currentIndex.value >= 0 && currentIndex.value < queue.value.length - 1,
  )
  const progress = computed(() =>
    duration.value > 0 ? Math.min(1, currentTime.value / duration.value) : 0,
  )

  /* ---------- 内部 ---------- */

  function persistPosition(force = false): void {
    const ep = current.value
    if (!ep || !player) return
    const now = Date.now()
    if (!force && now - lastSave < SAVE_INTERVAL) return
    lastSave = now
    const pos = player.currentTime ?? 0
    const dur = player.duration || ep.duration || 0
    if (pos <= 0) return
    savePlayback(ep.guid, {
      position: pos,
      duration: dur,
      updatedAt: now,
      title: ep.title,
      podcastTitle: ep.podcastTitle,
      artwork: ep.artwork,
      audioUrl: ep.audioUrl,
      podcastKey: ep.podcastKey,
      feedUrl: ep.feedUrl,
      podcastAuthor: ep.podcastAuthor,
    })
  }

  /* ---------- 对外 ---------- */

  /**
   * 注册两个常驻挂载点 (v-show 切换显隐, DOM 不卸载)。
   * 单例 Player 的根元素 (player.el) 在两者之间搬移, 不重建实例,
   * 音频播放不中断。实例本身在第一次播放时才创建, 因为构造时必须
   * 带有效音频 src (源码 initAudio: 无 src 就不创建 audio 元素, 后续 update 会崩)。
   */
  function registerDock(el: HTMLElement): void {
    dockEl = el
    attachCurrent()
  }
  function registerExpanded(el: HTMLElement): void {
    expandedEl = el
    attachCurrent()
  }

  /** 把单例挂到当前应属的容器 (底部坞 / 展开视图) */
  function attachCurrent(): void {
    if (!player) return
    const target = expanded.value ? expandedEl : dockEl
    if (target && player.el.parentElement !== target) target.appendChild(player.el)
  }

  /** 展开 / 收起播放视图: 只搬移 DOM, 不重建 Player */
  function setExpanded(v: boolean): void {
    if (expanded.value === v) return
    expanded.value = v
    attachCurrent()
  }

  /** 延迟创建实例 */
  function getPlayer(audio: {
    title: string
    artist: string
    album: string
    cover: string | null
    src: string
    chapters: { title: string; startTime: number; endTime: number }[]
  }): Player | null {
    if (player) return player
    const host = expanded.value ? expandedEl : dockEl
    if (!host) return null
    const p = new Player({
      container: host,
      audio,
      themeColor: '#6750A4',
      theme: 'auto',
      fixed: { type: 'static' },
      autoPlay: false,
      preload: 'metadata',
      speedOptions: [0.75, 1, 1.25, 1.5, 1.75, 2],
      download: false,
    })
    player = p
    p.on('play', () => {
      isPlaying.value = true
    })
    p.on('pause', () => {
      isPlaying.value = false
      persistPosition(true)
    })
    p.on('ended', () => {
      isPlaying.value = false
      persistPosition(true)
      next()
    })
    p.on('timeupdate', () => {
      currentTime.value = p.currentTime ?? 0
      const d = p.duration
      if (d && isFinite(d)) duration.value = d
      persistPosition()
    })
    p.on('loadedmetadata', () => {
      const d = p.duration
      if (d && isFinite(d)) duration.value = d
      // 断点续播: metadata 就绪后跳到上次位置
      if (pendingSeek > 0) {
        p.seek(pendingSeek)
        pendingSeek = 0
      }
    })
    p.on('error', () => {
      isPlaying.value = false
    })
    // 构造时 themeColor 会以内联样式覆盖 --color-primary, 建完立刻按当前主题重设
    if (lastColors) applyTheme(lastColors, lastDark)
    attachCurrent()
    ready.value = true
    return p
  }

  /**
   * 把 shikwasa 的 CSS 变量同步到当前 Vuetify M3 主题。
   * 注意: 构造时 themeColor 会以内联样式覆盖 --color-primary,
   * 所以主题变化时这里重新设置一遍。
   */
  function applyTheme(colors: Record<string, string>, dark: boolean): void {
    lastColors = colors
    lastDark = dark
    if (!player) return
    const el = player.el
    const get = (k: string, fb: string) => colors[k] ?? fb
    el.style.setProperty('--color-primary', get('primary', '#6750A4'))
    el.style.setProperty('--color-theme', get('surface', dark ? '#141218' : '#FEF7FF'))
    el.style.setProperty('--color-text', get('on-surface', dark ? '#E6E0E9' : '#1D1B20'))
    el.style.setProperty('--color-secondary', get('on-surface-variant', dark ? '#CAC4D0' : '#49454F'))
    el.style.setProperty('--color-opac', dark ? '#b9b9b94d' : '#7676764d')
    el.style.setProperty('--color-shadow', dark ? '#00000080' : '#b9b6b680')
    el.setAttribute('data-theme', dark ? 'dark' : 'light')
  }

  /** 播放某集; 传 queue 则替换整个播放队列 */
  function playEpisode(ep: Episode, list?: Episode[]): void {
    if (!ep.audioUrl) return
    const audio = {
      title: ep.title,
      artist: ep.podcastAuthor || ep.podcastTitle,
      album: ep.podcastTitle,
      cover: ep.artwork || null,
      src: ep.audioUrl,
      // 章节来自后端 RSS 解析 (秒), 不用 jsmediatags (音频 host 常无 CORS)
      chapters: ep.chapters.map((c) => ({
        title: c.title,
        startTime: c.startTime,
        endTime: c.endTime,
      })),
    }
    // 首次播放时才创建实例 (构造必须带有效 src)
    const wasFresh = !player
    const p = getPlayer(audio)
    if (!p) return
    if (list && list.length) {
      queue.value = list
      const i = list.findIndex((e) => e.guid === ep.guid)
      currentIndex.value = i >= 0 ? i : 0
    } else {
      const i = queue.value.findIndex((e) => e.guid === ep.guid)
      if (i >= 0) {
        currentIndex.value = i
      } else if (currentIndex.value >= 0) {
        // 插到当前后面, 保持上下文连贯
        queue.value.splice(currentIndex.value + 1, 0, ep)
        currentIndex.value++
      } else {
        queue.value = [ep]
        currentIndex.value = 0
      }
    }
    const saved = getHistoryEntry(ep.guid)
    pendingSeek = resumable(saved) ? Math.floor(saved!.position) : 0
    currentTime.value = 0
    duration.value = ep.duration || 0
    lastSave = 0
    // 新实例构造时已带入音频, 无需再 update; 老实例走 update 切换
    if (!wasFresh) p.update(audio)
    attachCurrent()
    p.playbackRate = speed.value
    p.play()
  }

  function play(): void {
    player?.play()
  }
  function pause(): void {
    player?.pause()
  }
  function toggle(): void {
    player?.toggle()
  }
  function seek(sec: number): void {
    player?.seek(sec)
  }
  /** ±30s 快进快退 */
  function skipForward(): void {
    player?.seekBySpan({ time: 30, forward: true })
  }
  function skipBackward(): void {
    player?.seekBySpan({ time: 30, forward: false })
  }
  function next(): void {
    if (hasNext.value) playEpisode(queue.value[currentIndex.value + 1])
    else pause()
  }
  function prev(): void {
    if ((player?.currentTime ?? 0) > 3) {
      seek(0)
      return
    }
    if (hasPrev.value) playEpisode(queue.value[currentIndex.value - 1])
    else seek(0)
  }
  function setSpeed(v: number): void {
    speed.value = v
    if (player) player.playbackRate = v
  }
  /** 点击队列中的某一项 */
  function playAt(index: number): void {
    if (index >= 0 && index < queue.value.length) playEpisode(queue.value[index])
  }
  /** 从队列移除 */
  function removeAt(index: number): void {
    if (index < 0 || index >= queue.value.length) return
    queue.value.splice(index, 1)
    if (index < currentIndex.value) currentIndex.value--
    else if (index === currentIndex.value) {
      // 删的是正在播的: 播下一首, 没有就停
      if (currentIndex.value < queue.value.length) playEpisode(queue.value[currentIndex.value])
      else {
        pause()
        currentIndex.value = -1
      }
    }
  }
  function clearQueue(): void {
    pause()
    queue.value = []
    currentIndex.value = -1
  }

  // 设置里的默认倍速变化时同步到播放器
  watch(
    () => settings.defaultSpeed,
    (v) => {
      speed.value = v
      if (player) player.playbackRate = v
    },
  )

  return {
    queue,
    currentIndex,
    current,
    isPlaying,
    currentTime,
    duration,
    progress,
    speed,
    expanded,
    ready,
    hasPrev,
    hasNext,
    registerDock,
    registerExpanded,
    setExpanded,
    applyTheme,
    playEpisode,
    play,
    pause,
    toggle,
    seek,
    skipForward,
    skipBackward,
    next,
    prev,
    setSpeed,
    playAt,
    removeAt,
    clearQueue,
  }
})
