/**
 * Faceswap 场景1 + RegionSync 测试脚本
 *
 * 在原有 test-faceswap-scene1.js 流程基础上，生成完成后追加 RegionSync 后处理：
 *   以原始模板图为画布，只把 editRegions 区域从 Seedream 生成图贴回，
 *   其余区域 100% 来自模板原始像素。
 *
 * 原有 test-faceswap-scene1.js 不受任何影响。
 *
 * 用法:
 *   node test-faceswap-scene1-regionsync.js                    # 默认照片，自动检测性别
 *   node test-faceswap-scene1-regionsync.js "照片/xxx.jpg"     # 指定照片
 *   node test-faceswap-scene1-regionsync.js --gender male      # 强制性别
 *   node test-faceswap-scene1-regionsync.js --strength 0.5     # 调整强度
 *   node test-faceswap-scene1-regionsync.js --no-region-sync   # 跳过 RegionSync（只生成原图）
 *
 * 输出（同一 timestamp 方便对比）:
 *   生成测试/faceswap_output/scene1_rs_generated_<ts>.jpg  ← Seedream 整图（原始输出）
 *   生成测试/faceswap_output/scene1_rs_final_<ts>.jpg      ← RegionSync 最终图（交付用）
 */

const fs   = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, 'server');

// 解析 server/.env
fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

if (!process.env.VISION_API_KEY && process.env.SEEDREAM_NATIVE_API_KEY) {
  process.env.VISION_API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
}

require('module').Module.globalPaths.push(path.join(SERVER_DIR, 'node_modules'));

const { generateNativeImage }        = require('./server/src/seedreamNativeClient');
const { buildFaceswapPrompt }        = require('./server/src/promptBuilder_faceswap');
const { describeUserAppearance }     = require('./server/src/visionClient');
const { composeEditRegionsOverBase } = require('./server/src/regionComposer');
const axios = require(path.join(SERVER_DIR, 'node_modules', 'axios'));
const sharp = require(path.join(SERVER_DIR, 'node_modules', 'sharp'));

const faceswapRegions = require('./server/src/data/faceswapRegions.json');

// ============================================================
// 场景1 模板配置（与 test-faceswap-scene1.js 一致）
// ============================================================
const RELAY_DIR          = path.join(__dirname, '生成测试', 'relay_test');
const TEMPLATE_DIR       = RELAY_DIR;  // 场景1新底图与场景2/3统一放在 relay_test/
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '生成测试', 'faceswap_output');
const PROMPT_LOG_DIR     = path.join(__dirname, '生成测试', 'prompt_logs');

const SCENE1_TEMPLATES = {
  female: {
    file:            'scene1-F.jpg',
    targetPerson:    'the fan (Asian female) in the group',
    targetDesc:      '球迷（女）',
    regionKey:       'scene1_female',
    defaultStrength: 0.35,
  },
  male: {
    file:            'scene1-M.jpg',
    targetPerson:    'the fan (Asian male) in the group',
    targetDesc:      '球迷（男）',
    regionKey:       'scene1_male',
    defaultStrength: 0.35,
  },
};

const DEFAULT_SIZE      = '2048x2560';
const DEFAULT_STRENGTH  = 0.68;
const DEFAULT_GUIDANCE  = 10;
const DEFAULT_USER_PHOTO = 'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/978fd26e01d59e50dc66062494d4e24c.jpg';

// ============================================================
// 工具函数
// ============================================================

