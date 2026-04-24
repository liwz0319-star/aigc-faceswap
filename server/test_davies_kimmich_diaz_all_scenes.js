/**
 * 全场景测试：Alphonso Davies + Joshua Kimmich + Luis Díaz
 * 球星 1/3/5，用户照片两张，native 模式
 * 同时输出每个场景的完整提示词
 *
 * 用法: node test_davies_kimmich_diaz_all_scenes.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── 配置 ───
const SERVER_BASE = 'http://111.229.177.65';
const API_KEY = 'StavZC8fVTLd4xOkhqKbsyGjgEn39WHF6RmBA2eUIl7MYNPc';
const POLL_INTERVAL = 6000;
const POLL_TIMEOUT = 360000;

// 球星外部 ID（提交 API 用）
const STAR_IDS_EXT = ['101', '103', '105'];  // Davies, Kimmich, Díaz
// 球星内部 ID（promptBuilder 用）
const STAR_IDS_INT = ['1', '3', '5'];

const SCENES_EXT = ['scene_01', 'scene_02', 'scene_03', 'scene_04'];
// promptBuilder 用内部 sceneId
const SCENES_INT = ['1', '2', '3', '4'];

const PHOTO_DIR = path.resolve(__dirname, '..', '生成测试', '照片');
const USER_PHOTOS = [
  path.join(PHOTO_DIR, '978fd26e01d59e50dc66062494d4e24c.jpg'),
  path.join(PHOTO_DIR, '48c3f055473127c47c79fbb87f556901.jpg'),
];

const OUTPUT_DIR = path.resolve(__dirname, '..', '生成测试', 'davies_kimmich_diaz');

// ─── 工具 ───
function toBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function headers() {
  return { 'Content-Type': 'application/json', 'x-api-key': API_KEY };
}

function log(scene, tag, msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${scene}] [${tag}] ${msg}`);
}

// ─── 本地生成提示词 ───
function generatePrompts() {
  // 设置 native 模式所需环境变量（promptBuilder 读取）
  process.env.SEEDREAM_MODE = 'native';

  const { buildAllPrompts } = require('./src/promptBuilder');

  // 固定用户描述（native 模式下 worker 使用的固定描述）
  const userDescription = 'An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses.';

  const userImageCount = USER_PHOTOS.length; // 2张

  // 球星参考图索引：user占 image[1]~image[N]，球星从 image[N+1] 起
  // 每位球星各1张参考图
  const playerOffset = userImageCount + 1;
  const playerImageMap = {
    '1': [playerOffset],       // Davies   -> image[3]
    '3': [playerOffset + 1],   // Kimmich  -> image[4]
    '5': [playerOffset + 2],   // Díaz     -> image[5]
  };

  const prompts = {};
  for (let i = 0; i < SCENES_INT.length; i++) {
    const sceneIntId = SCENES_INT[i];
    const sceneExtId = SCENES_EXT[i];
    const { prompt, player_names } = buildAllPrompts(
      STAR_IDS_INT, sceneIntId, 'adult', userDescription,
      { nativeMode: true, playerImageMap, userImageCount }
    );
    prompts[sceneExtId] = { prompt, player_names };
  }
  return prompts;
}

// ─── 单场景测试：提交 + 轮询 ───
async function runScene(sceneExtId, userImages) {
  let taskId;
  try {
    const res = await axios.post(
      `${SERVER_BASE}/api/v1/synthesis/submit`,
      { star_ids: STAR_IDS_EXT, scene_id: sceneExtId, user_images: userImages },
      { headers: headers(), timeout: 30000 }
    );
    if (res.data.code !== 0) throw new Error(JSON.stringify(res.data));
    taskId = res.data.data.task_id;
    log(sceneExtId, '提交', `OK  task_id: ${taskId}`);
  } catch (err) {
    const detail = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`
      : err.message;
    log(sceneExtId, '提交失败', detail);
    return { scene: sceneExtId, success: false, error: detail };
  }

  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    try {
      const qRes = await axios.get(
        `${SERVER_BASE}/api/v1/synthesis/query/${taskId}`,
        { headers: headers(), timeout: 10000 }
      );
      const d = qRes.data.data;
      if (d.status === 'completed') {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        log(sceneExtId, '完成', `耗时 ${elapsed}s`);
        return { scene: sceneExtId, success: true, taskId, results: d.results, elapsed };
      }
      if (d.status === 'failed') {
        log(sceneExtId, '失败', d.error || '未知错误');
        return { scene: sceneExtId, success: false, taskId, error: d.error };
      }
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      log(sceneExtId, '等待', `${d.status} (${elapsed}s)`);
    } catch (err) {
      log(sceneExtId, '查询异常', err.message);
    }
  }
  return { scene: sceneExtId, success: false, taskId, error: '超时' };
}

// ─── 下载结果图 ───
async function downloadResult(url, filename) {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    const outPath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(outPath, res.data);
    return outPath;
  } catch {
    return null;
  }
}

// ─── 主流程 ───
async function main() {
  const DIVIDER = '='.repeat(62);
  const THIN = '─'.repeat(62);

  console.log('\n' + DIVIDER);
  console.log('  全场景测试: Alphonso Davies / Joshua Kimmich / Luis Díaz');
  console.log(DIVIDER);
  console.log(`  服务器:  ${SERVER_BASE}`);
  console.log(`  球星:    Davies(101) + Kimmich(103) + Díaz(105)`);
  console.log(`  场景:    scene_01 ~ scene_04`);
  console.log(`  用户照片: ${USER_PHOTOS.map(p => path.basename(p)).join(' + ')}`);
  console.log(DIVIDER + '\n');

  // 检查照片
  for (const p of USER_PHOTOS) {
    if (!fs.existsSync(p)) { console.error(`照片不存在: ${p}`); process.exit(1); }
    console.log(`  照片: ${path.basename(p)} (${(fs.statSync(p).size / 1024).toFixed(0)} KB)`);
  }

  // 健康检查
  try {
    const h = await axios.get(`${SERVER_BASE}/health`, { timeout: 8000 });
    console.log(`\n  服务健康检查: OK  model=${h.data.env?.model}\n`);
  } catch (err) {
    console.error(`\n  服务不可达: ${err.message}`); process.exit(1);
  }

  // ─── 生成并输出提示词 ───
  console.log(DIVIDER);
  console.log('  生成提示词（本地构建，native 模式）');
  console.log(DIVIDER);
  console.log(`  图片引用顺序:`);
  console.log(`    Image 1: 用户照片 (978fd26e...)`)
  console.log(`    Image 2: 用户照片 (48c3f055...)`)
  console.log(`    Image 3: Alphonso Davies 参考图`);
  console.log(`    Image 4: Joshua Kimmich 参考图`);
  console.log(`    Image 5: Luis Díaz 参考图`);
  console.log();

  let promptMap;
  try {
    promptMap = generatePrompts();
  } catch (err) {
    console.error('提示词生成失败:', err.message);
    process.exit(1);
  }

  for (const [sceneId, { prompt, player_names }] of Object.entries(promptMap)) {
    console.log(THIN);
    console.log(`  场景: ${sceneId}  球星: ${player_names.join(' / ')}`);
    console.log(`  字符数: ${prompt.length}`);
    console.log(THIN);
    console.log(prompt);
    console.log();
  }

  // 准备输出目录 & Base64
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(DIVIDER);
  console.log('  转换用户照片为 Base64...');
  const userImages = USER_PHOTOS.map(toBase64);
  console.log(`  Base64 大小: ${userImages.map(b => (b.length / 1024).toFixed(0) + 'KB').join(' + ')}\n`);

  // 并行提交所有场景
  console.log(DIVIDER);
  console.log('  并行提交 4 个场景...');
  console.log(DIVIDER);
  const results = await Promise.all(SCENES_EXT.map(s => runScene(s, userImages)));

  // 汇总
  console.log('\n' + DIVIDER);
  console.log('  汇总结果');
  console.log(DIVIDER);

  for (const r of results) {
    if (r.success && r.results?.length > 0) {
      const result = r.results[0];
      const imgUrl = result.image_url || (result.urls && result.urls[0]);
      console.log(`\n  ✓ ${r.scene}  耗时: ${r.elapsed}s`);
      console.log(`    球星: ${result.player_names?.join(' / ')}`);
      console.log(`    图片: ${imgUrl || '(无URL)'}`);
      if (imgUrl) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fname = `${r.scene}_${ts}.jpg`;
        const saved = await downloadResult(imgUrl, fname);
        console.log(saved ? `    已存: ${saved}` : `    下载失败，手动访问: ${imgUrl}`);
      }
    } else {
      console.log(`\n  ✗ ${r.scene}  失败: ${r.error || '未知'}`);
      if (r.taskId) console.log(`    task_id: ${r.taskId}`);
    }
  }

  const ok = results.filter(r => r.success).length;
  console.log(`\n${DIVIDER}`);
  console.log(`  完成: ${ok}/${results.length} 场景成功`);
  console.log(`  输出目录: ${OUTPUT_DIR}`);
  console.log(DIVIDER + '\n');
}

main().catch(err => { console.error('\n未捕获错误:', err.message); process.exit(1); });
