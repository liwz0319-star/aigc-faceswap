/**
 * 合成任务处理 Worker
 *
 * 流程（两步）：
 * 1. 解读用户照片 → 文字外貌描述
 * 2. 拼装 Prompt（球星 + 场景 + 用户描述）→ 调用 Seedream 生成
 */

const axios = require('axios');

// 模式选择：relay / native / minimal（最简测试）/ seedream（seedream调试）
const SEEDREAM_MODE = (process.env.SEEDREAM_MODE || 'relay').toLowerCase();
const _promptBuilderMap = {
  minimal:  './promptBuilder_minimal',
  seedream: './promptBuilder_seedream',
};
const { buildAllPrompts } = require(_promptBuilderMap[SEEDREAM_MODE] || './promptBuilder');
console.log(`[Worker] 模式: ${SEEDREAM_MODE}  promptBuilder: ${_promptBuilderMap[SEEDREAM_MODE] || './promptBuilder'}`);
const { generateImage } = require('./seedreamClient');
const { generateNativeImage } = require('./seedreamNativeClient');
const { buildFaceswapPrompt } = require("./promptBuilder_faceswap");
const { getTask, updateTask, STATUS } = require('./taskQueue');
const { loadReferenceImage, loadJerseyReferences, loadBeerMugReference, loadCompositionReference, loadBackgroundReference, getPlayerReferenceImages } = require('./assetStore');
const { describeUserAppearance } = require('./visionClient');
// Seedream 调用重试配置
const SEEDREAM_MAX_RETRIES = 2;
const SEEDREAM_RETRY_DELAYS = [3000, 6000];

// 回调 H5 重试配置
const CALLBACK_MAX_RETRIES = 3;
const CALLBACK_RETRY_DELAYS = [2000, 5000, 10000];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带重试的 Seedream 调用（自动区分 relay/native 模式）
 */
async function generateWithRetry(params) {
  let lastError;

  for (let attempt = 0; attempt <= SEEDREAM_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Worker] Seedream 第${attempt}次重试...`);
        await sleep(SEEDREAM_RETRY_DELAYS[attempt - 1]);
      }

      if (SEEDREAM_MODE === 'native' || SEEDREAM_MODE === 'seedream' || SEEDREAM_MODE === 'minimal') {
        return await generateNativeImage(params);
      } else {
        return await generateImage(params);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[Worker] Seedream 调用失败（第${attempt + 1}次）: ${err.message}`);

      // 敏感内容检测不重试
      if (err.response?.data?.error?.code === 'OutputImageSensitiveContentDetected') {
        console.error('[Worker] 敏感内容检测，不重试');
        throw err;
      }

      if (err.response?.status >= 400 && err.response?.status < 500) {
        console.error('[Worker] 参数错误，不重试');
        throw err;
      }
    }
  }

  throw lastError;
}

/**
 * 带重试的回调 H5
 */
async function callbackH5WithRetry(url, payload) {
  if (!url) {
    console.warn('[Worker] 无回调地址，跳过回调');
    return;
  }

  let lastError;

  for (let attempt = 0; attempt <= CALLBACK_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Worker] 回调重试第${attempt}次...`);
        await sleep(CALLBACK_RETRY_DELAYS[attempt - 1]);
      }

      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      if (response.data && typeof response.data.code !== 'undefined' && response.data.code !== 0) {
        throw new Error(`回调响应异常: ${response.data.msg || response.data.message || response.data.code}`);
      }

      console.log(`[Worker] 回调成功: ${url}`);
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[Worker] 回调失败（第${attempt + 1}次）: ${url} - ${err.message}`);
    }
  }

  console.error(`[Worker] 回调最终失败（已重试${CALLBACK_MAX_RETRIES}次）: ${url}`);
  throw lastError;
}

// SEEDREAM_MODE 已在文件顶部定义

/**
 * 处理单个合成任务
 */


/**
 * 下载 URL 图片并转为 base64 data URL
 */
