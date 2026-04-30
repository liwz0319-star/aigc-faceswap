/**
 * Faceswap 场景3 测试脚本（Seedream 4.5 Native 模式）
 *
 * 场景3 构图：戴维斯(1) + 于帕梅卡诺(10) + 吉祥物 + 诺伊尔(8) — 共5人
 *   球迷槽位：左数第3位（5人中间）
 *
 * 流程：
 *   1. 视觉模型检测用户性别
 *   2. 性别 → 选择对应底图（只选一张）
 *      - 男性 → scene_03_1777013337798.png
 *      - 女性 → scene_03_user2_1777013790300.png
 *   3. 调用 Seedream 4.5 Native 生成换脸图
 *
 * 用法：
 *   node test-faceswap-scene3.js                           # 默认照片，自动检测性别
 *   node test-faceswap-scene3.js "照片/xxx.jpg"            # 指定照片
 *   node test-faceswap-scene3.js --gender male             # 强制男性模板
 *   node test-faceswap-scene3.js --gender female           # 强制女性模板
 *   node test-faceswap-scene3.js --strength 0.3            # 调整强度（默认0.35）
 */

const fs   = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, 'server');

// ── 解析 server/.env ──
fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

if (!process.env.VISION_API_KEY && process.env.SEEDREAM_NATIVE_API_KEY) {
  process.env.VISION_API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
}

require('module').Module.globalPaths.push(path.join(SERVER_DIR, 'node_modules'));

const { generateNativeImage }    = require('./server/src/seedreamNativeClient');
const { buildFaceswapPrompt }    = require('./server/src/promptBuilder_faceswap');
const { describeUserAppearance } = require('./server/src/visionClient');
const axios = require(path.join(SERVER_DIR, 'node_modules', 'axios'));
const sharp = require(path.join(SERVER_DIR, 'node_modules', 'sharp'));

// ============================================================
// 场景3 模板配置
// ============================================================
const RELAY_DIR      = path.join(__dirname, '生成测试', 'relay_test');
const OUTPUT_DIR     = path.join(__dirname, '生成测试', 'faceswap_output');
const PROMPT_LOG_DIR = path.join(__dirname, '生成测试', 'prompt_logs');

// 场景3：5人构图，球迷在左数第3位（中间），吉祥物在左数第4位
const SCENE3_TEMPLATES = {
  male: {
    file:            'scene3-M.jpg',
    targetPerson:    'the second person from the left (the fan with Asian appearance, standing second from left)',
    targetDesc:      '左数第2位（亚洲面孔球迷）',
    description:     '男球迷模板',
    compositionNote: 'This photo has exactly 5 persons from left to right: [1] goalkeeper in green jersey, [2] the fan (Asian appearance, red jersey) whose right arm is extended sideways to touch the bear mascot\'s raised paw in a high-five, [3] tall black player in red jersey, [4] bear mascot in red jersey, [5] black player in red jersey.',
    poseNote:        'POSE LOCK: The fan (second from left) must keep their right arm extended sideways at shoulder level, palm facing the bear mascot, performing a high-five. IDENTICAL to Image 1. Do NOT raise the arm upward.',
    backgroundNote:  'Background contains horizontal PAULANER banner strips spelled exactly "PAULANER" in white text on blue background, repeated across the top of the image. No circular FC Bayern logos in the background.',
    defaultStrength: 0.35,
  },
  female: {
    file:            'scene3-F.jpg',
    targetPerson:    'the third person from the left (the fan standing in the middle)',
    targetDesc:      '左数第3位（中间的女球迷）',
    description:     '女球迷模板',
    compositionNote: 'This photo has exactly 5 persons from left to right: [1] black player in red jersey, [2] black player in red jersey, [3] the fan (female, red jersey) whose right arm is extended sideways to touch the bear mascot\'s raised paw in a high-five, [4] bear mascot in red jersey, [5] goalkeeper in green jersey.',
    poseNote:        'POSE LOCK: The fan (third from left) must keep their right arm extended sideways at shoulder level, palm facing the bear mascot, performing a high-five. IDENTICAL to Image 1. Do NOT raise the arm upward.',
    backgroundNote:  'Background contains horizontal PAULANER banner strips spelled exactly "PAULANER" in white text on blue background, repeated across the top and sides of the image. There is a large PAULANER billboard on the left side. No circular FC Bayern logos anywhere in the background.',
    defaultStrength: 0.25,
    restoreBgRatio:  0.22,  // 顶部横幅占图高比例，自动从底图还原
  },
};

