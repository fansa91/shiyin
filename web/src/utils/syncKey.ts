/**
 * 单集稳定 key 规则: guid 优先, 无 guid 时用 audioUrl 的 sha256 hex。
 * 后端 api/src/syncKey.ts 有同一规则的 Node 实现, 两处必须保持一致,
 * 否则同一单集在两端 key 不同会导致重复/同步错位。
 */
export async function episodeKey(guid: string, audioUrl: string): Promise<string> {
  if (guid) return guid
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(audioUrl))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
