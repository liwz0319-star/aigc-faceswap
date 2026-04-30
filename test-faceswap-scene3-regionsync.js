/**
 * Faceswap 场景3 + RegionSync 测试脚本
 *
 * 在原有 test-faceswap-scene3.js 流程基础上，生成完成后追加 RegionSync 后处理：
 *   以原始模板图为画布，只把 editRegions 区域从 Seedream 生成图贴回。
 *   这同时解决了原来需要 restoreBackground() 还原 PAULANER 横幅 logo 的问题——
 *   editRegions 之外的像素（包括顶部横幅）天然来自模板，无需额外步骤。
 *
 * 原有 test-faceswap-scene3.js 不受任何影响。
 *
 * 用法:
 *   node test-faceswap-scene3-regionsync.js                    # 默认照片，自动检测性别
 *   node test-faceswap-scene3-regionsync.js "照片/xxx.jpg"     # 指定照片
 *   node test-faceswap-scene3-regionsync.js --gender male      # 强制性别
 *   node test-faceswap-scene3-regionsync.js --strength 0.35    # 调整强度
 *   node test-faceswap-scene3-regionsync.js --shrink           # 开启头部缩小（先缩小再回贴）
 *   node test-faceswap-scene3-regionsync.js --no-region-sync   # 跳过 RegionSync
 *
 * 输出（同一 timestamp 方便对比）:
 *   生成测试/faceswap_output/scene3_rs_generated_<G>_<ts>.jpg  ← Seedream 整图
 *   生成测试/faceswap_output/scene3_rs_final_<G>_<ts>.jpg      ← RegionSync 最终图（交付用）
 */

const fs   = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, 'server');

// 解析 server/.env
fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

if (!process.env.VISION_API_KEY && process.env.SEEDREAM_NATIVE_API_KEY) {
  process.env.VISION_API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
}

require('module').Module.globalPaths.push(path.join(SERVER_DIR, 'node_modules'));

const { generateNativeImage }        = require('./server/src/seedreamNativeClient');
const { buildFaceswapPrompt }        = require('./server/src/promptBuilder_faceswap');
const { describeUserAppearance }     = require('./server/src/visionClient');
const { composeEditRegionsOverBase } = require('./server/src/regionComposer');
const axios = require(path.join(SERVER_DIR, 'node_modules', 'axios'));
const sharp = require(path.join(SERVER_DIR, 'node_modules', 'sharp'));

const faceswapRegions = require('./server/src/data/faceswapRegions.json');

// ============================================================
// 场景3 模板配置（与 test-faceswap-scene3.js 一致）
// ============================================================
const RELAY_DIR          = path.join(__dirname, '生成测试', 'relay_test');
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '生成测试', 'faceswap_output');
const PROMPT_LOG_DIR     = path.join(__dirname, '生成测试', 'prompt_logs');

const SCENE3_TEMPLATES = {
  male: {
    file:            'scene3-M.jpg',
    targetPerson:    'the second person from the left (the fan with Asian appearance, standing second from left)',
    targetDesc:      '左数第2位（亚洲面孔球迷）',
    description:     '男球迷模板',
    compositionNote: 'This photo has exactly 5 persons from left to right: [1] goalkeeper in green jersey, [2] the fan (Asian appearance, red jersey) whose right arm is extended sideways to touch the bear mascot\'s raised paw in a high-five, [3] tall black player in red jersey, [4] bear mascot in red jersey, [5] black player in red jersey.',
    poseNote:        'POSE LOCK: The fan (second from left) must keep their right arm extended sideways at shoulder level, palm facing the bear mascot, performing a high-five. IDENTICAL to Image 1. Do NOT raise the arm upward.',
    backgroundNote:  'Background contains horizontal PAULANER banner strips spelled exactly "PAULANER" in white text on blue background, repeated across the top of the image. No circular FC Bayern logos in the background.',
    regionKey:       'scene3_male',
    defaultStrength: 0.35,
    holeMinX:        0.27,  // 守门员紧邻球迷左边，左边界不低于此值（约守门员右边缘+余量）
  },
  female: {
    file:            'scene3-F.jpg',
    targetPerson:    'the third person from the left (the fan standing in the middle)',
    targetDesc:      '左数第3位（中间的女球迷）',
    description:     '女球迷模板',
    compositionNote: 'This photo has exactly 5 persons from left to right: [1] black player in red jersey, [2] black player in red jersey, [3] the fan (female, red jersey) whose right arm is extended sideways to touch the bear mascot\'s raised paw in a high-five, [4] bear mascot in red jersey, [5] goalkeeper in green jersey.',
    poseNote:        'POSE LOCK: The fan (third from left) must keep their right arm extended sideways at shoulder level, palm facing the bear mascot, performing a high-five. IDENTICAL to Image 1. Do NOT raise the arm upward.',
    backgroundNote:  'Background contains horizontal PAULANER banner strips spelled exactly "PAULANER" in white text on blue background, repeated across the top and sides of the image. There is a large PAULANER billboard on the left side. No circular FC Bayern logos anywhere in the background.',
    regionKey:       'scene3_female',
    defaultStrength: 0.30,
    cyMax:           0.50,  // 球迷脸 cy > 此值说明生成图构图严重偏离，跳过 RegionSync
  },
};

