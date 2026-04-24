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
      .isArray({ min: 3, max: 3 }).withMessage('必须选择恰好3个球星'),
    body('star_ids.*').custom(value => {
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error('每个球星ID必须是字符串或数字');
      }
      return true;
    }),
    body('scene_id').isString().notEmpty().withMessage('scene_id 必填'),
    body('user_images')
      .isArray({ min: 1, max: 3 }).withMessage('user_images 必填，1-3张用户照片')
      .custom((value) => {
        if (!value.every(v => typeof v === 'string' && v.length > 0)) {
          throw new Error('每张用户照片必须为非空字符串');
        }
        return true;
      }),
    body('user_image').optional().isString(),
    body('user_mode').optional().isIn(['adult']).withMessage('user_mode 仅支持 adult'),
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
      const normalizedStarIds = star_ids.map(normalizePlayerId);
      const invalidStarId = star_ids.find((id, index) => !normalizedStarIds[index]);
      const normalizedSceneId = normalizeSceneId(scene_id);
      const resolvedUserMode = user_mode || DEFAULT_USER_MODE;
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

      // 兼容：user_image 取数组第一张
      const resolvedUserImage = resolvedUserImages[0];

      if (invalidStarId) {
        return res.status(400).json({
          code: 400,
          message: `无效的 star_id: ${invalidStarId}`,
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

      // 校验 star_ids 无重复
      if (new Set(normalizedStarIds).size !== normalizedStarIds.length) {
        return res.status(400).json({
          code: 400,
          message: 'star_ids 中不能有重复的球星',
          data: null,
        });
      }

      if (!['adult'].includes(resolvedUserMode)) {
        return res.status(400).json({
          code: 400,
          message: `默认 user_mode 配置无效: ${resolvedUserMode}`,
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

      const { task_id } = await createTask({
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
      });

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



// ============================================================
// POST /submit-faceswap — faceswap mode
// Only replace fan face, keep everything else from template
// ============================================================
router.post(
  '/submit-faceswap',
  requireApiKey,
  [
    body('template_image').isURL().withMessage('template_image must be a valid URL'),
    body('user_images').isArray({ min: 1, max: 2 }).withMessage('user_images must contain 1-2 photos'),
    body('user_images.*').isURL().withMessage('each user image must be a valid URL'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          code: 400,
          message: '参数错误',
          data: { errors: errors.array() },
        });
      }

      const { template_image, user_images, callback_url, size, scene_id } = req.body;

      const { task_id } = await createTask({
          mode: 'faceswap',
          template_image,
          user_images,
          callback_url: callback_url || DEFAULT_CALLBACK_URL || '',
          size: size || '2048x2560',
          scene_id: scene_id || '',
        });

      await enqueueTask(task_id);

      console.log('[Route] [faceswap] 任务已创建:', task_id);

      res.json({
        code: 0,
        message: 'success',
        data: {
          task_id: task_id,
          status: 'pending',
        },
      });
    } catch (err) {
      console.error('[Route] [faceswap] 创建任务失败:', err.message);
      res.status(500).json({
        code: 500,
        message: '服务器内部错误',
        data: null,
      });
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
