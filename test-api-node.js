/**
 * 拜仁球星球迷合照 API 测试脚本 (Node.js)
 * 用法: node test-api-node.js [API_KEY]
 */

const http = require('http');

const HOST = '111.229.177.65';
const API_KEY = process.argv[2] || 'your_server_api_key_here';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST, port: 80, method, path,
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      timeout: 10000,
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('=== 拜仁球星球迷合照 API 测试 ===\n');
  console.log(`目标: http://${HOST}`);
  console.log(`API Key: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}\n`);

  // 1. 健康检查
  console.log('【1】健康检查 GET /health');
  try {
    const r = await request('GET', '/health');
    console.log(`  HTTP 状态码: ${r.status}`);
    console.log(`  响应: ${r.body.slice(0, 200)}`);
    console.log(r.status === 200 ? '  结果: OK ✓' : '  结果: FAIL ✗\n');
  } catch (e) {
    console.log(`  错误: ${e.message}`);
  }

  // 2. 提交合成任务
  console.log('\n【2】提交合成任务 POST /api/v1/synthesis/submit');
  const submitBody = JSON.stringify({
    star_ids: ['101', '105', '108'],
    scene_id: 'scene_03',
    user_image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png',
  });
  try {
    const r = await request('POST', '/api/v1/synthesis/submit', submitBody);
    console.log(`  HTTP 状态码: ${r.status}`);
    try {
      const j = JSON.parse(r.body);
      console.log(`  code: ${j.code}`);
      console.log(`  message: ${j.message}`);
      if (j.data) {
        console.log(`  task_id: ${j.data.task_id || 'N/A'}`);
        console.log(`  status: ${j.data.status || 'N/A'}`);
      }
    } catch {
      console.log(`  响应: ${r.body.slice(0, 200)}`);
    }
    console.log(r.status === 200 ? '  结果: OK ✓' : '  结果: FAIL ✗');
  } catch (e) {
    console.log(`  错误: ${e.message}`);
  }

  // 3. 查询接口
  console.log('\n【3】查询接口 GET /api/v1/synthesis/query/test_123');
  try {
    const r = await request('GET', '/api/v1/synthesis/query/test_123');
    console.log(`  HTTP 状态码: ${r.status}`);
    console.log(`  响应: ${r.body.slice(0, 200)}`);
    console.log(r.status === 200 || r.status === 404 ? '  结果: OK ✓' : '  结果: FAIL ✗');
  } catch (e) {
    console.log(`  错误: ${e.message}`);
  }

  // 4. 鉴权测试（不带 key）
  console.log('\n【4】鉴权测试 POST /api/v1/synthesis/submit (不带 API Key)');
  try {
    const noKeyReq = () => new Promise((resolve, reject) => {
      const opts = { hostname: HOST, port: 80, method: 'POST', path: '/api/v1/synthesis/submit', headers: { 'Content-Type': 'application/json' }, timeout: 10000 };
      const body = JSON.stringify({ star_ids: ['101'], scene_id: 'scene_03', user_image: 'test' });
      opts.headers['Content-Length'] = Buffer.byteLength(body);
      const req = http.request(opts, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    const r = await noKeyReq();
    console.log(`  HTTP 状态码: ${r.status}`);
    console.log(`  响应: ${r.body.slice(0, 200)}`);
    console.log(r.status === 401 ? '  鉴权生效 ✓' : '  鉴权未生效，请检查 SERVER_API_KEY 配置');
  } catch (e) {
    console.log(`  错误: ${e.message}`);
  }

  console.log('\n=== 测试完成 ===');
}

main();
