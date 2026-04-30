/**
 * debug-scene1-pipeline.js
 *
 * 场景1 合成流水线 — 调试克隆版
 *
 * 从 test-faceswap-scene1-regionsync.js 克隆，所有参数集中在顶部 CONFIG 区，
 * 便于单步调试和参数调整，不影响任何生产代码。
 *
 * 用法:
 *   node debug-scene1-pipeline.js                          # 默认照片，自动检测性别
 *   node debug-scene1-pipeline.js "照片/xxx.jpg"           # 指定照片
 *   node debug-scene1-pipeline.js --gender male            # 强制性别
 *   node debug-scene1-pipeline.js --gender female
 *   node debug-scene1-pipeline.js --strength 0.5          # 调整 i2i 强度
 *   node debug-scene1-pipeline.js --no-region-sync        # 关闭 RegionSync（只看 Seedream 原图）
 *   node debug-scene1-pipeline.js --skip-vision           # 跳过视觉外貌解析（加速调试）
 *
 * 输出目录: 生成测试/debug_scene1/
 *   scene1_debug_generated_<M|F>_<ts>.jpg  ← Seedream 原始输出
 *   scene1_debug_final_<M|F>_<ts>.jpg      ← RegionSync 合成后（交付用）
 *   scene1_debug_prompt_<M|F>_<ts>.json    ← 完整 prompt 日志
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ============================================================
// ★ CONFIG — 在这里修改所有参数 ★
// ============================================================

const CONFIG = {

  // ── 输入 ──────────────────────────────────────────────────
  /** 默认用户照片路径（可被命令行第一个位置参数覆盖） */
  defaultUserPhoto: 'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/978fd26e01d59e50dc66062494d4e24c.jpg',

  // ── 模板配置 ───────────────────────────────────────────────
  /** 模板文件目录（scene1-M.jpg / scene1-F.jpg 所在目录） */
  templateDir: path.join(__dirname, '生成测试', 'relay_test'),

  templates: {
    male: {
      file:            'scene1-M.jpg',   // 男性模板文件名
      targetPerson:    'the fan (Asian male) in the group',  // prompt 中的目标人物描述
      targetDesc:      '球迷（男）',
    },
    female: {
      file:            'scene1-F.jpg',
      targetPerson:    'the fan (Asian female) in the group',
      targetDesc:      '球迷（女）',
    },
  },

  // ── Seedream 生成参数 ──────────────────────────────────────
  size:           '2048x2560',  // 输出尺寸（宽x高），场景1标准竖向比例
  strength:       0.68,         // i2i 重绘强度（0=完全保留模板, 1=完全重绘）
                                // 推荐范围：0.55~0.75，越大换脸效果越强但构图越可能漂移
  guidanceScale:  10,           // prompt 引导强度（7~15，越大越贴 prompt）

  // ── 模板预处理 ─────────────────────────────────────────────
  /** 是否在送入 Seedream 前把模板预放大到输出分辨率（减少构图偏移，推荐保持 true） */
  prescaleTemplate: true,

  // ── RegionSync 区域配置 ────────────────────────────────────
  // 坐标格式：[x, y, width, height]，值 0~1 表示相对于图片宽高的比例
  // feather：边缘羽化半径（像素，在模板原始分辨率下）
  regionSync: {
    enabled: true,   // false = 跳过 RegionSync，只保存 Seedream 原始输出
    male: {
      editRegions: [
        {
          id:      'target_face',
          x:       0.250,   // 脸部区域左边界（相对宽度）
          y:       0.167,   // 脸部区域上边界（相对高度）
          width:   0.250,   // 区域宽度
          height:  0.333,   // 区域高度（包含头部+部分颈部）
          feather: 24,      // 边缘羽化（越大过渡越柔和，但脸部边缘可能模糊）
        },
      ],
    },
    female: {
      editRegions: [
        {
          id:      'target_face',
          x:       0.427,
          y:       0.149,
          width:   0.225,
          height:  0.372,
          feather: 24,
        },
      ],
    },
  },

  // ── 视觉模型（外貌解析 + 性别检测）─────────────────────────
  vision: {
    /** false = 跳过外貌解析，prompt 中不加外貌描述（加速调试用） */
    describeAppearance: true,
    /** false = 强制跳过性别自动检测（需要手动指定 --gender） */
    detectGender: true,
  },

  // ── 输出 ──────────────────────────────────────────────────
  outputDir:   path.join(__dirname, '生成测试', 'debug_scene1'),
  promptLogDir: path.join(__dirname, '生成测试', 'prompt_logs'),

};

