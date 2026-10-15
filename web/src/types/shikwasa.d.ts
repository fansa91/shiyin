/**
 * shikwasa 2.2.1 的手写类型声明。
 * 该包没有自带 .d.ts, 以下 API 全部从 node_modules/shikwasa/dist/shikwasa.es.js
 * 源码逐一核实 (README 已过时约 2.5 年, 以源码为准):
 * - Player.use(comp) 为静态方法, 必须在 new Player 之前调用
 * - new Player({ container, audio, themeColor, theme, fixed, autoPlay, muted, preload, speedOptions, download })
 * - update(audio) 切换音频 (audio.src 必填), chapters 字段单位为秒
 * - 事件: 标准 audio 事件 (play/pause/ended/timeupdate/loadedmetadata/error...) + audioupdate/audioparse
 * - MediaSession 在 play() 成功后自动设置 (title/artist/album/cover)
 * - CSS 变量定义在 .shk 上: --background-body(--color-theme 的别名) 等, 见 style.css
 */
declare module 'shikwasa' {
  /** 章节: 起止时间单位为秒, 与后端 /api/rss 返回的 chapters 字段一致 */
  export interface ShikwasaChapter {
    id?: string
    title: string
    startTime: number
    endTime: number
  }

  export interface ShikwasaAudio {
    title?: string
    artist?: string
    album?: string
    cover?: string | null
    src?: string | null
    duration?: number
    live?: boolean
    chapters?: ShikwasaChapter[]
  }

  export interface ShikwasaOptions {
    container: HTMLElement | (() => HTMLElement)
    audio?: ShikwasaAudio | null
    /** 主色, 会以内联样式写入 --color-primary */
    themeColor?: string
    /** 'auto' | 'dark' | 'light', 写入 data-theme 属性 */
    theme?: string
    fixed?: { type?: 'auto' | 'static' | 'fixed'; position?: 'top' | 'bottom' }
    autoPlay?: boolean
    muted?: boolean
    preload?: string
    speedOptions?: number[]
    download?: boolean
  }

  /** 章节插件: Player.use(Chapter) 注册, 通过 audio.chapters 喂数据 */
  export class Chapter {
    static _name: string
  }

  export class Player {
    static use(comp: unknown): void
    constructor(options: ShikwasaOptions)
    /** 播放器根元素 (class="shk shikwasa"), 可直接改 style / data-theme 做主题适配 */
    readonly el: HTMLElement
    readonly audio: HTMLAudioElement
    readonly duration: number
    readonly currentTime: number
    playbackRate: number
    muted: boolean
    readonly seekable: boolean
    on(name: string, callback: (...args: unknown[]) => void): void
    play(): void
    pause(): void
    toggle(): void
    /** 跳到指定秒数 */
    seek(time: number): void
    /** 快进/快退, 默认 ±10s */
    seekBySpan(opts?: { time?: number; forward?: boolean }): void
    /** 切换当前音频并触发 audioupdate 事件 */
    update(audio: ShikwasaAudio): void
    updateMetadata(audio: ShikwasaAudio): void
    destroy(): void
  }
}
