#!/usr/bin/env node
/**
 * 场景3 mask 调试工具：在底图上可视化 API mask、composite mask 和 neck ellipse 的覆盖位置
 *
 * 用法：
 *   node tools/debug_mask_scene3.js          # 男女都生成
 *   node tools/debug_mask_scene3.js male     # 仅男版
 *   node tools/debug_mask_scene3.js female   # 仅女版
 */
const path = require('path');
const fs = require('fs');
const sharp = require(path.join(__dirname, '..', 'server', 'node_modules', 'sharp'));
const scene3 = require('../scene-configs/scene3');

const OUT_SIZE = '2560x1536';
const [outW, outH] = OUT_SIZE.split('x').map(Number);

async function overlayDebug(gender) {
  const cfg = scene3[gender];
  if (!cfg) { console.log('Unknown gender: ' + gender); return; }
  const mask = cfg.mask;
  const tplPath = path.join(__dirname, '..', '素材', '新场景底图', cfg.file);
  if (!fs.existsSync(tplPath)) { console.log('Missing: ' + tplPath); return; }

  const meta = await sharp(tplPath).metadata();
  const tplW = meta.width, tplH = meta.height;
  const sx = outW / tplW, sy = outH / tplH;
  const buf = await sharp(tplPath).resize(outW, outH, { fit: 'fill' }).toBuffer();

  // --- API mask overlay (blue) ---
  const apiCx = Math.round(mask.apiCx * sx);
  const apiCy = Math.round(mask.apiCy * sy);
  const apiW  = Math.round(mask.apiW * sx);
  const apiH  = Math.round(mask.apiH * sy);
  const apiTop = apiCy - Math.round(apiH / 2);
  const apiLeft = apiCx - Math.round(apiW / 2);

  // hairDome dome
  const domeH = Math.round(mask.apiDomeH * sy);
  const domeExpandX = Math.round(mask.apiDomeExpandX * sx);
  const bodyTop = apiTop + Math.round(domeH * 0.52);
  const bodyH = Math.max(1, apiTop + apiH - bodyTop);
  const topRx = Math.round(apiW / 2) + domeExpandX;
  const topCy = apiTop + domeH;

  // side hair
  const sideRx = Math.round(mask.apiSideHairW * sx);
  const sideRy = Math.round(mask.apiSideHairH * sy);
  const sideOffX = Math.round(mask.apiSideHairOffsetX * sx);
  const sideOffY = Math.round(mask.apiSideHairOffsetY * sy);
  const leftHairCx = apiCx - sideOffX;
  const rightHairCx = apiCx + sideOffX;
  const hairCy = apiTop + sideOffY;

  // neck ellipse (green)
  let neckSvg = '';
  if (mask.apiNeckRx && mask.apiNeckRy) {
    const neckRx = Math.round(mask.apiNeckRx * sx);
    const neckRy = Math.round(mask.apiNeckRy * sy);
    const neckCy = apiTop + Math.round(mask.apiNeckOffsetY * sy);
    neckSvg = `<ellipse cx="${apiCx}" cy="${neckCy}" rx="${neckRx}" ry="${neckRy}" fill="rgba(0,200,0,0.35)" stroke="lime" stroke-width="2"/>`;
    console.log(`  [api] neck ellipse: cx=${apiCx} cy=${neckCy} rx=${neckRx} ry=${neckRy} (bottom=${neckCy + neckRy})`);
  } else {
    console.log('  [api] No neck ellipse configured');
  }

  const svg = `<svg width="${outW}" height="${outH}">
    <rect x="${apiLeft}" y="${bodyTop}" width="${apiW}" height="${bodyH}" fill="rgba(0,0,255,0.2)" stroke="blue" stroke-width="1"/>
    <ellipse cx="${apiCx}" cy="${topCy}" rx="${topRx}" ry="${domeH}" fill="rgba(255,0,0,0.15)" stroke="red" stroke-width="1"/>
    <ellipse cx="${leftHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="rgba(255,165,0,0.2)" stroke="orange" stroke-width="1"/>
    <ellipse cx="${rightHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="rgba(255,165,0,0.2)" stroke="orange" stroke-width="1"/>
    ${neckSvg}
  </svg>`;

  // --- Composite mask overlay (purple, dashed) ---
  const compCx = Math.round(mask.compCx * sx);
  const compCy = Math.round(mask.compCy * sy);
  const compW  = Math.round(mask.compW * sx);
  const compH  = Math.round(mask.compH * sy);
  const compTop = compCy - Math.round(compH / 2);
  const compLeft = compCx - Math.round(compW / 2);

  const compDomeH = Math.round(mask.compDomeH * sy);
  const compDomeExpandX = Math.round(mask.compDomeExpandX * sx);
  const compBodyTop = compTop + Math.round(compDomeH * 0.55);
  const compBodyH = Math.max(1, compTop + compH - compBodyTop);
  const compTopRx = Math.round(compW / 2) + compDomeExpandX;
  const compTopCy = compTop + compDomeH;

  const compSideRx = Math.round(mask.compSideHairW * sx);
  const compSideRy = Math.round(mask.compSideHairH * sy);
  const compSideOffX = Math.round(mask.compSideHairOffsetX * sx);
  const compSideOffY = Math.round(mask.compSideHairOffsetY * sy);
  const compLeftHairCx = compCx - compSideOffX;
  const compRightHairCx = compCx + compSideOffX;
  const compHairCy = compTop + compSideOffY;

  let compNeckSvg = '';
  if (mask.compNeckRx && mask.compNeckRy) {
    const cNeckRx = Math.round(mask.compNeckRx * sx);
    const cNeckRy = Math.round(mask.compNeckRy * sy);
    const cNeckCy = compTop + Math.round(mask.compNeckOffsetY * sy);
    compNeckSvg = `<ellipse cx="${compCx}" cy="${cNeckCy}" rx="${cNeckRx}" ry="${cNeckRy}" fill="rgba(0,200,0,0.2)" stroke="lime" stroke-width="2" stroke-dasharray="6,3"/>`;
    console.log(`  [comp] neck ellipse: cx=${compCx} cy=${cNeckCy} rx=${cNeckRx} ry=${cNeckRy} (bottom=${cNeckCy + cNeckRy})`);
  }

  const svgComp = `<svg width="${outW}" height="${outH}">
    <rect x="${compLeft}" y="${compBodyTop}" width="${compW}" height="${compBodyH}" fill="none" stroke="purple" stroke-width="1" stroke-dasharray="4,4"/>
    <ellipse cx="${compCx}" cy="${compTopCy}" rx="${compTopRx}" ry="${compDomeH}" fill="none" stroke="purple" stroke-width="1" stroke-dasharray="4,4"/>
    <ellipse cx="${compLeftHairCx}" cy="${compHairCy}" rx="${compSideRx}" ry="${compSideRy}" fill="none" stroke="purple" stroke-width="1" stroke-dasharray="4,4"/>
    <ellipse cx="${compRightHairCx}" cy="${compHairCy}" rx="${compSideRx}" ry="${compSideRy}" fill="none" stroke="purple" stroke-width="1" stroke-dasharray="4,4"/>
    ${compNeckSvg}
  </svg>`;

  const outDir = path.join(__dirname, '..', '生成测试');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `debug_mask_scene3_${gender}_v2.jpg`);

  const combined = await sharp(buf)
    .composite([
      { input: Buffer.from(svgComp), blend: 'over' },
      { input: Buffer.from(svg), blend: 'over' },
    ])
    .jpeg({ quality: 90 })
    .toFile(outFile);

  console.log(`${gender} -> ${outFile}`);
  console.log(`  [api]  top=${apiTop} bottom=${apiTop + apiH} domeH=${domeH} bodyTop=${bodyTop}`);
  console.log(`  [comp] top=${compTop} bottom=${compTop + compH} domeH=${compDomeH} bodyTop=${compBodyTop} feather=${mask.compFeather}`);
}

const genders = process.argv.length > 2
  ? [process.argv[2]]
  : ['male', 'female'];

(async () => {
  for (const g of genders) {
    await overlayDebug(g);
  }
})();
