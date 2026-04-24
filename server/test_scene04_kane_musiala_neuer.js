/**
 * relay 模式单场景重测：scene_04  Kane(104) + Musiala(107) + Neuer(108)
 * 用户照片：9dc96094 + 322dc610
 * 修复：relay 模式现已接入视觉模型，用户外貌描述个性化
 * 用法: node test_scene04_kane_musiala_neuer.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const SERVER_BASE = 'http://111.229.177.65';
const API_KEY = 'StavZC8fVTLd4xOkhqKbsyGjgEn39WHF6RmBA2eUIl7MYNPc';
const POLL_INTERVAL = 6000;
const POLL_TIMEOUT = 420000;

const STAR_IDS_EXT = ['104', '107', '108'];

const PHOTO_DIR = path.resolve(__dirname, '..', '生成测试', '照片');
const USER_PHOTOS = [
  path.join(PHOTO_DIR, '9dc96094e00c595a6395bf0c683401d5.jpg'),
  path.join(PHOTO_DIR, '322dc610d8d527f64fb4c2d3d5a0087f.jpg'),
];
const OUTPUT_DIR = path.resolve(__dirname, '..', '生成测试', 'relay_test');

function toBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  const mime = path.extname(filePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function apiHeaders() {
  return { 'Content-Type': 'application/json', 'x-api-key': API_KEY };
}

function log(tag, msg) {
  console.log(`[${new Date().toLocaleTimeString()}] [${tag}] ${msg}`);
}

async function main() {
  const D = '='.repeat(62);
  console.log('\n' + D);
  console.log('  relay 模式重测 scene_04  Kane(104) / Musiala(107) / Neuer(108)');
  console.log('  视觉模型已接入 relay 分支，用户外貌描述个性化');
  console.log(D);

  for (const p of USER_PHOTOS) {
    if (!fs.existsSync(p)) { console.error(`照片不存在: ${p}`); process.exit(1); }
    console.log(`  照片: ${path.basename(p)} (${(fs.statSync(p).size / 1024).toFixed(0)} KB)`);
  }

  try {
    const h = await axios.get(`${SERVER_BASE}/health`, { timeout: 8000 });
    console.log(`\n  健康检查: OK  mode=${h.data.env?.seedream_mode}  model=${h.data.env?.model}\n`);
  } catch (err) {
    console.error(`\n  服务不可达: ${err.message}`); process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const userImages = USER_PHOTOS.map(toBase64);
  console.log(`  Base64: ${userImages.map(b => (b.length / 1024).toFixed(0) + 'KB').join(' + ')}\n`);

  // 提交任务
  let taskId;
  try {
    const res = await axios.post(
      `${SERVER_BASE}/api/v1/synthesis/submit`,
      { star_ids: STAR_IDS_EXT, scene_id: 'scene_04', user_images: userImages },
      { headers: apiHeaders(), timeout: 30000 }
    );
    if (res.data.code !== 0) throw new Error(JSON.stringify(res.data));
    taskId = res.data.data.task_id;
    log('scene_04', `提交成功  task_id: ${taskId}`);
  } catch (err) {
    const detail = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`
      : err.message;
    log('scene_04', `提交失败: ${detail}`);
    process.exit(1);
  }

  // 轮询结果
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
        log('scene_04', `完成  耗时 ${elapsed}s`);
        const result = d.results?.[0];
        const imgUrl = result?.image_url || result?.urls?.[0];
        console.log(`\n  球星: ${result?.player_names?.join(' / ')}`);
        console.log(`  图片: ${imgUrl || '(无URL)'}`);
        if (imgUrl) {
          try {
            const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 60000 });
            const ts = Date.now();
            const filename = `scene_04_${STAR_IDS_EXT.join('-')}_${ts}.jpg`;
            const savePath = path.join(OUTPUT_DIR, filename);
            fs.writeFileSync(savePath, imgRes.data);
            console.log(`  已存: ${savePath}`);
          } catch { console.log(`  下载失败，手动访问: ${imgUrl}`); }
        }
        break;
      }
      if (d.status === 'failed') {
        log('scene_04', `失败: ${d.error || '未知'}`);
        break;
      }
      log('scene_04', `等待中 ${d.status} (${((Date.now() - start) / 1000).toFixed(0)}s)`);
    } catch (err) {
      log('scene_04', `查询异常: ${err.message}`);
    }
  }

  console.log(`\n${D}`);
  console.log(`  输出目录: ${OUTPUT_DIR}`);
  console.log(D + '\n');
}

main().catch(err => { console.error('\n未捕获错误:', err.message); process.exit(1); });
