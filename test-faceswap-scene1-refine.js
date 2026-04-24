/**
 * Scene1 局部二次精修脚本
 *
 * 用法:
 *   node test-faceswap-scene1-refine.js [基础图路径] [用户照片路径]
 *
 * 默认:
 *   基础图 = 生成测试/faceswap_output/scene1_auto_M_1777043466858.jpg
 *   用户照 = 生成测试/照片/efd3b40c22f3aefc65349fdd4a768d59.jpg
 *
 * 策略:
 *   1. 对基础图裁出包含用户 + 两侧球员 + 上方 logo 的大区域
 *   2. 将裁切区域放大为局部模板
 *   3. 用 Seedream 仅对该局部做身份/发型/身高/logo 精修
 *   4. 将局部结果缩回并覆盖回原图
 */

const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, 'server');

fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

if (!process.env.VISION_API_KEY && process.env.SEEDREAM_NATIVE_API_KEY) {
  process.env.VISION_API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
}

require('module').Module.globalPaths.push(path.join(SERVER_DIR, 'node_modules'));

const sharp = require(path.join(SERVER_DIR, 'node_modules', 'sharp'));
const { generateNativeImage } = require('./server/src/seedreamNativeClient');
const { describeUserAppearance } = require('./server/src/visionClient');

const DEFAULT_BASE_IMAGE = path.join(__dirname, '生成测试', 'faceswap_output', 'scene1_auto_M_1777043466858.jpg');
const DEFAULT_USER_PHOTO = path.join(__dirname, '生成测试', '照片', 'efd3b40c22f3aefc65349fdd4a768d59.jpg');
const OUTPUT_DIR = path.join(__dirname, '生成测试', 'faceswap_output');
const LOG_DIR = path.join(__dirname, '生成测试', 'prompt_logs');

