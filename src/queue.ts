export interface TaskQueue {
  submit<T>(job: () => Promise<T>): Promise<T>;
}

// Swap this boundary for BullMQ when jobs must survive process restarts.
export class InMemoryTaskQueue implements TaskQueue {
  submit<T>(job: () => Promise<T>): Promise<T> { return job(); }
}
