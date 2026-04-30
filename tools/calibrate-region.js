/**
 * tools/calibrate-region.js
 *
 * RegionSync 区域坐标可视化校准工具
 *
 * 用途：
 *   在模板图上叠加半透明彩色矩形，预览 faceswapRegions.json 的 editRegions 位置。
 *   肉眼检查矩形是否准确覆盖目标球迷区域，不对则修改 json 后再运行。
 *
 * 用法：
 *   node tools/calibrate-region.js                          # 生成所有场景预览图
 *   node tools/calibrate-region.js scene1_male              # 只生成指定场景
 *   node tools/calibrate-region.js scene1_male scene3_male  # 生成多个场景
 *
 * 输出：
 *   生成测试/calibrate/<sceneKey>_preview.jpg
 */

const path  = require('path');
const fs    = require('fs');
const sharp = require(path.join(__dirname, '../server/node_modules/sharp'));

const ROOT         = path.join(__dirname, '..');
const REGIONS_JSON = path.join(__dirname, '../server/src/data/faceswapRegions.json');
const OUT_DIR      = path.join(ROOT, '生成测试', 'calibrate');

// 叠加色（RGBA）：半透明红色
const OVERLAY_R = 220;
const OVERLAY_G = 40;
const OVERLAY_B = 40;
const OVERLAY_A = 120; // 0~255，120 ≈ 47% 不透明度

async function renderPreview(sceneKey, cfg) {
  const templatePath = path.join(ROOT, cfg.templateFile);

  if (!fs.existsSync(templatePath)) {
    console.warn(`  [跳过] 模板文件不存在: ${cfg.templateFile}`);
    return;
  }

  const meta = await sharp(templatePath).metadata();
  const W = meta.width;
  const H = meta.height;

  const compositeOps = [];

  for (const region of cfg.editRegions) {
    // 归一化 → 像素
    const px = region.x      <= 1 ? Math.round(region.x * W)      : Math.round(region.x);
    const py = region.y      <= 1 ? Math.round(region.y * H)       : Math.round(region.y);
    const pw = region.width  <= 1 ? Math.round(region.width * W)   : Math.round(region.width);
    const ph = region.height <= 1 ? Math.round(region.height * H)  : Math.round(region.height);

    const safeX = Math.max(0, Math.min(px, W - 1));
    const safeY = Math.max(0, Math.min(py, H - 1));
    const safeW = Math.max(1, Math.min(pw, W - safeX));
    const safeH = Math.max(1, Math.min(ph, H - safeY));

    console.log(`  区域 "${region.id}": x=${safeX} y=${safeY} w=${safeW} h=${safeH}  (图尺寸 ${W}x${H})`);

    // 生成纯色半透明矩形
    const rectBuf = await sharp({
      create: {
        width:      safeW,
        height:     safeH,
        channels:   4,
        background: { r: OVERLAY_R, g: OVERLAY_G, b: OVERLAY_B, alpha: OVERLAY_A / 255 },
      },
    }).png().toBuffer();

    compositeOps.push({ input: rectBuf, left: safeX, top: safeY, blend: 'over' });

    // 在矩形四边加 4px 实线边框（更明显）
    const borderThick = 4;
    const borderColor = { r: OVERLAY_R, g: OVERLAY_G, b: OVERLAY_B, alpha: 1 };

    // 上边
    if (safeH > borderThick * 2) {
      const topBuf = await sharp({
        create: { width: safeW, height: borderThick, channels: 4, background: borderColor },
      }).png().toBuffer();
      compositeOps.push({ input: topBuf, left: safeX, top: safeY, blend: 'over' });

      // 下边
      const botBuf = await sharp({
        create: { width: safeW, height: borderThick, channels: 4, background: borderColor },
      }).png().toBuffer();
      compositeOps.push({ input: botBuf, left: safeX, top: safeY + safeH - borderThick, blend: 'over' });

      // 左边
      const leftBuf = await sharp({
        create: { width: borderThick, height: safeH, channels: 4, background: borderColor },
      }).png().toBuffer();
      compositeOps.push({ input: leftBuf, left: safeX, top: safeY, blend: 'over' });

      // 右边
      const rightBuf = await sharp({
        create: { width: borderThick, height: safeH, channels: 4, background: borderColor },
      }).png().toBuffer();
      compositeOps.push({ input: rightBuf, left: safeX + safeW - borderThick, top: safeY, blend: 'over' });
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const outFile = path.join(OUT_DIR, `${sceneKey}_preview.jpg`);
  await sharp(templatePath)
    .composite(compositeOps)
    .jpeg({ quality: 92 })
    .toFile(outFile);

  console.log(`  ✓ 预览图已生成: 生成测试/calibrate/${sceneKey}_preview.jpg`);
}

async function main() {
  const regions = JSON.parse(fs.readFileSync(REGIONS_JSON, 'utf8'));
  const allKeys = Object.keys(regions).filter(k => !k.startsWith('_'));

  // CLI 指定了 key 则只处理指定的
  const targetKeys = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : allKeys;

  console.log(`\n=== RegionSync 坐标校准预览工具 ===`);
  console.log(`输出目录: 生成测试/calibrate/\n`);

  for (const key of targetKeys) {
    if (!regions[key]) {
      console.warn(`[警告] 未找到场景配置: ${key}（可用: ${allKeys.join(', ')}）`);
      continue;
    }
    console.log(`\n[${key}] ${regions[key].description}`);
    await renderPreview(key, regions[key]);
  }

  console.log('\n完成。请打开预览图检查红色矩形是否准确覆盖目标球迷区域。');
  console.log('如需调整，修改 server/src/data/faceswapRegions.json 后重新运行。\n');
}

main().catch(err => {
  console.error('[calibrate-region] 错误:', err.message);
  process.exit(1);
});
