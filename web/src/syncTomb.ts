/**
 * 删除墓碑 (tombstones): 本地取消订阅 / 移除稍后听时,
 * 除了删本地行, 还要记一笔 deleted=1, 下次 push 时同步到云端,
 * 否则云端旧行会在别的设备 pull 时"复活"。
 * push 成功后由 stores/sync.ts 清空。
 */
import { syncState } from './syncState'

export type TombKind = 'subscriptions' | 'listen_later'

const KEY = 'shiyin-sync-tombstones'

type TombMap = Record<TombKind, Record<string, number>>

function read(): TombMap {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '')
    return {
      subscriptions: v?.subscriptions ?? {},
      listen_later: v?.listen_later ?? {},
    }
  } catch {
    return { subscriptions: {}, listen_later: {} }
  }
}

function write(m: TombMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* ignore */
  }
}

/** 记一笔删除 (云端回写时不记, 由 syncState 抑制) */
export function recordTombstone(kind: TombKind, key: string): void {
  if (syncState.applyingRemote) return
  const m = read()
  m[kind][key] = Date.now()
  write(m)
}

export function readTombstones(): TombMap {
  return read()
}

export function clearTombstones(): void {
  write({ subscriptions: {}, listen_later: {} })
}
