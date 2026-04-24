/**
 * 全面测试脚本 - 测试所有4个场景
 * 球星：4、5、6（Harry Kane, Luis Díaz, Lennart Karl）
 * 用户照片：6cdbf66fccc20dd8892c8db94b30b819.jpg 和 9dc96094e00c595a6395bf0c683401d5.jpg
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const HOST = '111.229.177.65';
const API_KEY = 'StavZC8fVTLd4xOkhqKbsyGjgEn39WHF6RmBA2eUIl7MYNPc';

// 将图片文件转换为 base64
function imageToBase64(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).slice(1);
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port: 80,
      method,
      path,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      timeout: 30000,
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    if (body) req.write(body);
    req.end();
  });
}

async function testScene(sceneId, sceneName, userImagePath, userLabel) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`测试场景: ${sceneName} (${sceneId}) | 用户: ${userLabel}`);
  console.log(`${'='.repeat(70)}`);

  try {
    // 转换用户照片为 base64
    console.log('正在加载用户照片...');
    const userImageBase64 = imageToBase64(userImagePath);
    console.log(`照片大小: ${Math.round(userImageBase64.length / 1024)} KB`);

    // 提交合成任务
    console.log('正在提交合成任务...');
    const submitBody = JSON.stringify({
      star_ids: ['104', '105', '106'], // 球星 4, 5, 6（Harry Kane, Luis Díaz, Lennart Karl）
      scene_id: sceneId,
      user_images: [userImageBase64],
      user_mode: 'adult',
      gender: 'male'
    });

    const r = await request('POST', '/api/v1/synthesis/submit', submitBody);
    console.log(`HTTP 状态码: ${r.status}`);

    if (r.status === 200) {
      const j = JSON.parse(r.body);
      console.log(`✓ 任务提交成功`);
      console.log(`  task_id: ${j.data.task_id}`);
      console.log(`  status: ${j.data.status}`);

      // 开始轮询任务状态
      console.log('\n开始轮询任务状态...');
      const taskId = j.data.task_id;
      let attempts = 0;
      const maxAttempts = 60; // 最多等待5分钟

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 等待5秒

        const queryResp = await request('GET', `/api/v1/synthesis/query/${taskId}`);
        if (queryResp.status === 200) {
          const queryData = JSON.parse(queryResp.body);
          const status = queryData.data.status;

          console.log(`[${attempts + 1}/${maxAttempts}] 任务状态: ${status}`);

          if (status === 'completed') {
            console.log('\n✓ 任务完成！');
            console.log(`生成图片URL: ${queryData.data.results[0].image_url}`);
            console.log(`用户描述: ${queryData.data.results[0].user_description}`);
            console.log(`\n图片链接已保存，可复制到浏览器查看效果`);
            return { taskId, success: true, url: queryData.data.results[0].image_url };
          } else if (status === 'failed') {
            console.log('\n✗ 任务失败');
            console.log(`错误信息: ${queryData.data.error}`);
            return { taskId, success: false, error: queryData.data.error };
          }
        }

        attempts++;
      }

      console.log('\n⚠ 任务超时（5分钟未完成）');
      return { taskId, success: false, error: '超时' };
    } else {
      console.log(`✗ 提交失败`);
      console.log(`响应: ${r.body}`);
      return { taskId: null, success: false, error: r.body };
    }
  } catch (e) {
    console.log(`✗ 错误: ${e.message}`);
    return { taskId: null, success: false, error: e.message };
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║        全面测试 - 所有4个场景 × 2张用户照片                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log(`\n目标服务器: http://${HOST}`);
  console.log(`测试球星: 4 (Harry Kane), 5 (Luis Díaz), 6 (Lennart Karl)`);
  console.log(`测试场景: 1, 2, 3, 4（全部场景）`);
  console.log(`测试照片: 2张（6cdbf...819.jpg 和 9dc96...01d5.jpg）`);

  const photos = [
    { path: path.join(__dirname, '生成测试/照片/6cdbf66fccc20dd8892c8db94b30b819.jpg'), label: '照片1 (6cdbf...819)' },
    { path: path.join(__dirname, '生成测试/照片/9dc96094e00c595a6395bf0c683401d5.jpg'), label: '照片2 (9dc96...01d)' }
  ];

  const scenes = [
    { id: 'scene_01', name: '场景1 - 啤酒节聚会' },
    { id: 'scene_02', name: '场景2 - 更衣室庆祝' },
    { id: 'scene_03', name: '场景3 - 冠军庆祝淋浴' },
    { id: 'scene_04', name: '场景4 - Bernie吉祥物' }
  ];

  const results = [];

  for (const photo of photos) {
    console.log(`\n\n${'★'.repeat(70)}`);
    console.log(`  开始测试 ${photo.label}`);
    console.log(`${'★'.repeat(70)}`);

    for (const scene of scenes) {
      const result = await testScene(scene.id, scene.name, photo.path, photo.label);
      results.push({ photo: photo.label, scene: scene.name, ...result });
    }
  }

  console.log('\n\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                       测试总结                                ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  let successCount = 0;
  let failCount = 0;

  results.forEach((r, index) => {
    const icon = r.success ? '✓' : '✗';
    console.log(`  ${icon} ${r.photo} | ${r.scene}`);
    if (r.success) {
      console.log(`    URL: ${r.url}`);
      successCount++;
    } else {
      console.log(`    错误: ${r.error}`);
      failCount++;
    }
    console.log(`    task_id: ${r.taskId}`);
  });

  console.log(`\n总计: ${successCount} 成功, ${failCount} 失败 (共 ${results.length} 个任务)`);
  console.log('\n测试完成！');
}

main();
