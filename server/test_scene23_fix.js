/**
 * 场景2+场景3 修复测试
 * 球星 3/4/5 × 场景2(人脸修复) + 场景3(双手举杯修复) × adult
 *
 * 用法: node test_scene23_fix.js
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

const STAR_IDS = ['3', '4', '5'];
const SCENE_IDS = ['2', '3'];
const USER_MODE = 'adult';
const GENDER = 'male';
const USER_IMAGE_PATH = path.resolve(PROJECT_ROOT, '生成测试', '照片', 'image.png');

const API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
const API_URL = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128';
const IMAGE_STRENGTH = parseFloat(process.env.SEEDREAM_IMAGE_STRENGTH) || 0.5;
const GUIDANCE_SCALE = parseFloat(process.env.SEEDREAM_GUIDANCE_SCALE) || 8;
const REQUEST_TIMEOUT = 180000;

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

async function downloadImage(url, outputPath) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  fs.writeFileSync(outputPath, response.data);
  return response.data.length;
}

async function runTest(sceneId, userImage, userDescription) {
  const sceneNames = { '1': 'Oktoberfest', '2': 'Locker Room', '3': 'Championship Shower', '4': 'Bernie Mascot' };
  const testLabel = `场景${sceneId}(${sceneNames[sceneId]})`;
  const t0 = Date.now();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${timestamp()}] 开始: ${testLabel}`);

  try {
    const scene = scenes[sceneId];
    const nativeParams = scene?.native_params || {};

    const playerRefGroups = getPlayerReferenceImages(STAR_IDS);
    const playerImageMap = {};
    let nextIdx = 2;
    for (const group of playerRefGroups) {
      playerImageMap[group.star_id] = group.refs.map((_, i) => nextIdx + i);
      nextIdx += group.refs.length;
    }

    const { prompt, player_names } = buildAllPrompts(STAR_IDS, sceneId, USER_MODE, userDescription, { nativeMode: true, playerImageMap });
    console.log(`  [Prompt] ${player_names.join(', ')} | ${prompt.length} 字符`);

    const images = [];
    images.push(userImage);

    for (const group of playerRefGroups) {
      for (const r of group.refs) {
        images.push(await r.image);
        console.log(`  ✓ 球星: ${r.source}`);
      }
    }

    if (!scene?.skip_scene_ref) {
      const refImage = await loadReferenceImage(sceneId, USER_MODE, GENDER);
      if (refImage) { images.push(refImage); console.log('  ✓ 场景参考图'); }
    } else {
      console.log('  ○ 跳过场景参考图');
      const bgImage = await loadBackgroundReference(sceneId);
      if (bgImage) { images.push(bgImage); console.log('  ✓ 背景参考图'); }
    }

    const compositionImage = await loadCompositionReference(sceneId);
    if (compositionImage) { images.push(compositionImage); console.log('  ✓ 合照参考图'); }

    const jerseyImages = await loadJerseyReferences(sceneId);
    if (jerseyImages.length > 0) { images.push(...jerseyImages); console.log(`  ✓ 球衣: ${jerseyImages.length}张`); }

    const beerMugImage = await loadBeerMugReference(sceneId);
    if (beerMugImage) { images.push(beerMugImage); console.log('  ✓ 酒杯参考图'); }

    console.log(`  参考图总计: ${images.length} 张`);

    const sceneSize = scene?.recommended_size || '1536x2560';
    const baseNegPrompt = sceneId === '4'
      ? 'missing person, only 2 players, only 1 player, only 3 humans, player cut off, player missing'
      : 'extra people, additional people, bystanders, crowd, background figures, fifth person, group of 5, more than 4 people';

    const imageResult = await callSeedreamNative({
      prompt,
      negative_prompt: baseNegPrompt,
      images,
      size: sceneSize,
      scene_params: nativeParams,
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const outputDir = path.resolve(PROJECT_ROOT, '生成测试', '测试结果');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const modelTag = MODEL.includes('5-0') ? 'v50' : 'v45';
    const outputFile = path.resolve(outputDir, `球星345_场景${sceneId}_${USER_MODE}_${modelTag}_fix2.png`);
    const fileSize = await downloadImage(imageResult.url, outputFile);

    console.log(`[${timestamp()}] ✓ 成功: ${testLabel} (${elapsed}s) → ${path.basename(outputFile)} (${(fileSize / 1024).toFixed(0)} KB)`);
    return { sceneId, success: true, file: outputFile, size: fileSize, elapsed };

  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[${timestamp()}] ✗ 失败: ${testLabel} (${elapsed}s) - ${err.message}`);
    return { sceneId, success: false, error: err.message, elapsed };
  }
}

async function main() {
  const players = require('./src/data/players');
  const playerNames = STAR_IDS.map(id => players[id]?.name || `#${id}`);

  console.log('='.repeat(60));
  console.log(`  场景2+3 修复测试：球星[${STAR_IDS.join(',')}]`);
  console.log('  场景2: 人脸锚定修复');
  console.log('  场景3: 双手举杯+身高修复');
  console.log('='.repeat(60));

  if (!API_KEY) { console.error('✗ API Key 未配置'); process.exit(1); }
  if (!fs.existsSync(USER_IMAGE_PATH)) { console.error(`✗ 照片不存在`); process.exit(1); }

  console.log('\n[步骤1] 解读用户照片...');
  const userImage = toBase64(USER_IMAGE_PATH);

  let userDescription;
  try {
    userDescription = await describeUser(userImage);
    console.log(`  描述(API): ${userDescription}`);
  } catch (err) {
    // LAS API 连接失败时使用缓存描述
    userDescription = 'An East Asian male in his late 40s to early 50s with short, slightly wavy black hair, an oval face, dark brown almond-shaped eyes, a medium-sized straight nose, thin lips with a slight smile, light to medium olive skin tone, and an average build.';
    console.log(`  描述(缓存): ${userDescription}`);
    console.log(`  原因: ${err.message}`);
  }

  console.log('\n[步骤2] 开始测试...');
  const results = [];
  for (const sceneId of SCENE_IDS) {
    const result = await runTest(sceneId, userImage, userDescription);
    results.push(result);
  }

  console.log('\n' + '='.repeat(60));
  for (const r of results) {
    if (r.success) {
      console.log(`  场景${r.sceneId}: ✓ (${(r.size / 1024).toFixed(0)} KB, ${r.elapsed}s) → ${path.basename(r.file)}`);
    } else {
      console.log(`  场景${r.sceneId}: ✗ (${r.elapsed}s) - ${r.error}`);
    }
  }
  console.log('='.repeat(60));

  process.exit(results.some(r => !r.success) ? 1 : 0);
}

main();
