const sharp = require('./node_modules/sharp');
const path  = require('path');
const fs    = require('fs');

const RELAY_DIR = path.join(__dirname, '..', '生成测试', 'relay_test');
const OUT_DIR   = path.join(__dirname, '..', '生成测试', 'faceswap_temp');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const W = 1126, H = 1397;

const CONFIGS = {
  male: {
    file: 'scene_02_user2_1777014143898.png',
    body: { left: 565, top: 150, width: 220, height: 1247 },
  },
  female: {
    file: 'scene_02_1777013168257.png',
    body: { left: 590, top: 370, width: 220, height: 1027 },
  },
};

async function makePreview(gender) {
  const cfg = CONFIGS[gender];
  const b = cfg.body;
  const svg = '<svg width="' + W + '" height="' + H + '">'
    + '<rect x="' + b.left + '" y="' + b.top + '" width="' + b.width + '" height="' + b.height + '" fill="rgba(255,0,0,0.35)" stroke="red" stroke-width="3"/>'
    + '<text x="' + (b.left + 5) + '" y="' + (b.top + 30) + '" font-size="24" fill="yellow" font-weight="bold">BODY SLIM AREA</text>'
    + '<text x="' + (b.left + 5) + '" y="' + (b.top + 60) + '" font-size="18" fill="white">x:' + b.left + '-' + (b.left + b.width) + ' (' + b.width + 'px)</text>'
    + '</svg>';
  const outFile = path.join(OUT_DIR, 'preview_body_' + gender + '.jpg');
  await sharp(path.join(RELAY_DIR, cfg.file))
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .jpeg({ quality: 90 })
    .toFile(outFile);
  console.log(gender + ' preview: ' + path.basename(outFile));
}

Promise.all([makePreview('male'), makePreview('female')])
  .then(() => console.log('done — 查看 生成测试/faceswap_temp/'))
  .catch(e => console.error(e.message));
