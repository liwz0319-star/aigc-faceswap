/**
 * 底图瘦身处理 —— 水平压缩目标球迷身体区域
 *
 * 原理：
 *   1. 从底图中提取球迷身体列（含两侧少量背景）
 *   2. 横向缩放至 slimFactor（默认 0.82 = 瘦 18%）
 *   3. 对压缩后的图块左右边缘做羽化渐变，避免硬接缝
 *   4. 合回底图，保存为新文件（不覆盖原图）
 *
 * 用法：
 *   node slim_template.js [male|female|both] [--factor 0.82]
 */

const sharp = require('./node_modules/sharp');
const path  = require('path');
const fs    = require('fs');

const RELAY_DIR = path.join(__dirname, '..', '生成测试', 'relay_test');

// ─── 身体区域配置（像素坐标，已由预览图核验）─────────────────
const CONFIGS = {
  male: {
    file: 'scene_02_user2_1777014143898.png',
    // 脸部中心 cx=670, cy=380 → 身体列估算
    body: { left: 540, top: 130, width: 260, height: 1267 },
  },
  female: {
    file: 'scene_02_1777013168257.png',
    // 脸部中心 cx=700, cy=530 → 身体列估算
    body: { left: 560, top: 350, width: 250, height: 1047 },
  },
};

// ─── 工具：生成左右渐变 alpha 遮罩（用于接缝羽化）──────────────
async function buildFadeMask(width, height, fadeWidth) {
  // 用 SVG linearGradient 生成左右渐变
  const mid = Math.max(0, width - fadeWidth * 2);
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0"                              stop-color="black" stop-opacity="1"/>
        <stop offset="${fadeWidth / width}"           stop-color="white" stop-opacity="1"/>
        <stop offset="${(fadeWidth + mid) / width}"   stop-color="white" stop-opacity="1"/>
        <stop offset="1"                              stop-color="black" stop-opacity="1"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#gl)"/>
  </svg>`;
  // 作为灰度图返回（白=不透明，黑=透明）
  return sharp(Buffer.from(svg))
    .resize(width, height, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

// ─── 主处理函数 ──────────────────────────────────────────────
async function slimTemplate(gender, factor) {
  const cfg    = CONFIGS[gender];
  const { left, top, width, height } = cfg.body;
  const newW   = Math.round(width * factor);
  const fadeW  = 18; // 羽化宽度 px

  // 1. 读取底图 metadata（确认尺寸）
  const inputPath = path.join(RELAY_DIR, cfg.file);
  const meta = await sharp(inputPath).metadata();
  console.log(`[${gender}] 底图: ${meta.width}x${meta.height}`);
  console.log(`[${gender}] 身体区域: left=${left} top=${top} w=${width} h=${height}`);
  console.log(`[${gender}] 压缩因子: ${factor} → 新宽度 ${newW}px (减少 ${width - newW}px)`);

  // 2. 提取身体区域
  const stripBuf = await sharp(inputPath)
    .extract({ left, top, width, height })
    .toBuffer();

  // 3. 横向压缩
  const slimBuf = await sharp(stripBuf)
    .resize(newW, height, { fit: 'fill', kernel: 'lanczos3' })
    .toBuffer();

  // 4. 将压缩后的图块扩回原宽（两侧填透明），居中放置
  const padL = Math.floor((width - newW) / 2);
  const padR = width - newW - padL;
  const paddedBuf = await sharp(slimBuf)
    .extend({ left: padL, right: padR, top: 0, bottom: 0,
              background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // 5. 生成羽化遮罩（PNG 灰度 → 将作为 alpha）
  const { data: maskRaw, info: maskInfo } = await buildFadeMask(width, height, fadeW);

  // 将 padded 图块 + mask 合成带 alpha 的 RGBA 图
  const paddedRgba = await sharp(paddedBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  // 把 maskRaw（灰度）乘入 alpha 通道
  const blended = Buffer.alloc(paddedRgba.info.width * paddedRgba.info.height * 4);
  for (let i = 0; i < paddedRgba.info.width * paddedRgba.info.height; i++) {
    blended[i * 4 + 0] = paddedRgba.data[i * 4 + 0]; // R
    blended[i * 4 + 1] = paddedRgba.data[i * 4 + 1]; // G
    blended[i * 4 + 2] = paddedRgba.data[i * 4 + 2]; // B
    // alpha = original_alpha * mask_gray / 255
    const origA  = paddedRgba.data[i * 4 + 3];
    const maskG  = maskRaw[i];
    blended[i * 4 + 3] = Math.round(origA * maskG / 255);
  }
  const blendedPng = await sharp(blended, {
    raw: { width: paddedRgba.info.width, height: paddedRgba.info.height, channels: 4 }
  }).png().toBuffer();

  // 6. 合回底图
  const outputFile = cfg.file.replace('.png', '_slim.png');
  const outputPath = path.join(RELAY_DIR, outputFile);

  await sharp(inputPath)
    .composite([{ input: blendedPng, left, top, blend: 'over' }])
    .png()
    .toFile(outputPath);

  console.log(`[${gender}] 已保存: ${outputFile}`);

  // 7. 生成对比预览（左=原图裁片 右=处理后裁片）
  const origCrop = await sharp(inputPath)
    .extract({ left, top, width, height })
    .resize(Math.round(width * 0.5))
    .toBuffer();
  const newCrop = await sharp(outputPath)
    .extract({ left, top, width, height })
    .resize(Math.round(width * 0.5))
    .toBuffer();
  const previewPath = path.join(RELAY_DIR, `slim_preview_${gender}.jpg`);
  // 左右拼接
  const hw = Math.round(width * 0.5);
  const hh = Math.round(height * 0.5);
  await sharp({
    create: { width: hw * 2, height: hh, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).composite([
    { input: origCrop, left: 0,  top: 0 },
    { input: newCrop,  left: hw, top: 0 },
  ]).jpeg({ quality: 90 }).toFile(previewPath);
  console.log(`[${gender}] 对比预览: ${path.basename(previewPath)} (左=原图 右=瘦身后)`);

  return outputFile;
}

// ─── 入口 ────────────────────────────────────────────────────
async function main() {
  const args   = process.argv.slice(2);
  const target = args.find(a => ['male','female','both'].includes(a)) || 'both';
  const fi     = args.indexOf('--factor');
  const factor = fi >= 0 ? parseFloat(args[fi + 1]) : 0.82;

  console.log(`瘦身系数: ${factor}  目标: ${target}\n`);

  if (target === 'both' || target === 'male')   await slimTemplate('male',   factor);
  if (target === 'both' || target === 'female') await slimTemplate('female', factor);

  console.log('\n完成！新底图已保存在 relay_test/ 目录。');
  console.log('如需更改瘦身幅度，用 --factor 参数，例如:');
  console.log('  node slim_template.js both --factor 0.78');
}

main().catch(e => { console.error('错误:', e.message); process.exit(1); });