async function urlToBase64(url, timeoutMs = 30000) {
  const axios = require("axios");
  const resp = await axios.get(url, { responseType: "arraybuffer", timeout: timeoutMs });
  const contentType = resp.headers["content-type"] || "image/jpeg";
  return "data:" + contentType + ";base64," + Buffer.from(resp.data).toString("base64");
}

/**
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




async function processTask(taskId) {
  const t0 = Date.now();
  const task = await getTask(taskId);
  if (!task) {
    console.error(`[Worker] 任务不存在: ${taskId}`);
    return;
  }

  // faceswap 模式直接跳转
  if (task.params.mode === 'faceswap') {
    return processFaceswapTask(taskId);
  }

  const {
    star_ids, scene_id, user_image, user_images, user_mode, gender, callback_url,
  } = task.params;

  console.log(`[Worker] 开始处理合照任务: ${taskId}`);
  console.log(`[Worker] 球星: ${star_ids}, 场景: ${scene_id}, 模式: ${user_mode}, 性别: ${gender || 'male'}`);

  await updateTask(taskId, { status: STATUS.PROCESSING });

  try {
    if (SEEDREAM_MODE === 'native' || SEEDREAM_MODE === 'seedream') {
      // ═══ native / seedream 模式（官方 Seedream 4.5 API） ═══
      const scenes = require('./data/scenes');
      const scene = scenes[scene_id];

      const resolvedUserImagesNative = (Array.isArray(user_images) && user_images.length > 0)
        ? user_images
        : [user_image];
      const userImageCountNative = resolvedUserImagesNative.length;

      // 1. 用户外貌描述（固定描述，Seedream 直接参考用户照片还原）
      const userDescription = 'An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses.';
      console.log(`[Worker] 使用固定用户描述`);

      // 2. 先确定球星参考图分组及索引，再拼装 Prompt
      const t2 = Date.now();
      console.log(`[Worker] 步骤2: 计算球星参考图索引并拼装 Prompt...`);
      const playerRefGroups = getPlayerReferenceImages(star_ids);
      const playerImageMap = {};
      let nextIdx = userImageCountNative + 1; // 用户占 image[1]~image[N]，球星从 image[N+1] 起
      for (const group of playerRefGroups) {
        playerImageMap[group.star_id] = group.refs.map((_, i) => nextIdx + i);
        nextIdx += group.refs.length;
      }
      const { prompt, player_names } = buildAllPrompts(star_ids, scene_id, user_mode, userDescription, { nativeMode: true, playerImageMap, userImageCount: userImageCountNative });
      console.log(`[Worker] 球星: ${player_names.join(', ')} | Prompt: ${prompt.length} 字符 (${Date.now() - t2}ms)`);

      // 3. 加载参考图（按优先级分级）
      const t3 = Date.now();
      console.log(`[Worker] 步骤3: 加载参考图...`);

      // P0: 核心参考图（必须保留）
      const coreImages = [...resolvedUserImagesNative];
      console.log(`[Worker] [P0] 已加载用户照片: ${userImageCountNative}张`);

      for (const group of playerRefGroups) {
        for (const ref of group.refs) {
          coreImages.push(await ref.image);
          console.log(`[Worker] [P0] 已加载球星参考图: ${ref.source}`);
        }
      }

      // P1: 高优先级参考图（酒杯、球衣）
      const highPriorityImages = [];

      const beerMugImage = await loadBeerMugReference(scene_id);
      if (beerMugImage) {
        highPriorityImages.push(beerMugImage);
        console.log(`[Worker] [P1] 已加载场景${scene_id}酒杯参考图`);
      }

      const jerseyImages = await loadJerseyReferences(scene_id);
      if (jerseyImages.length > 0) {
        highPriorityImages.push(...jerseyImages);
        console.log(`[Worker] [P1] 已加载场景${scene_id}球衣参考图: ${jerseyImages.length}张`);
      }

      // 场景背景参考图提升到P1
      const bgImage = await loadBackgroundReference(scene_id);
      if (bgImage) {
        highPriorityImages.push(bgImage);
        console.log(`[Worker] [P1] 已加载场景${scene_id}背景参考图`);
      }

      // P2: 中优先级参考图（合照参考图）
      const mediumPriorityImages = [];

      const compositionImage = await loadCompositionReference(scene_id);
      if (compositionImage) {
        mediumPriorityImages.push(compositionImage);
        console.log(`[Worker] [P2] 已加载场景${scene_id}合照参考图`);
      }

      // P3: 低优先级参考图（场景参考图，最后被裁剪）
      const lowPriorityImages = [];

      if (!scene?.skip_scene_ref) {
        const refImage = await loadReferenceImage(scene_id, 'adult', gender || 'male');
        if (refImage) {
          lowPriorityImages.push(refImage);
          console.log(`[Worker] [P3] 已加载场景${scene_id}场景参考图`);
        }
      } else {
        console.log(`[Worker] 场景${scene_id} 跳过场景参考图（skip_scene_ref=true）`);
      }

      // 按优先级组装并应用 max_ref_images 限制
      const maxRefImages = scene?.native_params?.max_ref_images;
      const images = [];

      // 先添加P0（核心）
      images.push(...coreImages);

      // 如果还有空间，添加P1（高优先级）
      if (images.length < maxRefImages) {
        const remaining1 = maxRefImages - images.length;
        images.push(...highPriorityImages.slice(0, remaining1));
      }

      // 如果还有空间，添加P2（中优先级）
      if (images.length < maxRefImages) {
        const remaining2 = maxRefImages - images.length;
        images.push(...mediumPriorityImages.slice(0, remaining2));
      }

      // 如果还有空间，添加P3（低优先级）
      if (images.length < maxRefImages) {
        const remaining3 = maxRefImages - images.length;
        images.push(...lowPriorityImages.slice(0, remaining3));
      }

      if (images.length < coreImages.length + highPriorityImages.length) {
        console.log(`[Worker] ⚠️ 警告: 核心或高优先级参考图被裁剪！`);
      }

      console.log(`[Worker] 参考图总计: ${images.length} 张 (P0:${coreImages.length}, P1:${highPriorityImages.length}, P2:${mediumPriorityImages.length}, P3:${lowPriorityImages.length}) (${Date.now() - t3}ms)`);

      // 4. 调用官方 Seedream API
      const t4 = Date.now();
      const sceneSize = scene?.recommended_size || '2K';
      const nativeParams = scene?.native_params || {};
      console.log(`[Worker] 步骤4: 调用 Seedream API (size=${sceneSize}, strength=${nativeParams.strength ?? 0.5}, guidance=${nativeParams.guidance_scale ?? 8})...`);
      const baseNegPrompt = scene_id === '4'
        ? 'missing person, only 2 players, only 1 player, only 3 humans, player cut off, player missing, hidden player, player not visible, no bernie, missing mascot'
        : 'extra people, additional people, bystanders, crowd, background figures, fifth person, group of 5, more than 4 people';

      const imageResult = await generateWithRetry({
        prompt,
        negative_prompt: baseNegPrompt,
        images,
        size: sceneSize,
        scene_params: nativeParams,
        task_id: taskId,
      });

      console.log(`[Worker] 生成成功 (${Date.now() - t4}ms): ${imageResult.url.substring(0, 80)}...`);

      // 5. 更新任务结果
      await updateTask(taskId, {
        status: STATUS.COMPLETED,
        results: [{
          player_names,
          image_url: imageResult.url,
          urls: imageResult.urls,
          user_description: userDescription,
        }],
      });

      // 6. 回调 H5
      await callbackH5WithRetry(callback_url, {
        task_id: taskId,
        user_image: imageResult.url,
      });

      console.log(`[Worker] 任务完成: ${taskId} (总耗时 ${Date.now() - t0}ms)`);

    } else if (SEEDREAM_MODE === 'minimal') {
      // ═══ minimal 模式（场景1/2/3仅球迷+场景，场景4含球员） ═══
      const scenesMin = require('./data/scenes_minimal');
      const scene = scenesMin[scene_id];

      const resolvedUserImages = (Array.isArray(user_images) && user_images.length > 0)
        ? user_images : [user_image];
      const userImageCount = resolvedUserImages.length;

      // 调用视觉模型生成个性化外貌描述，失败时回退到固定描述
      let userDescription;
      try {
        console.log(`[Worker] [minimal] 调用视觉模型解析用户外貌...`);
        const visionDesc = await describeUserAppearance(resolvedUserImages);
        userDescription = `An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses. ADDITIONAL APPEARANCE DETAILS: ${visionDesc}`;
        console.log(`[Worker] [minimal] 视觉模型描述: ${visionDesc.substring(0, 100)}...`);
      } catch (visionErr) {
        console.warn(`[Worker] [minimal] 视觉模型调用失败，使用固定描述: ${visionErr.message}`);
        userDescription = 'An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses.';
      }

      const images = [...resolvedUserImages];
      let playerImageMap = {};

      // 所有场景均加载球员参考图（方案B：场景1/2/3也带球员）
      const playerRefGroups = getPlayerReferenceImages(star_ids);
      let nextIdx = userImageCount + 1;
      for (const group of playerRefGroups) {
        playerImageMap[group.star_id] = group.refs.map((_, i) => nextIdx + i);
        nextIdx += group.refs.length;
        for (const ref of group.refs) {
          images.push(await ref.image);
          console.log(`[Worker] [minimal/P0] 已加载球星参考图: ${ref.source}`);
        }
      }

      // 加载场景素材
      const bgImage = await loadBackgroundReference(scene_id);
      const bgImageIdx = bgImage ? images.length + 1 : 0;
      if (bgImage) { images.push(bgImage); console.log(`[Worker] [minimal/P1] 背景图 Image ${bgImageIdx}`); }

      const beerMugImage = await loadBeerMugReference(scene_id);
      if (beerMugImage) { images.push(beerMugImage); console.log(`[Worker] [minimal/P1] 酒杯图`); }

      const jerseyImages = await loadJerseyReferences(scene_id, 1);
      const jerseyImageIdx = jerseyImages.length > 0 ? images.length + 1 : 0;
      for (const j of jerseyImages) { images.push(j); }
      if (jerseyImages.length > 0) console.log(`[Worker] [minimal/P1] 球衣图 Image ${jerseyImageIdx}`);

      // 所有场景统一走 nativeMode 4人路径
      const promptOptions = { nativeMode: true, playerImageMap, userImageCount, backgroundImageIdx: bgImageIdx, jerseyImageIdx };

      const { prompt, player_names, native_params: minSceneParams } = buildAllPrompts(
        star_ids, scene_id, user_mode, userDescription, promptOptions
      );

      console.log(`[Worker] [minimal] 场景${scene_id} Prompt: ${prompt.length} 字符 | 图片: ${images.length} 张`);

      const nativeParamsMin = minSceneParams || scene?.native_params || {};
      const imageResult = await generateWithRetry({
        prompt,
        images,
        size: scene?.recommended_size || '1536x2560',
        scene_params: nativeParamsMin,
        task_id: taskId,
      });

      console.log(`[Worker] [minimal] 生成成功: ${imageResult.url.substring(0, 80)}...`);

      await updateTask(taskId, {
        status: STATUS.COMPLETED,
        results: [{ player_names, image_url: imageResult.url, urls: imageResult.urls, user_description: userDescription }],
      });

      await callbackH5WithRetry(callback_url, { task_id: taskId, user_image: imageResult.url });
      console.log(`[Worker] 任务完成: ${taskId} (总耗时 ${Date.now() - t0}ms)`);

    } else {
      // ═══ relay 模式（中转平台 / Nano_Banana_Pro） ═══
      // 图片预算：9张 = 1~3(用户) + 3(球星各1张) + 1(背景参考) + 1(啤酒杯) + 1(球衣)

      const resolvedUserImages = (Array.isArray(user_images) && user_images.length > 0)
        ? user_images
        : [user_image];
      const userImageCount = resolvedUserImages.length;

      // 用户外貌描述（固定描述，Seedream 直接参考用户照片还原）
      const userDescription = 'An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses.';
      console.log(`[Worker] 使用固定用户描述`);

      // 先加载参考图，确定背景图索引后再拼装 Prompt
      // P0: 用户照片（1~3张，球迷人脸还原）
      const extraImages = [...resolvedUserImages];
      console.log(`[Worker] [P0] 已加载用户照片: ${userImageCount}张`);

      // P0: 球星参考图（每人限1张，节省槽位给背景和道具）
      const playerRefGroupsRelay = getPlayerReferenceImages(star_ids);
      for (const group of playerRefGroupsRelay) {
        if (group.refs.length > 0) {
          extraImages.push(await group.refs[0].image);
          console.log(`[Worker] [P0] 已加载球星参考图: ${group.refs[0].source}`);
        }
      }

      // P0: 背景参考图（提升至 P0，紧跟球星，确保模型关注背景环境）
      const bgImageIdx = extraImages.length + 1;
      const bgImage = await loadBackgroundReference(scene_id);
      if (bgImage) {
        extraImages.push(bgImage);
        console.log(`[Worker] [P0] 已加载背景参考图 (Image %d)`, bgImageIdx);
      }

      // P1: 啤酒杯参考图
      const beerMugImage = await loadBeerMugReference(scene_id);
      if (beerMugImage) {
        extraImages.push(beerMugImage);
        console.log(`[Worker] [P1] 已加载啤酒杯参考图`);
      }

      // P2: 球衣参考图（如果还有槽位）
      const jerseyImages = await loadJerseyReferences(scene_id, 1);
      const jerseyImageIdx = jerseyImages.length > 0 ? extraImages.length + 1 : 0;
      for (const j of jerseyImages) {
        extraImages.push(j);
      }
      if (jerseyImages.length > 0) console.log(`[Worker] [P2] 已加载球衣参考图: ${jerseyImages.length}张 (Image ${jerseyImageIdx})`);

      // 图片加载完毕，拼装 Prompt（此时 bgImageIdx 已确定）
      const t2 = Date.now();
      console.log(`[Worker] 步骤2: 拼装 Prompt (full, userImages=${userImageCount}, bgImage=${bgImage ? bgImageIdx : 0}, jersey=${jerseyImageIdx})...`);
      const { prompt, player_names } = buildAllPrompts(star_ids, scene_id, user_mode, userDescription, { nativeMode: false, userImageCount, backgroundImageIdx: bgImage ? bgImageIdx : 0, jerseyImageIdx });
      console.log(`[Worker] 球星: ${player_names.join(', ')} | Prompt: ${prompt.length} 字符 (${Date.now() - t2}ms)`);

      const scenesRelay = require('./data/scenes');

      console.log(`[Worker] 参考图总计: ${extraImages.length} 张`);

      const t4 = Date.now();
      const sceneSizeRelay = scenesRelay[scene_id]?.recommended_size || '2K';
      console.log(`[Worker] 步骤3: 调用 Seedream 生成 (size=${sceneSizeRelay})...`);

      const imageResult = await generateWithRetry({
        prompt,
        extra_images: extraImages,
        size: sceneSizeRelay,
      });

      console.log(`[Worker] 生成成功 (${Date.now() - t4}ms)`);

      await updateTask(taskId, {
        status: STATUS.COMPLETED,
        results: [{
          player_names,
          image_url: imageResult.url,
          urls: imageResult.urls,
          user_description: userDescription,
        }],
      });

      await callbackH5WithRetry(callback_url, {
        task_id: taskId,
        user_image: imageResult.url,
      });

      console.log(`[Worker] 任务完成: ${taskId} (总耗时 ${Date.now() - t0}ms)`);
    }

  } catch (err) {
    console.error(`[Worker] 任务失败: ${taskId} (${Date.now() - t0}ms)`, err.message);

    await updateTask(taskId, {
      status: STATUS.FAILED,
      error: err.message,
    });

    // 失败时也回调前端，提示重试
    try {
      await callbackH5WithRetry(callback_url, {
        task_id: taskId,
        status: 'failed',
        error: err.message,
        message: '生成失败，请重试',
      });
    } catch (callbackErr) {
      console.warn(`[Worker] 失败回调发送异常: ${callbackErr.message}`);
    }
  }
}

module.exports = { processTask };
