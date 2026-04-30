/**
 * Faceswap 场景3 测试脚本（inpainting mask 精准换脸）
 *
 * 流程：
 *   1. 视觉模型检测用户性别 → 选底图
 *   2. 生成精准椭圆 mask（覆盖目标球迷脸部）
 *   3. 调用 Seedream 4.5 inpainting（mask区域换脸，其余像素完全保留）
 *   4. 下载保存结果
 *
 * Mask 坐标（视觉模型核验，底图均为 1122×1402）：
 *   男性底图 scene_03_user2_*: cx=389, cy=357, rx=60, ry=91
 *   女性底图 scene_03_*:       cx=490, cy=500, rx=49, ry=88
 *
 * 用法：
 *   node test-faceswap-scene3-inpaint.js [用户照片路径] [--gender male|female]
 */

const fs   = require('fs');
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
const axios = require(path.join(SERVER_DIR, 'node_modules', 'axios'));

// ============================================================
// 配置
// ============================================================
const RELAY_DIR  = path.join(__dirname, '生成测试', 'relay_test');
const OUTPUT_DIR = path.join(__dirname, '生成测试', 'faceswap_output');
const DEFAULT_USER_PHOTO = 'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/efd3b40c22f3aefc65349fdd4a768d59.jpg';

/**
 * 场景3 模板配置
 * mask: 目标球迷脸部椭圆 mask（视觉模型核验，输入图像素坐标）
 *   cx/cy = 椭圆中心像素坐标（基于底图原始尺寸）
 *   rx/ry = 横轴/纵轴半径
 */
const SCENE3_TEMPLATES = {
  male: {
    file:        'scene3-M.jpg',
    description: '男球迷底图（左数第2位）',
    mask:        { cx: 389, cy: 374, rx: 90, ry: 130 },
  },
  female: {
    file:        'scene3-F.jpg',
    description: '女球迷底图（左数第3位，中间）',
    mask:        { cx: 495, cy: 481, rx: 80, ry: 110 },
  },
};

const DEFAULT_GUIDANCE = 10;
const DEFAULT_SIZE     = '2048x2560';

