/**
 * Faceswap 场景1 自动化测试脚本
 * 流程:
 *   1. 视觉模型识别用户性别 + 外貌
 *   2. 根据性别选择模板:
 *      - 女性 → scene_01_1777013166087_faceswap.jpg (替换右边第二个人)
 *      - 男性 → scene_01_user2_1777013794418_faceswap.jpg (替换左边第二个人)
 *   3. Faceswap 生成 + 提示词记录
 *
 * 用法:
 *   node test-faceswap-scene1.js [用户照片路径]
 *   node test-faceswap-scene1.js                          # 使用默认照片
 *   node test-faceswap-scene1.js "照片/xxx.jpg"           # 指定照片
 */

const fs   = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, 'server');

// 手动解析 server/.env
fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

// 视觉模型使用与 native 模式相同的 API Key
if (!process.env.VISION_API_KEY && process.env.SEEDREAM_NATIVE_API_KEY) {
  process.env.VISION_API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
}

require('module').Module.globalPaths.push(path.join(SERVER_DIR, 'node_modules'));

const { generateNativeImage }    = require('./server/src/seedreamNativeClient');
const { buildFaceswapPrompt }    = require('./server/src/promptBuilder_faceswap');
const { describeUserAppearance } = require('./server/src/visionClient');
const axios = require(path.join(SERVER_DIR, 'node_modules', 'axios'));

// ============================================================
// 场景1 模板配置（按性别分组）
// ============================================================
const FACESWAP_OUTPUT_DIR = path.join(__dirname, '生成测试', 'faceswap_output');

const SCENE1_TEMPLATES = {
  female: {
    file: 'scene_01_1777013166087_faceswap.jpg',
    targetPerson: 'the second person from the right',
    targetDesc:   '右边第二个人',
    description:  '女球迷模板: 男球迷 | 女球迷(替换) | 球员 | 球员',
  },
  male: {
    file: 'scene_01_user2_1777013794418_faceswap.jpg',
    targetPerson: 'the second person from the left',
    targetDesc:   '左边第二个人',
    description:  '男球迷模板: 男球迷 | 男球迷(替换) | 球员 | 球员',
  },
};

const OUTPUT_DIR = path.join(__dirname, '生成测试', 'faceswap_output');
const PROMPT_LOG_DIR = path.join(__dirname, '生成测试', 'prompt_logs');
const DEFAULT_SIZE = '2048x2560';
const DEFAULT_STRENGTH = 0.68;
const DEFAULT_GUIDANCE = 10;

// 默认用户照片
const DEFAULT_USER_PHOTO = 'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/978fd26e01d59e50dc66062494d4e24c.jpg';

// ============================================================
// 工具函数
// ============================================================

