/**
 * 路由：合成接口
 * 包含参数校验、安全加固
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { createTask, getTask, enqueueTask, STATUS } = require('../taskQueue');
const { normalizePlayerId, normalizeSceneId } = require('../assetStore');

const router = express.Router();
const configuredApiKey = (process.env.SERVER_API_KEY || '').trim();
const SERVER_API_KEY = configuredApiKey && configuredApiKey !== 'your_server_api_key_here'
  ? configuredApiKey
  : '';
const DEFAULT_USER_MODE = process.env.DEFAULT_USER_MODE || 'adult';
const DEFAULT_CALLBACK_URL = (process.env.H5_CALLBACK_URL || '').trim();
const SCENE1_ID = 'scene_01';
const DEFAULT_SCENE1_STAR_IDS = (process.env.SCENE1_DEFAULT_STAR_IDS || '101,105,108')
  .split(',').map(id => id.trim()).filter(Boolean);

// ═══ Faceswap 模板映射 ═══
// H5 无需改动，服务端自动将 scene_id 映射为 faceswap 模板
const FACESWAP_BASE_URL = (process.env.FACESWAP_BASE_URL || '').trim()
  || 'http://111.229.177.65:3001/public/faceswap';

// template_type:
//   'mannequin' → 底图中目标位置为空白/模糊占位头，只填入人脸，其余全部锁定
//   'faceswap'  → 底图中目标位置为真实人脸，替换为球迷人脸，其余全部锁定
const FACESWAP_TEMPLATES = {
  '1': {
    male: {
      template_image:  `${FACESWAP_BASE_URL}/scene1-M.png`,
      target_person:   'the only person in the image',
      template_type:   'mannequin',
      size:            '1536x2560',
      strength:        0.35,
      guidance_scale:  10,
    },
    female: {
      template_image:  `${FACESWAP_BASE_URL}/scene1-F.png`,
      target_person:   'the only person in the image',
      template_type:   'mannequin',
      size:            '1536x2560',
      strength:        0.35,
      guidance_scale:  10,
    },
  },
  '2': {
    // 场景2不区分性别，男女均使用同一张底图
    male: {
      template_image:  `${FACESWAP_BASE_URL}/scene2.jpg`,
      target_person:   'the only person in the image',
      template_type:   'mannequin',
      size:            '1536x2560',
      strength:        0.35,
      guidance_scale:  10,
    },
    female: {
      template_image:  `${FACESWAP_BASE_URL}/scene2.jpg`,
      target_person:   'the only person in the image',
      template_type:   'mannequin',
      size:            '1536x2560',
      strength:        0.35,
      guidance_scale:  10,
    },
  },
  // 场景3：待确认底图后补充
  '4': {
    male: {
      template_image:  `${FACESWAP_BASE_URL}/scene4-M.png`,
      target_person:   'the person on the far left',
      template_type:   'faceswap',
      size:            '2560x1536',
      strength:        0.45,
      guidance_scale:  10,
    },
    // 暂无女版底图，先复用男版；女版底图确认后替换 template_image
    female: {
      template_image:  `${FACESWAP_BASE_URL}/scene4-M.png`,
      target_person:   'the person on the far left',
      template_type:   'faceswap',
      size:            '2560x1536',
      strength:        0.45,
      guidance_scale:  10,
    },
  },
};

/**
 * 简易速率限制（基于IP，内存存储）
 * 每IP每分钟最多10次请求
 */
const rateLimiter = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1分钟
const RATE_LIMIT_MAX = 10;

function checkRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!rateLimiter.has(ip)) {
    rateLimiter.set(ip, []);
  }

  const timestamps = rateLimiter.get(ip);
  // 清理过期记录
  const validTimestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
  rateLimiter.set(ip, validTimestamps);

  if (validTimestamps.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({
      code: 429,
      message: '请求过于频繁，请稍后再试',
      data: null,
    });
  }

  validTimestamps.push(now);
  next();
}

/**
 * 校验 HTTP/HTTPS 地址
 */
function isValidHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function requireApiKey(req, res, next) {
  if (!SERVER_API_KEY) {
    return next();
  }

  if (req.get('x-api-key') !== SERVER_API_KEY) {
    return res.status(401).json({
      code: 401,
      message: 'unauthorized',
      data: null,
    });
  }

  next();
}

/**
 * POST /api/v1/synthesis/submit
 * 提交合成任务
 */
