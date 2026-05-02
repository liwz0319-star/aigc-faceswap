const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sharp = require(path.join(root, 'server', 'node_modules', 'sharp'));

const base = path.join(root, '素材', '新场景底图', '场景3.png');
const outDir = path.join(root, '生成测试', 'scene3_mask_preview');
fs.mkdirSync(outDir, { recursive: true });

const configs = {
  male: { cx: 1050, cy: 314, rx: 107, ry: 143, color: '#00ff88' },
  female: { cx: 1050, cy: 314, rx: 101, ry: 137, color: '#ff66cc' },
};

async function makePreview(name, cfg) {
  const meta = await sharp(base).metadata();
  const textX = Math.min(meta.width - 760, cfg.cx + cfg.rx + 24);
  const textY = Math.max(56, cfg.cy - cfg.ry - 16);
  const svg = `
    <svg width="${meta.width}" height="${meta.height}">
      <ellipse
        cx="${cfg.cx}"
        cy="${cfg.cy}"
        rx="${cfg.rx}"
        ry="${cfg.ry}"
        fill="rgba(255,255,255,0.12)"
        stroke="${cfg.color}"
        stroke-width="8"
      />
      <line x1="${cfg.cx - 220}" y1="${cfg.cy}" x2="${cfg.cx + 220}" y2="${cfg.cy}" stroke="${cfg.color}" stroke-width="4"/>
      <line x1="${cfg.cx}" y1="${cfg.cy - 220}" x2="${cfg.cx}" y2="${cfg.cy + 220}" stroke="${cfg.color}" stroke-width="4"/>
      <text x="${textX}" y="${textY}" font-size="42" font-family="Arial" fill="${cfg.color}">
        ${name}: cx=${cfg.cx}, cy=${cfg.cy}, rx=${cfg.rx}, ry=${cfg.ry}
      </text>
    </svg>`;

  const out = path.join(outDir, `scene3_${name}_mask_preview.png`);
  await sharp(base).composite([{ input: Buffer.from(svg) }]).png().toFile(out);
  console.log(out);
}

async function main() {
  await makePreview('male', configs.male);
  await makePreview('female', configs.female);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
