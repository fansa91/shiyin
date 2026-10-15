/** 共享数据模型: 播客 / 单集 / 章节 */

/** 章节 (与后端 /api/rss 的 chapters 字段、shikwasa 的 audio.chapters 一致, 秒) */
export interface Chapter {
  title: string
  startTime: number
  endTime: number
}

/** 单集: guid (无 guid 则用 audioUrl) 为全应用唯一稳定 key */
export interface Episode {
  guid: string
  title: string
  description: string
  pubDate: string
  /** 秒 */
  duration: number
  audioUrl: string
  /** 展示用封面 (单集封面 || 播客封面) */
  artwork: string
  podcastTitle: string
  podcastAuthor: string
  podcastKey: string
  feedUrl: string
  chapters: Chapter[]
}

/** 播客 */
export interface Podcast {
  /** collectionId 数字字符串, 或手动 RSS 的 'rss:' + feedUrl 哈希 */
  key: string
  collectionId?: number
  feedUrl: string
  title: string
  author: string
  artwork: string
  description: string
}

/** djb2 哈希, 给手动添加的 RSS feedUrl 生成稳定的短 key */
export function hashFeedUrl(url: string): string {
  let h = 5381
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) + h + url.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

export function rssKey(feedUrl: string): string {
  return `rss:${hashFeedUrl(feedUrl)}`
}

/** 把 RSS 单集 + 播客信息拼成统一的 Episode */
export function toEpisode(
  e: {
    guid: string
    title: string
    description: string
    pubDate: string
    duration: number
    audioUrl: string
    image?: string
    chapters: Chapter[]
  },
  podcast: { key: string; title: string; author: string; artwork: string; feedUrl: string },
): Episode {
  const guid = e.guid || e.audioUrl
  return {
    guid,
    title: e.title,
    description: e.description,
    pubDate: e.pubDate,
    duration: e.duration,
    audioUrl: e.audioUrl,
    artwork: e.image || podcast.artwork,
    podcastTitle: podcast.title,
    podcastAuthor: podcast.author,
    podcastKey: podcast.key,
    feedUrl: podcast.feedUrl,
    chapters: e.chapters ?? [],
  }
}
