/**
 * Bounded async work queue with a drop policy.
 *
 * Used for fire-and-forget audit writes (session records): the request
 * path must never block on them, and a traffic spike must never grow an
 * unbounded in-memory backlog. When the queue is full the item is
 * dropped and counted — the caller observes the drop metric.
 */

export interface BoundedQueueOptions<T> {
  concurrency: number;
  maxQueue: number;
  onDrop?: (item: T) => void;
  onError?: (err: unknown, item: T) => void;
}

export class BoundedQueue<T> {
  private queue: T[] = [];
  private inFlight = 0;

  constructor(
    private readonly worker: (item: T) => Promise<void>,
    private readonly opts: BoundedQueueOptions<T>,
  ) {}

  get pending(): number {
    return this.queue.length + this.inFlight;
  }

  get length(): number {
    return this.queue.length;
  }

  /** Returns false when the item was dropped (queue full). */
  push(item: T): boolean {
    if (this.queue.length >= this.opts.maxQueue) {
      this.opts.onDrop?.(item);
      return false;
    }
    this.queue.push(item);
    this.pump();
    return true;
  }

  private pump(): void {
    while (this.inFlight < this.opts.concurrency && this.queue.length > 0) {
      const item = this.queue.shift() as T;
      this.inFlight += 1;
      this.worker(item)
        .catch((err: unknown) => this.opts.onError?.(err, item))
        .finally(() => {
          this.inFlight -= 1;
          this.pump();
        });
    }
  }
}
