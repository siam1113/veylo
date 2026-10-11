import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { db } from '@veylo/db/client';
import { intentionRevisions } from '@veylo/db/schema';
import { env } from '../env.js';

export const AI_QUEUE = 'veylo-ai';
const ENQUEUE_TIMEOUT_MS = 3_000;
const connection = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false }) : null;
const queue = connection ? new Queue(AI_QUEUE, { connection }) : null;
connection?.on('error', (error) => console.error(JSON.stringify({ event: 'queue_connection_error', errorName: error.name })));

function enqueueWithDeadline<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Background queue did not accept the job within three seconds.')), ENQUEUE_TIMEOUT_MS);
    }),
  ]).finally(() => { if (timeout) clearTimeout(timeout); });
}

export async function enqueueInterpretation(data: { intentionId: string; ownerId: string; expectedVersion: number; evaluateOnly?: boolean }) {
  if (!queue) return false;
  const requestedAt = new Date();
  try {
    const jobId = `${data.evaluateOnly ? 'evaluate' : 'interpret'}-${data.intentionId}-v${data.expectedVersion}`;
    const existing = await enqueueWithDeadline(queue.getJob(jobId));
    if (existing && await enqueueWithDeadline(existing.getState()) === 'failed') {
      await enqueueWithDeadline(existing.retry());
      return true;
    }
    await enqueueWithDeadline(queue.add('interpret-intention', data, {
      jobId,
      attempts: 4,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 5000 },
    }));
    // A request is a timeline event, not a mutation of the thought's contents.
    await db.insert(intentionRevisions).values({ ownerId: data.ownerId, intentionId: data.intentionId, version: data.expectedVersion, action: 'ai_requested', changedFields: [], createdAt: requestedAt }).onConflictDoNothing();
    return true;
  } catch (error) {
    console.error('Could not queue optional intention interpretation', error);
    return false;
  }
}

export async function enqueueBrainstormReply(data: { intentionId: string; ownerId: string; userMessageId: string; assistantMessageId: string; attemptKey: string }) {
  if (!queue) return false;
  try {
    await enqueueWithDeadline(queue.add('brainstorm-reply', data, {
      jobId: `brainstorm-${data.assistantMessageId}-${data.attemptKey}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 5000 },
    }));
    return true;
  } catch (error) {
    console.error('Could not queue intention brainstorming reply', error);
    return false;
  }
}

export async function enqueueSnoozeReminder(data: { intentionId: string; ownerId: string; snoozedUntil: string }) {
  if (!queue) return false;
  const delay = Date.parse(data.snoozedUntil) - Date.now();
  if (delay <= 0) return false;
  try {
    await enqueueWithDeadline(queue.add('suggestion-reminder', data, {
      jobId: `reminder-${data.intentionId}-${Date.parse(data.snoozedUntil)}`,
      delay,
      attempts: 4,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 5000 },
    }));
    return true;
  } catch (error) {
    console.error('Could not queue optional suggestion reminder', error);
    return false;
  }
}

export async function enqueueSnoozeReminderCheck(data: { intentionId: string; ownerId: string; snoozedUntil: string }) {
  if (!queue) return false;
  try {
    await enqueueWithDeadline(queue.add('suggestion-reminder', data, {
      jobId: `reminder-check-${data.intentionId}-${Date.parse(data.snoozedUntil)}-${Date.now()}`,
      delay: 1_000,
      attempts: 4,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 5000 },
    }));
    return true;
  } catch (error) {
    console.error('Could not queue an updated snooze reminder check', error);
    return false;
  }
}

export async function closeQueue() {
  await queue?.close();
  await connection?.quit();
}
