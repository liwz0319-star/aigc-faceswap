const fs = require('fs');
const filePath = process.argv[2] || '/www/wwwroot/bayern-fan-photo/server/src/synthesisWorker.js';
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add scene_id and gender to destructuring
const oldDestructure = `  const {
    template_image,
    user_images,
    user_image,
    callback_url,
    size,
  } = task.params;`;

const newDestructure = `  const {
    template_image,
    user_images,
    user_image,
    callback_url,
    size,
    scene_id,
    gender,
  } = task.params;`;

if (code.includes(oldDestructure)) {
  code = code.replace(oldDestructure, newDestructure);
  console.log('OK: added scene_id/gender to destructuring');
}

// 2. Update buildFaceswapPrompt call
const oldPrompt = "    const { prompt, negative_prompt } = buildFaceswapPrompt();";
const newPrompt = "    const { prompt, negative_prompt } = buildFaceswapPrompt({ scene_id, gender });";

if (code.includes(oldPrompt)) {
  code = code.replace(oldPrompt, newPrompt);
  console.log('OK: updated buildFaceswapPrompt call');
}

// 3. Add gender reference image loading after template image
const marker = '    if (template_image) {';
const genderRefBlock = `    if (template_image) {`;

// We need to insert after the template image block
const afterTemplate = `      images.push(await urlToBase64(template_image));
    }`;

const newAfterTemplate = `      images.push(await urlToBase64(template_image));
    }

    // 性别参考图（场景3/4有男女参考图）
    const genderRefMap = {
      '3': { male: '/www/wwwroot/bayern-fan-photo/素材/参考图/场景3-男.png', female: '/www/wwwroot/bayern-fan-photo/素材/参考图/场景3-女.png' },
      '4': { male: '/www/wwwroot/bayern-fan-photo/素材/参考图/场景4-男.png', female: '/www/wwwroot/bayern-fan-photo/素材/参考图/场景4-女.png' },
    };
    const genderRefPath = genderRefMap[scene_id] && genderRefMap[scene_id][gender];
    if (genderRefPath) {
      try {
        console.log('[Worker] [faceswap] 加载性别参考图 (images[2]):', genderRefPath);
        const refData = fs.readFileSync(genderRefPath);
        const ext = genderRefPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
        images.push('data:' + ext + ';base64,' + refData.toString('base64'));
        console.log('[Worker] [faceswap] 性别参考图已加载');
      } catch (refErr) {
        console.warn('[Worker] [faceswap] 性别参考图加载失败:', refErr.message);
      }
    }`;

if (code.includes(afterTemplate) && !code.includes('genderRefMap')) {
  code = code.replace(afterTemplate, newAfterTemplate);
  console.log('OK: added gender reference image loading');
} else if (code.includes('genderRefMap')) {
  console.log('SKIP: gender ref loading already exists');
} else {
  console.log('WARN: afterTemplate marker not found');
}

fs.writeFileSync(filePath, code);
console.log('DONE');
