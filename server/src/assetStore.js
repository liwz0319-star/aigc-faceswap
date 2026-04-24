const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const players = require('./data/players');
const scenes = require('./data/scenes');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const imageCache = new Map();

// 参考图压缩配置
const COMPRESS_MAX_DIM = parseInt(process.env.COMPRESS_MAX_DIM, 10) || 1024;
const COMPRESS_QUALITY = parseInt(process.env.COMPRESS_QUALITY, 10) || 90;

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.png') {
    return 'image/png';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }

  return 'image/jpeg';
}

/**
 * 用 sharp 压缩图片并返回 data URL
 * - 缩放到 maxDim 以内
 * - 转 JPEG quality=80
 * - 结果缓存到 imageCache
 */
async function compressToDataUrl(buffer, cacheKey, maxDim = COMPRESS_MAX_DIM, quality = COMPRESS_QUALITY) {
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey);
  }

  const compressed = await sharp(buffer)
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();

  const dataUrl = `data:image/jpeg;base64,${compressed.toString('base64')}`;
  imageCache.set(cacheKey, dataUrl);

  const ratio = ((compressed.length / buffer.length) * 100).toFixed(0);
  console.log(`[AssetStore] 压缩: ${(buffer.length / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB (${ratio}%)`);

  return dataUrl;
}

/**
 * 加载本地图片并压缩为 data URL
 */