const DEFAULT_SIZE      = '2048x2560';
const DEFAULT_STRENGTH  = 0.35;
const DEFAULT_GUIDANCE  = 10;
const DEFAULT_USER_PHOTO = 'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/efd3b40c22f3aefc65349fdd4a768d59.jpg';

// ============================================================
// 工具函数
// ============================================================

function toBase64DataUrl(filePath) {
  const p = filePath.replace(/\\/g, '/');
  const buf  = fs.readFileSync(p);
  const ext  = path.extname(p).slice(1).toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
             : ext === 'png' ? 'image/png'
             : `image/${ext}`;
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

/**
 * 用视觉模型获取指定人物头部的像素坐标（归一化 0~1）
 * 返回 { cx, cy, r } — 头部中心(cx,cy) 和半径 r（均为比例值）
 */
async function detectFaceBbox(imagePath, personDesc) {
  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const key = process.env.VISION_API_KEY;
  const buf = fs.readFileSync(imagePath);
  const b64 = `data:image/jpeg;base64,${buf.toString('base64')}`;

  const res = await axios.post(url, {
    model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: b64 } },
        { type: 'text', text:
          `In this image, locate the head (face region including hair) of ${personDesc}. ` +
          `Return ONLY a JSON object with these fields (all values 0.0 to 1.0, as fraction of image width/height): ` +
          `{"cx": <horizontal center>, "cy": <vertical center>, "w": <width of head>, "h": <height of head>}. ` +
          `No explanation, no markdown, just the JSON.`
        },
      ],
    }],
    max_tokens: 60,
    temperature: 0.1,
  }, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    timeout: 15000,
  });

  const raw = (res.data?.choices?.[0]?.message?.content || '').trim();
  // 容错：提取 JSON
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`视觉模型返回格式不正确: ${raw}`);
  return JSON.parse(match[0]);
}

/**
 * 缩小图片中指定头部区域，用 sharp 合成回原图（含边缘羽化）
 * @param {string} srcPath   原始图路径
 * @param {string} destPath  输出图路径
 * @param {{cx,cy,w,h}} bbox 归一化坐标 (0~1)
 * @param {number} scale     缩放比例，如 0.92 = 缩小到 92%
 */
