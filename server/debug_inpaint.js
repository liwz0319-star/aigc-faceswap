/**
 * 调试用：保存实际发送给 API 的 mask 图，并用男性模板跑一次 inpainting
 */
const fs   = require('fs');
const path = require('path');

fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

const sharp = require('./node_modules/sharp');
const axios = require('./node_modules/axios');

const RELAY_DIR  = path.join(__dirname, '..', '生成测试', 'relay_test');
const OUT_DIR    = path.join(__dirname, '..', '生成测试', 'faceswap_output');
const TEMP_DIR   = path.join(__dirname, '..', '生成测试', 'faceswap_temp');
const PHOTO_DIR  = path.join(__dirname, '..', '生成测试', '照片');

// ── 男性模板（用于对照）──
const MALE_TPL  = path.join(RELAY_DIR, 'scene_02_user2_1777014143898.png');
const MALE_MASK = { cx: 670, cy: 380, rx: 90, ry: 130 };

// ── 女性模板 ──
const FEM_TPL   = path.join(RELAY_DIR, 'scene_02_1777013168257.png');
const FEM_MASK  = { cx: 700, cy: 470, rx: 90, ry: 130 };  // 网格图实测

const USER_FEMALE = path.join(PHOTO_DIR, 'bf65a794b1a8f7ed67b6d97bfb9ab88e.jpg');
const USER_MALE   = path.join(PHOTO_DIR, 'efd3b40c22f3aefc65349fdd4a768d59.jpg');

const API_URL = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
const MODEL   = process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128';

function toB64(filePath) {
  const buf  = fs.readFileSync(filePath);
  const ext  = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return 'data:' + mime + ';base64,' + buf.toString('base64');
}

async function buildMask(templatePath, maskCfg) {
  const meta = await sharp(templatePath).metadata();
  const W = meta.width, H = meta.height;
  const { cx, cy, rx, ry } = maskCfg;
  const svg = '<svg width="' + W + '" height="' + H + '">'
    + '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="white"/>'
    + '</svg>';
  return sharp({ create: { width: W, height: H, channels: 3, background: { r:0, g:0, b:0 } } })
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .png().toBuffer();
}

async function saveMaskDebug(templatePath, maskBuf, label) {
  const meta = await sharp(templatePath).metadata();
  const W = meta.width, H = meta.height;
  // 把 mask 变成红色半透明覆盖在底图上
  const redOverlay = await sharp(maskBuf)
    .ensureAlpha()
    .toBuffer();
  const rgbaRaw = await sharp(redOverlay).raw().toBuffer({ resolveWithObject: true });
  const colored = Buffer.alloc(rgbaRaw.info.width * rgbaRaw.info.height * 4);
  for (let i = 0; i < rgbaRaw.info.width * rgbaRaw.info.height; i++) {
    const g = rgbaRaw.data[i * 3] || rgbaRaw.data[i * 4];  // gray value
    colored[i*4+0] = 255;     // R
    colored[i*4+1] = 0;       // G
    colored[i*4+2] = 0;       // B
    colored[i*4+3] = Math.round(g * 0.6); // alpha proportional to mask
  }
  const coloredPng = await sharp(colored, { raw: { width: rgbaRaw.info.width, height: rgbaRaw.info.height, channels: 4 } }).png().toBuffer();
  const out = path.join(TEMP_DIR, 'debug_mask_' + label + '.jpg');
  await sharp(templatePath).composite([{ input: coloredPng, blend: 'over' }]).jpeg({ quality: 90 }).toFile(out);
  console.log('[DEBUG] mask 覆盖图: ' + path.basename(out));
}

async function runInpaint(label, templatePath, userPhotoPath, maskCfg) {
  console.log('\n======== ' + label + ' ========');
  const meta = await sharp(templatePath).metadata();
  console.log('底图尺寸: ' + meta.width + 'x' + meta.height);
  console.log('mask: cx=' + maskCfg.cx + ' cy=' + maskCfg.cy + ' rx=' + maskCfg.rx + ' ry=' + maskCfg.ry);

  const maskBuf = await buildMask(templatePath, maskCfg);
  await saveMaskDebug(templatePath, maskBuf, label);

  const templateB64 = toB64(templatePath);
  const userB64     = toB64(userPhotoPath);
  const maskB64     = 'data:image/png;base64,' + maskBuf.toString('base64');

  const prompt = [
    'Photorealistic photo. Identity-preserving face-swap edit.',
    'Image 1 is the source photo — reproduce it with maximum fidelity.',
    'Image 2 is the identity reference — replace ONLY the face in the white mask region with the face from Image 2.',
    'Critical: The person in the result must be clearly identifiable as Image 2.',
    'Keep body, pose, clothing, and background from Image 1 exactly unchanged outside the mask.',
    '8K quality, sharp face, photorealistic.',
  ].join('\n');

  const t0 = Date.now();
  const res = await axios.post(API_URL, {
    model:           MODEL,
    prompt,
    negative_prompt: 'blurry face, distorted face, cartoon, changed background, changed clothing, identity drift',
    image:           [templateB64, userB64],
    mask_image:      maskB64,
    strength:        1.0,
    guidance_scale:  10,
    response_format: 'url',
    size:            '2048x2560',
    stream:          false,
  }, {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
    timeout: 180000,
  });

  const url = res.data?.data?.[0]?.url;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('生成成功 (' + elapsed + 's)');

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const destFile = path.join(OUT_DIR, 'debug_' + label + '_' + Date.now() + '.jpg');
  await new Promise((resolve, reject) => {
    const https = require('https'), http = require('http');
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destFile);
    client.get(url, r => { r.pipe(file); file.on('finish', () => { file.close(); resolve(); }); }).on('error', reject);
  });
  console.log('结果: ' + path.basename(destFile));
}

async function main() {
  const target = process.argv[2] || 'female';
  if (target === 'male' || target === 'both') {
    await runInpaint('male',   MALE_TPL, USER_MALE,   MALE_MASK);
  }
  if (target === 'female' || target === 'both') {
    await runInpaint('female', FEM_TPL,  USER_FEMALE, FEM_MASK);
  }
}

main().catch(e => { console.error(e.response?.data || e.message); process.exit(1); });
