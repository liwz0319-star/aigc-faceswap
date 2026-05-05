#!/usr/bin/env node
/**
 * 生成 scene1 mask 范围可视化
 * 用不同颜色展示 API mask（AI重绘区域）和 Composite mask（后合成区域）
 */
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'server', 'node_modules', 'sharp'));
const scene1 = require('../scene-configs/scene1');

const OUTPUT_W = 2048, OUTPUT_H = 2560;

async function buildMaskOverlay(gender) {
  const cfg = scene1[gender];
  const mask = cfg.mask;
  const tplPath = path.join(__dirname, '..', '素材', '新场景底图', cfg.file);

  // Resize template to output space
  const tplBuf = await sharp(tplPath).resize(OUTPUT_W, OUTPUT_H).toBuffer();
  const meta = await sharp(tplPath).metadata();
  const sx = OUTPUT_W / meta.width, sy = OUTPUT_H / meta.height;

  // === API Mask shapes ===
  const apiCx = Math.round((mask.apiCx ?? mask.cx) * sx);
  const apiCy = Math.round((mask.apiCy ?? mask.cy) * sy);
  const apiW = Math.round((mask.apiW ?? mask.w) * sx);
  const apiH = Math.round((mask.apiH ?? mask.h) * sy);
  const apiTop = apiCy - Math.round(apiH / 2);
  const apiLeft = apiCx - Math.round(apiW / 2);

  const apiDomeH = Math.max(1, Math.round((mask.apiDomeH ?? Math.round(mask.apiH * 0.3)) * sy));
  const apiDomeExpandX = Math.max(0, Math.round((mask.apiDomeExpandX ?? 0) * sx));
  const apiSideRx = Math.max(1, Math.round((mask.apiSideHairW ?? 0) * sx));
  const apiSideRy = Math.max(1, Math.round((mask.apiSideHairH ?? 0) * sy));
  const apiSideOffsetX = Math.max(0, Math.round((mask.apiSideHairOffsetX ?? 0) * sx));
  const apiSideOffsetY = Math.max(0, Math.round((mask.apiSideHairOffsetY ?? 0) * sy));
  const apiBodyTop = apiTop + Math.round(apiDomeH * 0.52);
  const apiBodyH = Math.max(1, apiTop + apiH - apiBodyTop);
  const apiTopRx = Math.round(apiW / 2) + apiDomeExpandX;
  const apiTopCy = apiTop + apiDomeH;

  // API neck ellipse
  let apiNeckSvg = '';
  let apiNeckInfo = '';
  if (mask.apiNeckRx && mask.apiNeckRy) {
    const nRx = Math.max(1, Math.round(mask.apiNeckRx * sx));
    const nRy = Math.max(1, Math.round(mask.apiNeckRy * sy));
    const nCy = apiTop + Math.round((mask.apiNeckOffsetY ?? apiH * 0.8) * sy);
    apiNeckSvg = `<ellipse cx="${apiCx}" cy="${nCy}" rx="${nRx}" ry="${nRy}" fill="rgba(0,255,0,0.4)" stroke="lime" stroke-width="3"/>`;
    apiNeckInfo = `脖子椭圆: cy=${nCy} rx=${nRx} ry=${nRy} Y:${nCy-nRy}~${nCy+nRy}`;
  }

  // === Composite Mask shapes ===
  const compCx = Math.round((mask.compCx ?? mask.cx) * sx);
  const compCy = Math.round((mask.compCy ?? mask.cy) * sy);
  const compW = Math.round((mask.compW ?? mask.w) * sx);
  const compH = Math.round((mask.compH ?? mask.h) * sy);
  const compTop = compCy - Math.round(compH / 2);
  const compLeft = compCx - Math.round(compW / 2);

  const compDomeH = Math.max(1, Math.round((mask.compDomeH ?? Math.round(mask.compH * 0.32)) * sy));
  const compDomeExpandX = Math.max(0, Math.round((mask.compDomeExpandX ?? 0) * sx));
  const compSideRx = Math.max(1, Math.round((mask.compSideHairW ?? 0) * sx));
  const compSideRy = Math.max(1, Math.round((mask.compSideHairH ?? 0) * sy));
  const compSideOffsetX = Math.max(0, Math.round((mask.compSideHairOffsetX ?? 0) * sx));
  const compSideOffsetY = Math.max(0, Math.round((mask.compSideHairOffsetY ?? 0) * sy));
  const compBodyTop = compTop + Math.round(compDomeH * 0.55);
  const compBodyH = Math.max(1, compTop + compH - compBodyTop);
  const compTopRx = Math.round(compW / 2) + compDomeExpandX;
  const compTopCy = compTop + compDomeH;

  // Comp neck ellipse
  let compNeckSvg = '';
  let compNeckInfo = '';
  if (mask.compNeckRx && mask.compNeckRy) {
    const nRx = Math.max(1, Math.round(mask.compNeckRx * sx));
    const nRy = Math.max(1, Math.round(mask.compNeckRy * sy));
    const nCy = compTop + Math.round((mask.compNeckOffsetY ?? compH * 0.8) * sy);
    compNeckSvg = `<ellipse cx="${compCx}" cy="${nCy}" rx="${nRx}" ry="${nRy}" fill="rgba(255,165,0,0.4)" stroke="orange" stroke-width="3"/>`;
    compNeckInfo = `脖子椭圆: cy=${nCy} rx=${nRx} ry=${nRy} Y:${nCy-nRy}~${nCy+nRy}`;
  }

  // === Build overlay SVG ===
  // API mask: 蓝色轮廓 (AI重绘区域)
  // Composite mask: 红色轮廓 (后合成区域)
  // API neck: 绿色填充
  // Comp neck: 橙色填充

  const svgOverlay = `<svg width="${OUTPUT_W}" height="${OUTPUT_H}">
    <!-- API mask boundary (blue) -->
    <ellipse cx="${apiCx}" cy="${apiTopCy}" rx="${apiTopRx}" ry="${apiDomeH}" fill="none" stroke="cyan" stroke-width="2" stroke-dasharray="8,4"/>
    <rect x="${apiLeft}" y="${apiBodyTop}" width="${apiW}" height="${apiBodyH}" fill="none" stroke="cyan" stroke-width="2" stroke-dasharray="8,4"/>
    <ellipse cx="${apiCx - apiSideOffsetX}" cy="${apiTop + apiSideOffsetY}" rx="${apiSideRx}" ry="${apiSideRy}" fill="none" stroke="cyan" stroke-width="2" stroke-dasharray="8,4"/>
    <ellipse cx="${apiCx + apiSideOffsetX}" cy="${apiTop + apiSideOffsetY}" rx="${apiSideRx}" ry="${apiSideRy}" fill="none" stroke="cyan" stroke-width="2" stroke-dasharray="8,4"/>

    <!-- Composite mask boundary (magenta/red) -->
    <ellipse cx="${compCx}" cy="${compTopCy}" rx="${compTopRx}" ry="${compDomeH}" fill="none" stroke="magenta" stroke-width="2"/>
    <rect x="${compLeft}" y="${compBodyTop}" width="${compW}" height="${compBodyH}" fill="none" stroke="magenta" stroke-width="2"/>
    <ellipse cx="${compCx - compSideOffsetX}" cy="${compTop + compSideOffsetY}" rx="${compSideRx}" ry="${compSideRy}" fill="none" stroke="magenta" stroke-width="2"/>
    <ellipse cx="${compCx + compSideOffsetX}" cy="${compTop + compSideOffsetY}" rx="${compSideRx}" ry="${compSideRy}" fill="none" stroke="magenta" stroke-width="2"/>

    <!-- Neck ellipses (filled) -->
    ${apiNeckSvg}
    ${compNeckSvg}

    <!-- Labels -->
    <text x="20" y="60" font-size="32" fill="cyan" font-family="sans-serif">━━ API Mask (AI重绘)</text>
    <text x="20" y="100" font-size="32" fill="magenta" font-family="sans-serif">━━ Composite Mask (合成)</text>
    <text x="20" y="140" font-size="32" fill="lime" font-family="sans-serif">━━ API脖子椭圆</text>
    <text x="20" y="180" font-size="32" fill="orange" font-family="sans-serif">━━ COMP脖子椭圆</text>
  </svg>`;

  const outPath = path.join(__dirname, '..', '生成测试', `debug_mask_full_${gender}.jpg`);
  await sharp(tplBuf)
    .composite([{ input: Buffer.from(svgOverlay), blend: 'over' }])
    .jpeg({ quality: 92 })
    .toFile(outPath);

  // Also generate a white-on-black mask image to show the EXACT API mask shape
  const svgAPIMask = `<svg width="${OUTPUT_W}" height="${OUTPUT_H}">
    <rect width="${OUTPUT_W}" height="${OUTPUT_H}" fill="black"/>
    <ellipse cx="${apiCx}" cy="${apiTopCy}" rx="${apiTopRx}" ry="${apiDomeH}" fill="white"/>
    <rect x="${apiLeft}" y="${apiBodyTop}" width="${apiW}" height="${apiBodyH}" fill="white"/>
    <ellipse cx="${apiCx - apiSideOffsetX}" cy="${apiTop + apiSideOffsetY}" rx="${apiSideRx}" ry="${apiSideRy}" fill="white"/>
    <ellipse cx="${apiCx + apiSideOffsetX}" cy="${apiTop + apiSideOffsetY}" rx="${apiSideRx}" ry="${apiSideRy}" fill="white"/>
    ${apiNeckSvg.replace(/rgba\(0,255,0,0\.4\)/g, 'white').replace(/stroke="lime" stroke-width="3"/g, '')}
  </svg>`;

  const maskOutPath = path.join(__dirname, '..', '生成测试', `debug_api_mask_${gender}.png`);
  await sharp({ create: { width: OUTPUT_W, height: OUTPUT_H, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: Buffer.from(svgAPIMask), blend: 'over' }])
    .png()
    .toFile(maskOutPath);

  console.log(`\n=== ${gender.toUpperCase()} ===`);
  console.log(`API范围: 矩形 Y:${apiBodyTop}~${apiBodyTop+apiBodyH}, 宽${apiW}`);
  console.log(`  ${apiNeckInfo}`);
  console.log(`COMP范围: 矩形 Y:${compBodyTop}~${compBodyTop+compBodyH}, 宽${compW}`);
  console.log(`  ${compNeckInfo}`);
  console.log(`覆盖图: ${outPath}`);
  console.log(`纯mask: ${maskOutPath}`);
}

(async () => {
  await buildMaskOverlay('male');
  await buildMaskOverlay('female');
})();
