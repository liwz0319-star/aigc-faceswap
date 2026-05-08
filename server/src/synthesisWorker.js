/**
 * 合成任务处理 Worker
 *
 * 流程（两步）：
 * 1. 解读用户照片 → 文字外貌描述
 * 2. 拼装 Prompt（球星 + 场景 + 用户描述）→ 调用 Seedream 生成
 */

const axios = require('axios');
const path  = require('path');
const fs    = require('fs');
const fsp   = require('fs').promises;

// 模式选择：relay / native / minimal（最简测试）/ seedream（seedream调试）
const SEEDREAM_MODE = (process.env.SEEDREAM_MODE || 'relay').toLowerCase();
const _promptBuilderMap = {
  minimal:  './promptBuilder_minimal',
  seedream: './promptBuilder_seedream',
};
const { buildAllPrompts } = require(_promptBuilderMap[SEEDREAM_MODE] || './promptBuilder');
const { buildFaceswapPrompt } = require('./promptBuilder_faceswap');
console.log(`[Worker] 模式: ${SEEDREAM_MODE}  promptBuilder: ${_promptBuilderMap[SEEDREAM_MODE] || './promptBuilder'}`);
const { generateImage } = require('./seedreamClient');
const { generateNativeImage } = require('./seedreamNativeClient');
const { getTask, updateTask, STATUS } = require('./taskQueue');
const { loadReferenceImage, loadJerseyReferences, loadBeerMugReference, loadCompositionReference, loadBackgroundReference, getPlayerReferenceImages } = require('./assetStore');
const { describeUserAppearance } = require('./visionClient');
const { describeUser }           = require('./userDescriber');
// Seedream 调用重试配置
const SEEDREAM_MAX_RETRIES = 2;
const SEEDREAM_RETRY_DELAYS = [3000, 6000];

// 回调 H5 重试配置
const CALLBACK_MAX_RETRIES = 3;
const CALLBACK_RETRY_DELAYS = [2000, 5000, 10000];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 结果图片本地化：下载到 public/results/ 并返回干净 URL
const RESULTS_DIR = '/www/wwwroot/bayern-fan-photo/server/public/results';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'http://111.229.177.65:3001').replace(/\/+$/, '');

async function localizeResultImage(remoteUrl, taskId) {
  try {
    await fsp.mkdir(RESULTS_DIR, { recursive: true });
    const ext = '.jpg';
    const fileName = `${taskId}${ext}`;
    const localPath = path.join(RESULTS_DIR, fileName);

    let data;
    if (remoteUrl.startsWith('file://')) {
      // 本地文件路径（composite 后的结果）
      const srcPath = remoteUrl.replace('file://', '');
      data = await fsp.readFile(srcPath);
    } else {
      // 远程 URL（API 返回的图片）
      const response = await axios.get(remoteUrl, { responseType: 'arraybuffer', timeout: 30000 });
      data = response.data;
    }
    await fsp.writeFile(localPath, data);

    const localUrl = `${PUBLIC_BASE_URL}/public/results/${fileName}`;
    console.log(`[Worker] 图片已本地化: ${localUrl} (${(data.length / 1024).toFixed(0)}KB)`);
    return localUrl;
  } catch (err) {
    console.warn(`[Worker] 图片本地化失败，使用原始URL: ${err.message}`);
    return remoteUrl;
  }
}

/**
 * 从视觉模型的外貌描述中提取性别
 * @param {string} description - 视觉模型返回的英文描述
 * @returns {'male'|'female'} 检测到的性别
 */
function extractGenderFromDescription(description) {
  if (!description) return 'male';
  const lower = description.toLowerCase();
  // 优先匹配明确的性别词
  const femaleScore = (lower.match(/\bfemale\b/g) || []).length * 3
    + (lower.match(/\bwoman\b/g) || []).length * 2
    + (lower.match(/\bgirl\b/g) || []).length * 2
    + (lower.match(/\bher\b/g) || []).length
    + (lower.match(/\bshe\b/g) || []).length;
  const maleScore = (lower.match(/\bmale\b/g) || []).length * 3
    + (lower.match(/\bman\b|\bman['']s\b/g) || []).length * 2
    + (lower.match(/\bboy\b/g) || []).length * 2
    + (lower.match(/\bhis\b/g) || []).length
    + (lower.match(/\bhe\b/g) || []).length;
  // female 单词里包含 male，所以 female 权重更高才准确
  if (femaleScore > maleScore) return 'female';
  if (maleScore > 0) return 'male';
  return 'male'; // 默认男性
}

/**
 * 带重试的 Seedream 调用（自动区分 relay/native 模式）
 */
async function generateWithRetry(params) {
  let lastError;

  for (let attempt = 0; attempt <= SEEDREAM_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Worker] Seedream 第${attempt}次重试...`);
        await sleep(SEEDREAM_RETRY_DELAYS[attempt - 1]);
      }

      if (SEEDREAM_MODE === 'native' || SEEDREAM_MODE === 'seedream' || SEEDREAM_MODE === 'minimal') {
        return await generateNativeImage(params);
      } else {
        return await generateImage(params);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[Worker] Seedream 调用失败（第${attempt + 1}次）: ${err.message}`);

      // 敏感内容检测不重试
      if (err.response?.data?.error?.code === 'OutputImageSensitiveContentDetected') {
        console.error('[Worker] 敏感内容检测，不重试');
        throw err;
      }

      if (err.response?.status >= 400 && err.response?.status < 500) {
        console.error('[Worker] 参数错误，不重试');
        throw err;
      }
    }
  }

  throw lastError;
}

/**
 * 带重试的回调 H5
 */
async function callbackH5WithRetry(url, payload) {
  if (!url) {
    console.warn('[Worker] 无回调地址，跳过回调');
    return;
  }

  let lastError;

  for (let attempt = 0; attempt <= CALLBACK_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Worker] 回调重试第${attempt}次...`);
        await sleep(CALLBACK_RETRY_DELAYS[attempt - 1]);
      }

      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      if (response.data && typeof response.data.code !== 'undefined' && response.data.code !== 0) {
        throw new Error(`回调响应异常: ${response.data.msg || response.data.message || response.data.code}`);
      }

      console.log(`[Worker] 回调成功: ${url}`);
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[Worker] 回调失败（第${attempt + 1}次）: ${url} - ${err.message}`);
    }
  }

  console.error(`[Worker] 回调最终失败（已重试${CALLBACK_MAX_RETRIES}次）: ${url}`);
  throw lastError;
}

// SEEDREAM_MODE 已在文件顶部定义

// ─── scene-configs mask 构建与 composite 后处理 ───
const sharp = require('sharp');
const { INPAINT_CONTROL_PROFILES } = require('../../scene-configs');

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function resolveMaskClipBottom(limitY, scaleY, outputH) {
  if (typeof limitY !== 'number' || !Number.isFinite(limitY)) return null;
  return clamp(Math.round(limitY * scaleY), 1, outputH);
}

function wrapSvgWithBottomClip(outputW, outputH, content, clipBottomY) {
  if (!clipBottomY) return `<svg width="${outputW}" height="${outputH}">${content}</svg>`;
  return `<svg width="${outputW}" height="${outputH}">` +
    `<defs><clipPath id="maskBottomClip"><rect x="0" y="0" width="${outputW}" height="${clipBottomY}"/></clipPath></defs>` +
    `<g clip-path="url(#maskBottomClip)">${content}</g>` +
    `</svg>`;
}

// ─── 参考图预处理函数（移植自 test-faceswap-inpaint-scenes.js）───

function resolveReferenceCropRect(canvasW, canvasH, crop = null) {
  if (!crop) return null;
  const cropW = Math.max(1, Math.min(canvasW, Math.round(canvasW * clamp(crop.width ?? 1, 0.1, 1))));
  const cropH = Math.max(1, Math.min(canvasH, Math.round(canvasH * clamp(crop.height ?? 1, 0.1, 1))));
  const cropOffsetX = typeof crop.offsetX === 'number' ? crop.offsetX : 0.5;
  const cropOffsetY = typeof crop.offsetY === 'number'
    ? crop.offsetY
    : crop.anchor === 'north' ? 0 : 0.5;
  return {
    left: Math.round(clamp((canvasW - cropW) * cropOffsetX, 0, Math.max(0, canvasW - cropW))),
    top: Math.round(clamp((canvasH - cropH) * cropOffsetY, 0, Math.max(0, canvasH - cropH))),
    width: cropW,
    height: cropH,
  };
}

function clampNormalizedReferenceCrop(crop, conf) {
  if (!crop) return crop;
  const maxWidth = typeof conf.refNormalizeMaxCropWidth === 'number'
    ? clamp(conf.refNormalizeMaxCropWidth, 0.1, 1) : null;
  const maxHeight = typeof conf.refNormalizeMaxCropHeight === 'number'
    ? clamp(conf.refNormalizeMaxCropHeight, 0.1, 1) : null;
  if (!maxWidth && !maxHeight) return crop;
  let width = clamp(crop.width ?? 1, 0.1, 1);
  let height = clamp(crop.height ?? 1, 0.1, 1);
  const baseOffsetX = typeof crop.offsetX === 'number' ? crop.offsetX : 0.5;
  const baseOffsetY = typeof crop.offsetY === 'number'
    ? crop.offsetY : crop.anchor === 'north' ? 0 : 0.5;
  let left = clamp((1 - width) * baseOffsetX, 0, Math.max(0, 1 - width));
  let top = clamp((1 - height) * baseOffsetY, 0, Math.max(0, 1 - height));
  if (maxWidth && width > maxWidth) {
    const cx = left + width / 2;
    width = maxWidth;
    left = clamp(cx - width / 2, 0, Math.max(0, 1 - width));
  }
  if (maxHeight && height > maxHeight) {
    const cy = top + height / 2;
    height = maxHeight;
    top = clamp(cy - height / 2, 0, Math.max(0, 1 - height));
  }
  return {
    width, height,
    offsetX: width < 0.999 ? clamp(left / (1 - width), 0, 1) : 0.5,
    offsetY: height < 0.999 ? clamp(top / (1 - height), 0, 1) : 0.5,
    anchor: crop.anchor,
  };
}

