type Task = () => Promise<void> | void

class ImageQueue {
  private pending: Task[] = []
  private running = 0

  constructor(private limit = 6) {}

  push(task: Task): void {
    this.pending.push(task)
    this.pump()
  }

  private pump(): void {
    while (this.running < this.limit && this.pending.length > 0) {
      const task = this.pending.shift()!
      this.running++
      Promise.resolve()
        .then(task)
        .catch(() => {})
        .finally(() => {
          this.running--
          this.pump()
        })
    }
  }
}

/** 全局图片加载队列: 列表页多图时限制并发, 避免一次打满几十个请求 */
export const imageQueue = new ImageQueue(6)
