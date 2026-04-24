/**
 * 场景3专项修复测试
 * 球星 3/4/5 × 场景3 (Championship Shower) × adult
 *
 * 用法: node test_scene3_fix.js
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { buildAllPrompts } = require('./src/promptBuilder');
const { describeUser } = require('./src/userDescriber');
const {
  loadJerseyReferences,
  loadBeerMugReference,
  loadBackgroundReference,
  getPlayerReferenceImages,
  loadCompositionReference,
} = require('./src/assetStore');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const STAR_IDS = ['3', '4', '5'];
const SCENE_ID = '3';
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

async function main() {
  const players = require('./src/data/players');
  const playerNames = STAR_IDS.map(id => players[id]?.name || `#${id}`);
  const scene = scenes[SCENE_ID];
  const nativeParams = scene?.native_params || {};

  console.log('='.repeat(60));
  console.log(`  场景3 修复测试：球星[${STAR_IDS.join(',')}] × Championship Shower`);
  console.log('='.repeat(60));
  console.log(`时间:     ${new Date().toLocaleString('zh-CN')}`);
  console.log(`模型:     ${MODEL}`);
  console.log(`球星:     ${playerNames.join(', ')}`);
  console.log(`用户:     ${USER_MODE} / ${GENDER}`);

  if (!API_KEY) { console.error('\n✗ API Key 未配置'); process.exit(1); }
  if (!fs.existsSync(USER_IMAGE_PATH)) { console.error(`\n✗ 照片不存在: ${USER_IMAGE_PATH}`); process.exit(1); }

  // 步骤1: 解读用户照片
  console.log('\n[步骤1] 解读用户照片...');
  const userImage = toBase64(USER_IMAGE_PATH);

  let userDescription;
  try {
    userDescription = await describeUser(userImage);
    console.log(`  描述(API): ${userDescription}`);
  } catch (err) {
    userDescription = 'An East Asian male in his late 40s to early 50s with short, slightly wavy black hair, an oval face, dark brown almond-shaped eyes, a medium-sized straight nose, thin lips with a slight smile, clean-shaven with no beard or stubble, light to medium olive skin tone, and an average build.';
    console.log(`  描述(缓存): ${userDescription}`);
    console.log(`  原因: ${err.message}`);
  }

  // 步骤2: 拼装 Prompt
  console.log('\n[步骤2] 拼装 Prompt...');
  const playerRefGroups = getPlayerReferenceImages(STAR_IDS);
  const playerImageMap = {};
  let nextIdx = 2;
  for (const group of playerRefGroups) {
    playerImageMap[group.star_id] = group.refs.map((_, i) => nextIdx + i);
    nextIdx += group.refs.length;
  }

  const { prompt, player_names } = buildAllPrompts(STAR_IDS, SCENE_ID, USER_MODE, userDescription, { nativeMode: true, playerImageMap });
  console.log(`  球星: ${player_names.join(', ')} | Prompt: ${prompt.length} 字符`);

  // 打印 Prompt 中的 ACTION 部分用于检查
  const actionMatch = prompt.match(/ACTION:\n([\s\S]*?)(?:\n\n|$)/);
  if (actionMatch) {
    console.log(`\n  ─── ACTION 内容 ───`);
    console.log(`  ${actionMatch[1].split('\n').join('\n  ')}`);
    console.log(`  ───────────────────\n`);
  }

  // 步骤3: 加载参考图
  console.log('[步骤3] 加载参考图...');
  const images = [];

  images.push(userImage);
  console.log('  ✓ 用户照片');

  for (const group of playerRefGroups) {
    for (const r of group.refs) {
      images.push(await r.image);
      console.log(`  ✓ 球星参考图: ${r.source}`);
    }
  }

  console.log('  ○ 跳过场景参考图（skip_scene_ref=true）');
  const bgImage = await loadBackgroundReference(SCENE_ID);
  if (bgImage) { images.push(bgImage); console.log('  ✓ 背景参考图'); }

  const compositionImage = await loadCompositionReference(SCENE_ID);
  if (compositionImage) { images.push(compositionImage); console.log('  ✓ 合照参考图'); }

  const jerseyImages = await loadJerseyReferences(SCENE_ID);
  if (jerseyImages.length > 0) { images.push(...jerseyImages); console.log(`  ✓ 球衣参考图: ${jerseyImages.length} 张`); }

  const beerMugImage = await loadBeerMugReference(SCENE_ID);
  if (beerMugImage) { images.push(beerMugImage); console.log('  ✓ 酒杯参考图'); }

  console.log(`  参考图总计: ${images.length} 张`);

  // 步骤4: 调用 API
  const t0 = Date.now();
  console.log('\n[步骤4] 调用 Seedream API...');

  const baseNegPrompt = 'extra people, additional people, bystanders, crowd, background figures, fifth person, group of 5, more than 4 people';

  const imageResult = await callSeedreamNative({
    prompt,
    negative_prompt: baseNegPrompt,
    images,
    size: scene?.recommended_size || '1536x2560',
    scene_params: nativeParams,
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // 步骤5: 下载
  const outputDir = path.resolve(PROJECT_ROOT, '生成测试', '测试结果');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const modelTag = MODEL.includes('5-0') ? 'v50' : 'v45';
  const outputFile = path.resolve(outputDir, `球星345_场景3_${USER_MODE}_${modelTag}_fix6.png`);
  const fileSize = await downloadImage(imageResult.url, outputFile);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ✓ 场景3 修复版生成成功 (${elapsed}s)`);
  console.log(`  球星: ${player_names.join(', ')}`);
  console.log(`  图片: ${outputFile} (${(fileSize / 1024).toFixed(0)} KB)`);
  console.log(`${'='.repeat(60)}`);

  process.exit(0);
}

main();
