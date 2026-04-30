/**
 * 单人裁剪换脸 + 合回底图
 *
 * 流程：
 *   1. 从底图裁出目标球迷上半身区域（单人图）
 *   2. 将裁片放大到 2048×2560（满足 Seedream 最低像素要求）
 *   3. Seedream i2i 换脸（裁片 + 用户照，无 mask，只有一个人不会混淆）
 *   4. 将结果缩回原始裁片尺寸，合回底图
 *   5. 保存最终输出
 */
const fs   = require('fs');
const path = require('path');

fs.readFileSync('.env','utf8').split('\n').forEach(l=>{
  const m=l.match(/^([^#=\s][^=]*)=(.*)$/);if(m)process.env[m[1].trim()]=m[2].trim();
});

const sharp = require('./node_modules/sharp');
const axios = require('./node_modules/axios');

const RELAY_DIR  = path.join(__dirname,'..','生成测试','relay_test');
const OUT_DIR    = path.join(__dirname,'..','生成测试','faceswap_output');
const TEMP_DIR   = path.join(__dirname,'..','生成测试','faceswap_temp');
const PHOTO_DIR  = path.join(__dirname,'..','生成测试','照片');

const API_URL = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
const MODEL   = process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128';

// ── 裁片区域配置（覆盖目标球迷头部+肩膀，视觉确认过）──────────
const CROP_CONFIG = {
  male: {
    file: 'scene_02_user2_1777014143898.png',
    crop: { left: 540, top: 100, width: 270, height: 480 },  // 男球迷: 脸cx=670 cy=380
    faceCrop: { cx: 130, cy: 280, rx: 80, ry: 110 },
  },
  female: {
    file: 'scene_02_1777013168257.png',
    crop: { left: 620, top: 250, width: 300, height: 480 },  // 女球迷: 右移40px+加宽30px，脸cx=700→裁片内cx=80
    faceCrop: { cx: 80, cy: 280, rx: 55, ry: 75 },           // cy=530(原图)-250(crop top)=280；覆盖脸部
  },
};

function toB64(p) {
  const b = fs.readFileSync(p);
  const e = path.extname(p).slice(1).toLowerCase();
  return 'data:' + (e==='png'?'image/png':'image/jpeg') + ';base64,' + b.toString('base64');
}

function bufToB64(buf, mime) {
  return 'data:' + mime + ';base64,' + buf.toString('base64');
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

async function run(gender, userPhotoPath) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const cfg          = CROP_CONFIG[gender];
  const templatePath = path.join(RELAY_DIR, cfg.file);
  const { left, top, width, height } = cfg.crop;

  console.log('[1] 裁出球迷单人图...');
  console.log('    区域: left='+left+' top='+top+' w='+width+' h='+height);

  // Step 1: 裁出球迷
  const cropBuf = await sharp(templatePath)
    .extract({ left, top, width, height })
    .toBuffer();

  // 保存裁片供调试
  const cropDebugPath = path.join(TEMP_DIR, 'crop_'+gender+'.png');
  await sharp(cropBuf).png().toFile(cropDebugPath);
  console.log('    调试裁片: '+path.basename(cropDebugPath));

  // Step 2: 等比缩放到 2048×2560（先补黑边使宽高比 = 0.8，再等倍放大）
  // 这样避免 X/Y 方向不同倍率导致脸部比例失真
  console.log('[2] 等比放大裁片到 2048×2560...');
  const targetAspect = 2048 / 2560;  // 0.8
  const cropAspect   = width / height;
  let padLeft = 0, padRight = 0, padTop = 0, padBottom = 0;
  if (cropAspect < targetAspect) {
    // 裁片太"瘦"，补左右黑边使宽度匹配
    const targetW = Math.round(height * targetAspect);
    padLeft  = Math.floor((targetW - width) / 2);
    padRight = targetW - width - padLeft;
  } else {
    // 裁片太"宽"，补上下黑边
    const targetH = Math.round(width / targetAspect);
    padTop    = Math.floor((targetH - height) / 2);
    padBottom = targetH - height - padTop;
  }
  const paddedBuf = await sharp(cropBuf)
    .extend({ left: padLeft, right: padRight, top: padTop, bottom: padBottom,
              background: { r: 0, g: 0, b: 0 } })
    .toBuffer();
  const paddedMeta = await sharp(paddedBuf).metadata();
  console.log('    补边后尺寸: '+paddedMeta.width+'x'+paddedMeta.height+
              ' (pad l='+padLeft+' r='+padRight+' t='+padTop+' b='+padBottom+')');

  const scaledBuf = await sharp(paddedBuf)
    .resize(2048, 2560, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const scaledB64 = bufToB64(scaledBuf, 'image/png');

  // Step 3: Seedream inpainting（在裁片上用 mask 只替换脸部，保留身体）
  console.log('[3] 调用 Seedream inpainting（裁片脸部 mask）...');
  const userB64 = toB64(userPhotoPath);

  // 裁片内脸部坐标（相对于 crop 左上角，已在 CROP_CONFIG 中配置）
  const fc = cfg.faceCrop;

  // 补边后坐标（加上 padLeft/padTop 偏移）
  const paddedCx = fc.cx + padLeft;
  const paddedCy = fc.cy + padTop;

  // 将补边后坐标等比缩放到输出尺寸 2048×2560
  const oW2 = 2048, oH2 = 2560;
  const scaleX2 = oW2 / paddedMeta.width;
  const scaleY2 = oH2 / paddedMeta.height;
  const mcx2 = Math.round(paddedCx * scaleX2);
  const mcy2 = Math.round(paddedCy * scaleY2);
  const mrx2 = Math.round(fc.rx * scaleX2);
  const mry2 = Math.round(fc.ry * scaleY2);
  console.log('    裁片内脸坐标: cx='+fc.cx+' cy='+fc.cy+' (crop '+width+'x'+height+')');
  console.log('    输出mask坐标: cx='+mcx2+' cy='+mcy2+' rx='+mrx2+' ry='+mry2+' ('+oW2+'x'+oH2+')');

  const maskSvg = '<svg width="'+oW2+'" height="'+oH2+'"><ellipse cx="'+mcx2+'" cy="'+mcy2+'" rx="'+mrx2+'" ry="'+mry2+'" fill="white"/></svg>';
  const maskBuf2 = await sharp({ create: { width: oW2, height: oH2, channels: 3, background: {r:0,g:0,b:0} } })
    .composite([{ input: Buffer.from(maskSvg), blend: 'over' }])
    .png().toBuffer();
  const maskB642 = 'data:image/png;base64,' + maskBuf2.toString('base64');

  const prompt = [
    'Photorealistic photo. Identity-preserving face-swap edit.',
    'Image 1 is a single person — reproduce it with maximum fidelity.',
    'Image 2 is the identity reference — replace ONLY the face in the white mask region with the face from Image 2.',
    'Critical: The person in the result must be clearly identifiable as Image 2.',
    'Keep body, pose, clothing, and background from Image 1 exactly unchanged outside the mask.',
    '8K quality, sharp face, photorealistic.',
  ].join('\n');

  const t0 = Date.now();
  const res = await axios.post(API_URL, {
    model:           MODEL,
    prompt,
    negative_prompt: 'blurry face, distorted face, cartoon, changed clothing, changed background, identity drift',
    image:           [scaledB64, userB64],
    mask_image:      maskB642,
    strength:        1.0,
    guidance_scale:  10,
    response_format: 'url',
    size:            '2048x2560',
    stream:          false,
  }, {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
    timeout: 180000,
  });

  const resultUrl = res.data?.data?.[0]?.url;
  console.log('    生成成功 (' + ((Date.now()-t0)/1000).toFixed(1) + 's)');

  // Step 4: 下载换脸结果
  console.log('[4] 下载换脸结果...');
  const swappedPath = path.join(TEMP_DIR, 'swapped_'+gender+'_'+Date.now()+'.jpg');
  await downloadFile(resultUrl, swappedPath);

  // Step 5: 缩回补边后尺寸，再裁去补边，还原原始裁片尺寸
  console.log('[5] 缩回原始尺寸并合回底图...');
  const resizedBuf = await sharp(swappedPath)
    .resize(paddedMeta.width, paddedMeta.height, { fit: 'fill', kernel: 'lanczos3' })
    .extract({ left: padLeft, top: padTop, width, height })
    .toBuffer();

  // 边缘羽化：对合回内容加左右渐变 alpha，消除硬接缝
  const fadeW = 20; // 羽化宽度 px
  const fadeSvg = '<svg width="'+width+'" height="'+height+'" xmlns="http://www.w3.org/2000/svg">'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">'
    + '<stop offset="0"                   stop-color="black"/>'
    + '<stop offset="'+(fadeW/width)+'"   stop-color="white"/>'
    + '<stop offset="'+((width-fadeW)/width)+'" stop-color="white"/>'
    + '<stop offset="1"                   stop-color="black"/>'
    + '</linearGradient></defs>'
    + '<rect width="'+width+'" height="'+height+'" fill="url(#g)"/></svg>';

  const fadeMaskRaw = await sharp(Buffer.from(fadeSvg))
    .resize(width, height, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 将 resizedBuf 加上 alpha 通道 = fade mask
  const rgbaRaw = await sharp(resizedBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const blended = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    blended[i*4+0] = rgbaRaw.data[i*4+0];
    blended[i*4+1] = rgbaRaw.data[i*4+1];
    blended[i*4+2] = rgbaRaw.data[i*4+2];
    blended[i*4+3] = Math.round(rgbaRaw.data[i*4+3] * fadeMaskRaw.data[i] / 255);
  }
  const fadedBuf = await sharp(blended, { raw: { width, height, channels: 4 } }).png().toBuffer();

  // 合回底图
  const genderTag = gender === 'female' ? 'F' : 'M';
  const finalPath = path.join(OUT_DIR, 'scene2_crop_'+genderTag+'_'+Date.now()+'.jpg');
  await sharp(templatePath)
    .composite([{ input: fadedBuf, left, top, blend: 'over' }])
    .jpeg({ quality: 95 })
    .toFile(finalPath);

  console.log('[完成] 输出: ' + path.basename(finalPath));
  console.log('       耗时: ' + ((Date.now()-t0)/1000).toFixed(1) + 's');
  return finalPath;
}

// ── 入口 ─────────────────────────────────────────────────
const gender    = process.argv[2] || 'female';
const userPhoto = process.argv[3] || path.join(PHOTO_DIR, 'bf65a794b1a8f7ed67b6d97bfb9ab88e.jpg');

console.log('========================================');
console.log('单人裁剪换脸 - 场景2');
console.log('性别: ' + gender + '  用户照片: ' + path.basename(userPhoto));
console.log('========================================\n');

run(gender, userPhoto).catch(e => {
  console.error('错误:', e.response?.data || e.message);
  process.exit(1);
});
