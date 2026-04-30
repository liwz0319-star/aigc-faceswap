/**
 * 全场景换脸批量测试脚本（场景1 + 场景2 + 场景4）
 *
 * 场景1/2：Inpainting Mask 模式
 *   - 精准椭圆 mask，API 仅改 mask 白色区域
 *   - 额外做 post-composite：把原始底图背景按像素强制贴回，100% 锁定背景
 *   - 输出尺寸 2048x2560（与底图宽高比接近，避免拉伸失真）
 *
 * 场景4：Faceswap 提示词模式（strength=0.45，已验证背景稳定）
 *   - 替换最左侧真实人脸
 *   - 输出尺寸 2560x1536（横版）
 *
 * Mask 坐标（基于原始底图像素，buildMask 自动缩放到 API 输出尺寸）：
 *   场景1男（1854×2304）: cx=1090, cy=820, rx=100, ry=125
 *   场景1女（1854×2304）: cx=1090, cy=820, rx= 95, ry=135
 *   场景2  （1696×2120）: cx=1010, cy=180, rx=130, ry=150
 *
 * 用法：
 *   node test-faceswap-inpaint-scenes.js photo1.jpg photo2.jpg
 *   node test-faceswap-inpaint-scenes.js photo.jpg --scene 1,2
 *   node test-faceswap-inpaint-scenes.js photo.jpg --gender female
 */

const fs   = require('fs');
const path = require('path');

// ── 环境初始化 ────────────────────────────────────────────────
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
const { describeUserAppearance } = require('./server/src/visionClient');
const { buildFaceswapPrompt }    = require('./server/src/promptBuilder_faceswap');
const { generateNativeImage }    = require('./server/src/seedreamNativeClient');

// ── 配置 ──────────────────────────────────────────────────────
const TEMPLATE_DIR = path.join(__dirname, '素材', '新场景底图');
const OUTPUT_DIR   = path.join(__dirname, '生成测试', 'inpaint_output');

const API_URL = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
const MODEL   = process.env.SEEDREAM_NATIVE_MODEL   || 'doubao-seedream-4-5-251128';

const DEFAULT_PHOTOS = [
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/1.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/2c53f3a8dc145eb8c27508d295e0debd.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/9dc96094e00c595a6395bf0c683401d5.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/394643d89fde950301c986251894d683.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/image.png',
];

/**
 * 场景配置
 *
 * mode='inpaint'：使用 mask_image，后期 post-composite 保证背景锁定
 *   size    : API 输出尺寸（与底图宽高比接近）
 *   mask    : 椭圆坐标（基于原始底图像素空间，buildMask 自动缩放）
 *   guidance: guidance_scale（1~10）
 *
 * mode='faceswap'：使用 prompt 换脸，strength 控制保留程度
 *   targetPerson : 目标描述
 *   templateType : 'mannequin' | 'faceswap'
 *   strength     : 0~1（越低背景越稳定）
 */
// mask 格式：
//   椭圆 { cx, cy, rx, ry } — 发给 API 的精确 mask，坐标经过视觉校准
//   矩形 { cx, cy, w, h }   — 场景2专用（模板为真实人体，矩形效果更好）
// post-composite 统一使用羽化矩形（由 buildMask 自动从椭圆/矩形扩展得出）
const SCENE_CONFIGS = {
  '1': {
    male: {
      file: '场景1男.jpg', label: '场景1男（更衣室）',
      mode: 'inpaint', size: '2048x2560', guidance: 10,
      // 1856×2306 底图：椭圆校准位置（人偶脸部中心）
      mask: { cx: 1140, cy: 850, rx: 85, ry: 125 },
    },
    female: {
      file: '场景1女.jpg', label: '场景1女（更衣室）',
      mode: 'inpaint', size: '2048x2560', guidance: 10,
      mask: { cx: 1140, cy: 850, rx: 80, ry: 130 },
    },
  },
  '2': {
    male: {
      file: '场景2.jpg', label: '场景2（球场举旗）',
      mode: 'inpaint', size: '2048x2560', guidance: 10,
      // 1696×2120 底图：矩形（真实人体模板，效果最好）
      mask: { cx: 1040, cy: 500, w: 400, h: 660 },
    },
    female: {
      file: '场景2.jpg', label: '场景2（球场举旗）',
      mode: 'inpaint', size: '2048x2560', guidance: 10,
      mask: { cx: 1040, cy: 500, w: 400, h: 660 },
    },
  },
  '4': {
    male: {
      file: '场景4男.png', label: '场景4男（啤酒节，替换最左）',
      mode: 'inpaint', size: '2560x1536', guidance: 10,
      // 549×375 底图：椭圆校准位置
      mask: { cx: 76, cy: 133, rx: 26, ry: 38 },
    },
    female: {
      file: '场景4女.png', label: '场景4女（啤酒节，替换最左）',
      mode: 'inpaint', size: '2560x1536', guidance: 10,
      // 546×375 底图：cx=87已确认，cy待重新校准（见下方预览）
      mask: { cx: 87, cy: 88, rx: 26, ry: 38 },
    },
  },
};