const DEFAULT_SIZE     = '2048x2560';
const DEFAULT_STRENGTH = 0.35;
const DEFAULT_GUIDANCE = 10;
const DEFAULT_USER_PHOTO = 'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/efd3b40c22f3aefc65349fdd4a768d59.jpg';

// ============================================================
// 工具函数（与原有 scene3 脚本完全一致）
// ============================================================

function toBase64DataUrl(filePath) {
  const p   = filePath.replace(/\\/g, '/');
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
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
 * 头部缩小（与 test-faceswap-scene3.js 中的 shrinkHeadInImage 完全一致）
 */
async function shrinkHeadInImage(srcPath, destPath, bbox, scale = 0.92) {
  const meta = await sharp(srcPath).metadata();
  const W = meta.width, H = meta.height;

  const margin = 1.5;
  const hw = Math.round(bbox.w * W * margin);
  const hh = Math.round(bbox.h * H * margin);
  const hx = Math.max(0, Math.round(bbox.cx * W - hw / 2));
  const hy = Math.max(0, Math.round(bbox.cy * H - hh / 2));
  const safeW = Math.min(hw, W - hx);
  const safeH = Math.min(hh, H - hy);

  const headBuf   = await sharp(srcPath).extract({ left: hx, top: hy, width: safeW, height: safeH }).toBuffer();
  const newW      = Math.round(safeW * scale);
  const newH      = Math.round(safeH * scale);
  const scaledBuf = await sharp(headBuf).resize(newW, newH).toBuffer();

  const blurRadius = Math.max(4, Math.round(Math.min(newW, newH) * 0.06));
  const innerW = Math.max(1, newW - blurRadius * 2);
  const innerH = Math.max(1, newH - blurRadius * 2);
  const maskBuf = await sharp({
    create: { width: innerW, height: innerH, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .extend({ top: blurRadius, bottom: blurRadius, left: blurRadius, right: blurRadius, background: { r: 0, g: 0, b: 0 } })
    .blur(blurRadius)
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const scaledRaw = await sharp(scaledBuf).raw().toBuffer({ resolveWithObject: true });
  const alpha = maskBuf.data;
  const rgb   = scaledRaw.data;
  const rgba  = Buffer.allocUnsafe(newW * newH * 4);
  for (let i = 0; i < newW * newH; i++) {
    rgba[i * 4]     = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }
  const maskedBuf = await sharp(rgba, { raw: { width: newW, height: newH, channels: 4 } }).png().toBuffer();

  const offsetX = hx + Math.round((safeW - newW) / 2);
  const offsetY = hy + Math.round((safeH - newH) / 2);
  await sharp(srcPath)
    .composite([{ input: maskedBuf, left: offsetX, top: offsetY, blend: 'over' }])
    .jpeg({ quality: 95 })
    .toFile(destPath);
  console.log(`  [shrinkHead] 已保存: ${path.basename(destPath)}`);
}

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
          `Return ONLY a JSON object with these fields (all values 0.0 to 1.0): ` +
          `{"cx": <horizontal center>, "cy": <vertical center>, "w": <width of head>, "h": <height of head>}. ` +
          `No explanation, no markdown, just the JSON.`
        },
      ],
    }],
    max_tokens: 60,
    temperature: 0.1,
  }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 15000 });

  const raw   = (res.data?.choices?.[0]?.message?.content || '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`视觉模型返回格式不正确: ${raw}`);
  return JSON.parse(match[0]);
}

