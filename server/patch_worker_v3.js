const fs = require('fs');
const filePath = process.argv[2] || '/www/wwwroot/bayern-fan-photo/server/src/synthesisWorker.js';
let code = fs.readFileSync(filePath, 'utf8');

// 1. Replace the entire processFaceswapTask function
const funcStart = '/**\n * 处理 faceswap 任务';
const funcEnd = '}\n\n\nasync function processTask(taskId)';

const startIdx = code.indexOf(funcStart);
const endIdx = code.indexOf(funcEnd);
if (startIdx === -1 || endIdx === -1) {
  console.log('ERROR: could not find processFaceswapTask boundaries');
  process.exit(1);
}

const newFunc = `/**
 * 处理 faceswap 任务
 * 仅替换模板图中球迷的人脸，保持其余一切不变
 * 支持多张用户照片，自动通过视觉模型检测性别
 */
async function processFaceswapTask(taskId) {
  const t0 = Date.now();
  const task = await getTask(taskId);
  if (!task) {
    console.error('[Worker] [faceswap] 任务不存在:', taskId);
    return;
  }

  const {
    template_image,
    user_images,
    user_image,
    callback_url,
    size,
    scene_id,
  } = task.params;

  // 合并 user_image 和 user_images，支持 1-2 张
  const allUserImages = [];
  if (Array.isArray(user_images) && user_images.length > 0) {
    allUserImages.push(...user_images);
  } else if (user_image) {
    allUserImages.push(user_image);
  }

  console.log('[Worker] [faceswap] 开始处理换脸任务:', taskId);
  console.log('[Worker] [faceswap] 场景:', scene_id || '(未指定)');
  console.log('[Worker] [faceswap] 用户照片数:', allUserImages.length);
  console.log('[Worker] [faceswap] 模板图:', (template_image || '(missing)').substring(0, 100));

  await updateTask(taskId, { status: STATUS.PROCESSING });

  try {
    // 下载用户照片转 base64
    const userPhotosBase64 = [];
    for (let i = 0; i < allUserImages.length; i++) {
      console.log('[Worker] [faceswap] 下载用户照片 (images[' + i + '])...');
      userPhotosBase64.push(await urlToBase64(allUserImages[i]));
    }

    // 调用视觉模型分析用户外貌，自动检测性别
    let gender = 'male';
    let userAppearanceDesc = '';
    try {
      console.log('[Worker] [faceswap] 调用视觉模型解析用户外貌...');
      const visionDesc = await describeUserAppearance(userPhotosBase64);
      userAppearanceDesc = visionDesc;
      // 从描述中检测性别
      const lower = visionDesc.toLowerCase();
      if (lower.includes('female') || lower.includes('woman') || lower.includes('girl') || lower.includes('she ') || lower.includes('her ')) {
        gender = 'female';
      }
      console.log('[Worker] [faceswap] 视觉模型: gender=' + gender);
      console.log('[Worker] [faceswap] 视觉描述:', visionDesc.substring(0, 150) + '...');
    } catch (visionErr) {
      console.warn('[Worker] [faceswap] 视觉模型调用失败，默认 male:', visionErr.message);
    }

    // 构建 prompt（场景感知 + 性别感知）
    const { prompt, negative_prompt } = buildFaceswapPrompt({
      scene_id,
      gender,
      userAppearanceDesc,
      userPhotoCount: userPhotosBase64.length,
    });
    console.log('[Worker] [faceswap] Prompt:', prompt.substring(0, 120) + '...');

    // 构建图片数组
    // images[0..N-1] = 用户照片（人脸来源，GROUND TRUTH）
    // images[N] = 模板图（构图参考）
    // images[N+1] = 性别参考图（可选）
    const images = [...userPhotosBase64];

    // 模板图
    if (template_image) {
      console.log('[Worker] [faceswap] 下载模板图 (images[' + images.length + '])...');
      images.push(await urlToBase64(template_image));
    }

    // 性别参考图（场景3/4有男女参考图）
    const genderRefMap = {
      '3': { male: '/www/wwwroot/bayern-fan-photo/素材/参考图/场景3-男.png', female: '/www/wwwroot/bayern-fan-photo/素材/参考图/场景3-女.png' },
      '4': { male: '/www/wwwroot/bayern-fan-photo/素材/参考图/场景4-男.png', female: '/www/wwwroot/bayern-fan-photo/素材/参考图/场景4-女.png' },
    };
    const genderRefPath = genderRefMap[scene_id] && genderRefMap[scene_id][gender];
    if (genderRefPath) {
      try {
        console.log('[Worker] [faceswap] 加载性别参考图 (images[' + images.length + ']):', genderRefPath);
        const refData = fs.readFileSync(genderRefPath);
        const ext = genderRefPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
        images.push('data:' + ext + ';base64,' + refData.toString('base64'));
        console.log('[Worker] [faceswap] 性别参考图已加载');
      } catch (refErr) {
        console.warn('[Worker] [faceswap] 性别参考图加载失败:', refErr.message);
      }
    }

    // 调用 Seedream 4.5 Native API
    const imageResult = await generateNativeImage({
      prompt,
      negative_prompt,
      images,
      size: size || '2048x2560',
    });

    const elapsed = Date.now() - t0;
    console.log('[Worker] [faceswap] 生成成功 (' + elapsed + 'ms):', imageResult.url.substring(0, 80) + '...');

    await updateTask(taskId, {
      status: STATUS.COMPLETED,
      results: [{
        image_url: imageResult.url,
        urls: imageResult.urls,
        mode: 'faceswap',
        gender,
        user_description: userAppearanceDesc,
      }],
    });

    await callbackH5WithRetry(callback_url, {
      task_id: taskId,
      user_image: imageResult.url,
    });

    console.log('[Worker] [faceswap] 任务完成:', taskId, '(总耗时 ' + elapsed + 'ms)');
  } catch (err) {
    console.error('[Worker] [faceswap] 任务失败:', taskId, '(' + (Date.now() - t0) + 'ms)', err.message);

    await updateTask(taskId, {
      status: STATUS.FAILED,
      error: err.message,
    });

    try {
      await callbackH5WithRetry(callback_url, {
        task_id: taskId,
        status: 'failed',
        error: err.message,
        message: '生成失败，请重试',
      });
    } catch (callbackErr) {
      console.warn('[Worker] [faceswap] 失败回调发送异常:', callbackErr.message);
    }
  }
}


`;

code = code.substring(0, startIdx) + newFunc + code.substring(endIdx);
fs.writeFileSync(filePath, code);
console.log('OK: processFaceswapTask rewritten with vision model support');