async function loadLocalImageAsDataUrl(relativePath) {
  const absolutePath = path.resolve(PROJECT_ROOT, relativePath);
  const cacheKey = `compressed:${absolutePath}`;

  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey);
  }

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`素材文件不存在: ${absolutePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  return compressToDataUrl(buffer, cacheKey);
}

function normalizePlayerId(input) {
  const playerId = String(input);
  if (players[playerId]) {
    return playerId;
  }

  for (const [canonicalId, player] of Object.entries(players)) {
    if (Array.isArray(player.external_ids) && player.external_ids.includes(playerId)) {
      return canonicalId;
    }
  }

  return null;
}

function normalizeSceneId(input) {
  const sceneId = String(input);
  if (scenes[sceneId]) {
    return sceneId;
  }

  for (const [canonicalId, scene] of Object.entries(scenes)) {
    if (scene.external_id === sceneId) {
      return canonicalId;
    }
  }

  return null;
}

// 球星参考图面部裁切比例（取图片顶部 N%，保留头部+上半身及身体比例）
const PLAYER_FACE_CROP = parseFloat(process.env.PLAYER_FACE_CROP) || 0.85;

/**
 * 加载球星参考图并裁切至上半部分，使面部在压缩后占更多像素。
 * 裁切比例由 PLAYER_FACE_CROP 控制（默认 0.5 = 顶部50%）。
 */
async function loadPlayerFaceImage(relativePath) {
  const absolutePath = path.resolve(PROJECT_ROOT, relativePath);
  const cacheKey = `face_crop:${absolutePath}`;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);
  if (!fs.existsSync(absolutePath)) throw new Error(`球星参考图不存在: ${absolutePath}`);

  const buffer = fs.readFileSync(absolutePath);
  const metadata = await sharp(buffer).metadata();
  const cropHeight = Math.floor(metadata.height * PLAYER_FACE_CROP);

  const compressed = await sharp(buffer)
    .extract({ left: 0, top: 0, width: metadata.width, height: cropHeight })
    .resize(COMPRESS_MAX_DIM, COMPRESS_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: COMPRESS_QUALITY })
    .toBuffer();

  const dataUrl = `data:image/jpeg;base64,${compressed.toString('base64')}`;
  imageCache.set(cacheKey, dataUrl);

  const origKB = (buffer.length / 1024).toFixed(0);
  const newKB = (compressed.length / 1024).toFixed(0);
  console.log(`[AssetStore] 面部裁切(${Math.round(PLAYER_FACE_CROP * 100)}%): ${origKB}KB → ${newKB}KB`);
  return dataUrl;
}

/**
 * 加载球星参考图，按球星分组返回。
 * 每个球星可能有多张参考图（不同角度），文件不存在时自动跳过。
 * 每张参考图裁切至上半部分以提升面部像素密度。
 *
 * @returns {{ star_id: string, name: string, refs: { image: Promise<string>, source: string }[] }[]}
 */
function getPlayerReferenceImages(starIds) {
  return starIds.map(starId => {
    const player = players[starId];
    const refPaths = player.reference_images || [];
    if (refPaths.length === 0) throw new Error(`球星 ${player.name} 未配置标准参考图`);

    const refs = [];
    for (const relativePath of refPaths) {
      const absPath = path.resolve(PROJECT_ROOT, relativePath);
      if (!fs.existsSync(absPath)) {
        console.warn(`[AssetStore] 球星参考图不存在，跳过: ${relativePath}`);
        continue;
      }
      refs.push({ image: loadPlayerFaceImage(relativePath), source: relativePath });
    }
    if (refs.length === 0) throw new Error(`球星 ${player.name} 无可用参考图`);
    return { star_id: starId, name: player.name, refs };
  });
}

/**
 * 加载场景成图参考（参考图目录）
 * 按场景ID + 性别匹配对应参考图
 *
 * @param {string} sceneId - 场景内部 ID（如 "1"）
 * @param {string} gender - "male" 或 "female"
 * @returns {Promise<string|null>} base64 data URL 或 null
 */
async function loadReferenceImage(sceneId, _userMode = 'adult', gender = 'male') {
  const genderMap = { male: '男', female: '女' };
  const label = genderMap[gender] || '男';
  const baseName = `场景${sceneId}-${label}`;
  const extensions = ['.png', '.jpg', '.jpeg', '.webp'];

  // 按优先级查找匹配的参考图文件
  for (const ext of extensions) {
    const absPath = path.resolve(PROJECT_ROOT, '素材', '参考图', `${baseName}${ext}`);
    if (fs.existsSync(absPath)) {
      console.log(`[AssetStore] 加载参考图: ${baseName}${ext}`);
      return loadLocalImageAsDataUrl(path.relative(PROJECT_ROOT, absPath));
    }
  }

  // 回退到场景预览图
  const scene = scenes[sceneId];
  if (scene?.base_image_anchor) {
    const fallbackPath = path.resolve(PROJECT_ROOT, '素材', '场景预览图', scene.base_image_anchor);
    if (fs.existsSync(fallbackPath)) {
      console.log(`[AssetStore] 回退场景预览图: ${scene.base_image_anchor}`);
      return loadLocalImageAsDataUrl(path.relative(PROJECT_ROOT, fallbackPath));
    }
  }

  console.warn(`[AssetStore] 未找到参考图: ${baseName}`);
  return null;
}

/**
 * 加载场景关联的球衣参考图
 * 从 scenes.json 的 jersey_references 字段读取路径列表
 *
 * @param {string} sceneId - 场景内部 ID（如 "2"）
 * @param {number} [maxCount] - 最多加载几张（由 native_params.max_ref_images 控制）
 * @returns {Promise<string[]>} base64 data URL 数组
 */
async function loadJerseyReferences(sceneId, maxCount) {
  const scene = scenes[sceneId];
  if (!scene || !Array.isArray(scene.jersey_references) || scene.jersey_references.length === 0) {
    return [];
  }

  const limit = maxCount != null ? maxCount : scene.jersey_references.length;
  const toLoad = scene.jersey_references.slice(0, limit);

  const results = [];
  for (const relPath of toLoad) {
    const absPath = path.resolve(PROJECT_ROOT, relPath);
    if (fs.existsSync(absPath)) {
      results.push(await loadLocalImageAsDataUrl(relPath));
    } else {
      console.warn(`[AssetStore] 球衣参考图不存在: ${absPath}`);
    }
  }

  console.log(`[AssetStore] 场景${sceneId} 球衣参考图: 已加载 ${results.length}/${toLoad.length} 张 (限制: ${limit})`);
  return results;
}

/**
 * 加载场景关联的啤酒杯参考图
 *
 * @param {string} sceneId - 场景内部 ID（如 "1"）
 * @returns {Promise<string|null>} base64 data URL 或 null
 */
async function loadBeerMugReference(sceneId) {
  const scene = scenes[sceneId];
  if (!scene || !scene.beer_mug_reference) {
    return null;
  }

  const relPath = scene.beer_mug_reference;
  const absPath = path.resolve(PROJECT_ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    console.warn(`[AssetStore] 酒杯参考图不存在: ${absPath}`);
    return null;
  }

  console.log(`[AssetStore] 场景${sceneId} 酒杯参考图: ${relPath}`);
  return loadLocalImageAsDataUrl(relPath);
}

/**
 * 加载场景关联的合照参考图（真实官方宣传照，用于构图引导）
 * 从 scenes.json 的 composition_reference 字段读取路径
 *
 * @param {string} sceneId - 场景内部 ID
 * @returns {Promise<string|null>} base64 data URL 或 null
 */
async function loadCompositionReference(sceneId) {
  const scene = scenes[sceneId];
  if (!scene || !scene.composition_reference) {
    return null;
  }

  const relPath = scene.composition_reference;
  const absPath = path.resolve(PROJECT_ROOT, relPath);
  if (!fs.existsSync(absPath)) {
    console.warn(`[AssetStore] 合照参考图不存在: ${absPath}`);
    return null;
  }

  console.log(`[AssetStore] 场景${sceneId} 合照参考图: ${relPath}`);
  return loadLocalImageAsDataUrl(relPath);
}

async function loadBackgroundReference(sceneId) {
  const scene = scenes[sceneId];
  if (!scene || !scene.base_image_anchor) {
    return null;
  }

  // 支持完整路径和相对路径
  const absPath = scene.base_image_anchor.startsWith('素材')
    ? path.resolve(PROJECT_ROOT, scene.base_image_anchor)
    : path.resolve(PROJECT_ROOT, '素材', '场景预览图', scene.base_image_anchor);

  if (!fs.existsSync(absPath)) {
    console.warn(`[AssetStore] 背景参考图不存在: ${absPath}`);
    return null;
  }

  const relPath = path.relative(PROJECT_ROOT, absPath);
  console.log(`[AssetStore] 场景${sceneId}背景参考图: ${relPath}`);
  return loadLocalImageAsDataUrl(relPath);
}

module.exports = {
  normalizePlayerId,
  normalizeSceneId,
  getPlayerReferenceImages,
  loadReferenceImage,
  loadJerseyReferences,
  loadBeerMugReference,
  loadBackgroundReference,
  loadCompositionReference,
  compressToDataUrl,
};
