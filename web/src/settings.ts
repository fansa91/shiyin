import { reactive, watch } from 'vue'
import { emitLocalChange } from './syncBus'
import { syncState } from './syncState'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface Settings {
  themeMode: ThemeMode
  /** M3 seed color */
  seedColor: string
  /** 默认播放倍速 */
  defaultSpeed: number
  /** iTunes / 排行榜地区代码, 如 cn / us / tw */
  country: string
}

const KEY = 'shiyin-settings'

const defaults: Settings = {
  themeMode: 'system',
  seedColor: '#6750A4',
  defaultSpeed: 1,
  country: 'cn',
}

function load(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...defaults }
  }
}

/** 全局设置, 响应式 + 自动持久化到 localStorage */
export const settings = reactive<Settings>(load())

/** 设置的最后变更时间 (毫秒), 云端同步 last-write-wins 依据 */
const UPDATED_KEY = 'shiyin-settings-updated'

export function settingsUpdatedAt(): number {
  try {
    return Number(localStorage.getItem(UPDATED_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

export function setSettingsUpdatedAt(ts: number): void {
  try {
    localStorage.setItem(UPDATED_KEY, String(ts))
  } catch {
    /* ignore */
  }
}

watch(
  settings,
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      /* ignore */
    }
    // 云端回写时不 bump 时间戳、不通知, 防止回环 (异步 watch, 由调用方 nextTick 兜底)
    if (syncState.applyingRemote) return
    setSettingsUpdatedAt(Date.now())
    emitLocalChange()
  },
  { deep: true },
)

/** 地区选项 */
export const COUNTRIES = [
  { value: 'cn', title: '中国大陆' },
  { value: 'tw', title: '台湾' },
  { value: 'hk', title: '香港' },
  { value: 'us', title: '美国' },
  { value: 'gb', title: '英国' },
  { value: 'jp', title: '日本' },
  { value: 'de', title: '德国' },
  { value: 'fr', title: '法国' },
]

/** 倍速选项 */
export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]
