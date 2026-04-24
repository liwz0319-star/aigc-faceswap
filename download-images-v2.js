/**
 * 下载最新生成的图片
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const images = [
  {
    scene: '场景2',
    url: 'https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-4-5/021776691299911bd223177cc7b14585a4ccdb5490e4938a0a640_0.jpeg?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Credential=AKLTYWJkZTExNjA1ZDUyNDc3YzhjNTM5OGIyNjBhNDcyOTQ%2F20260420%2Fcn-beijing%2Ftos%2Frequest&X-Tos-Date=20260420T132324Z&X-Tos-Expires=86400&X-Tos-Signature=cb1698cf2b61b16945254648637384b13a44d383958eeab7aabcef9f97954abf&X-Tos-SignedHeaders=host',
    filename: '场景2_更衣室_服装问题.jpg'
  },
  {
    scene: '场景3',
    url: 'https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-4-5/0217766913019591cf45d11d421f4f872a8e52de4f86b4fbf7cdb_0.jpeg?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Credential=AKLTYWJkZTExNjA1ZDUyNDc3YzhjNTM5OGIyNjBhNDcyOTQ%2F20260420%2Fcn-beijing%2Ftos%2Frequest&X-Tos-Date=20260420T132306Z&X-Tos-Expires=86400&X-Tos-Signature=15a06bb9f559a39e91a08f5a897f3e07b35511fa0280c52f5ca36fce9bdd9289&X-Tos-SignedHeaders=host',
    filename: '场景3_Bernie_身高问题.jpg'
  },
  {
    scene: '场景4',
    url: 'https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-4-5/021776691306454beb22b84618335a214e9b1bc67d5e6c38fa250_0.jpeg?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Credential=AKLTYWJkZTExNjA1ZDUyNDc3YzhjNTM5OGIyNjBhNDcyOTQ%2F20260420%2Fcn-beijing%2Ftos%2Frequest&X-Tos-Date=20260420T132355Z&X-Tos-Expires=86400&X-Tos-Signature=93673fad0d53a788eb861371e981e8d8d437a5913ec1c9c213048ed722f9d94&X-Tos-SignedHeaders=host',
    filename: '场景4_啤酒浴_修复后.jpg'
  }
];

async function downloadImage(imageInfo, index) {
  console.log(`[${index + 1}/${images.length}] 下载 ${imageInfo.scene}...`);

  try {
    const url = new URL(imageInfo.url);
    const protocol = url.protocol === 'https:' ? https : http;

    const response = await new Promise((resolve, reject) => {
      const req = protocol.get(imageInfo.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://ark.cn-beijing.volces.com/',
          'Accept': 'image/jpeg, image/png'
        },
        timeout: 30000
      }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const data = [];
        res.on('data', chunk => data.push(chunk));
        res.on('end', () => resolve(Buffer.concat(data)));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });
    });

    const outputPath = path.join(__dirname, '生成测试/结果', imageInfo.filename);
    fs.writeFileSync(outputPath, response);

    const fileSize = (response.byteLength / 1024).toFixed(2);
    console.log(`  ✓ 成功下载: ${imageInfo.filename} (${fileSize} KB)`);
    console.log(`  ✓ 保存路径: ${outputPath}`);

    return true;
  } catch (error) {
    console.log(`  ✗ 下载失败: ${error.message}`);
    if (error.response) {
      console.log(`     状态码: ${error.response.status}`);
    }
    return false;
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          下载最新生成的图片（服装、身高问题验证）              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`准备下载 ${images.length} 张图片...`);
  console.log('');

  let successCount = 0;

  for (let i = 0; i < images.length; i++) {
    const success = await downloadImage(images[i], i);
    if (success) {
      successCount++;
    }
    console.log('');
  }

  console.log('─────────────────────────────────────────────────────────────');
  console.log(`下载完成！`);
  console.log(`  成功: ${successCount}/${images.length}`);
  console.log(`  失败: ${images.length - successCount}/${images.length}`);

  if (successCount === images.length) {
    console.log(`\n✓ 所有图片已保存到: ${path.join(__dirname, '生成测试/结果')}`);
    console.log(`\n可以直接在文件夹中查看图片！`);
  } else {
    console.log(`\n⚠ 部分图片下载失败，建议刷新HTML文件查看：`);
    console.log(`   F:\\AAA Work\\AIproject\\demo\\球星球迷合照\\生成测试\\结果\\紧急修复验证_20260420.html`);
  }
}

main();