router.post(
  '/submit',
  requireApiKey,
  checkRateLimit,
  [
    body('star_ids')
      .optional()
      .isArray({ min: 3, max: 3 }).withMessage('star_ids 必须恰好包含3个球星'),
    body('star_ids.*').optional().custom(value => {
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error('每个球星ID必须是字符串或数字');
      }
      return true;
    }),
    body('scene_id').isString().notEmpty().withMessage('scene_id 必填'),
    body('user_images')
      .optional()
      .isArray({ min: 1, max: 3 }).withMessage('user_images 应为1-3张用户照片数组')
      .custom((value) => {
        if (!value.every(v => typeof v === 'string' && v.length > 0)) {
          throw new Error('每张用户照片必须为非空字符串');
        }
        return true;
      }),
    body('user_image').optional().isString(),
    body().custom((_, { req }) => {
      const hasImages = Array.isArray(req.body.user_images) && req.body.user_images.length > 0;
      const hasImage = typeof req.body.user_image === 'string' && req.body.user_image.length > 0;
      if (!hasImages && !hasImage) {
        throw new Error('user_image 或 user_images 必须提供其中一个');
      }
      return true;
    }),
    body('user_mode').optional().isIn(['adult', 'child']).withMessage('user_mode 必须是 adult 或 child'),
    body('gender').optional().isIn(['male', 'female']).withMessage('gender 必须是 male 或 female'),
    body('callback_url').optional().isString().notEmpty().withMessage('callback_url 不能为空'),
    body('player_images').optional().isArray({ min: 3, max: 3 }).withMessage('player_images 应为3张球星照片'),
    body('pose_image').optional().isString(),
    body('mask_image').optional().isString(),
    body('base_image').optional().isString(),
  ],
  async (req, res) => {
    // 参数校验
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        code: 400,
        message: errors.array()[0].msg,
        data: null,
      });
    }

    try {
      const {
        star_ids, scene_id, user_image, user_images, user_mode, gender, callback_url,
        player_images, pose_image, mask_image, base_image,
      } = req.body;
      const normalizedSceneId = normalizeSceneId(scene_id);
      const resolvedGender = gender || 'male';
      const resolvedCallbackUrl = callback_url || DEFAULT_CALLBACK_URL || null;

      // user_images 为主参数，过滤无效图片
      const resolvedUserImages = (Array.isArray(user_images) && user_images.length > 0)
        ? user_images.filter(img => img && (img.startsWith('data:image/') || isValidHttpUrl(img)))
        : (user_image && (user_image.startsWith('data:image/') || isValidHttpUrl(user_image)))
          ? [user_image]
          : [];

      if (resolvedUserImages.length === 0) {
        return res.status(400).json({
          code: 400,
          message: 'user_images 中无有效图片，需为 Base64 或 URL',
          data: null,
        });
      }

      if (!normalizedSceneId) {
        return res.status(400).json({
          code: 400,
          message: `无效的 scene_id: ${scene_id}`,
          data: null,
        });
      }

      // 校验 callback_url 格式
      if (resolvedCallbackUrl && !isValidHttpUrl(resolvedCallbackUrl)) {
        return res.status(400).json({
          code: 400,
          message: 'callback_url 必须是有效的 HTTP/HTTPS 地址',
          data: null,
        });
      }

      // ── Faceswap 优先：scene_id 有模板则直接走 faceswap，跳过 star_ids 校验 ──
      const sceneNum = normalizedSceneId.replace('scene_', '').replace(/^0+/, '') || '1';
      const faceswapConfig = FACESWAP_TEMPLATES[sceneNum];

      let taskParams;
      if (faceswapConfig) {
        // 传两套模板给 Worker，Worker 根据视觉模型检测的性别自动选择
        const defaultGenderConfig = faceswapConfig[resolvedGender] || faceswapConfig.male;
        console.log(`[Route] [submit] 自动切换 faceswap 模式 (scene=${sceneNum}, default_gender=${resolvedGender})`);
        taskParams = {
          mode: 'faceswap',
          faceswap_scene: sceneNum,
          faceswap_templates: faceswapConfig,
          template_image: defaultGenderConfig.template_image,
          user_images: resolvedUserImages,
          target_person: defaultGenderConfig.target_person,
          gender: resolvedGender,
          callback_url: resolvedCallbackUrl,
        };
      } else {
        // 非 faceswap 模式：校验 star_ids
        const normalizedStarIds = star_ids ? star_ids.map(normalizePlayerId) : [];
        const invalidStarId = star_ids ? star_ids.find((id, index) => !normalizedStarIds[index]) : null;
        const resolvedUserMode = user_mode || DEFAULT_USER_MODE;
        const resolvedUserImage = resolvedUserImages[0];

        if (!star_ids || normalizedStarIds.length !== 3) {
          return res.status(400).json({ code: 400, message: '非 faceswap 场景必须选择恰好3个球星', data: null });
        }
        if (invalidStarId) {
          return res.status(400).json({ code: 400, message: `无效的 star_id: ${invalidStarId}`, data: null });
        }
        if (new Set(normalizedStarIds).size !== normalizedStarIds.length) {
          return res.status(400).json({ code: 400, message: 'star_ids 中不能有重复的球星', data: null });
        }

        taskParams = {
          star_ids: normalizedStarIds,
          scene_id: normalizedSceneId,
          user_image: resolvedUserImage,
          user_images: resolvedUserImages,
          user_mode: resolvedUserMode,
          gender: resolvedGender,
          callback_url: resolvedCallbackUrl,
          player_images,
          pose_image,
          mask_image,
          base_image,
        };
      }

      const { task_id } = await createTask(taskParams);

      await enqueueTask(task_id);

      res.json({
        code: 0,
        message: 'success',
        data: { task_id, status: STATUS.PROCESSING },
      });
    } catch (err) {
      console.error('[Route] 提交任务失败:', err.message);
      res.status(500).json({
        code: 500,
        message: '任务提交失败，请稍后重试',
        data: null,
      });
    }
  }
);

