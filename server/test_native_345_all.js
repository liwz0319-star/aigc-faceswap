/**
 * 独立批量测试脚本（native 模式，无需 Redis）
 * 球星 3/4/5 (Kimmich, Kane, Díaz) × 场景 1/2/3/4
 *
 * 用法: node test_native_345_all.js
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
  getPlayerReferenceImages,
  loadCompositionReference,
} = require('./src/assetStore');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── 测试配置 ───
const STAR_IDS = ['3', '4', '5']; // Joshua Kimmich, Harry Kane, Luis Díaz
const SCENE_IDS = ['1', '2', '3', '4'];
const USER_MODE = 'adult';
const GENDER = 'male';
const USER_IMAGE_PATH = path.resolve(PROJECT_ROOT, '生成测试', '照片', 'image.png');

// Native API 配置
const API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
const API_URL = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = process.env.SEEDREAM_NATIVE_MODEL_OVERRIDE || process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128';
const IMAGE_STRENGTH = parseFloat(process.env.SEEDREAM_IMAGE_STRENGTH) || 0.5;
const GUIDANCE_SCALE = parseFloat(process.env.SEEDREAM_GUIDANCE_SCALE) || 8;

const CONCURRENT_LIMIT = 2;
const REQUEST_TIMEOUT = 180000; // 3 分钟
const PROMPT_ONLY = (process.env.PROMPT_ONLY || '').toLowerCase() === 'true';

const scenes = require('./src/data/scenes');

function toBase64(absPath) {
  const buf = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function timestamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

/**
 * 调用 Seedream 官方 API（native 模式）
 */
async function callSeedreamNative({ prompt, images = [], size = '1536x2560', negative_prompt, scene_params = {} }) {
  const strength = scene_params.strength ?? IMAGE_STRENGTH;
  const guidanceScale = scene_params.guidance_scale ?? GUIDANCE_SCALE;
  const sceneNegPrompt = scene_params.negative_prompt || '';
  const combinedNegPrompt = [sceneNegPrompt, negative_prompt].filter(Boolean).join(', ');

  const payload = {
    model: MODEL,
    prompt,
    sequential_image_generation: 'disabled',
    response_format: 'url',
    size,
    stream: false,
    watermark: true,
  };

  if (images.length > 0) {
    payload.image = images;
    payload.strength = strength;
  }

  if (guidanceScale > 0 && !MODEL.includes('5-0')) {
    payload.guidance_scale = guidanceScale;
  }

  if (combinedNegPrompt) {
    payload.negative_prompt = combinedNegPrompt;
  }

  console.log(`  [API] model=${MODEL} | images=${images.length} | size=${size} | strength=${payload.strength || 'N/A'} | guidance=${payload.guidance_scale || 'N/A'}`);

  const response = await axios.post(API_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    timeout: REQUEST_TIMEOUT,
  }).catch(err => {
    const errData = err.response?.data;
    if (errData?.error) {
      const e = errData.error;
      throw new Error(`Seedream API [${e.code || ''}]: ${e.message || JSON.stringify(e)}`);
    }
    throw err;
  });

  const data = response.data;
  if (data.error) {
    throw new Error(`Seedream API [${data.error.code || ''}]: ${data.error.message || JSON.stringify(data.error)}`);
  }
  if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error('Seedream 未返回图片数据');
  }
  const urls = data.data.map(item => item.url).filter(Boolean);
  if (urls.length === 0) {
    throw new Error('Seedream 响应中未找到图片 URL');
  }
  return { url: urls[0], urls };
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
async function runTest(sceneId, userImage, userDescription) {
  const sceneNames = { '1': 'Oktoberfest', '2': 'Locker Room', '3': 'Championship Shower', '4': 'Bernie Mascot' };
  const testLabel = `场景${sceneId}(${sceneNames[sceneId]})`;
  const t0 = Date.now();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${timestamp()}] 开始: 球星[${STAR_IDS.join(',')}] × ${testLabel}`);

  try {
    const scene = scenes[sceneId];
    const nativeParams = scene?.native_params || {};

    // 1. 计算球星参考图索引，拼 Prompt
    const playerRefGroups = getPlayerReferenceImages(STAR_IDS);
    const playerImageMap = {};
    let nextIdx = 2; // image[1]=用户照片，球星从 image[2] 起
    for (const group of playerRefGroups) {
      playerImageMap[group.star_id] = group.refs.map((_, i) => nextIdx + i);
      nextIdx += group.refs.length;
    }

    const { prompt, player_names } = buildAllPrompts(STAR_IDS, sceneId, USER_MODE, userDescription, { nativeMode: true, playerImageMap });
    console.log(`  [Prompt] ${player_names.join(', ')} | ${prompt.length} 字符`);

    // 2. 加载参考图
    const images = [];

    if (PROMPT_ONLY) {
      console.log(`  [模式] PROMPT_ONLY — 不发送任何参考图`);
    } else {
      // 用户照片（身份锚定）
      images.push(userImage);

      // 球星参考图（人脸锚定）
      for (const ref of playerRefGroups) {
        for (const r of ref.refs) {
          images.push(await r.image);
          console.log(`  [球星参考图] ${r.source}`);
        }
      }

      // 场景参考图
      if (!scene?.skip_scene_ref) {
        const refImage = await loadReferenceImage(sceneId, USER_MODE, GENDER);
        if (refImage) {
          images.push(refImage);
        }
      } else {
        console.log(`  [参考图] 场景${sceneId} 跳过人物参考图（skip_scene_ref=true）`);
        const bgImage = await loadBackgroundReference(sceneId);
        if (bgImage) {
          images.push(bgImage);
        }
      }

      // 合照参考图（构图引导）
      const compositionImage = await loadCompositionReference(sceneId);
      if (compositionImage) {
        images.push(compositionImage);
        console.log(`  [合照参考图] 场景${sceneId}`);
      }

      // 球衣参考图
      const jerseyImages = await loadJerseyReferences(sceneId);
      if (jerseyImages.length > 0) {
        images.push(...jerseyImages);
      }

      // 酒杯参考图
      const beerMugImage = await loadBeerMugReference(sceneId);
      if (beerMugImage) {
        images.push(beerMugImage);
      }
    }

    console.log(`  [参考图] 总计: ${images.length} 张`);

    // 3. 调用 Seedream native API
    const sceneSize = scene?.recommended_size || '1536x2560';
    const baseNegPrompt = sceneId === '4'
      ? 'missing person, only 2 players, only 1 player, only 3 humans, player cut off, player missing, hidden player, player not visible, no bernie, missing mascot'
      : 'extra people, additional people, bystanders, crowd, background figures, fifth person, group of 5, more than 4 people';

    const imageResult = await callSeedreamNative({
      prompt,
      negative_prompt: baseNegPrompt,
      images,
      size: sceneSize,
      scene_params: nativeParams,
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    // 4. 下载图片
    const outputDir = path.resolve(PROJECT_ROOT, '生成测试', '测试结果');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const modelTag = MODEL.includes('5-0') ? 'v50' : 'v45';
    const outputFile = path.resolve(outputDir, `球星345_场景${sceneId}_${USER_MODE}_${modelTag}.png`);
    const fileSize = await downloadImage(imageResult.url, outputFile);

    console.log(`[${timestamp()}] ✓ 成功: ${testLabel} (${elapsed}s)`);
    console.log(`  球星: ${player_names.join(', ')}`);
    console.log(`  图片: ${outputFile} (${(fileSize / 1024).toFixed(0)} KB)`);

    return { sceneId, success: true, file: outputFile, size: fileSize, elapsed };

  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[${timestamp()}] ✗ 失败: ${testLabel} (${elapsed}s) - ${err.message}`);
    return { sceneId, success: false, error: err.message, elapsed };
  }
}

