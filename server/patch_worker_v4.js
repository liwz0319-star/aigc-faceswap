const fs = require('fs');
const filePath = process.argv[2] || '/www/wwwroot/bayern-fan-photo/server/src/synthesisWorker.js';
let code = fs.readFileSync(filePath, 'utf8');

// 1. Find and replace the entire processFaceswapTask
const funcStart = '/**\n * 处理 faceswap 任务';
const funcEnd = '}\n\n\n\nasync function processTask(taskId)';

const startIdx = code.indexOf(funcStart);
const endIdx = code.indexOf(funcEnd);
if (startIdx === -1 || endIdx === -1) {
  console.log('ERROR: could not find processFaceswapTask boundaries');
  process.exit(1);
}

const newFunc = `/**
 * 处理 faceswap 任务
 *
 * 策略：只传 2 张图（用户照片 + 模板图），高 strength 锚定模板
 * images[0] = 用户照片（仅提供人脸身份）
 * images[1] = 模板图（构图锚定，strength=0.75 确保高度还原）
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

  const allUserImages = [];
  if (Array.isArray(user_images) && user_images.length > 0) {
    allUserImages.push(...user_images);
  } else if (user_image) {
    allUserImages.push(user_image);
  }

  console.log('[Worker] [faceswap] 开始处理换脸任务:', taskId);
  console.log('[Worker] [faceswap] 场景:', scene_id || '(未指定)');
  console.log('[Worker] [faceswap] 用户照片数:', allUserImages.length);

  await updateTask(taskId, { status: STATUS.PROCESSING });

  try {
    // 只取第一张用户照片（避免多张参考图导致模型混乱）
    const userPhotoUrl = allUserImages[0];
    console.log('[Worker] [faceswap] 下载用户照片 (images[0])...');
    const userPhotoBase64 = await urlToBase64(userPhotoUrl);

    // 视觉模型检测性别 + 获取外貌描述
    let gender = 'male';
    let userAppearanceDesc = '';
    try {
      console.log('[Worker] [faceswap] 调用视觉模型解析用户外貌...');
      const visionDesc = await describeUserAppearance([userPhotoBase64]);
      userAppearanceDesc = visionDesc;
      const lower = visionDesc.toLowerCase();
      if (lower.includes('female') || lower.includes('woman') || lower.includes('girl') || lower.includes('she ')) {
        gender = 'female';
      }
      console.log('[Worker] [faceswap] 视觉模型: gender=' + gender);
    } catch (visionErr) {
      console.warn('[Worker] [faceswap] 视觉模型失败，默认male:', visionErr.message);
    }

    // 构建 prompt
    const { prompt, negative_prompt } = buildFaceswapPrompt({
      scene_id,
      gender,
      userAppearanceDesc,
    });
    console.log('[Worker] [faceswap] Prompt (' + prompt.length + ' chars):', prompt.substring(0, 150));

    // 下载模板图
    console.log('[Worker] [faceswap] 下载模板图 (images[1])...');
    const templateBase64 = await urlToBase64(template_image);

    // 只传 2 张图：用户照片 + 模板图
    const images = [userPhotoBase64, templateBase64];

    // 调用 Seedream 4.5，strength=0.75（高保真还原模板）
    const imageResult = await generateNativeImage({
      prompt,
      negative_prompt,
      images,
      size: size || '2048x2560',
      scene_params: { strength: 0.75, guidance_scale: 10 },
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
console.log('OK: processFaceswapTask rewritten');
console.log('  - Only 2 images (user photo + template)');
console.log('  - strength=0.75 (high fidelity to template)');
console.log('  - Minimal focused prompt');
