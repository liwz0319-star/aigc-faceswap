/**
 * 全场景换脸批量测试脚本（场景1 + 场景2 + 场景4）
 *
 * 场景1/2：Inpainting Mask 模式
 *   - 精准椭圆 mask，API 仅改 mask 白色区域
 *   - 额外做 post-composite：把原始底图背景按像素强制贴回，100% 锁定背景
 *   - 输出尺寸 2048x2560（与底图宽高比接近，避免拉伸失真）
 *
 * 场景4：Faceswap 提示词模式（strength=0.45，已验证背景稳定）
 *   - 替换最左侧真实人脸
 *   - 输出尺寸 2560x1536（横版）
 *
 * Mask 坐标（基于原始底图像素，buildMask 自动缩放到 API 输出尺寸）：
 *   场景1男（1854×2304）: cx=1090, cy=820, rx=100, ry=125
 *   场景1女（1854×2304）: cx=1090, cy=820, rx= 95, ry=135
 *   场景2  （1696×2120）: cx=1010, cy=180, rx=130, ry=150
 *
 * 用法：
 *   node test-faceswap-inpaint-scenes.js photo1.jpg photo2.jpg
 *   node test-faceswap-inpaint-scenes.js photo.jpg --scene 1,2
 *   node test-faceswap-inpaint-scenes.js photo.jpg --gender female
 */

const fs   = require('fs');
const path = require('path');

// ── 环境初始化 ────────────────────────────────────────────────
const SERVER_DIR = path.join(__dirname, 'server');

fs.readFileSync(path.join(SERVER_DIR, '.env'), 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});
if (!process.env.VISION_API_KEY && process.env.SEEDREAM_NATIVE_API_KEY) {
  process.env.VISION_API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
}
require('module').Module.globalPaths.push(path.join(SERVER_DIR, 'node_modules'));

const sharp = require(path.join(SERVER_DIR, 'node_modules', 'sharp'));
const axios = require(path.join(SERVER_DIR, 'node_modules', 'axios'));
const { describeUserAppearance } = require('./server/src/visionClient');
const { buildFaceswapPrompt }    = require('./server/src/promptBuilder_faceswap');
const { generateNativeImage }    = require('./server/src/seedreamNativeClient');

// ── 配置 ──────────────────────────────────────────────────────
const TEMPLATE_DIR = path.join(__dirname, '素材', '新场景底图');
const OUTPUT_DIR   = path.join(__dirname, '生成测试', 'inpaint_output');

const API_URL = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
const MODEL   = process.env.SEEDREAM_NATIVE_MODEL   || 'doubao-seedream-4-5-251128';

