/**
 * 合成任务处理 Worker
 *
 * 流程（两步）：
 * 1. 解读用户照片 → 文字外貌描述
 * 2. 拼装 Prompt（球星 + 场景 + 用户描述）→ 调用 Seedream 生成
 */

const axios = require('axios');
const path  = require('path');
const fs    = require('fs');
const fsp   = require('fs').promises;

// 模式选择：relay / native / minimal（最简测试）/ seedream（seedream调试）
const SEEDREAM_MODE = (process.env.SEEDREAM_MODE || 'relay').toLowerCase();
const _promptBuilderMap = {
  minimal:  './promptBuilder_minimal',
  seedream: './promptBuilder_seedream',
};
const { buildAllPrompts } = require(_promptBuilderMap[SEEDREAM_MODE] || './promptBuilder');
const { buildFaceswapPrompt } = require('./promptBuilder_faceswap');
console.log(`[Worker] 模式: ${SEEDREAM_MODE}  promptBuilder: ${_promptBuilderMap[SEEDREAM_MODE] || './promptBuilder'}`);
const { generateImage } = require('./seedreamClient');
const { generateNativeImage } = require('./seedreamNativeClient');
const { getTask, updateTask, STATUS } = require('./taskQueue');
const { loadReferenceImage, loadJerseyReferences, loadBeerMugReference, loadCompositionReference, loadBackgroundReference, getPlayerReferenceImages } = require('./assetStore');
const { describeUserAppearance } = require('./visionClient');
const { describeUser }           = require('./userDescriber');
// Seedream 调用重试配置
const SEEDREAM_MAX_RETRIES = 2;
const SEEDREAM_RETRY_DELAYS = [3000, 6000];

// 回调 H5 重试配置
const CALLBACK_MAX_RETRIES = 3;
const CALLBACK_RETRY_DELAYS = [2000, 5000, 10000];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 结果图片本地化：下载到 public/results/ 并返回干净 URL
const RESULTS_DIR = '/www/wwwroot/bayern-fan-photo/server/public/results';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'http://111.229.177.65:3001').replace(/\/+$/, '');

async function localizeResultImage(remoteUrl, taskId) {
  try {
    await fsp.mkdir(RESULTS_DIR, { recursive: true });
    const ext = '.jpg';
    const fileName = `${taskId}${ext}`;
    const localPath = path.join(RESULTS_DIR, fileName);

    const response = await axios.get(remoteUrl, { responseType: 'arraybuffer', timeout: 30000 });
    await fsp.writeFile(localPath, response.data);

    const localUrl = `${PUBLIC_BASE_URL}/public/results/${fileName}`;
    console.log(`[Worker] 图片已本地化: ${localUrl} (${(response.data.length / 1024).toFixed(0)}KB)`);
    return localUrl;
  } catch (err) {
    console.warn(`[Worker] 图片本地化失败，使用原始URL: ${err.message}`);
    return remoteUrl;
  }
}

/**
 * 从视觉模型的外貌描述中提取性别
 * @param {string} description - 视觉模型返回的英文描述
 * @returns {'male'|'female'} 检测到的性别
 */