async function buildReferenceSubjectBuffer(input, canvasW, canvasH, scale = 1, crop = null) {
  const resolvedScale = (!scale || scale >= 0.999) ? 1 : scale;
  if (!crop && resolvedScale >= 0.999) return input;
  const cropRect = resolveReferenceCropRect(canvasW, canvasH, crop);
  const subject = cropRect
    ? await sharp(input).extract(cropRect).toBuffer()
    : input;
  if (cropRect) {
    const boxW = Math.max(1, Math.round(canvasW * resolvedScale));
    const boxH = Math.max(1, Math.round(canvasH * resolvedScale));
    return sharp(subject).resize(boxW, boxH, { fit: 'inside' }).toBuffer();
  }
  const innerW = Math.max(1, Math.round(canvasW * resolvedScale));
  const innerH = Math.max(1, Math.round(canvasH * resolvedScale));
  return sharp(subject).resize(innerW, innerH, { fit: 'fill' }).toBuffer();
}

async function toScaledReferenceDataUrl(inputBuf, scale = 1, anchor = 'center', offsetX = 0.5, offsetY = null, crop = null) {
  if ((!scale || scale >= 0.999) && !crop) {
    return `data:image/jpeg;base64,${inputBuf.toString('base64')}`;
  }
  const meta = await sharp(inputBuf).metadata();
  const canvasW = meta.width || 1024;
  const canvasH = meta.height || 1024;
  const scaled = await buildReferenceSubjectBuffer(inputBuf, canvasW, canvasH, scale, crop);
  const scaledMeta = await sharp(scaled).metadata();
  const innerW = scaledMeta.width || canvasW;
  const innerH = scaledMeta.height || canvasH;
  const remainingW = Math.max(0, canvasW - innerW);
  const remainingH = Math.max(0, canvasH - innerH);
  const resolvedOffsetX = typeof offsetX === 'number' ? offsetX : 0.5;
  const resolvedOffsetY = typeof offsetY === 'number'
    ? offsetY : anchor === 'north' ? 0.12 : 0.5;
  const left = Math.round(clamp(remainingW * resolvedOffsetX, 0, remainingW));
  const top = Math.round(clamp(remainingH * resolvedOffsetY, 0, remainingH));
  const out = await sharp({
    create: { width: canvasW, height: canvasH, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).composite([{ input: scaled, left, top }]).jpeg({ quality: 95 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

async function toSoftOvalReferenceDataUrl(inputBuf, scale = 1, anchor = 'center', offsetX = 0.5, offsetY = null, crop = null) {
  const meta = await sharp(inputBuf).metadata();
  const canvasW = meta.width || 1024;
  const canvasH = meta.height || 1024;
  const scaled = await buildReferenceSubjectBuffer(inputBuf, canvasW, canvasH, scale, crop);
  const scaledMeta = await sharp(scaled).metadata();
  const innerW = scaledMeta.width || canvasW;
  const innerH = scaledMeta.height || canvasH;
  const scaledWithAlpha = await sharp(scaled).ensureAlpha().toBuffer();
  const remainingW = Math.max(0, canvasW - innerW);
  const remainingH = Math.max(0, canvasH - innerH);
  const resolvedOffsetX = typeof offsetX === 'number' ? offsetX : 0.5;
  const resolvedOffsetY = typeof offsetY === 'number'
    ? offsetY : anchor === 'north' ? 0.12 : 0.5;
  const left = Math.round(clamp(remainingW * resolvedOffsetX, 0, remainingW));
  const top = Math.round(clamp(remainingH * resolvedOffsetY, 0, remainingH));
  const rx = Math.max(1, Math.round(innerW * 0.42));
  const ry = Math.max(1, Math.round(innerH * 0.46));
  const cy = Math.round(innerH * 0.46);
  const feather = Math.max(10, Math.round(Math.min(innerW, innerH) * 0.035));
  const ovalSvg = `<svg width="${innerW}" height="${innerH}">` +
    `<ellipse cx="${Math.round(innerW / 2)}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"/></svg>`;
  const ovalMask = await sharp({
    create: { width: innerW, height: innerH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: Buffer.from(ovalSvg), blend: 'over' }]).blur(feather).png().toBuffer();
  const softened = await sharp(scaledWithAlpha)
    .composite([{ input: ovalMask, blend: 'dest-in' }]).png().toBuffer();
  const out = await sharp({
    create: { width: canvasW, height: canvasH, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).composite([{ input: softened, left, top }]).jpeg({ quality: 95 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

async function hasFlatLightBorder(inputBuf) {
  const { data, info } = await sharp(inputBuf)
    .resize(96, 96, { fit: 'fill' }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width || 96;
  const height = info.height || 96;
  const border = Math.max(6, Math.round(Math.min(width, height) * 0.12));
  let count = 0, sum = 0, sumSq = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = x < border || x >= width - border || y < border || y >= height - border;
      if (!isBorder) continue;
      const idx = (y * width + x) * 3;
      const lum = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      sum += lum; sumSq += lum * lum; count++;
    }
  }
  if (!count) return false;
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return mean >= 220 && Math.sqrt(variance) <= 18;
}

function faceBoundsToCrop(face) {
  const padSideRatio = 0.35, padTopRatio = 0.45, padBottomRatio = 0.15;
  const padW = face.w * padSideRatio;
  const padTop = face.h * padTopRatio;
  const padBottom = face.h * padBottomRatio;
  const cropX = Math.max(0, face.x - padW);
  const cropY = Math.max(0, face.y - padTop);
  const cropW = Math.min(100 - cropX, face.w + padW * 2);
  const cropH = Math.min(100 - cropY, face.h + padTop + padBottom);
  const width = cropW / 100, height = cropH / 100;
  return {
    width, height,
    offsetX: width < 0.99 ? clamp((cropX / 100) / (1 - width), 0, 1) : 0.5,
    offsetY: height < 0.99 ? clamp((cropY / 100) / (1 - height), 0, 1) : 0.5,
  };
}

/**
 * 使用 Vision API 检测脸部边界
 */
async function detectFaceBounds(imageBase64) {
  const key = process.env.VISION_API_KEY;
  if (!key) return null;
  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  try {
    const res = await axios.post(url, {
      model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: imageBase64 } },
        { type: 'text', text:
          'Look at this photo. Estimate the bounding box of the FULL HEAD (from top of hair/highest point to bottom of chin, including all hair volume on sides). ' +
          'Return ONLY valid JSON: {"x":percent_from_left,"y":percent_from_top,"w":width_percent,"h":height_percent}. ' +
          'All values are percentages (0-100) of image dimensions. x/y is top-left corner. Reply ONLY with the JSON object, no other text.',
        },
      ]}],
      max_tokens: 80,
      temperature: 0,
    }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 15000 });
    const content = (res.data?.choices?.[0]?.message?.content || '').trim();
    const match = content.match(/\{[^}]+\}/);
    if (!match) return null;
    const raw = JSON.parse(match[0]);
    let rx = Number(raw.x) || 20, ry = Number(raw.y) || 10;
    let rw = Number(raw.w) || 30, rh = Number(raw.h) || 30;
    if (rx > 100 || ry > 100 || rw > 100 || rh > 100) {
      try {
        const b64data = imageBase64.replace(/^data:[^;]+;base64,/, '');
        const imgMeta = await sharp(Buffer.from(b64data, 'base64')).metadata();
        const iw = imgMeta.width || 1024, ih = imgMeta.height || 1024;
        rx = rx / iw * 100; ry = ry / ih * 100;
        rw = rw / iw * 100; rh = rh / ih * 100;
      } catch (_) { /* fallback */ }
    }
    return {
      x: clamp(rx, 0, 90), y: clamp(ry, 0, 90),
      w: clamp(rw, 5, 95), h: clamp(rh, 5, 95),
    };
  } catch (e) {
    console.warn(`[Worker] [faceDetect] 脸部检测失败: ${e.message}`);
    return null;
  }
}

/**
 * 构建预处理后的参考图（标准化脸部 + 缩放 + 可选软椭圆）
 */
async function preprocessReferenceImage(userImageBase64, conf) {
  // 1. 脸部检测 → 标准化裁剪
  let faceCrop = null;
  let faceDetected = false;
  if (conf.refNormalize) {
    const face = await detectFaceBounds(userImageBase64);
    if (face) {
      console.log(`[Worker] [refPreprocess] 脸部检测原始值: x=${face.x}% y=${face.y}% w=${face.w}% h=${face.h}%`);
      // 验证检测结果合理性：脸部不应超过图像的 70%，且不应超出边界
      const isValid = face.w <= 70 && face.h <= 70 && (face.x + face.w) <= 100 && (face.y + face.h) <= 100;
      if (isValid) {
        faceCrop = clampNormalizedReferenceCrop(faceBoundsToCrop(face), conf);
        faceDetected = true;
        console.log(`[Worker] [refPreprocess] 脸部检测有效，使用标准化裁剪`);
      } else {
        console.warn(`[Worker] [refPreprocess] 脸部检测结果不合理 (w=${face.w}%, h=${face.h}%)，回退到配置的 refCrop`);
      }
    }
  }
  // 如果脸部检测失败或不合理，回退到配置的 refCrop
  if (!faceDetected && conf.refCrop) {
    faceCrop = conf.refCrop;
    console.log(`[Worker] [refPreprocess] 使用配置的 refCrop`);
  }

  // 2. 下载用户图片原始 Buffer
  let inputBuf;
  if (userImageBase64.startsWith('data:')) {
    const b64 = userImageBase64.replace(/^data:[^;]+;base64,/, '');
    inputBuf = Buffer.from(b64, 'base64');
  } else if (userImageBase64.startsWith('http')) {
    const http = require('http'), https = require('https');
    inputBuf = await new Promise((res, rej) => {
      const c = userImageBase64.startsWith('https') ? https : http;
      c.get(userImageBase64, r => {
        if (r.statusCode === 301 || r.statusCode === 302)
          return require(r.headers.location.startsWith('https') ? 'https' : 'http')
            .get(r.headers.location, rr => {
              const chunks = []; rr.on('data', ch => chunks.push(ch));
              rr.on('end', () => res(Buffer.concat(chunks)));
            }).on('error', rej);
        const chunks = []; r.on('data', ch => chunks.push(ch));
        r.on('end', () => res(Buffer.concat(chunks)));
      }).on('error', rej);
    });
    userImageBase64 = `data:image/jpeg;base64,${inputBuf.toString('base64')}`;
  } else {
    inputBuf = Buffer.from(userImageBase64, 'base64');
  }

  // 3. 判断是否需要处理
  const needsScale = conf.refScale && conf.refScale < 0.999;
  const needsCrop = conf.refCrop || faceCrop;
  const headFillRatio = conf.refHeadFillRatio ?? conf.refScale ?? 1;
  const useNormalize = faceCrop && conf.refNormalize;
  const alwaysSoftOval = Boolean(conf.refAlwaysSoftOval);
  const useSoftOval = alwaysSoftOval || (Boolean(conf.refSoftOvalOnFlatBackground) && (useNormalize || await hasFlatLightBorder(inputBuf)));

  if (!needsScale && !needsCrop && !useNormalize && !useSoftOval) {
    console.log(`[Worker] [refPreprocess] 无需预处理，使用原始用户照片`);
    return userImageBase64;
  }

  // 4. 构建预处理参考图
  const effectiveCrop = useNormalize ? faceCrop : (conf.refCrop || null);
  const effectiveScale = useNormalize ? headFillRatio : (conf.refScale ?? 1);

  console.log(`[Worker] [refPreprocess] scale=${effectiveScale.toFixed(3)} crop=${effectiveCrop ? 'yes' : 'no'} softOval=${useSoftOval}`);

  if (useSoftOval) {
    return await toSoftOvalReferenceDataUrl(
      inputBuf, effectiveScale,
      conf.refAnchor || 'center',
      conf.refOffsetX ?? 0.5,
      conf.refOffsetY,
      effectiveCrop
    );
  }
  return await toScaledReferenceDataUrl(
    inputBuf, effectiveScale,
    conf.refAnchor || 'center',
    conf.refOffsetX ?? 0.5,
    conf.refOffsetY,
    effectiveCrop
  );
}

/**
 * 从 scene-config mask 坐标生成 API mask + Composite mask
 * 移植自 test-faceswap-inpaint-scenes.js 的 buildMask()
 */
async function buildSceneMask(inputW, inputH, mask, outputW, outputH) {
  const scaleX = outputW / inputW;
  const scaleY = outputH / inputH;

  if (!mask || !('cx' in mask)) {
    return { apiBuf: null, compBuf: null };
  }

  const mcx = Math.round(mask.cx * scaleX);
  const mcy = Math.round(mask.cy * scaleY);

  // ── 带精细坐标的 mask（hairDome / rect）──
  if ('w' in mask && (mask.apiW || mask.apiH || mask.compW || mask.compH || mask.apiCx || mask.apiCy || mask.compCx || mask.compCy)) {
    const apiClipBottom = resolveMaskClipBottom(mask.apiMaxBottomY ?? mask.maxBottomY, scaleY, outputH);
    const compClipBottom = resolveMaskClipBottom(mask.compMaxBottomY ?? mask.maxBottomY, scaleY, outputH);
    const apiCx = Math.round((mask.apiCx ?? mask.cx) * scaleX);
    const apiCy = Math.round((mask.apiCy ?? mask.cy) * scaleY);
    const apiW = Math.round((mask.apiW ?? mask.w) * scaleX);
    const apiH = Math.round((mask.apiH ?? mask.h) * scaleY);
    const apiLeft = apiCx - Math.round(apiW / 2);
    const apiTop = apiCy - Math.round(apiH / 2);
    let svgAPI = wrapSvgWithBottomClip(
      outputW, outputH,
      `<rect x="${apiLeft}" y="${apiTop}" width="${apiW}" height="${apiH}" fill="white"/>`,
      apiClipBottom
    );
    if (mask.apiShape === 'hairDome') {
      const domeH = Math.max(1, Math.round((mask.apiDomeH ?? Math.round(mask.apiH * 0.3)) * scaleY));
      const domeExpandX = Math.max(0, Math.round((mask.apiDomeExpandX ?? 0) * scaleX));
      const sideRx = Math.max(1, Math.round((mask.apiSideHairW ?? 0) * scaleX));
      const sideRy = Math.max(1, Math.round((mask.apiSideHairH ?? 0) * scaleY));
      const sideOffsetX = Math.max(0, Math.round((mask.apiSideHairOffsetX ?? 0) * scaleX));
      const sideOffsetY = Math.max(0, Math.round((mask.apiSideHairOffsetY ?? 0) * scaleY));
      const bodyInsetX = Math.max(0, Math.round((mask.apiBodyInsetX ?? 0) * scaleX));
      const bodyTop = apiTop + Math.round(domeH * 0.52);
      const bodyH = Math.max(1, apiTop + apiH - bodyTop);
      const bodyLeft = apiLeft + bodyInsetX;
      const bodyW = Math.max(1, apiW - bodyInsetX * 2);
      const topRx = Math.round(apiW / 2) + domeExpandX;
      const topCy = apiTop + domeH;
      const leftHairCx = apiCx - sideOffsetX;
      const rightHairCx = apiCx + sideOffsetX;
      const hairCy = apiTop + sideOffsetY;
      let neckSvgAPI = '';
      if (mask.apiNeckRx && mask.apiNeckRy) {
        const neckRx = Math.max(1, Math.round(mask.apiNeckRx * scaleX));
        const neckRy = Math.max(1, Math.round(mask.apiNeckRy * scaleY));
        const neckCy = apiTop + Math.round((mask.apiNeckOffsetY ?? apiH * 0.8) * scaleY);
        neckSvgAPI = `<ellipse cx="${apiCx}" cy="${neckCy}" rx="${neckRx}" ry="${neckRy}" fill="white"/>`;
      }
      svgAPI = wrapSvgWithBottomClip(outputW, outputH,
        `<ellipse cx="${apiCx}" cy="${topCy}" rx="${topRx}" ry="${domeH}" fill="white"/>` +
        `<rect x="${bodyLeft}" y="${bodyTop}" width="${bodyW}" height="${bodyH}" fill="white"/>` +
        `<ellipse cx="${leftHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="white"/>` +
        `<ellipse cx="${rightHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="white"/>` +
        neckSvgAPI,
        apiClipBottom
      );
    }
    const apiBuf = await sharp({ create: { width: outputW, height: outputH, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([{ input: Buffer.from(svgAPI), blend: 'over' }])
      .png()
      .toBuffer();

    // ── Composite mask ──
    const compCx = Math.round((mask.compCx ?? mask.cx) * scaleX);
    const compCy = Math.round((mask.compCy ?? mask.cy) * scaleY);
    const compW = Math.round((mask.compW ?? mask.w) * scaleX);
    const compH = Math.round((mask.compH ?? mask.h) * scaleY);
    const compLeft = compCx - Math.round(compW / 2);
    const compTop = compCy - Math.round(compH / 2);
    const feather = mask.compFeather
      ? Math.max(8, Math.round(mask.compFeather * Math.min(scaleX, scaleY)))
      : Math.max(12, Math.round(Math.min(compW, compH) * 0.075));
    let svgCompContent = `<rect x="${compLeft}" y="${compTop}" width="${compW}" height="${compH}" fill="white"/>`;
    let svgComp = wrapSvgWithBottomClip(outputW, outputH, svgCompContent, compClipBottom);
    if (mask.compShape === 'hairDome') {
      const domeH = Math.max(1, Math.round((mask.compDomeH ?? Math.round(mask.compH * 0.32)) * scaleY));
      const domeExpandX = Math.max(0, Math.round((mask.compDomeExpandX ?? 0) * scaleX));
      const sideRx = Math.max(1, Math.round((mask.compSideHairW ?? 0) * scaleX));
      const sideRy = Math.max(1, Math.round((mask.compSideHairH ?? 0) * scaleY));
      const sideOffsetX = Math.max(0, Math.round((mask.compSideHairOffsetX ?? 0) * scaleX));
      const sideOffsetY = Math.max(0, Math.round((mask.compSideHairOffsetY ?? 0) * scaleY));
      const bodyInsetX = Math.max(0, Math.round((mask.compBodyInsetX ?? 0) * scaleX));
      const bodyTop = compTop + Math.round(domeH * 0.55);
      const bodyH = Math.max(1, compTop + compH - bodyTop);
      const bodyLeft = compLeft + bodyInsetX;
      const bodyW = Math.max(1, compW - bodyInsetX * 2);
      const topRx = Math.round(compW / 2) + domeExpandX;
      const topCy = compTop + domeH;
      const leftHairCx = compCx - sideOffsetX;
      const rightHairCx = compCx + sideOffsetX;
      const hairCy = compTop + sideOffsetY;
      let neckSvgComp = '';
      if (mask.compNeckRx && mask.compNeckRy) {
        const neckRx = Math.max(1, Math.round(mask.compNeckRx * scaleX));
        const neckRy = Math.max(1, Math.round(mask.compNeckRy * scaleY));
        const neckCy = compTop + Math.round((mask.compNeckOffsetY ?? compH * 0.8) * scaleY);
        neckSvgComp = `<ellipse cx="${compCx}" cy="${neckCy}" rx="${neckRx}" ry="${neckRy}" fill="white"/>`;
      }
      svgComp = wrapSvgWithBottomClip(outputW, outputH,
        `<ellipse cx="${compCx}" cy="${topCy}" rx="${topRx}" ry="${domeH}" fill="white"/>` +
        `<rect x="${bodyLeft}" y="${bodyTop}" width="${bodyW}" height="${bodyH}" fill="white"/>` +
        `<ellipse cx="${leftHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="white"/>` +
        `<ellipse cx="${rightHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="white"/>` +
        neckSvgComp,
        compClipBottom
      );
      const compRaw = await sharp({ create: { width: outputW, height: outputH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: Buffer.from(svgComp), blend: 'over' }])
        .png()
        .toBuffer();
      let compBuf = await sharp(compRaw).blur(feather).png().toBuffer();
      // hairDome: add inner solid core to prevent over-feathering
      const innerBodyTop = compTop + Math.round(domeH * 0.62);
      const bodyInsetBase = Math.max(0, Math.round((mask.compBodyInsetX ?? 0) * scaleX));
      const bodyInset = bodyInsetBase + Math.max(1, Math.round(feather * 0.45));
      const innerBodyH = Math.max(1, compTop + compH - innerBodyTop);
      const innerTopRx = Math.max(1, Math.round(compW / 2) + domeExpandX - Math.round(feather * 0.35));
      // 顶部 dome 不缩减 — 保持完整高度避免头顶头发被羽化虚化
      const innerTopRy = domeH;
      const innerSideRx = Math.max(1, sideRx - Math.round(feather * 0.25));
      const innerSideRy = Math.max(1, sideRy - Math.round(feather * 0.2));
      let neckSvgSolid = '';
      if (mask.compNeckRx && mask.compNeckRy) {
        const innerNeckRx = Math.max(1, Math.round((mask.compNeckRx - feather * 0.35) * scaleX));
        const innerNeckRy = Math.max(1, Math.round((mask.compNeckRy - feather * 0.3) * scaleY));
        const innerNeckCy = compTop + Math.round((mask.compNeckOffsetY ?? compH * 0.8) * scaleY);
        neckSvgSolid = `<ellipse cx="${compCx}" cy="${innerNeckCy}" rx="${innerNeckRx}" ry="${innerNeckRy}" fill="white"/>`;
      }
      const svgSolidHair = wrapSvgWithBottomClip(outputW, outputH,
        `<ellipse cx="${compCx}" cy="${topCy}" rx="${innerTopRx}" ry="${innerTopRy}" fill="white"/>` +
        `<rect x="${compLeft + bodyInset}" y="${innerBodyTop}" width="${Math.max(1, compW - bodyInset * 2)}" height="${innerBodyH}" fill="white"/>` +
        `<ellipse cx="${leftHairCx}" cy="${hairCy}" rx="${innerSideRx}" ry="${innerSideRy}" fill="white"/>` +
        `<ellipse cx="${rightHairCx}" cy="${hairCy}" rx="${innerSideRx}" ry="${innerSideRy}" fill="white"/>` +
        neckSvgSolid,
        compClipBottom
      );
      compBuf = await sharp(compBuf)
        .composite([{ input: Buffer.from(svgSolidHair), blend: 'over' }])
        .png()
        .toBuffer();
      console.log(`[Worker] [mask] hairDome comp (${compLeft},${compTop}) ${compW}x${compH} feather=${feather}`);
      return { apiBuf, compBuf };
    }
    const compRaw = await sharp({ create: { width: outputW, height: outputH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(svgComp), blend: 'over' }])
      .png()
      .toBuffer();
    const compBuf = await sharp(compRaw).blur(feather).png().toBuffer();
    console.log(`[Worker] [mask] rect comp (${compLeft},${compTop}) ${compW}x${compH} feather=${feather}`);
    return { apiBuf, compBuf };
  }

  // ── 简单矩形 mask（场景2 male 旧格式）──
  const rw = Math.round(mask.w * scaleX);
  const rh = Math.round(mask.h * scaleY);
  const rx = mcx - Math.round(rw / 2);
  const ry = mcy - Math.round(rh / 2);
  const svgAPI = `<svg width="${outputW}" height="${outputH}">` +
    `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="white"/></svg>`;
  const apiBuf = await sharp({ create: { width: outputW, height: outputH, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: Buffer.from(svgAPI), blend: 'over' }])
    .png()
    .toBuffer();

  const featherPadX = Math.round(rw * 0.08);
  const featherPadTop = Math.round(rh * 0.08);
  const featherPadBottom = Math.round(rh * 0.14);
  const cLeft = clamp(rx - featherPadX, 0, outputW);
  const cTop = clamp(ry - featherPadTop, 0, outputH);
  const cRight = clamp(rx + rw + featherPadX, 0, outputW);
  const cBottom = clamp(ry + rh + featherPadBottom, 0, outputH);
  const cW = Math.max(1, cRight - cLeft);
  const cH = Math.max(1, cBottom - cTop);
  const feather = Math.max(18, Math.round(Math.min(cW, cH) * 0.10));
  const svgComp = `<svg width="${outputW}" height="${outputH}">` +
    `<rect x="${cLeft}" y="${cTop}" width="${cW}" height="${cH}" fill="white"/></svg>`;
  const compRaw = await sharp({ create: { width: outputW, height: outputH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(svgComp), blend: 'over' }])
    .png()
    .toBuffer();
  let compBuf = await sharp(compRaw).blur(feather).png().toBuffer();

  // solid top: 防止头顶头发被羽化虚化
  // compSolidTopH 指定从 compTop 开始的固定不透明区域高度（基于原始尺寸）
  if (mask.compSolidTopH) {
    const solidTopH = Math.round(mask.compSolidTopH * scaleY);
    const solidSvg = `<svg width="${outputW}" height="${outputH}">` +
      `<rect x="${cLeft}" y="${cTop}" width="${cW}" height="${solidTopH}" fill="white"/></svg>`;
    compBuf = await sharp(compBuf)
      .composite([{ input: Buffer.from(solidSvg), blend: 'over' }])
      .png()
      .toBuffer();
  }

  console.log(`[Worker] [mask] simple rect (${rx},${ry}) ${rw}x${rh} feather=${feather}${mask.compSolidTopH ? ' solidTop='+Math.round(mask.compSolidTopH*scaleY) : ''}`);
  return { apiBuf, compBuf };
}

/**
 * Composite 后处理：用 mask 把 AI 生成图的面部贴到原始底图上
 */
async function compositeWithMask(templateImageUrl, generatedImageUrl, compBuf, outputW, outputH, taskId) {
  const os = require('os');
  const tmpDir = os.tmpdir();
  const tmpTemplate = path.join(tmpDir, `comp_tpl_${taskId}.jpg`);
  const tmpGenerated = path.join(tmpDir, `comp_gen_${taskId}.jpg`);
  const tmpFinal = path.join(tmpDir, `comp_final_${taskId}.jpg`);

  try {
    // 下载模板图和生成图
    const downloadTmp = (url, dest) => new Promise((res, rej) => {
      const http = require('http');
      const https = require('https');
      const client = url.startsWith('https') ? https : http;
      const file = require('fs').createWriteStream(dest);
      client.get(url, r => {
        if (r.statusCode === 301 || r.statusCode === 302) {
          file.close(); require('fs').unlinkSync(dest);
          return downloadTmp(r.headers.location, dest).then(res).catch(rej);
        }
        r.pipe(file);
        file.on('finish', () => { file.close(); res(); });
      }).on('error', rej);
    });

    await downloadTmp(templateImageUrl, tmpTemplate);
    await downloadTmp(generatedImageUrl, tmpGenerated);

    // 1. AI 图 resize → 应用 comp mask (dest-in) → 只保留面部区域
    const aiResized = await sharp(tmpGenerated)
      .resize(outputW, outputH, { fit: 'fill' })
      .ensureAlpha()
      .toBuffer();
    const aiFaceMasked = await sharp(aiResized)
      .composite([{ input: compBuf, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // 2. 原始底图 resize → 叠加 masked face (over) → 锁定背景
    const tplResized = await sharp(tmpTemplate)
      .resize(outputW, outputH, { fit: 'fill' })
      .toBuffer();
    const finalBuf = await sharp(tplResized)
      .composite([{ input: aiFaceMasked, blend: 'over' }])
      .jpeg({ quality: 95 })
      .toBuffer();

    // 保存最终结果
    await fsp.writeFile(tmpFinal, finalBuf);
    console.log(`[Worker] [composite] 完成: ${tmpFinal} (${(finalBuf.length / 1024).toFixed(0)}KB)`);
    return tmpFinal;
  } finally {
    // 清理临时文件
    await fsp.unlink(tmpTemplate).catch(() => {});
    await fsp.unlink(tmpGenerated).catch(() => {});
  }
}

/**
 * 验证换脸结果质量（可选）
 */
async function validateHeadSwapResult(resultBase64, sceneLabel, targetPerson = 'the main swapped person', extraRule = '') {
  const key = process.env.VISION_API_KEY;
  if (!key) return { ok: true, skipped: true, reason: 'no_vision_key' };

  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  try {
    const res = await axios.post(url, {
      model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: resultBase64 } },
        {
          type: 'text',
          text:
            'You are a quality inspector for head-swap composites. Validate the result for "' + sceneLabel + '". Focus on ' + targetPerson + '.\n\n' +
            'Check ALL of the following criteria. Reply PASS only if EVERY criterion is met:\n' +
            '1. HEAD COMPLETENESS: Exactly one complete human head visible from the top of the hair (crown) to the chin.\n' +
            '2. PHOTOREALISM: The face looks like a real photograph — NOT cartoon, anime, CGI, 3D render, or plastic skin.\n' +
            '3. SKIN CONTINUITY: Face/neck skin tone transitions naturally. No visible color jump.\n' +
            '4. CLOTHING PRESERVATION: Original scene clothing preserved. No source-photo clothing leaked in.\n' +
            '5. BACKGROUND PRESERVATION: Scene background intact.\n' +
            '6. HEAD PROPORTION: Head proportional to body.\n' +
            '7. SINGLE HEAD: Exactly one face.\n\n' +
            'If ANY criterion fails, reply "FAIL:" followed by a short reason.\n' +
            'If ALL criteria pass, reply "PASS".\n' +
            extraRule
        },
      ]}],
      max_tokens: 30,
      temperature: 0,
    }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 20000 });

    const answer = (res.data?.choices?.[0]?.message?.content || '').trim().toUpperCase();
    if (answer.includes('FAIL')) return { ok: false, reason: answer || 'FAIL' };
    if (answer.includes('PASS')) return { ok: true, reason: answer };
    return { ok: true, skipped: true, reason: `unparsed:${answer}` };
  } catch (e) {
    console.warn(`[Worker] [validator] 跳过结果校验: ${e.message}`);
    return { ok: true, skipped: true, reason: e.message };
  }
}

/**
 * 解析底图尺寸 (e.g., '2048x2560' → { w: 2048, h: 2560 })
 */
function parseSize(sizeStr) {
  const match = (sizeStr || '2048x2560').match(/(\d+)x(\d+)/i);
  return match ? { w: parseInt(match[1]), h: parseInt(match[2]) } : { w: 2048, h: 2560 };
}

/**
 * 处理换脸任务（Faceswap 模式）
 * 支持3种子模式：
 *   - faceswap-composite: faceswap 生成 + mask 合成后处理（Scene 1, 4）
 *   - inpaint: inpaint 生成 + mask 合成后处理（Scene 2, 3）
 *   - faceswap: 原有基础 faceswap（兼容模式）
 * Image 1 = template_image（模板合照，保持球星/场景不变）
 * Image 2 = user_images[0]（球迷照，替换人脸来源）
 */
async function processFaceswapTask(taskId, task) {
  const t0 = Date.now();
    const {
      template_image: defaultTemplateImage,
      user_images,
      callback_url,
      size,
      target_person: defaultTargetPerson,
      gender: defaultGender,
      faceswap_templates,
      faceswap_strength,
      faceswap_guidance_scale,
      faceswap_config: rawSceneConfig,
    } = task.params;

  // ── 解析 scene-config ──
  const sceneConfig = rawSceneConfig || null;
  const sceneMode = sceneConfig?.mode || 'faceswap';

  console.log(`[Worker] [faceswap] 开始处理换脸任务: ${taskId} (mode=${sceneMode})`);
  console.log(`[Worker] [faceswap] 球迷照: ${user_images[0]}`);

  await updateTask(taskId, { status: STATUS.PROCESSING });

  try {
    // ── 步骤1: 视觉模型解析用户外貌（含性别检测）──
    let userDescription = '';
    try {
      userDescription = await describeUserAppearance([user_images[0]]);
      console.log(`[Worker] [faceswap] 用户外貌解析完成: ${userDescription.substring(0, 120)}...`);
    } catch (visionErr) {
      console.warn(`[Worker] [faceswap] 用户外貌解析失败，使用 H5 传入的 gender=${defaultGender || 'male'}: ${visionErr.message}`);
    }

    // ── 步骤2: 自动性别识别 → 选择男/女模板 ──
    const detectedGender = userDescription ? extractGenderFromDescription(userDescription) : (defaultGender || 'male');
    let template_image = defaultTemplateImage;
    let target_person = defaultTargetPerson;
    let template_type = 'faceswap';

    if (faceswap_templates && faceswap_templates[detectedGender]) {
      const genderConfig = faceswap_templates[detectedGender];
      template_image    = genderConfig.template_image;
      target_person     = genderConfig.target_person;
      template_type     = genderConfig.template_type || 'faceswap';
      console.log(`[Worker] [faceswap] 性别检测: ${detectedGender} → 使用${detectedGender === 'female' ? '女' : '男'}性模板 (type=${template_type})`);
    } else {
      console.log(`[Worker] [faceswap] 性别检测: ${detectedGender} (无分性别模板，使用默认)`);
    }

    // ── 步骤3: 选择 gender 对应的 scene config ──
    let genderSceneConfig = sceneConfig;
    if (sceneConfig && sceneConfig !== Object(sceneConfig)) {
      // sceneConfig 可能不是 gender-specific 的对象
    }
    // 如果 sceneConfig 本身就是 gender 分支（已由 route 选择），直接使用

    console.log(`[Worker] [faceswap] 模板图: ${template_image}`);

    // 优先使用模板级别的 size/strength/guidance，其次使用任务参数，最后取默认值
    // inpaint 模式 strength 必须为 1.0（完全重绘 mask 区域）
    const resolvedSize     = genderSceneConfig?.size || faceswap_templates?.[detectedGender]?.size || size || '2048x2560';
    let resolvedStrength   = genderSceneConfig?.strength ?? faceswap_templates?.[detectedGender]?.strength ?? faceswap_strength ?? 0.68;
    if (sceneMode === 'inpaint') resolvedStrength = 1.0;
    const resolvedGuidance = genderSceneConfig?.guidance ?? genderSceneConfig?.guidance_scale ?? faceswap_templates?.[detectedGender]?.guidance_scale ?? faceswap_guidance_scale ?? 10;

    // ── 步骤3.5: 参考图预处理（refScale/refCrop/refNormalize/softOval）──
    // 将用户照片标准化为统一大小的参考图，避免头部大小不可控
    let processedUserImage = user_images[0];
    if (genderSceneConfig && (genderSceneConfig.refScale || genderSceneConfig.refNormalize || genderSceneConfig.refCrop || genderSceneConfig.refSoftOvalOnFlatBackground || genderSceneConfig.refAlwaysSoftOval)) {
      try {
        processedUserImage = await preprocessReferenceImage(user_images[0], genderSceneConfig);
        console.log(`[Worker] [faceswap] 参考图预处理完成`);
      } catch (preprocErr) {
        console.error(`[Worker] [faceswap] 参考图预处理失败: ${preprocErr.message}`);
        throw new Error(`参考图预处理失败: ${preprocErr.message}`);
      }
    }

    // ── 步骤4: 构建增强 Prompt（含 extraPromptLines + extraNegativeTerms）──
    const { prompt: basePrompt, negative_prompt: baseNegPrompt } = buildFaceswapPrompt({
      targetPerson:  target_person || 'the only person in the image',
      userDescription,
      gender:        detectedGender,
      templateType:  template_type,
    });

    // 合并 scene-config 的 extraPromptLines 和 extraNegativeTerms
    let prompt = basePrompt;
    let negative_prompt = baseNegPrompt;
    const controlProfileKey = genderSceneConfig?.controlProfile || null;
    const controlProfile = controlProfileKey ? (INPAINT_CONTROL_PROFILES[controlProfileKey] || INPAINT_CONTROL_PROFILES.default) : INPAINT_CONTROL_PROFILES.default;

    if (genderSceneConfig?.extraPromptLines || controlProfile?.promptLines) {
      const extraLines = [
        ...(Array.isArray(controlProfile.promptLines) ? controlProfile.promptLines : []),
        ...(Array.isArray(genderSceneConfig?.extraPromptLines) ? genderSceneConfig.extraPromptLines : []),
      ];
      if (extraLines.length > 0) {
        prompt += '\n' + extraLines.join('\n');
      }
    }
    if (genderSceneConfig?.extraNegativeTerms || controlProfile?.negativeTerms) {
      const extraNeg = [
        ...(Array.isArray(controlProfile.negativeTerms) ? controlProfile.negativeTerms : []),
        ...(Array.isArray(genderSceneConfig?.extraNegativeTerms) ? genderSceneConfig.extraNegativeTerms : []),
      ];
      if (extraNeg.length > 0) {
        negative_prompt += ', ' + extraNeg.join(', ');
      }
    }
    console.log(`[Worker] [faceswap] Prompt: ${prompt.length} 字符 (mode=${sceneMode}, gender=${detectedGender}, type=${template_type})`);

    // ── 步骤5: 生成图片 ──
    // 对于 inpaint 模式，构建 API mask + 预填充底图
    let apiMaskBase64 = null;
    let preFilledTemplate = template_image; // 默认用原始底图 URL
    let tplOrigW = null, tplOrigH = null; // 模板图原始尺寸（mask 坐标基于此）
    if ((sceneMode === 'inpaint') && genderSceneConfig?.mask) {
      try {
        const { w: outW, h: outH } = parseSize(resolvedSize);
        const maskConfig = genderSceneConfig.mask;

        // 获取模板图原始尺寸（mask 坐标基于此尺寸）
        const http = require('http');
        const https = require('https');
        const downloadToBuf = (url) => new Promise((res, rej) => {
          const c = url.startsWith('https') ? https : http;
          c.get(url, r => {
            if (r.statusCode === 301 || r.statusCode === 302) return downloadToBuf(r.headers.location).then(res).catch(rej);
            const chunks = [];
            r.on('data', c => chunks.push(c));
            r.on('end', () => res(Buffer.concat(chunks)));
          }).on('error', rej);
        });

        const tplBuf = await downloadToBuf(template_image);
        const tplMeta = await sharp(tplBuf).metadata();
        tplOrigW = tplMeta.width;
        tplOrigH = tplMeta.height;
        console.log(`[Worker] [faceswap] 底图原始尺寸: ${tplOrigW}x${tplOrigH} → 输出: ${outW}x${outH}`);

        // 构建 API mask（用底图原始尺寸作为 input，缩放到输出尺寸）
        const { apiBuf } = await buildSceneMask(tplOrigW, tplOrigH, maskConfig, outW, outH);
        if (!apiBuf) {
          throw new Error(`buildSceneMask 返回空 apiBuf，mask 配置无效`);
        }
        apiMaskBase64 = `data:image/png;base64,${apiBuf.toString('base64')}`;
        console.log(`[Worker] [faceswap] inpaint mask 已构建 (${apiBuf.length} bytes)`);

        // Pre-fill mask: 用肤色填充 mannequin 区域（坐标需缩放到输出尺寸）
        const scaleX = outW / tplOrigW;
        const scaleY = outH / tplOrigH;
        const tplResized = await sharp(tplBuf).resize(outW, outH, { fit: 'fill' }).toBuffer();
        const mcx = Math.round((maskConfig.apiCx ?? maskConfig.cx) * scaleX);
        const mcy = Math.round((maskConfig.apiCy ?? maskConfig.cy) * scaleY);
        const mw  = Math.round((maskConfig.apiW ?? maskConfig.w) * scaleX);
        const mh  = Math.round((maskConfig.apiH ?? maskConfig.h) * scaleY);
        const mLeft = mcx - Math.round(mw / 2);
        const mTop  = mcy - Math.round(mh / 2);
        const skinSvg = `<svg width="${mw}" height="${mh}"><rect width="${mw}" height="${mh}" fill="rgb(180,155,130)"/></svg>`;
        const filledBuf = await sharp(tplResized)
          .composite([{ input: Buffer.from(skinSvg), blend: 'over', left: mLeft, top: mTop }])
          .jpeg({ quality: 95 })
          .toBuffer();
        preFilledTemplate = `data:image/jpeg;base64,${filledBuf.toString('base64')}`;
        console.log(`[Worker] [faceswap] preFill mask 已应用 (${mLeft},${mTop}) ${mw}x${mh}`);
      } catch (maskErr) {
        console.error(`[Worker] [faceswap] inpaint mask 构建失败: ${maskErr.message}`);
        throw new Error(`inpaint mask 构建失败: ${maskErr.message}`);
      }
    }
    // ── 步骤5-7: 生成 + 后处理 + 验证（含重试） ──
    const MAX_GENERATE_ATTEMPTS = 2;
    let imageResult, finalUrl, compositeUsed;

    for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
      // ── 步骤5: 生成图片 ──
      if (sceneMode === 'inpaint' && apiMaskBase64) {
        // inpaint 模式：直接 API 调用，匹配测试文件的 payload 结构
        const INPAINT_API_URL = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
        const INPAINT_MODEL = process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128';
        const INPAINT_API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;

        console.log(`[Worker] [faceswap] inpaint 直接调用 (attempt ${attempt + 1}/${MAX_GENERATE_ATTEMPTS})`);

        const inpaintPayload = {
          model: INPAINT_MODEL,
          prompt,
          negative_prompt,
          image: [preFilledTemplate, processedUserImage],
          mask_image: apiMaskBase64,
          strength: resolvedStrength,
          guidance_scale: resolvedGuidance,
          response_format: 'url',
          size: resolvedSize,
          stream: false,
        };

        const inpaintRes = await axios.post(INPAINT_API_URL, inpaintPayload, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${INPAINT_API_KEY}`,
          },
          timeout: 180000,
        }).catch(err => {
          const errData = err.response?.data;
          if (errData?.error) {
            const e = errData.error;
            throw new Error(`Seedream Inpaint API [${e.code || ''}]: ${e.message || JSON.stringify(e)}`);
          }
          throw err;
        });

        if (inpaintRes.data?.error) {
          throw new Error(`Seedream Inpaint API [${inpaintRes.data.error.code || ''}]: ${inpaintRes.data.error.message || JSON.stringify(inpaintRes.data.error)}`);
        }
        const urls = (inpaintRes.data?.data || []).map(item => item.url).filter(Boolean);
        if (urls.length === 0) {
          throw new Error('Seedream Inpaint 未返回图片 URL');
        }
        imageResult = { url: urls[0], urls };
      } else {
        // 非 inpaint 模式：使用标准 generateNativeImage
        imageResult = await generateNativeImage({
          prompt,
          negative_prompt,
          images: [preFilledTemplate, processedUserImage],
          size: resolvedSize,
          mask_image: apiMaskBase64,
          scene_params: {
            strength:        resolvedStrength,
            guidance_scale:  resolvedGuidance,
          },
        });
      }
      console.log(`[Worker] [faceswap] 生成成功 (attempt ${attempt + 1}/${MAX_GENERATE_ATTEMPTS}, ${Date.now() - t0}ms): ${imageResult.url.substring(0, 80)}...`);

      // ── 步骤6: 后处理（根据 mode 分支）──
      finalUrl = imageResult.url;
      compositeUsed = false;

      if ((sceneMode === 'faceswap-composite' || sceneMode === 'inpaint') && genderSceneConfig?.mask && !genderSceneConfig.skipComposite) {
        try {
          const { w: outW, h: outH } = parseSize(resolvedSize);
          let maskInputW = tplOrigW, maskInputH = tplOrigH;
          // 如果步骤5没有获取底图尺寸（faceswap-composite 不走步骤5的 inpaint 分支），需要获取
          if (!maskInputW || !maskInputH) {
            const http = require('http');
            const https = require('https');
            const downloadToBufForMeta = (url) => new Promise((res, rej) => {
              const c = url.startsWith('https') ? https : http;
              c.get(url, r => {
                if (r.statusCode === 301 || r.statusCode === 302) return downloadToBufForMeta(r.headers.location).then(res).catch(rej);
                const chunks = [];
                r.on('data', c => chunks.push(c));
                r.on('end', () => res(Buffer.concat(chunks)));
              }).on('error', rej);
            });
            const tplBufForMeta = await downloadToBufForMeta(template_image);
            const tplMeta = await sharp(tplBufForMeta).metadata();
            maskInputW = tplMeta.width;
            maskInputH = tplMeta.height;
          }
          console.log(`[Worker] [faceswap] composite mask: 底图 ${maskInputW}x${maskInputH} → 输出 ${outW}x${outH}`);
          const { compBuf } = await buildSceneMask(maskInputW, maskInputH, genderSceneConfig.mask, outW, outH);
          if (compBuf) {
            const finalPath = await compositeWithMask(template_image, imageResult.url, compBuf, outW, outH, taskId);
            finalUrl = `file://${finalPath}`;
            compositeUsed = true;
            console.log(`[Worker] [faceswap] ${sceneMode} composite 完成`);
          }
        } catch (compErr) {
          console.error(`[Worker] [faceswap] ${sceneMode} composite 失败，任务终止: ${compErr.message}`);
          throw new Error(`${sceneMode} composite 后处理失败: ${compErr.message}`);
        }
      }

      // ── 步骤7: 可选验证 ──
      let validationFailed = false;
      if (genderSceneConfig?.validateHeadSwap && compositeUsed) {
        try {
          const finalPath = finalUrl.replace('file://', '');
          const finalBuf = await fsp.readFile(finalPath);
          const validation = await validateHeadSwapResult(
            `data:image/jpeg;base64,${finalBuf.toString('base64')}`,
            genderSceneConfig.label || `Scene ${task.params.faceswap_scene}`,
            genderSceneConfig.validationTarget || target_person,
            genderSceneConfig.validationRule || ''
          );
          if (validation.ok && !validation.skipped) {
            console.log(`[Worker] [faceswap] 验证通过: ${validation.reason}`);
          } else if (!validation.ok) {
            if (attempt < MAX_GENERATE_ATTEMPTS - 1) {
              console.warn(`[Worker] [faceswap] 验证失败 (attempt ${attempt + 1}), 准备重试生成: ${validation.reason}`);
              validationFailed = true;
            } else {
              console.error(`[Worker] [faceswap] 验证失败 (第 ${attempt + 1} 次生成，已达最大重试次数): ${validation.reason}`);
              throw new Error(`换脸结果验证失败: ${validation.reason}`);
            }
          }
        } catch (valErr) {
          if (valErr.message.startsWith('换脸结果验证失败')) throw valErr;
          console.warn(`[Worker] [faceswap] 验证 API 调用异常，跳过验证: ${valErr.message}`);
        }
      }

      if (!validationFailed) break;
    }

    // ── 兼容原有 RegionSync ──
    if (!compositeUsed && task.params.enable_region_sync && task.params.region_sync_key) {
      try {
        const os   = require('os');
        const http = require('http');
        const https = require('https');
        const { composeEditRegionsOverBase } = require('./regionComposer');
        const faceswapRegions = require('./data/faceswapRegions.json');
        const regionCfg = faceswapRegions[task.params.region_sync_key];

        if (regionCfg) {
          console.log(`[Worker] [faceswap] RegionSync 启动 key="${task.params.region_sync_key}"...`);
          const tmpDir = os.tmpdir();
          const tmpTemplate  = path.join(tmpDir, `rs_tpl_${taskId}.jpg`);
          const tmpGenerated = path.join(tmpDir, `rs_gen_${taskId}.jpg`);
          const tmpFinal     = path.join(tmpDir, `rs_final_${taskId}.jpg`);

          const downloadTmp = (url, dest) => new Promise((res, rej) => {
            const client = url.startsWith('https') ? https : http;
            const file   = require('fs').createWriteStream(dest);
            client.get(url, r => {
              if (r.statusCode === 301 || r.statusCode === 302) {
                file.close(); require('fs').unlinkSync(dest);
                return downloadTmp(r.headers.location, dest).then(res).catch(rej);
              }
              r.pipe(file);
              file.on('finish', () => { file.close(); res(); });
            }).on('error', rej);
          });

          await downloadTmp(template_image,  tmpTemplate);
          await downloadTmp(imageResult.url, tmpGenerated);

          await composeEditRegionsOverBase({
            sourceImage: tmpTemplate,
            targetImage: tmpGenerated,
            outputImage: tmpFinal,
            regions:     regionCfg.editRegions,
          });

          finalUrl = `file://${tmpFinal}`;
          console.log(`[Worker] [faceswap] RegionSync 完成 → ${tmpFinal}`);

          await fsp.unlink(tmpTemplate).catch(() => {});
          await fsp.unlink(tmpGenerated).catch(() => {});
        } else {
          console.warn(`[Worker] [faceswap] RegionSync 配置未找到: "${task.params.region_sync_key}"，跳过`);
        }
      } catch (rsErr) {
        console.warn(`[Worker] [faceswap] RegionSync 失败，降级使用原始生成图: ${rsErr.message}`);
        finalUrl = imageResult.url;
      }
    }

    // ── 步骤8: 图片本地化 ──
    const callbackUrl_image = await localizeResultImage(finalUrl, taskId);

    await updateTask(taskId, {
      status: STATUS.COMPLETED,
      results: [{
        image_url: callbackUrl_image,
        url: callbackUrl_image,
        url_original: imageResult.url,
        urls: imageResult.urls,
        user_description: userDescription,
        scene_mode: sceneMode,
        composite_used: compositeUsed,
        region_sync: task.params.enable_region_sync === true,
      }],
    });

    await callbackH5WithRetry(callback_url, {
      task_id: taskId,
      user_image: callbackUrl_image,
    });

    console.log(`[Worker] [faceswap] 任务完成: ${taskId} (mode=${sceneMode}, composite=${compositeUsed}, 总耗时 ${Date.now() - t0}ms)`);
  } catch (err) {
    console.error(`[Worker] [faceswap] 任务失败: ${taskId} (${Date.now() - t0}ms)`, err.message);

    await updateTask(taskId, { status: STATUS.FAILED, error: err.message });

    try {
      await callbackH5WithRetry(callback_url, {
        task_id: taskId,
        status: 'failed',
        error: err.message,
        message: '生成失败，请重试',
      });
    } catch (callbackErr) {
      console.warn(`[Worker] [faceswap] 失败回调发送异常: ${callbackErr.message}`);
    }
  }
}

