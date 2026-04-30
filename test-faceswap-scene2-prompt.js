/**
 * Scene2 换脸 — prompt 引导 i2i（无 mask，同 scene3 方式）
 * 用法: node test-faceswap-scene2-prompt.js [用户照片路径] [--gender male|female]
 */
const fs   = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, 'server');
fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([^#=\s][^=]*)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim();
});
if (!process.env.VISION_API_KEY && process.env.SEEDREAM_NATIVE_API_KEY)
  process.env.VISION_API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
require('module').Module.globalPaths.push(path.join(SERVER_DIR, 'node_modules'));

const { generateNativeImage }       = require('./server/src/seedreamNativeClient');
const { buildFaceswapPrompt }       = require('./server/src/promptBuilder_faceswap');
const { describeUserAppearance }    = require('./server/src/visionClient');
const { composeEditRegionsOverBase } = require('./server/src/regionComposer');
const axios  = require('./server/node_modules/axios');
const sharp  = require('./server/node_modules/sharp');

const RELAY_DIR  = path.join(__dirname, '生成测试', 'relay_test');
const OUTPUT_DIR = path.join(__dirname, '生成测试', '场景2测试13');

const SCENE2_TEMPLATES = {
  male: {
    file:            'scene2-M.jpg',
    targetPerson:    'the third person from the left (the Asian male fan holding a beer)',
    compositionNote: 'This photo has exactly 4 persons from left to right: [1] black player in red jersey, [2] Harry Kane (tall white male, short blond hair, beard, laughing) in red jersey, [3] the fan (Asian male, red jersey, holding beer), [4] player with curly hair and tattoos in red jersey. Harry Kane MUST remain completely unchanged.',
    defaultStrength: 0.25,
    // editRegion: 脸部打洞区域（像素坐标，基于 1126×1397 底图）
    // 扩大区域覆盖不同用户脸部位置的偏差，feather=35 减少背景晕染/飘浮感
    editRegion: { x: 460, y: 220, width: 370, height: 420, feather: 35 },
  },
  female: {
    file:            'scene2-F.png',
    targetPerson:    'the third person from the left (the female fan holding a beer)',
    compositionNote: 'This photo has exactly 4 persons from left to right: [1] black player in red jersey, [2] Harry Kane (tall white male, short blond hair, beard, laughing) in red jersey, [3] the fan (female, red jersey, holding beer, wearing GLASSES in the original), [4] player with curly hair in red jersey. Harry Kane MUST remain completely unchanged.',
    defaultStrength: 0.38,
    // editRegion: 脸部打洞区域（像素坐标，基于 1126×1397 底图）
    editRegion: { x: 440, y: 235, width: 370, height: 420, feather: 35 },
  },
};

const DEFAULT_USER_PHOTO = 'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/1.jpg';

function toB64(p) {
  const buf = fs.readFileSync(p.replace(/\\/g, '/'));
  const ext = path.extname(p).slice(1).toLowerCase();
  return 'data:' + (ext === 'png' ? 'image/png' : 'image/jpeg') + ';base64,' + buf.toString('base64');
}

/**
 * 用视觉 API 检测用户脸部 bbox，裁剪出纯脸部图片（base64）
 * 目的：去除用户服装信息，防止模型把用户衣服也替换进底图
 */
async function cropFaceOnly(userB64, userPhotoPath) {
  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  try {
    const res = await axios.post(url, {
      model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: userB64 } },
        { type: 'text', text:
          'Locate the face (head region including hair) of the main person in this photo. ' +
          'Return ONLY JSON: {"cx": <0-1>, "cy": <0-1>, "w": <0-1>, "h": <0-1>} as fractions of image size. No markdown.'
        },
      ]}],
      max_tokens: 60, temperature: 0.1,
    }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.VISION_API_KEY}` }, timeout: 15000 });
    const raw = (res.data?.choices?.[0]?.message?.content || '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no json: ' + raw);
    const bbox = JSON.parse(match[0]);

    const meta = await sharp(userPhotoPath.replace(/\\/g, '/')).metadata();
    const W = meta.width, H = meta.height;
    const margin = 1.6; // 给头发/下巴留余量
    const fw = Math.round(bbox.w * W * margin);
    const fh = Math.round(bbox.h * H * margin);
    const fx = Math.max(0, Math.round(bbox.cx * W - fw / 2));
    const fy = Math.max(0, Math.round(bbox.cy * H - fh / 2));
    const safeW = Math.min(fw, W - fx);
    const safeH = Math.min(fh, H - fy);

    const faceBuf = await sharp(userPhotoPath.replace(/\\/g, '/'))
      .extract({ left: fx, top: fy, width: safeW, height: safeH })
      .jpeg({ quality: 95 })
      .toBuffer();
    console.log(`  [脸部裁剪] bbox=cx${(bbox.cx*100).toFixed(0)}%,cy${(bbox.cy*100).toFixed(0)}% crop=${safeW}x${safeH}`);
    return 'data:image/jpeg;base64,' + faceBuf.toString('base64');
  } catch (e) {
    console.warn('  [脸部裁剪] 失败，使用原图:', e.message);
    return userB64;
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const https = require('https'), http = require('http');
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    client.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { try { fs.unlinkSync(dest); } catch (_) {} reject(err); });
  });
}

// ── 性别检测（更保守，亚洲脸不确定时倾向 unknown）──────────────
async function detectGender(b64) {
  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const res = await axios.post(url, {
    model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: b64 } },
      { type: 'text', text:
        'Look at this person and determine their gender. Be VERY conservative:\n' +
        '- East Asian males often have softer, more androgynous facial features — do NOT classify them as female based on soft features alone.\n' +
        '- Only reply "female" if there are CLEAR feminine indicators (long hair, visible makeup, obviously female body shape).\n' +
        '- If there is ANY doubt, reply "unknown".\n' +
        'Reply ONLY one word: "male", "female", or "unknown".'
      },
    ]}],
    max_tokens: 10, temperature: 0.1,
  }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.VISION_API_KEY}` }, timeout: 15000 });
  const ans = (res.data?.choices?.[0]?.message?.content || '').trim().toLowerCase();
  console.log(`[性别检测] 视觉模型返回: "${ans}"`);
  if (ans.includes('female')) return 'female';
  if (ans.includes('male'))   return 'male';
  return 'unknown';
}

