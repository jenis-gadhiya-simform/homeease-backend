import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';

// Requires Redis: `docker compose up -d` (REDIS_URL, default redis://localhost:6379).
const QUEUE = `e2e-${process.pid}-${Date.now()}`;

const processed: Array<{ name: string; data: unknown; attempt: number }> = [];

@Processor(QUEUE)
class TestProcessor extends WorkerHost {
  async process(job: Job<{ failTimes?: number }>) {
    processed.push({
      name: job.name,
      data: job.data,
      attempt: job.attemptsMade + 1,
    });
    if (job.data.failTimes && job.attemptsMade < job.data.failTimes) {
      throw new Error(`fail on attempt ${job.attemptsMade + 1}`);
    }
    return { ok: true };
  }
}

@Injectable()
class TestProducer {
  constructor(@InjectQueue(QUEUE) readonly queue: Queue) {}
}

describe('SharedQueueModule (e2e)', () => {
  let app: INestApplication;
  let queue: Queue;

  beforeAll(async () => {
    const { SharedQueueModule } =
      await import('../src/shared/queue/queue.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [SharedQueueModule, BullModule.registerQueue({ name: QUEUE })],
      providers: [TestProcessor, TestProducer],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    queue = app.get(TestProducer).queue;
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  beforeEach(() => {
    processed.length = 0;
  });

  it('processes a job added through an injected queue', async () => {
    const job = await queue.add('welcome', { userId: 1 });

    await vi.waitFor(() => expect(processed).toHaveLength(1), {
      timeout: 5_000,
    });
    expect(processed[0]).toEqual({
      name: 'welcome',
      data: { userId: 1 },
      attempt: 1,
    });
    await vi.waitFor(
      async () => expect(await queue.getJobState(job.id!)).toBe('completed'),
      { timeout: 5_000 },
    );
    // Finished jobs are cleaned up instead of kept in Redis forever.
    expect(job.opts.removeOnComplete).toEqual({ age: 86_400, count: 1_000 });
    expect(job.opts.removeOnFail).toEqual({ age: 604_800 });
  });

  it('applies the shared defaults: 3 attempts with backoff', async () => {
    // Fast backoff for the test; attempts comes from DEFAULT_JOB_OPTIONS.
    const job = await queue.add(
      'flaky',
      { failTimes: 2 },
      { backoff: { type: 'fixed', delay: 10 } },
    );

    expect(job.opts.attempts).toBe(3);
    await vi.waitFor(
      () => expect(processed.map((p) => p.attempt)).toEqual([1, 2, 3]),
      {
        timeout: 5_000,
      },
    );
  });
});
