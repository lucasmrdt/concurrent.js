import { ErrorMessage } from './constants.js'
import { ConcurrencyError } from './error.js'
import { Thread } from './thread.js'

import type { ThreadPoolSettings } from '../index.d.js'
import type { IWorkerFactory } from './types.js'

export class ThreadPool {
  private turn = 0
  private threads: Thread[] = []
  private terminated = false
  private idleCheckInterval: NodeJS.Timeout

  constructor(private workerFactory: IWorkerFactory, private settings: ThreadPoolSettings) {
    if (this.settings.minThreads) {
      for (let i = 0; i < this.settings.minThreads; i++) {
        this.addThread()
      }
    }

    this.startIdleCheck()
  }

  config(settings: Partial<ThreadPoolSettings>) {
    Object.assign(this.settings, settings)
  }

  async getThread(): Promise<Thread> {
    if (this.terminated) throw new ConcurrencyError(ErrorMessage.ThreadPoolTerminated)

    if (this.threads.length < this.settings.maxThreads) this.addThread()

    if (this.turn > this.threads.length - 1) this.turn = 0

    const thread = this.threads[this.turn] as Thread
    this.turn += 1

    return thread
  }

  private startIdleCheck() {
    this.idleCheckInterval = setInterval(async () => {
      const now = Date.now()
      const threadsToRemove: Thread[] = []

      for (const thread of this.threads) {
        // settings.threadIdleTimeout is in minutes, so multiply by 60 * 1000 to get milliseconds
        if (now - thread.getLastIdleTime() > this.settings.threadIdleTimeout * 60 * 1000) {
          if (this.threads.length > this.settings.minThreads) {
            await thread.terminate()
            threadsToRemove.push(thread)
          }
        }
      }

      // Remove terminated threads from the list
      this.threads = this.threads.filter(thread => !threadsToRemove.includes(thread))
    }, 60 * 1000) // check every minute
  }

  async terminate(force = false) {
    clearInterval(this.idleCheckInterval)
    for (let i = 0; i < this.threads.length; i++) {
      const thread = this.threads[i] as Thread
      await thread.terminate(force)
    }

    this.threads = []
    this.terminated = true
  }

  private addThread() {
    const thread = new Thread(this.workerFactory)
    this.threads.push(thread)
  }
}
