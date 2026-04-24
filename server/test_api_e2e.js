/**
 * 端到端生图测试脚本
 * 调用部署在宝塔上的合成服务 API，提交任务并轮询等待结果
 *
 * 用法: node test_api_e2e.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── 配置 ───
const SERVER_BASE = process.env.TEST_SERVER || 'http://111.229.177.65';
const API_KEY = process.env.TEST_API_KEY || '';  // 留空=不鉴权
const POLL_INTERVAL = 5000;   // 轮询间隔 5秒
const POLL_TIMEOUT = 300000;  // 最大等待 5分钟

// 测试参数：3个球星 + 1个场景
const TEST_STAR_IDS = ['101', '105', '108'];   // Davies, Díaz, Neuer
const TEST_SCENE_ID = 'scene_01';              // Oktoberfest Gathering

// 用户照片（本地路径）
const USER_PHOTO = path.resolve(__dirname, '..', '生成测试', '照片', '用户照片-男.png');

// 输出目录
const OUTPUT_DIR = path.resolve(__dirname, '..', '生成测试', 'api_test_output');

// ─── 工具函数 ───

function toBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (API_KEY) h['x-api-key'] = API_KEY;
  return h;
}

function log(tag, msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${tag}] ${msg}`);
}

// ─── 主流程 ───

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  宝塔部署服务 - 端到端生图测试');
  console.log('='.repeat(60));
  console.log(`  服务器: ${SERVER_BASE}`);
  console.log(`  球星:   ${TEST_STAR_IDS.join(', ')}`);
  console.log(`  场景:   ${TEST_SCENE_ID}`);
  console.log(`  照片:   ${path.basename(USER_PHOTO)}`);
  console.log('='.repeat(60) + '\n');

  // Step 0: 检查用户照片
  if (!fs.existsSync(USER_PHOTO)) {
    console.error(`用户照片不存在: ${USER_PHOTO}`);
    process.exit(1);
  }
  log('准备', `用户照片: ${USER_PHOTO} (${(fs.statSync(USER_PHOTO).size / 1024).toFixed(0)} KB)`);

  // Step 1: 健康检查
  log('健康检查', `GET ${SERVER_BASE}/health`);
  try {
    const healthRes = await axios.get(`${SERVER_BASE}/health`, { timeout: 8000 });
    log('健康检查', `服务正常 ✓`);
    console.log(`          ${JSON.stringify(healthRes.data)}`);
  } catch (err) {
    console.error(`\n服务不可用: ${err.message}`);
    if (err.response) {
      console.error(`HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`);
    }
    console.error('\n请先在宝塔中启动 Node.js 服务，确认 /health 能返回正常。');
    process.exit(1);
  }

  // Step 2: 读取并转换用户照片
  log('准备', '读取用户照片并转 Base64...');
  const userImageBase64 = toBase64(USER_PHOTO);
  log('准备', `Base64 大小: ${(userImageBase64.length / 1024).toFixed(0)} KB`);

  // Step 3: 提交合成任务
  const submitUrl = `${SERVER_BASE}/api/v1/synthesis/submit`;
  const submitBody = {
    star_ids: TEST_STAR_IDS,
    scene_id: TEST_SCENE_ID,
    user_image: userImageBase64,
  };

  log('提交', `POST ${submitUrl}`);
  log('提交', `star_ids: [${TEST_STAR_IDS.join(', ')}]  scene_id: ${TEST_SCENE_ID}`);

  let taskId;
  try {
    const submitStart = Date.now();
    const submitRes = await axios.post(submitUrl, submitBody, {
      headers: headers(),
      timeout: 30000,
    });
    const submitMs = Date.now() - submitStart;

    if (submitRes.data.code !== 0) {
      console.error(`\n提交失败: ${JSON.stringify(submitRes.data)}`);
      process.exit(1);
    }

    taskId = submitRes.data.data.task_id;
    log('提交', `成功 ✓  task_id: ${taskId}  耗时: ${submitMs}ms`);
    log('提交', `status: ${submitRes.data.data.status}`);
  } catch (err) {
    console.error(`\n提交请求失败: ${err.message}`);
    if (err.response) {
      console.error(`HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 300)}`);
    }
    process.exit(1);
  }

  // Step 4: 轮询任务状态
  const queryUrl = `${SERVER_BASE}/api/v1/synthesis/query/${taskId}`;
  log('轮询', `开始查询任务状态，间隔 ${POLL_INTERVAL / 1000}s，超时 ${POLL_TIMEOUT / 1000}s...`);
  console.log();

  const pollStart = Date.now();
  let dots = 0;
  let taskData;

  while (Date.now() - pollStart < POLL_TIMEOUT) {
    // 显示等待进度
    dots = (dots + 1) % 4;
    process.stdout.write(`\r  等待生成中${'.'.repeat(dots)}${' '.repeat(3 - dots)}`);

    try {
      const queryRes = await axios.get(queryUrl, {
        headers: headers(),
        timeout: 10000,
      });

      const status = queryRes.data.data?.status;

      if (status === 'completed') {
        console.log('\r' + ' '.repeat(30) + '\r');
        const elapsed = ((Date.now() - pollStart) / 1000).toFixed(1);
        log('完成', `任务完成 ✓  耗时: ${elapsed}s`);
        taskData = queryRes.data.data;
        break;
      }

      if (status === 'failed') {
        console.log('\r' + ' '.repeat(30) + '\r');
        log('失败', `任务失败: ${queryRes.data.data?.error || '未知错误'}`);
        process.exit(1);
      }
    } catch (err) {
      // 查询接口偶尔超时不致命，继续重试
      if (!err.response || err.response.status >= 500) {
        log('警告', `查询异常: ${err.message}，继续轮询...`);
      }
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  if (!taskData) {
    console.log('\r' + ' '.repeat(30) + '\r');
    log('超时', `等待超过 ${POLL_TIMEOUT / 1000}s，任务可能仍在处理`);
    log('提示', `可手动查询: curl ${queryUrl}`);
    process.exit(1);
  }

  // Step 5: 输出结果
  console.log();
  console.log('─'.repeat(60));
  console.log('  生成结果');
  console.log('─'.repeat(60));
  console.log(`  task_id:     ${taskData.task_id}`);
  console.log(`  status:      ${taskData.status}`);

  if (taskData.results && taskData.results.length > 0) {
    const result = taskData.results[0];
    console.log(`  球星:        ${result.player_names?.join(' / ') || '-'}`);
    console.log(`  图片URL:     ${result.image_url || '-'}`);

    // 下载结果图片
    const imageUrl = result.image_url || (result.urls && result.urls[0]);
    if (imageUrl) {
      try {
        if (!fs.existsSync(OUTPUT_DIR)) {
          fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        log('下载', '正在下载生成图片...');
        const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `e2e_test_${TEST_STAR_IDS.join('_')}_${TEST_SCENE_ID}_${timestamp}.jpg`;
        const outputPath = path.join(OUTPUT_DIR, fileName);

        fs.writeFileSync(outputPath, imgRes.data);
        log('下载', `已保存: ${outputPath} (${(imgRes.data.length / 1024).toFixed(0)} KB)`);
      } catch (dlErr) {
        log('警告', `下载失败: ${dlErr.message}`);
        log('提示', `可手动访问: ${imageUrl}`);
      }
    }

    if (result.user_description) {
      console.log(`  用户描述:    ${result.user_description}`);
    }
  }

  console.log('─'.repeat(60));
  console.log('\n  测试完成！\n');
}

main().catch(err => {
  console.error('\n未捕获错误:', err.message);
  process.exit(1);
});
