/**
 * Faceswap 本地直测脚本（无需 Redis / 队列）
 * - 视觉模型解读用户照片外貌
 * - 每张模板指定精确替换位置
 * - Seedream 4.5 native 模式生成
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

// 将 server/node_modules 加入模块解析路径
require('module').Module.globalPaths.push(path.join(SERVER_DIR, 'node_modules'));

const { generateNativeImage }    = require('./server/src/seedreamNativeClient');
const { buildFaceswapPrompt }    = require('./server/src/promptBuilder_faceswap');
const { describeUserAppearance } = require('./server/src/visionClient');

// ============================================================
// 用户照片（2 张，同一个人的不同角度）
// ============================================================
const USER_PHOTOS = [
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/48c3f055473127c47c79fbb87f556901.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/978fd26e01d59e50dc66062494d4e24c.jpg',
];

// ============================================================
// 模板配置：每张模板 + 要替换的人物位置（英文描述用于 prompt）
// ============================================================
const RELAY_DIR = 'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/relay_test';

const TEMPLATES = [
  {
    file: 'scene_01_1777013166087.jpg',
    targetPerson: 'the second person from the right',
    targetDesc:   '右边第二个人',
  },
  {
    file: 'scene_01_user2_1777013794418.jpg',
    targetPerson: 'the second person from the left',
    targetDesc:   '左边第二个人',
  },
  {
    file: 'scene_02_1777013168257.png',
    targetPerson: 'the second person from the right',
    targetDesc:   '右边第二个人',
  },
  {
    file: 'scene_02_user2_1777014143898.png',
    targetPerson: 'the second person from the right',
    targetDesc:   '右边第二个人',
  },
  {
    file: 'scene_03_1777013337798.png',
    targetPerson: 'the third person from the left (the woman)',
    targetDesc:   '左边第三个女生',
  },
  {
    file: 'scene_03_user2_1777013790300.png',
    targetPerson: 'the second person from the left',
    targetDesc:   '左边第二个人',
  },
  {
    file: 'scene_04_104-101-108_1777014649495.png',
    targetPerson: 'the second person from the left',
    targetDesc:   '左边第二个人',
  },
  {
    file: 'scene_04_104-107-108_1777014735726.jpg',
    targetPerson: 'the second person from the left',
    targetDesc:   '左边第二个人',
  },
];

// 生成结果保存目录
const OUTPUT_DIR = path.join(__dirname, '生成测试', 'faceswap_output');

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

async function main() {
  console.log('========================================');
  console.log('Faceswap 测试（Seedream 4.5 native）');
  console.log('========================================');

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ── Step 1: 视觉模型解读用户照片 ──
  console.log('\n[Step 1] 视觉模型解读用户照片...');
  const userBase64s = USER_PHOTOS.map(toBase64DataUrl);
  let userDescription = '';
  try {
    userDescription = await describeUserAppearance(userBase64s);
    console.log('外貌描述:', userDescription.substring(0, 150) + '...');
  } catch (err) {
    console.warn('视觉模型调用失败，跳过外貌描述:', err.message);
  }

  // ── Step 2: 逐模板生成 ──
  console.log(`\n[Step 2] 开始处理 ${TEMPLATES.length} 张模板...\n`);

  const results = [];

  for (const tpl of TEMPLATES) {
    const templatePath = path.join(RELAY_DIR, tpl.file).replace(/\\/g, '/');
    const baseName = path.basename(tpl.file, path.extname(tpl.file));

    console.log(`----------------------------------------`);
    console.log(`模板: ${tpl.file}`);
    console.log(`替换: ${tpl.targetDesc} (${tpl.targetPerson})`);

    const templateBase64 = toBase64DataUrl(templatePath);

    const { prompt, negative_prompt } = buildFaceswapPrompt({
      targetPerson:    tpl.targetPerson,
      userDescription: userDescription,
    });

    console.log(`Prompt: ${prompt.split('\n').length} 行 | 参考图: 1模板 + ${userBase64s.length}球迷`);
    console.log(`调用 generateNativeImage...`);

    const t0 = Date.now();
    try {
      const result = await generateNativeImage({
        prompt,
        negative_prompt,
        images: [templateBase64, userBase64s[0]],  // Image 1=模板底图, Image 2=球迷人脸参考
        size: '2048x2048',
        scene_params: { strength: 0.35, guidance_scale: 10 },
      });

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`生成成功 (${elapsed}s): ${result.url.substring(0, 80)}...`);

      // 下载到本地
      const localFile = path.join(OUTPUT_DIR, `${baseName}_faceswap.jpg`);
      await downloadFile(result.url, localFile);
      console.log(`已保存: ${path.basename(localFile)}`);

      results.push({ file: tpl.file, targetDesc: tpl.targetDesc, elapsed, url: result.url, localFile, status: 'ok' });
    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.error(`失败 (${elapsed}s): ${err.message}`);
      results.push({ file: tpl.file, targetDesc: tpl.targetDesc, elapsed, status: 'failed', error: err.message });
    }
  }

  // ── 汇总 ──
  console.log('\n========================================');
  console.log('汇总结果');
  console.log('========================================');
  results.forEach((r, i) => {
    const tag = r.status === 'ok' ? '✓' : '✗';
    console.log(`[${i + 1}] ${tag} ${r.file}  替换:${r.targetDesc}  (${r.elapsed}s)`);
    if (r.status === 'ok')     console.log(`      保存: ${path.basename(r.localFile)}`);
    if (r.status === 'failed') console.log(`      错误: ${r.error}`);
  });

  const jsonFile = path.join(OUTPUT_DIR, `result_${Date.now()}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify({ userDescription, results }, null, 2), 'utf8');
  console.log(`\n结果已保存: ${jsonFile}`);
}

main().catch(err => {
  console.error('\n测试出错:', err.message);
  process.exit(1);
});