async function shrinkHeadInImage(srcPath, destPath, bbox, scale = 0.92) {
  const meta = await sharp(srcPath).metadata();
  const W = meta.width, H = meta.height;

  // 扩展头部区域 ×1.5，保留发型及颈部过渡区域
  const margin = 1.5;
  const hw = Math.round(bbox.w * W * margin);
  const hh = Math.round(bbox.h * H * margin);
  const hx = Math.max(0, Math.round(bbox.cx * W - hw / 2));
  const hy = Math.max(0, Math.round(bbox.cy * H - hh / 2));
  const safeW = Math.min(hw, W - hx);
  const safeH = Math.min(hh, H - hy);

  console.log(`  [shrinkHead] 头部区域 px: x=${hx} y=${hy} w=${safeW} h=${safeH}`);
  console.log(`  [shrinkHead] 缩放比例: ${scale}`);

  // 1. 从原图裁出头部区域
  const headBuf = await sharp(srcPath)
    .extract({ left: hx, top: hy, width: safeW, height: safeH })
    .toBuffer();

  // 2. 缩小头部（整个区域等比缩小，背景跟随缩小保证边缘一致）
  const newW = Math.round(safeW * scale);
  const newH = Math.round(safeH * scale);
  const scaledBuf = await sharp(headBuf).resize(newW, newH).toBuffer();

  // 3. 生成带羽化边缘的 alpha 遮罩
  //    用 RGB 白色矩形 + extend 黑边 + blur，取 R 通道作为 alpha
  const blurRadius = Math.max(4, Math.round(Math.min(newW, newH) * 0.06));
  const innerW = Math.max(1, newW - blurRadius * 2);
  const innerH = Math.max(1, newH - blurRadius * 2);
  const maskBuf = await sharp({
    create: { width: innerW, height: innerH, channels: 3, background: { r: 255, g: 255, b: 255 } }
  })
    .extend({ top: blurRadius, bottom: blurRadius, left: blurRadius, right: blurRadius,
              background: { r: 0, g: 0, b: 0 } })
    .blur(blurRadius)
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 4. 将遮罩作为 alpha 通道合入缩小后的头部图
  const scaledRaw = await sharp(scaledBuf).raw().toBuffer({ resolveWithObject: true });
  const alpha = maskBuf.data;
  const rgb   = scaledRaw.data;

  // 构建 RGBA buffer
  const rgbaLen = newW * newH * 4;
  const rgba    = Buffer.allocUnsafe(rgbaLen);
  for (let i = 0; i < newW * newH; i++) {
    rgba[i * 4]     = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }
  const maskedBuf = await sharp(rgba, { raw: { width: newW, height: newH, channels: 4 } })
    .png()
    .toBuffer();

  // 5. 居中贴回原图：先把缩小的头放在原始区域正中，与底下原图软融合
  const offsetX = hx + Math.round((safeW - newW) / 2);
  const offsetY = hy + Math.round((safeH - newH) / 2);

  await sharp(srcPath)
    .composite([{ input: maskedBuf, left: offsetX, top: offsetY, blend: 'over' }])
    .jpeg({ quality: 95 })
    .toFile(destPath);

  console.log(`  [shrinkHead] 已保存: ${path.basename(destPath)}`);
}

/**
 * 将底图的背景区域（顶部横幅）贴回生成结果，确保 logo 文字100%正确
 * @param {string} templatePath  底图路径
 * @param {string} generatedPath 生成结果路径
 * @param {string} destPath      输出路径
 * @param {number} bannerRatio   顶部横幅区域占图高的比例（默认0.22）
 */
async function restoreBackground(templatePath, generatedPath, destPath, bannerRatio = 0.22) {
  const genMeta  = await sharp(generatedPath).metadata();
  const tplMeta  = await sharp(templatePath).metadata();
  const W = genMeta.width, H = genMeta.height;

  // 横幅区域高度（在生成图坐标系）
  const bannerH  = Math.round(H * bannerRatio);
  // 渐变融合区高度
  const blendH   = Math.round(H * 0.04);

  // 1. 从底图裁出顶部横幅区域，缩放到生成图尺寸
  const bannerBuf = await sharp(templatePath)
    .resize(W, H)
    .extract({ left: 0, top: 0, width: W, height: bannerH + blendH })
    .toBuffer();

  // 2. 生成渐变 alpha mask：顶部全不透明，底部渐变到透明
  const maskPixels = Buffer.allocUnsafe((bannerH + blendH) * W * 4);
  for (let y = 0; y < bannerH + blendH; y++) {
    const alpha = y < bannerH ? 255 : Math.round(255 * (1 - (y - bannerH) / blendH));
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      maskPixels[i] = maskPixels[i+1] = maskPixels[i+2] = 255;
      maskPixels[i+3] = alpha;
    }
  }
  const maskedBanner = await sharp(bannerBuf)
    .joinChannel(
      await sharp(maskPixels, { raw: { width: W, height: bannerH + blendH, channels: 4 } })
        .extractChannel(3).toBuffer(),
      { raw: { width: W, height: bannerH + blendH, channels: 1 } }
    )
    .png()
    .toBuffer();

  // 3. 将带 alpha 的横幅叠加到生成结果上
  await sharp(generatedPath)
    .composite([{ input: maskedBanner, left: 0, top: 0, blend: 'over' }])
    .jpeg({ quality: 95 })
    .toFile(destPath);

  console.log(`  [restoreBg] 顶部横幅已从底图还原 (bannerRatio=${bannerRatio})`);
  console.log(`  [restoreBg] 已保存: ${path.basename(destPath)}`);
}

