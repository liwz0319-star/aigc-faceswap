/**
 * 成品标注脚本
 * 对最新一批输出图做两件事：
 *  1. 单图标注版：在图片底部加场景/性别/照片ID标签
 *  2. 对比图：原始照片（左）+ AI生成（右）并排，顶部标题栏
 *
 * 用法：
 *   node annotate_output.js                        ← 自动取最新批次（按时间戳前缀分组）
 *   node annotate_output.js 177744                 ← 指定时间戳前缀
 *   node annotate_output.js --indir 生成测试/新底图1  ← 指定输入目录（默认 生成测试/inpaint_output）
 *   node annotate_output.js --outdir 生成测试/new    ← 指定输出目录（默认 生成测试/annotated）
 */

const fs   = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, 'server');
fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});
require('module').Module.globalPaths.push(path.join(SERVER_DIR, 'node_modules'));
const sharp = require(path.join(SERVER_DIR, 'node_modules', 'sharp'));

// ── 配置 ─────────────────────────────────────────────────────
const DEFAULT_INPAINT_DIR = path.join(__dirname, '生成测试', 'inpaint_output');
const PHOTO_DIR           = path.join(__dirname, '生成测试', '照片');
const DEFAULT_OUT_DIR     = path.join(__dirname, '生成测试', 'annotated');

const SCENE_LABELS  = { '1': '更衣室', '2': '球场举旗', '4': '啤酒节' };
const GENDER_LABELS = { 'M': '男', 'F': '女' };
const FONT = 'Microsoft YaHei';

// ── 解析文件名 ────────────────────────────────────────────────
// 格式：scene1_inpaint_M_394643d8_1777440318739.jpg
function parseFilename(filename) {
  const m = filename.match(/^scene(\d+)_inpaint_([MF])_([^_]+)_(\d+)\.jpg$/);
  if (!m) return null;
  return { scene: m[1], gender: m[2], photoTag: m[3], ts: m[4] };
}

// ── 找原始照片 ────────────────────────────────────────────────
function findPhoto(tag) {
  const files = fs.readdirSync(PHOTO_DIR);
  const match = files.find(f => path.basename(f, path.extname(f)).startsWith(tag));
  return match ? path.join(PHOTO_DIR, match) : null;
}

