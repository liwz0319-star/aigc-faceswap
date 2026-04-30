const sharp = require('./node_modules/sharp');
const path = require('path');
const fs = require('fs');

const RELAY_DIR = path.join(__dirname, '..', '生成测试', 'relay_test');
const OUT_DIR   = path.join(__dirname, '..', '生成测试', 'faceswap_temp');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function run() {
  const file = 'scene_02_1777013168257.png';
  const meta = await sharp(path.join(RELAY_DIR, file)).metadata();
  const W = meta.width, H = meta.height;
  console.log('底图尺寸:', W + 'x' + H);

  // 生成3个候选Y位置供对比
  const candidates = [
    { label: 'A', cx: 700, cy: 430, rx: 90, ry: 130 },
    { label: 'B', cx: 700, cy: 480, rx: 90, ry: 130 },
    { label: 'C', cx: 700, cy: 530, rx: 90, ry: 130 },
  ];

  for (const c of candidates) {
    const svg = '<svg width="' + W + '" height="' + H + '">'
      + '<ellipse cx="' + c.cx + '" cy="' + c.cy + '" rx="' + c.rx + '" ry="' + c.ry + '" fill="rgba(255,0,0,0.45)" stroke="red" stroke-width="3"/>'
      + '<text x="' + (c.cx - 80) + '" y="' + (c.cy - c.ry - 8) + '" font-size="26" fill="yellow" font-weight="bold">' + c.label + ': cy=' + c.cy + '</text>'
      + '</svg>';
    const outFile = path.join(OUT_DIR, 'mask_cal_female_' + c.label + '.jpg');
    await sharp(path.join(RELAY_DIR, file))
      .composite([{ input: Buffer.from(svg), blend: 'over' }])
      .jpeg({ quality: 90 })
      .toFile(outFile);
    console.log(c.label + ': ' + path.basename(outFile));
  }
}

run().catch(e => { console.error(e.message); process.exit(1); });
