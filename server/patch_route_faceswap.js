const fs = require('fs');
const filePath = process.argv[2] || '/www/wwwroot/bayern-fan-photo/server/src/routes/synthesis.js';
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add createTaskWithMode import if not exists
if (!code.includes("createTaskWithMode")) {
  // We don't need a separate function, just use createTask directly
}

// 2. Insert faceswap route before the query route
const faceswapRoute = `

// ============================================================
// POST /submit-faceswap — faceswap mode
// Only replace fan face, keep everything else from template
// ============================================================
router.post(
  '/submit-faceswap',
  requireApiKey,
  [
    body('template_image').isURL().withMessage('template_image must be a valid URL'),
    body('user_images').isArray({ min: 1, max: 1 }).withMessage('user_images must contain exactly 1 photo'),
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

      const { template_image, user_images, callback_url, size } = req.body;

      const taskId = await createTask({
        params: {
          mode: 'faceswap',
          template_image,
          user_images,
          callback_url: callback_url || DEFAULT_CALLBACK_URL || '',
          size: size || '1024x1024',
        },
      });

      await enqueueTask(taskId);

      console.log('[Route] [faceswap] 任务已创建:', taskId);

      res.json({
        code: 0,
        message: 'success',
        data: {
          task_id: taskId,
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

`;

// Insert before the query route comment
const queryMarker = "/**\n * GET /api/v1/synthesis/query/:taskId";
if (!code.includes('/submit-faceswap')) {
  code = code.replace(queryMarker, faceswapRoute + queryMarker);
  fs.writeFileSync(filePath, code, 'utf8');
  console.log('OK: faceswap route inserted');
} else {
  console.log('SKIP: faceswap route already exists');
}
