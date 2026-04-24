/**
 * Minimal 模式最简测试脚本
 * 服务端模式: SEEDREAM_MODE=minimal
 * 提示词来源: src/promptBuilder_minimal.js + src/data/scenes_minimal.json
 *
 * 用法: node test_minimal_debug.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { savePromptLog } = require('./promptLogger');

const SERVER_BASE = 'http://111.229.177.65';
const API_KEY = 'StavZC8fVTLd4xOkhqKbsyGjgEn39WHF6RmBA2eUIl7MYNPc';
const POLL_INTERVAL = 6000;
const POLL_TIMEOUT = 360000;

const STAR_IDS_EXT = ['102', '103', '104'];
const STAR_IDS_INT = ['2', '3', '4'];
const SCENES_EXT = ['scene_01', 'scene_02', 'scene_03', 'scene_04'];
const SCENES_INT = ['1', '2', '3', '4'];

const PHOTO_DIR = path.resolve(__dirname, '..', '生成测试', '照片');
const USER_PHOTOS = [
  path.join(PHOTO_DIR, '2c53f3a8dc145eb8c27508d295e0debd.jpg'),
  path.join(PHOTO_DIR, '6cdbf66fccc20dd8892c8db94b30b819.jpg'),
];
const OUTPUT_DIR = path.resolve(__dirname, '..', '生成测试', 'minimal_debug');

// minimal 模式：场景1/2/3无球员图，bgIdx = userImageCount+1
// 场景4：有球员图，索引与 native 模式一致
const MINIMAL_IMG_IDX = {
  '1': { solo: true,  bgIdx: 3, jerseyIdx: 0 },  // user×2 + bg(3)
  '2': { solo: true,  bgIdx: 3, jerseyIdx: 5 },  // user×2 + bg(3) + beer(4) + jersey(5)
  '3': { solo: true,  bgIdx: 3, jerseyIdx: 4 },  // user×2 + bg(3) + jersey(4)
  '4': { solo: false, bgIdx: 6, jerseyIdx: 8 },  // user×2 + player×3 + bg(6) + beer(7) + jersey(8)
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

function generatePrompts() {
  // ★ 使用 minimal 专属构建器
  const { buildAllPrompts } = require('./src/promptBuilder_minimal');
  const userDescription = 'An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses.';
  const userImageCount = USER_PHOTOS.length;

  const results = {};
  for (let i = 0; i < SCENES_INT.length; i++) {
    const intId = SCENES_INT[i];
    const extId = SCENES_EXT[i];
    const { solo, bgIdx, jerseyIdx } = MINIMAL_IMG_IDX[intId];

    const promptOptions = solo
      ? { minimalSolo: true, userImageCount, backgroundImageIdx: bgIdx, jerseyImageIdx: jerseyIdx }
      : { nativeMode: true, userImageCount, backgroundImageIdx: bgIdx, jerseyImageIdx: jerseyIdx };

    const { prompt, player_names } = buildAllPrompts(
      STAR_IDS_INT, intId, 'adult', userDescription, promptOptions
    );
    results[extId] = { prompt, player_names, bgIdx, jerseyIdx, solo };
  }
  return results;
}

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
        log(sceneExtId, '完成', `耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
        return { scene: sceneExtId, success: true, taskId, results: d.results, elapsed: ((Date.now() - start) / 1000).toFixed(1) };
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

async function main() {
  const D = '='.repeat(62);
  const T = '─'.repeat(62);

  console.log('\n' + D);
  console.log('  [MINIMAL DEBUG] Olise(102) / Kimmich(103) / Kane(104)');
  console.log('  提示词来源: promptBuilder_minimal.js + scenes_minimal.json');
  console.log('  服务端模式: SEEDREAM_MODE=minimal (native API)');
  console.log(D);
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

  console.log(D);
  console.log('  [MINIMAL] 生成提示词（来自 minimal 专属文件）');
  console.log(D);

  const promptMap = generatePrompts();

  for (const [sceneId, { prompt, player_names, bgIdx, jerseyIdx }] of Object.entries(promptMap)) {
    console.log(T);
    console.log(`  场景: ${sceneId}  球星: ${player_names.join(' / ')}`);
    console.log(`  字符数: ${prompt.length}  bgIdx=${bgIdx}  jerseyIdx=${jerseyIdx}`);
    console.log(T);
    console.log(prompt);
    console.log();
  }

  const logFile = savePromptLog({
    mode: 'minimal_debug',
    starIds: STAR_IDS_EXT,
    starNames: Object.values(promptMap)[0]?.player_names || [],
    userPhotos: USER_PHOTOS,
    promptMap,
    outputDir: OUTPUT_DIR,
  });
  console.log(`  提示词已保存: ${logFile}\n`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const userImages = USER_PHOTOS.map(toBase64);
  console.log(`  Base64: ${userImages.map(b => (b.length / 1024).toFixed(0) + 'KB').join(' + ')}\n`);

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
