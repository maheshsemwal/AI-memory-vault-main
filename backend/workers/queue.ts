import { Queue } from 'bullmq';
import Redis from 'ioredis';

interface ProcessFileJob {
  fileId: string;
}

/**
 * Queue utility for managing the process-file queue
 * Provides helpers for adding jobs, checking status, and clearing the queue
 */

const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

export const fileProcessQueue = new Queue<ProcessFileJob>('process-file', {
  connection,
});

/**
 * Add a file to the processing queue
 * @param fileId - File ID to process
 * @param priority - Job priority (lower number = higher priority)
 * @returns Job ID
 */
export async function enqueueFile(fileId: string, priority: number = 0): Promise<string> {
  const job = await fileProcessQueue.add(
    'process-file',
    { fileId },
    {
      priority,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10000, // 10 seconds
      },
      removeOnComplete: {
        age: 86400, // Keep completed jobs for 24 hours
        count: 1000, // Keep max 1000 completed jobs
      },
      removeOnFail: {
        age: 604800, // Keep failed jobs for 7 days
      },
    }
  );

  console.log(`[Queue] Enqueued file ${fileId} with job ID: ${job.id}`);
  return job.id!;
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    fileProcessQueue.getWaitingCount(),
    fileProcessQueue.getActiveCount(),
    fileProcessQueue.getCompletedCount(),
    fileProcessQueue.getFailedCount(),
    fileProcessQueue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed,
  };
}

/**
 * Get job by ID
 * @param jobId - Job ID
 */
export async function getJob(jobId: string) {
  const job = await fileProcessQueue.getJob(jobId);
  
  if (!job) {
    return null;
  }

  return {
    id: job.id,
    data: job.data,
    state: await job.getState(),
    progress: job.progress,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    finishedOn: job.finishedOn,
    processedOn: job.processedOn,
    timestamp: job.timestamp,
  };
}

/**
 * Remove a job from the queue
 * @param jobId - Job ID to remove
 */
export async function removeJob(jobId: string): Promise<boolean> {
  const job = await fileProcessQueue.getJob(jobId);
  
  if (!job) {
    return false;
  }

  await job.remove();
  console.log(`[Queue] Removed job ${jobId}`);
  return true;
}

/**
 * Clear all jobs from the queue
 * WARNING: Use with caution!
 */
export async function clearQueue(): Promise<void> {
  await fileProcessQueue.obliterate({ force: true });
  console.log('[Queue] Queue cleared');
}

/**
 * Retry a failed job
 * @param jobId - Job ID to retry
 */
export async function retryJob(jobId: string): Promise<boolean> {
  const job = await fileProcessQueue.getJob(jobId);
  
  if (!job) {
    return false;
  }

  const state = await job.getState();
  
  if (state !== 'failed') {
    console.warn(`[Queue] Job ${jobId} is not in failed state (current: ${state})`);
    return false;
  }

  await job.retry();
  console.log(`[Queue] Retrying job ${jobId}`);
  return true;
}

/**
 * Get all jobs in a specific state
 * @param state - Job state to filter by
 * @param start - Start index
 * @param end - End index
 */
export async function getJobs(
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
  start: number = 0,
  end: number = 100
) {
  const jobs = await fileProcessQueue.getJobs(state, start, end);
  
  return Promise.all(
    jobs.map(async (job) => ({
      id: job.id,
      data: job.data,
      state: await job.getState(),
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
    }))
  );
}

/**
 * Close the queue connection
 */
export async function closeQueue(): Promise<void> {
  await fileProcessQueue.close();
  await connection.quit();
  console.log('[Queue] Connection closed');
}
