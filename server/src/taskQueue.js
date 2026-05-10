/**
 * 任务队列管理器
 * 使用 Redis 持久化任务状态，使用 BullMQ 负责排队和消费
 */

const { v4: uuidv4 } = require('uuid');
const IORedis = require('ioredis');
const { Queue, Worker } = require('bullmq');

const STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

const TASK_QUEUE_MODE = (process.env.TASK_QUEUE_MODE || 'redis').toLowerCase();
const USE_MEMORY_QUEUE = TASK_QUEUE_MODE === 'memory';
const QUEUE_NAME = process.env.BULLMQ_QUEUE_NAME || 'fan-photo-synthesis';
const TASK_KEY_PREFIX = process.env.REDIS_TASK_KEY_PREFIX || 'fan-photo:task:';
const TASK_RETENTION_SECONDS = Math.max(60, Number(process.env.TASK_RETENTION_SECONDS) || 2 * 60 * 60);
const WORKER_CONCURRENCY = Math.max(1, Number(process.env.MAX_CONCURRENT) || 3);
const JOB_ATTEMPTS = Math.max(1, Number(process.env.BULLMQ_JOB_ATTEMPTS) || 1);
const JOB_BACKOFF_MS = Math.max(0, Number(process.env.BULLMQ_JOB_BACKOFF_MS) || 0);
const REMOVE_ON_COMPLETE_COUNT = Math.max(100, Number(process.env.BULLMQ_REMOVE_ON_COMPLETE_COUNT) || 500);
const REMOVE_ON_FAIL_COUNT = Math.max(100, Number(process.env.BULLMQ_REMOVE_ON_FAIL_COUNT) || 1000);

let taskRedis = null;
let queueConnection = null;
let queue = null;
let workerConnection = null;
let worker = null;
let memoryProcessor = null;
let memoryWorkerStarted = false;
const memoryTasks = new Map();
const memoryQueue = [];
let memoryActiveCount = 0;

async function drainMemoryQueue() {
  if (!USE_MEMORY_QUEUE || !memoryProcessor) {
    return;
  }

  while (memoryActiveCount < WORKER_CONCURRENCY && memoryQueue.length > 0) {
    const taskId = memoryQueue.shift();
    memoryActiveCount += 1;

    setImmediate(async () => {
      try {
        await updateTask(taskId, {
          status: STATUS.PROCESSING,
          error: null,
        });
        await memoryProcessor(taskId);
      } catch (err) {
        try {
          const task = await getTask(taskId);
          if (task && task.status !== STATUS.COMPLETED) {
            await updateTask(taskId, {
              status: STATUS.FAILED,
              error: err.message,
            });
          }
        } catch (updateErr) {
          console.error(`[TaskQueue] 内存队列标记失败异常: ${updateErr.message}`);
        }
      } finally {
        memoryActiveCount = Math.max(0, memoryActiveCount - 1);
        drainMemoryQueue().catch((err) => {
          console.error(`[TaskQueue] 内存队列 drain 异常: ${err.message}`);
        });
      }
    });
  }
}

function createRedisClient({ workerMode = false } = {}) {
  const sharedOptions = {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: workerMode ? null : 20,
  };

  if ((process.env.REDIS_TLS || '').toLowerCase() === 'true') {
    sharedOptions.tls = {};
  }

  const redisDb = Number(process.env.REDIS_DB);
  if (!Number.isNaN(redisDb)) {
    sharedOptions.db = redisDb;
  }

  if (process.env.REDIS_PASSWORD) {
    sharedOptions.password = process.env.REDIS_PASSWORD;
  }

  if (process.env.REDIS_URL) {
    return new IORedis(process.env.REDIS_URL, sharedOptions);
  }

  return new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    ...sharedOptions,
  });
}

function attachRedisLogging(client, label) {
  client.on('error', (err) => {
    console.error(`[TaskQueue] ${label} 连接异常: ${err.message}`);
  });
}

async function ensureRedisReady(client) {
  if (client.status === 'ready') {
    return;
  }

  if (client.status === 'wait' || client.status === 'end') {
    await client.connect();
    return;
  }

  if (client.status === 'connecting' || client.status === 'reconnecting') {
    await new Promise((resolve, reject) => {
      const handleReady = () => {
        cleanup();
        resolve();
      };
      const handleError = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        client.off('ready', handleReady);
        client.off('error', handleError);
      };

      client.on('ready', handleReady);
      client.on('error', handleError);
    });
    return;
  }

  await client.ping();
}

async function ensureTaskRedis() {
  if (!taskRedis) {
    taskRedis = createRedisClient();
    attachRedisLogging(taskRedis, 'Redis');
  }

  await ensureRedisReady(taskRedis);
  return taskRedis;
}