/**
 * 处理单个合成任务
 */
async function processTask(taskId) {
  const t0 = Date.now();
  const task = await getTask(taskId);
  if (!task) {
    console.error(`[Worker] 任务不存在: ${taskId}`);
    return;
  }

  // Faceswap 模式：独立分支处理
  if (task.params.mode === 'faceswap') {
    return processFaceswapTask(taskId, task);
  }

  const {
    star_ids, scene_id, user_image, user_images, user_mode, gender, callback_url,
  } = task.params;

  console.log(`[Worker] 开始处理合照任务: ${taskId}`);
  console.log(`[Worker] 球星: ${star_ids}, 场景: ${scene_id}, 模式: ${user_mode}, 性别: ${gender || 'male'}`);

  await updateTask(taskId, { status: STATUS.PROCESSING });

  try {
    if (SEEDREAM_MODE === 'native' || SEEDREAM_MODE === 'seedream') {
      // ═══ native / seedream 模式（官方 Seedream 4.5 API） ═══
      const scenes = require('./data/scenes');
      const scene = scenes[scene_id];

      const resolvedUserImagesNative = (Array.isArray(user_images) && user_images.length > 0)
        ? user_images
        : [user_image];
      const userImageCountNative = resolvedUserImagesNative.length;

      // 1. 用户外貌描述（调用视觉模型，失败时回退到固定描述）
      const t1 = Date.now();
      console.log(`[Worker] 步骤1: 解读用户照片...`);
      let userDescription;
      try {
        userDescription = await describeUser(resolvedUserImagesNative[0]);
        console.log(`[Worker] 用户描述: ${userDescription.substring(0, 100)}... (${Date.now() - t1}ms)`);
      } catch (visionErr) {
        console.warn(`[Worker] 用户照片解读失败，使用固定描述: ${visionErr.message}`);
        userDescription = 'An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses.';
      }

      // 2. 先确定球星参考图分组及索引，再拼装 Prompt
      const t2 = Date.now();
      console.log(`[Worker] 步骤2: 计算球星参考图索引并拼装 Prompt...`);
      const playerRefGroups = getPlayerReferenceImages(star_ids);
      const playerImageMap = {};
      let nextIdx = userImageCountNative + 1; // 用户占 image[1]~image[N]，球星从 image[N+1] 起
      for (const group of playerRefGroups) {
        playerImageMap[group.star_id] = group.refs.map((_, i) => nextIdx + i);
        nextIdx += group.refs.length;
      }
      const { prompt, player_names } = buildAllPrompts(star_ids, scene_id, user_mode, userDescription, { nativeMode: true, playerImageMap, userImageCount: userImageCountNative });
      console.log(`[Worker] 球星: ${player_names.join(', ')} | Prompt: ${prompt.length} 字符 (${Date.now() - t2}ms)`);

      // 3. 加载参考图（按优先级分级）
      const t3 = Date.now();
      console.log(`[Worker] 步骤3: 加载参考图...`);

      // P0: 核心参考图（必须保留）
      const coreImages = [...resolvedUserImagesNative];
      console.log(`[Worker] [P0] 已加载用户照片: ${userImageCountNative}张`);

      for (const group of playerRefGroups) {
        for (const ref of group.refs) {
          coreImages.push(await ref.image);
          console.log(`[Worker] [P0] 已加载球星参考图: ${ref.source}`);
        }
      }

      // P1: 高优先级参考图（酒杯、球衣）
      const highPriorityImages = [];

      const beerMugImage = await loadBeerMugReference(scene_id);
      if (beerMugImage) {
        highPriorityImages.push(beerMugImage);
        console.log(`[Worker] [P1] 已加载场景${scene_id}酒杯参考图`);
      }

      const jerseyImages = await loadJerseyReferences(scene_id);
      if (jerseyImages.length > 0) {
        highPriorityImages.push(...jerseyImages);
        console.log(`[Worker] [P1] 已加载场景${scene_id}球衣参考图: ${jerseyImages.length}张`);
      }

      // 场景背景参考图提升到P1
      const bgImage = await loadBackgroundReference(scene_id);
      if (bgImage) {
        highPriorityImages.push(bgImage);
        console.log(`[Worker] [P1] 已加载场景${scene_id}背景参考图`);
      }

      // P2: 中优先级参考图（合照参考图）
      const mediumPriorityImages = [];

      const compositionImage = await loadCompositionReference(scene_id);
      if (compositionImage) {
        mediumPriorityImages.push(compositionImage);
        console.log(`[Worker] [P2] 已加载场景${scene_id}合照参考图`);
      }

      // P3: 低优先级参考图（场景参考图，最后被裁剪）
      const lowPriorityImages = [];

      if (!scene?.skip_scene_ref) {
        const refImage = await loadReferenceImage(scene_id, 'adult', gender || 'male');
        if (refImage) {
          lowPriorityImages.push(refImage);
          console.log(`[Worker] [P3] 已加载场景${scene_id}场景参考图`);
        }
      } else {
        console.log(`[Worker] 场景${scene_id} 跳过场景参考图（skip_scene_ref=true）`);
      }

      // 按优先级组装并应用 max_ref_images 限制
      const maxRefImages = scene?.native_params?.max_ref_images;
      const images = [];

      // 先添加P0（核心）
      images.push(...coreImages);

      // 如果还有空间，添加P1（高优先级）
      if (images.length < maxRefImages) {
        const remaining1 = maxRefImages - images.length;
        images.push(...highPriorityImages.slice(0, remaining1));
      }

      // 如果还有空间，添加P2（中优先级）
      if (images.length < maxRefImages) {
        const remaining2 = maxRefImages - images.length;
        images.push(...mediumPriorityImages.slice(0, remaining2));
      }

      // 如果还有空间，添加P3（低优先级）
      if (images.length < maxRefImages) {
        const remaining3 = maxRefImages - images.length;
        images.push(...lowPriorityImages.slice(0, remaining3));
      }

      if (images.length < coreImages.length + highPriorityImages.length) {
        console.log(`[Worker] ⚠️ 警告: 核心或高优先级参考图被裁剪！`);
      }

      console.log(`[Worker] 参考图总计: ${images.length} 张 (P0:${coreImages.length}, P1:${highPriorityImages.length}, P2:${mediumPriorityImages.length}, P3:${lowPriorityImages.length}) (${Date.now() - t3}ms)`);

      // 4. 调用官方 Seedream API
      const t4 = Date.now();
      const sceneSize = scene?.recommended_size || '2K';
      const nativeParams = scene?.native_params || {};
      console.log(`[Worker] 步骤4: 调用 Seedream API (size=${sceneSize}, strength=${nativeParams.strength ?? 0.5}, guidance=${nativeParams.guidance_scale ?? 8})...`);
      const baseNegPrompt = scene_id === '4'
        ? 'missing person, only 2 players, only 1 player, only 3 humans, player cut off, player missing, hidden player, player not visible, no bernie, missing mascot'
        : 'extra people, additional people, bystanders, crowd, background figures, fifth person, group of 5, more than 4 people';

      const imageResult = await generateWithRetry({
        prompt,
        negative_prompt: baseNegPrompt,
        images,
        size: sceneSize,
        scene_params: nativeParams,
        task_id: taskId,
      });

      console.log(`[Worker] 生成成功 (${Date.now() - t4}ms): ${imageResult.url.substring(0, 80)}...`);

      // 5. 图片本地化 + 更新任务结果
      const localizedUrl = await localizeResultImage(imageResult.url, taskId);
      await updateTask(taskId, {
        status: STATUS.COMPLETED,
        results: [{
          player_names,
          image_url: localizedUrl,
          urls: imageResult.urls,
          user_description: userDescription,
        }],
      });

      // 6. 回调 H5
      await callbackH5WithRetry(callback_url, {
        task_id: taskId,
        user_image: localizedUrl,
      });

      console.log(`[Worker] 任务完成: ${taskId} (总耗时 ${Date.now() - t0}ms)`);

    } else if (SEEDREAM_MODE === 'minimal') {
      // ═══ minimal 模式（场景1/2/3仅球迷+场景，场景4含球员） ═══
      const scenesMin = require('./data/scenes_minimal');
      const scene = scenesMin[scene_id];

      const resolvedUserImages = (Array.isArray(user_images) && user_images.length > 0)
        ? user_images : [user_image];
      const userImageCount = resolvedUserImages.length;

      // 调用视觉模型生成个性化外貌描述，失败时回退到固定描述
      let userDescription;
      try {
        console.log(`[Worker] [minimal] 调用视觉模型解析用户外貌...`);
        const visionDesc = await describeUserAppearance(resolvedUserImages);
        userDescription = `An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses. ADDITIONAL APPEARANCE DETAILS: ${visionDesc}`;
        console.log(`[Worker] [minimal] 视觉模型描述: ${visionDesc.substring(0, 100)}...`);
      } catch (visionErr) {
        console.warn(`[Worker] [minimal] 视觉模型调用失败，使用固定描述: ${visionErr.message}`);
        userDescription = 'An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses.';
      }

      const images = [...resolvedUserImages];
      let playerImageMap = {};

      // 所有场景均加载球员参考图（方案B：场景1/2/3也带球员）
      const playerRefGroups = getPlayerReferenceImages(star_ids);
      let nextIdx = userImageCount + 1;
      for (const group of playerRefGroups) {
        playerImageMap[group.star_id] = group.refs.map((_, i) => nextIdx + i);
        nextIdx += group.refs.length;
        for (const ref of group.refs) {
          images.push(await ref.image);
          console.log(`[Worker] [minimal/P0] 已加载球星参考图: ${ref.source}`);
        }
      }

      // 加载场景素材
      const bgImage = await loadBackgroundReference(scene_id);
      const bgImageIdx = bgImage ? images.length + 1 : 0;
      if (bgImage) { images.push(bgImage); console.log(`[Worker] [minimal/P1] 背景图 Image ${bgImageIdx}`); }

      const beerMugImage = await loadBeerMugReference(scene_id);
      if (beerMugImage) { images.push(beerMugImage); console.log(`[Worker] [minimal/P1] 酒杯图`); }

      const jerseyImages = await loadJerseyReferences(scene_id, 1);
      const jerseyImageIdx = jerseyImages.length > 0 ? images.length + 1 : 0;
      for (const j of jerseyImages) { images.push(j); }
      if (jerseyImages.length > 0) console.log(`[Worker] [minimal/P1] 球衣图 Image ${jerseyImageIdx}`);

      // 所有场景统一走 nativeMode 4人路径
      const promptOptions = { nativeMode: true, playerImageMap, userImageCount, backgroundImageIdx: bgImageIdx, jerseyImageIdx };

      const { prompt, player_names, native_params: minSceneParams } = buildAllPrompts(
        star_ids, scene_id, user_mode, userDescription, promptOptions
      );

      console.log(`[Worker] [minimal] 场景${scene_id} Prompt: ${prompt.length} 字符 | 图片: ${images.length} 张`);

      const nativeParamsMin = minSceneParams || scene?.native_params || {};
      const imageResult = await generateWithRetry({
        prompt,
        images,
        size: scene?.recommended_size || '1536x2560',
        scene_params: nativeParamsMin,
        task_id: taskId,
      });

      console.log(`[Worker] [minimal] 生成成功: ${imageResult.url.substring(0, 80)}...`);

      await updateTask(taskId, {
        status: STATUS.COMPLETED,
        results: [{ player_names, image_url: imageResult.url, urls: imageResult.urls, user_description: userDescription }],
      });

      await callbackH5WithRetry(callback_url, { task_id: taskId, user_image: imageResult.url });
      console.log(`[Worker] 任务完成: ${taskId} (总耗时 ${Date.now() - t0}ms)`);

    } else {
      // ═══ relay 模式（中转平台 / Nano_Banana_Pro） ═══
      // 图片预算：9张 = 1~3(用户) + 3(球星各1张) + 1(背景参考) + 1(啤酒杯) + 1(球衣)

      const resolvedUserImages = (Array.isArray(user_images) && user_images.length > 0)
        ? user_images
        : [user_image];
      const userImageCount = resolvedUserImages.length;

      // 用户外貌描述（固定描述，Seedream 直接参考用户照片还原）
      const userDescription = 'An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses.';
      console.log(`[Worker] 使用固定用户描述`);

      // 先加载参考图，确定背景图索引后再拼装 Prompt
      // P0: 用户照片（1~3张，球迷人脸还原）
      const extraImages = [...resolvedUserImages];
      console.log(`[Worker] [P0] 已加载用户照片: ${userImageCount}张`);

      // P0: 球星参考图（每人限1张，节省槽位给背景和道具）
      const playerRefGroupsRelay = getPlayerReferenceImages(star_ids);
      for (const group of playerRefGroupsRelay) {
        if (group.refs.length > 0) {
          extraImages.push(await group.refs[0].image);
          console.log(`[Worker] [P0] 已加载球星参考图: ${group.refs[0].source}`);
        }
      }

      // P0: 背景参考图（提升至 P0，紧跟球星，确保模型关注背景环境）
      const bgImageIdx = extraImages.length + 1;
      const bgImage = await loadBackgroundReference(scene_id);
      if (bgImage) {
        extraImages.push(bgImage);
        console.log(`[Worker] [P0] 已加载背景参考图 (Image %d)`, bgImageIdx);
      }

      // P1: 啤酒杯参考图
      const beerMugImage = await loadBeerMugReference(scene_id);
      if (beerMugImage) {
        extraImages.push(beerMugImage);
        console.log(`[Worker] [P1] 已加载啤酒杯参考图`);
      }

      // P2: 球衣参考图（如果还有槽位）
      const jerseyImages = await loadJerseyReferences(scene_id, 1);
      const jerseyImageIdx = jerseyImages.length > 0 ? extraImages.length + 1 : 0;
      for (const j of jerseyImages) {
        extraImages.push(j);
      }
      if (jerseyImages.length > 0) console.log(`[Worker] [P2] 已加载球衣参考图: ${jerseyImages.length}张 (Image ${jerseyImageIdx})`);

      // 图片加载完毕，拼装 Prompt（此时 bgImageIdx 已确定）
      const t2 = Date.now();
      console.log(`[Worker] 步骤2: 拼装 Prompt (full, userImages=${userImageCount}, bgImage=${bgImage ? bgImageIdx : 0}, jersey=${jerseyImageIdx})...`);
      const { prompt, player_names } = buildAllPrompts(star_ids, scene_id, user_mode, userDescription, { nativeMode: false, userImageCount, backgroundImageIdx: bgImage ? bgImageIdx : 0, jerseyImageIdx });
      console.log(`[Worker] 球星: ${player_names.join(', ')} | Prompt: ${prompt.length} 字符 (${Date.now() - t2}ms)`);

      const scenesRelay = require('./data/scenes');

      console.log(`[Worker] 参考图总计: ${extraImages.length} 张`);

      const t4 = Date.now();
      const sceneSizeRelay = scenesRelay[scene_id]?.recommended_size || '2K';
      console.log(`[Worker] 步骤3: 调用 Seedream 生成 (size=${sceneSizeRelay})...`);

      const imageResult = await generateWithRetry({
        prompt,
        extra_images: extraImages,
        size: sceneSizeRelay,
      });

      console.log(`[Worker] 生成成功 (${Date.now() - t4}ms)`);

      await updateTask(taskId, {
        status: STATUS.COMPLETED,
        results: [{
          player_names,
          image_url: imageResult.url,
          urls: imageResult.urls,
          user_description: userDescription,
        }],
      });

      await callbackH5WithRetry(callback_url, {
        task_id: taskId,
        user_image: imageResult.url,
      });

      console.log(`[Worker] 任务完成: ${taskId} (总耗时 ${Date.now() - t0}ms)`);
    }

  } catch (err) {
    console.error(`[Worker] 任务失败: ${taskId} (${Date.now() - t0}ms)`, err.message);

    await updateTask(taskId, {
      status: STATUS.FAILED,
      error: err.message,
    });

    // 失败时也回调前端，提示重试
    try {
      await callbackH5WithRetry(callback_url, {
        task_id: taskId,
        status: 'failed',
        error: err.message,
        message: '生成失败，请重试',
      });
    } catch (callbackErr) {
      console.warn(`[Worker] 失败回调发送异常: ${callbackErr.message}`);
    }
  }
}

module.exports = { processTask };
