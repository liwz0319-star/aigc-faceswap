/**
 * 服务器连通性测试脚本
 * 用法: node test_server.js [port]
 *
 * 测试内容:
 *   1. /health          健康检查
 *   2. /api/v1/synthesis/routes  路由是否注册
 */

const http = require('http');

const PORT = parseInt(process.argv[2] || process.env.PORT || '3000', 10);
const BASE = `http://localhost:${PORT}`;

function get(path) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    http
      .get(`${BASE}${path}`, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode, body, ms: Date.now() - start });
        });
      })
      .on('error', reject);
  });
}

async function main() {
  console.log(`\n========================================`);
  console.log(`  服务器连通性测试`);
  console.log(`  目标: ${BASE}`);
  console.log(`  时间: ${new Date().toLocaleString()}`);
  console.log(`========================================\n`);

  const results = [];
  let allPassed = true;

  // ─── 测试 1: GET /health ───
  try {
    const res = await get('/health');
    const ok = res.status === 200;
    allPassed = allPassed && ok;
    results.push({
      name: 'GET /health',
      status: res.status,
      ok,
      ms: res.ms,
      detail: ok ? JSON.parse(res.body) : res.body.slice(0, 200),
    });
  } catch (err) {
    allPassed = false;
    results.push({
      name: 'GET /health',
      status: 'ERR',
      ok: false,
      ms: '-',
      detail: err.message,
    });
  }

  // ─── 测试 2: GET /api/v1/synthesis/ (路由存在性) ───
  try {
    const res = await get('/api/v1/synthesis/');
    // 只要不是 404 就说明路由已注册（可能是 400/405/500 等业务错误，但路由在）
    const routeExists = res.status !== 404;
    results.push({
      name: 'GET /api/v1/synthesis/',
      status: res.status,
      ok: routeExists,
      ms: res.ms,
      detail: routeExists ? '路由已注册' : '路由未找到 (404)',
    });
  } catch (err) {
    results.push({
      name: 'GET /api/v1/synthesis/',
      status: 'ERR',
      ok: false,
      ms: '-',
      detail: err.message,
    });
  }

  // ─── 输出结果 ───
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    console.log(`  ${icon} ${r.name}`);
    console.log(`    状态码: ${r.status}  耗时: ${r.ms}ms`);
    if (!r.ok || r.name.includes('health')) {
      console.log(`    详情: ${typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail, null, 2).slice(0, 300)}`);
    }
    console.log();
  }

  const passCount = results.filter((r) => r.ok).length;
  console.log(`========================================`);
  console.log(`  结果: ${passCount}/${results.length} 通过`);
  console.log(`========================================\n`);

  process.exit(allPassed ? 0 : 1);
}

main();