async function ensureQueue() {
  await ensureTaskRedis();

  if (!queueConnection) {
    queueConnection = createRedisClient({ workerMode: true });
    attachRedisLogging(queueConnection, 'BullMQ Queue');
  }

  await ensureRedisReady(queueConnection);

  if (!queue) {
    const defaultJobOptions = {
      attempts: JOB_ATTEMPTS,
      removeOnComplete: { count: REMOVE_ON_COMPLETE_COUNT },
      removeOnFail: { count: REMOVE_ON_FAIL_COUNT },
    };

    if (JOB_BACKOFF_MS > 0) {
      defaultJobOptions.backoff = {
        type: 'fixed',
        delay: JOB_BACKOFF_MS,
      };
    }

    queue = new Queue(QUEUE_NAME, {
      connection: queueConnection,
      defaultJobOptions,
    });
  }

  return queue;
}

function buildTaskKey(taskId) {
  return `${TASK_KEY_PREFIX}${taskId}`;
}

function serializeTaskField(field, value) {
  if (field === 'params' || field === 'results') {
    return JSON.stringify(value ?? (field === 'results' ? [] : {}));
  }

  if (field === 'error') {
    return value || '';
  }

  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
}

function serializeTaskRecord(record) {
  const serialized = {};

  Object.entries(record).forEach(([field, value]) => {
    if (value === undefined) {
      return;
    }
    serialized[field] = serializeTaskField(field, value);
  });

  return serialized;
}

