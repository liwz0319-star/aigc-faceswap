/**
 * 独立 Worker 进程入口
 * 用于将 API 服务和任务消费拆分部署
 */

require('dotenv').config();
const { processTask } = require('./synthesisWorker');
const { initTaskQueue, startSynthesisWorker, closeTaskQueue } = require('./taskQueue');

let isShuttingDown = false;

function validateEnv() {
  const seedreamMode = (process.env.SEEDREAM_MODE || 'relay').toLowerCase();
  const requiredEnvVars = seedreamMode === 'native'
    ? ['SEEDREAM_NATIVE_API_KEY', 'SEEDREAM_NATIVE_API_URL']
    : ['LAS_API_KEY'];
  const missing = requiredEnvVars.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`[Worker] 缺少必要环境变量 (${seedreamMode} 模式): ${missing.join(', ')}`);
  }
}

async function startWorkerProcess() {
  validateEnv();
  await initTaskQueue();
  await startSynthesisWorker(processTask);
  console.log('[Worker] 独立 Worker 进程已启动');
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`\n[Worker] 收到 ${signal}，正在关闭...`);

  const forceExitTimer = setTimeout(() => {
    console.error('[Worker] 强制退出（等待超时）');
    process.exit(1);
  }, 10000);

  try {
    await closeTaskQueue();
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExitTimer);
    console.error('[Worker] 关闭失败:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
});

startWorkerProcess().catch((err) => {
  console.error('[Worker] 启动失败:', err.message || err);
  process.exit(1);
});
