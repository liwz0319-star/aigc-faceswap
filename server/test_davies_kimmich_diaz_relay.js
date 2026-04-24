/**
 * relay 模式全场景测试：Alphonso Davies + Joshua Kimmich + Luis Díaz
 * 球星 1/3/5，用户照片两张，输出完整提示词
 * 用法: node test_davies_kimmich_diaz_relay.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { savePromptLog } = require('./promptLogger');

// ─── 配置 ───
const SERVER_BASE = 'http://111.229.177.65';
const API_KEY = 'StavZC8fVTLd4xOkhqKbsyGjgEn39WHF6RmBA2eUIl7MYNPc';
const POLL_INTERVAL = 6000;
const POLL_TIMEOUT = 360000;

const STAR_IDS_EXT = ['101', '103', '105'];
const STAR_IDS_INT = ['1', '3', '5'];
const SCENES_EXT = ['scene_01', 'scene_02', 'scene_03', 'scene_04'];
const SCENES_INT = ['1', '2', '3', '4'];

const PHOTO_DIR = path.resolve(__dirname, '..', '生成测试', '照片');
const USER_PHOTOS = [
  path.join(PHOTO_DIR, '978fd26e01d59e50dc66062494d4e24c.jpg'),
  path.join(PHOTO_DIR, '48c3f055473127c47c79fbb87f556901.jpg'),
];
const OUTPUT_DIR = path.resolve(__dirname, '..', '生成测试', 'davies_kimmich_diaz_relay');

// ─── relay 模式图片索引（根据 synthesisWorker.js 逻辑推算）───
// 用户2张(idx1-2) + 球星3张(idx3-5) + 背景(idx6) + 酒杯/球衣按场景
const RELAY_IMG_IDX = {
  '1': { bgIdx: 6, jerseyIdx: 0 },   // 有背景(6)、有酒杯(7)、无球衣
  '2': { bgIdx: 6, jerseyIdx: 8 },   // 有背景(6)、有酒杯(7)、有球衣(8)
  '3': { bgIdx: 6, jerseyIdx: 7 },   // 有背景(6)、无酒杯、有球衣(7)
  '4': { bgIdx: 6, jerseyIdx: 8 },   // 有背景(6)、有酒杯(7)、有球衣(8)
};

function toBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  const mime = path.extname(filePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function apiHeaders() {
  return { 'Content-Type': 'application/json', 'x-api-key': API_KEY };
}

function log(scene, tag, msg) {
  console.log(`[${new Date().toLocaleTimeString()}] [${scene}] [${tag}] ${msg}`);
}

// ─── 本地生成 relay 模式提示词 ───
function generateRelayPrompts() {
  const { buildAllPrompts } = require('./src/promptBuilder');

  const userDescription = 'An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses.';

  const userImageCount = USER_PHOTOS.length; // 2

  const results = {};
  for (let i = 0; i < SCENES_INT.length; i++) {
    const intId = SCENES_INT[i];
    const extId = SCENES_EXT[i];
    const { bgIdx, jerseyIdx } = RELAY_IMG_IDX[intId];

    const { prompt, player_names } = buildAllPrompts(
      STAR_IDS_INT, intId, 'adult', userDescription,
      {
        nativeMode: false,
        userImageCount,
        backgroundImageIdx: bgIdx,
        jerseyImageIdx: jerseyIdx,
      }
    );
    results[extId] = { prompt, player_names, bgIdx, jerseyIdx };
  }
  return results;
}

// ─── 单场景测试 ───
async function runScene(sceneExtId, userImages) {
  let taskId;
  try {
    const res = await axios.post(
      `${SERVER_BASE}/api/v1/synthesis/submit`,
      { star_ids: STAR_IDS_EXT, scene_id: sceneExtId, user_images: userImages },
      { headers: apiHeaders(), timeout: 30000 }
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
        { headers: apiHeaders(), timeout: 10000 }
      );
      const d = qRes.data.data;
      if (d.status === 'completed') {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        log(sceneExtId, '完成', `耗时 ${elapsed}s`);
        return { scene: sceneExtId, success: true, taskId, results: d.results, elapsed };
      }
      if (d.status === 'failed') {
        log(sceneExtId, '失败', d.error || '未知');
        return { scene: sceneExtId, success: false, taskId, error: d.error };
      }
      log(sceneExtId, '等待', `${d.status} (${((Date.now() - start) / 1000).toFixed(0)}s)`);
    } catch (err) {
      log(sceneExtId, '查询异常', err.message);
    }
  }
  return { scene: sceneExtId, success: false, taskId, error: '超时' };
}

async function downloadResult(url, filename) {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    const p = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(p, res.data);
    return p;
  } catch { return null; }
}

// ─── 主流程 ───
async function main() {
  const D = '='.repeat(62);
  const T = '─'.repeat(62);

  console.log('\n' + D);
  console.log('  relay 模式全场景: Davies(101) / Kimmich(103) / Díaz(105)');
  console.log(D);
  console.log(`  模式:    relay (Nano_Banana_Pro_2K_0 / chat/completions)`);
  console.log(`  用户照片: ${USER_PHOTOS.map(p => path.basename(p)).join('\n           ')}`);
  console.log(D + '\n');

  for (const p of USER_PHOTOS) {
    if (!fs.existsSync(p)) { console.error(`照片不存在: ${p}`); process.exit(1); }
    console.log(`  照片: ${path.basename(p)} (${(fs.statSync(p).size / 1024).toFixed(0)} KB)`);
  }

  try {
    const h = await axios.get(`${SERVER_BASE}/health`, { timeout: 8000 });
    console.log(`\n  健康检查: OK  model=${h.data.env?.model}\n`);
  } catch (err) {
    console.error(`\n  服务不可达: ${err.message}`); process.exit(1);
  }

  // ─── 输出所有 relay 模式提示词 ───
  console.log(D);
  console.log('  RELAY 模式提示词（本地构建）');
  console.log(D);
  console.log('  参考图顺序（relay 模式）:');
  console.log('    Image 1  用户照片 978fd26e...');
  console.log('    Image 2  用户照片 48c3f055...');
  console.log('    Image 3  Alphonso Davies 参考图');
  console.log('    Image 4  Joshua Kimmich 参考图');
  console.log('    Image 5  Luis Díaz 参考图');
  console.log('    Image 6  场景背景参考图');
  console.log('    Image 7  酒杯参考图（scene_01/02/04）或 球衣（scene_03）');
  console.log('    Image 8  球衣参考图（scene_02/04）');
  console.log();

  const promptMap = generateRelayPrompts();

  for (const [sceneId, { prompt, player_names, bgIdx, jerseyIdx }] of Object.entries(promptMap)) {
    console.log(T);
    console.log(`  场景: ${sceneId}  球星: ${player_names.join(' / ')}`);
    console.log(`  字符数: ${prompt.length}  bgIdx=${bgIdx}  jerseyIdx=${jerseyIdx}`);
    console.log(T);
    console.log(prompt);
    console.log();
  }

  // ─── 保存提示词记录 ───
  const logFile = savePromptLog({
    mode: 'relay',
    starIds: STAR_IDS_EXT,
    starNames: Object.values(promptMap)[0]?.player_names || [],
    userPhotos: USER_PHOTOS,
    promptMap,
    outputDir: OUTPUT_DIR,
  });
  console.log(`  提示词已保存: ${logFile}\n`);

  // ─── 提交测试 ───
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(D);
  console.log('  转换照片为 Base64...');
  const userImages = USER_PHOTOS.map(toBase64);
  console.log(`  大小: ${userImages.map(b => (b.length / 1024).toFixed(0) + 'KB').join(' + ')}\n`);

  console.log(D);
  console.log('  并行提交 4 个场景...');
  console.log(D);
  const results = await Promise.all(SCENES_EXT.map(s => runScene(s, userImages)));

  console.log('\n' + D);
  console.log('  汇总结果');
  console.log(D);

  for (const r of results) {
    if (r.success && r.results?.length > 0) {
      const result = r.results[0];
      const imgUrl = result.image_url || result.urls?.[0];
      console.log(`\n  ✓ ${r.scene}  耗时: ${r.elapsed}s`);
      console.log(`    球星: ${result.player_names?.join(' / ')}`);
      console.log(`    图片: ${imgUrl || '(无URL)'}`);
      if (imgUrl) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const saved = await downloadResult(imgUrl, `${r.scene}_${ts}.jpg`);
        console.log(saved ? `    已存: ${saved}` : `    下载失败，手动访问: ${imgUrl}`);
      }
    } else {
      console.log(`\n  ✗ ${r.scene}  失败: ${r.error || '未知'}`);
      if (r.taskId) console.log(`    task_id: ${r.taskId}`);
    }
  }

  const ok = results.filter(r => r.success).length;
  console.log(`\n${D}`);
  console.log(`  完成: ${ok}/${results.length} 场景成功`);
  console.log(`  输出目录: ${OUTPUT_DIR}`);
  console.log(D + '\n');
}

main().catch(err => { console.error('\n未捕获错误:', err.message); process.exit(1); });