// ── 工具函数 ──────────────────────────────────────────────────
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
    const https = require('https'), http = require('http');
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

function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    const https = require('https'), http = require('http');
    const client = url.startsWith('https') ? https : http;
    const chunks = [];
    client.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadToBuffer(res.headers.location).then(resolve).catch(reject);
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseCliArgs(argv) {
  const opts = { photos: [], gender: null, scenes: null, outdir: null };
  const pos  = [];
  for (let i = 0; i < argv.length; i++) {
    if      (argv[i] === '--gender') { opts.gender = argv[++i] || null; }
    else if (argv[i] === '--scene')  { opts.scenes = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean); }
    else if (argv[i] === '--outdir') { opts.outdir = argv[++i] || null; }
    else if (!argv[i].startsWith('--')) { pos.push(argv[i]); }
  }
  opts.photos = pos.length > 0 ? pos : DEFAULT_PHOTOS;
  return opts;
}

async function detectGender(userBase64) {
  const key = process.env.VISION_API_KEY;
  if (!key) return 'male';
  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  try {
    const res = await axios.post(url, {
      model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: userBase64 } },
        { type: 'text', text: 'Look at this person. Reply ONLY one word: "male", "female", or "unknown".' },
      ]}],
      max_tokens: 10, temperature: 0.1,
    }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 15000 });
    const answer = (res.data?.choices?.[0]?.message?.content || '').trim().toLowerCase();
    if (answer.includes('female')) return 'female';
    if (answer.includes('male'))   return 'male';
  } catch (e) { /* 失败默认男性 */ }
  return 'male';
}

/**
 * 生成椭圆 inpainting mask（白色=换脸区域，黑色=保留区域）
 * 坐标基于原始底图像素，自动缩放到 API 输出尺寸
 */
/**
 * 生成 inpainting mask（支持椭圆和矩形两种格式）
 *
 * 椭圆 { cx, cy, rx, ry }：API 发送精确椭圆（校准的脸部区域）
 * 矩形 { cx, cy, w, h }  ：API 发送矩形（场景2真实人体专用）
 *
 * post-composite 统一使用：
 *   - 从脸部区域向上延伸覆盖头顶/发型，向下延伸覆盖颈部
 *   - 大幅羽化（~12%），边缘渐变消除硬边
 */
