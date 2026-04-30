/**
 * calibrate_regions.js
 *
 * 在模板上绘制 editRegion（红框）和 restore_region（绿框）
 * 供肉眼校准区域坐标是否准确
 *
 * 用法:
 *   node server/calibrate_regions.js
 *
 * 输出: 生成测试/faceswap_temp/calibrate_<key>.jpg
 */

const sharp = require('./node_modules/sharp');
const path  = require('path');
const fs    = require('fs');

const PROJECT_DIR = path.join(__dirname, '..');
const OUT_DIR     = path.join(__dirname, '..', '生成测试', 'faceswap_temp');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const faceswapRegions = require('./src/data/faceswapRegions.json');

async function calibrate(key) {
  const cfg = faceswapRegions[key];
  if (!cfg || !cfg.templateFile) { console.warn('未知 key 或缺少 templateFile:', key); return; }

  // templateFile 相对于项目根目录（如 "生成测试/relay_test/scene2-M.jpg"）
  const tplPath = path.join(PROJECT_DIR, cfg.templateFile);
  if (!fs.existsSync(tplPath)) { console.warn('模板不存在:', tplPath); return; }

  const meta = await sharp(tplPath).metadata();
  const W = meta.width, H = meta.height;
  console.log(`[${key}] 模板尺寸: ${W}x${H}`);

  // 生成 SVG 标注层
  const shapes = [];

  // editRegions → 红框
  for (const r of (cfg.editRegions || [])) {
    const x = r.x <= 1 ? Math.round(r.x * W) : r.x;
    const y = r.y <= 1 ? Math.round(r.y * H) : r.y;
    const w = r.width  <= 1 ? Math.round(r.width  * W) : r.width;
    const h = r.height <= 1 ? Math.round(r.height * H) : r.height;

    shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(255,0,0,0.15)" stroke="red" stroke-width="3"/>`);
    shapes.push(`<text x="${x+4}" y="${y+22}" font-size="20" fill="red" font-weight="bold">FACE x=${x} y=${y} w=${w} h=${h} (bot=${y+h})</text>`);

    // 羽化边界线（距边缘 feather 个像素）
    const f = r.feather || 0;
    if (f > 0) {
      shapes.push(`<rect x="${x+f}" y="${y+f}" width="${w-f*2}" height="${h-f*2}" fill="none" stroke="orange" stroke-width="2" stroke-dasharray="8,4"/>`);
      shapes.push(`<text x="${x+f+4}" y="${y+f+18}" font-size="16" fill="orange">feather=${f} (fully-opaque zone)</text>`);
    }
  }

  // restore_regions → 绿框
  for (const r of (cfg.restore_regions || [])) {
    const x = r.x <= 1 ? Math.round(r.x * W) : r.x;
    const y = r.y <= 1 ? Math.round(r.y * H) : r.y;
    const w = r.width  <= 1 ? Math.round(r.width  * W) : r.width;
    const h = r.height <= 1 ? Math.round(r.height * H) : r.height;

    shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(0,255,0,0.15)" stroke="lime" stroke-width="3"/>`);
    shapes.push(`<text x="${x+4}" y="${y+22}" font-size="20" fill="lime" font-weight="bold">LOGO x=${x} y=${y} w=${w} h=${h} (bot=${y+h})</text>`);
  }

  // 横线：每 5% 高度
  for (let pct = 5; pct < 100; pct += 5) {
    const yy = Math.round(H * pct / 100);
    const isMajor = pct % 10 === 0;
    shapes.push(`<line x1="0" y1="${yy}" x2="${W}" y2="${yy}" stroke="cyan" stroke-width="${isMajor ? 1.5 : 0.7}" opacity="0.4"/>`);
    if (isMajor) shapes.push(`<text x="2" y="${yy-2}" font-size="14" fill="cyan" opacity="0.8">${pct}% (y=${yy})</text>`);
  }

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${shapes.join('')}</svg>`;
  const outFile = path.join(OUT_DIR, `calibrate_${key}.jpg`);

  await sharp(tplPath)
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .jpeg({ quality: 92 })
    .toFile(outFile);

  console.log(`  → ${outFile}`);
}

async function main() {
  const keys = Object.keys(faceswapRegions).filter(k => !k.startsWith('_'));
  for (const key of keys) {
    await calibrate(key);
  }
  console.log('\n校准图已生成，请检查 生成测试/faceswap_temp/ 目录');
}

main().catch(e => { console.error(e.message); process.exit(1); });
