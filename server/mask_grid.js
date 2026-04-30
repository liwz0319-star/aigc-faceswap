/**
 * 生成带坐标网格的底图预览，帮助精确定位脸部中心
 */
const sharp = require('./node_modules/sharp');
const path  = require('path');
const fs    = require('fs');

const RELAY_DIR = path.join(__dirname, '..', '生成测试', 'relay_test');
const OUT_DIR   = path.join(__dirname, '..', '生成测试', 'faceswap_temp');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function run() {
  const file = 'scene_02_1777013168257.png';
  const meta = await sharp(path.join(RELAY_DIR, file)).metadata();
  const W = meta.width, H = meta.height;
  console.log('底图尺寸:', W + 'x' + H);

  // 生成坐标网格（每100px一条线），并标出若干关键X、Y位置
  const lines = [];

  // 竖线 x = 500, 600, 650, 700, 750, 800
  for (const x of [500, 600, 650, 700, 750, 800]) {
    lines.push('<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + H + '" stroke="cyan" stroke-width="1" opacity="0.6"/>');
    lines.push('<text x="' + (x+2) + '" y="20" font-size="16" fill="cyan">' + x + '</text>');
  }
  // 横线 y = 350, 400, 430, 460, 500, 530, 560
  for (const y of [350, 400, 430, 460, 500, 530, 560]) {
    lines.push('<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="lime" stroke-width="1" opacity="0.6"/>');
    lines.push('<text x="2" y="' + (y-2) + '" font-size="16" fill="lime">' + y + '</text>');
  }

  const svg = '<svg width="' + W + '" height="' + H + '">' + lines.join('') + '</svg>';
  const outFile = path.join(OUT_DIR, 'grid_female.jpg');
  await sharp(path.join(RELAY_DIR, file))
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .jpeg({ quality: 92 })
    .toFile(outFile);
  console.log('网格图:', path.basename(outFile));
}

run().catch(e => { console.error(e.message); process.exit(1); });