function toBase64DataUrl(filePath) {
  const p = filePath.replace(/\\/g, '/');
  const buf  = fs.readFileSync(p);
  const ext  = path.extname(p).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
             : ext === 'png' ? 'image/png'
             : `image/${ext}`;
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

function parseCliArgs(argv) {
  const opts = {
    userPhotoPath:    DEFAULT_USER_PHOTO,
    gender:           null,
    size:             DEFAULT_SIZE,
    strength:         DEFAULT_STRENGTH,
    guidanceScale:    DEFAULT_GUIDANCE,
    _strengthFromCli: false,
    regionSync:    true,          // --no-region-sync 时关闭
    outputDir:     null,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if      (arg === '--gender')          { opts.gender        = argv[++i] || null; }
    else if (arg === '--size')            { opts.size          = argv[++i] || DEFAULT_SIZE; }
    else if (arg === '--strength')        { opts.strength      = parseFloat(argv[++i]); opts._strengthFromCli = true; }
    else if (arg === '--guidance')        { opts.guidanceScale = parseFloat(argv[++i]); }
    else if (arg === '--no-region-sync')  { opts.regionSync    = false; }
    else if (arg === '--output-dir')      { opts.outputDir     = argv[++i] || null; }
    else if (!arg.startsWith('--'))       { positionals.push(arg); }
  }
  if (positionals[0]) opts.userPhotoPath = positionals[0];
  return opts;
}

async function detectGender(userImageBase64) {
  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const key = process.env.VISION_API_KEY;
  if (!key) throw new Error('VISION_API_KEY 未配置');

  const res = await axios.post(url, {
    model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: userImageBase64 } },
        { type: 'text', text: 'Look at this person photo and infer gender presentation conservatively. Reply with ONLY one word: "male", "female", or "unknown". Use "unknown" unless the presentation is visually clear and high-confidence.' },
      ],
    }],
    max_tokens: 10,
    temperature: 0.1,
  }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 15000 });

  const answer = (res.data?.choices?.[0]?.message?.content || '').trim().toLowerCase();
  console.log(`[性别检测] 视觉模型返回: "${answer}"`);
  if (answer.includes('female') || answer.includes('woman') || answer.includes('girl')) return 'female';
  if (answer.includes('male')   || answer.includes('man')   || answer.includes('boy'))  return 'male';
  return 'unknown';
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));

  console.log('========================================');
  console.log('Faceswap 场景1 + RegionSync 测试');
  console.log('========================================');
  const OUTPUT_DIR = cli.outputDir
    ? path.resolve(cli.outputDir)
    : DEFAULT_OUTPUT_DIR;

  console.log(`用户照片  : ${path.basename(cli.userPhotoPath)}`);
  console.log(`RegionSync: ${cli.regionSync ? '开启' : '关闭（--no-region-sync）'}`);
  console.log(`输出目录  : ${OUTPUT_DIR}`);

  if (!fs.existsSync(OUTPUT_DIR))     fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(PROMPT_LOG_DIR)) fs.mkdirSync(PROMPT_LOG_DIR, { recursive: true });

  // Step 1: 读取用户照片
  console.log('\n[Step 1] 读取用户照片...');
  const userBase64 = toBase64DataUrl(cli.userPhotoPath);

  // Step 2: 性别检测
  console.log('\n[Step 2] 性别检测...');
  let gender = cli.gender || 'unknown';
  if (cli.gender) {
    console.log(`[性别检测] 命令行指定: ${cli.gender}`);
  } else {
    try   { gender = await detectGender(userBase64); }
    catch (err) { console.warn('性别检测失败，默认男性:', err.message); gender = 'male'; }
  }
  if (gender === 'unknown') { console.log('[性别检测] 无法确定，默认男性'); gender = 'male'; }
  const genderLabel = gender === 'female' ? '女性' : '男性';
  console.log(`[性别检测] 结果: ${genderLabel}`);

  // Step 3: 选择模板
  const tpl          = SCENE1_TEMPLATES[gender];
  const templatePath = path.join(TEMPLATE_DIR, tpl.file);
  if (!cli._strengthFromCli && tpl.defaultStrength) cli.strength = tpl.defaultStrength;
  console.log(`\n[Step 3] 模板: ${tpl.file}  替换: ${tpl.targetDesc}  strength: ${cli.strength}`);
  if (!fs.existsSync(templatePath)) {
    console.error(`模板文件不存在: ${templatePath}`); process.exit(1);
  }

  // Step 4: 外貌解读
  console.log('\n[Step 4] 视觉模型解读外貌...');
  let userDescription = '';
  try {
    userDescription = await describeUserAppearance([userBase64]);
    console.log(`外貌描述: ${userDescription.substring(0, 120)}...`);
  } catch (err) { console.warn('外貌解读失败，跳过:', err.message); }

  // Step 5: 构建 Prompt + 调用 Seedream（模板预上采样，减少构图偏移）
  console.log('\n[Step 5] 构建 Prompt 并调用 Seedream...');
  const [outW, outH] = cli.size.split('x').map(Number);
  const tplMeta = await sharp(templatePath).metadata();
  const scaledTplBuf = await sharp(templatePath)
    .resize(outW, outH, { fit: 'fill', kernel: 'lanczos3' })
    .jpeg({ quality: 95 })
    .toBuffer();
  const templateBase64 = `data:image/jpeg;base64,${scaledTplBuf.toString('base64')}`;
  console.log(`  模板已上采样: ${tplMeta.width}x${tplMeta.height} → ${outW}x${outH}`);
  const { prompt, negative_prompt } = buildFaceswapPrompt({
    targetPerson:    tpl.targetPerson,
    userDescription: userDescription,
    gender,
  });

  const ts = Date.now();
  const genderTag = gender === 'female' ? 'F' : 'M';

  const t0 = Date.now();
  let result;
  try {
    result = await generateNativeImage({
      prompt,
      negative_prompt,
      images:       [templateBase64, userBase64],
      size:         cli.size,
      scene_params: { strength: cli.strength, guidance_scale: cli.guidanceScale },
    });
  } catch (err) {
    console.error(`\n生成失败: ${err.message}`);
    process.exit(1);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n生成成功 (${elapsed}s): ${result.url.substring(0, 80)}...`);

  // Step 6: 下载 Seedream 整图（原始输出，保留对比用）
  const generatedFile = path.join(OUTPUT_DIR, `scene1_rs_generated_${genderTag}_${ts}.jpg`);
  await downloadFile(result.url, generatedFile);
  console.log(`[原始整图] 已保存: ${path.basename(generatedFile)}`);

  // Step 7: RegionSync 后处理
  let finalFile = generatedFile; // 降级时使用原始图
  if (cli.regionSync) {
    console.log('\n[Step 7] RegionSync 后处理...');
    const regionCfg = faceswapRegions[tpl.regionKey];
    if (!regionCfg) {
      console.warn(`[RegionSync] 未找到配置 key="${tpl.regionKey}"，跳过后处理`);
    } else {
      try {
        finalFile = path.join(OUTPUT_DIR, `scene1_rs_final_${genderTag}_${ts}.jpg`);
        const syncResult = await composeEditRegionsOverBase({
          sourceImage: templatePath,    // 模板图作为底图画布
          targetImage: generatedFile,   // Seedream 生成图作为 patch 来源
          outputImage: finalFile,
          regions:     regionCfg.editRegions,
        });
        console.log(`[RegionSync] 合成完成 (${syncResult.width}x${syncResult.height})`);
        console.log(`[最终交付图] 已保存: ${path.basename(finalFile)}`);
      } catch (rsErr) {
        console.warn(`[RegionSync] 失败，使用原始生成图: ${rsErr.message}`);
        finalFile = generatedFile;
      }
    }
  }

  // Step 8: 保存 prompt 日志
  const logFile = path.join(PROMPT_LOG_DIR, `scene1_rs_${genderTag}_${ts}.json`);
  fs.writeFileSync(logFile, JSON.stringify({
    test_time:        new Date().toISOString(),
    mode:             'faceswap+regionsync',
    scene:            'scene_01',
    gender,
    user_photo:       path.basename(cli.userPhotoPath),
    template_file:    tpl.file,
    target_person:    tpl.targetPerson,
    region_key:       tpl.regionKey,
    region_sync:      cli.regionSync,
    user_description: userDescription,
    prompt,
    negative_prompt,
    api_params:       { size: cli.size, strength: cli.strength, guidance_scale: cli.guidanceScale },
    outputs: {
      generated: path.basename(generatedFile),
      final:     path.basename(finalFile),
    },
  }, null, 2), 'utf8');

  // 汇总
  console.log('\n========================================');
  console.log('测试完成');
  console.log('========================================');
  console.log(`性别     : ${genderLabel}`);
  console.log(`模板     : ${tpl.file}`);
  console.log(`耗时     : ${elapsed}s`);
  console.log(`原始整图 : ${path.basename(generatedFile)}`);
  if (cli.regionSync && finalFile !== generatedFile) {
    console.log(`最终交付 : ${path.basename(finalFile)}  ← 以此为准`);
  }
  console.log(`Prompt日志: ${path.basename(logFile)}`);
}

main().catch(err => {
  console.error('\n测试出错:', err.message);
  process.exit(1);
});