async function buildMask(inputW, inputH, mask, outputW, outputH) {
  const scaleX = outputW / inputW;
  const scaleY = outputH / inputH;
  /*
  const rect = resolveMaskRect(mask, scaleX, scaleY, outputW, outputH);

  const svgAPIRect = `<svg width="${outputW}" height="${outputH}">` +
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="white"/></svg>`;
  const apiBufRect = await sharp({ create: { width: outputW, height: outputH, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: Buffer.from(svgAPIRect), blend: 'over' }])
    .png()
    .toBuffer();

  const featherPadX = Math.round(rect.w * 0.08);
  const featherPadTop = Math.round(rect.h * 0.08);
  const featherPadBottom = Math.round(rect.h * 0.14);
  const cLeft = clamp(rect.x - featherPadX, 0, outputW);
  const cTop = clamp(rect.y - featherPadTop, 0, outputH);
  const cRight = clamp(rect.x + rect.w + featherPadX, 0, outputW);
  const cBottom = clamp(rect.y + rect.h + featherPadBottom, 0, outputH);
  const cW = Math.max(1, cRight - cLeft);
  const cH = Math.max(1, cBottom - cTop);
  const feather = Math.max(18, Math.round(Math.min(cW, cH) * 0.10));

  const svgCompRect = `<svg width="${outputW}" height="${outputH}">` +
    `<rect x="${cLeft}" y="${cTop}" width="${cW}" height="${cH}" fill="white"/></svg>`;
  const compRawRect = await sharp({ create: { width: outputW, height: outputH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(svgCompRect), blend: 'over' }])
    .png()
    .toBuffer();
  const compBufRect = await sharp(compRawRect).blur(feather).png().toBuffer();

  console.log(`    mask -> rect (${rect.x},${rect.y}) ${rect.w}x${rect.h} (${outputW}x${outputH})`);
  return { apiBuf: apiBufRect, compBuf: compBufRect, rect };
  */

  // ── API mask ──────────────────────────────────────────────────
  let svgAPI;
  if ('w' in mask) {
    // 矩形 mask（场景2）
    const rw = Math.round(mask.w * scaleX);
    const rh = Math.round(mask.h * scaleY);
    const rx = mcx - Math.round(rw / 2);
    const ry = mcy - Math.round(rh / 2);
    svgAPI = `<svg width="${outputW}" height="${outputH}">` +
      `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="white"/></svg>`;
    console.log(`    mask → rect (${rx},${ry}) ${rw}×${rh} (${outputW}×${outputH})`);
  } else {
    // 椭圆 mask（场景1/4）：精确对齐人偶脸部
    const mrx = Math.round(mask.rx * scaleX);
    const mry = Math.round(mask.ry * scaleY);
    svgAPI = `<svg width="${outputW}" height="${outputH}">` +
      `<ellipse cx="${mcx}" cy="${mcy}" rx="${mrx}" ry="${mry}" fill="white"/></svg>`;
    console.log(`    mask → ellipse cx=${mcx} cy=${mcy} rx=${mrx} ry=${mry} (${outputW}×${outputH})`);
  }
  const apiBuf = await sharp({ create: { width: outputW, height: outputH, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: Buffer.from(svgAPI), blend: 'over' }])
    .png()
    .toBuffer();

  // ── Composite mask：羽化大矩形（覆盖头顶+脸+颈部）────────────
  // 无论 API mask 是椭圆还是矩形，composite 统一用扩展矩形 + 羽化
  // 上方：覆盖头顶/发型（face_cy - 1.8 * ry）
  // 下方：覆盖颈部/肩膀过渡（face_cy + 2.8 * ry）
  // 左右：脸宽 + 40% 余量
  let faceRx, faceRy;
  if ('w' in mask) {
    faceRx = Math.round(mask.w / 2 * scaleX);
    faceRy = Math.round(mask.h / 2 * scaleY);
  } else {
    faceRx = Math.round(mask.rx * scaleX);
    faceRy = Math.round(mask.ry * scaleY);
  }
  const cLeft   = mcx - Math.round(faceRx * 1.4);
  const cRight  = mcx + Math.round(faceRx * 1.4);
  const cTop    = mcy - Math.round(faceRy * 1.8);
  const cBottom = mcy + Math.round(faceRy * 2.8);
  const cW = cRight - cLeft;
  const cH = cBottom - cTop;
  const feather = Math.max(15, Math.round(Math.min(cW, cH) * 0.12));

  const svgComp = `<svg width="${outputW}" height="${outputH}">` +
    `<rect x="${cLeft}" y="${cTop}" width="${cW}" height="${cH}" fill="white"/></svg>`;
  const compRaw = await sharp({ create: { width: outputW, height: outputH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(svgComp), blend: 'over' }])
    .png()
    .toBuffer();
  const compBuf = await sharp(compRaw).blur(feather).png().toBuffer();

  return { apiBuf, compBuf, cx: mcx, cy: mcy };
}

/**
 * Post-composite：把 AI 输出中 mask 椭圆区域贴到原始底图上
 * 确保椭圆外所有像素与原始底图像素级一致
 *
 * 流程：
 *   1. 原始底图缩放到输出尺寸（与 API 输入一致，避免错位）
 *   2. 在缩放后的底图上打一个透明椭圆孔
 *   3. 将带孔底图叠加在 AI 输出上方 → 背景 = 原始底图，脸部 = AI 输出
 */
