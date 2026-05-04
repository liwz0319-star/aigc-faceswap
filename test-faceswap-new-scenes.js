/**
 * 新底图 Faceswap 本地直测脚本（支持批量多照片）
 *
 * 用法：
 *   node test-faceswap-new-scenes.js photo1.jpg photo2.jpg ...  # 多照片批量
 *   node test-faceswap-new-scenes.js photo.jpg --scene 1        # 单场景
 *   node test-faceswap-new-scenes.js photo.jpg --gender female   # 强制性别
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

const axios = require(path.join(SERVER_DIR, 'node_modules', 'axios'));
const sharp = require(path.join(SERVER_DIR, 'node_modules', 'sharp'));
const { generateNativeImage }    = require('./server/src/seedreamNativeClient');
const { buildFaceswapPrompt }    = require('./server/src/promptBuilder_faceswap');
const { describeUserAppearance } = require('./server/src/visionClient');

// ============================================================
// 配置
// ============================================================
const NEW_TEMPLATE_DIR = path.join(__dirname, '素材', '新场景底图');
const OUTPUT_DIR       = path.join(__dirname, '生成测试', 'new_scenes_output');

const DEFAULT_PHOTOS = [
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/1.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/2c53f3a8dc145eb8c27508d295e0debd.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/9dc96094e00c595a6395bf0c683401d5.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/394643d89fde950301c986251894d683.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/image.png',
];

const SCENE_CONFIGS = {
  '1': {
    male: {
      file: '场景1男.png', targetPerson: 'the only person in the image',
      templateType: 'mannequin', size: '1536x2560', strength: 0.35, guidance: 10,
      label: '场景1男（更衣室）',
    },
    female: {
      file: '场景1女.png', targetPerson: 'the only person in the image',
      templateType: 'mannequin', size: '1536x2560', strength: 0.35, guidance: 10,
      label: '场景1女（更衣室）',
    },
  },
  '2': {
    male: {
      file: '场景2.jpg', targetPerson: 'the only person in the image',
      templateType: 'mannequin', size: '1536x2560', strength: 0.35, guidance: 10,
      label: '场景2（球场举旗）',
    },
  },
  '4': {
    male: {
      file: '场景4男.png', targetPerson: 'the person on the far left',
      templateType: 'faceswap', size: '2560x1536', strength: 0.45, guidance: 10,
      refScale: 0.46,
      refCrop: { width: 0.74, height: 0.60, offsetX: 0.5, offsetY: 0.02 },
      label: '场景4男（啤酒节，替换最左侧）',
    },
  },
};

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function toHeadReferenceDataUrl(filePath, scale = 1, crop = null) {
  if ((!scale || scale >= 0.999) && !crop) return toBase64DataUrl(filePath);

  const p = filePath.replace(/\\/g, '/');
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
             : ext === 'png' ? 'image/png' : `image/${ext}`;
  const input = fs.readFileSync(p);
  const meta = await sharp(input).metadata();
  const canvasW = meta.width || 1024;
  const canvasH = meta.height || 1024;

  let subject = input;
  if (crop) {
    const cropW = Math.max(1, Math.min(canvasW, Math.round(canvasW * clamp(crop.width ?? 1, 0.1, 1))));
    const cropH = Math.max(1, Math.min(canvasH, Math.round(canvasH * clamp(crop.height ?? 1, 0.1, 1))));
    const left = Math.round(clamp((canvasW - cropW) * (crop.offsetX ?? 0.5), 0, Math.max(0, canvasW - cropW)));
    const top = Math.round(clamp((canvasH - cropH) * (crop.offsetY ?? 0), 0, Math.max(0, canvasH - cropH)));
    subject = await sharp(input).extract({ left, top, width: cropW, height: cropH }).toBuffer();
  }

  const resolvedScale = (!scale || scale >= 0.999) ? 1 : scale;
  const boxW = Math.max(1, Math.round(canvasW * resolvedScale));
  const boxH = Math.max(1, Math.round(canvasH * resolvedScale));
  const scaled = await sharp(subject)
    .resize(boxW, boxH, { fit: 'inside' })
    .toBuffer();
  const scaledMeta = await sharp(scaled).metadata();
  const innerW = scaledMeta.width || boxW;
  const innerH = scaledMeta.height || boxH;
  const left = Math.round((canvasW - innerW) * 0.5);
  const top = Math.round((canvasH - innerH) * 0.08);

  const out = await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: scaled, left, top }])
    .jpeg({ quality: 95 })
    .toBuffer();

  return `data:${mime};base64,${out.toString('base64')}`;
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

function parseCliArgs(argv) {
  const opts = { photos: [], gender: null, scenes: null };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if      (argv[i] === '--gender') { opts.gender = argv[++i] || null; }
    else if (argv[i] === '--scene')  { opts.scenes = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean); }
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

// 单张照片 × 单个场景
async function runOneTest({ photoPath, photoTag, sceneId, gender, userBase64, userDescription }) {
  const sceneConf  = SCENE_CONFIGS[sceneId];
  if (!sceneConf) return { photoTag, sceneId, status: 'skip', error: '场景未配置' };

  const tplConf    = sceneConf[gender] || sceneConf['male'];
  const templatePath = path.join(NEW_TEMPLATE_DIR, tplConf.file);

  if (!fs.existsSync(templatePath)) {
    return { photoTag, sceneId, label: tplConf.label, status: 'skip', error: '底图文件不存在' };
  }

  const templateBase64 = toBase64DataUrl(templatePath);
  const userRefBase64 = (tplConf.refCrop || (tplConf.refScale && tplConf.refScale < 0.999))
    ? await toHeadReferenceDataUrl(photoPath, tplConf.refScale ?? 1, tplConf.refCrop)
    : userBase64;
  const { prompt, negative_prompt } = buildFaceswapPrompt({
    targetPerson:  tplConf.targetPerson,
    userDescription,
    gender,
    templateType:  tplConf.templateType,
  });

  const t0 = Date.now();
  try {
    const result = await generateNativeImage({
      prompt, negative_prompt,
      images: [templateBase64, userRefBase64],
      size:   tplConf.size,
      scene_params: { strength: tplConf.strength, guidance_scale: tplConf.guidance },
    });

    const elapsed   = ((Date.now() - t0) / 1000).toFixed(1);
    const gTag      = gender === 'female' ? 'F' : 'M';
    const ts        = Date.now();
    const localFile = path.join(OUTPUT_DIR, `scene${sceneId}_${tplConf.templateType}_${gTag}_${photoTag}_${ts}.jpg`);
    await downloadFile(result.url, localFile);

    console.log(`  [✓] 场景${sceneId} ${tplConf.label} → ${path.basename(localFile)} (${elapsed}s)`);
    return { photoTag, sceneId, label: tplConf.label, elapsed, localFile: path.basename(localFile), status: 'ok' };
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const msg     = err.response?.data ? JSON.stringify(err.response.data).substring(0, 120) : err.message;
    console.error(`  [✗] 场景${sceneId} ${tplConf.label} 失败 (${elapsed}s): ${msg}`);
    return { photoTag, sceneId, label: tplConf.label, elapsed, status: 'failed', error: msg };
  }
}

// 单张照片跑所有场景（串行，避免同一照片并发检测）
async function runPhotoAllScenes({ photoPath, sceneIds, forceGender }) {
  const photoTag = path.basename(photoPath, path.extname(photoPath)).substring(0, 8);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`照片: ${path.basename(photoPath)}`);

  const userBase64 = toBase64DataUrl(photoPath);

  // 外貌描述 + 性别检测（每张照片只做一次）
  let userDescription = '';
  try {
    userDescription = await describeUserAppearance([userBase64]);
    console.log(`  外貌: ${userDescription.substring(0, 80)}...`);
  } catch (e) { console.warn(`  外貌解读失败: ${e.message}`); }

  const gender = forceGender || await detectGender(userBase64);
  console.log(`  性别: ${gender}`);

  const results = [];
  for (const sceneId of sceneIds) {
    const r = await runOneTest({ photoPath, photoTag, sceneId, gender, userBase64, userDescription });
    results.push(r);
  }
  return results;
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const cli     = parseCliArgs(process.argv.slice(2));
  const sceneIds = cli.scenes || Object.keys(SCENE_CONFIGS);

  console.log('='.repeat(50));
  console.log('新底图 Faceswap 批量测试');
  console.log('='.repeat(50));
  console.log(`照片数: ${cli.photos.length}  场景: ${sceneIds.join(', ')}  共 ${cli.photos.length * sceneIds.length} 个任务`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const t_total  = Date.now();
  const allResults = [];

  // 每张照片并行跑（照片间并行，场景内串行）
  const photoTasks = cli.photos.map(photoPath =>
    runPhotoAllScenes({ photoPath, sceneIds, forceGender: cli.gender })
      .then(r => allResults.push(...r))
      .catch(err => console.error(`照片处理失败 ${photoPath}: ${err.message}`))
  );
  await Promise.all(photoTasks);

  // 汇总
  const elapsed  = ((Date.now() - t_total) / 1000).toFixed(1);
  const ok       = allResults.filter(r => r.status === 'ok').length;
  const failed   = allResults.filter(r => r.status === 'failed').length;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`汇总：${ok} 成功 / ${failed} 失败  总耗时 ${elapsed}s`);
  console.log(`输出目录: ${OUTPUT_DIR}`);
  console.log('='.repeat(50));

  allResults.forEach(r => {
    const tag = r.status === 'ok' ? '✓' : r.status === 'skip' ? '-' : '✗';
    const info = r.status === 'ok' ? r.localFile : (r.error || '');
    console.log(`[${tag}] ${r.photoTag} 场景${r.sceneId}  ${info}`);
  });
}

main().catch(err => { console.error('测试出错:', err.message); process.exit(1); });