function parseCliArgs(argv) {
  const opts = {
    userPhotoPath: DEFAULT_USER_PHOTO,
    gender:        null,
    size:          DEFAULT_SIZE,
    strength:      DEFAULT_STRENGTH,
    guidanceScale: DEFAULT_GUIDANCE,
    shrink:        false,
    regionSync:    true,
    outputDir:     null,
    _strengthFromCli: false,
  };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if      (arg === '--gender')         { opts.gender        = argv[++i] || null; }
    else if (arg === '--size')           { opts.size          = argv[++i] || DEFAULT_SIZE; }
    else if (arg === '--strength')       { opts.strength = parseFloat(argv[++i]); opts._strengthFromCli = true; }
    else if (arg === '--guidance')       { opts.guidanceScale = parseFloat(argv[++i]); }
    else if (arg === '--shrink')         { opts.shrink = true; }
    else if (arg === '--no-region-sync') { opts.regionSync = false; }
    else if (arg === '--output-dir')     { opts.outputDir = argv[++i] || null; }
    else if (!arg.startsWith('--'))      { pos.push(arg); }
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
        { type: 'text', text: 'Look at this person photo and infer gender presentation conservatively. Reply with ONLY one word: "male", "female", or "unknown". Use "unknown" unless visually clear and high-confidence.' },
      ],
    }],
    max_tokens: 10,
    temperature: 0.1,
  }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 15000 });

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
  console.log('Faceswap 场景3 + RegionSync 测试');
  console.log('========================================');
  const OUTPUT_DIR = cli.outputDir
    ? path.resolve(cli.outputDir)
    : DEFAULT_OUTPUT_DIR;

  console.log(`用户照片  : ${path.basename(cli.userPhotoPath)}`);
  console.log(`RegionSync: ${cli.regionSync ? '开启' : '关闭（--no-region-sync）'}`);
  console.log(`头部缩小  : ${cli.shrink ? '开启（--shrink）' : '关闭'}`);
  console.log(`输出目录  : ${OUTPUT_DIR}`);

  if (!fs.existsSync(OUTPUT_DIR))     fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(PROMPT_LOG_DIR)) fs.mkdirSync(PROMPT_LOG_DIR, { recursive: true });

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
    catch (err) { console.warn(`性别检测失败，默认男性: ${err.message}`); gender = 'male'; }
    if (gender === 'unknown') { console.log('[性别检测] 无法确定，默认男性'); gender = 'male'; }
  }
  const genderLabel = gender === 'female' ? '女性' : '男性';
  console.log(`[性别检测] 结果: ${genderLabel}`);

  // Step 3: 选择底图
  const tpl          = SCENE3_TEMPLATES[gender];
  const templatePath = path.join(RELAY_DIR, tpl.file);
  if (!cli._strengthFromCli && tpl.defaultStrength) cli.strength = tpl.defaultStrength;
  console.log(`\n[Step 3] 底图: ${tpl.file}  替换: ${tpl.targetDesc}  strength: ${cli.strength}`);
  if (!fs.existsSync(templatePath)) {
    console.error(`底图不存在: ${templatePath}`); process.exit(1);
  }

  // Step 4: 视觉模型解读外貌
  console.log('\n[Step 4] 视觉模型解读外貌...');
  let userDescription = '';
  try {
    userDescription = await describeUserAppearance([userBase64]);
    console.log(`外貌描述: ${userDescription.substring(0, 120)}...`);
  } catch (err) { console.warn(`外貌解读失败，跳过: ${err.message}`); }

  // Step 4.5: 专项发型检测
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
          '(2) fringe/bangs — choose EXACTLY ONE: "no bangs: forehead fully exposed" OR "natural soft fringe: hair loosely touches forehead, not uniformly cut, individual strands visible" OR "straight bowl-cut fringe: hair precisely and uniformly cut straight across the ENTIRE forehead in one clean horizontal line (true bowl cut / mushroom cut)" OR "side-swept fringe: fringe swept to one side". Be CONSERVATIVE — only use "straight bowl-cut fringe" if the fringe is a clear precise uniform cut across the full forehead. A mild or soft fringe is NOT a bowl-cut fringe. ' +
          '(3) parting style (no parting / left part / right part / center part), ' +
          '(4) overall silhouette (e.g. textured/messy, slicked-back, layered, undercut, etc. — do NOT say bowl-shaped unless it truly is a bowl cut). ' +
          'Be factual. One sentence only. English.'
        },
      ]}],
      max_tokens: 80,
      temperature: 0.1,
    }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VISION_KEY}` }, timeout: 15000 });
    hairstyleNote = (hairstyleRes.data?.choices?.[0]?.message?.content || '').trim();
    console.log(`发型描述: ${hairstyleNote}`);
  } catch (err) { console.warn(`发型检测失败，跳过: ${err.message}`); }

  // Step 5: 构建 Prompt
  console.log('\n[Step 5] 构建 Prompt...');
  const [outW, outH] = cli.size.split('x').map(Number);
  const tplMeta = await sharp(templatePath).metadata();
  const scaledTplBuf = await sharp(templatePath)
    .resize(outW, outH, { fit: 'fill', kernel: 'lanczos3' })
    .jpeg({ quality: 95 })
    .toBuffer();
  const templateBase64 = `data:image/jpeg;base64,${scaledTplBuf.toString('base64')}`;
  console.log(`  模板已上采样: ${tplMeta.width}x${tplMeta.height} → ${outW}x${outH}`);

  const { prompt: basePrompt, negative_prompt } = buildFaceswapPrompt({
    targetPerson:    tpl.targetPerson,
    userDescription: userDescription,
    hairstyleNote:   hairstyleNote,
    compositionNote: tpl.compositionNote,
    backgroundNote:  tpl.backgroundNote,
    gender,
  });
  const prompt = tpl.poseNote ? basePrompt + '\n' + tpl.poseNote : basePrompt;

  // Step 6: Seedream 生成
  console.log(`\n[Step 6] 调用 Seedream 生成...  size=${cli.size}  strength=${cli.strength}`);
  const ts = Date.now();
  const genderTag = gender === 'female' ? 'F' : 'M';
  const t0 = Date.now();
  let result;
  try {
    result = await generateNativeImage({
      prompt,
      negative_prompt,
      images:       [templateBase64, userBase64],
      size:         cli.size,
      scene_params: { strength: cli.strength, guidance_scale: cli.guidanceScale },
    });
  } catch (err) {
    console.error(`\n生成失败: ${err.message}`); process.exit(1);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n生成成功 (${elapsed}s)`);

  // 下载 Seedream 整图
  const generatedFile = path.join(OUTPUT_DIR, `scene3_rs_generated_${genderTag}_${ts}.jpg`);
  await downloadFile(result.url, generatedFile);
  console.log(`[原始整图] 已保存: ${path.basename(generatedFile)}`);

  // Step 7a: 自动头部检测 + 大头自动缩小
  // 原理：Seedream 有时会生成不成比例的大头（bbox.h > 0.16，正常约 0.11~0.14）。
  // 自动检测后：
  //   - 大头（h > HEAD_THRESHOLD）：按 HEAD_TARGET/h 比例缩小，使头高回到正常范围。
  //   - 手动 --shrink：强制以 0.92 缩小，不论大小。
  // 同时将检测到的 bbox 保存，供 Step 7b RegionSync 动态定位时复用（避免重复 API 调用）。
  let patchSource   = generatedFile;
  let detectedBbox  = null;  // 供 Step 7b 复用，null 时 Step 7b 自行检测
  console.log('\n[Step 7a] 头部检测（自动大头缩小）...');
  try {
    detectedBbox = await detectFaceBbox(generatedFile, tpl.targetPerson);
    console.log(`  头部坐标: cx=${detectedBbox.cx.toFixed(3)} cy=${detectedBbox.cy.toFixed(3)} w=${detectedBbox.w.toFixed(3)} h=${detectedBbox.h.toFixed(3)}`);

    const HEAD_THRESHOLD = gender === 'female' ? 0.14 : 0.16;  // 女性 0.14，男性 0.16
    const HEAD_TARGET    = 0.13;  // 目标正常头高

    if (detectedBbox.h > HEAD_THRESHOLD) {
      // 自动大头缩小：scale = 目标头高 / 检测头高
      const autoScale = HEAD_TARGET / detectedBbox.h;
      console.log(`  [自动缩头] 检测到大头 h=${detectedBbox.h.toFixed(3)} > ${HEAD_THRESHOLD}，自动缩小 scale=${autoScale.toFixed(3)}`);
      const shrunkFile = path.join(OUTPUT_DIR, `scene3_rs_shrunk_${genderTag}_${ts}.jpg`);
      await shrinkHeadInImage(generatedFile, shrunkFile, detectedBbox, autoScale);
      patchSource  = shrunkFile;
      // 缩头后用估算 bbox（cx/cy 基本不变，w/h 按缩放比例减小）
      // 不重新检测，避免缩头后视觉模型定位到错误目标（构图变形时概率较高）
      detectedBbox = {
        cx: detectedBbox.cx,
        cy: detectedBbox.cy,
        w:  +(detectedBbox.w * autoScale).toFixed(4),
        h:  +(detectedBbox.h * autoScale).toFixed(4),
      };
      console.log(`  [缩头后估算bbox] cx=${detectedBbox.cx.toFixed(3)} cy=${detectedBbox.cy.toFixed(3)} w=${detectedBbox.w.toFixed(3)} h=${detectedBbox.h.toFixed(3)}`);
    } else if (cli.shrink) {
      // 手动 --shrink：强制以 0.92 缩小（调试用）
      console.log(`  [手动缩头] --shrink 参数，scale=0.92`);
      const shrunkFile = path.join(OUTPUT_DIR, `scene3_rs_shrunk_${genderTag}_${ts}.jpg`);
      await shrinkHeadInImage(generatedFile, shrunkFile, detectedBbox, 0.92);
      patchSource  = shrunkFile;
      detectedBbox = null;  // 缩头后重新检测
    } else {
      console.log(`  [头部正常] h=${detectedBbox.h.toFixed(3)} ≤ ${HEAD_THRESHOLD}，无需缩头`);
    }
  } catch (err) {
    console.warn(`  头部检测失败（跳过缩头）: ${err.message}`);
  }

  // Step 7b: RegionSync 后处理
  let finalFile = patchSource;
  if (cli.regionSync) {
    console.log('\n[Step 7b] RegionSync 后处理...');
    // 说明：RegionSync 以模板为底图，只把 editRegions 区域从 patchSource 贴回
    // 这自动解决了 PAULANER 横幅 logo 被改的问题（横幅在 editRegions 之外，天然来自模板）
    const regionCfg = faceswapRegions[tpl.regionKey];
    if (!regionCfg) {
      console.warn(`[RegionSync] 未找到配置 key="${tpl.regionKey}"，跳过`);
    } else {
      try {
        finalFile = path.join(OUTPUT_DIR, `scene3_rs_final_${genderTag}_${ts}.jpg`);

        // ── 动态检测：在生成图中定位球迷实际人脸位置 ──────────────────────
        // 优先复用 Step 7a 检测结果（若未缩头），否则重新检测 patchSource
        let regions = regionCfg.editRegions; // 默认回退静态配置
        console.log('  [动态检测] 定位球迷实际人脸...');
        try {
          const bbox = detectedBbox || await detectFaceBbox(patchSource, tpl.targetPerson);
          console.log(`  [动态检测] cx=${bbox.cx.toFixed(3)} cy=${bbox.cy.toFixed(3)} w=${bbox.w.toFixed(3)} h=${bbox.h.toFixed(3)}`);

          // 验证 bbox 合理性（零值/过小时回退静态配置）
          if (!bbox.w || !bbox.h || bbox.w < 0.03 || bbox.h < 0.03 || (bbox.cx === 0 && bbox.cy === 0)) {
            throw new Error(`bbox 异常: cx=${bbox.cx} cy=${bbox.cy} w=${bbox.w} h=${bbox.h}，回退静态配置`);
          }
          // cy 超出预期范围：生成图构图严重偏离（球迷脸极度靠下），跳过 RegionSync
          if (tpl.cyMax && bbox.cy > tpl.cyMax) {
            const e = new Error(`生成图构图偏离: cy=${bbox.cy.toFixed(3)} > cyMax=${tpl.cyMax}，跳过RegionSync`);
            e.bypass = true;
            throw e;
          }

          // 核心脸部区域（覆盖发顶、耳侧、下巴+颈部）
          // 左右非对称 padX：右侧正常延伸（覆盖右耳），左侧保守（避免延伸到旁边球员）
          const padXLeft  = bbox.w * 0.15;  // 左侧保守
          const padXRight = bbox.w * 0.45;  // 右侧正常
          const padTop = bbox.h * 0.4;      // 覆盖发顶
          const padBot = bbox.h * 0.3;      // 覆盖下巴+颈部，不深入球衣

          const coreX1 = bbox.cx - bbox.w / 2 - padXLeft;
          const coreY1 = bbox.cy - bbox.h / 2 - padTop;
          const coreX2 = bbox.cx + bbox.w / 2 + padXRight;
          const coreY2 = bbox.cy + bbox.h / 2 + padBot;

          // 向外扩展 fExp（outward feathering）
          const fExp = 0.015;
          // 若模板配置了 holeMinX，左边界夹紧，防覆盖旁边球员脸部
          const rxRaw = Math.max(0, coreX1 - fExp);
          const rx = tpl.holeMinX ? Math.max(rxRaw, tpl.holeMinX) : rxRaw;
          const ry = Math.max(0, coreY1 - fExp);
          const rr = Math.min(1, coreX2 + fExp);
          const rb = Math.min(1, coreY2 + fExp);

          regions = [{
            id:      'target_face_dynamic',
            x:       rx,
            y:       ry,
            width:   rr - rx,
            height:  rb - ry,
            feather: 55,  // featherGen = 55×1.111 ≈ 61px，匹配 fExpPx（向外羽化）
          }];
          console.log(`  [动态检测] core: (${coreX1.toFixed(3)},${coreY1.toFixed(3)})-(${coreX2.toFixed(3)},${coreY2.toFixed(3)})`);
          console.log(`  [动态检测] hole: x=${rx.toFixed(3)} y=${ry.toFixed(3)} w=${(rr-rx).toFixed(3)} h=${(rb-ry).toFixed(3)}`);
        } catch (detectErr) {
          if (detectErr.bypass) {
            console.warn(`  [动态检测] ${detectErr.message}`);
            regions = null;  // 标记：跳过 RegionSync，直接输出生成图
          } else {
            console.warn(`  [动态检测] 失败，回退静态配置: ${detectErr.message}`);
          }
        }
        // ────────────────────────────────────────────────────────────────────

        if (regions === null) {
          // 构图严重偏离时跳过 RegionSync，直接输出生成图（缩头图）
          console.warn('[RegionSync] 已跳过（生成图构图偏离），直接输出生成图');
          finalFile = patchSource;
        } else {
          const syncResult = await composeEditRegionsOverBase({
            sourceImage:     templatePath,  // 模板作为底图画布
            targetImage:     patchSource,   // 生成图（或头部缩小后的图）作为 patch 来源
            outputImage:     finalFile,
            regions,
            restore_regions: [], // 反向遮罩法不需要 restore_regions
          });
          console.log(`[RegionSync] 合成完成 (${syncResult.width}x${syncResult.height})`);
          console.log(`[最终交付图] 已保存: ${path.basename(finalFile)}`);
        }
      } catch (rsErr) {
        console.warn(`[RegionSync] 失败，使用上一步结果: ${rsErr.message}`);
        finalFile = patchSource;
      }
    }
  }

  // 保存日志
  const logFile = path.join(PROMPT_LOG_DIR, `scene3_rs_${genderTag}_${ts}.json`);
  fs.writeFileSync(logFile, JSON.stringify({
    test_time:        new Date().toISOString(),
    mode:             'faceswap+regionsync',
    scene:            'scene_03',
    gender,
    user_photo:       path.basename(cli.userPhotoPath),
    template_file:    tpl.file,
    target_person:    tpl.targetPerson,
    region_key:       tpl.regionKey,
    region_sync:      cli.regionSync,
    shrink:           cli.shrink,
    user_description: userDescription,
    hairstyle_note:   hairstyleNote,
    prompt,
    negative_prompt,
    api_params:       { size: cli.size, strength: cli.strength, guidance_scale: cli.guidanceScale },
    outputs: {
      generated: path.basename(generatedFile),
      final:     path.basename(finalFile),
    },
  }, null, 2), 'utf8');

  // 汇总
  console.log('\n========================================');
  console.log('测试完成');
  console.log('========================================');
  console.log(`性别     : ${genderLabel}`);
  console.log(`底图     : ${tpl.file}`);
  console.log(`耗时     : ${elapsed}s`);
  console.log(`原始整图 : ${path.basename(generatedFile)}`);
  if (cli.regionSync && finalFile !== generatedFile && finalFile !== patchSource) {
    console.log(`最终交付 : ${path.basename(finalFile)}  ← 以此为准`);
  }
  console.log(`Prompt日志: ${path.basename(logFile)}`);
}

main().catch(err => {
  console.error('\n测试出错:', err.message);
  process.exit(1);
});
