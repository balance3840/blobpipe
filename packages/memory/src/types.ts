/**
 * Configuration for MemoryDriver — an in-memory StorageDriver intended for
 * unit tests. Requires no external services and no peer dependencies.
 */
export interface MemoryDriverConfig {
  /**
   * Optional artificial latency (ms) added to every operation, useful for
   * testing loading states / race conditions without flaky real I/O.
   */
  simulatedLatencyMs?: number;
}