/**
 * 带并发控制的批量执行
 */
async function runBatch(sceneIds, concurrency, userImage, userDescription) {
  const results = [];
  const queue = [...sceneIds];

  async function worker() {
    while (queue.length > 0) {
      const sceneId = queue.shift();
      const result = await runTest(sceneId, userImage, userDescription);
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
  const players = require('./src/data/players');
  const playerNames = STAR_IDS.map(id => players[id]?.name || `#${id}`);

  console.log('='.repeat(60));
  console.log(`  Native 模式批量测试：球星[${STAR_IDS.join(',')}] × 全场景`);
  console.log(`  ${PROMPT_ONLY ? '纯 Prompt 模式（无参考图）' : '参考图模式（用户+球星+场景+球衣+酒杯）'}`);
  console.log('='.repeat(60));
  console.log(`时间:     ${new Date().toLocaleString('zh-CN')}`);
  console.log(`模式:     native (Seedream 4.5 官方 API)`);
  console.log(`模型:     ${MODEL}`);
  console.log(`球星:     ${playerNames.join(', ')}`);
  console.log(`场景:     Oktoberfest, Locker Room, Championship Shower, Bernie Mascot`);
  console.log(`用户:     ${USER_MODE} / ${GENDER}`);
  console.log(`并发:     ${CONCURRENT_LIMIT}`);
  console.log(`API:      ${API_URL}`);
  console.log(`strength: ${IMAGE_STRENGTH} | guidance: ${GUIDANCE_SCALE}`);

  // 校验 API Key
  if (!API_KEY) {
    console.error('\n✗ SEEDREAM_NATIVE_API_KEY 未配置');
    process.exit(1);
  }
  console.log(`API Key:  ${API_KEY.slice(0, 8)}... ✓`);

  // 校验用户照片
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
  const userDescription = await describeUser(userImage);
  console.log(`[步骤1] 完成 (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  console.log(`  描述: ${userDescription}`);

  // 步骤2: 批量测试
  console.log('\n' + '─'.repeat(60));
  console.log(`[步骤2] 开始 ${SCENE_IDS.length} 个场景测试（并发: ${CONCURRENT_LIMIT}）`);
  const totalStart = Date.now();

  const results = await runBatch(SCENE_IDS, CONCURRENT_LIMIT, userImage, userDescription);

  // 汇总
  const totalTime = ((Date.now() - totalStart) / 1000).toFixed(1);
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log('\n' + '='.repeat(60));
  console.log('  测试结果汇总 (Native / Seedream 4.5 + 球星参考图)');
  console.log('='.repeat(60));

  for (const r of results) {
    if (r.success) {
      console.log(`  场景${r.sceneId}: ✓ 成功 (${(r.size / 1024).toFixed(0)} KB, ${r.elapsed}s) → ${path.basename(r.file)}`);
    } else {
      console.log(`  场景${r.sceneId}: ✗ 失败 (${r.elapsed}s) - ${r.error}`);
    }
  }

  console.log(`\n成功: ${successCount}/${results.length} | 失败: ${failCount}/${results.length}`);
  console.log(`总耗时: ${totalTime}s`);
  console.log('='.repeat(60));

  process.exit(failCount > 0 ? 1 : 0);
}

main();
