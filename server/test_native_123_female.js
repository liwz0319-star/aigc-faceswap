/**
 * 测试脚本：球星 1/2/3 (Davies, Olise, Kimmich) × 场景 1/2/3/4 × 女性成人
 * 用户照片：用户照片-女.png
 *
 * 用法: node test_native_123_female.js
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
  loadCompositionReference,
  getPlayerReferenceImages,
} = require('./src/assetStore');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── 测试配置 ───
const STAR_IDS    = ['1', '2', '3']; // Alphonso Davies, Michael Olise, Joshua Kimmich
const SCENE_IDS   = ['1', '2', '3', '4'];
const USER_MODE   = 'adult';
const GENDER      = 'female';
const USER_IMAGE_PATH = path.resolve(PROJECT_ROOT, '生成测试', '照片', '用户照片-女.png');

// API 配置（读自 .env）
const API_KEY       = process.env.SEEDREAM_NATIVE_API_KEY;
const API_URL       = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL         = process.env.SEEDREAM_NATIVE_MODEL_OVERRIDE || process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128';
const IMAGE_STRENGTH = parseFloat(process.env.SEEDREAM_IMAGE_STRENGTH) || 0.5;
const GUIDANCE_SCALE = parseFloat(process.env.SEEDREAM_GUIDANCE_SCALE) || 8;

const CONCURRENT_LIMIT = 2;
const REQUEST_TIMEOUT  = 180000;
const PROMPT_ONLY      = (process.env.PROMPT_ONLY || '').toLowerCase() === 'true';

const scenes = require('./src/data/scenes');

function toBase64(absPath) {
  const buf  = fs.readFileSync(absPath);
  const ext  = path.extname(absPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function timestamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

async function callSeedreamNative({ prompt, images = [], size = '1536x2560', negative_prompt, scene_params = {} }) {
  const strength     = scene_params.strength     ?? IMAGE_STRENGTH;
  const guidanceScale = scene_params.guidance_scale ?? GUIDANCE_SCALE;
  const sceneNeg     = scene_params.negative_prompt || '';
  const combinedNeg  = [sceneNeg, negative_prompt].filter(Boolean).join(', ');

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
    payload.image    = images;
    payload.strength = strength;
  }
  if (guidanceScale > 0 && !MODEL.includes('5-0')) {
    payload.guidance_scale = guidanceScale;
  }
  if (combinedNeg) {
    payload.negative_prompt = combinedNeg;
  }

  console.log(`  [API] images=${images.length} | strength=${payload.strength ?? 'N/A'} | guidance=${payload.guidance_scale ?? 'N/A'}`);

  const response = await axios.post(API_URL, payload, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    timeout: REQUEST_TIMEOUT,
  }).catch(err => {
    const e = err.response?.data?.error;
    if (e) throw new Error(`Seedream [${e.code || ''}]: ${e.message || JSON.stringify(e)}`);
    throw err;
  });

  const data = response.data;
  if (data.error) throw new Error(`Seedream [${data.error.code}]: ${data.error.message}`);
  if (!data.data?.length) throw new Error('Seedream 未返回图片数据');
  const urls = data.data.map(i => i.url).filter(Boolean);
  if (!urls.length) throw new Error('未找到图片 URL');
  return { url: urls[0], urls };
}

async function downloadImage(url, outputPath) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  fs.writeFileSync(outputPath, res.data);
  return res.data.length;
}

async function runTest(sceneId, userImage, userDescription) {
  const sceneNames = { '1': 'Oktoberfest', '2': 'Locker Room', '3': 'Beer Shower', '4': 'Bernie Mascot' };
  const label = `场景${sceneId}(${sceneNames[sceneId]})`;
  const t0 = Date.now();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${timestamp()}] 开始: 球星[${STAR_IDS.join(',')}] × ${label}`);

  try {
    const scene = scenes[sceneId];

    // 1. 先确定球星参考图分组及索引，再构建 Prompt
    // （getPlayerReferenceImages 同步检查文件存在性，实际图片加载在下方 await）
    const playerRefGroups = getPlayerReferenceImages(STAR_IDS);
    // 计算每名球星参考图的 1-based 索引（image[1]=用户照片，球星从 image[2] 起）
    const playerImageMap = {};
    let nextIdx = 2;
    for (const group of playerRefGroups) {
      playerImageMap[group.star_id] = group.refs.map((_, i) => nextIdx + i);
      nextIdx += group.refs.length;
    }

    const { prompt, player_names } = buildAllPrompts(STAR_IDS, sceneId, USER_MODE, userDescription, { nativeMode: true, playerImageMap });
    console.log(`  [Prompt] ${player_names.join(', ')} | ${prompt.length} 字符`);

    // 2. 加载参考图
    const images = [];

    if (PROMPT_ONLY) {
      console.log('  [模式] PROMPT_ONLY');
    } else {
      // 用户照片（image[1]）
      images.push(userImage);

      // 球星参考图（按分组顺序 await，保证与索引一致）
      for (const group of playerRefGroups) {
        for (const ref of group.refs) {
          images.push(await ref.image);
          console.log(`  [球星] ${ref.source}`);
        }
      }

      // 场景参考图
      if (!scene?.skip_scene_ref) {
        const refImg = await loadReferenceImage(sceneId, USER_MODE, GENDER);
        if (refImg) { images.push(refImg); console.log(`  [场景参考图] 场景${sceneId}-女`); }
      } else {
        console.log(`  [场景参考图] 跳过（skip_scene_ref=true）`);
        const bgImg = await loadBackgroundReference(sceneId);
        if (bgImg) { images.push(bgImg); console.log(`  [背景参考图] 已加载`); }
      }

      // 合照参考图
      const compImg = await loadCompositionReference(sceneId);
      if (compImg) { images.push(compImg); console.log(`  [合照参考图] 场景${sceneId}`); }

      // 球衣参考图
      const jerseyImgs = await loadJerseyReferences(sceneId);
      if (jerseyImgs.length) { images.push(...jerseyImgs); console.log(`  [球衣] ${jerseyImgs.length} 张`); }

      // 酒杯参考图
      const mugImg = await loadBeerMugReference(sceneId);
      if (mugImg) { images.push(mugImg); console.log(`  [酒杯] 已加载`); }
    }

    console.log(`  [参考图] 总计 ${images.length} 张`);

    // 3. 调用 API
    const nativeParams = scene?.native_params || {};
    const baseNegPrompt = sceneId === '4'
      ? 'missing person, only 2 players, only 1 player, only 3 humans, player cut off, player missing, hidden player, player not visible, no bernie, missing mascot'
      : 'extra people, additional people, bystanders, crowd, background figures, fifth person, group of 5, more than 4 people';
    const imageResult = await callSeedreamNative({
      prompt,
      negative_prompt: baseNegPrompt,
      images,
      size: scene?.recommended_size || '1536x2560',
      scene_params: nativeParams,
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    // 4. 保存
    const outputDir = path.resolve(PROJECT_ROOT, '生成测试', '结果', '球星123女');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const modelTag  = MODEL.includes('5-0') ? 'v50' : 'v45';
    const modeTag   = PROMPT_ONLY ? '_纯prompt' : '';
    const outputFile = path.resolve(outputDir, `球星${STAR_IDS.join('')}_场景${sceneId}_女_${modelTag}${modeTag}.png`);
    const fileSize  = await downloadImage(imageResult.url, outputFile);

    console.log(`[${timestamp()}] ✓ ${label} (${elapsed}s, ${(fileSize / 1024).toFixed(0)} KB)`);
    console.log(`  → ${outputFile}`);
    return { sceneId, success: true, file: outputFile, size: fileSize, elapsed };

  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[${timestamp()}] ✗ ${label} (${elapsed}s) — ${err.message}`);
    return { sceneId, success: false, error: err.message, elapsed };
  }
}

async function runBatch(sceneIds, concurrency, userImage, userDescription) {
  const results = [];
  const queue   = [...sceneIds];
  const worker  = async () => {
    while (queue.length) results.push(await runTest(queue.shift(), userImage, userDescription));
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function main() {
  const players     = require('./src/data/players');
  const playerNames = STAR_IDS.map(id => players[id]?.name || `#${id}`);

  console.log('='.repeat(60));
  console.log(`  球星[${STAR_IDS.join(',')}] × 全场景 × 女性成人`);
  console.log(`  球星: ${playerNames.join(', ')}`);
  console.log('='.repeat(60));
  console.log(`模型:     ${MODEL}`);
  console.log(`API:      ${API_URL}`);
  console.log(`并发:     ${CONCURRENT_LIMIT}`);

  if (!API_KEY) { console.error('✗ SEEDREAM_NATIVE_API_KEY 未配置'); process.exit(1); }
  console.log(`API Key:  ${API_KEY.slice(0, 8)}... ✓`);

  if (!fs.existsSync(USER_IMAGE_PATH)) { console.error(`✗ 用户照片不存在: ${USER_IMAGE_PATH}`); process.exit(1); }
  console.log(`用户照片: ${USER_IMAGE_PATH} ✓`);

  console.log('\n' + '─'.repeat(60));
  console.log('[步骤1] 解读用户照片...');
  const t1 = Date.now();
  const userImage       = toBase64(USER_IMAGE_PATH);
  const userDescription = await describeUser(userImage);
  console.log(`[步骤1] 完成 (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  console.log(`  描述: ${userDescription}`);

  console.log('\n' + '─'.repeat(60));
  console.log(`[步骤2] 开始 ${SCENE_IDS.length} 个场景（并发: ${CONCURRENT_LIMIT}）`);
  const totalStart = Date.now();
  const results    = await runBatch(SCENE_IDS, CONCURRENT_LIMIT, userImage, userDescription);
  const totalTime  = ((Date.now() - totalStart) / 1000).toFixed(1);

  const ok   = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;

  console.log('\n' + '='.repeat(60));
  console.log('  测试结果汇总');
  console.log('='.repeat(60));
  for (const r of results.sort((a, b) => +a.sceneId - +b.sceneId)) {
    if (r.success) console.log(`  场景${r.sceneId}: ✓ (${(r.size/1024).toFixed(0)} KB, ${r.elapsed}s)`);
    else           console.log(`  场景${r.sceneId}: ✗ ${r.error}`);
  }
  console.log(`\n成功: ${ok}/${results.length} | 总耗时: ${totalTime}s`);
  console.log('='.repeat(60));
  process.exit(fail > 0 ? 1 : 0);
}

main();