function parseCliArgs(argv) {
  const opts = {
    userPhotoPath: DEFAULT_USER_PHOTO,
    gender:        null,
    size:          DEFAULT_SIZE,
    strength:      DEFAULT_STRENGTH,
    guidanceScale: DEFAULT_GUIDANCE,
    shrink:        false,   // 头部缩小后处理，默认关闭（会产生双嘴鬼影）
  };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if      (argv[i] === '--gender')   { opts.gender        = argv[++i] || null; }
    else if (argv[i] === '--size')     { opts.size          = argv[++i] || DEFAULT_SIZE; }
    else if (argv[i] === '--strength') { opts.strength = parseFloat(argv[++i]); opts._strengthFromCli = true; }
    else if (argv[i] === '--guidance') { opts.guidanceScale = parseFloat(argv[++i]); }
    else if (argv[i] === '--shrink')   { opts.shrink = true; }
    else if (!argv[i].startsWith('--')) { pos.push(argv[i]); }
  }
  if (pos[0]) opts.userPhotoPath = pos[0];
  if (opts.gender && !['male', 'female'].includes(opts.gender)) {
    throw new Error('--gender 只支持 male 或 female');
  }
  return opts;
}

async function detectGender(userImageBase64) {
  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const key = process.env.VISION_API_KEY;
  if (!key) throw new Error('VISION_API_KEY 未配置');

  const res = await axios.post(url, {
    model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: userImageBase64 } },
        { type: 'text', text: 'Look at this person photo and infer gender presentation conservatively. Reply with ONLY one word: "male", "female", or "unknown". Use "unknown" unless the presentation is visually clear and high-confidence.' },
      ],
    }],
    max_tokens: 10,
    temperature: 0.1,
  }, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    timeout: 15000,
  });

  const answer = (res.data?.choices?.[0]?.message?.content || '').trim().toLowerCase();
  console.log(`[性别检测] 视觉模型返回: "${answer}"`);

  if (answer.includes('female') || answer.includes('woman') || answer.includes('girl')) return 'female';
  if (answer.includes('male')   || answer.includes('man')   || answer.includes('boy'))  return 'male';
  return 'unknown';
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const cli = parseCliArgs(process.argv.slice(2));

  console.log('========================================');
  console.log('Faceswap 场景3 测试（Seedream 4.5 Native）');
  console.log('========================================');
  console.log(`用户照片: ${path.basename(cli.userPhotoPath)}`);
  console.log(`模型: ${process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128'}`);
  console.log(`strength: ${cli.strength}  guidance: ${cli.guidanceScale}`);

  if (!fs.existsSync(OUTPUT_DIR))     fs.mkdirSync(OUTPUT_DIR,     { recursive: true });
  if (!fs.existsSync(PROMPT_LOG_DIR)) fs.mkdirSync(PROMPT_LOG_DIR, { recursive: true });

  // Step 1: 读取用户照片
  console.log('\n[Step 1] 读取用户照片...');
  const userBase64 = toBase64DataUrl(cli.userPhotoPath);

  // Step 2: 性别检测（只选一张底图）
  console.log('\n[Step 2] 性别检测...');
  let gender = cli.gender;
  if (gender) {
    console.log(`[性别检测] 命令行指定: ${gender}`);
  } else {
    try {
      gender = await detectGender(userBase64);
    } catch (err) {
      console.warn(`性别检测失败，默认男性: ${err.message}`);
      gender = 'male';
    }
    if (gender === 'unknown') {
      console.log('[性别检测] 无法确定，默认男性');
      gender = 'male';
    }
  }
  const genderLabel = gender === 'female' ? '女性' : '男性';
  console.log(`[性别检测] 最终结果: ${genderLabel} → 选择${genderLabel}底图`);

  // Step 3: 选择底图（若命令行未指定 strength，使用模板默认值）
  const tpl          = SCENE3_TEMPLATES[gender];
  const templatePath = path.join(RELAY_DIR, tpl.file);
  if (cli._strengthFromCli === undefined && tpl.defaultStrength) {
    cli.strength = tpl.defaultStrength;
  }

  console.log(`\n[Step 3] 选择底图:`);
  console.log(`  文件: ${tpl.file}`);
  console.log(`  说明: ${tpl.description}`);
  console.log(`  替换: ${tpl.targetDesc}`);

  if (!fs.existsSync(templatePath)) {
    console.error(`底图不存在: ${templatePath}`);
    process.exit(1);
  }

  // Step 4: 视觉模型解读外貌
  console.log('\n[Step 4] 视觉模型解读外貌...');
  let userDescription = '';
  try {
    userDescription = await describeUserAppearance([userBase64]);
    console.log(`外貌描述: ${userDescription.substring(0, 120)}...`);
  } catch (err) {
    console.warn(`视觉模型失败，跳过外貌描述: ${err.message}`);
  }

  // Step 4.5: 专项发型检测（防宝盖头）
  console.log('\n[Step 4.5] 专项发型检测...');
  let hairstyleNote = '';
  try {
    const VISION_URL = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
    const VISION_KEY = process.env.VISION_API_KEY;
    const hairstyleRes = await axios.post(VISION_URL, {
      model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: userBase64 } },
        { type: 'text', text:
          'Describe ONLY the hairstyle of this person in one precise sentence. Include: ' +
          '(1) hair length (very short/short/medium/long), ' +
          '(2) whether there are bangs/fringe and what kind (no bangs / light fringe / straight blunt fringe / side-swept fringe), ' +
          '(3) parting style (no parting / left part / right part / center part), ' +
          '(4) overall silhouette (e.g. textured/messy, slicked-back, layered, bowl-shaped, etc.). ' +
          'Be factual. One sentence only. English.'
        },
      ]}],
      max_tokens: 80,
      temperature: 0.1,
    }, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VISION_KEY}` },
      timeout: 15000,
    });
    hairstyleNote = (hairstyleRes.data?.choices?.[0]?.message?.content || '').trim();
    console.log(`发型描述: ${hairstyleNote}`);
  } catch (err) {
    console.warn(`发型检测失败，跳过: ${err.message}`);
  }

  // Step 5: 构建 Prompt
  console.log('\n[Step 5] 构建 Prompt...');
  const templateBase64 = toBase64DataUrl(templatePath);
  const { prompt: basePrompt, negative_prompt } = buildFaceswapPrompt({
    targetPerson:    tpl.targetPerson,
    userDescription: userDescription,
    hairstyleNote:   hairstyleNote,
    compositionNote: tpl.compositionNote,
    backgroundNote:  tpl.backgroundNote,
    gender,
  });
  // 若模板有特定姿势要求，追加到 prompt 末尾
  const prompt = tpl.poseNote
    ? basePrompt + '\n' + tpl.poseNote
    : basePrompt;

  console.log('\n========== 提示词 ==========');
  console.log('【性别】', genderLabel);
  console.log('【底图】', tpl.file);
  console.log('【替换位置】', tpl.targetDesc);
  console.log('\n【Prompt 前350字】');
  console.log(prompt.substring(0, 350) + '...');
  console.log('============================\n');

  // Step 6: Seedream 4.5 Native 生成
  console.log('[Step 6] 调用 Seedream 4.5 生成换脸图...');
  console.log(`  images[0]: ${tpl.file} (底图/Image 1)`);
  console.log(`  images[1]: 用户照片 (Image 2)`);
  console.log(`  size: ${cli.size}  strength: ${cli.strength}  guidance: ${cli.guidanceScale}`);

  const t0 = Date.now();
  try {
    const result = await generateNativeImage({
      prompt,
      negative_prompt,
      images:       [templateBase64, userBase64],  // Image 1=底图, Image 2=用户照片
      size:         cli.size,
      scene_params: { strength: cli.strength, guidance_scale: cli.guidanceScale },
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n生成成功 (${elapsed}s)`);
    console.log(`URL: ${result.url.substring(0, 100)}...`);

    // 下载保存
    const genderTag = gender === 'female' ? 'F' : 'M';
    const ts        = Date.now();
    const localFile = path.join(OUTPUT_DIR, `scene3_s${String(cli.strength).replace('.','')}_${genderTag}_${ts}.jpg`);
    await downloadFile(result.url, localFile);
    console.log(`已保存: ${path.basename(localFile)}`);

    // Step 7: 背景 logo 还原（若模板配置了 restoreBgRatio）
    let finalFile = localFile;
    if (tpl.restoreBgRatio) {
      console.log('\n[Step 7a] 从底图还原顶部横幅 logo...');
      try {
        const bgFixedFile = localFile.replace('.jpg', '_bgfix.jpg');
        await restoreBackground(templatePath, localFile, bgFixedFile, tpl.restoreBgRatio);
        finalFile = bgFixedFile;
      } catch (err) {
        console.warn(`  背景还原失败（跳过）: ${err.message}`);
      }
    }

    // Step 7b: 头部缩小后处理（默认关闭，用 --shrink 开启）
    if (cli.shrink) {
      console.log('\n[Step 7] 头部缩小后处理...');
      try {
        console.log(`  检测 ${tpl.targetDesc} 的头部位置...`);
        const bbox = await detectFaceBbox(localFile, tpl.targetPerson);
        console.log(`  头部坐标: cx=${bbox.cx.toFixed(3)} cy=${bbox.cy.toFixed(3)} w=${bbox.w.toFixed(3)} h=${bbox.h.toFixed(3)}`);
        const shrunkFile = localFile.replace('.jpg', '_shrunk.jpg');
        await shrinkHeadInImage(localFile, shrunkFile, bbox, 0.92);
        finalFile = shrunkFile;
        console.log(`  后处理完成: ${path.basename(shrunkFile)}`);
      } catch (err) {
        console.warn(`  头部后处理失败（跳过）: ${err.message}`);
      }
    } else {
      console.log('\n[Step 7] 头部缩小后处理已跳过（默认关闭，传 --shrink 开启）');
    }

    // 保存日志
    const logFile = path.join(PROMPT_LOG_DIR, `scene3_native_${genderTag}_${ts}.json`);
    fs.writeFileSync(logFile, JSON.stringify({
      test_time:        new Date().toISOString(),
      mode:             'faceswap_native',
      scene:            'scene_03',
      gender,
      gender_label:     genderLabel,
      user_photo:       path.basename(cli.userPhotoPath),
      template_file:    tpl.file,
      target_person:    tpl.targetPerson,
      target_desc:      tpl.targetDesc,
      user_description: userDescription,
      prompt,
      negative_prompt,
      api_params: {
        model:          process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128',
        size:           cli.size,
        strength:       cli.strength,
        guidance_scale: cli.guidanceScale,
      },
      result: { elapsed, url: result.url, localFile: path.basename(localFile), finalFile: path.basename(finalFile), status: 'ok' },
    }, null, 2), 'utf8');
    console.log(`日志: ${path.basename(logFile)}`);

    console.log('\n========================================');
    console.log('测试完成');
    console.log('========================================');
    console.log(`用户性别: ${genderLabel}`);
    console.log(`使用底图: ${tpl.file}`);
    console.log(`替换位置: ${tpl.targetDesc}`);
    console.log(`耗时: ${elapsed}s`);
    console.log(`原始输出: ${path.basename(localFile)}`);
    console.log(`最终输出: ${path.basename(finalFile)}`);

  } catch (err) {
    console.error(`\n生成失败 (${((Date.now() - t0)/1000).toFixed(1)}s): ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n测试出错:', err.message);
  process.exit(1);
});