async function postComposite({ templatePath, templateW, templateH, aiBuf, maskCoords, outW, outH }) {
  const scaleX = outW / templateW;
  const scaleY = outH / templateH;
  const cx = Math.round(maskCoords.cx * scaleX);
  const cy = Math.round(maskCoords.cy * scaleY);
  const rx = Math.round(maskCoords.rx * scaleX);
  const ry = Math.round(maskCoords.ry * scaleY);

  // 1. 底图缩放到输出尺寸（fit:'fill' = 精确拉伸到目标尺寸，与 API 的处理方式一致）
  const resizedTpl = await sharp(templatePath)
    .resize(outW, outH, { fit: 'fill' })
    .ensureAlpha()
    .toBuffer();

  // 2. 在底图上打透明椭圆孔（dest-out：source白色区域将底图变透明）
  const holeEllipse = `<svg width="${outW}" height="${outH}">` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"/>` +
    `</svg>`;
  const tplWithHole = await sharp(resizedTpl)
    .composite([{ input: Buffer.from(holeEllipse), blend: 'dest-out' }])
    .png()
    .toBuffer();

  // 3. AI 输出 + 带孔底图叠上去（椭圆内 = AI 脸，椭圆外 = 原始底图）
  return sharp(aiBuf)
    .resize(outW, outH, { fit: 'fill' })
    .composite([{ input: tplWithHole }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ── 场景1/2/4：Inpainting 模式 ───────────────────────────────
// 流程：
//   1. API inpainting 生成换脸结果
//   2. Post-composite：把原始底图（精确缩放到输出尺寸）在 mask 椭圆外强制覆盖回去
//      → 椭圆内 = AI 生成的人脸，椭圆外 = 原始底图像素，100% 锁定背景
async function runInpaintTest({ photoTag, sceneId, conf, templatePath, templateW, templateH,
                                 userBase64, userDescription, gender, outputDir = OUTPUT_DIR }) {
  const [outW, outH] = conf.size.split('x').map(Number);
  const templateBase64 = toBase64DataUrl(templatePath);

  // 构建 mask：apiBuf=RGB黑白矩形（发给API），compBuf=RGBA羽化矩形（post-composite用）
  const { apiBuf, compBuf } =
    await buildMask(templateW, templateH, conf.mask, outW, outH);
  const maskBase64 = 'data:image/png;base64,' + apiBuf.toString('base64');

  const appearanceLine = userDescription
    ? `Person description (Image 2): ${userDescription.substring(0, 200)}`
    : '';
  const genderLock = gender === 'male'
    ? 'GENDER: The person is MALE — reproduce male facial structure, jawline, and hairstyle faithfully.'
    : gender === 'female'
    ? 'GENDER: The person is FEMALE — reproduce female facial structure and hairstyle faithfully.'
    : '';

  // 换头提示词：强调自然融合、肤色衔接、颈部过渡、背景不变
  const prompt = [
    'Photorealistic head transplant composite. Ultra-high quality.',
    'Image 1 = scene background with a placeholder body. Image 2 = the real person to place into the scene.',
    'Task: Replace ONLY the head and neck area inside the white rectangular mask with the person from Image 2.',
    '',
    'CRITICAL REQUIREMENTS:',
    '● Identity: The replaced head must be clearly recognizable as the SAME person from Image 2.',
    '  Preserve exact facial features — eyes, nose, lips, skin tone, hairline, hair color, hairstyle.',
    '● Skin tone continuity: The skin tone of the face and neck must smoothly match',
    '  the skin tone at the shoulder/body boundary — NO visible color jump or seam.',
    '● Neck-to-shoulder blend: Generate a natural, anatomically correct transition',
    '  from the neck into the shoulders/body of Image 1. No floating head effect.',
    '● Edge feathering: The boundary of the replaced region must fade seamlessly',
    '  into the surrounding background — soft edges, no hard cutout lines.',
    '● Background lock: ALL pixels OUTSIDE the white mask region must remain',
    '  pixel-perfect identical to Image 1. Do NOT alter background, lighting, or props.',
    '● Lighting match: The head lighting direction, color temperature, and shadows',
    '  must match the lighting of the body and scene in Image 1.',
    '● Head size: The head must be the EXACT SAME SIZE as the placeholder/blank head area in Image 1.',
    '  Do NOT make the head larger than the template placeholder — match its scale precisely.',
    '',
    genderLock,
    appearanceLine,
    'Ultra-detailed, 8K resolution, photorealistic, sharp face, seamless composite.',
  ].filter(Boolean).join('\n');

  const negative_prompt = [
    'hard edge, visible seam, cutout effect, pasted-on look, halo artifact,',
    'floating head, neck mismatch, skin tone jump, color discontinuity,',
    'blurry face, distorted face, deformed anatomy, wrong proportions,',
    'cartoon, anime, illustration, painting,',
    'identity drift, different person, wrong hairstyle, beauty filter, age altered,',
    'changed background, altered composition, moved objects, different lighting.',
  ].join(' ');

  const t0 = Date.now();
  try {
    const res = await axios.post(API_URL, {
      model: MODEL, prompt, negative_prompt,
      image: [templateBase64, userBase64],
      mask_image: maskBase64,
      strength: 1.0,
      guidance_scale: conf.guidance,
      response_format: 'url',
      size: conf.size,
      stream: false,
    }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` }, timeout: 180000 });

    const url = res.data?.data?.[0]?.url;
    if (!url) throw new Error('API 未返回图片 URL');

    // ── Post-composite：mask 作 alpha 通道直接合成 ───────────────
    // 思路：用 mask 图本身控制每个像素来源
    //   mask=白(255)处 → 显示 AI 输出（人脸）
    //   mask=黑(0)处   → 显示原始底图（背景完全不变）
    // 比打孔法更可靠：不受 +/-偏移影响，边界精确贴合 mask 形状

    // 1. 下载 AI 输出
    const aiBuf = await downloadToBuffer(url);

    // 2. AI 输出缩放到目标尺寸，并加 alpha 通道
    const aiResized = await sharp(aiBuf)
      .resize(outW, outH, { fit: 'fill' })
      .ensureAlpha()
      .toBuffer();

    // 3. 用 RGBA compBuf 做 dest-in：AI 输出只保留椭圆内像素（其余透明）
    const aiFaceMasked = await sharp(aiResized)
      .composite([{ input: compBuf, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // 4. 原始底图缩放到目标尺寸（背景层）
    const tplResized = await sharp(templatePath)
      .resize(outW, outH, { fit: 'fill' })
      .toBuffer();

    // 5. 底图 + 人脸层叠加 → 椭圆外=底图原像素，椭圆内=AI人脸
    const finalBuf = await sharp(tplResized)
      .composite([{ input: aiFaceMasked, blend: 'over' }])
      .jpeg({ quality: 95 })
      .toBuffer();

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const gTag    = gender === 'female' ? 'F' : 'M';
    const outFile = path.join(outputDir, `scene${sceneId}_inpaint_${gTag}_${photoTag}_${Date.now()}.jpg`);
    fs.writeFileSync(outFile, finalBuf);

    console.log(`  [✓] 场景${sceneId} ${conf.label} → ${path.basename(outFile)} (${elapsed}s, composited)`);
    return { photoTag, sceneId, label: conf.label, elapsed, localFile: path.basename(outFile), status: 'ok' };
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const msg     = err.response?.data ? JSON.stringify(err.response.data).substring(0, 200) : err.message;
    console.error(`  [✗] 场景${sceneId} ${conf.label} 失败 (${elapsed}s): ${msg}`);
    return { photoTag, sceneId, label: conf.label, elapsed, status: 'failed', error: msg };
  }
}

// ── 场景4：Faceswap prompt 模式 ───────────────────────────────
async function runFaceswapTest({ photoTag, sceneId, conf, templatePath,
                                  userBase64, userDescription, gender, outputDir = OUTPUT_DIR }) {
  const templateBase64 = toBase64DataUrl(templatePath);
  const { prompt, negative_prompt } = buildFaceswapPrompt({
    targetPerson: conf.targetPerson,
    userDescription, gender,
    templateType: conf.templateType,
  });

  const t0 = Date.now();
  try {
    const result = await generateNativeImage({
      prompt, negative_prompt,
      images: [templateBase64, userBase64],
      size:   conf.size,
      scene_params: { strength: conf.strength, guidance_scale: conf.guidance },
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const gTag    = gender === 'female' ? 'F' : 'M';
    const outFile = path.join(outputDir, `scene${sceneId}_faceswap_${gTag}_${photoTag}_${Date.now()}.jpg`);
    await downloadFile(result.url, outFile);

    console.log(`  [✓] 场景${sceneId} ${conf.label} → ${path.basename(outFile)} (${elapsed}s)`);
    return { photoTag, sceneId, label: conf.label, elapsed, localFile: path.basename(outFile), status: 'ok' };
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const msg     = err.response?.data ? JSON.stringify(err.response.data).substring(0, 200) : err.message;
    console.error(`  [✗] 场景${sceneId} ${conf.label} 失败 (${elapsed}s): ${msg}`);
    return { photoTag, sceneId, label: conf.label, elapsed, status: 'failed', error: msg };
  }
}

// ── 单张照片跑所有场景 ────────────────────────────────────────
async function runPhotoAllScenes({ photoPath, sceneIds, forceGender, outputDir = OUTPUT_DIR }) {
  const photoTag   = path.basename(photoPath, path.extname(photoPath)).substring(0, 8);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`照片: ${path.basename(photoPath)}`);

  const userBase64 = toBase64DataUrl(photoPath);

  let userDescription = '';
  try {
    userDescription = await describeUserAppearance([userBase64]);
    console.log(`  外貌: ${userDescription.substring(0, 80)}...`);
  } catch (e) { console.warn(`  外貌解读失败: ${e.message}`); }

  const gender = forceGender || await detectGender(userBase64);
  console.log(`  性别: ${gender}`);

  const results = [];
  for (const sceneId of sceneIds) {
    const sceneConf = SCENE_CONFIGS[sceneId];
    if (!sceneConf) {
      results.push({ photoTag, sceneId, status: 'skip', error: '场景未配置' });
      continue;
    }

    const conf         = sceneConf[gender] || sceneConf['male'];
    const templatePath = path.join(TEMPLATE_DIR, conf.file);

    if (!fs.existsSync(templatePath)) {
      console.error(`  底图不存在: ${templatePath}`);
      results.push({ photoTag, sceneId, label: conf.label, status: 'skip', error: '底图文件不存在' });
      continue;
    }

    const meta = await sharp(templatePath).metadata();

    let r;
    if (conf.mode === 'inpaint') {
      r = await runInpaintTest({
        photoTag, sceneId, conf,
        templatePath, templateW: meta.width, templateH: meta.height,
        userBase64, userDescription, gender, outputDir,
      });
    } else {
      r = await runFaceswapTest({
        photoTag, sceneId, conf, templatePath,
        userBase64, userDescription, gender, outputDir,
      });
    }
    results.push(r);
  }
  return results;
}

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  const cli      = parseCliArgs(process.argv.slice(2));
  const sceneIds = cli.scenes || Object.keys(SCENE_CONFIGS);
  const outputDir = cli.outdir
    ? (path.isAbsolute(cli.outdir) ? cli.outdir : path.join(__dirname, cli.outdir))
    : OUTPUT_DIR;

  console.log('='.repeat(50));
  console.log('全场景换脸批量测试（Inpaint + Post-composite + Faceswap）');
  console.log('='.repeat(50));
  console.log(`照片数: ${cli.photos.length}  场景: ${sceneIds.join(', ')}  共 ${cli.photos.length * sceneIds.length} 个任务`);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const t_total    = Date.now();
  const allResults = [];

  await Promise.all(cli.photos.map(photoPath =>
    runPhotoAllScenes({ photoPath, sceneIds, forceGender: cli.gender, outputDir })
      .then(r => allResults.push(...r))
      .catch(err => console.error(`照片处理失败 ${photoPath}: ${err.message}`))
  ));

  const elapsed = ((Date.now() - t_total) / 1000).toFixed(1);
  const ok      = allResults.filter(r => r.status === 'ok').length;
  const failed  = allResults.filter(r => r.status === 'failed').length;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`汇总：${ok} 成功 / ${failed} 失败  总耗时 ${elapsed}s`);
  console.log(`输出目录: ${outputDir}`);
  console.log('='.repeat(50));

  allResults.forEach(r => {
    const tag  = r.status === 'ok' ? '✓' : r.status === 'skip' ? '-' : '✗';
    const info = r.status === 'ok' ? r.localFile : (r.error || '');
    console.log(`[${tag}] ${r.photoTag} 场景${r.sceneId}  ${info}`);
  });
}

main().catch(err => { console.error('测试出错:', err.message); process.exit(1); });
