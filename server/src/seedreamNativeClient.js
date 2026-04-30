/**
 * Seedream 官方 API 客户端（native 模式）
 * 直接调用火山方舟 /api/v3/images/generations 端点
 */

const axios = require('axios');

const API_KEY = process.env.SEEDREAM_NATIVE_API_KEY;
const API_URL = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MODEL = process.env.SEEDREAM_NATIVE_MODEL || 'doubao-seedream-4-5-251128';

const DEFAULT_STRENGTH = parseFloat(process.env.SEEDREAM_IMAGE_STRENGTH) || 0.5;
const DEFAULT_GUIDANCE = parseFloat(process.env.SEEDREAM_GUIDANCE_SCALE) || 8;
const REQUEST_TIMEOUT = 180000; // 3 分钟

/**
 * 调用 Seedream 官方 API 生成图片
 *
 * @param {Object} params
 * @param {string} params.prompt - 文字 prompt
 * @param {string[]} [params.images=[]] - 参考图数组（base64 data URL）
 * @param {string} [params.size='1664x1664'] - 图片尺寸
 * @param {string} [params.negative_prompt] - 负面提示词
 * @param {Object} [params.scene_params] - 场景级参数覆盖（来自 scenes.json native_params）
 * @returns {Promise<{url: string, urls: string[]}>}
 */
async function generateNativeImage({ prompt, images = [], size = '1664x1664', negative_prompt, scene_params = {} }) {
  if (!API_KEY) {
    throw new Error('SEEDREAM_NATIVE_API_KEY 未配置');
  }

  // 允许 scene_params.model 覆盖全局模型（用于场景级模型切换）
  const resolvedModel = scene_params.model || MODEL;

  const strength = scene_params.strength ?? DEFAULT_STRENGTH;
  const guidanceScale = scene_params.guidance_scale ?? DEFAULT_GUIDANCE;
  const sceneNegPrompt = scene_params.negative_prompt || '';

  // 合并负面提示词：场景级 + 调用级
  const combinedNegPrompt = [sceneNegPrompt, negative_prompt].filter(Boolean).join(', ');

  const payload = {
    model: resolvedModel,
    prompt,
    sequential_image_generation: 'disabled',
    response_format: 'url',
    size,
    stream: false,
    watermark: true,
  };

  if (images.length > 0) {
    payload.image = images;
    payload.strength = strength;
  }

  // Seedream 5.0 不支持 guidance_scale
  if (guidanceScale > 0 && !resolvedModel.includes('5-0')) {
    payload.guidance_scale = guidanceScale;
  }

  if (combinedNegPrompt) {
    payload.negative_prompt = combinedNegPrompt;
  }

  console.log(`[NativeClient] model=${resolvedModel} | images=${images.length} | size=${size} | strength=${payload.strength || 'N/A'} | guidance=${payload.guidance_scale || 'N/A'}`);

  const response = await axios.post(API_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    timeout: REQUEST_TIMEOUT,
  }).catch(err => {
    const errData = err.response?.data;
    if (errData?.error) {
      const e = errData.error;
      throw new Error(`Seedream API [${e.code || ''}]: ${e.message || JSON.stringify(e)}`);
    }
    throw err;
  });

  return parseResponse(response.data);
}

function parseResponse(data) {
  if (data.error) {
    throw new Error(`Seedream API [${data.error.code || ''}]: ${data.error.message || JSON.stringify(data.error)}`);
  }
  if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error('Seedream 未返回图片数据');
  }
  const urls = data.data.map(item => item.url).filter(Boolean);
  if (urls.length === 0) {
    throw new Error('Seedream 响应中未找到图片 URL');
  }
  return { url: urls[0], urls };
}

module.exports = { generateNativeImage };
