/**
 * 测试运行器公共模块
 * 提供 Seedream native 模式的批量测试基础设施
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { buildAllPrompts } = require('./src/promptBuilder');
const { describeUser } = require('./src/userDescriber');
const {
  loadReferenceImage,
  loadJerseyReferences,
  loadBeerMugReference,
  loadBackgroundReference,
} = require('./src/assetStore');
const { generateNativeImage } = require('./src/seedreamNativeClient');

const scenes = require('./src/data/scenes');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
const API_URL = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

// ─── 工具函数 ───

function toBase64(absPath) {
  const buf = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function timestamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

async function downloadImage(url, outputPath) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });
  fs.writeFileSync(outputPath, response.data);
  return response.data.length;
}

/**
 * 加载指定场景的参考图（按场景配置限制数量）
 * @returns {Promise<string[]>} base64 data URL 数组
 */
async function loadSceneReferences(sceneId, userMode, gender, maxRefImages) {
  const scene = scenes[sceneId];
  const images = [];
  let jerseyBudget = maxRefImages - 2; // 减去用户照片 + 场景参考图

  // 场景参考图
  if (!scene?.skip_scene_ref) {
    const refImage = await loadReferenceImage(sceneId, userMode, gender);
    if (refImage) images.push(refImage);
  } else {
    const bgImage = await loadBackgroundReference(sceneId);
    if (bgImage) images.push(bgImage);
  }

  // 球衣参考图（受数量限制）
  if (jerseyBudget > 0) {
    const jerseyImages = await loadJerseyReferences(sceneId, jerseyBudget);
    images.push(...jerseyImages);
    jerseyBudget -= jerseyImages.length;
  }

  // 酒杯参考图（有剩余配额时才加）
  if (jerseyBudget >= 0) {
    const beerMugImage = await loadBeerMugReference(sceneId);
    if (beerMugImage) images.push(beerMugImage);
  }

  return images;
}

/**
 * 运行单个场景测试
 */
async function runSingleTest({ sceneId, starIds, userMode, userImage, userDescription }) {
  const sceneNames = {
    '1': 'Oktoberfest',
    '2': 'Locker Room',
    '3': 'Championship Shower',
    '4': 'Bernie Mascot',
  };
  const testLabel = `场景${sceneId}(${sceneNames[sceneId]})`;
  const t0 = Date.now();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${timestamp()}] 开始: 球星[${starIds.join(',')}] × ${testLabel}`);

  try {
    const scene = scenes[sceneId];
    const nativeParams = scene?.native_params || {};
    const maxRef = nativeParams.max_ref_images || 5;

    // 1. 拼 Prompt（已包含 native_params）
    const { prompt, player_names, native_params } = buildAllPrompts(
      starIds, sceneId, userMode, userDescription, { nativeMode: true }
    );
    console.log(`  [Prompt] ${player_names.join(', ')} | ${prompt.length} 字符`);

    // 2. 加载参考图（受 max_ref_images 限制）
    const refImages = await loadSceneReferences(sceneId, userMode, 'male', maxRef);
    const allImages = [userImage, ...refImages];
    console.log(`  [参考图] 总计: ${allImages.length} 张 (用户1 + 参考${refImages.length})`);

    // 3. 调用 Seedream API
    const sceneSize = scene?.recommended_size || '1536x2560';
    const imageResult = await generateNativeImage({
      prompt,
      images: allImages,
      size: sceneSize,
      scene_params: native_params,
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    return {
      sceneId,
      success: true,
      url: imageResult.url,
      elapsed: parseFloat(elapsed),
      player_names,
      native_params,
    };
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[${timestamp()}] ✗ 失败: ${testLabel} (${elapsed}s) - ${err.message}`);
    return { sceneId, success: false, error: err.message, elapsed: parseFloat(elapsed) };
  }
}

/**
 * 带并发控制的批量执行
 */
async function runBatch(sceneIds, concurrency, testConfig) {
  const results = [];
  const queue = [...sceneIds];

  async function worker() {
    while (queue.length > 0) {
      const sceneId = queue.shift();
      const result = await runSingleTest({ sceneId, ...testConfig });
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
 * 下载并保存结果图片
 */
async function saveResults(results, outputDir, filePrefix) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const savedResults = [];
  for (const r of results) {
    if (!r.success) {
      savedResults.push(r);
      continue;
    }
    const outputFile = path.resolve(outputDir, `${filePrefix}_场景${r.sceneId}.png`);
    const fileSize = await downloadImage(r.url, outputFile);
    console.log(`  已保存: ${outputFile} (${(fileSize / 1024).toFixed(0)} KB)`);
    savedResults.push({ ...r, file: outputFile, size: fileSize });
  }
  return savedResults;
}

/**
 * 打印汇总
 */
function printSummary(results, totalTime) {
  console.log('\n' + '='.repeat(60));
  console.log('  测试结果汇总');
  console.log('='.repeat(60));

  for (const r of results) {
    if (r.success) {
      const sizeStr = r.size ? `(${(r.size / 1024).toFixed(0)} KB, ` : '(';
      console.log(`  场景${r.sceneId}: ✓ 成功 (${r.elapsed}s) → ${path.basename(r.file)}`);
    } else {
      console.log(`  场景${r.sceneId}: ✗ 失败 (${r.elapsed}s) - ${r.error}`);
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  console.log(`\n成功: ${successCount}/${results.length} | 失败: ${failCount}/${results.length}`);
  console.log(`总耗时: ${totalTime}s`);
  console.log('='.repeat(60));

  return failCount;
}

// ─── 导出 ───

module.exports = {
  toBase64,
  timestamp,
  downloadImage,
  loadSceneReferences,
  runSingleTest,
  runBatch,
  saveResults,
  printSummary,
  PROJECT_ROOT,
  API_KEY,
  API_URL,
  scenes,
};