// ── 头部缩小后处理（参考 scene3 shrinkHead）────────────────────
async function detectFaceBbox(imagePath, personDesc) {
  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const b64 = toB64(imagePath);
  const res = await axios.post(url, {
    model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: b64 } },
      { type: 'text', text:
        `In this image, locate the head (face region including hair) of ${personDesc}. ` +
        `Return ONLY a JSON object with these fields (all values 0.0 to 1.0, fraction of image width/height): ` +
        `{"cx": <horizontal center>, "cy": <vertical center>, "w": <width of head>, "h": <height of head>}. No explanation, no markdown.`
      },
    ]}],
    max_tokens: 60, temperature: 0.1,
  }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.VISION_API_KEY}` }, timeout: 15000 });
  const raw = (res.data?.choices?.[0]?.message?.content || '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`视觉模型返回格式不正确: ${raw}`);
  return JSON.parse(match[0]);
}

async function shrinkHeadInImage(srcPath, destPath, bbox, scale = 0.82) {
  const meta = await sharp(srcPath).metadata();
  const W = meta.width, H = meta.height;

  const margin = 1.5;
  const hw = Math.round(bbox.w * W * margin);
  const hh = Math.round(bbox.h * H * margin);
  const hx = Math.max(0, Math.round(bbox.cx * W - hw / 2));
  const hy = Math.max(0, Math.round(bbox.cy * H - hh / 2));
  const safeW = Math.min(hw, W - hx);
  const safeH = Math.min(hh, H - hy);

  console.log(`  [shrinkHead] 头部区域: x=${hx} y=${hy} w=${safeW} h=${safeH}  缩放: ${scale}`);

  const headBuf = await sharp(srcPath).extract({ left: hx, top: hy, width: safeW, height: safeH }).toBuffer();

  const newW = Math.round(safeW * scale);
  const newH = Math.round(safeH * scale);
  const scaledBuf = await sharp(headBuf).resize(newW, newH).toBuffer();

  const blurRadius = Math.max(4, Math.round(Math.min(newW, newH) * 0.06));
  const innerW = Math.max(1, newW - blurRadius * 2);
  const innerH = Math.max(1, newH - blurRadius * 2);
  const maskBuf = await sharp({
    create: { width: innerW, height: innerH, channels: 3, background: { r: 255, g: 255, b: 255 } }
  })
    .extend({ top: blurRadius, bottom: blurRadius, left: blurRadius, right: blurRadius, background: { r: 0, g: 0, b: 0 } })
    .blur(blurRadius).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });

  const scaledRaw = await sharp(scaledBuf).raw().toBuffer({ resolveWithObject: true });
  const alpha = maskBuf.data;
  const rgb   = scaledRaw.data;
  const rgba  = Buffer.allocUnsafe(newW * newH * 4);
  for (let i = 0; i < newW * newH; i++) {
    rgba[i*4]   = rgb[i*3];
    rgba[i*4+1] = rgb[i*3+1];
    rgba[i*4+2] = rgb[i*3+2];
    rgba[i*4+3] = alpha[i];
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

// ── 主流程 ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let userPhoto = DEFAULT_USER_PHOTO, gender = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--gender') gender = args[++i];
    else if (!args[i].startsWith('--')) userPhoto = args[i];
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('=== Scene2 Prompt i2i 换脸 ===');
  console.log('用户照片:', path.basename(userPhoto));

  const userB64 = toB64(userPhoto);

  if (!gender) {
    try { gender = await detectGender(userB64); } catch { gender = 'male'; }
    if (gender === 'unknown') { console.log('[性别检测] 无法确定，默认男性'); gender = 'male'; }
  }
  console.log('性别:', gender === 'female' ? '女性' : '男性');

  const tpl = SCENE2_TEMPLATES[gender];
  const templatePath = path.join(RELAY_DIR, tpl.file);
  console.log('底图:', tpl.file);

  console.log('[1] 解读外貌...');
  let desc = '';
  try {
    desc = await describeUserAppearance([userB64]);
    console.log('外貌:', desc.substring(0, 100) + '...');
  } catch (e) { console.warn('外貌解读失败:', e.message); }

  console.log('[2] 构建 Prompt...');
  const { prompt: basePrompt, negative_prompt } = buildFaceswapPrompt({
    targetPerson:    tpl.targetPerson,
    userDescription: desc,
    compositionNote: tpl.compositionNote,
    gender,
  });
  // 性别特有的关键补充指令
  const genderSpecificInstructions = gender === 'female'
    ? '\n- GLASSES REMOVAL CRITICAL: The user in Image 2 does NOT wear glasses. The replaced fan face MUST NOT have glasses or any eyewear. Remove glasses completely from the replaced person. The final face must be bare-faced without any glasses.'
    : '\n- JERSEY CRITICAL: The replaced fan (third from left) MUST wear the exact same Bayern Munich red jersey as in Image 1 — same cut, same Adidas stripes, same T-Mobile logo, same collar style. Do NOT alter the jersey design, pattern, or color in any way.';

  const prompt = basePrompt +
    '\n- CRITICAL: The Bayern Munich jerseys hanging in the locker compartments in the background must remain exactly as in Image 1 — do NOT remove or omit them.' +
    '\n- CRITICAL: Every person holding a beer glass must keep the beer glass exactly as in Image 1 — do NOT remove, hide, or alter any beer glass.' +
    '\n- CRITICAL: All shoes/boots color and style must remain exactly as in Image 1 — do NOT change shoe color.' +
    '\n- CRITICAL: Harry Kane (second from left, tall white male with short blond hair and beard) must remain completely identical to Image 1 — do NOT alter his face, hair, expression, jersey, or body in any way.' +
    '\n- HEAD SIZE: The replaced head must be the EXACT SAME SIZE as the original fan head in Image 1. Do NOT enlarge the head. Match the exact head-to-body ratio of the original person at that position.' +
    '\n- HAIRSTYLE CRITICAL OVERRIDE: Reproduce EXACTLY the hair visible in Image 2. If Image 2 shows short, slightly messy/natural dark hair with loose strands falling on the forehead — reproduce that exact style. The hair must NOT be a neat flat bowl cut, NOT a blunt straight fringe, NOT a perfectly rounded cap shape. Show natural, slightly tousled hair with individual strands visible.' +
    genderSpecificInstructions;

  console.log('[3] 裁剪用户脸部（去除服装信息）...');
  const userFaceB64 = await cropFaceOnly(userB64, userPhoto);

  console.log('[4] 调用 Seedream i2i (strength=' + tpl.defaultStrength + ')...');
  const t0 = Date.now();
  const result = await generateNativeImage({
    prompt, negative_prompt,
    images: [toB64(templatePath), userFaceB64],
    size: '2048x2560',
    scene_params: { strength: tpl.defaultStrength, guidance_scale: 10 },
  });
  console.log('生成成功 (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');

  const genderTag = gender === 'female' ? 'F' : 'M';
  const ts  = Date.now();
  const rawFile   = path.join(OUTPUT_DIR, 'scene2_' + genderTag + '_' + ts + '_raw.jpg');
  const final     = path.join(OUTPUT_DIR, 'scene2_' + genderTag + '_' + ts + '.jpg');

  // Step A: 下载原始生成图（保留，方便排查问题）
  await downloadFile(result.url, rawFile);
  console.log('原始生成图已下载:', path.basename(rawFile));

  // Step B: 后处理 — 反向遮罩合成
  // 脸部区域打洞（生成图新脸透出），洞外所有像素从底图还原（含酒杯文字）
  console.log('[后处理] 反向遮罩合成（还原酒杯文字/球衣/背景）...');
  await composeEditRegionsOverBase({
    sourceImage: templatePath,
    targetImage: rawFile,
    outputImage: final,
    regions: [{ id: 'fan_face', ...tpl.editRegion }],
  });
  // rawFile 保留，供排查（文件名含 _raw 后缀）

  console.log('最终合成完成:', path.basename(final));
  console.log('路径:', final);
}

main().catch(e => { console.error('错误:', e.message); process.exit(1); });
