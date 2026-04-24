/**
 * 从火山引擎CDN下载生成的图片
 * 使用node-fetch库，添加User-Agent和Referer头
 */

const fs = require('fs');
const path = require('path');

// 如果没有node-fetch，使用axios
const axios = require('axios');

const images = [
  {
    scene: '场景1',
    url: 'https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-4-5/02177668539301600bcc3116dfc56b9203b01425516f61bed9f13_0.jpeg',
    filename: '场景1_球星268_眼镜用户.jpg'
  },
  {
    scene: '场景2',
    url: 'https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-4-5/02177668547029467b4ef5ba44a9620b39cdc0042b313b3373a77_0.jpeg',
    filename: '场景2_球星268_眼镜用户.jpg'
  },
  {
    scene: '场景3',
    url: 'https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-4-5/021776685557582b060a07fba38d5479db0751ac158bec5e84794_0.jpeg',
    filename: '场景3_球星268_眼镜用户.jpg'
  },
  {
    scene: '场景4',
    url: 'https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-4-5/02177668564463513d48c4760d2f20ff0aabc46dcd14fa8739daf_0.jpeg',
    filename: '场景4_球星268_眼镜用户.jpg'
  }
];

async function downloadImage(imageInfo, index) {
  console.log(`[${index + 1}/${images.length}] 下载 ${imageInfo.scene}...`);

  try {
    const response = await axios.get(imageInfo.url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://ark.cn-beijing.volces.com/',
        'Accept': 'image/jpeg, image/png'
      },
      timeout: 30000
    });

    const outputPath = path.join(__dirname, '生成测试/结果', imageInfo.filename);

    fs.writeFileSync(outputPath, Buffer.from(response.data));

    const fileSize = (response.data.byteLength / 1024).toFixed(2);
    console.log(`  ✓ 成功下载: ${imageInfo.filename} (${fileSize} KB)`);
    console.log(`  ✓ 保存路径: ${outputPath}`);

    return true;
  } catch (error) {
    console.log(`  ✗ 下载失败: ${error.message}`);
    if (error.response) {
      console.log(`     状态码: ${error.response.status}`);
      console.log(`     响应: ${error.response.data.toString()}`);
    }
    return false;
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║          从火山引擎CDN下载生成的图片                            ║');
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
    console.log(`\n✓ 所有图片已保存到: F:\\AAA Work\\AIproject\\demo\\球星球迷合照\\生成测试\\结果\\`);
    console.log(`\n可以打开文件夹查看所有图片！`);
  } else {
    console.log(`\n⚠ 部分图片下载失败，建议直接打开HTML文件查看：`);
    console.log(`   F:\\AAA Work\\AIproject\\demo\\球星球迷合照\\生成测试\\结果\\查看测试结果.html`);
  }
}

main();