function parseJsonField(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function deserializeTaskRecord(record) {
  if (!record || Object.keys(record).length === 0) {
    return null;
  }

  return {
    task_id: record.task_id,
    status: record.status,
    params: parseJsonField(record.params, {}),
    results: parseJsonField(record.results, []),
    error: record.error || null,
    created_at: Number(record.created_at || 0),
    updated_at: Number(record.updated_at || 0),
  };
}

async function setTaskRecord(taskId, record) {
  if (USE_MEMORY_QUEUE) {
    const existing = memoryTasks.get(taskId) || {};
    const merged = {
      ...existing,
      ...record,
    };
    memoryTasks.set(taskId, JSON.parse(JSON.stringify(merged)));
    return;
  }

  const redis = await ensureTaskRedis();
  const key = buildTaskKey(taskId);
  const payload = serializeTaskRecord(record);

  await redis.hset(key, payload);
  await redis.expire(key, TASK_RETENTION_SECONDS);
}

async function createTask(params) {
  const taskId = `task_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const now = Date.now();

  await setTaskRecord(taskId, {
    task_id: taskId,
    status: STATUS.PENDING,
    params,
    results: [],
    error: null,
    created_at: now,
    updated_at: now,
  });

  return { task_id: taskId, status: STATUS.PENDING };
}

async function getTask(taskId) {
  if (USE_MEMORY_QUEUE) {
    const record = memoryTasks.get(taskId);
    return record ? JSON.parse(JSON.stringify(record)) : null;
  }

  const redis = await ensureTaskRedis();
  const data = await redis.hgetall(buildTaskKey(taskId));
  return deserializeTaskRecord(data);
}

async function updateTask(taskId, updates) {
  if (USE_MEMORY_QUEUE) {
    const existing = memoryTasks.get(taskId);
    if (!existing) {
      return null;
    }
    const next = {
      ...existing,
      ...updates,
      updated_at: Date.now(),
    };
    memoryTasks.set(taskId, JSON.parse(JSON.stringify(next)));
    return getTask(taskId);
  }

  const redis = await ensureTaskRedis();
  const key = buildTaskKey(taskId);
  const exists = await redis.exists(key);

  if (!exists) {
    return null;
  }

  const payload = serializeTaskRecord({
    ...updates,
    updated_at: Date.now(),
  });

  await redis.hset(key, payload);
  await redis.expire(key, TASK_RETENTION_SECONDS);
  return getTask(taskId);
}

async function enqueueTask(taskId) {
  if (USE_MEMORY_QUEUE) {
    memoryQueue.push(taskId);
    drainMemoryQueue().catch((err) => {
      console.error(`[TaskQueue] 内存队列入队异常: ${err.message}`);
    });
    return STATUS.PENDING;
  }

  const synthesisQueue = await ensureQueue();

  await synthesisQueue.add(
    'synthesis',
    { taskId },
    { jobId: taskId }
  );

  return STATUS.PENDING;
}

async function initTaskQueue() {
  if (USE_MEMORY_QUEUE) {
    console.log(`[TaskQueue] 使用内存队列模式: concurrency=${WORKER_CONCURRENCY}`);
    return;
  }
  await ensureQueue();
}

async function startSynthesisWorker(processor) {
  if (USE_MEMORY_QUEUE) {
    memoryProcessor = processor;
    memoryWorkerStarted = true;
    console.log(`[TaskQueue] 内存 Worker 已启动: queue=${QUEUE_NAME}, concurrency=${WORKER_CONCURRENCY}`);
    drainMemoryQueue().catch((err) => {
      console.error(`[TaskQueue] 内存 Worker drain 异常: ${err.message}`);
    });
    return {
      mode: 'memory',
      close: async () => {
        memoryWorkerStarted = false;
      },
    };
  }

  if (worker) {
    return worker;
  }

  await ensureQueue();

  if (!workerConnection) {
    workerConnection = createRedisClient({ workerMode: true });
    attachRedisLogging(workerConnection, 'BullMQ Worker');
  }

  await ensureRedisReady(workerConnection);

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const taskId = job?.data?.taskId;

      if (!taskId) {
        throw new Error('BullMQ job 缺少 taskId');
      }

      await updateTask(taskId, {
        status: STATUS.PROCESSING,
        error: null,
      });

      await processor(taskId);
    },
    {
      connection: workerConnection,
      concurrency: WORKER_CONCURRENCY,
    }
  );

  worker.on('error', (err) => {
    console.error(`[TaskQueue] Worker 异常: ${err.message}`);
  });

  worker.on('failed', async (job, err) => {
    const taskId = job?.data?.taskId || job?.id;

    if (!taskId) {
      return;
    }

    try {
      const task = await getTask(taskId);
      if (task && task.status !== STATUS.COMPLETED) {
        await updateTask(taskId, {
          status: STATUS.FAILED,
          error: err.message,
        });
      }
    } catch (updateErr) {
      console.error(`[TaskQueue] 标记失败任务异常: ${updateErr.message}`);
    }
  });

  await worker.waitUntilReady();
  console.log(`[TaskQueue] BullMQ Worker 已启动: queue=${QUEUE_NAME}, concurrency=${WORKER_CONCURRENCY}`);
  return worker;
}

async function closeTaskQueue() {
  if (USE_MEMORY_QUEUE) {
    memoryProcessor = null;
    memoryWorkerStarted = false;
    memoryQueue.length = 0;
    memoryTasks.clear();
    memoryActiveCount = 0;
    return;
  }

  const closers = [];

  if (worker) {
    closers.push(worker.close().catch((err) => {
      console.error(`[TaskQueue] 关闭 Worker 失败: ${err.message}`);
    }));
    worker = null;
  }

  if (queue) {
    closers.push(queue.close().catch((err) => {
      console.error(`[TaskQueue] 关闭 Queue 失败: ${err.message}`);
    }));
    queue = null;
  }

  if (workerConnection) {
    closers.push(workerConnection.quit().catch((err) => {
      console.error(`[TaskQueue] 关闭 Worker Redis 失败: ${err.message}`);
    }));
    workerConnection = null;
  }

  if (queueConnection) {
    closers.push(queueConnection.quit().catch((err) => {
      console.error(`[TaskQueue] 关闭 Queue Redis 失败: ${err.message}`);
    }));
    queueConnection = null;
  }

  if (taskRedis) {
    closers.push(taskRedis.quit().catch((err) => {
      console.error(`[TaskQueue] 关闭 Redis 失败: ${err.message}`);
    }));
    taskRedis = null;
  }

  await Promise.all(closers);
}

function getQueueConfig() {
  return {
    mode: USE_MEMORY_QUEUE ? 'memory' : 'redis',
    queue_name: QUEUE_NAME,
    concurrency: WORKER_CONCURRENCY,
    retention_seconds: TASK_RETENTION_SECONDS,
    redis_url: USE_MEMORY_QUEUE ? null : (process.env.REDIS_URL ? 'configured' : null),
    redis_host: USE_MEMORY_QUEUE ? null : (process.env.REDIS_URL ? null : (process.env.REDIS_HOST || '127.0.0.1')),
    redis_port: USE_MEMORY_QUEUE ? null : (process.env.REDIS_URL ? null : (Number(process.env.REDIS_PORT) || 6379)),
    worker_started: USE_MEMORY_QUEUE ? memoryWorkerStarted : undefined,
  };
}

module.exports = {
  STATUS,
  createTask,
  getTask,
  updateTask,
  enqueueTask,
  initTaskQueue,
  startSynthesisWorker,
  closeTaskQueue,
  getQueueConfig,
};
