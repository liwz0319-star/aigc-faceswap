/**
 * Faceswap 模式测试脚本
 *
 * 用法:
 *   node test-faceswap.js
 *
 * 需要环境变量:
 *   SERVER_URL — API 地址 (默认 http://111.229.177.65:3001)
 *   API_KEY    — API 密钥
 */

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY || '';

// ============================================================
// 配置 — 修改这里的值来测试不同场景
// ============================================================

// 模板图 URL (relay_test 中的图)
const TEMPLATE_IMAGES = [
  // 场景1: 穆夏拉 + 基米希 + 帕夫洛维奇
  'https://bayern-fan-photo.cityche.cn/素材/合照/relay_test/scene1_template.png',
  // 场景2: 奥利塞 + 凯恩 + 迪亚斯
  'https://bayern-fan-photo.cityche.cn/素材/合照/relay_test/scene2_template.png',
  // 场景3: 戴维斯 + 于帕梅卡诺 + 诺伊尔
  'https://bayern-fan-photo.cityche.cn/素材/合照/relay_test/scene3_template.png',
];

// 球迷照片 URL (需要替换为实际可访问的 URL)
const FAN_PHOTOS = [
  'https://bayern-fan-photo.cityche.cn/素材/合照/relay_test/fan_test_1.png',
];

// 回调 URL (可选)
const CALLBACK_URL = '';

// ============================================================

async function testFaceswap(templateImage, fanPhoto) {
  console.log('\n========================================');
  console.log('测试 faceswap 模式');
  console.log('========================================');
  console.log('模板图:', templateImage);
  console.log('球迷照:', fanPhoto);
  console.log('----------------------------------------');

  // 1. 提交任务
  const body = {
    template_image: templateImage,
    user_images: [fanPhoto],
  };
  if (CALLBACK_URL) body.callback_url = CALLBACK_URL;

  console.log('[1/3] 提交任务...');
  const submitRes = await fetch(`${SERVER_URL}/api/v1/synthesis/submit-faceswap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!submitRes.ok) {
    const err = await submitRes.text();
    console.error('提交失败:', submitRes.status, err);
    return;
  }

  const submitData = await submitRes.json();
  if (submitData.code !== 0) {
    console.error('提交失败:', submitData.message);
    return;
  }

  const taskId = submitData.data.task_id;
  console.log('任务已提交, task_id:', taskId);

  // 2. 轮询状态
  console.log('[2/3] 轮询状态...');
  const maxPolls = 120; // 最多等 10 分钟 (5s * 120)
  let result = null;

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 5000));

    const queryRes = await fetch(`${SERVER_URL}/api/v1/synthesis/query/${taskId}`, {
      headers: { 'x-api-key': API_KEY },
    });
    const queryData = await queryRes.json();

    const status = queryData.data?.status || 'unknown';
    process.stdout.write(`\r  [${i + 1}/${maxPolls}] 状态: ${status}`);

    if (status === 'completed') {
      result = queryData.data;
      console.log('\n');
      break;
    }
    if (status === 'failed') {
      console.log('\n');
      console.error('任务失败:', queryData.data?.error || '未知错误');
      return;
    }
  }

  if (!result) {
    console.log('\n超时，未获得结果');
    return;
  }

  // 3. 输出结果
  console.log('[3/3] 生成结果:');
  console.log('----------------------------------------');
  result.results.forEach((r, i) => {
    console.log(`图片 ${i + 1}: ${r.url}`);
  });
  console.log('----------------------------------------');
  console.log('完成!');

  return result;
}

// Main
(async () => {
  if (!API_KEY) {
    console.error('请设置 API_KEY 环境变量');
    console.error('用法: API_KEY=xxx node test-faceswap.js');
    process.exit(1);
  }

  // 默认测试第一张模板图 + 第一张球迷照片
  const templateImage = process.env.TEMPLATE_IMAGE || TEMPLATE_IMAGES[0];
  const fanPhoto = process.env.FAN_PHOTO || FAN_PHOTOS[0];

  try {
    await testFaceswap(templateImage, fanPhoto);
  } catch (err) {
    console.error('测试出错:', err.message);
    process.exit(1);
  }
})();