/**
 * POST /api/v1/synthesis/scene1/submit
 * 场景1 专用简化接口：调用方只需传 user_image，球星和场景由服务端固定。
 */
router.post(
  '/scene1/submit',
  requireApiKey,
  checkRateLimit,
  [
    body('user_image').exists({ checkFalsy: true }).withMessage('user_image 必填').bail().isString(),
    body('user_images').optional().isArray({ min: 1, max: 3 }).withMessage('user_images 为1-3张用户照片数组'),
    body('user_images.*').optional().isString().notEmpty(),
    body('star_ids').optional().isArray({ min: 3, max: 3 }).withMessage('star_ids 必须选择恰好3个球星'),
    body('star_ids.*').optional().custom(value => {
      if (typeof value !== 'string' && typeof value !== 'number') throw new Error('每个球星ID必须是字符串或数字');
      return true;
    }),
    body('user_mode').optional().isIn(['adult', 'child']).withMessage('user_mode 必须是 adult 或 child'),
    body('gender').optional().isIn(['male', 'female']).withMessage('gender 必须是 male 或 female'),
    body('callback_url').optional().isString().notEmpty().withMessage('callback_url 不能为空'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 400, message: errors.array()[0].msg, data: null });
    }

    try {
      const { user_image, user_images, star_ids, user_mode, gender, callback_url } = req.body;
      const resolvedStarIds   = star_ids || DEFAULT_SCENE1_STAR_IDS;
      const resolvedUserMode  = user_mode || DEFAULT_USER_MODE;
      const resolvedGender    = gender || 'male';
      const resolvedCallback  = callback_url || DEFAULT_CALLBACK_URL || null;

      if (!isValidHttpUrl(user_image) && !user_image.startsWith('data:image/')) {
        return res.status(400).json({ code: 400, message: 'user_image 格式无效，需为 Base64 或 URL', data: null });
      }
      if (resolvedCallback && !isValidHttpUrl(resolvedCallback)) {
        return res.status(400).json({ code: 400, message: 'callback_url 必须是有效的 HTTP/HTTPS 地址', data: null });
      }

      const normalizedStarIds  = resolvedStarIds.map(normalizePlayerId);
      const normalizedSceneId  = normalizeSceneId(SCENE1_ID);
      const resolvedUserImages = (Array.isArray(user_images) && user_images.length > 0)
        ? user_images.filter(v => v && (v.startsWith('data:image/') || isValidHttpUrl(v)))
        : [user_image];

      // ── Faceswap 自动映射：scene_id → 模板图 + target_person ──
      const sceneNum = normalizedSceneId.replace('scene_', '').replace(/^0+/, '') || '1';
      const faceswapConfig = FACESWAP_TEMPLATES[sceneNum];

      let taskParams;
      if (faceswapConfig) {
        // 使用 faceswap 模式：H5 无感知
        console.log(`[Route] [scene1] 自动切换 faceswap 模式 (scene=${sceneNum})`);
        const defaultGenderConfig1 = faceswapConfig[resolvedGender] || faceswapConfig.male;
        taskParams = {
          mode: 'faceswap',
          faceswap_scene: sceneNum,
          faceswap_templates: faceswapConfig,
          template_image: defaultGenderConfig1.template_image,
          user_images: resolvedUserImages,
          target_person: defaultGenderConfig1.target_person,
          gender: resolvedGender,
          callback_url: resolvedCallback,
        };
      } else {
        // 无模板配置，回退到原有模式
        console.log(`[Route] [scene1] 无 faceswap 模板，使用原有模式 (scene=${sceneNum})`);
        taskParams = {
          star_ids: normalizedStarIds,
          scene_id: normalizedSceneId,
          user_image,
          user_images: resolvedUserImages,
          user_mode: resolvedUserMode,
          gender: resolvedGender,
          callback_url: resolvedCallback,
        };
      }

      const { task_id } = await createTask(taskParams);
      await enqueueTask(task_id);

      res.json({ code: 0, message: 'success', data: { task_id, status: STATUS.PROCESSING } });
    } catch (err) {
      console.error('[Route] 提交场景1任务失败:', err.message);
      res.status(500).json({ code: 500, message: '任务提交失败，请稍后重试', data: null });
    }
  }
);

