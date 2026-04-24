/**
 * Seedream API 完整流程测试（两步式）
 * 用法: node test_seedream.js
 *
 * 流程：解读用户照片 → 拼装三模块 Prompt → 调用 API → 保存结果
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { buildAllPrompts } = require('./src/promptBuilder');
const { describeUser } = require('./src/userDescriber');
const { extractImageUrls } = require('./src/seedreamClient');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const LAS_BASE_URL = process.env.LAS_BASE_URL || 'https://newapi.aisonnet.org/v1';
const LAS_API_KEY = process.env.LAS_API_KEY;
const MODEL = process.env.SEEDREAM_MODEL || 'seedream-4.6';

// 测试参数
const TEST_STAR_IDS = ['1', '2', '3'];
const TEST_SCENE_ID = '1';
const TEST_USER_MODE = 'adult';
const TEST_USER_IMAGE = '照片/用户照片.png';

function toBase64(relPath) {
  const abs = path.resolve(PROJECT_ROOT, relPath);
  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function main() {
  console.log('='.repeat(60));
  console.log('  Seedream 两步式测试（解读 + 生成）');
  console.log('='.repeat(60));

  if (!LAS_API_KEY) {
    console.error('✗ LAS_API_KEY 未配置');
    process.exit(1);
  }
  console.log(`✓ API Key: ${LAS_API_KEY.slice(0, 8)}...`);
  console.log(`✓ Model: ${MODEL}`);

  // 步骤1：解读用户照片
  console.log('\n--- 步骤1: 解读用户照片 ---');
  const userImage = toBase64(TEST_USER_IMAGE);
  console.log(`✓ 用户照片: ${TEST_USER_IMAGE}`);

  const userDescription = await describeUser(userImage);
  console.log(`✓ 用户描述: ${userDescription}`);

  // 步骤2：拼装三模块 Prompt
  console.log('\n--- 步骤2: 拼装 Prompt ---');
  const { prompt, player_names } = buildAllPrompts(
    TEST_STAR_IDS, TEST_SCENE_ID, TEST_USER_MODE, userDescription
  );
  console.log(`✓ 球星: ${player_names.join(' / ')}`);
  console.log(`✓ Prompt 长度: ${prompt.length} 字符`);
  console.log('\n--- Prompt 内容 ---');
  console.log(prompt);

  // 步骤3：加载场景参考图
  const sceneImage = toBase64('素材/场景预览图/画面1.jpg');
  console.log(`\n✓ 场景参考图已加载`);

  // 步骤4：调用 Seedream 生成
  console.log('\n--- 步骤3: 调用 Seedream ---');

  const content = [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: sceneImage, detail: 'high' } },
  ];

  console.log('请求已发送，等待生成（最多3分钟）...');

  try {
    const response = await axios.post(
      `${LAS_BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [{ role: 'user', content }],
        size: '2048x2048',
        watermark: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LAS_API_KEY}`,
        },
        timeout: 180000,
      }
    );

    console.log('\n--- API 响应 ---');
    console.log(`状态码: ${response.status}`);

    const respContent = response.data.choices?.[0]?.message?.content || '';
    const urls = extractImageUrls(respContent);

    if (urls.length === 0) {
      console.error('✗ 响应中未找到图片 URL');
      console.log('响应:', respContent.slice(0, 500));
      process.exit(1);
    }

    console.log(`✓ 找到 ${urls.length} 张图片`);

    // 下载并保存所有图片
    for (let i = 0; i < Math.min(urls.length, 4); i++) {
      const imgResp = await axios.get(urls[i], { responseType: 'arraybuffer', timeout: 30000 });
      const outputPath = path.resolve(PROJECT_ROOT, '照片', `test_final_${i + 1}.jpg`);
      fs.writeFileSync(outputPath, imgResp.data);
      console.log(`✓ 图片 ${i + 1} 已保存: ${outputPath} (${(imgResp.data.length / 1024).toFixed(0)} KB)`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('  测试完成！');
    console.log('='.repeat(60));

  } catch (err) {
    console.error('\n✗ 调用失败:');
    if (err.response) {
      console.error(`  HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    } else {
      console.error(`  ${err.message}`);
    }
    process.exit(1);
  }
}

main();
