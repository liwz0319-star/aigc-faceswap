/**
 * 批量测试脚本 - 模型 4.5
 * 测试球星 3/6/9 (Kimmich, Karl, Pavlovic) × 场景 1/2/3/4 共 4 种组合
 * 使用儿童照片，child 模式
 *
 * 用法: node test_batch_369_child_v45.js
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVER_URL = `http://localhost:${process.env.PORT || 3000}`;

// 测试参数
const STAR_IDS = ['3', '6', '9']; // Joshua Kimmich, Lennart Karl, Aleksandar Pavlovic
const SCENE_IDS = ['1', '2', '3', '4'];
const USER_MODE = 'child';
const GENDER = 'male';
const USER_IMAGE_PATH = path.resolve(PROJECT_ROOT, '照片', '用户照片-儿童.png');
const OUTPUT_DIR = path.resolve(PROJECT_ROOT, '测试4.5-儿童');
const MODEL_TAG = 'v45';

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

async function downloadImage(url, outputPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });
  fs.writeFileSync(outputPath, response.data);
  return response.data.length;
}

async function runTest(sceneId) {
  const sceneNames = { '1': 'Oktoberfest', '2': 'Locker Room', '3': 'Championship Shower', '4': 'Bernie Mascot' };
  const testLabel = `场景${sceneId}(${sceneNames[sceneId]})`;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`[${timestamp()}] 开始测试: 球星[3,6,9] × ${testLabel}`);

  try {
    const submitResult = await submitTask(sceneId);
    const taskId = submitResult.data.task_id;
    console.log(`[${timestamp()}] 任务已提交: ${taskId}`);

    const pollResult = await pollTask(taskId);

    if (pollResult.success) {
      const result = pollResult.results[0];
      const imageUrl = result.image_url;
      const playerNames = result.player_names?.join(', ') || 'unknown';

      if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      }

      const outputFile = path.resolve(OUTPUT_DIR, `球星369_场景${sceneId}_儿童_${MODEL_TAG}.png`);
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

async function main() {
  console.log('='.repeat(60));
  console.log('  批量测试：球星[3,6,9] × 场景[1,2,3,4] × 儿童照片 × 模型4.5');
  console.log('='.repeat(60));
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`球星: Joshua Kimmich, Lennart Karl, Aleksandar Pavlovic`);
  console.log(`场景: Oktoberfest, Locker Room, Championship Shower, Bernie Mascot`);
  console.log(`用户模式: ${USER_MODE} / ${GENDER}`);
  console.log(`模型: ${process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128'}`);
  console.log(`服务器: ${SERVER_URL}`);
  console.log(`输出目录: ${OUTPUT_DIR}`);
  console.log(`并发数: ${CONCURRENT_LIMIT}`);

  if (!fs.existsSync(USER_IMAGE_PATH)) {
    console.error(`\n✗ 用户照片不存在: ${USER_IMAGE_PATH}`);
    process.exit(1);
  }
  console.log(`用户照片: ${USER_IMAGE_PATH} ✓`);

  try {
    const healthResp = await axios.get(`${SERVER_URL}/health`, { timeout: 5000 });
    console.log(`服务器状态: ${healthResp.data.status} ✓`);
  } catch {
    console.error(`\n✗ 服务器未启动: ${SERVER_URL}`);
    console.error('  请先运行: cd server && npm start');
    process.exit(1);
  }

  console.log(`\n开始执行 ${SCENE_IDS.length} 个测试（并发: ${CONCURRENT_LIMIT}）`);
  const totalStart = Date.now();

  const results = await runBatch(SCENE_IDS, CONCURRENT_LIMIT);

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
