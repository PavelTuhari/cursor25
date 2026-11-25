/** Runs a pipeline's `tick` on an interval, one at a time, until stopped. */
import type { WorkerConfig } from '../config/types.js';
import type { Logger } from '../util/logger.js';

/**
 * Structural, so the same runner drives both the outgoing pipeline and the
 * incoming one without either knowing about the other.
 */
export interface Tickable {
  tick(): Promise<Record<string, number>>;
}

export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly pipeline: Tickable,
    private readonly config: WorkerConfig,
    private readonly logger: Logger,
  ) {}

  private async runOnce(): Promise<void> {
    // Ticks never overlap: a slow SFS call must not pile up a second batch on
    // top of the one still in flight.
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const result = await this.pipeline.tick();
      // A quiet tick is the normal case; logging it every interval would bury
      // everything else.
      if (Object.values(result).some((value) => value > 0)) this.logger.info('worker.tick', result);
    } catch (error) {
      this.logger.error('worker.tick.failed', { error: (error as Error).message });
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (!this.config.enabled) {
      this.logger.info('worker.disabled');
      return;
    }
    this.stopped = false;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.config.pollIntervalMs);
    // Do not keep the process alive purely for the timer.
    this.timer.unref?.();
    this.logger.info('worker.started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    // Let an in-flight tick finish so a posted invoice is recorded as posted.
    const deadline = Date.now() + 30_000;
    while (this.running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.logger.info('worker.stopped');
  }
}