// ── 1. 单图标注：底部加标签栏 ─────────────────────────────────
async function annotateImage(outputFile, info) {
  const { scene, gender, photoTag } = info;
  const sceneLabel  = SCENE_LABELS[scene]  || `场景${scene}`;
  const genderLabel = GENDER_LABELS[gender] || gender;
  const labelText   = `场景${scene}（${sceneLabel}）  |  ${genderLabel}性  |  照片：${photoTag}`;

  const meta   = await sharp(outputFile).metadata();
  const BAR_H  = 80;
  const BAR_FS = 32;

  const barSvg = `<svg width="${meta.width}" height="${BAR_H}">
    <rect width="${meta.width}" height="${BAR_H}" fill="rgba(15,15,30,0.92)"/>
    <text x="${meta.width / 2}" y="${BAR_H / 2 + BAR_FS / 3}"
          text-anchor="middle"
          font-family="${FONT}" font-size="${BAR_FS}" font-weight="bold" fill="white">
      ${labelText}
    </text>
  </svg>`;

  // 把标签条贴到图片底部
  const buf = await sharp(outputFile)
    .composite([{ input: Buffer.from(barSvg), gravity: 'south', blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer();

  return buf;
}

// ── 2. 对比图：原始照片（左）+ 生成（右）并排 ─────────────────
async function buildComparison(outputFile, photoFile, info) {
  const { scene, gender, photoTag } = info;
  const sceneLabel  = SCENE_LABELS[scene]  || `场景${scene}`;
  const genderLabel = GENDER_LABELS[gender] || gender;

  const DISPLAY_H = 700;   // 两侧图的统一高度
  const HEADER_H  = 80;    // 顶部标题栏高度
  const FOOTER_H  = 48;    // 底部说明栏高度
  const GAP       = 12;    // 左右图之间的间隔
  const BG_COLOR  = { r: 15, g: 15, b: 30 };

  // 计算两张图在 DISPLAY_H 下的宽度
  const outMeta = await sharp(outputFile).metadata();
  const phoMeta = await sharp(photoFile).metadata();
  const outW = Math.round(outMeta.width  / outMeta.height  * DISPLAY_H);
  const phoW = Math.round(phoMeta.width  / phoMeta.height  * DISPLAY_H);

  const totalW = phoW + GAP + outW;
  const totalH = HEADER_H + DISPLAY_H + FOOTER_H;

  // resize 两张图
  const [outBuf, phoBuf] = await Promise.all([
    sharp(outputFile).resize(outW, DISPLAY_H, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer(),
    sharp(photoFile) .resize(phoW, DISPLAY_H, { fit: 'cover', position: 'top' }).jpeg({ quality: 90 }).toBuffer(),
  ]);

  // 顶部标题 SVG
  const headerSvg = `<svg width="${totalW}" height="${HEADER_H}">
    <rect width="${totalW}" height="${HEADER_H}" fill="rgba(15,15,30,1)"/>
    <text x="${totalW / 2}" y="${HEADER_H / 2 + 14}"
          text-anchor="middle"
          font-family="${FONT}" font-size="34" font-weight="bold" fill="white">
      场景${scene}（${sceneLabel}）  |  ${genderLabel}性  |  照片：${photoTag}
    </text>
  </svg>`;

  // 底部标签 SVG（左注"原始照片"，右注"AI 生成"）
  const footerSvg = `<svg width="${totalW}" height="${FOOTER_H}">
    <rect width="${totalW}" height="${FOOTER_H}" fill="rgba(15,15,30,1)"/>
    <text x="${phoW / 2}" y="${FOOTER_H / 2 + 10}"
          text-anchor="middle" font-family="${FONT}" font-size="26" fill="#aaaacc">
      原始照片
    </text>
    <text x="${phoW + GAP + outW / 2}" y="${FOOTER_H / 2 + 10}"
          text-anchor="middle" font-family="${FONT}" font-size="26" fill="#aaaacc">
      AI 生成
    </text>
  </svg>`;

  // 分隔线 SVG
  const divSvg = `<svg width="${GAP}" height="${DISPLAY_H}">
    <rect width="${GAP}" height="${DISPLAY_H}" fill="rgba(80,80,120,1)"/>
  </svg>`;

  const result = await sharp({
    create: { width: totalW, height: totalH, channels: 3, background: BG_COLOR }
  })
  .composite([
    { input: Buffer.from(headerSvg), left: 0,          top: 0,              blend: 'over' },
    { input: phoBuf,                 left: 0,          top: HEADER_H        },
    { input: Buffer.from(divSvg),    left: phoW,       top: HEADER_H,       blend: 'over' },
    { input: outBuf,                 left: phoW + GAP, top: HEADER_H        },
    { input: Buffer.from(footerSvg), left: 0,          top: HEADER_H + DISPLAY_H, blend: 'over' },
  ])
  .jpeg({ quality: 92 })
  .toBuffer();

  return result;
}

// ── 解析 CLI 参数 ────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { tsPrefix: null, indir: null, outdir: null };
  for (let i = 0; i < argv.length; i++) {
    if      (argv[i] === '--indir')  { opts.indir  = argv[++i] || null; }
    else if (argv[i] === '--outdir') { opts.outdir = argv[++i] || null; }
    else if (!argv[i].startsWith('--')) { opts.tsPrefix = argv[i]; }
  }
  return opts;
}

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const INPAINT_DIR = opts.indir
    ? (path.isAbsolute(opts.indir) ? opts.indir : path.join(__dirname, opts.indir))
    : DEFAULT_INPAINT_DIR;
  const OUT_DIR = opts.outdir
    ? (path.isAbsolute(opts.outdir) ? opts.outdir : path.join(__dirname, opts.outdir))
    : DEFAULT_OUT_DIR;

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // 取最新批次：按时间戳前缀（命令行指定 or 自动取最大）
  const tsPrefix = opts.tsPrefix;

  const files = fs.readdirSync(INPAINT_DIR)
    .filter(f => f.endsWith('.jpg'))
    .map(f => ({ f, info: parseFilename(f) }))
    .filter(({ info }) => info !== null);

  // 分组
  const groups = {};
  files.forEach(({ f, info }) => {
    const prefix = info.ts.slice(0, 6);
    (groups[prefix] = groups[prefix] || []).push({ f, info });
  });

  const latestPrefix = tsPrefix || Object.keys(groups).sort().at(-1);
  const batch = groups[latestPrefix];
  if (!batch || batch.length === 0) {
    console.error('找不到匹配的批次，可用前缀：', Object.keys(groups).join(', '));
    process.exit(1);
  }

  console.log(`批次前缀：${latestPrefix}  共 ${batch.length} 张`);
  console.log(`输入目录：${INPAINT_DIR}`);
  console.log(`输出目录：${OUT_DIR}`);

  let ok = 0, failed = 0;
  for (const { f, info } of batch) {
    const outputFile = path.join(INPAINT_DIR, f);
    const photoFile  = findPhoto(info.photoTag);
    if (!photoFile) {
      console.warn(`  [!] 找不到原始照片 tag=${info.photoTag}`);
      failed++;
      continue;
    }

    const baseName = f.replace('.jpg', '');
    try {
      // 1. 单图标注
      const annotatedBuf = await annotateImage(outputFile, info);
      const annotatedPath = path.join(OUT_DIR, `${baseName}_labeled.jpg`);
      fs.writeFileSync(annotatedPath, annotatedBuf);

      // 2. 对比图
      const cmpBuf  = await buildComparison(outputFile, photoFile, info);
      const cmpPath = path.join(OUT_DIR, `${baseName}_compare.jpg`);
      fs.writeFileSync(cmpPath, cmpBuf);

      console.log(`  [✓] ${f}`);
      ok++;
    } catch (err) {
      console.error(`  [✗] ${f}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n完成：${ok} 成功 / ${failed} 失败`);
  console.log(`标注输出：${OUT_DIR}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