// ============================================================
// 工具函数
// ============================================================
function toBase64DataUrl(filePath) {
  const p   = filePath.replace(/\\/g, '/');
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
             : ext === 'png' ? 'image/png' : `image/${ext}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const https  = require('https');
    const http   = require('http');
    const client = url.startsWith('https') ? https : http;
    const file   = fs.createWriteStream(dest);
    client.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { try { fs.unlinkSync(dest); } catch(_){} reject(err); });
  });
}

function parseCliArgs(argv) {
  const opts = {
    userPhotoPath: DEFAULT_USER_PHOTO,
    gender: null,
    size: DEFAULT_SIZE,
    guidanceScale: DEFAULT_GUIDANCE,
  };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if      (argv[i] === '--gender')   { opts.gender        = argv[++i] || null; }
    else if (argv[i] === '--size')     { opts.size          = argv[++i] || DEFAULT_SIZE; }
    else if (argv[i] === '--guidance') { opts.guidanceScale = parseFloat(argv[++i]); }
    else if (!argv[i].startsWith('--')) { pos.push(argv[i]); }
  }
  if (pos[0]) opts.userPhotoPath = pos[0];
  return opts;
}

async function detectGender(userImageBase64) {
  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const key = process.env.VISION_API_KEY;
  if (!key) throw new Error('VISION_API_KEY 未配置');
  const res = await axios.post(url, {
    model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: userImageBase64 } },
      { type: 'text', text: 'Look at this person and infer gender presentation conservatively. Reply ONLY one word: "male", "female", or "unknown". Use "unknown" unless visually clear and high-confidence.' },
    ]}],
    max_tokens: 10, temperature: 0.1,
  }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 15000 });
  const answer = (res.data?.choices?.[0]?.message?.content || '').trim().toLowerCase();
  console.log(`[性别检测] 视觉模型返回: "${answer}"`);
  if (answer.includes('female') || answer.includes('woman') || answer.includes('girl')) return 'female';
  if (answer.includes('male')   || answer.includes('man')   || answer.includes('boy'))  return 'male';
  return 'unknown';
}

/**
 * 生成椭圆 inpainting mask（白色=换脸区域，黑色=保留区域）
 * maskCoords 坐标基于 inputW × inputH 像素空间
 * mask 输出尺寸按比例缩放到 outputW × outputH
 */
async function buildMask(inputW, inputH, { cx, cy, rx, ry }, outputW, outputH) {
  const mW = outputW || inputW;
  const mH = outputH || inputH;
  const scaleX = mW / inputW;
  const scaleY = mH / inputH;
  const mcx = Math.round(cx * scaleX);
  const mcy = Math.round(cy * scaleY);
  const mrx = Math.round(rx * scaleX);
  const mry = Math.round(ry * scaleY);
  // 黑色椭圆=换脸区域，白色背景=保留区域（Seedream inpainting 约定：黑=替换）
  const svg = `<svg width="${mW}" height="${mH}"><ellipse cx="${mcx}" cy="${mcy}" rx="${mrx}" ry="${mry}" fill="black"/></svg>`;
  console.log(`         mask 输出坐标: cx=${mcx} cy=${mcy} rx=${mrx} ry=${mry} (${mW}×${mH})`);
  return sharp({
    create: { width: mW, height: mH, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .png()
    .toBuffer();
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const cli = parseCliArgs(process.argv.slice(2));

  const API_URL = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
  const API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
  const MODEL   = process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128';

  console.log('========================================');
  console.log('Faceswap 场景3（Inpainting 精准换脸）');
  console.log('========================================');
  console.log(`用户照片: ${path.basename(cli.userPhotoPath)}`);
  console.log(`模型: ${MODEL}`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Step 1: 读取用户照片
  console.log('\n[Step 1] 读取用户照片...');
  const userBase64 = toBase64DataUrl(cli.userPhotoPath);

  // Step 2: 性别检测
  console.log('\n[Step 2] 性别检测...');
  let gender = cli.gender;
  if (gender) {
    console.log(`[性别检测] 命令行指定: ${gender}`);
  } else {
    try   { gender = await detectGender(userBase64); }
    catch { gender = 'male'; }
    if (gender === 'unknown') { console.log('[性别检测] 无法确定，默认男性'); gender = 'male'; }
  }
  const genderLabel = gender === 'female' ? '女性' : '男性';
  console.log(`[性别检测] 结果: ${genderLabel}`);

  // Step 3: 选择底图
  const tpl          = SCENE3_TEMPLATES[gender];
  const templatePath = path.join(RELAY_DIR, tpl.file);
  console.log(`\n[Step 3] 底图: ${tpl.file}  (${tpl.description})`);
  if (!fs.existsSync(templatePath)) {
    console.error(`底图不存在: ${templatePath}`);
    process.exit(1);
  }

  // Step 3.5: 视觉模型解读外貌
  console.log('\n[Step 3.5] 视觉模型解读外貌...');
  let userDescription = '';
  try {
    const { describeUserAppearance } = require('./server/src/visionClient');
    userDescription = await describeUserAppearance([userBase64]);
    console.log(`外貌描述: ${userDescription.substring(0, 120)}...`);
  } catch (err) {
    console.warn(`视觉模型失败，跳过: ${err.message}`);
  }

  // Step 4: 生成 mask
  console.log('\n[Step 4] 生成 inpainting mask...');
  const imgMeta = await sharp(templatePath).metadata();
  const IMG_W = imgMeta.width;
  const IMG_H = imgMeta.height;
  const { cx, cy, rx, ry } = tpl.mask;
  console.log(`         椭圆: cx=${cx} cy=${cy} rx=${rx} ry=${ry} (底图 ${IMG_W}×${IMG_H})`);
  const [outW, outH] = cli.size.split('x').map(Number);
  const maskBuf = await buildMask(IMG_W, IMG_H, tpl.mask, outW, outH);
  const maskBase64 = 'data:image/png;base64,' + maskBuf.toString('base64');

  // Step 5: 调用 Seedream inpainting
  console.log('\n[Step 5] 调用 Seedream 4.5 inpainting...');
  console.log(`         size: ${cli.size}  guidance: ${cli.guidanceScale}`);

  const appearanceLine = userDescription
    ? `Appearance cues from Image 2: ${userDescription}`
    : '';

  const prompt = [
    'Photorealistic photo. Identity-preserving face-swap edit.',
    'Image 1 is the source photo — reproduce it with maximum fidelity.',
    'Image 2 is the identity reference — replace ONLY the face in the black mask region with the face from Image 2.',
    'Critical: The person in the result must be clearly identifiable as the same person as Image 2.',
    appearanceLine,
    'Preserve face shape, eyes, nose, lips, skin tone, hairstyle, hair length, and hair color from Image 2.',
    'Do NOT carry over the original face from Image 1 — the identity must come entirely from Image 2.',
    'Keep body, pose, clothing, and background from Image 1 exactly unchanged outside the mask.',
    '8K quality, sharp face, photorealistic.',
  ].filter(Boolean).join('\n');

  const negative_prompt = 'blurry face, distorted face, cartoon, changed background, changed clothing, changed pose, identity drift, wrong hairstyle';

  const t0 = Date.now();
  let resultUrl;
  try {
    const res = await axios.post(API_URL, {
      model:           MODEL,
      prompt,
      negative_prompt,
      image:           [toBase64DataUrl(templatePath), userBase64],
      mask_image:      maskBase64,
      strength:        1.0,
      guidance_scale:  cli.guidanceScale,
      response_format: 'url',
      size:            cli.size,
      stream:          false,
    }, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      timeout: 180000,
    });
    resultUrl = res.data?.data?.[0]?.url;
    console.log(`         生成成功 (${((Date.now()-t0)/1000).toFixed(1)}s)`);
  } catch (err) {
    console.error(`         生成失败: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
    process.exit(1);
  }

  // Step 6: 下载结果
  console.log('\n[Step 6] 下载结果...');
  const ts        = Date.now();
  const genderTag = gender === 'female' ? 'F' : 'M';
  const finalFile = path.join(OUTPUT_DIR, `scene3_inpaint_${genderTag}_${ts}.jpg`);
  await downloadFile(resultUrl, finalFile);
  console.log(`         已保存: ${path.basename(finalFile)}`);

  console.log('\n========================================');
  console.log('测试完成');
  console.log('========================================');
  console.log(`用户性别: ${genderLabel}`);
  console.log(`底图: ${tpl.file}`);
  console.log(`Mask: cx=${cx} cy=${cy} rx=${rx} ry=${ry}`);
  console.log(`总耗时: ${((Date.now()-t0)/1000).toFixed(1)}s`);
  console.log(`输出: ${path.basename(finalFile)}`);
}

main().catch(err => {
  console.error('\n测试出错:', err.message);
  process.exit(1);
});
