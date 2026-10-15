/**
 * 本地数据变更通知总线。
 * library.ts / settings.ts 写入本地数据后 emit, stores/sync.ts 订阅后做防抖 push。
 * 独立模块, 避免 library <-> sync 的循环依赖。
 */
type Listener = () => void

const listeners = new Set<Listener>()

export function onLocalChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function emitLocalChange(): void {
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}
