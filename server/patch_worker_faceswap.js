const fs = require('fs');
const filePath = process.argv[2] || '/www/wwwroot/bayern-fan-photo/server/src/synthesisWorker.js';
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add import
code = code.replace(
  'const { buildAllPrompts } = require("./promptBuilder");',
  'const { buildAllPrompts } = require("./promptBuilder");\nconst { buildFaceswapPrompt } = require("./promptBuilder_faceswap");'
);

// 2. Add processFaceswapTask function before processTask
const faceswapFunc = `
/**
 * 处理 faceswap 任务
 * 仅替换模板图中球迷的脸，保持其他一切不变
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
  } = task.params;

  console.log('[Worker] [faceswap] 开始处理换脸任务:', taskId);
  console.log('[Worker] [faceswap] 模板图:', (template_image || '(missing)').substring(0, 100));
  console.log('[Worker] [faceswap] 球迷照片:', (user_image || user_images?.[0] || '(missing)').substring(0, 100));

  await updateTask(taskId, { status: STATUS.PROCESSING });

  try {
    const { prompt, negative_prompt } = buildFaceswapPrompt();
    console.log('[Worker] [faceswap] Prompt:', prompt.substring(0, 120) + '...');

    const resolvedUserImage = user_images?.[0] || user_image;
    const extra_images = resolvedUserImage ? [resolvedUserImage] : [];

    // 直接调用 generateImage（relay 客户端），不受 SEEDREAM_MODE 影响
    const imageResult = await generateImage({
      prompt,
      negative_prompt,
      scene_image: template_image,
      extra_images,
      size: size || '2K',
    });

    const elapsed = Date.now() - t0;
    console.log('[Worker] [faceswap] 生成成功 (' + elapsed + 'ms):', imageResult.url.substring(0, 80) + '...');

    await updateTask(taskId, {
      status: STATUS.COMPLETED,
      results: [{
        image_url: imageResult.url,
        urls: imageResult.urls,
        mode: 'faceswap',
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

// Insert processFaceswapTask before processTask
code = code.replace(
  'async function processTask(taskId)',
  faceswapFunc + '\nasync function processTask(taskId)'
);

// 3. Add mode dispatch in processTask after the first updateTask
code = code.replace(
  'await updateTask(taskId, { status: STATUS.PROCESSING });\n',
  'await updateTask(taskId, { status: STATUS.PROCESSING });\n\n    // Check if this is a faceswap task (dispatched by /submit-faceswap)\n    if (task.params.mode === "faceswap") {\n      return processFaceswapTask(taskId);\n    }\n'
);

fs.writeFileSync(filePath, code);
console.log('OK: faceswap worker branch added');
