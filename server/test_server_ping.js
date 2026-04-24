/**
 * 轻量级服务器连通性测试
 * 不依赖 Redis / BullMQ，纯 Express 启动验证端口是否可用
 *
 * 用法: node test_server_ping.js [port]
 */

const express = require('express');
const os = require('os');

const PORT = parseInt(process.argv[2] || '3000', 10);
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '服务器连通性测试通过！',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
    node_version: process.version,
    memory: {
      total: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
      free: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
    },
  });
});

app.get('/api/v1/synthesis/test', (req, res) => {
  res.json({
    status: 'ok',
    message: '合成路由可达（测试模式，未连接 Redis）',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/v1/synthesis/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'POST 请求已接收（测试模式，未连接 Redis）',
    received_body: req.body,
    timestamp: new Date().toISOString(),
  });
});

const server = app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  服务器连通性测试`);
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`========================================\n`);
  console.log(`  测试地址:`);
  console.log(`    GET  http://localhost:${PORT}/health`);
  console.log(`    GET  http://localhost:${PORT}/api/v1/synthesis/test`);
  console.log(`    POST http://localhost:${PORT}/api/v1/synthesis/test`);
  console.log(`\n  浏览器打开上方地址即可验证`);
  console.log(`  Ctrl+C 退出\n`);
});

process.on('SIGINT', () => {
  console.log('\n[Server] 正在关闭...');
  server.close(() => process.exit(0));
});
