/**
 * regionComposer.js
 *
 * 局部区域回贴合成模块（RegionSync）
 *
 * 核心思路（反向遮罩法）：
 *   以生成图为底图，把模板放大后叠盖——但在 editRegions 区域内
 *   将模板设为透明（打"孔"），使生成图的换脸结果透出来。
 *   editRegion 以外的所有像素 100% 来自模板原图（球星脸、logo、背景全部还原）。
 *
 *   优点：不需要知道换脸后人脸在生成图的精确位置，
 *         只需要知道人脸在模板里的位置即可。
 *
 * 依赖：sharp（项目已有，无新依赖）
 */

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

/**
 * 把模板非脸部区域合成回生成图
 *
 * @param {object} opts
 * @param {string|Buffer} opts.sourceImage      原始模板图（像素来源）
 * @param {string|Buffer} opts.targetImage      Seedream 生成图（换脸底图）
 * @param {string}        opts.outputImage      最终输出文件路径（.jpg）
 * @param {Array}         opts.regions          editRegions 数组
 *                                              { id, x, y, width, height, feather }
 *                                              坐标 <=1 为归一化，>1 为像素值
 * @param {Array}         [opts.restore_regions] 已不需要（模板本身已覆盖所有非脸区域），保留兼容
 * @returns {Promise<{width, height, regions}>}
 */
async function composeEditRegionsOverBase({ sourceImage, targetImage, outputImage, regions, restore_regions }) {
  if (!regions || regions.length === 0) {
    throw new Error('[regionComposer] regions 不能为空');
  }

  const baseMeta = await sharp(sourceImage).metadata();
  const W  = baseMeta.width;
  const H  = baseMeta.height;

  const genMeta = await sharp(targetImage).metadata();
  const Wg = genMeta.width;
  const Hg = genMeta.height;

  const scaleX = Wg / W;
  const scaleY = Hg / H;

  // ── Step 1：构建模板遮罩（生成图分辨率）
  // 默认 255（不透明），在 editRegions 内部打透明孔，使生成图脸部透出
  const maskAlpha = Buffer.alloc(Wg * Hg, 255);

  const resolvedRegions = [];

  for (const region of regions) {
    const feather = region.feather || 0;
    // featherGen 不超过孔最小边的 15%，防止模板低分辨率高缩放时羽化区过大导致脸部模糊
    const featherGenRaw = Math.round(feather * Math.max(scaleX, scaleY));

    // 归一化坐标 → 生成图像素坐标
    const gx = region.x      <= 1 ? Math.round(region.x      * Wg) : Math.round(region.x      * scaleX);
    const gy = region.y      <= 1 ? Math.round(region.y      * Hg) : Math.round(region.y      * scaleY);
    const gw = region.width  <= 1 ? Math.round(region.width  * Wg) : Math.round(region.width  * scaleX);
    const gh = region.height <= 1 ? Math.round(region.height * Hg) : Math.round(region.height * scaleY);

    const safeGx = Math.max(0, Math.min(gx, Wg - 1));
    const safeGy = Math.max(0, Math.min(gy, Hg - 1));
    const safeGw = Math.max(1, Math.min(gw, Wg - safeGx));
    const safeGh = Math.max(1, Math.min(gh, Hg - safeGy));

    // featherGen 上限：不超过孔最小边的 15%，防止模板低分辨率高缩放时羽化区过大（脸部模糊）
    const featherGen = Math.min(featherGenRaw, Math.round(Math.min(safeGw, safeGh) * 0.15));

    // 在 editRegion 内打孔：边缘保留透明度（羽化），中心完全透明
    for (let py = safeGy; py < safeGy + safeGh; py++) {
      for (let px = safeGx; px < safeGx + safeGw; px++) {
        const lx = px - safeGx;
        const ly = py - safeGy;
        // 距 editRegion 边缘的最近距离（越大 = 越靠近中心）
        const distToEdge = Math.min(lx, safeGw - 1 - lx, ly, safeGh - 1 - ly);
        // 遮罩 alpha：边缘=255（模板不透明），向内渐变到 0（模板透明=生成图透出）
        const alpha = featherGen > 0
          ? Math.max(0, 255 - Math.round(distToEdge * 255 / featherGen))
          : 0;  // 无羽化：中心硬切
        maskAlpha[py * Wg + px] = Math.min(maskAlpha[py * Wg + px], alpha);
      }
    }

    resolvedRegions.push({
      id:     region.id || 'region',
      x:      safeGx,
      y:      safeGy,
      width:  safeGw,
      height: safeGh,
      feather: featherGen,
    });

    console.log(`[regionComposer] editRegion "${region.id || 'region'}": 生成图 x=${safeGx} y=${safeGy} w=${safeGw} h=${safeGh} feather=${featherGen}`);
  }

  // maskAlpha → RGBA PNG（dest-in 使用 src 的 alpha 通道）
  const maskRgba = Buffer.alloc(Wg * Hg * 4);
  for (let i = 0; i < Wg * Hg; i++) {
    maskRgba[i * 4 + 3] = maskAlpha[i];
  }
  const maskBuf = await sharp(maskRgba, { raw: { width: Wg, height: Hg, channels: 4 } }).png().toBuffer();

  // ── Step 2：模板放大到生成图分辨率，在 editRegion 内打透明孔
  const maskedTemplateBuf = await sharp(sourceImage)
    .resize(Wg, Hg, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .composite([{ input: maskBuf, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // ── Step 3：以生成图为底图，叠盖带孔的模板
  // editRegion 内：模板透明 → 生成图换脸结果自然透出
  // editRegion 外：模板不透明 → 100% 原始模板像素（球星、logo、背景完全还原）
  const outDir = path.dirname(outputImage);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // ── Step 3：以生成图为底图，叠盖带孔的模板
  // 注意：反向遮罩法中 restore_regions 不再需要——模板本身已覆盖孔外所有像素。
  // 若叠加 restore_regions，其坐标基于模板位置，但生成图因 Seedream 构图偏移
  // 导致人脸实际位置下移，restore 区域会与孔重叠，把模板像素盖在生成图人脸上，
  // 造成"只有半张脸"或"没有头"的问题。
  await sharp(targetImage)
    .composite([{ input: maskedTemplateBuf, blend: 'over' }])
    .jpeg({ quality: 95 })
    .toFile(outputImage);

  console.log(`[regionComposer] 合成完成 → ${outputImage}`);

  return { width: Wg, height: Hg, regions: resolvedRegions };
}

/**
 * 给 patch（RGB Buffer）加羽化 Alpha 通道（保留兼容，当前流程已不调用）
 */
async function applyFeatherAlpha(patchBuf, w, h, feather) {
  const maskData = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dist = Math.min(x, w - 1 - x, y, h - 1 - y);
      maskData[y * w + x] = Math.min(Math.round(dist * 255 / feather), 255);
    }
  }

  const maskPng = await sharp(maskData, {
    raw: { width: w, height: h, channels: 1 },
  }).png().toBuffer();

  return sharp(patchBuf)
    .ensureAlpha()
    .composite([{ input: maskPng, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

module.exports = { composeEditRegionsOverBase, applyFeatherAlpha };