const DEFAULT_PHOTOS = [
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/1.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/2c53f3a8dc145eb8c27508d295e0debd.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/9dc96094e00c595a6395bf0c683401d5.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/394643d89fde950301c986251894d683.jpg',
  'f:/AAA Work/AIproject/demo/球星球迷合照/生成测试/照片/image.png',
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/*
 * Legacy inline scene config block.
 * Runtime now loads scene configs from ./scene-configs so each scene can be tuned independently.
 */
if (false) {
// Inpaint prompt controls are isolated by profile so scene1/4 can be tuned
// independently without perturbing scene2/3.
const INPAINT_CONTROL_PROFILES = {
  default: {
    taskLine: 'Task: Replace ONLY the head and neck area inside the white mask region with the person from Image 2.',
    promptLines: [],
    negativeTerms: [],
  },
  scene1_portrait: {
    taskLine: 'Task: Perform a photorealistic head swap. Replace the entire placeholder head and upper neck inside the white mask region with the person from Image 2.',
    promptLines: [
      '● Head swap framing: Replace the full placeholder head from crown to chin, not just the center face.',
      '  Keep the full forehead, both cheeks, jawline, and chin visible inside the replacement area.',
      '● Torso protection: Do NOT generate skin, facial texture, eyes, nose, lips, or hair on the jersey, chest, shoulders, or beer glass area.',
      '● Skin transition: Keep the face skin tone close to the neck and body skin tone in Image 1, with a natural transition from jaw to neck.',
      '● Center lock: Keep the nose centered on the placeholder neck axis. Do NOT slide the face left or right.',
      '● Background lock: The blue locker background must stay identical to Image 1 and the head edge must blend softly into it.',
      '● Head size lock: Match the original player head size in Image 1. Do NOT make the head oversized relative to the shoulders or torso.',
      '● Realism lock: The face must remain a real photographic human face. No cartoon, no CGI, no doll-like stylization, and no oversized eyes.',
    ],
    negativeTerms: [
      'face texture on jersey', 'facial features on torso', 'eyes on clothing', 'mouth on shirt', 'hair on chest',
      'blank mannequin face', 'featureless head', 'blue mannequin skin', 'unfinished head',
      'half face', 'side-clipped face', 'cropped forehead', 'cropped chin', 'off-center face',
      'dark head hole', 'black face void', 'featureless dark head',
      'cartoon face', 'anime face', 'cgi face', '3d render face', 'doll face', 'toy face', 'oversized eyes', 'plastic skin',
    ],
  },
  scene4_festival: {
    taskLine: 'Task: Perform a photorealistic head swap. Replace the full placeholder head and upper neck inside the white mask region with the person from Image 2 for a natural outdoor festival group portrait.',
    promptLines: [
      '● Jaw completion: The full lower face must be fully generated, including nose base, lips, chin, jawline, and the front of the neck.',
      '● No mannequin carry-over: Do NOT leave any mannequin skin, blank mannequin texture, or melted placeholder surface under the mouth or around the chin.',
      '● Festival portrait fit: Keep the head naturally sized for the group photo and slightly smaller than the current placeholder width if needed.',
      '● Hair edge quality: Keep the hairline and outer hair edges clean and natural, with no dark halo, soot-like fringe, or muddy edge glow.',
      '● Placeholder coverage: Fully cover the blank placeholder head from ear to ear. Do NOT leave any visible placeholder edge on the left or right side.',
      '● Single-head rule: Generate exactly one aligned head centered on the placeholder neck. Do NOT create a second face beside the placeholder.',
      '● Background blend: Preserve the original sky and tree colors from Image 1 and blend the head edge naturally into the background.',
      '● Head size lock: Match the original footballer head size in Image 1. The inserted head must stay proportional to the shoulders and torso.',
      '● Realism lock: The face must remain a real photographic human face. No cartoon, no CGI, no doll-like stylization, and no oversized eyes.',
    ],
    negativeTerms: [
      'missing chin', 'melted lower face', 'blank mannequin neck', 'placeholder skin', 'unfinished jawline',
      'dark halo around hair', 'black fringe around hairline', 'muddy hair edge',
      'double face', 'duplicate face', 'adjacent face', 'offset face', 'residual mannequin head',
      'oversized head', 'giant head', 'tiny body large head',
      'rectangular crop edge', 'visible box edge', 'background patch edge',
      'cartoon face', 'anime face', 'cgi face', '3d render face', 'doll face', 'toy face', 'oversized eyes', 'plastic skin',
    ],
  },
};

/**
 * 场景配置
 *
 * mode='inpaint'：使用 mask_image，后期 post-composite 保证背景锁定
 *   size    : API 输出尺寸（与底图宽高比接近）
 *   mask    : 椭圆坐标（基于原始底图像素空间，buildMask 自动缩放）
 *   guidance: guidance_scale（1~10）
 *
 * mode='faceswap'：使用 prompt 换脸，strength 控制保留程度
 *   targetPerson : 目标描述
 *   templateType : 'mannequin' | 'faceswap'
 *   strength     : 0~1（越低背景越稳定）
 */
// mask 格式：
//   椭圆 { cx, cy, rx, ry } — 发给 API 的精确 mask，坐标经过视觉校准
//   矩形 { cx, cy, w, h }   — 场景2专用（模板为真实人体，矩形效果更好）
// post-composite 统一使用羽化矩形（由 buildMask 自动从椭圆/矩形扩展得出）
const SCENE_CONFIGS = {
  '1': {
    male: {
      file: '场景1男.jpg', label: '场景1男（更衣室）',
      mode: 'inpaint', size: '2048x2560', guidance: 10,
      controlProfile: 'scene1_portrait',
      refScale: 0.39, refAnchor: 'north', refOffsetY: 0.16,
      extraPromptLines: [
        '● Head swap framing: Replace the whole mannequin head area, including crown, forehead, cheeks, mouth, jawline, and chin.',
        '● Neck blend: Keep a natural transition from the lower jaw into the neck opening above the jersey collar.',
        '● Size reference: Keep the final head close to the original player head size, not larger.',
      ],
      extraNegativeTerms: [
        'face texture on jersey', 'facial features on torso', 'eyes on clothing', 'mouth on shirt', 'hair on chest',
        'half face', 'side-clipped face', 'cropped forehead', 'cropped chin',
        'dark head hole', 'black face void',
        'cartoon face', 'anime face', 'cgi face', 'doll face', 'oversized eyes',
      ],
      // Scene 1 uses a rectangular head-swap window to give the model more room than
      // a tight ellipse while still locking jersey/body pixels in post-composite.
      mask: {
        cx: 1140, cy: 844, w: 168, h: 276,
        apiCx: 1140, apiCy: 842, apiW: 154, apiH: 252,
        compCx: 1140, compCy: 846, compW: 194, compH: 304,
        compSolidTopH: 112,
        compSolidTopInset: 18,
        compFeather: 18,
      },
    },
    female: {
      file: '场景1女.jpg', label: '场景1女（更衣室）',
      mode: 'inpaint', size: '2048x2560', guidance: 10,
      controlProfile: 'scene1_portrait',
      refScale: 0.37, refAnchor: 'north', refOffsetY: 0.16,
      extraPromptLines: [
        '● Head swap framing: Replace the whole mannequin head area, including crown, forehead, cheeks, mouth, jawline, and chin.',
        '● Neck blend: Keep a natural transition from the lower jaw into the neck opening above the jersey collar.',
        '● Size reference: Keep the final head close to the original player head size, not larger.',
      ],
      extraNegativeTerms: [
        'face texture on jersey', 'facial features on torso', 'eyes on clothing', 'mouth on shirt', 'hair on chest',
        'half face', 'side-clipped face', 'cropped forehead', 'cropped chin',
        'dark head hole', 'black face void',
        'cartoon face', 'anime face', 'cgi face', 'doll face', 'oversized eyes',
      ],
      mask: {
        cx: 1140, cy: 846, w: 164, h: 282,
        apiCx: 1140, apiCy: 844, apiW: 150, apiH: 258,
        compCx: 1140, compCy: 848, compW: 190, compH: 310,
        compSolidTopH: 116,
        compSolidTopInset: 18,
        compFeather: 18,
      },
    },
  },
  '2': {
    male: {
      file: '场景2.png', label: '场景2（球场举旗）',
      mode: 'inpaint', size: '2048x2560', guidance: 10,
      // 新底图：API 只改头颈小区域，composite 略放大用于边缘融合，避免衣服/旗子被 AI 重画
      mask: {
        cx: 360, cy: 174, w: 162, h: 236,
        apiCx: 360, apiCy: 158, apiW: 128, apiH: 228,
        compCx: 360, compCy: 174, compW: 162, compH: 236,
        compSolidTopH: 68,
      },
    },
    female: {
      file: '场景2.png', label: '场景2（球场举旗）',
      mode: 'inpaint', size: '2048x2560', guidance: 10,
      mask: {
        cx: 360, cy: 174, w: 162, h: 236,
        apiCx: 360, apiCy: 158, apiW: 128, apiH: 228,
        compCx: 360, compCy: 174, compW: 162, compH: 236,
        compSolidTopH: 68,
      },
    },
  },
  '3': {
    male: {
      file: '场景3.jpg', label: '场景3（通道举9号球衣）',
      mode: 'inpaint', size: '2560x1536', guidance: 10,
      refScale: 0.49, refAnchor: 'north',
      extraPromptLines: [
        '● Full crown visibility: Keep the entire top hair, crown, and upper hair volume fully visible above the forehead.',
        '● Hair solidity: Hair at the top of the head must be dense, opaque, and well-defined. No translucent top hair and no faded crown.',
        '● Jersey clearance: Keep the chin and jawline clearly separated above the top edge of the jersey.',
      ],
      extraNegativeTerms: [
        'faded crown', 'translucent top hair', 'missing top hair', 'cropped crown', 'face too large for template',
      ],
      // New scene3 template leaves more headroom above the placeholder, so keep the head slightly taller but not wider.
      mask: {
        cx: 934, cy: 288, w: 208, h: 366,
        apiCx: 934, apiCy: 276, apiW: 182, apiH: 336,
        compCx: 934, compCy: 286, compW: 220, compH: 388,
        compSolidTopH: 108,
        compSolidTopInset: 14,
      },
    },
    female: {
      file: '场景3.jpg', label: '场景3（通道举9号球衣）',
      mode: 'inpaint', size: '2560x1536', guidance: 10,
      refScale: 0.36, refAnchor: 'north', refOffsetY: 0.08,
      extraPromptLines: [
        '● Full crown visibility: Keep the entire top hair, crown, and upper hair volume fully visible above the forehead.',
        '● Hair solidity: Hair at the top of the head must be dense, opaque, and well-defined. No translucent top hair and no faded crown.',
        '● Female head scale: Keep the female head slightly smaller inside the placeholder so the full hair silhouette, temples, cheeks, jawline, and chin fit naturally.',
        '● Jersey clearance: Keep the chin and jawline clearly separated above the top edge of the jersey.',
      ],
      extraNegativeTerms: [
        'oversized female head', 'faded crown', 'translucent top hair', 'missing top hair', 'cropped crown',
      ],
      mask: {
        cx: 934, cy: 284, w: 194, h: 370,
        apiCx: 934, apiCy: 270, apiW: 168, apiH: 352,
        compCx: 934, compCy: 280, compW: 204, compH: 382,
        compSolidTopH: 126,
        compSolidTopInset: 22,
        compFeather: 14,
      },
    },
  },
  '4': {
    male: {
      file: '场景4男.png', label: '场景4男（啤酒节，替换最左）',
      mode: 'inpaint', size: '2560x1536', guidance: 10,
      controlProfile: 'scene4_festival',
      refScale: 0.68, refAnchor: 'north', refOffsetY: 0.08,
      extraPromptLines: [
        '● Placeholder coverage: Completely replace the left placeholder head, including the left rim and right rim of the blank head.',
        '● Single-head rule: Keep only one face aligned to the placeholder neck. No adjacent second face and no leftover mannequin silhouette.',
        '● Head size lock: Keep the inserted head modest and proportional to the shoulders and torso. Do NOT enlarge the head to fill the whole mask.',
        '● Keep head small enough to match the original player head size in the group photo.',
      ],
      extraNegativeTerms: [
        'double face', 'duplicate face', 'adjacent face', 'offset face', 'residual mannequin head',
        'oversized head', 'giant head', 'big face small body',
        'rectangular crop edge', 'visible box edge', 'background patch edge',
      ],
      // Scene 4 switches to a rectangular head-swap window to better cover the
      // placeholder while keeping a smaller, more proportional generated head.
      mask: {
        cx: 72, cy: 126, w: 60, h: 90,
        apiCx: 71, apiCy: 126, apiW: 58, apiH: 88,
        compCx: 71, compCy: 126, compW: 68, compH: 104,
        compSolidTopH: 12,
        compSolidTopInset: 8,
        compFeather: 10,
      },
    },
    female: {
      file: '场景4女.png', label: '场景4女（啤酒节，替换最左）',
      mode: 'inpaint', size: '2560x1536', guidance: 10,
      controlProfile: 'scene4_festival',
      refScale: 0.60, refAnchor: 'north', refOffsetY: 0.08,
      extraPromptLines: [
        '● Jaw completion: The full lower face must be fully generated, including nose base, lips, chin, jawline, and the front of the neck.',
        '● No mannequin carry-over: Do NOT leave any mannequin skin, blank mannequin texture, or melted placeholder surface under the mouth or around the chin.',
        '● Festival portrait fit: Keep the head naturally sized for the group photo and do not overfill the available head region.',
        '● Placeholder coverage: Completely replace the left placeholder head, including the left rim and right rim of the blank head.',
        '● Single-head rule: Keep only one face aligned to the placeholder neck. No adjacent second face and no leftover mannequin silhouette.',
        '● Head size lock: Keep the inserted head modest and proportional to the shoulders and torso. Do NOT enlarge the head to fill the whole mask.',
        '● Keep the female head the same size as the original player head in Image 1, not larger.',
      ],
      extraNegativeTerms: [
        'missing chin', 'melted lower face', 'blank mannequin neck', 'placeholder skin', 'unfinished jawline',
        'double face', 'duplicate face', 'adjacent face', 'offset face', 'residual mannequin head',
        'oversized head', 'giant head', 'big face small body',
        'rectangular crop edge', 'visible box edge', 'background patch edge',
      ],
      mask: {
        cx: 82, cy: 96, w: 58, h: 94,
        apiCx: 81, apiCy: 98, apiW: 56, apiH: 92,
        compCx: 81, compCy: 100, compW: 72, compH: 112,
        compSolidTopH: 12,
        compSolidTopInset: 8,
        compFeather: 10,
      },
    },
  },
};

// ── 工具函数 ──────────────────────────────────────────────────
Object.assign(SCENE_CONFIGS['3'].female, {
  refScale: 0.36,
  refOffsetY: 0.08,
  extraPromptLines: [
    'Full crown visibility: Keep the entire top hair, crown, and upper hair volume fully visible above the forehead.',
    'Hair solidity: Hair at the top of the head must be dense, opaque, and well-defined. No translucent top hair and no faded crown.',
    'Female head scale: Keep the female head slightly smaller inside the placeholder so the full hair silhouette, temples, cheeks, jawline, and chin fit naturally.',
    'Jersey clearance: Keep the chin and jawline clearly separated above the top edge of the jersey.',
    'Long-hair routing: If the person in Image 2 has medium or long hair, let the side hair fall naturally behind the shoulders and upper back of Image 1.',
    'Do NOT drape long hair across the front of the jersey or over the center chest area.',
    'Shoulder clearance: Keep the front neckline and upper chest of the jersey clean and unobstructed. Any longer side hair should stay near the outer shoulder line or behind it.',
    'Shoulder integrity: Keep the original shoulder line and jersey shoulder seam from Image 1 clean and single. No duplicate shoulder edge, no ghost shoulder, and no second neck or hair shadow on the shoulders.',
  ],
  extraNegativeTerms: [
    'oversized female head', 'faded crown', 'translucent top hair', 'missing top hair', 'cropped crown',
    'long hair over front jersey', 'hair across chest', 'hair covering shirt collar', 'front-draped hair curtain',
    'ghost shoulder', 'duplicate shoulder edge', 'double shoulder line', 'bald crown', 'flat top hair',
  ],
});
}

const { INPAINT_CONTROL_PROFILES, SCENE_CONFIGS } = require('./scene-configs');

function toBase64DataUrl(filePath) {
  const p   = filePath.replace(/\\/g, '/');
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
             : ext === 'png' ? 'image/png' : `image/${ext}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function resolveReferenceCropRect(canvasW, canvasH, crop = null) {
  if (!crop) return null;

  const cropW = Math.max(1, Math.min(canvasW, Math.round(canvasW * clamp(crop.width ?? 1, 0.1, 1))));
  const cropH = Math.max(1, Math.min(canvasH, Math.round(canvasH * clamp(crop.height ?? 1, 0.1, 1))));
  const cropOffsetX = typeof crop.offsetX === 'number' ? crop.offsetX : 0.5;
  const cropOffsetY = typeof crop.offsetY === 'number'
    ? crop.offsetY
    : crop.anchor === 'north'
    ? 0
    : 0.5;

  return {
    left: Math.round(clamp((canvasW - cropW) * cropOffsetX, 0, Math.max(0, canvasW - cropW))),
    top: Math.round(clamp((canvasH - cropH) * cropOffsetY, 0, Math.max(0, canvasH - cropH))),
    width: cropW,
    height: cropH,
  };
}

async function buildReferenceSubjectBuffer(input, canvasW, canvasH, scale = 1, crop = null) {
  const resolvedScale = (!scale || scale >= 0.999) ? 1 : scale;
  if (!crop && resolvedScale >= 0.999) return input;

  const cropRect = resolveReferenceCropRect(canvasW, canvasH, crop);
  const subject = cropRect
    ? await sharp(input).extract(cropRect).toBuffer()
    : input;

  if (cropRect) {
    const boxW = Math.max(1, Math.round(canvasW * resolvedScale));
    const boxH = Math.max(1, Math.round(canvasH * resolvedScale));
    return sharp(subject)
      .resize(boxW, boxH, { fit: 'inside' })
      .toBuffer();
  }

  const innerW = Math.max(1, Math.round(canvasW * resolvedScale));
  const innerH = Math.max(1, Math.round(canvasH * resolvedScale));
  return sharp(subject)
    .resize(innerW, innerH, { fit: 'fill' })
    .toBuffer();
}

async function toScaledReferenceDataUrl(filePath, scale = 1, anchor = 'center', offsetX = 0.5, offsetY = null, crop = null) {
  if ((!scale || scale >= 0.999) && !crop) return toBase64DataUrl(filePath);

  const p = filePath.replace(/\\/g, '/');
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
             : ext === 'png' ? 'image/png' : `image/${ext}`;
  const input = fs.readFileSync(p);
  const meta = await sharp(input).metadata();
  const canvasW = meta.width || 1024;
  const canvasH = meta.height || 1024;
  const scaled = await buildReferenceSubjectBuffer(input, canvasW, canvasH, scale, crop);
  const scaledMeta = await sharp(scaled).metadata();
  const innerW = scaledMeta.width || canvasW;
  const innerH = scaledMeta.height || canvasH;

  const remainingW = Math.max(0, canvasW - innerW);
  const remainingH = Math.max(0, canvasH - innerH);
  const resolvedOffsetX = typeof offsetX === 'number' ? offsetX : 0.5;
  const resolvedOffsetY = typeof offsetY === 'number'
    ? offsetY
    : anchor === 'north'
    ? 0.12
    : 0.5;
  const left = Math.round(clamp(remainingW * resolvedOffsetX, 0, remainingW));
  const top = Math.round(clamp(remainingH * resolvedOffsetY, 0, remainingH));

  const out = await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: scaled, left, top }])
    .jpeg({ quality: 95 })
    .toBuffer();

  return `data:${mime};base64,${out.toString('base64')}`;
}

async function hasFlatLightBorder(filePath) {
  const p = filePath.replace(/\\/g, '/');
  const input = fs.readFileSync(p);
  const { data, info } = await sharp(input)
    .resize(96, 96, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width || 96;
  const height = info.height || 96;
  const border = Math.max(6, Math.round(Math.min(width, height) * 0.12));
  let count = 0;
  let sum = 0;
  let sumSq = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = x < border || x >= width - border || y < border || y >= height - border;
      if (!isBorder) continue;
      const idx = (y * width + x) * 3;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = (r + g + b) / 3;
      sum += lum;
      sumSq += lum * lum;
      count++;
    }
  }

  if (!count) return false;
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  const stdev = Math.sqrt(variance);
  return mean >= 220 && stdev <= 18;
}

async function toSoftOvalReferenceDataUrl(filePath, scale = 1, anchor = 'center', offsetX = 0.5, offsetY = null, crop = null) {
  const p = filePath.replace(/\\/g, '/');
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
             : ext === 'png' ? 'image/png' : `image/${ext}`;
  const input = fs.readFileSync(p);
  const meta = await sharp(input).metadata();
  const canvasW = meta.width || 1024;
  const canvasH = meta.height || 1024;
  const scaled = await buildReferenceSubjectBuffer(input, canvasW, canvasH, scale, crop);
  const scaledMeta = await sharp(scaled).metadata();
  const innerW = scaledMeta.width || canvasW;
  const innerH = scaledMeta.height || canvasH;
  const scaledWithAlpha = await sharp(scaled)
    .ensureAlpha()
    .toBuffer();

  const remainingW = Math.max(0, canvasW - innerW);
  const remainingH = Math.max(0, canvasH - innerH);
  const resolvedOffsetX = typeof offsetX === 'number' ? offsetX : 0.5;
  const resolvedOffsetY = typeof offsetY === 'number'
    ? offsetY
    : anchor === 'north'
    ? 0.12
    : 0.5;
  const left = Math.round(clamp(remainingW * resolvedOffsetX, 0, remainingW));
  const top = Math.round(clamp(remainingH * resolvedOffsetY, 0, remainingH));

  const rx = Math.max(1, Math.round(innerW * 0.42));
  const ry = Math.max(1, Math.round(innerH * 0.46));
  const cy = Math.round(innerH * 0.46);
  const feather = Math.max(10, Math.round(Math.min(innerW, innerH) * 0.035));
  const ovalSvg = `<svg width="${innerW}" height="${innerH}">` +
    `<ellipse cx="${Math.round(innerW / 2)}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"/>` +
    `</svg>`;
  const ovalMask = await sharp({
    create: {
      width: innerW,
      height: innerH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: Buffer.from(ovalSvg), blend: 'over' }])
    .blur(feather)
    .png()
    .toBuffer();

  const softened = await sharp(scaledWithAlpha)
    .composite([{ input: ovalMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const out = await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: softened, left, top }])
    .jpeg({ quality: 95 })
    .toBuffer();

  return `data:${mime};base64,${out.toString('base64')}`;
}

function normalizeReferenceCropEntries(conf) {
  if (Array.isArray(conf.refCropCandidates) && conf.refCropCandidates.length > 0) {
    return conf.refCropCandidates.map(entry => {
      if (!entry || !entry.crop) return { label: 'full', crop: null };
      return { label: entry.label || 'crop', crop: entry.crop };
    });
  }
  return [{ label: conf.refCrop ? 'crop' : 'full', crop: conf.refCrop || null }];
}

function formatReferenceVariantLabel(baseLabel, cropLabel, softOval) {
  const parts = [baseLabel];
  if (cropLabel && cropLabel !== 'full') parts.push(cropLabel);
  if (softOval) parts.push('soft-oval');
  return parts.join('+');
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const https = require('https'), http = require('http');
    const client = url.startsWith('https') ? https : http;
    const file   = fs.createWriteStream(dest);
    client.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { try { fs.unlinkSync(dest); } catch(_){} reject(err); });
  });
}

function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    const https = require('https'), http = require('http');
    const client = url.startsWith('https') ? https : http;
    const chunks = [];
    client.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadToBuffer(res.headers.location).then(resolve).catch(reject);
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseCliArgs(argv) {
  const opts = { photos: [], gender: null, scenes: null, outdir: null };
  const pos  = [];
  for (let i = 0; i < argv.length; i++) {
    if      (argv[i] === '--gender') { opts.gender = argv[++i] || null; }
    else if (argv[i] === '--scene')  { opts.scenes = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean); }
    else if (argv[i] === '--outdir') { opts.outdir = argv[++i] || null; }
    else if (!argv[i].startsWith('--')) { pos.push(argv[i]); }
  }
  opts.photos = pos.length > 0 ? pos : DEFAULT_PHOTOS;
  return opts;
}

async function detectGender(userBase64) {
  const key = process.env.VISION_API_KEY;
  if (!key) return 'male';
  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  try {
    const res = await axios.post(url, {
      model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: userBase64 } },
        { type: 'text', text: 'Look at this person. Reply ONLY one word: "male", "female", or "unknown".' },
      ]}],
      max_tokens: 10, temperature: 0.1,
    }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 15000 });
    const answer = (res.data?.choices?.[0]?.message?.content || '').trim().toLowerCase();
    if (answer.includes('female')) return 'female';
    if (answer.includes('male'))   return 'male';
  } catch (e) { /* 失败默认男性 */ }
  return 'male';
}

async function validateHeadSwapResult(resultBase64, sceneLabel, targetPerson = 'the main swapped person', extraRule = '') {
  const key = process.env.VISION_API_KEY;
  if (!key) return { ok: true, skipped: true, reason: 'no_vision_key' };

  const url = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  try {
    const res = await axios.post(url, {
      model: process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: resultBase64 } },
        {
          type: 'text',
          text:
            `Validate this head-swap result for ${sceneLabel}. ` +
            `Look only at ${targetPerson}. ` +
            'Reply ONLY PASS if there is exactly one complete, realistic, visible human head and face attached naturally to the existing scene body, and only the head, hair, ears, and neck area were replaced. ' +
            'Reply ONLY FAIL if the head is missing, blank, replaced by a dark block, mannequin patch, or if source-photo clothing, chest, shoulders, arms, hands, or source background were copied into the scene. ' +
            extraRule
        },
      ]}],
      max_tokens: 4,
      temperature: 0,
    }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 20000 });

    const answer = (res.data?.choices?.[0]?.message?.content || '').trim().toUpperCase();
    if (answer.includes('FAIL')) return { ok: false, reason: answer || 'FAIL' };
    if (answer.includes('PASS')) return { ok: true, reason: answer };
    return { ok: true, skipped: true, reason: `unparsed:${answer}` };
  } catch (e) {
    console.warn(`  [validator] 跳过结果校验: ${e.message}`);
    return { ok: true, skipped: true, reason: e.message };
  }
}

async function buildReferenceVariants(photoPath, conf, originalUserBase64) {
  const candidates = Array.isArray(conf.refScaleCandidates) && conf.refScaleCandidates.length > 0
    ? conf.refScaleCandidates
    : [conf.refScale ?? 1];
  const cropEntries = normalizeReferenceCropEntries(conf);
  const useSoftOval = Boolean(conf.refSoftOvalOnFlatBackground);
  const alwaysSoftOval = Boolean(conf.refAlwaysSoftOval);
  const hasLightFlatBorder = useSoftOval && !alwaysSoftOval ? await hasFlatLightBorder(photoPath) : false;

  const variants = [];
  const seen = new Set();
  for (const cropEntry of cropEntries) {
    for (const rawScale of candidates) {
      const scale = (!rawScale || rawScale >= 0.999) ? 1 : Number(rawScale);
      const key = scale >= 0.999 ? '1.000' : scale.toFixed(3);
      const cropKey = JSON.stringify(cropEntry.crop || null);
      const baseLabel = scale >= 0.999 ? 'original' : `scale=${key}`;
      if (alwaysSoftOval || hasLightFlatBorder) {
        const softKey = `${key}:${cropKey}:soft`;
        if (!seen.has(softKey)) {
          seen.add(softKey);
          variants.push({
            label: formatReferenceVariantLabel(baseLabel, cropEntry.label, true),
            scale,
            base64: await toSoftOvalReferenceDataUrl(
              photoPath,
              scale,
              conf.refAnchor || 'center',
              conf.refOffsetX ?? 0.5,
              conf.refOffsetY,
              cropEntry.crop
            ),
          });
        }
      }

      const plainKey = `${key}:${cropKey}:plain`;
      if (seen.has(plainKey)) continue;
      seen.add(plainKey);

      variants.push({
        label: formatReferenceVariantLabel(baseLabel, cropEntry.label, false),
        scale,
        base64: scale >= 0.999 && !cropEntry.crop
          ? originalUserBase64
          : await toScaledReferenceDataUrl(
              photoPath,
              scale,
              conf.refAnchor || 'center',
              conf.refOffsetX ?? 0.5,
              conf.refOffsetY,
              cropEntry.crop
            ),
      });
    }
  }

  if (conf.includeOriginalReferenceFallback && !seen.has('1.000:null:plain')) {
    variants.push({ label: 'original', scale: 1, base64: originalUserBase64 });
  }

  return variants;
}

/**
 * 生成椭圆 inpainting mask（白色=换脸区域，黑色=保留区域）
 * 坐标基于原始底图像素，自动缩放到 API 输出尺寸
 */
/**
 * 生成 inpainting mask（支持椭圆和矩形两种格式）
 *
 * 椭圆 { cx, cy, rx, ry }：API 发送精确椭圆（校准的脸部区域）
 * 矩形 { cx, cy, w, h }  ：API 发送矩形（场景2真实人体专用）
 *
 * post-composite 统一使用：
 *   - 从脸部区域向上延伸覆盖头顶/发型，向下延伸覆盖颈部
 *   - 大幅羽化（~12%），边缘渐变消除硬边
 */
async function buildMask(inputW, inputH, mask, outputW, outputH) {
  const scaleX = outputW / inputW;
  const scaleY = outputH / inputH;
  const mcx = Math.round(mask.cx * scaleX);
  const mcy = Math.round(mask.cy * scaleY);
  if ('w' in mask && (mask.apiW || mask.apiH || mask.compW || mask.compH || mask.apiCx || mask.apiCy || mask.compCx || mask.compCy)) {
    const apiCx = Math.round((mask.apiCx ?? mask.cx) * scaleX);
    const apiCy = Math.round((mask.apiCy ?? mask.cy) * scaleY);
    const apiW = Math.round((mask.apiW ?? mask.w) * scaleX);
    const apiH = Math.round((mask.apiH ?? mask.h) * scaleY);
    const apiLeft = apiCx - Math.round(apiW / 2);
    const apiTop = apiCy - Math.round(apiH / 2);
    let svgAPI = `<svg width="${outputW}" height="${outputH}">` +
      `<rect x="${apiLeft}" y="${apiTop}" width="${apiW}" height="${apiH}" fill="white"/></svg>`;
    if (mask.apiShape === 'hairDome') {
      const domeH = Math.max(1, Math.round((mask.apiDomeH ?? Math.round(mask.apiH * 0.3)) * scaleY));
      const domeExpandX = Math.max(0, Math.round((mask.apiDomeExpandX ?? 0) * scaleX));
      const sideRx = Math.max(1, Math.round((mask.apiSideHairW ?? 0) * scaleX));
      const sideRy = Math.max(1, Math.round((mask.apiSideHairH ?? 0) * scaleY));
      const sideOffsetX = Math.max(0, Math.round((mask.apiSideHairOffsetX ?? 0) * scaleX));
      const sideOffsetY = Math.max(0, Math.round((mask.apiSideHairOffsetY ?? 0) * scaleY));
      const bodyTop = apiTop + Math.round(domeH * 0.52);
      const bodyH = Math.max(1, apiTop + apiH - bodyTop);
      const topRx = Math.round(apiW / 2) + domeExpandX;
      const topCy = apiTop + domeH;
      const leftHairCx = apiCx - sideOffsetX;
      const rightHairCx = apiCx + sideOffsetX;
      const hairCy = apiTop + sideOffsetY;
      svgAPI = `<svg width="${outputW}" height="${outputH}">` +
        `<ellipse cx="${apiCx}" cy="${topCy}" rx="${topRx}" ry="${domeH}" fill="white"/>` +
        `<rect x="${apiLeft}" y="${bodyTop}" width="${apiW}" height="${bodyH}" fill="white"/>` +
        `<ellipse cx="${leftHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="white"/>` +
        `<ellipse cx="${rightHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="white"/>` +
        `</svg>`;
    }
    const apiBuf = await sharp({ create: { width: outputW, height: outputH, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([{ input: Buffer.from(svgAPI), blend: 'over' }])
      .png()
      .toBuffer();

    const compCx = Math.round((mask.compCx ?? mask.cx) * scaleX);
    const compCy = Math.round((mask.compCy ?? mask.cy) * scaleY);
    const compW = Math.round((mask.compW ?? mask.w) * scaleX);
    const compH = Math.round((mask.compH ?? mask.h) * scaleY);
    const compLeft = compCx - Math.round(compW / 2);
    const compTop = compCy - Math.round(compH / 2);
    const feather = mask.compFeather
      ? Math.max(8, Math.round(mask.compFeather * Math.min(scaleX, scaleY)))
      : Math.max(12, Math.round(Math.min(compW, compH) * 0.075));
    let svgComp = `<svg width="${outputW}" height="${outputH}">` +
      `<rect x="${compLeft}" y="${compTop}" width="${compW}" height="${compH}" fill="white"/></svg>`;
    if (mask.compShape === 'hairDome') {
      const domeH = Math.max(1, Math.round((mask.compDomeH ?? Math.round(mask.compH * 0.32)) * scaleY));
      const domeExpandX = Math.max(0, Math.round((mask.compDomeExpandX ?? 0) * scaleX));
      const sideRx = Math.max(1, Math.round((mask.compSideHairW ?? 0) * scaleX));
      const sideRy = Math.max(1, Math.round((mask.compSideHairH ?? 0) * scaleY));
      const sideOffsetX = Math.max(0, Math.round((mask.compSideHairOffsetX ?? 0) * scaleX));
      const sideOffsetY = Math.max(0, Math.round((mask.compSideHairOffsetY ?? 0) * scaleY));
      const bodyTop = compTop + Math.round(domeH * 0.55);
      const bodyH = Math.max(1, compTop + compH - bodyTop);
      const topRx = Math.round(compW / 2) + domeExpandX;
      const topCy = compTop + domeH;
      const leftHairCx = compCx - sideOffsetX;
      const rightHairCx = compCx + sideOffsetX;
      const hairCy = compTop + sideOffsetY;
      svgComp = `<svg width="${outputW}" height="${outputH}">` +
        `<ellipse cx="${compCx}" cy="${topCy}" rx="${topRx}" ry="${domeH}" fill="white"/>` +
        `<rect x="${compLeft}" y="${bodyTop}" width="${compW}" height="${bodyH}" fill="white"/>` +
        `<ellipse cx="${leftHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="white"/>` +
        `<ellipse cx="${rightHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="white"/>` +
        `</svg>`;
    }
    const compRaw = await sharp({ create: { width: outputW, height: outputH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(svgComp), blend: 'over' }])
      .png()
      .toBuffer();
    let compBuf = await sharp(compRaw).blur(feather).png().toBuffer();
    if (mask.compShape === 'hairDome') {
      const domeH = Math.max(1, Math.round((mask.compDomeH ?? Math.round(mask.compH * 0.32)) * scaleY));
      const domeExpandX = Math.max(0, Math.round((mask.compDomeExpandX ?? 0) * scaleX));
      const sideRx = Math.max(1, Math.round((mask.compSideHairW ?? 0) * scaleX));
      const sideRy = Math.max(1, Math.round((mask.compSideHairH ?? 0) * scaleY));
      const sideOffsetX = Math.max(0, Math.round((mask.compSideHairOffsetX ?? 0) * scaleX));
      const sideOffsetY = Math.max(0, Math.round((mask.compSideHairOffsetY ?? 0) * scaleY));
      const bodyTop = compTop + Math.round(domeH * 0.62);
      const bodyInset = Math.max(1, Math.round(feather * 0.45));
      const innerBodyH = Math.max(1, compTop + compH - bodyTop);
      const innerTopRx = Math.max(1, Math.round(compW / 2) + domeExpandX - Math.round(feather * 0.35));
      const innerTopRy = Math.max(1, domeH - Math.round(feather * 0.3));
      const topCy = compTop + domeH;
      const leftHairCx = compCx - sideOffsetX;
      const rightHairCx = compCx + sideOffsetX;
      const hairCy = compTop + sideOffsetY;
      const innerSideRx = Math.max(1, sideRx - Math.round(feather * 0.25));
      const innerSideRy = Math.max(1, sideRy - Math.round(feather * 0.2));
      const svgSolidHair = `<svg width="${outputW}" height="${outputH}">` +
        `<ellipse cx="${compCx}" cy="${topCy}" rx="${innerTopRx}" ry="${innerTopRy}" fill="white"/>` +
        `<rect x="${compLeft + bodyInset}" y="${bodyTop}" width="${Math.max(1, compW - bodyInset * 2)}" height="${innerBodyH}" fill="white"/>` +
        `<ellipse cx="${leftHairCx}" cy="${hairCy}" rx="${innerSideRx}" ry="${innerSideRy}" fill="white"/>` +
        `<ellipse cx="${rightHairCx}" cy="${hairCy}" rx="${innerSideRx}" ry="${innerSideRy}" fill="white"/>` +
        `</svg>`;
      compBuf = await sharp(compBuf)
        .composite([{ input: Buffer.from(svgSolidHair), blend: 'over' }])
        .png()
        .toBuffer();
      console.log(`    comp mask -> hairDome (${compLeft},${compTop}) ${compW}x${compH} feather=${feather}`);
      return { apiBuf, compBuf, cx: mcx, cy: mcy };
    }
    const solidTopH = Math.min(compH, Math.max(0, Math.round((mask.compSolidTopH ?? 0) * scaleY)));
    const solidTopInset = Math.max(0, Math.round((mask.compSolidTopInset ?? 0) * scaleX));
    if (solidTopH > 0) {
      const solidX = compLeft + solidTopInset;
      const solidW = Math.max(1, compW - solidTopInset * 2);
      const svgSolidTop = `<svg width="${outputW}" height="${outputH}">` +
        `<rect x="${solidX}" y="${compTop}" width="${solidW}" height="${solidTopH}" fill="white"/></svg>`;
      compBuf = await sharp(compBuf)
        .composite([{ input: Buffer.from(svgSolidTop), blend: 'over' }])
        .png()
        .toBuffer();
    }

    console.log(`    api mask -> ${mask.apiShape === 'hairDome' ? 'hairDome' : 'rect'} (${apiLeft},${apiTop}) ${apiW}x${apiH} (${outputW}x${outputH})`);
    console.log(`    comp mask -> rect (${compLeft},${compTop}) ${compW}x${compH} feather=${feather} solidTop=${solidTopH} inset=${solidTopInset}`);
    return { apiBuf, compBuf, cx: mcx, cy: mcy };
  }
  /*
  const rect = resolveMaskRect(mask, scaleX, scaleY, outputW, outputH);

  const svgAPIRect = `<svg width="${outputW}" height="${outputH}">` +
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="white"/></svg>`;
  const apiBufRect = await sharp({ create: { width: outputW, height: outputH, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: Buffer.from(svgAPIRect), blend: 'over' }])
    .png()
    .toBuffer();

  const featherPadX = Math.round(rect.w * 0.08);
  const featherPadTop = Math.round(rect.h * 0.08);
  const featherPadBottom = Math.round(rect.h * 0.14);
  const cLeft = clamp(rect.x - featherPadX, 0, outputW);
  const cTop = clamp(rect.y - featherPadTop, 0, outputH);
  const cRight = clamp(rect.x + rect.w + featherPadX, 0, outputW);
  const cBottom = clamp(rect.y + rect.h + featherPadBottom, 0, outputH);
  const cW = Math.max(1, cRight - cLeft);
  const cH = Math.max(1, cBottom - cTop);
  const feather = Math.max(18, Math.round(Math.min(cW, cH) * 0.10));

  const svgCompRect = `<svg width="${outputW}" height="${outputH}">` +
    `<rect x="${cLeft}" y="${cTop}" width="${cW}" height="${cH}" fill="white"/></svg>`;
  const compRawRect = await sharp({ create: { width: outputW, height: outputH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(svgCompRect), blend: 'over' }])
    .png()
    .toBuffer();
  const compBufRect = await sharp(compRawRect).blur(feather).png().toBuffer();

  console.log(`    mask -> rect (${rect.x},${rect.y}) ${rect.w}x${rect.h} (${outputW}x${outputH})`);
  return { apiBuf: apiBufRect, compBuf: compBufRect, rect };
  */

  // ── API mask ──────────────────────────────────────────────────
  let svgAPI;
  if ('w' in mask) {
    // 矩形 mask（场景2）
    const rw = Math.round(mask.w * scaleX);
    const rh = Math.round(mask.h * scaleY);
    const rx = mcx - Math.round(rw / 2);
    const ry = mcy - Math.round(rh / 2);
    svgAPI = `<svg width="${outputW}" height="${outputH}">` +
      `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="white"/></svg>`;
    console.log(`    mask → rect (${rx},${ry}) ${rw}×${rh} (${outputW}×${outputH})`);
  } else {
    // 椭圆 mask（场景1/4）：精确对齐人偶脸部
    const apiCx = Math.round((mask.apiCx ?? mask.cx) * scaleX);
    const apiCy = Math.round((mask.apiCy ?? mask.cy) * scaleY);
    const mrx = Math.round((mask.apiRx ?? mask.rx) * scaleX);
    const mry = Math.round((mask.apiRy ?? mask.ry) * scaleY);
    svgAPI = `<svg width="${outputW}" height="${outputH}">` +
      `<ellipse cx="${apiCx}" cy="${apiCy}" rx="${mrx}" ry="${mry}" fill="white"/></svg>`;
    console.log(`    mask → ellipse cx=${apiCx} cy=${apiCy} rx=${mrx} ry=${mry} (${outputW}×${outputH})`);
  }
  const apiBuf = await sharp({ create: { width: outputW, height: outputH, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{ input: Buffer.from(svgAPI), blend: 'over' }])
    .png()
    .toBuffer();

  // ── Composite mask：羽化大矩形（覆盖头顶+脸+颈部）────────────
  // 无论 API mask 是椭圆还是矩形，composite 统一用扩展矩形 + 羽化
  // 上方：覆盖头顶/发型（face_cy - 1.8 * ry）
  // 下方：覆盖颈部/肩膀过渡（face_cy + 2.8 * ry）
  // 左右：脸宽 + 40% 余量
  let faceRx, faceRy;
  if ('w' in mask) {
    faceRx = Math.round(mask.w / 2 * scaleX);
    faceRy = Math.round(mask.h / 2 * scaleY);
  } else {
    faceRx = Math.round(mask.rx * scaleX);
    faceRy = Math.round(mask.ry * scaleY);
  }
  if (mask.compShape === 'hairDome') {
    const compCx = Math.round((mask.compCx ?? mask.cx) * scaleX);
    const compCy = Math.round((mask.compCy ?? mask.cy) * scaleY);
    const compW = Math.round((mask.compW ?? Math.round(faceRx * 2.2 / scaleX)) * scaleX);
    const compH = Math.round((mask.compH ?? Math.round(faceRy * 2.3 / scaleY)) * scaleY);
    const compLeft = compCx - Math.round(compW / 2);
    const compTop = compCy - Math.round(compH / 2);
    const domeH = Math.max(1, Math.round((mask.compDomeH ?? Math.round((mask.compH ?? faceRy * 2.3 / scaleY) * 0.32)) * scaleY));
    const domeExpandX = Math.max(0, Math.round((mask.compDomeExpandX ?? 0) * scaleX));
    const sideRx = Math.max(1, Math.round((mask.compSideHairW ?? 0) * scaleX));
    const sideRy = Math.max(1, Math.round((mask.compSideHairH ?? 0) * scaleY));
    const sideOffsetX = Math.max(0, Math.round((mask.compSideHairOffsetX ?? 0) * scaleX));
    const sideOffsetY = Math.max(0, Math.round((mask.compSideHairOffsetY ?? 0) * scaleY));
    const bodyTop = compTop + Math.round(domeH * 0.58);
    const bodyH = Math.max(1, compTop + compH - bodyTop);
    const topRx = Math.round(compW / 2) + domeExpandX;
    const topCy = compTop + domeH;
    const leftHairCx = compCx - sideOffsetX;
    const rightHairCx = compCx + sideOffsetX;
    const hairCy = compTop + sideOffsetY;
    const feather = mask.compFeather
      ? Math.max(6, Math.round(mask.compFeather * Math.min(scaleX, scaleY)))
      : Math.max(10, Math.round(Math.min(compW, compH) * 0.06));

    const svgCompDome = `<svg width="${outputW}" height="${outputH}">` +
      `<ellipse cx="${compCx}" cy="${topCy}" rx="${topRx}" ry="${domeH}" fill="white"/>` +
      `<rect x="${compLeft}" y="${bodyTop}" width="${compW}" height="${bodyH}" fill="white"/>` +
      `<ellipse cx="${leftHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="white"/>` +
      `<ellipse cx="${rightHairCx}" cy="${hairCy}" rx="${sideRx}" ry="${sideRy}" fill="white"/>` +
      `</svg>`;
    const compRawDome = await sharp({ create: { width: outputW, height: outputH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(svgCompDome), blend: 'over' }])
      .png()
      .toBuffer();
    const compBufDome = await sharp(compRawDome).blur(feather).png().toBuffer();
    console.log(`    comp mask -> hairDome (${compLeft},${compTop}) ${compW}x${compH} feather=${feather}`);
    return { apiBuf, compBuf: compBufDome, cx: compCx, cy: compCy };
  }
  if (mask.compShape === 'ellipse') {
    const compCx = Math.round((mask.compCx ?? mask.cx) * scaleX);
    const compCy = Math.round((mask.compCy ?? mask.cy) * scaleY);
    const compRx = Math.round((mask.compRx ?? mask.rx) * scaleX);
    const compRy = Math.round((mask.compRy ?? mask.ry) * scaleY);
    const feather = Math.max(10, Math.round(Math.min(compRx, compRy) * (mask.compFeatherScale ?? 0.08)));
    const svgCompEllipse = `<svg width="${outputW}" height="${outputH}">` +
      `<ellipse cx="${compCx}" cy="${compCy}" rx="${compRx}" ry="${compRy}" fill="white"/></svg>`;
    const compRawEllipse = await sharp({ create: { width: outputW, height: outputH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(svgCompEllipse), blend: 'over' }])
      .png()
      .toBuffer();
    const compBufEllipse = await sharp(compRawEllipse).blur(feather).png().toBuffer();
    console.log(`    comp mask -> ellipse cx=${compCx} cy=${compCy} rx=${compRx} ry=${compRy} feather=${feather}`);
    return { apiBuf, compBuf: compBufEllipse, cx: compCx, cy: compCy };
  }
  const compScaleX = mask.compScaleX ?? 1.4;
  const compTopScale = mask.compTopScale ?? 1.8;
  const compBottomScale = mask.compBottomScale ?? 2.8;
  const compFeatherScale = mask.compFeatherScale ?? 0.12;
  const cLeft   = mcx - Math.round(faceRx * compScaleX);
  const cRight  = mcx + Math.round(faceRx * compScaleX);
  const cTop    = mcy - Math.round(faceRy * compTopScale);
  const cBottom = mcy + Math.round(faceRy * compBottomScale);
  const cW = cRight - cLeft;
  const cH = cBottom - cTop;
  const feather = Math.max(12, Math.round(Math.min(cW, cH) * compFeatherScale));

  const svgComp = `<svg width="${outputW}" height="${outputH}">` +
    `<rect x="${cLeft}" y="${cTop}" width="${cW}" height="${cH}" fill="white"/></svg>`;
  const compRaw = await sharp({ create: { width: outputW, height: outputH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(svgComp), blend: 'over' }])
    .png()
    .toBuffer();
  const compBuf = await sharp(compRaw).blur(feather).png().toBuffer();

  return { apiBuf, compBuf, cx: mcx, cy: mcy };
}

/**
 * Post-composite：把 AI 输出中 mask 椭圆区域贴到原始底图上
 * 确保椭圆外所有像素与原始底图像素级一致
 *
 * 流程：
 *   1. 原始底图缩放到输出尺寸（与 API 输入一致，避免错位）
 *   2. 在缩放后的底图上打一个透明椭圆孔
 *   3. 将带孔底图叠加在 AI 输出上方 → 背景 = 原始底图，脸部 = AI 输出
 */
async function postComposite({ templatePath, templateW, templateH, aiBuf, maskCoords, outW, outH }) {
  const scaleX = outW / templateW;
  const scaleY = outH / templateH;
  const cx = Math.round(maskCoords.cx * scaleX);
  const cy = Math.round(maskCoords.cy * scaleY);
  const rx = Math.round(maskCoords.rx * scaleX);
  const ry = Math.round(maskCoords.ry * scaleY);

  // 1. 底图缩放到输出尺寸（fit:'fill' = 精确拉伸到目标尺寸，与 API 的处理方式一致）
  const resizedTpl = await sharp(templatePath)
    .resize(outW, outH, { fit: 'fill' })
    .ensureAlpha()
    .toBuffer();

  // 2. 在底图上打透明椭圆孔（dest-out：source白色区域将底图变透明）
  const holeEllipse = `<svg width="${outW}" height="${outH}">` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"/>` +
    `</svg>`;
  const tplWithHole = await sharp(resizedTpl)
    .composite([{ input: Buffer.from(holeEllipse), blend: 'dest-out' }])
    .png()
    .toBuffer();

  // 3. AI 输出 + 带孔底图叠上去（椭圆内 = AI 脸，椭圆外 = 原始底图）
  return sharp(aiBuf)
    .resize(outW, outH, { fit: 'fill' })
    .composite([{ input: tplWithHole }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ── 场景1/2/4：Inpainting 模式 ───────────────────────────────
// 流程：
//   1. API inpainting 生成换脸结果
//   2. Post-composite：把原始底图（精确缩放到输出尺寸）在 mask 椭圆外强制覆盖回去
//      → 椭圆内 = AI 生成的人脸，椭圆外 = 原始底图像素，100% 锁定背景
async function runInpaintTest({ photoTag, sceneId, conf, templatePath, templateW, templateH,
                                 userBase64, userDescription, gender, outputDir = OUTPUT_DIR, attemptLabel = null }) {
  const [outW, outH] = conf.size.split('x').map(Number);
  const controlProfile = INPAINT_CONTROL_PROFILES[conf.controlProfile] || INPAINT_CONTROL_PROFILES.default;

  // ── Pre-fill mask: 用中性肤色填充mannequin区域，防止AI复制白色mannequin纹理 ──
  let templateBase64;
  if (conf.preFillMask) {
    const scaleX = outW / templateW;
    const scaleY = outH / templateH;
    const mcx = Math.round((conf.mask.apiCx ?? conf.mask.cx) * scaleX);
    const mcy = Math.round((conf.mask.apiCy ?? conf.mask.cy) * scaleY);
    const mw  = Math.round((conf.mask.apiW ?? conf.mask.w) * scaleX);
    const mh  = Math.round((conf.mask.apiH ?? conf.mask.h) * scaleY);
    const mLeft = mcx - Math.round(mw / 2);
    const mTop  = mcy - Math.round(mh / 2);
    // 中性肤色填充 SVG
    const skinSvg = `<svg width="${mw}" height="${mh}"><rect width="${mw}" height="${mh}" fill="rgb(180,155,130)"/></svg>`;
    const tplBuf = await sharp(templatePath).resize(outW, outH, { fit: 'fill' }).toBuffer();
    const filledBuf = await sharp(tplBuf)
      .composite([{ input: Buffer.from(skinSvg), blend: 'over', left: mLeft, top: mTop }])
      .jpeg({ quality: 95 })
      .toBuffer();
    templateBase64 = 'data:image/jpeg;base64,' + filledBuf.toString('base64');
    console.log(`    [preFill] 用肤色填充mask区域 (${mLeft},${mTop}) ${mw}x${mh}`);
  } else {
    templateBase64 = toBase64DataUrl(templatePath);
  }

  // 构建 mask：apiBuf=RGB黑白矩形（发给API），compBuf=RGBA羽化矩形（post-composite用）
  const { apiBuf, compBuf } =
    await buildMask(templateW, templateH, conf.mask, outW, outH);
  const maskBase64 = 'data:image/png;base64,' + apiBuf.toString('base64');

  const appearanceLine = userDescription
    ? `Person description (Image 2): ${userDescription.substring(0, 200)}`
    : '';
  const genderLock = gender === 'male'
    ? 'GENDER: The person is MALE — reproduce male facial structure, jawline, and hairstyle faithfully.'
    : gender === 'female'
    ? 'GENDER: The person is FEMALE — reproduce female facial structure and hairstyle faithfully.'
    : '';
  const headNeckRatioLock = gender === 'male'
    ? 'ANATOMY RATIO: Male head-length : neck-length must be about 2.3 : 1. Head length = top of head to chin. Neck length = chin to suprasternal notch (collarbone pit).'
    : gender === 'female'
    ? 'ANATOMY RATIO: Female head-length : neck-length must be about 2.0 : 1. Head length = top of head to chin. Neck length = chin to suprasternal notch (collarbone pit).'
    : 'ANATOMY RATIO: Keep a realistic head-length to neck-length proportion. Head length = top of head to chin. Neck length = chin to suprasternal notch (collarbone pit).';

  // 换头提示词：强调自然融合、肤色衔接、颈部过渡、背景不变
  const prompt = [
    'Photorealistic head transplant composite. Ultra-high quality.',
    'Image 1 = scene background with a placeholder body. Image 2 = a head-and-hair identity reference of the real person.',
    'Use Image 2 only for facial identity, hairstyle, ears, skin tone, and natural neck transition.',
    'Do NOT copy Image 2 clothing, chest, shoulders, hands, pose, or source background into the result.',
    controlProfile.taskLine,
    '',
    'CRITICAL REQUIREMENTS:',
    '● Identity: The replaced head must be clearly recognizable as the SAME person from Image 2.',
    '  Preserve exact facial features — eyes, nose, lips, skin tone, hairline, hair color, hairstyle.',
    '● Skin tone continuity: The skin tone of the face and neck must smoothly match',
    '  the skin tone at the shoulder/body boundary — NO visible color jump or seam.',
    '● Neck-to-shoulder blend: Generate a natural, anatomically correct transition',
    '  from the neck into the shoulders/body of Image 1. No floating head effect.',
    '● Head-to-neck proportion: Keep the head length and neck length anatomically correct.',
    '  Do NOT make the neck too short, too long, too thick, or too thin relative to the head.',
    '● Hair quality: Keep the full hairstyle visible up to the crown with crisp, opaque hair strands.',
    '  No translucent hair, no faded top hair, no blurry hairline, and no missing hair volume.',
    '● Full-face visibility: The entire face must be fully visible and complete above the jersey line.',
    '  Both eyes, nose, mouth, chin, and jawline must be fully shown with no cropping, no missing lower face, and no partial face.',
    '● No face obstruction: The jersey in Image 1 sits below the chin. It must NOT cover or merge into the mouth, chin, or jaw.',
    '  Keep a clear gap and clean separation between the lower face/neck and the top edge of the jersey.',
    '● Edge feathering: The boundary of the replaced region must fade seamlessly',
    '  into the surrounding background — soft edges, no hard cutout lines.',
    '● Background lock: ALL pixels OUTSIDE the white mask region must remain',
    '  pixel-perfect identical to Image 1. Do NOT alter background, lighting, or props.',
    '● Clothing lock: Do NOT redraw or redesign the jersey, collar, shoulders, hands, flag, or printed letters.',
    '  Preserve the original clothing structure and prop geometry from Image 1.',
    '● Lighting match: The head lighting direction, color temperature, and shadows',
    '  must match the lighting of the body and scene in Image 1.',
    '● Head size: The head must be the EXACT SAME SIZE as the placeholder/blank head area in Image 1.',
    '  Do NOT make the head larger than the template placeholder — match its scale precisely.',
    '● Head framing: Do NOT zoom the head to fill the entire mask.',
    '  Keep the head slightly smaller inside the replacement area so the full crown, forehead, jawline, and chin remain visible.',
    'Reference role lock: Treat Image 2 as identity-only head reference, not as a full-body composition reference.',
    'Ignore any clothing, chest, shoulders, arms, hands, pose, and background from Image 2. Keep those from Image 1.',
    '',
    genderLock,
    headNeckRatioLock,
    appearanceLine,
    ...(Array.isArray(controlProfile.promptLines) ? controlProfile.promptLines : []),
    ...(Array.isArray(conf.extraPromptLines) ? conf.extraPromptLines : []),
    'Ultra-detailed, 8K resolution, photorealistic, sharp face, seamless composite.',
  ].filter(Boolean).join('\n');

  const negative_prompt = [
    'hard edge, visible seam, cutout effect, pasted-on look, halo artifact,',
    'floating head, neck mismatch, skin tone jump, color discontinuity,',
    'short neck, long neck, thick neck, thin neck, oversized head, undersized head,',
    'translucent hair, faded crown, blurry hairline, missing hair, bald patch, soft-focus hair,',
    'cropped face, partial face, missing chin, missing mouth, missing jawline, face hidden by jersey, lower face occluded,',
    'redrawn jersey, altered collar, changed shoulders, modified hands, distorted flag, broken letters,',
    'source photo jacket, source photo shirt, source photo dress, source photo torso, source photo chest, source photo arms, source photo hands,',
    'source photo pose, source photo background, room corner patch, wall patch, indoor background patch,',
    'blurry face, distorted face, deformed anatomy, wrong proportions,',
    'cartoon, anime, illustration, painting,',
    'identity drift, different person, wrong hairstyle, beauty filter, age altered,',
    'changed background, altered composition, moved objects, different lighting.',
    ...(Array.isArray(controlProfile.negativeTerms) ? controlProfile.negativeTerms : []),
    ...(Array.isArray(conf.extraNegativeTerms) ? conf.extraNegativeTerms : []),
  ].join(' ');

  const t0 = Date.now();
  try {
    const res = await axios.post(API_URL, {
      model: MODEL, prompt, negative_prompt,
      image: [templateBase64, userBase64],
      mask_image: maskBase64,
      strength: 1.0,
      guidance_scale: conf.guidance,
      response_format: 'url',
      size: conf.size,
      stream: false,
    }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` }, timeout: 180000 });

    const url = res.data?.data?.[0]?.url;
    if (!url) throw new Error('API 未返回图片 URL');

    // ── Post-composite：mask 作 alpha 通道直接合成 ───────────────
    // 思路：用 mask 图本身控制每个像素来源
    //   mask=白(255)处 → 显示 AI 输出（人脸）
    //   mask=黑(0)处   → 显示原始底图（背景完全不变）
    // 比打孔法更可靠：不受 +/-偏移影响，边界精确贴合 mask 形状

    // 1. 下载 AI 输出
    const aiBuf = await downloadToBuffer(url);

    // 2. AI 输出缩放到目标尺寸，并加 alpha 通道
    const aiResized = await sharp(aiBuf)
      .resize(outW, outH, { fit: 'fill' })
      .ensureAlpha()
      .toBuffer();

    // 3. 用 RGBA compBuf 做 dest-in：AI 输出只保留椭圆内像素（其余透明）
    const aiFaceMasked = await sharp(aiResized)
      .composite([{ input: compBuf, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // 4. 原始底图缩放到目标尺寸（背景层）
    const tplResized = await sharp(templatePath)
      .resize(outW, outH, { fit: 'fill' })
      .toBuffer();

    // 5. 底图 + 人脸层叠加 → 椭圆外=底图原像素，椭圆内=AI人脸
    const finalBuf = await sharp(tplResized)
      .composite([{ input: aiFaceMasked, blend: 'over' }])
      .jpeg({ quality: 95 })
      .toBuffer();

    if (conf.validateHeadSwap) {
      const validation = await validateHeadSwapResult(
        `data:image/jpeg;base64,${finalBuf.toString('base64')}`,
        conf.label,
        conf.validationTarget,
        conf.validationRule || ''
      );
      if (!validation.ok) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        // DEBUG: save failed result for diagnosis
        const gTag = gender === 'female' ? 'F' : 'M';
        const debugFile = path.join(outputDir, `scene${sceneId}_FAIL_DEBUG_${gTag}_${photoTag}_${Date.now()}.jpg`);
        fs.writeFileSync(debugFile, finalBuf);
        console.warn(`  [debug] 保存失败结果到 ${path.basename(debugFile)}`);
        console.warn(`  [retry] 场景${sceneId} ${conf.label}${attemptLabel ? ` (${attemptLabel})` : ''} 命中空头/缺头校验: ${validation.reason}`);
        return {
          photoTag,
          sceneId,
          label: conf.label,
          elapsed,
          status: 'failed',
          error: `validation_failed:${validation.reason}`,
          retryable: true,
        };
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const gTag    = gender === 'female' ? 'F' : 'M';
    const outFile = path.join(outputDir, `scene${sceneId}_inpaint_${gTag}_${photoTag}_${Date.now()}.jpg`);
    fs.writeFileSync(outFile, finalBuf);

    console.log(`  [✓] 场景${sceneId} ${conf.label} → ${path.basename(outFile)} (${elapsed}s, composited)`);
    return { photoTag, sceneId, label: conf.label, elapsed, localFile: path.basename(outFile), status: 'ok' };
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const msg     = err.response?.data ? JSON.stringify(err.response.data).substring(0, 200) : err.message;
    console.error(`  [✗] 场景${sceneId} ${conf.label} 失败 (${elapsed}s): ${msg}`);
    return { photoTag, sceneId, label: conf.label, elapsed, status: 'failed', error: msg };
  }
}

// ── 场景4：Faceswap prompt 模式 ───────────────────────────────
async function runFaceswapTest({ photoTag, sceneId, conf, templatePath,
                                  userBase64, userDescription, gender, outputDir = OUTPUT_DIR }) {
  const templateBase64 = toBase64DataUrl(templatePath);
  const { prompt, negative_prompt } = buildFaceswapPrompt({
    targetPerson: conf.targetPerson,
    userDescription, gender,
    templateType: conf.templateType,
  });

  const t0 = Date.now();
  try {
    const result = await generateNativeImage({
      prompt, negative_prompt,
      images: [templateBase64, userBase64],
      size:   conf.size,
      scene_params: { strength: conf.strength, guidance_scale: conf.guidance },
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const gTag    = gender === 'female' ? 'F' : 'M';
    const outFile = path.join(outputDir, `scene${sceneId}_faceswap_${gTag}_${photoTag}_${Date.now()}.jpg`);
    await downloadFile(result.url, outFile);

    console.log(`  [✓] 场景${sceneId} ${conf.label} → ${path.basename(outFile)} (${elapsed}s)`);
    return { photoTag, sceneId, label: conf.label, elapsed, localFile: path.basename(outFile), status: 'ok' };
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const msg     = err.response?.data ? JSON.stringify(err.response.data).substring(0, 200) : err.message;
    console.error(`  [✗] 场景${sceneId} ${conf.label} 失败 (${elapsed}s): ${msg}`);
    return { photoTag, sceneId, label: conf.label, elapsed, status: 'failed', error: msg };
  }
}

// ── Faceswap-composite：Faceswap 生成 + 可选 Post-composite 锁背景 ──────
// 流程：
//   1. 用 faceswap 模式（无 mask）调用 API 生成完整换脸图
//   2a. skipComposite=true：直接输出 faceswap 原始结果（prompt 已锁定背景）
//   2b. skipComposite=false：用 compBuf mask 做 dest-in，叠加到原始底图锁定背景
async function runFaceswapCompositeTest({ photoTag, sceneId, conf, templatePath, templateW, templateH,
                                            userBase64, userDescription, gender, outputDir = OUTPUT_DIR }) {
  const [outW, outH] = conf.size.split('x').map(Number);

  // 1. 构建 faceswap prompt
  const { prompt, negative_prompt } = buildFaceswapPrompt({
    targetPerson: conf.targetPerson || 'the person on the far left',
    userDescription,
    gender,
    templateType: conf.templateType || 'mannequin',
  });

  // 2. 构建 compBuf（仅 skipComposite=false 时需要）
  let compBuf;
  if (!conf.skipComposite) {
    ({ compBuf } = await buildMask(templateW, templateH, conf.mask, outW, outH));
  }

  // 3. 调用 faceswap API（无 mask，完整图像生成）
  const templateBase64 = toBase64DataUrl(templatePath);
  const t0 = Date.now();
  try {
    const result = await generateNativeImage({
      prompt,
      negative_prompt,
      images: [templateBase64, userBase64],
      size: conf.size,
      scene_params: {
        strength: conf.strength ?? 0.50,
        guidance_scale: conf.guidance,
      },
    });

    // 4. 下载 AI 输出
    const aiBuf = await downloadToBuffer(result.url);

    let finalBuf;
    if (conf.skipComposite) {
      // 跳过 post-composite，直接使用 faceswap 原始输出
      // faceswap prompt 已要求 AI 保留背景，无需 mask 合成
      finalBuf = await sharp(aiBuf)
        .resize(outW, outH, { fit: 'fill' })
        .jpeg({ quality: 95 })
        .toBuffer();
      console.log(`    [skipComposite] 直接使用 faceswap 原始输出`);
    } else {
      // 5. AI 输出缩放到目标尺寸，加 alpha 通道
      const aiResized = await sharp(aiBuf)
        .resize(outW, outH, { fit: 'fill' })
        .ensureAlpha()
        .toBuffer();

      // 6. 用 compBuf 做 dest-in：只保留 mask 区域像素
      const aiFaceMasked = await sharp(aiResized)
        .composite([{ input: compBuf, blend: 'dest-in' }])
        .png()
        .toBuffer();

      // 7. 原始底图缩放（背景层）
      const tplResized = await sharp(templatePath)
        .resize(outW, outH, { fit: 'fill' })
        .toBuffer();

      // 8. 底图 + 人脸层叠加 → mask 外=底图原像素，mask 内=AI 人脸
      finalBuf = await sharp(tplResized)
        .composite([{ input: aiFaceMasked, blend: 'over' }])
        .jpeg({ quality: 95 })
        .toBuffer();
    }

    // 9. 验证
    if (conf.validateHeadSwap) {
      const validation = await validateHeadSwapResult(
        `data:image/jpeg;base64,${finalBuf.toString('base64')}`,
        conf.label,
        conf.validationTarget,
        conf.validationRule || ''
      );
      if (!validation.ok) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const gTag = gender === 'female' ? 'F' : 'M';
        const debugFile = path.join(outputDir, `scene${sceneId}_FAIL_DEBUG_${gTag}_${photoTag}_${Date.now()}.jpg`);
        fs.writeFileSync(debugFile, finalBuf);
        console.warn(`  [debug] 保存失败结果到 ${path.basename(debugFile)}`);
        console.warn(`  [retry] 场景${sceneId} ${conf.label} 命中空头/缺头校验: ${validation.reason}`);
        return {
          photoTag, sceneId, label: conf.label, elapsed,
          status: 'failed',
          error: `validation fail: ${validation.reason}`,
          retryable: true,
        };
      }
    }

    // 10. 保存
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const gTag    = gender === 'female' ? 'F' : 'M';
    const outFile = path.join(outputDir, `scene${sceneId}_${gTag}_${photoTag}_${Date.now()}.jpg`);
    fs.writeFileSync(outFile, finalBuf);
    console.log(`  [✓] 场景${sceneId} ${conf.label} (faceswap-composite) → ${path.basename(outFile)} (${elapsed}s)`);
    return { photoTag, sceneId, label: conf.label, elapsed, localFile: path.basename(outFile), status: 'ok' };

  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const msg     = err.response?.data ? JSON.stringify(err.response.data).substring(0, 200) : err.message;
    console.error(`  [✗] 场景${sceneId} ${conf.label} faceswap-composite 失败 (${elapsed}s): ${msg}`);
    return { photoTag, sceneId, label: conf.label, elapsed, status: 'failed', error: msg };
  }
}

// ── 单张照片跑所有场景 ────────────────────────────────────────
async function runPhotoAllScenes({ photoPath, sceneIds, forceGender, outputDir = OUTPUT_DIR }) {
  const photoTag   = path.basename(photoPath, path.extname(photoPath)).substring(0, 8);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`照片: ${path.basename(photoPath)}`);

  const userBase64 = toBase64DataUrl(photoPath);

  let userDescription = '';
  try {
    userDescription = await describeUserAppearance([userBase64]);
    console.log(`  外貌: ${userDescription.substring(0, 80)}...`);
  } catch (e) { console.warn(`  外貌解读失败: ${e.message}`); }

  const gender = forceGender || await detectGender(userBase64);
  console.log(`  性别: ${gender}`);

  const results = [];
  for (const sceneId of sceneIds) {
    const sceneConf = SCENE_CONFIGS[sceneId];
    if (!sceneConf) {
      results.push({ photoTag, sceneId, status: 'skip', error: '场景未配置' });
      continue;
    }

    const conf         = sceneConf[gender] || sceneConf['male'];
    const templatePath = path.join(TEMPLATE_DIR, conf.file);

    if (!fs.existsSync(templatePath)) {
      console.error(`  底图不存在: ${templatePath}`);
      results.push({ photoTag, sceneId, label: conf.label, status: 'skip', error: '底图文件不存在' });
      continue;
    }

    const meta = await sharp(templatePath).metadata();

    let r;
    if (conf.mode === 'inpaint') {
      const referenceVariants = await buildReferenceVariants(photoPath, conf, userBase64);
      for (let idx = 0; idx < referenceVariants.length; idx++) {
        const refVariant = referenceVariants[idx];
        r = await runInpaintTest({
          photoTag, sceneId, conf,
          templatePath, templateW: meta.width, templateH: meta.height,
          userBase64: refVariant.base64, userDescription, gender, outputDir,
          attemptLabel: refVariant.label,
        });
        if (r.status === 'ok') break;
        if (!(r.retryable && idx < referenceVariants.length - 1)) break;
        console.warn(`  [retry] 场景${sceneId} ${conf.label} 切换参考图重试 -> ${referenceVariants[idx + 1].label}`);
      }
    } else if (conf.mode === 'faceswap-composite') {
      // Hybrid 模式：faceswap 生成 + post-composite 锁背景
      const sceneUserBase64 = (conf.refScale && conf.refScale < 0.999)
        ? await toScaledReferenceDataUrl(
            photoPath,
            conf.refScale,
            conf.refAnchor || 'center',
            conf.refOffsetX ?? 0.5,
            conf.refOffsetY
          )
        : userBase64;
      r = await runFaceswapCompositeTest({
        photoTag, sceneId, conf,
        templatePath, templateW: meta.width, templateH: meta.height,
        userBase64: sceneUserBase64, userDescription, gender, outputDir,
      });
    } else {
      const sceneUserBase64 = (conf.refScale && conf.refScale < 0.999)
        ? await toScaledReferenceDataUrl(
            photoPath,
            conf.refScale,
            conf.refAnchor || 'center',
            conf.refOffsetX ?? 0.5,
            conf.refOffsetY
          )
        : userBase64;
      r = await runFaceswapTest({
        photoTag, sceneId, conf, templatePath,
        userBase64: sceneUserBase64, userDescription, gender, outputDir,
      });
    }
    results.push(r);
  }
  return results;
}

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  const cli      = parseCliArgs(process.argv.slice(2));
  const sceneIds = cli.scenes || Object.keys(SCENE_CONFIGS);
  const outputDir = cli.outdir
    ? (path.isAbsolute(cli.outdir) ? cli.outdir : path.join(__dirname, cli.outdir))
    : OUTPUT_DIR;

  console.log('='.repeat(50));
  console.log('全场景换脸批量测试（Inpaint + Post-composite + Faceswap）');
  console.log('='.repeat(50));
  console.log(`照片数: ${cli.photos.length}  场景: ${sceneIds.join(', ')}  共 ${cli.photos.length * sceneIds.length} 个任务`);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const t_total    = Date.now();
  const allResults = [];

  await Promise.all(cli.photos.map(photoPath =>
    runPhotoAllScenes({ photoPath, sceneIds, forceGender: cli.gender, outputDir })
      .then(r => allResults.push(...r))
      .catch(err => console.error(`照片处理失败 ${photoPath}: ${err.message}`))
  ));

  const elapsed = ((Date.now() - t_total) / 1000).toFixed(1);
  const ok      = allResults.filter(r => r.status === 'ok').length;
  const failed  = allResults.filter(r => r.status === 'failed').length;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`汇总：${ok} 成功 / ${failed} 失败  总耗时 ${elapsed}s`);
  console.log(`输出目录: ${outputDir}`);
  console.log('='.repeat(50));

  allResults.forEach(r => {
    const tag  = r.status === 'ok' ? '✓' : r.status === 'skip' ? '-' : '✗';
    const info = r.status === 'ok' ? r.localFile : (r.error || '');
    console.log(`[${tag}] ${r.photoTag} 场景${r.sceneId}  ${info}`);
  });
}

main().catch(err => { console.error('测试出错:', err.message); process.exit(1); });
