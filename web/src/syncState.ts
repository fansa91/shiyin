/**
 * 同步状态标记。applyPull 把云端数据写回本地时置 true,
 * library.ts / settings.ts 的写入钩子据此抑制 emitLocalChange,
 * 避免"拉取 -> 本地写入 -> 触发推送"的回环。
 *
 * 注意 settings.ts 的 watch 是异步 (flush: pre) 触发的,
 * 因此 applyPull 在写完设置后必须 await nextTick() 再复位标记。
 */
export const syncState = {
  applyingRemote: false,
}
