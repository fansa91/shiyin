/**
 * 单集稳定 key 规则: guid 优先, 无 guid 时用 audioUrl 的 sha256 hex。
 *
 * 前端 web/src/utils/syncKey.ts 有同一规则的浏览器实现 (用 crypto.subtle, 异步),
 * 两处必须保持一致, 否则同一单集在两端 key 不同会导致重复/同步错位。
 */
import { createHash } from 'node:crypto'

export function episodeKey(guid: string, audioUrl: string): string {
  if (guid) return guid
  return createHash('sha256').update(audioUrl, 'utf8').digest('hex')
}