function toBase64DataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'png' ? 'image/png'
      : `image/${ext}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const http = require('http');
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    client.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => {
      try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    });
  });
}

function computeCropBox(width, height) {
  const left = Math.round(width * 0.10);
  const top = Math.round(height * 0.12);
  const cropWidth = Math.round(width * 0.80);
  const cropHeight = Math.round(height * 0.62);

  return {
    left,
    top,
    width: Math.min(cropWidth, width - left),
    height: Math.min(cropHeight, height - top),
  };
}

function buildRefinePrompt(userDescription) {
  return [
    'Photorealistic local crop refinement of a group photo.',
    'Image 1 is the crop template from the already-generated result. Preserve this crop composition with maximum fidelity.',
    'Image 2 is the identity reference of the target person.',
    userDescription ? `Identity details from Image 2: ${userDescription}` : '',
    'Refine ONLY the second person from the left in this crop.',
    'Critical refinement goals:',
    '- The target person must clearly remain the exact same person as Image 2.',
    '- Raise the target person to the same adult standing height as the adjacent players. Match eye-line, shoulder height, torso length, hip height, and leg length to neighboring players.',
    '- Keep realistic adult male proportions. No short body, no compressed torso, no oversized head, no childlike proportions.',
    '- Use the natural hairstyle from Image 2. Keep the real hair silhouette, hairline, volume, and natural side-fringe shape from the user photo.',
    '- Do not turn the hairstyle into a bowl cut, flat cap-like fringe, or stereotyped generic haircut.',
    '- Keep the black-framed glasses from Image 2.',
    '- Keep all other people, clothes, pose, railing, statue, carousel, and environment unchanged.',
    '- The circular PAULANER and FC BAYERN logo signs in the background must be crisp, centered, undistorted, and clearly readable.',
    '- Maintain photorealism, sharp facial detail, and coherent lighting.',
  ].filter(Boolean).join('\n');
}

const REFINE_NEGATIVE_PROMPT = [
  'short body, small body, child proportions, oversized head, compressed torso, short legs,',
  'bowl cut, flat hair, wrong hairline, wrong fringe, wrong parting, stereotyped haircut,',
  'blurry logo, unreadable logo, warped sign, distorted text, broken letters, soft logo,',
  'changed player face, changed clothing, changed background, extra people, missing people,',
  'cartoon, illustration, doll face, beautified face, identity drift, low quality, blur',
].join(' ');

async function main() {
  const baseImagePath = process.argv[2] || DEFAULT_BASE_IMAGE;
  const userPhotoPath = process.argv[3] || DEFAULT_USER_PHOTO;

  if (!fs.existsSync(baseImagePath)) {
    throw new Error(`基础图不存在: ${baseImagePath}`);
  }
  if (!fs.existsSync(userPhotoPath)) {
    throw new Error(`用户照片不存在: ${userPhotoPath}`);
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  console.log('========================================');
  console.log('Scene1 局部二次精修');
  console.log('========================================');
  console.log(`基础图: ${path.basename(baseImagePath)}`);
  console.log(`用户照: ${path.basename(userPhotoPath)}`);

  const metadata = await sharp(baseImagePath).metadata();
  const cropBox = computeCropBox(metadata.width, metadata.height);
  console.log(`[裁切区域] left=${cropBox.left}, top=${cropBox.top}, width=${cropBox.width}, height=${cropBox.height}`);

  const cropBuffer = await sharp(baseImagePath)
    .extract(cropBox)
    .resize(1792, 1792, { fit: 'fill' })
    .jpeg({ quality: 95 })
    .toBuffer();

  const timestamp = Date.now();
  const cropTemplatePath = path.join(OUTPUT_DIR, `scene1_refine_crop_template_${timestamp}.jpg`);
  fs.writeFileSync(cropTemplatePath, cropBuffer);

  let userDescription = '';
  try {
    userDescription = await describeUserAppearance([toBase64DataUrl(userPhotoPath)]);
    console.log(`[视觉描述] ${userDescription.substring(0, 140)}...`);
  } catch (err) {
    console.warn(`[视觉描述] 失败，继续执行: ${err.message}`);
  }

  const prompt = buildRefinePrompt(userDescription);
  console.log('\n========== 局部精修 Prompt ==========');
  console.log(prompt);
  console.log('\n【Negative Prompt】');
  console.log(REFINE_NEGATIVE_PROMPT);
  console.log('====================================\n');

  const t0 = Date.now();
  const result = await generateNativeImage({
    prompt,
    negative_prompt: REFINE_NEGATIVE_PROMPT,
    images: [toBase64DataUrl(cropTemplatePath), toBase64DataUrl(userPhotoPath)],
    size: '2048x2048',
    scene_params: { strength: 0.62, guidance_scale: 10 },
  });

  const refinedCropPath = path.join(OUTPUT_DIR, `scene1_refine_crop_${timestamp}.jpg`);
  await downloadFile(result.url, refinedCropPath);

  const refinedCropBuffer = await sharp(refinedCropPath)
    .resize(cropBox.width, cropBox.height, { fit: 'fill' })
    .toBuffer();

  const compositePath = path.join(OUTPUT_DIR, `scene1_refined_final_${timestamp}.jpg`);
  await sharp(baseImagePath)
    .composite([{ input: refinedCropBuffer, left: cropBox.left, top: cropBox.top }])
    .jpeg({ quality: 95 })
    .toFile(compositePath);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const logPath = path.join(LOG_DIR, `scene1_refine_${timestamp}.json`);
  fs.writeFileSync(logPath, JSON.stringify({
    test_time: new Date().toISOString(),
    base_image: path.basename(baseImagePath),
    user_photo: path.basename(userPhotoPath),
    crop_box: cropBox,
    prompt,
    negative_prompt: REFINE_NEGATIVE_PROMPT,
    api_params: {
      size: '2048x2048',
      strength: 0.62,
      guidance_scale: 10,
    },
    result: {
      elapsed,
      url: result.url,
      cropTemplatePath: path.basename(cropTemplatePath),
      refinedCropPath: path.basename(refinedCropPath),
      compositePath: path.basename(compositePath),
    },
  }, null, 2), 'utf8');

  console.log('========================================');
  console.log('局部精修完成');
  console.log('========================================');
  console.log(`耗时: ${elapsed}s`);
  console.log(`裁切模板: ${path.basename(cropTemplatePath)}`);
  console.log(`局部结果: ${path.basename(refinedCropPath)}`);
  console.log(`最终合成: ${path.basename(compositePath)}`);
  console.log(`日志: ${logPath}`);
}

main().catch(err => {
  console.error('\n局部精修失败:', err.message);
  process.exit(1);
});
