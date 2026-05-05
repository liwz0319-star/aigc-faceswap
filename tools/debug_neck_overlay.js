#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const sharp = require(path.join(__dirname, '..', 'server', 'node_modules', 'sharp'));
const scene1 = require('../scene-configs/scene1');

async function overlayDebug(gender) {
  const cfg = scene1[gender];
  const mask = cfg.mask;
  const tplPath = path.join(__dirname, '..', '素材', '新场景底图', cfg.file);
  if (!fs.existsSync(tplPath)) { console.log('Missing: ' + tplPath); return; }
  const buf = await sharp(tplPath).resize(2048, 2560).toBuffer();

  const sx = 2048 / 1856, sy = 2560 / 2306;
  const apiCx = Math.round(mask.apiCx * sx);
  const apiCy = Math.round(mask.apiCy * sy);
  const apiW = Math.round(mask.apiW * sx);
  const apiH = Math.round(mask.apiH * sy);
  const apiTop = apiCy - Math.round(apiH / 2);
  const apiLeft = apiCx - Math.round(apiW / 2);
  const domeH = Math.round(mask.apiDomeH * sy);
  const bodyTop = apiTop + Math.round(domeH * 0.52);
  const bodyH = apiTop + apiH - bodyTop;

  const neckRx = Math.round(mask.apiNeckRx * sx);
  const neckRy = Math.round(mask.apiNeckRy * sy);
  const neckCy = apiTop + Math.round(mask.apiNeckOffsetY * sy);

  const svg = `<svg width="2048" height="2560">
    <rect x="${apiLeft}" y="${bodyTop}" width="${apiW}" height="${bodyH}" fill="rgba(0,0,255,0.3)"/>
    <ellipse cx="${apiCx}" cy="${apiTop + domeH}" rx="${apiW / 2}" ry="${domeH}" fill="rgba(255,0,0,0.25)"/>
    <ellipse cx="${apiCx}" cy="${neckCy}" rx="${neckRx}" ry="${neckRy}" fill="rgba(0,200,0,0.35)" stroke="lime" stroke-width="2" fill-opacity="0.5"/>
  </svg>`;

  const out = path.join(__dirname, '..', '生成测试', `debug_mask_${gender}_v2.jpg`);
  await sharp(buf).composite([{ input: Buffer.from(svg), blend: 'over' }]).jpeg({ quality: 90 }).toFile(out);
  console.log(`${gender} -> ${out} (neck cy=${neckCy}, rx=${neckRx}, ry=${neckRy})`);
}

(async () => {
  await overlayDebug('male');
  await overlayDebug('female');
})();
