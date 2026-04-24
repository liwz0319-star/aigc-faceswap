const fs = require('fs');
const filePath = process.argv[2] || '/www/wwwroot/bayern-fan-photo/server/src/synthesisWorker.js';
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add generateNativeImage import (if not already imported)
if (!code.includes('require("./seedreamNativeClient")')) {
  code = code.replace(
    'const { generateImage } = require("./seedreamClient");',
    'const { generateImage } = require("./seedreamClient");\nconst { generateNativeImage } = require("./seedreamNativeClient");'
  );
  console.log('OK: added generateNativeImage import');
} else {
  console.log('SKIP: generateNativeImage already imported');
}

// 2. Replace the generateImage call in processFaceswapTask with generateNativeImage
// The old code passes { prompt, negative_prompt, scene_image, extra_images, size }
// The new code passes { prompt, images: [template_image, fan_photo], size, negative_prompt }
const oldCall = `    // 直接调用 generateImage（relay 客户端），不受 SEEDREAM_MODE 影响
    const imageResult = await generateImage({
      prompt,
      negative_prompt,
      scene_image: template_image,
      extra_images,
      size: size || '2K',
    });`;

const newCall = `    // 使用 Seedream 4.5 Native API（火山方舟官方端点）
    // images[0] = 模板图（构图锚定），images[1] = 球迷照片（人脸来源）
    const images = [];
    if (template_image) images.push(template_image);
    if (extra_images.length > 0) images.push(extra_images[0]);

    const imageResult = await generateNativeImage({
      prompt,
      negative_prompt,
      images,
      size: size || '1664x1664',
    });`;

if (code.includes(oldCall)) {
  code = code.replace(oldCall, newCall);
  console.log('OK: replaced generateImage with generateNativeImage');
} else {
  console.log('WARN: could not find old generateImage call block, trying alternate match...');
  // Fallback: replace line by line
  if (code.includes('直接调用 generateImage')) {
    code = code.replace(
      /\/\/ 直接调用 generateImage[\s\S]*?size: size \|\| '2K',\s*\}\);/,
      newCall
    );
    console.log('OK: replaced via regex fallback');
  } else {
    console.log('ERROR: could not find faceswap generateImage call at all');
    process.exit(1);
  }
}

fs.writeFileSync(filePath, code);
console.log('DONE: faceswap worker now uses Seedream 4.5 native API');