function extractGenderFromDescription(description) {
  if (!description) return 'male';
  const lower = description.toLowerCase();
  // 优先匹配明确的性别词
  const femaleScore = (lower.match(/\bfemale\b/g) || []).length * 3
    + (lower.match(/\bwoman\b/g) || []).length * 2
    + (lower.match(/\bgirl\b/g) || []).length * 2
    + (lower.match(/\bher\b/g) || []).length
    + (lower.match(/\bshe\b/g) || []).length;
  const maleScore = (lower.match(/\bmale\b/g) || []).length * 3
    + (lower.match(/\bman\b|\bman['']s\b/g) || []).length * 2
    + (lower.match(/\bboy\b/g) || []).length * 2
    + (lower.match(/\bhis\b/g) || []).length
    + (lower.match(/\bhe\b/g) || []).length;
  // female 单词里包含 male，所以 female 权重更高才准确
  if (femaleScore > maleScore) return 'female';
  if (maleScore > 0) return 'male';
  return 'male'; // 默认男性
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
 * 处理换脸任务（Faceswap 模式）
 * Image 1 = template_image（模板合照，保持球星/场景不变）
 * Image 2 = user_images[0]（球迷照，替换人脸来源）
 */
async function processFaceswapTask(taskId, task) {
  const t0 = Date.now();
    const {
      template_image: defaultTemplateImage,
      user_images,
      callback_url,
      size,
      target_person: defaultTargetPerson,
      gender: defaultGender,
      faceswap_templates,
      faceswap_strength,
      faceswap_guidance_scale,
    } = task.params;

  console.log(`[Worker] [faceswap] 开始处理换脸任务: ${taskId}`);
  console.log(`[Worker] [faceswap] 球迷照: ${user_images[0]}`);

  await updateTask(taskId, { status: STATUS.PROCESSING });

  try {
    // ── 步骤1: 视觉模型解析用户外貌（含性别检测）──
    let userDescription = '';
    try {
      userDescription = await describeUserAppearance([user_images[0]]);
      console.log(`[Worker] [faceswap] 用户外貌解析完成: ${userDescription.substring(0, 120)}...`);
    } catch (visionErr) {
      console.warn(`[Worker] [faceswap] 用户外貌解析失败，继续使用强身份 prompt: ${visionErr.message}`);
    }

    // ── 步骤2: 自动性别识别 → 选择男/女模板 ──
    const detectedGender = userDescription ? extractGenderFromDescription(userDescription) : (defaultGender || 'male');
    let template_image = defaultTemplateImage;
    let target_person = defaultTargetPerson;
    let template_type = 'faceswap'; // 默认真实换脸

    if (faceswap_templates && faceswap_templates[detectedGender]) {
      const genderConfig = faceswap_templates[detectedGender];
      template_image    = genderConfig.template_image;
      target_person     = genderConfig.target_person;
      template_type     = genderConfig.template_type || 'faceswap';
      console.log(`[Worker] [faceswap] 性别检测: ${detectedGender} → 使用${detectedGender === 'female' ? '女' : '男'}性模板 (type=${template_type})`);
    } else {
      console.log(`[Worker] [faceswap] 性别检测: ${detectedGender} (无分性别模板，使用默认)`);
    }
    console.log(`[Worker] [faceswap] 模板图: ${template_image}`);

    // 优先使用模板级别的 size/strength/guidance，其次使用任务参数，最后取默认值
    const resolvedSize     = faceswap_templates?.[detectedGender]?.size          || size             || '2048x2560';
    const resolvedStrength = faceswap_templates?.[detectedGender]?.strength      ?? faceswap_strength ?? 0.68;
    const resolvedGuidance = faceswap_templates?.[detectedGender]?.guidance_scale ?? faceswap_guidance_scale ?? 10;

    const { prompt, negative_prompt } = buildFaceswapPrompt({
      targetPerson:  target_person || 'the only person in the image',
      userDescription,
      gender:        detectedGender,
      templateType:  template_type,
    });
    console.log(`[Worker] [faceswap] Prompt: ${prompt.length} 字符 (gender=${detectedGender}, type=${template_type})`);

    const imageResult = await generateNativeImage({
      prompt,
      negative_prompt,
      images: [template_image, user_images[0]],  // Image 1=模板底图, Image 2=球迷人脸参考
      size: resolvedSize,
      scene_params: {
        strength:        resolvedStrength,
        guidance_scale:  resolvedGuidance,
      },
    });

    console.log(`[Worker] [faceswap] 生成成功 (${Date.now() - t0}ms): ${imageResult.url.substring(0, 80)}...`);

    // ── RegionSync 可选后处理 ──────────────────────────────────────────────
    // 默认不激活。当 task.params.enable_region_sync=true 且 region_sync_key 存在时触发。
    // 触发后：以模板图为底图画布，只把 editRegions 区域从生成图贴回，其余区域 100% 来自模板。
    let finalUrl = imageResult.url;
    if (task.params.enable_region_sync && task.params.region_sync_key) {
      try {
        const os   = require('os');
        const fsp  = require('fs').promises;
        const http = require('http');
        const https = require('https');
        const { composeEditRegionsOverBase } = require('./regionComposer');
        const faceswapRegions = require('./data/faceswapRegions.json');
        const regionCfg = faceswapRegions[task.params.region_sync_key];

        if (regionCfg) {
          console.log(`[Worker] [faceswap] RegionSync 启动 key="${task.params.region_sync_key}"...`);

          // 下载模板图和生成图到临时文件
          const tmpDir = os.tmpdir();
          const tmpTemplate  = path.join(tmpDir, `rs_tpl_${taskId}.jpg`);
          const tmpGenerated = path.join(tmpDir, `rs_gen_${taskId}.jpg`);
          const tmpFinal     = path.join(tmpDir, `rs_final_${taskId}.jpg`);

          const downloadTmp = (url, dest) => new Promise((res, rej) => {
            const client = url.startsWith('https') ? https : http;
            const file   = require('fs').createWriteStream(dest);
            client.get(url, r => {
              if (r.statusCode === 301 || r.statusCode === 302) {
                file.close(); require('fs').unlinkSync(dest);
                return downloadTmp(r.headers.location, dest).then(res).catch(rej);
              }
              r.pipe(file);
              file.on('finish', () => { file.close(); res(); });
            }).on('error', rej);
          });

          await downloadTmp(template_image,  tmpTemplate);
          await downloadTmp(imageResult.url, tmpGenerated);

          await composeEditRegionsOverBase({
            sourceImage: tmpTemplate,
            targetImage: tmpGenerated,
            outputImage: tmpFinal,
            regions:     regionCfg.editRegions,
          });

          // 将合成结果路径记录在结果中（生产环境可替换为 OSS 上传逻辑）
          finalUrl = `file://${tmpFinal}`;
          console.log(`[Worker] [faceswap] RegionSync 完成 → ${tmpFinal}`);

          // 清理临时文件（模板和生成图，保留 final）
          await fsp.unlink(tmpTemplate).catch(() => {});
          await fsp.unlink(tmpGenerated).catch(() => {});
        } else {
          console.warn(`[Worker] [faceswap] RegionSync 配置未找到: "${task.params.region_sync_key}"，跳过`);
        }
      } catch (rsErr) {
        // RegionSync 失败时降级使用原始生成图，不中断任务
        console.warn(`[Worker] [faceswap] RegionSync 失败，降级使用原始生成图: ${rsErr.message}`);
        finalUrl = imageResult.url;
      }
    }
    // ── RegionSync 结束 ──────────────────────────────────────────────────

    // ── 图片本地化：下载到我们服务器，给 H5 返回干净 URL ──
    const callbackUrl_image = await localizeResultImage(finalUrl, taskId);

    await updateTask(taskId, {
      status: STATUS.COMPLETED,
      results: [{
        image_url: callbackUrl_image,
        url: callbackUrl_image,
        url_original: imageResult.url,
        urls: imageResult.urls,
        user_description: userDescription,
        region_sync: task.params.enable_region_sync === true,
      }],
    });

    await callbackH5WithRetry(callback_url, {
      task_id: taskId,
      user_image: callbackUrl_image,
    });

    console.log(`[Worker] [faceswap] 任务完成: ${taskId} (总耗时 ${Date.now() - t0}ms)`);
  } catch (err) {
    console.error(`[Worker] [faceswap] 任务失败: ${taskId} (${Date.now() - t0}ms)`, err.message);

    await updateTask(taskId, { status: STATUS.FAILED, error: err.message });

    try {
      await callbackH5WithRetry(callback_url, {
        task_id: taskId,
        status: 'failed',
        error: err.message,
        message: '生成失败，请重试',
      });
    } catch (callbackErr) {
      console.warn(`[Worker] [faceswap] 失败回调发送异常: ${callbackErr.message}`);
    }
  }
}

/**
 * 处理单个合成任务
 */
async function processTask(taskId) {
  const t0 = Date.now();
  const task = await getTask(taskId);
  if (!task) {
    console.error(`[Worker] 任务不存在: ${taskId}`);
    return;
  }

  // Faceswap 模式：独立分支处理
  if (task.params.mode === 'faceswap') {
    return processFaceswapTask(taskId, task);
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

      // 1. 用户外貌描述（调用视觉模型，失败时回退到固定描述）
      const t1 = Date.now();
      console.log(`[Worker] 步骤1: 解读用户照片...`);
      let userDescription;
      try {
        userDescription = await describeUser(resolvedUserImagesNative[0]);
        console.log(`[Worker] 用户描述: ${userDescription.substring(0, 100)}... (${Date.now() - t1}ms)`);
      } catch (visionErr) {
        console.warn(`[Worker] 用户照片解读失败，使用固定描述: ${visionErr.message}`);
        userDescription = 'An adult person whose face, hair, skin tone, build, and ALL facial features exactly match reference image 1. EYE RULE: Reproduce the EXACT same eye size, eye shape, and eye openness as reference image 1 — do NOT make the eyes smaller or narrower. Eyes should be fully open and natural. ONLY add glasses if reference image 1 shows the person wearing glasses.';
      }

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

      // 5. 图片本地化 + 更新任务结果
      const localizedUrl = await localizeResultImage(imageResult.url, taskId);
      await updateTask(taskId, {
        status: STATUS.COMPLETED,
        results: [{
          player_names,
          image_url: localizedUrl,
          urls: imageResult.urls,
          user_description: userDescription,
        }],
      });

      // 6. 回调 H5
      await callbackH5WithRetry(callback_url, {
        task_id: taskId,
        user_image: localizedUrl,
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
