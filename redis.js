import Redis from "ioredis";

const redis = new Redis();

// Helper: add job to queue
export async function enqueueJob(job) {
  await redis.lpush("printQueue", JSON.stringify(job));
}

// Helper: add job to front of queue (for requeuing failed jobs)
export async function requeueJob(job) {
  const jobStr = JSON.stringify(job);

  // Try to add to the set first (for deduplication)
  const added = await redis.sadd("printQueue:dedup", jobStr);

  if (added) {
    await redis.lpush("printQueue", jobStr);
    return true;
  }

  return false;
}

// Helper: fetch job from queue
export async function dequeueJob() {
  const jobData = await redis.rpop("printQueue");
  return jobData ? JSON.parse(jobData) : null;
}

// Helper: clear entire queue
export async function clearQueue() {
  await redis.del("printQueue");
}

export async function queueLength() {
  return await redis.llen("printQueue");
}
