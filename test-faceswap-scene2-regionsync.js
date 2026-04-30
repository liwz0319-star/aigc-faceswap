/**
 * Faceswap 场景2 + RegionSync 测试脚本
 *
 * 场景2：更衣室4人合照，球迷位于左数第3位。
 * 在 Seedream 生成后追加 RegionSync 后处理：
 *   以原始模板图为画布，只把 editRegions 区域从生成图贴回。
 *   更衣室背景、PAULANER 标志、其余球员 100% 来自模板原始像素。
 *
 * 用法:
 *   node test-faceswap-scene2-regionsync.js                    # 默认照片，自动检测性别
 *   node test-faceswap-scene2-regionsync.js "照片/xxx.jpg"     # 指定照片
 *   node test-faceswap-scene2-regionsync.js --gender female    # 强制性别
 *   node test-faceswap-scene2-regionsync.js --strength 0.5     # 调整强度
 *   node test-faceswap-scene2-regionsync.js --no-region-sync   # 只跑 Seedream（对比用）
 *
 * 输出:
 *   生成测试/faceswap_output/scene2_rs_generated_<G>_<ts>.jpg  ← Seedream 整图
 *   生成测试/faceswap_output/scene2_rs_final_<G>_<ts>.jpg      ← RegionSync 最终图（交付用）
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
// 场景2 模板配置
// ============================================================
const RELAY_DIR           = path.join(__dirname, '生成测试', 'relay_test');
const DEFAULT_OUTPUT_DIR  = path.join(__dirname, '生成测试', '场景2测试1');
const PROMPT_LOG_DIR      = path.join(__dirname, '生成测试', 'prompt_logs');

const SCENE2_TEMPLATES = {
  male: {
    file:            'scene2-M.jpg',
    targetPerson:    'the third person from the left',
    targetDesc:      '左数第3位（亚洲男球迷）',
    description:     '男球迷模板',
    regionKey:       'scene2_male',
    compositionNote: 'This photo has exactly 4 people sitting from left to right: [1] Black player in red Bayern jersey, [2] Harry Kane (tall white male, short blond hair, beard) in red Bayern jersey, [3] the fan (Asian male) in red Bayern jersey, [4] curly-haired player in red Bayern jersey. All sitting on a bench holding Paulaner beer glasses. Harry Kane MUST remain completely unchanged. CRITICAL SIZE RULE: The fan [3] must be the EXACT SAME SIZE as the adjacent players — same head size, same shoulder width, same seated torso height. The fan is a full-sized adult male. Do NOT make the fan smaller, shorter, narrower, or more petite than the players. The fan\'s head must be the same size as the other players\' heads.',
    backgroundNote:  'Background is a Bayern Munich locker room with blue walls, jersey lockers, and PAULANER logos on the top panels.',
    defaultStrength: 0.35,
  },
  female: {
    file:            'scene2-F.png',
    targetPerson:    'the third person from the left',
    targetDesc:      '左数第3位（女球迷）',
    description:     '女球迷模板',
    regionKey:       'scene2_female',
    compositionNote: 'This photo has exactly 4 people sitting from left to right: [1] Black player in red Bayern jersey, [2] Harry Kane (tall white male, short blond hair, beard) in red Bayern jersey, [3] the fan (female) in red Bayern jersey, [4] curly-haired player in red Bayern jersey. All sitting on a bench holding Paulaner beer glasses. Harry Kane MUST remain completely unchanged.',
    backgroundNote:  'Background is a Bayern Munich locker room with blue walls, jersey lockers, and PAULANER logos on the top panels.',
    defaultStrength: 0.28,
  },
};

const DEFAULT_SIZE     = '2048x2560';
const DEFAULT_STRENGTH = 0.65;
const DEFAULT_GUIDANCE = 10;
const DEFAULT_USER_PHOTO = 'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/978fd26e01d59e50dc66062494d4e24c.jpg';

// ============================================================
// 工具函数
// ============================================================

function toBase64DataUrl(filePath) {
  const p   = filePath.replace(/\\/g, '/');
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).slice(1).toLowerCase();
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

async function detectFaceBbox(imagePath, personDesc) {
  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const key = process.env.VISION_API_KEY;
  const ext  = path.extname(imagePath).slice(1).toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : ext === 'png' ? 'image/png' : `image/${ext}`;
  const b64  = `data:${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`;

  const res = await axios.post(url, {
    model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: b64 } },
        { type: 'text', text:
          `In this image, locate the head (face region including hair) of ${personDesc}. ` +
          `Return ONLY a JSON object with these fields (all values 0.0 to 1.0): ` +
          `{"cx": <horizontal center>, "cy": <vertical center>, "w": <width of head>, "h": <height of head>}. ` +
          `No explanation, no markdown, just the JSON.`
        },
      ],
    }],
    max_tokens: 60,
    temperature: 0.1,
  }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 15000 });

  const raw   = (res.data?.choices?.[0]?.message?.content || '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`视觉模型返回格式不正确: ${raw}`);
  return JSON.parse(match[0]);
}

function parseCliArgs(argv) {
  const opts = {
    userPhotoPath: DEFAULT_USER_PHOTO,
    gender:        null,
    size:          DEFAULT_SIZE,
    strength:      DEFAULT_STRENGTH,
    guidanceScale: DEFAULT_GUIDANCE,
    regionSync:    true,
    outputDir:     null,       // --output-dir 指定时覆盖默认目录
    _strengthFromCli: false,
  };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if      (arg === '--gender')         { opts.gender        = argv[++i] || null; }
    else if (arg === '--size')           { opts.size          = argv[++i] || DEFAULT_SIZE; }
    else if (arg === '--strength')       { opts.strength = parseFloat(argv[++i]); opts._strengthFromCli = true; }
    else if (arg === '--guidance')       { opts.guidanceScale = parseFloat(argv[++i]); }
    else if (arg === '--no-region-sync') { opts.regionSync = false; }
    else if (arg === '--output-dir')     { opts.outputDir = argv[++i] || null; }
    else if (!arg.startsWith('--'))      { pos.push(arg); }
  }
  if (pos[0]) opts.userPhotoPath = pos[0];
  if (opts.gender && !['male', 'female'].includes(opts.gender)) {
    throw new Error('--gender 只支持 male 或 female');
  }
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
        { type: 'text', text:
          'Look at this person and determine their gender. Be VERY conservative:\n' +
          '- East Asian males often have softer, more androgynous facial features — do NOT classify them as female based on soft features alone.\n' +
          '- Only reply "female" if there are CLEAR feminine indicators (long hair, visible makeup, obviously female body shape).\n' +
          '- If there is ANY doubt, reply "unknown".\n' +
          'Reply ONLY one word: "male", "female", or "unknown".'
        },
      ],
    }],
    max_tokens: 10,
    temperature: 0.1,
  }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 15000 });

  const answer = (res.data?.choices?.[0]?.message?.content || '').trim().toLowerCase();
  console.log(`[性别检测] 视觉模型返回: "${answer}"`);
  if (answer.includes('female')) return 'female';
  if (answer.includes('male'))   return 'male';
  return 'unknown';
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const cli = parseCliArgs(process.argv.slice(2));

  console.log('========================================');
  console.log('Faceswap 场景2 + RegionSync 测试');
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
  let gender = cli.gender;
  if (gender) {
    console.log(`[性别检测] 命令行指定: ${gender}`);
  } else {
    try   { gender = await detectGender(userBase64); }
    catch (err) { console.warn(`性别检测失败，默认男性: ${err.message}`); gender = 'male'; }
    if (gender === 'unknown') { console.log('[性别检测] 无法确定，默认男性'); gender = 'male'; }
  }
  const genderLabel = gender === 'female' ? '女性' : '男性';
  console.log(`[性别检测] 结果: ${genderLabel}`);

  // Step 3: 选择模板
  const tpl          = SCENE2_TEMPLATES[gender];
  const templatePath = path.join(RELAY_DIR, tpl.file);
  if (!cli._strengthFromCli && tpl.defaultStrength) cli.strength = tpl.defaultStrength;
  console.log(`\n[Step 3] 模板: ${tpl.file}  替换: ${tpl.targetDesc}  strength: ${cli.strength}`);
  if (!fs.existsSync(templatePath)) {
    console.error(`模板文件不存在: ${templatePath}`); process.exit(1);
  }

  // Step 4: 视觉模型解读外貌
  console.log('\n[Step 4] 视觉模型解读外貌...');
  let userDescription = '';
  try {
    userDescription = await describeUserAppearance([userBase64]);
    console.log(`外貌描述: ${userDescription.substring(0, 120)}...`);
  } catch (err) { console.warn(`外貌解读失败，跳过: ${err.message}`); }

  // Step 5: 构建 Prompt
  console.log('\n[Step 5] 构建 Prompt...');
  // 把模板上采样到 API 输出分辨率，防止 Seedream 因分辨率差异重排构图（人物位置下偏）
  const [outW, outH] = cli.size.split('x').map(Number);
  const tplMeta = await sharp(templatePath).metadata();
  const scaledTplBuf = await sharp(templatePath)
    .resize(outW, outH, { fit: 'fill', kernel: 'lanczos3' })
    .jpeg({ quality: 95 })
    .toBuffer();
  const templateBase64 = `data:image/jpeg;base64,${scaledTplBuf.toString('base64')}`;
  console.log(`  模板已上采样: ${tplMeta.width}x${tplMeta.height} → ${outW}x${outH}`);
  const { prompt: basePrompt, negative_prompt } = buildFaceswapPrompt({
    targetPerson:    tpl.targetPerson,
    userDescription: userDescription,
    compositionNote: tpl.compositionNote,
    backgroundNote:  tpl.backgroundNote,
    gender,
  });
  const prompt = basePrompt +
    '\n- CRITICAL: Every person holding a beer glass must keep the beer glass exactly as in Image 1 — do NOT remove, hide, or alter any beer glass.' +
    '\n- CRITICAL: The Bayern Munich jerseys hanging in the locker compartments in the background must remain exactly as in Image 1 — do NOT remove or omit them.' +
    '\n- CRITICAL: Harry Kane (second from left, tall white male with short blond hair and beard) must remain completely identical to Image 1 — do NOT alter his face, hair, expression, or body.' +
    '\n- CRITICAL: All shoes/boots color and style must remain exactly as in Image 1.' +
    '\n- HAIRSTYLE: Reproduce EXACTLY the hair visible in Image 2. Do NOT generate a bowl cut or blunt fringe — show natural hair with individual strands.';

  // Step 6: Seedream 生成
  console.log(`\n[Step 6] 调用 Seedream 生成...  size=${cli.size}  strength=${cli.strength}`);
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
    console.error(`\n生成失败: ${err.message}`); process.exit(1);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n生成成功 (${elapsed}s)`);

  // 下载 Seedream 整图
  const generatedFile = path.join(OUTPUT_DIR, `scene2_rs_generated_${genderTag}_${ts}.jpg`);
  await downloadFile(result.url, generatedFile);
  console.log(`[原始整图] 已保存: ${path.basename(generatedFile)}`);

  // Step 7: RegionSync 后处理
  let finalFile = generatedFile;
  if (cli.regionSync) {
    console.log('\n[Step 7] RegionSync 后处理...');
    const regionCfg = faceswapRegions[tpl.regionKey];
    if (!regionCfg) {
      console.warn(`[RegionSync] 未找到配置 key="${tpl.regionKey}"，跳过`);
    } else {
      try {
        finalFile = path.join(OUTPUT_DIR, `scene2_rs_final_${genderTag}_${ts}.jpg`);

        // ── 动态检测：在生成图中定位球迷实际人脸位置 ──────────────────────
        // 目的：Seedream 生成时构图会漂移（模板 cy≈0.45 → 生成图 cy≈0.35），
        //       若用预设的模板坐标打孔，洞的位置与实际人脸错位，效果不合理。
        //       通过在生成图上检测人脸，把洞精准放在实际人脸所在位置。
        let regions = regionCfg.editRegions; // 默认回退静态配置
        console.log('  [动态检测] 在生成图中定位球迷实际人脸...');
        try {
          const bbox = await detectFaceBbox(generatedFile, tpl.targetPerson);
          console.log(`  [动态检测] cx=${bbox.cx.toFixed(3)} cy=${bbox.cy.toFixed(3)} w=${bbox.w.toFixed(3)} h=${bbox.h.toFixed(3)}`);

          // 验证 bbox 合理性（零值/过小时回退静态配置）
          if (!bbox.w || !bbox.h || bbox.w < 0.03 || bbox.h < 0.03 || (bbox.cx === 0 && bbox.cy === 0)) {
            throw new Error(`bbox 异常: cx=${bbox.cx} cy=${bbox.cy} w=${bbox.w} h=${bbox.h}，回退静态配置`);
          }

          // 以检测到的人脸为中心，添加适当 padding
          // 关键原则：
          //   1. 核心区域（core）= 实际脸部，底部仅到下巴，不延伸到球衣。
          //   2. 洞的边界（hole）= core 向外扩展 fExp（≈90px），让 feather 渐变
          //      区落在脸部**外侧**（不是内侧），避免脸部边缘出现硬切割线。
          //   3. feather 参数与 fExp 匹配：feather≈49 → featherGen≈90px ≈ fExp*H。
          const padX   = bbox.w * 0.4;   // 覆盖耳侧
          const padTop = bbox.h * 0.5;   // 覆盖发顶
          // 向下延伸至腰部：模板球迷脸 cy≈0.45，但生成图脸可能极度上漂（cy≈0.25）。
          // 若洞底只到下巴（padBot=0.1），模板球迷的整个头部（cy≈0.45~0.53）落在洞外，
          // 会盖住生成图脸下半段，形成"脸与身体的错位缝隙"（body/face seam 问题）。
          // 将洞底延伸至腰部（padBot=1.8倍头高，约到红色球衣上沿以下），
          // 使 RegionSync 接缝落在纯红色球衣区域，视觉上完全不可见。
          const padBot = bbox.h * 1.8;

          // 核心脸部区域
          const coreX1 = bbox.cx - bbox.w / 2 - padX;
          const coreY1 = bbox.cy - bbox.h / 2 - padTop;
          const coreX2 = bbox.cx + bbox.w / 2 + padX;
          // 确保洞底至少覆盖 y=0.52：当生成图脸部极度上漂（如 cy=0.25）时，
          // 模板原始球迷脸（cy≈0.45，延伸至 ~y=0.53）可能落在洞外导致"两张脸"。
          const coreY2 = Math.max(bbox.cy + bbox.h / 2 + padBot, 0.52);

          // 向外扩展 fExp，使 feather 渐变落在脸外（不可扩展到球衣区域）
          const fExp = 0.045;  // 归一化，≈115px；与 feather=60→featherGen≈110px 匹配
          const rx = Math.max(0,    coreX1 - fExp);
          const ry = Math.max(0,    coreY1 - fExp);
          const rr = Math.min(1,    coreX2 + fExp);
          const rb = Math.min(0.70, coreY2 + fExp);  // 上限 0.70 (腰部)，接缝落在纯色球衣区域

          regions = [{
            id:      'target_face_dynamic',
            x:       rx,
            y:       ry,
            width:   rr - rx,
            height:  rb - ry,
            feather: 60,  // featherGen = 60*1.83 ≈ 110px，与 fExp*H 对齐
          }];
          console.log(`  [动态检测] core: (${coreX1.toFixed(3)},${coreY1.toFixed(3)})-(${coreX2.toFixed(3)},${coreY2.toFixed(3)})`);
          console.log(`  [动态检测] hole: x=${rx.toFixed(3)} y=${ry.toFixed(3)} w=${(rr-rx).toFixed(3)} h=${(rb-ry).toFixed(3)}`);
        } catch (detectErr) {
          console.warn(`  [动态检测] 失败，回退静态配置: ${detectErr.message}`);
        }
        // ────────────────────────────────────────────────────────────────────

        const syncResult = await composeEditRegionsOverBase({
          sourceImage:     templatePath,
          targetImage:     generatedFile,
          outputImage:     finalFile,
          regions,
          restore_regions: [], // 反向遮罩法不需要 restore_regions
        });
        console.log(`[RegionSync] 合成完成 (${syncResult.width}x${syncResult.height})`);
        console.log(`[最终交付图] 已保存: ${path.basename(finalFile)}`);
      } catch (rsErr) {
        console.warn(`[RegionSync] 失败，使用原始生成图: ${rsErr.message}`);
        finalFile = generatedFile;
      }
    }
  }

  // 保存日志
  const logFile = path.join(PROMPT_LOG_DIR, `scene2_rs_${genderTag}_${ts}.json`);
  fs.writeFileSync(logFile, JSON.stringify({
    test_time:        new Date().toISOString(),
    mode:             'faceswap+regionsync',
    scene:            'scene_02',
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