// ============================================================
// 环境变量加载
// ============================================================

const SERVER_DIR = path.join(__dirname, 'server');
fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});
if (!process.env.VISION_API_KEY && process.env.SEEDREAM_NATIVE_API_KEY) {
  process.env.VISION_API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
}
require('module').Module.globalPaths.push(path.join(SERVER_DIR, 'node_modules'));

// ============================================================
// 依赖加载
// ============================================================

const { generateNativeImage }        = require('./server/src/seedreamNativeClient');
const { buildFaceswapPrompt }        = require('./server/src/promptBuilder_faceswap');
const { describeUserAppearance }     = require('./server/src/visionClient');
const { composeEditRegionsOverBase } = require('./server/src/regionComposer');
const axios = require(path.join(SERVER_DIR, 'node_modules', 'axios'));
const sharp = require(path.join(SERVER_DIR, 'node_modules', 'sharp'));

// ============================================================
// 工具函数
// ============================================================

function toBase64DataUrl(filePath) {
  const p   = filePath.replace(/\\/g, '/');
  const buf  = fs.readFileSync(p);
  const ext  = path.extname(p).slice(1).toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
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
    }).on('error', err => { try { fs.unlinkSync(dest); } catch (_) {} reject(err); });
  });
}

function parseCliArgs(argv) {
  const opts = {
    userPhotoPath: CONFIG.defaultUserPhoto,
    gender:        null,          // null = 自动检测
    strength:      null,          // null = 使用 CONFIG.strength
    regionSync:    null,          // null = 使用 CONFIG.regionSync.enabled
    skipVision:    false,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if      (arg === '--gender')       { opts.gender    = argv[++i] || null; }
    else if (arg === '--strength')     { opts.strength  = parseFloat(argv[++i]); }
    else if (arg === '--no-region-sync') { opts.regionSync = false; }
    else if (arg === '--skip-vision')  { opts.skipVision = true; }
    else if (!arg.startsWith('--'))    { positionals.push(arg); }
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
  }, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    timeout: 15000,
  });

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

  // 合并 CLI 覆盖
  const strength   = cli.strength   !== null ? cli.strength   : CONFIG.strength;
  const doRegionSync = cli.regionSync !== null ? cli.regionSync : CONFIG.regionSync.enabled;
  const skipVision = cli.skipVision || !CONFIG.vision.describeAppearance;

  console.log('============================================================');
  console.log('  场景1 合成流水线 — 调试模式');
  console.log('============================================================');
  console.log(`用户照片   : ${path.basename(cli.userPhotoPath)}`);
  console.log(`i2i 强度   : ${strength}`);
  console.log(`RegionSync : ${doRegionSync ? '开启' : '关闭'}`);
  console.log(`外貌解析   : ${skipVision  ? '跳过' : '开启'}`);
  console.log(`输出目录   : ${CONFIG.outputDir}`);
  console.log('');

  // 确保输出目录存在
  [CONFIG.outputDir, CONFIG.promptLogDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // ── Step 1: 读取用户照片 ──────────────────────────────────
  console.log('[Step 1] 读取用户照片...');
  if (!fs.existsSync(cli.userPhotoPath)) {
    console.error(`照片文件不存在: ${cli.userPhotoPath}`);
    process.exit(1);
  }
  const userBase64 = toBase64DataUrl(cli.userPhotoPath);
  console.log(`  文件大小: ${(Buffer.byteLength(userBase64) / 1024).toFixed(0)} KB (base64)`);

  // ── Step 2: 性别检测 ──────────────────────────────────────
  console.log('\n[Step 2] 性别检测...');
  let gender = cli.gender;
  if (gender) {
    console.log(`  命令行指定: ${gender}`);
  } else if (CONFIG.vision.detectGender) {
    try {
      gender = await detectGender(userBase64);
    } catch (err) {
      console.warn(`  检测失败 (${err.message})，默认男性`);
      gender = 'male';
    }
    if (gender === 'unknown') {
      console.log('  无法确定，默认男性');
      gender = 'male';
    }
  } else {
    gender = 'male';
    console.log('  性别检测已禁用，默认男性');
  }
  console.log(`  结果: ${gender === 'female' ? '女性' : '男性'}`);

  // ── Step 3: 选择模板 ──────────────────────────────────────
  console.log('\n[Step 3] 选择模板...');
  const tplCfg      = CONFIG.templates[gender];
  const templatePath = path.join(CONFIG.templateDir, tplCfg.file);
  if (!fs.existsSync(templatePath)) {
    console.error(`模板文件不存在: ${templatePath}`);
    process.exit(1);
  }
  const tplMeta = await sharp(templatePath).metadata();
  console.log(`  模板文件: ${tplCfg.file}  (${tplMeta.width}x${tplMeta.height})`);
  console.log(`  目标位置: ${tplCfg.targetDesc}`);

  // ── Step 4: 视觉外貌解析 ──────────────────────────────────
  console.log('\n[Step 4] 视觉外貌解析...');
  let userDescription = '';
  if (skipVision) {
    console.log('  已跳过（--skip-vision 或 CONFIG.vision.describeAppearance=false）');
  } else {
    try {
      userDescription = await describeUserAppearance([userBase64]);
      console.log(`  外貌描述: ${userDescription.substring(0, 150)}...`);
    } catch (err) {
      console.warn(`  解析失败，跳过: ${err.message}`);
    }
  }

  // ── Step 5: 构建 Prompt ───────────────────────────────────
  console.log('\n[Step 5] 构建 Prompt...');
  const { prompt, negative_prompt } = buildFaceswapPrompt({
    targetPerson:    tplCfg.targetPerson,
    userDescription: userDescription,
    gender,
  });
  console.log(`  prompt 长度: ${prompt.length} 字符`);
  // 调试时可以解注释查看完整 prompt：
  // console.log('\n--- PROMPT ---\n' + prompt + '\n--- END ---\n');

  // ── Step 6: 模板预放大 + 调用 Seedream ───────────────────
  console.log('\n[Step 6] 调用 Seedream 生成...');
  const [outW, outH] = CONFIG.size.split('x').map(Number);

  let templateBase64;
  if (CONFIG.prescaleTemplate) {
    const scaledBuf = await sharp(templatePath)
      .resize(outW, outH, { fit: 'fill', kernel: 'lanczos3' })
      .jpeg({ quality: 95 })
      .toBuffer();
    templateBase64 = `data:image/jpeg;base64,${scaledBuf.toString('base64')}`;
    console.log(`  模板预放大: ${tplMeta.width}x${tplMeta.height} → ${outW}x${outH}`);
  } else {
    templateBase64 = toBase64DataUrl(templatePath);
    console.log(`  模板原始尺寸: ${tplMeta.width}x${tplMeta.height}（未预放大）`);
  }

  console.log(`  参数: size=${CONFIG.size}  strength=${strength}  guidance=${CONFIG.guidanceScale}`);

  const ts = Date.now();
  const gTag = gender === 'female' ? 'F' : 'M';
  const t0 = Date.now();

  let result;
  try {
    result = await generateNativeImage({
      prompt,
      negative_prompt,
      images:       [templateBase64, userBase64],
      size:         CONFIG.size,
      scene_params: { strength, guidance_scale: CONFIG.guidanceScale },
    });
  } catch (err) {
    console.error(`\n  生成失败: ${err.message}`);
    if (err.response?.data) console.error('  API 错误详情:', JSON.stringify(err.response.data));
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  生成成功 (${elapsed}s)`);

  // ── Step 7: 下载原始生成图 ───────────────────────────────
  console.log('\n[Step 7] 下载 Seedream 原始图...');
  const generatedFile = path.join(CONFIG.outputDir, `scene1_debug_generated_${gTag}_${ts}.jpg`);
  await downloadFile(result.url, generatedFile);
  console.log(`  已保存: ${path.basename(generatedFile)}`);

  // ── Step 8: RegionSync 后处理 ─────────────────────────────
  let finalFile = generatedFile;
  if (doRegionSync) {
    console.log('\n[Step 8] RegionSync 后处理...');
    const regionCfg = CONFIG.regionSync[gender];
    if (!regionCfg) {
      console.warn(`  未找到 gender="${gender}" 的 RegionSync 配置，跳过`);
    } else {
      console.log(`  editRegions: ${regionCfg.editRegions.length} 个区域`);
      regionCfg.editRegions.forEach(r => {
        console.log(`    "${r.id}": x=${r.x} y=${r.y} w=${r.width} h=${r.height} feather=${r.feather}`);
      });

      try {
        finalFile = path.join(CONFIG.outputDir, `scene1_debug_final_${gTag}_${ts}.jpg`);
        const syncResult = await composeEditRegionsOverBase({
          sourceImage: templatePath,
          targetImage: generatedFile,
          outputImage: finalFile,
          regions:     regionCfg.editRegions,
        });
        console.log(`  合成完成 (${syncResult.width}x${syncResult.height})`);
        console.log(`  最终交付图: ${path.basename(finalFile)}`);
      } catch (rsErr) {
        console.warn(`  RegionSync 失败，使用原始生成图: ${rsErr.message}`);
        finalFile = generatedFile;
      }
    }
  } else {
    console.log('\n[Step 8] RegionSync 已跳过（--no-region-sync）');
  }

  // ── Step 9: 保存 prompt 日志 ──────────────────────────────
  const logFile = path.join(CONFIG.promptLogDir, `scene1_debug_${gTag}_${ts}.json`);
  fs.writeFileSync(logFile, JSON.stringify({
    test_time:        new Date().toISOString(),
    mode:             'debug-scene1-pipeline',
    gender,
    user_photo:       path.basename(cli.userPhotoPath),
    template_file:    tplCfg.file,
    target_person:    tplCfg.targetPerson,
    region_sync:      doRegionSync,
    skip_vision:      skipVision,
    user_description: userDescription,
    prompt,
    negative_prompt,
    api_params: {
      size:           CONFIG.size,
      strength,
      guidance_scale: CONFIG.guidanceScale,
    },
    region_config: doRegionSync ? CONFIG.regionSync[gender] : null,
    outputs: {
      generated: path.basename(generatedFile),
      final:     path.basename(finalFile),
    },
    elapsed_sec: parseFloat(elapsed),
  }, null, 2), 'utf8');

  // ── 汇总 ──────────────────────────────────────────────────
  console.log('\n============================================================');
  console.log('  测试完成');
  console.log('============================================================');
  console.log(`性别       : ${gender === 'female' ? '女性' : '男性'}`);
  console.log(`耗时       : ${elapsed}s`);
  console.log(`原始整图   : 生成测试/debug_scene1/${path.basename(generatedFile)}`);
  if (doRegionSync && finalFile !== generatedFile) {
    console.log(`最终交付图 : 生成测试/debug_scene1/${path.basename(finalFile)}  ← 以此为准`);
  }
  console.log(`Prompt 日志: 生成测试/prompt_logs/${path.basename(logFile)}`);
}

main().catch(err => {
  console.error('\n错误:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
