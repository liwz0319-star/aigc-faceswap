/**
 * 批量测试脚本 — 球星 3/6/9 × 场景 1-4 × 儿童 × 模型 4.5
 * 使用 testRunner 公共模块
 *
 * 用法: node test_native_369_child_v45.js
 */

const path = require('path');
const fs = require('fs');
const {
  toBase64, runBatch, saveResults, printSummary,
  PROJECT_ROOT, API_KEY,
} = require('./testRunner');
const { describeUser } = require('./src/userDescriber');

// ─── 配置 ───
const STAR_IDS = ['3', '6', '9'];
const SCENE_IDS = ['1', '2', '3', '4'];
const USER_MODE = 'child';
const GENDER = 'male';
const USER_IMAGE_PATH = path.resolve(PROJECT_ROOT, '照片', '用户照片-儿童.png');
const OUTPUT_DIR = path.resolve(PROJECT_ROOT, '测试4.5-儿童');
const FILE_PREFIX = '球星369_儿童_v45';
const CONCURRENT_LIMIT = 3;

async function main() {
  console.log('='.repeat(60));
  console.log('  批量测试：球星[3,6,9] × 场景[1-4] × 儿童 × 模型4.5（优化版）');
  console.log('='.repeat(60));
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`球星: Joshua Kimmich, Lennart Karl, Aleksandar Pavlović`);
  console.log(`场景: Oktoberfest, Locker Room, Championship Shower, Bernie Mascot`);
  console.log(`用户: ${USER_MODE} / ${GENDER}`);
  console.log(`并发: ${CONCURRENT_LIMIT}`);
  console.log(`输出: ${OUTPUT_DIR}`);

  if (!API_KEY) {
    console.error('\n✗ SEEDREAM_NATIVE_API_KEY 未配置');
    process.exit(1);
  }
  console.log(`API Key: ${API_KEY.slice(0, 8)}... ✓`);

  if (!fs.existsSync(USER_IMAGE_PATH)) {
    console.error(`\n✗ 用户照片不存在: ${USER_IMAGE_PATH}`);
    process.exit(1);
  }
  console.log(`用户照片: ${USER_IMAGE_PATH} ✓`);

  // 步骤1: 解读用户照片
  console.log('\n' + '─'.repeat(60));
  console.log('[步骤1] 解读用户照片...');
  const t1 = Date.now();
  const userImage = toBase64(USER_IMAGE_PATH);

  let userDescription;
  try {
    userDescription = await describeUser(userImage);
    console.log(`[步骤1] 完成 (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.log(`[步骤1] Vision API 不可用，使用预设描述`);
    userDescription = 'An East Asian male child around 6-8 years old with short black hair, round face, bright dark eyes, small nose, light skin tone, small and slim build';
  }
  console.log(`  描述: ${userDescription}`);

  // 步骤2: 批量测试
  console.log('\n' + '─'.repeat(60));
  console.log(`[步骤2] 开始 ${SCENE_IDS.length} 个场景测试（并发: ${CONCURRENT_LIMIT}）`);
  const totalStart = Date.now();

  const results = await runBatch(SCENE_IDS, CONCURRENT_LIMIT, {
    starIds: STAR_IDS,
    userMode: USER_MODE,
    userImage,
    userDescription,
  });

  // 步骤3: 保存结果
  const savedResults = await saveResults(results, OUTPUT_DIR, FILE_PREFIX);

  // 汇总
  const totalTime = ((Date.now() - totalStart) / 1000).toFixed(1);
  const failCount = printSummary(savedResults, totalTime);

  process.exit(failCount > 0 ? 1 : 0);
}

main();
