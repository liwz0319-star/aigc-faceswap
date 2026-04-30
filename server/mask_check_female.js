const sharp = require('./node_modules/sharp');
const path = require('path');
const fs = require('fs');

const RELAY_DIR = path.join(__dirname, '..', '生成测试', 'relay_test');
const OUT_DIR   = path.join(__dirname, '..', '生成测试', 'faceswap_temp');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const file = 'scene_02_1777013168257.png';

async function run() {
  const meta = await sharp(path.join(RELAY_DIR, file)).metadata();
  console.log('尺寸:', meta.width + 'x' + meta.height);

  const CX = 700, CY = 530, RX = 90, RY = 130;
  const W = meta.width, H = meta.height;
  const svg = '<svg width="' + W + '" height="' + H + '">'
    + '<ellipse cx="' + CX + '" cy="' + CY + '" rx="' + RX + '" ry="' + RY + '" fill="rgba(255,0,0,0.5)" stroke="red" stroke-width="3"/>'
    + '<text x="' + (CX - 60) + '" y="' + (CY - RY - 10) + '" font-size="22" fill="yellow" font-weight="bold">MASK cx=' + CX + ' cy=' + CY + '</text>'
    + '</svg>';

  await sharp(path.join(RELAY_DIR, file))
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .jpeg({ quality: 90 })
    .toFile(path.join(OUT_DIR, 'mask_check_female_new.jpg'));

  console.log('预览已保存: faceswap_temp/mask_check_female_new.jpg');
}

run().catch(e => { console.error(e.message); process.exit(1); });