/**
 * POST /api/v1/synthesis/submit-faceswap
 * 提交换脸任务（Faceswap 模式）
 * - template_image: 固定合照模板图 URL（含球星）
 * - user_images: [球迷照片 URL]（仅需1张）
 */
router.post(
  '/submit-faceswap',
  requireApiKey,
  checkRateLimit,
  [
    body('template_image').isString().notEmpty().withMessage('template_image 必填（模板图URL）'),
    body('user_images')
      .isArray({ min: 1, max: 1 }).withMessage('user_images 必填，且只能传1张球迷照片')
      .custom((value) => {
        if (!value.every(v => typeof v === 'string' && v.length > 0)) {
          throw new Error('user_images 中每张照片必须为非空字符串');
        }
        return true;
      }),
    body('callback_url').optional().isString().notEmpty(),
    body('size').optional().isString(),
    // RegionSync 可选参数（默认不激活，不影响原有行为）
    body('enable_region_sync').optional().isBoolean().withMessage('enable_region_sync 必须是布尔值'),
    body('region_sync_key').optional().isString().notEmpty().withMessage('region_sync_key 必须是非空字符串'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ code: 400, message: errors.array()[0].msg, data: null });
    }

    try {
      const { template_image, user_images, callback_url, size,
              enable_region_sync, region_sync_key } = req.body;

      if (!isValidHttpUrl(template_image)) {
        return res.status(400).json({ code: 400, message: 'template_image 必须是有效的 HTTP/HTTPS 地址', data: null });
      }

      if (!isValidHttpUrl(user_images[0])) {
        return res.status(400).json({ code: 400, message: 'user_images[0] 必须是有效的 HTTP/HTTPS 地址', data: null });
      }

      const resolvedCallbackUrl = callback_url || DEFAULT_CALLBACK_URL || null;
      if (resolvedCallbackUrl && !isValidHttpUrl(resolvedCallbackUrl)) {
        return res.status(400).json({ code: 400, message: 'callback_url 必须是有效的 HTTP/HTTPS 地址', data: null });
      }

      // enable_region_sync=true 时必须同时提供 region_sync_key
      if (enable_region_sync === true && !region_sync_key) {
        return res.status(400).json({ code: 400, message: 'enable_region_sync=true 时必须提供 region_sync_key', data: null });
      }

      const { task_id } = await createTask({
        mode: 'faceswap',
        template_image,
        user_images,
        callback_url: resolvedCallbackUrl,
        size: size || null,
        // RegionSync 参数透传给 Worker（未传时为 undefined，Worker 侧不激活）
        enable_region_sync: enable_region_sync === true ? true : undefined,
        region_sync_key:    region_sync_key || undefined,
      });

      await enqueueTask(task_id);

      res.json({ code: 0, message: 'success', data: { task_id, status: 'processing' } });
    } catch (err) {
      console.error('[Route] 提交 faceswap 任务失败:', err.message);
      res.status(500).json({ code: 500, message: '任务提交失败，请稍后重试', data: null });
    }
  }
);

/**
 * GET /api/v1/synthesis/query/:taskId
 * 查询任务状态
 */
router.get('/query/:taskId', requireApiKey, async (req, res) => {
  try {
    const task = await getTask(req.params.taskId);
    if (!task) {
      return res.status(404).json({
        code: 404,
        message: '任务不存在',
        data: null,
      });
    }

    res.json({
      code: 0,
      message: 'success',
      data: {
        task_id: task.task_id,
        status: task.status,
        results: task.status === STATUS.COMPLETED ? task.results : [],
        error: task.error,
        retryable: task.status === STATUS.FAILED,
        message: task.status === STATUS.FAILED ? '生成失败，请重试' : undefined,
      },
    });
  } catch (err) {
    console.error('[Route] 查询任务失败:', err.message);
    res.status(500).json({
      code: 500,
      message: '任务查询失败，请稍后重试',
      data: null,
    });
  }
});

module.exports = router;
