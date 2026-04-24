/**
 * 批量测试脚本
 * 测试球星 7/8/9 (Musiala, Neuer, Pavlovic) × 场景 1/2/3/4 共 4 种组合
 * 使用女性成人照片，adult 模式
 *
 * 用法: node test_batch_789_female.js
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVER_URL = `http://localhost:${process.env.PORT || 3000}`;

// 测试参数
const STAR_IDS = ['7', '8', '9']; // Jamal Musiala, Manuel Neuer, Aleksandar Pavlovic
const SCENE_IDS = ['1', '2', '3', '4'];
const USER_MODE = 'adult';
const GENDER = 'female';
const USER_IMAGE_PATH = path.resolve(PROJECT_ROOT, '照片', '用户照片-女.png');

const POLL_INTERVAL = 5000; // 5秒轮询
const POLL_TIMEOUT = 300000; // 5分钟超时
const CONCURRENT_LIMIT = 3; // 并发数

function toBase64(absPath) {
  const buf = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

/**
 * 提交单个合成任务
 */
async function submitTask(sceneId) {
  const userImage = toBase64(USER_IMAGE_PATH);

  const payload = {
    star_ids: STAR_IDS,
    scene_id: sceneId,
    user_image: userImage,
    user_mode: USER_MODE,
    gender: GENDER,
  };

  const response = await axios.post(`${SERVER_URL}/api/v1/synthesis/submit`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  return response.data;
}

/**
 * 轮询任务直到完成
 */
async function pollTask(taskId) {
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT) {
    const response = await axios.get(`${SERVER_URL}/api/v1/synthesis/query/${taskId}`, {
      timeout: 10000,
    });

    const { status, results, error } = response.data.data;

    if (status === 'completed') {
      return { success: true, results };
    }

    if (status === 'failed') {
      return { success: false, error };
    }

    await sleep(POLL_INTERVAL);
  }

  return { success: false, error: '轮询超时' };
}

/**
 * 下载并保存图片
 */
async function downloadImage(url, outputPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });
  fs.writeFileSync(outputPath, response.data);
  return response.data.length;
}

/**
 * 运行单个场景测试
 */
async function runTest(sceneId) {
  const sceneNames = { '1': 'Oktoberfest', '2': 'Locker Room', '3': 'Championship Shower', '4': 'Bernie Mascot' };
  const testLabel = `场景${sceneId}(${sceneNames[sceneId]})`;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`[${timestamp()}] 开始测试: 球星[7,8,9] × ${testLabel}`);

  try {
    // 提交任务
    const submitResult = await submitTask(sceneId);
    const taskId = submitResult.data.task_id;
    console.log(`[${timestamp()}] 任务已提交: ${taskId}`);

    // 轮询结果
    const pollResult = await pollTask(taskId);

    if (pollResult.success) {
      const result = pollResult.results[0];
      const imageUrl = result.image_url;
      const playerNames = result.player_names?.join(', ') || 'unknown';

      // 下载图片
      const outputDir = path.resolve(PROJECT_ROOT, '测试');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const outputFile = path.resolve(outputDir, `球星789_场景${sceneId}_女.png`);
      const fileSize = await downloadImage(imageUrl, outputFile);

      console.log(`[${timestamp()}] ✓ 成功: ${testLabel}`);
      console.log(`  球星: ${playerNames}`);
      console.log(`  图片: ${outputFile} (${(fileSize / 1024).toFixed(0)} KB)`);

      return { sceneId, success: true, file: outputFile, size: fileSize };
    } else {
      console.error(`[${timestamp()}] ✗ 失败: ${testLabel} - ${pollResult.error}`);
      return { sceneId, success: false, error: pollResult.error };
    }
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    console.error(`[${timestamp()}] ✗ 异常: ${testLabel} - ${errMsg}`);
    return { sceneId, success: false, error: errMsg };
  }
}

/**
 * 带并发控制的批量执行
 */
async function runBatch(sceneIds, concurrency) {
  const results = [];
  const queue = [...sceneIds];

  async function worker() {
    while (queue.length > 0) {
      const sceneId = queue.shift();
      const result = await runTest(sceneId);
      results.push(result);
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/**
 * 主函数
 */
async function main() {
  console.log('='.repeat(60));
  console.log('  批量测试：球星[7,8,9] × 场景[1,2,3,4] × 女性成人照片');
  console.log('='.repeat(60));
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`球星: Jamal Musiala, Manuel Neuer, Aleksandar Pavlovic`);
  console.log(`场景: Oktoberfest, Locker Room, Championship Shower, Bernie Mascot`);
  console.log(`用户模式: ${USER_MODE} / ${GENDER}`);
  console.log(`服务器: ${SERVER_URL}`);
  console.log(`并发数: ${CONCURRENT_LIMIT}`);

  // 检查用户照片
  if (!fs.existsSync(USER_IMAGE_PATH)) {
    console.error(`\n✗ 用户照片不存在: ${USER_IMAGE_PATH}`);
    process.exit(1);
  }
  console.log(`用户照片: ${USER_IMAGE_PATH} ✓`);

  // 检查服务器
  try {
    const healthResp = await axios.get(`${SERVER_URL}/health`, { timeout: 5000 });
    console.log(`服务器状态: ${healthResp.data.status} ✓`);
  } catch {
    console.error(`\n✗ 服务器未启动: ${SERVER_URL}`);
    console.error('  请先运行: cd server && npm start');
    process.exit(1);
  }

  // 执行批量测试
  console.log(`\n开始执行 ${SCENE_IDS.length} 个测试（并发: ${CONCURRENT_LIMIT}）`);
  const totalStart = Date.now();

  const results = await runBatch(SCENE_IDS, CONCURRENT_LIMIT);

  // 输出汇总
  const totalTime = ((Date.now() - totalStart) / 1000).toFixed(1);
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log('\n' + '='.repeat(60));
  console.log('  测试结果汇总');
  console.log('='.repeat(60));

  for (const r of results) {
    if (r.success) {
      console.log(`  场景${r.sceneId}: ✓ 成功 (${(r.size / 1024).toFixed(0)} KB)`);
    } else {
      console.log(`  场景${r.sceneId}: ✗ 失败 - ${r.error}`);
    }
  }

  console.log(`\n成功: ${successCount}/${results.length} | 失败: ${failCount}/${results.length}`);
  console.log(`总耗时: ${totalTime}s`);
  console.log('='.repeat(60));

  process.exit(failCount > 0 ? 1 : 0);
}

main();