/** 本地图片 → base64 data URL */
function toBase64DataUrl(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const buf  = fs.readFileSync(normalized);
  const ext  = path.extname(normalized).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
             : ext === 'png' ? 'image/png'
             : `image/${ext}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** 下载 URL → 本地文件 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const http  = require('http');
    const client = url.startsWith('https') ? https : http;
    const file   = fs.createWriteStream(dest);
    client.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { try { fs.unlinkSync(dest); } catch(_) {} reject(err); });
  });
}

function parseCliArgs(argv) {
  const options = {
    userPhotoPath: DEFAULT_USER_PHOTO,
    gender: null,
    size: DEFAULT_SIZE,
    strength: DEFAULT_STRENGTH,
    guidanceScale: DEFAULT_GUIDANCE,
    templatePath: null,
    targetPerson: null,
    targetDesc: null,
  };

  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--gender') {
      options.gender = argv[++i] || null;
    } else if (arg === '--size') {
      options.size = argv[++i] || DEFAULT_SIZE;
    } else if (arg === '--strength') {
      options.strength = parseFloat(argv[++i] || DEFAULT_STRENGTH);
    } else if (arg === '--guidance') {
      options.guidanceScale = parseFloat(argv[++i] || DEFAULT_GUIDANCE);
    } else if (arg === '--template') {
      options.templatePath = argv[++i] || null;
    } else if (arg === '--target-person') {
      options.targetPerson = argv[++i] || null;
    } else if (arg === '--target-desc') {
      options.targetDesc = argv[++i] || null;
    } else if (!arg.startsWith('--')) {
      positionals.push(arg);
    }
  }

  if (positionals[0]) {
    options.userPhotoPath = positionals[0];
  }

  if (!['male', 'female', null].includes(options.gender)) {
    throw new Error('--gender 只支持 male 或 female');
  }

  if (!Number.isFinite(options.strength)) {
    throw new Error('--strength 必须是数字');
  }

  if (!Number.isFinite(options.guidanceScale)) {
    throw new Error('--guidance 必须是数字');
  }

  return options;
}

/**
 * 视觉模型检测用户性别
 * @param {string} userImageBase64 - base64 data URL
 * @returns {Promise<'male'|'female'|'unknown'>}
 */
async function detectGender(userImageBase64) {
  const VISION_API_URL = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const VISION_API_KEY = process.env.VISION_API_KEY;

  if (!VISION_API_KEY) throw new Error('VISION_API_KEY 未配置');

  const res = await axios.post(
    VISION_API_URL,
    {
      model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: userImageBase64 } },
            {
              type: 'text',
              text: 'Look at this person photo and infer gender presentation conservatively. Reply with ONLY one word: "male", "female", or "unknown". Use "unknown" unless the presentation is visually clear and high-confidence.',
            },
          ],
        },
      ],
      max_tokens: 10,
      temperature: 0.1,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VISION_API_KEY}`,
      },
      timeout: 15000,
    }
  );

  const answer = (res.data?.choices?.[0]?.message?.content || '').trim().toLowerCase();
  console.log(`[性别检测] 视觉模型返回: "${answer}"`);

  if (answer.includes('female') || answer.includes('woman') || answer.includes('girl') || answer.includes('女')) {
    return 'female';
  }
  if (answer.includes('male') || answer.includes('man') || answer.includes('boy') || answer.includes('男')) {
    return 'male';
  }
  return 'unknown';
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const userPhotoPath = cli.userPhotoPath;

  console.log('========================================');
  console.log('Faceswap 场景1 自动化测试');
  console.log('========================================');
  console.log(`用户照片: ${path.basename(userPhotoPath)}`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(PROMPT_LOG_DIR)) fs.mkdirSync(PROMPT_LOG_DIR, { recursive: true });

  // ── Step 1: 读取用户照片 ──
  console.log('\n[Step 1] 读取用户照片...');
  const userBase64 = toBase64DataUrl(userPhotoPath);

  // ── Step 2: 性别检测 ──
  console.log('\n[Step 2] 性别检测...');
  let gender = cli.gender || 'unknown';
  if (cli.gender) {
    console.log(`[性别检测] 使用命令行指定模板: ${cli.gender}`);
  } else {
    try {
      gender = await detectGender(userBase64);
    } catch (err) {
      console.warn('性别检测失败，默认使用男性模板:', err.message);
      gender = 'male';
    }
  }

  // 性别未知时默认男性
  if (gender === 'unknown') {
    console.log('[性别检测] 无法确定性别，默认使用男性模板');
    gender = 'male';
  }

  const genderLabel = gender === 'female' ? '女性' : '男性';
  console.log(`[性别检测] 结果: ${genderLabel}`);

  // ── Step 3: 根据性别选择模板 ──
  const tpl = { ...SCENE1_TEMPLATES[gender] };
  const templatePath = cli.templatePath || path.join(FACESWAP_OUTPUT_DIR, tpl.file);
  if (cli.templatePath) {
    tpl.file = path.basename(cli.templatePath);
  }
  if (cli.targetPerson) {
    tpl.targetPerson = cli.targetPerson;
  }
  if (cli.targetDesc) {
    tpl.targetDesc = cli.targetDesc;
  }

  console.log(`\n[Step 3] 选择模板:`);
  console.log(`  模板: ${tpl.file}`);
  console.log(`  说明: ${tpl.description}`);
  console.log(`  替换: ${tpl.targetDesc} (${tpl.targetPerson})`);

  if (!fs.existsSync(templatePath)) {
    console.error(`模板文件不存在: ${templatePath}`);
    process.exit(1);
  }

  // ── Step 4: 视觉模型解读外貌 ──
  console.log('\n[Step 4] 视觉模型解读外貌...');
  let userDescription = '';
  try {
    userDescription = await describeUserAppearance([userBase64]);
    console.log(`外貌描述: ${userDescription.substring(0, 120)}...`);
  } catch (err) {
    console.warn('视觉模型调用失败，跳过外貌描述:', err.message);
  }

  // ── Step 5: 构建 Prompt 并生成 ──
  console.log('\n[Step 5] 构建 Prompt 并调用 Seedream...');

  const templateBase64 = toBase64DataUrl(templatePath);

  const { prompt, negative_prompt } = buildFaceswapPrompt({
    targetPerson:    tpl.targetPerson,
    userDescription: userDescription,
    gender,
  });

  // ★ 打印完整提示词
  console.log('\n========== 提示词记录 ==========');
  console.log('【性别】', genderLabel);
  console.log('【模板】', tpl.file);
  console.log('【替换位置】', tpl.targetDesc);
  console.log('\n【Positive Prompt】');
  console.log(prompt);
  console.log('\n【Negative Prompt】');
  console.log(negative_prompt);
  console.log('\n【API 参数】');
  console.log(`  model: ${process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128'}`);
  console.log(`  size: ${cli.size}`);
  console.log(`  strength: ${cli.strength}`);
  console.log(`  guidance_scale: ${cli.guidanceScale}`);
  console.log(`  images: 2 (template + user photo)`);
  console.log('================================\n');

  const t0 = Date.now();
  console.log('调用 generateNativeImage...');
  try {
    const result = await generateNativeImage({
      prompt,
      negative_prompt,
      images: [templateBase64, userBase64],
      size: cli.size,
      scene_params: { strength: cli.strength, guidance_scale: cli.guidanceScale },
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n生成成功 (${elapsed}s): ${result.url.substring(0, 80)}...`);

    // 下载到本地
    const genderTag = gender === 'female' ? 'F' : 'M';
    const localFile = path.join(OUTPUT_DIR, `scene1_auto_${genderTag}_${Date.now()}.jpg`);
    await downloadFile(result.url, localFile);
    console.log(`已保存: ${path.basename(localFile)}`);

    // ── 保存提示词日志 ──
    const timestamp = Date.now();
    const promptLogFile = path.join(PROMPT_LOG_DIR, `scene1_auto_${genderTag}_${timestamp}.json`);
    const promptLogData = {
      test_time: new Date().toISOString(),
      mode: 'faceswap',
      scene: 'scene_01',
      gender: gender,
      gender_label: gender,
      user_photo: path.basename(userPhotoPath),
      template_file: tpl.file,
      target_person: tpl.targetPerson,
      target_desc: tpl.targetDesc,
      user_description: userDescription,
      prompt: prompt,
      negative_prompt: negative_prompt,
      api_params: {
        model: process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128',
        size: cli.size,
        strength: cli.strength,
        guidance_scale: cli.guidanceScale,
      },
      result: {
        elapsed,
        url: result.url,
        localFile: path.basename(localFile),
        status: 'ok',
      },
    };
    fs.writeFileSync(promptLogFile, JSON.stringify(promptLogData, null, 2), 'utf8');
    console.log(`\n提示词日志: ${promptLogFile}`);

    // ── 汇总 ──
    console.log('\n========================================');
    console.log('测试完成');
    console.log('========================================');
    console.log(`用户性别: ${genderLabel}`);
    console.log(`使用模板: ${tpl.file}`);
    console.log(`替换位置: ${tpl.targetDesc}`);
    console.log(`耗时: ${elapsed}s`);
    console.log(`输出: ${path.basename(localFile)}`);

  } catch (err) {
    console.error(`\n生成失败: ${err.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n测试出错:', err.message);
  process.exit(1);
});
