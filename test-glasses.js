/**
 * 测试眼镜识别功能
 * 测试场景2和场景4，验证用户眼镜是否能被正确识别和生成
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

async function testSceneWithGlasses(sceneId, sceneName, userImagePath) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`测试场景: ${sceneName} (${sceneId})`);
  console.log(`${'='.repeat(60)}`);

  try {
    // 转换用户照片为 base64
    console.log('正在加载用户照片...');
    const userImageBase64 = imageToBase64(userImagePath);
    console.log(`照片大小: ${Math.round(userImageBase64.length / 1024)} KB`);

    // 提交合成任务
    console.log('正在提交合成任务...');
    const submitBody = JSON.stringify({
      star_ids: ['102', '105', '107'], // 球星 2, 5, 7
      scene_id: sceneId,
      user_image: userImageBase64,
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
            return;
          } else if (status === 'failed') {
            console.log('\n✗ 任务失败');
            console.log(`错误信息: ${queryData.data.error}`);
            return;
          }
        }

        attempts++;
      }

      console.log('\n⚠ 任务超时（5分钟未完成）');
    } else {
      console.log(`✗ 提交失败`);
      console.log(`响应: ${r.body}`);
    }
  } catch (e) {
    console.log(`✗ 错误: ${e.message}`);
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         眼镜识别功能测试 - 场景2和场景4                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n目标服务器: http://${HOST}`);
  console.log(`测试用户照片: 394643d89fde950301c986251894d683.jpg (明确戴眼镜)`);
  console.log(`测试球星: 2, 5, 7`);

  const userImagePath = path.join(__dirname, '生成测试/照片/394643d89fde950301c986251894d683.jpg');

  // 测试场景2 (更衣室)
  await testSceneWithGlasses('scene_02', '更衣室庆祝', userImagePath);

  // 测试场景4 (Bernie 吉祥物)
  await testSceneWithGlasses('scene_04', 'Bernie 吉祥物互动', userImagePath);

  console.log('\n\n测试完成！');
  console.log('请检查生成的图片中用户是否正确佩戴眼镜。');
}

main();
