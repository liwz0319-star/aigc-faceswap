/**
 * 底图编辑脚本：调整场景3球迷的头身比
 *
 * 目标：在不改变球星、背景、服装的前提下，让球迷
 *   - 身高稍微高一点（接近球星身高）
 *   - 体型稍瘦
 *
 * 用法：
 *   node edit-template-scene3.js              # 同时处理男女两张底图
 *   node edit-template-scene3.js --male       # 只处理男性底图
 *   node edit-template-scene3.js --female     # 只处理女性底图
 *   node edit-template-scene3.js --strength 0.55   # 调整重绘强度（默认0.55）
 */

const fs   = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, 'server');

fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

require('module').Module.globalPaths.push(path.join(SERVER_DIR, 'node_modules'));

const { generateNativeImage } = require('./server/src/seedreamNativeClient');

const RELAY_DIR  = path.join(__dirname, '生成测试', 'relay_test');
const OUTPUT_DIR = path.join(__dirname, '生成测试', 'template_edit');

// ============================================================
// 两张底图的编辑配置
// ============================================================
const TEMPLATES = {
  male: {
    input:       'scene_03_user2_1777013790300.png',
    fanDesc:     'the second person from the left (the fan with Asian appearance)',
    fanPosition: 'second from left',
  },
  female: {
    input:       'scene_03_1777013337798.png',
    fanDesc:     'the third person from the left (the fan with glasses in the middle)',
    fanPosition: 'third from left (middle)',
  },
};

// ============================================================
// 工具函数
// ============================================================
function toBase64DataUrl(filePath) {
  const buf  = fs.readFileSync(filePath);
  const ext  = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const https  = require('https');
    const http   = require('http');
    const client = url.startsWith('https') ? https : http;
    const file   = fs.createWriteStream(dest);
    client.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { try { fs.unlinkSync(dest); } catch(_){} reject(err); });
  });
}

function parseArgs(argv) {
  const opts = { male: false, female: false, strength: 0.55 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--male')     opts.male     = true;
    if (argv[i] === '--female')   opts.female   = true;
    if (argv[i] === '--strength') opts.strength = parseFloat(argv[++i]);
  }
  if (!opts.male && !opts.female) { opts.male = true; opts.female = true; }
  return opts;
}

// ============================================================
// 编辑单张底图
// ============================================================
async function editTemplate(gender, cfg, strength) {
  const inputPath = path.join(RELAY_DIR, cfg.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`[${gender}] 底图不存在: ${inputPath}`);
    return;
  }

  const prompt = [
    'Photorealistic group photo. Body proportion edit only.',
    '',
    `Modify ONLY ${cfg.fanDesc}:`,
    `- Make this person slightly TALLER so their head top is at the same level as the adjacent players.`,
    `- Make this person slightly SLIMMER/THINNER (narrower shoulders, slimmer torso and legs).`,
    `- Keep the same face, same hairstyle, same jersey, same pose, same expression for this person.`,
    '',
    'Keep everything else IDENTICAL to the original:',
    '- All other players: exact same face, body, pose, jersey, expression.',
    '- Background, stadium, lighting, shadows, colors: unchanged.',
    '- All jerseys and badges: unchanged.',
    '- Camera framing and composition: unchanged.',
    '',
    '8K quality, photorealistic.',
  ].join('\n');

  const negative_prompt = [
    'changed face, different hairstyle, altered jersey, modified background,',
    'changed player pose, extra people, missing people, distorted body,',
    'short fan, fat fan, same height as before, unchanged proportions,',
    'cartoon, illustration, low quality, watermark,',
  ].join(' ');

  console.log(`\n[${gender.toUpperCase()}] 处理底图: ${cfg.input}`);
  console.log(`  球迷位置: ${cfg.fanPosition}`);
  console.log(`  strength: ${strength}`);

  const imageBase64 = toBase64DataUrl(inputPath);
  const t0 = Date.now();

  const result = await generateNativeImage({
    prompt,
    negative_prompt,
    images:       [imageBase64],
    size:         '2048x2560',
    scene_params: { strength, guidance_scale: 10 },
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  生成成功 (${elapsed}s)`);

  const ts       = Date.now();
  const outFile  = path.join(OUTPUT_DIR, `scene3_${gender}_tpl_s${String(strength).replace('.','')}_${ts}.png`);
  await downloadFile(result.url, outFile);
  console.log(`  已保存: ${path.basename(outFile)}`);

  return outFile;
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const cli = parseArgs(process.argv.slice(2));

  console.log('========================================');
  console.log('场景3 底图编辑 — 球迷头身比调整');
  console.log('========================================');

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const tasks = [];
  if (cli.male)   tasks.push(['male',   TEMPLATES.male]);
  if (cli.female) tasks.push(['female', TEMPLATES.female]);

  for (const [gender, cfg] of tasks) {
    try {
      const out = await editTemplate(gender, cfg, cli.strength);
      if (out) {
        console.log(`\n✅ ${gender} 底图已生成: ${path.basename(out)}`);
        console.log(`   路径: ${out}`);
        console.log(`   ↳ 确认效果后，将此文件替换原底图以用于 faceswap`);
      }
    } catch (err) {
      console.error(`\n❌ ${gender} 底图编辑失败: ${err.message}`);
    }
  }

  console.log('\n========================================');
  console.log('完成');
  console.log('========================================');
}

main().catch(err => {
  console.error('出错:', err.message);
  process.exit(1);
});
