/**
 * 拜仁球迷合照 AIGC 合成服务
 * Express 主入口
 */

require('dotenv').config();
const express = require('express');
const synthesisRouter = require('./routes/synthesis');
const { processTask } = require('./synthesisWorker');
const { initTaskQueue, startSynthesisWorker, closeTaskQueue, getQueueConfig } = require('./taskQueue');

const app = express();
const PORT = process.env.PORT || 3000;
const ENABLE_EMBEDDED_WORKER = (process.env.ENABLE_EMBEDDED_WORKER || 'true').toLowerCase() !== 'false';

let server = null;
let isShuttingDown = false;

function validateEnv() {
  const seedreamMode = (process.env.SEEDREAM_MODE || 'relay').toLowerCase();
  const requiredEnvVars = seedreamMode === 'native'
    ? ['SEEDREAM_NATIVE_API_KEY', 'SEEDREAM_NATIVE_API_URL']
    : ['LAS_API_KEY'];
  const missing = requiredEnvVars.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`[启动失败] 缺少必要环境变量 (${seedreamMode} 模式): ${missing.join(', ')}`);
  }

  console.log(`[启动] 环境变量校验通过 (模式: ${seedreamMode})`);
}

// ─── 中间件 ───

// CORS（手写，不引入 cors 库）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// JSON 解析（限制10MB，防止 Base64 炸弹）
app.use(express.json({ limit: '10mb' }));

// ─── 路由 ───
app.use('/api/v1/synthesis', synthesisRouter);

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    env: {
      model: process.env.SEEDREAM_MODEL || 'doubao-seedream-4-5-251128',
      port: PORT,
      embedded_worker: ENABLE_EMBEDDED_WORKER,
      queue: getQueueConfig(),
    },
  });
});

async function startServer() {
  if (server) {
    return server;
  }

  validateEnv();
  await initTaskQueue();

  if (ENABLE_EMBEDDED_WORKER) {
    await startSynthesisWorker(processTask);
  }

  await new Promise((resolve, reject) => {
    server = app.listen(PORT, () => {
      console.log(`[Server] 合成服务已启动: http://localhost:${PORT}`);
      resolve();
    });

    server.on('error', reject);
  });

  return server;
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`\n[Server] 收到 ${signal}，正在优雅关闭...`);

  const forceExitTimer = setTimeout(() => {
    console.error('[Server] 强制退出（等待超时）');
    process.exit(1);
  }, 10000);

  try {
    if (server) {
      await new Promise((resolve) => {
        server.close(() => {
          console.log('[Server] 所有连接已关闭');
          resolve();
        });
      });
      server = null;
    }

    await closeTaskQueue();
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExitTimer);
    console.error('[Server] 关闭失败:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
});

process.on('uncaughtException', (err) => {
  console.error('[Fatal] 未捕获异常:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] 未处理的 Promise 拒绝:', reason);
});

if (require.main === module) {
  startServer().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = app;
module.exports.startServer = startServer;
module.exports.gracefulShutdown = gracefulShutdown;
