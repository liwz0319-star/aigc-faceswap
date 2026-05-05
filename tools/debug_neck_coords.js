#!/usr/bin/env node
const sharp = require('sharp');
const path = require('path');
const scene1 = require('../scene-configs/scene1');

async function debugMask(gender) {
  const cfg = scene1[gender];
  const mask = cfg.mask;
  const templateFile = path.join(__dirname, '..', '素材', '模板', cfg.file);
  const meta = await sharp(templateFile).metadata();
  const inputW = meta.width, inputH = meta.height;
  const outputW = 2048, outputH = 2560;
  const scaleX = outputW / inputW;
  const scaleY = outputH / inputH;

  console.log(`=== ${gender.toUpperCase()} (template ${inputW}x${inputH}, scale X=${scaleX.toFixed(4)} Y=${scaleY.toFixed(4)}) ===\n`);

  // API mask
  const apiCx = Math.round((mask.apiCx ?? mask.cx) * scaleX);
  const apiCy = Math.round((mask.apiCy ?? mask.cy) * scaleY);
  const apiW = Math.round((mask.apiW ?? mask.w) * scaleX);
  const apiH = Math.round((mask.apiH ?? mask.h) * scaleY);
  const apiTop = apiCy - Math.round(apiH / 2);

  const domeH = Math.round(mask.apiDomeH * scaleY);
  const bodyTop = apiTop + Math.round(domeH * 0.52);
  const bodyH = Math.max(1, apiTop + apiH - bodyTop);
  const bodyBottom = bodyTop + bodyH;

  const neckRx = Math.round(mask.apiNeckRx * scaleX);
  const neckRy = Math.round(mask.apiNeckRy * scaleY);
  const neckCy = apiTop + Math.round(mask.apiNeckOffsetY * scaleY);

  console.log(`  API Body rect: Y:${bodyTop} ~ Y:${bodyBottom} (half-width: ${apiW/2})`);
  console.log(`  API Neck ellipse: cy=${neckCy}, rx=${neckRx}, ry=${neckRy}`);
  console.log(`  API Neck covers: Y:${neckCy - neckRy} ~ Y:${neckCy + neckRy}`);
  console.log(`  API Neck extends beyond body rect: ${neckRx - apiW/2}px each side\n`);

  // Composite mask
  const compCx = Math.round((mask.compCx ?? mask.cx) * scaleX);
  const compCy = Math.round((mask.compCy ?? mask.cy) * scaleY);
  const compW = Math.round((mask.compW ?? mask.w) * scaleX);
  const compH = Math.round((mask.compH ?? mask.h) * scaleY);
  const compTop = compCy - Math.round(compH / 2);

  const compDomeH = Math.round(mask.compDomeH * scaleY);
  const compBodyTop = compTop + Math.round(compDomeH * 0.55);
  const compBodyH = Math.max(1, compTop + compH - compBodyTop);
  const compBodyBottom = compBodyTop + compBodyH;

  const compNeckRx = Math.round(mask.compNeckRx * scaleX);
  const compNeckRy = Math.round(mask.compNeckRy * scaleY);
  const compNeckCy = compTop + Math.round(mask.compNeckOffsetY * scaleY);

  console.log(`  COMP Body rect: Y:${compBodyTop} ~ Y:${compBodyBottom} (half-width: ${compW/2})`);
  console.log(`  COMP Neck ellipse: cy=${compNeckCy}, rx=${compNeckRx}, ry=${compNeckRy}`);
  console.log(`  COMP Neck covers: Y:${compNeckCy - compNeckRy} ~ Y:${compNeckCy + compNeckRy}`);
  console.log(`  COMP Neck extends beyond body rect: ${compNeckRx - compW/2}px each side\n`);
}

(async () => {
  await debugMask('male');
  await debugMask('female');
})();
