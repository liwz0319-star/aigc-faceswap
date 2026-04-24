/**
 * 全场景测试：Harry Kane + Luis Díaz + Jamal Musiala
 * 用法: node test_kane_diaz_musiala_all_scenes.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { savePromptLog } = require('./promptLogger');

// ─── 配置 ───
const SERVER_BASE = 'http://111.229.177.65';
const API_KEY = 'StavZC8fVTLd4xOkhqKbsyGjgEn39WHF6RmBA2eUIl7MYNPc';
const POLL_INTERVAL = 6000;
const POLL_TIMEOUT = 360000; // 6分钟

const STAR_IDS = ['104', '105', '107']; // Kane, Díaz, Musiala
const SCENES = ['scene_01', 'scene_02', 'scene_03', 'scene_04'];

const PHOTO_DIR = path.resolve(__dirname, '..', '生成测试', '照片');
const USER_PHOTOS = [
  path.join(PHOTO_DIR, '48c3f055473127c47c79fbb87f556901.jpg'),
  path.join(PHOTO_DIR, '978fd26e01d59e50dc66062494d4e24c.jpg'),
];

const OUTPUT_DIR = path.resolve(__dirname, '..', '生成测试', 'kane_diaz_musiala');

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

// ─── 单场景：提交 + 轮询 ───
async function runScene(sceneId, userImages) {
  // 提交
  let taskId;
  try {
    const res = await axios.post(
      `${SERVER_BASE}/api/v1/synthesis/submit`,
      { star_ids: STAR_IDS, scene_id: sceneId, user_images: userImages },
      { headers: headers(), timeout: 30000 }
    );
    if (res.data.code !== 0) throw new Error(JSON.stringify(res.data));
    taskId = res.data.data.task_id;
    log(sceneId, '提交', `OK  task_id: ${taskId}`);
  } catch (err) {
    const detail = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}` : err.message;
    log(sceneId, '提交失败', detail);
    return { scene: sceneId, success: false, error: detail };
  }

  // 轮询
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
        log(sceneId, '完成', `耗时 ${elapsed}s`);
        return { scene: sceneId, success: true, taskId, results: d.results, elapsed };
      }
      if (d.status === 'failed') {
        log(sceneId, '失败', d.error || '未知错误');
        return { scene: sceneId, success: false, taskId, error: d.error };
      }
      const elapsed = ((Date.now() - start) / 1000).toFixed(0);
      log(sceneId, '等待', `${d.status} (${elapsed}s)`);
    } catch (err) {
      log(sceneId, '查询异常', err.message);
    }
  }
  return { scene: sceneId, success: false, taskId, error: '超时' };
}

// ─── 下载结果图 ───
async function downloadResult(url, filename) {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    const outPath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(outPath, res.data);
    return outPath;
  } catch (err) {
    return null;
  }
}

// ─── 主流程 ───
async function main() {
  console.log('\n' + '='.repeat(62));
  console.log('  全场景测试: Harry Kane / Luis Díaz / Jamal Musiala');
  console.log('='.repeat(62));
  console.log(`  服务器:  ${SERVER_BASE}`);
  console.log(`  球星IDs: ${STAR_IDS.join(', ')}`);
  console.log(`  场景:    ${SCENES.join(', ')}`);
  console.log(`  用户照片: ${USER_PHOTOS.map(p => path.basename(p)).join(' + ')}`);
  console.log('='.repeat(62) + '\n');

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

  // 准备输出目录
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ─── 保存提示词记录（native 模式由服务端生成，此处记录元数据占位）───
  const logFile = savePromptLog({
    mode: 'native',
    starIds: STAR_IDS,
    starNames: ['Harry Kane', 'Luis Díaz', 'Jamal Musiala'],
    userPhotos: USER_PHOTOS,
    promptMap: {},  // native 模式提示词在服务端生成，可查 PM2 日志
    outputDir: OUTPUT_DIR,
  });
  console.log(`  提示词记录已创建: ${logFile}`);
  console.log(`  提示: native 模式完整提示词可从服务器 PM2 日志中获取\n`);

  // 转 Base64
  console.log('  转换用户照片为 Base64...');
  const userImages = USER_PHOTOS.map(toBase64);
  console.log(`  Base64 大小: ${userImages.map(b => (b.length / 1024).toFixed(0) + 'KB').join(' + ')}\n`);

  // 并行提交所有场景
  console.log('─'.repeat(62));
  console.log('  并行提交 4 个场景...');
  console.log('─'.repeat(62));

  const results = await Promise.all(SCENES.map(s => runScene(s, userImages)));

  // 下载 & 汇总
  console.log('\n' + '='.repeat(62));
  console.log('  汇总结果');
  console.log('='.repeat(62));

  for (const r of results) {
    if (r.success && r.results?.length > 0) {
      const result = r.results[0];
      const imgUrl = result.image_url || (result.urls && result.urls[0]);
      console.log(`\n  ✓ ${r.scene}  耗时: ${r.elapsed}s`);
      console.log(`    球星: ${result.player_names?.join(' / ') || STAR_IDS.join('/')}`);
      console.log(`    图片: ${imgUrl || '(无URL)'}`);

      if (imgUrl) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fname = `${r.scene}_${ts}.jpg`;
        const saved = await downloadResult(imgUrl, fname);
        if (saved) {
          console.log(`    已存: ${saved}`);
        } else {
          console.log(`    下载失败，可手动访问: ${imgUrl}`);
        }
      }
    } else {
      console.log(`\n  ✗ ${r.scene}  失败: ${r.error || '未知'}`);
      if (r.taskId) console.log(`    task_id: ${r.taskId}`);
    }
  }

  const ok = results.filter(r => r.success).length;
  console.log(`\n${'='.repeat(62)}`);
  console.log(`  完成: ${ok}/${results.length} 场景成功`);
  console.log(`  输出目录: ${OUTPUT_DIR}`);
  console.log('='.repeat(62) + '\n');
}

main().catch(err => { console.error('\n未捕获错误:', err.message); process.exit(1); });
