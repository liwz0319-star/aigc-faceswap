/**
 * Seedream API 客户端
 * 通过 chat/completions 端点调用 Seedream 图片生成
 *
 * 调用方式：
 * - 端点: POST {LAS_BASE_URL}/chat/completions
 * - 请求体: OpenAI chat 格式，prompt 放在 message 中
 * - 可选传入场景参考图作为 image_url
 * - 响应: chat.completion 格式，图片 URL 嵌在 markdown ![image_0](url) 中
 */

const axios = require('axios');

const LAS_BASE_URL = process.env.LAS_BASE_URL || 'https://newapi.aisonnet.org/v1';
const LAS_API_KEY = process.env.LAS_API_KEY;
const MODEL = process.env.SEEDREAM_MODEL || 'seedream-4.6';

const REQUEST_TIMEOUT = 180000;   // 3分钟
const STREAM_TIMEOUT = 240000;    // 4分钟

/**
 * 从 chat completion 响应中提取图片 URL
 */
function extractImageUrls(content) {
  const urls = [];
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

/**
 * 调用 Seedream 图片生成（通过 chat/completions）
 *
 * @param {Object} params
 * @param {string} params.prompt - 文字 prompt（三模块拼装后的完整 prompt）
 * @param {string} [params.scene_image] - 可选的场景参考图 base64 data URL
 * @param {string[]} [params.extra_images=[]] - 额外参考图数组（如球衣参考图）base64 data URL
 * @param {string} [params.size='2048x2048'] - 图片尺寸
 * @returns {Promise<{url: string, urls: string[], usage: Object}>}
 */
async function generateImage({ prompt, negative_prompt, scene_image, extra_images = [], size = '2048x2048' }) {
  if (!LAS_API_KEY) {
    throw new Error('LAS_API_KEY 未配置');
  }

  // Seedream 无限制，nano-banana 等模型有图片数量限制
  const isSeedreamModel = MODEL.toLowerCase().includes('seedream');
  const maxImages = isSeedreamModel ? Infinity : 9;

  // 构建 content：文字 prompt + 可选场景参考图 + 额外参考图（球衣等）
  const content = [
    { type: 'text', text: prompt },
  ];

  let imageCount = 0;

  if (scene_image && imageCount < maxImages) {
    content.push({
      type: 'image_url',
      image_url: { url: scene_image, detail: 'high' },
    });
    imageCount++;
  }

  // 添加额外参考图（球衣等）— 过滤掉无效图片，不超过最大数量
  for (const img of extra_images) {
    if (imageCount >= maxImages) break;
    if (!img || typeof img !== 'string') continue;
    // 接受 base64 data URL 和 HTTP(S) URL
    if (!img.startsWith('data:') && !img.startsWith('http://') && !img.startsWith('https://')) continue;
    content.push({
      type: 'image_url',
      image_url: { url: img, detail: 'high' },
    });
    imageCount++;
  }

  console.log(`[SeedreamClient] model=${MODEL} | prompt=${prompt.length}chars | images=${imageCount}/${extra_images.length + (scene_image?1:0)} | max=${maxImages === Infinity ? '∞' : maxImages}`);

  // nano-banana 不需要 system 消息（会占用 prompt 额度），Seedream 使用 system 消息
  const messages = isSeedreamModel
    ? [
        { role: 'system', content: 'Generate an image with EXACTLY the people described. Do NOT add any extra people beyond those explicitly named. No crowds, no bystanders, no background figures.' },
        { role: 'user', content },
      ]
    : [{ role: 'user', content }];

  const requestBody = {
    model: MODEL,
    messages,
  };

  // Seedream 系列支持 size 和 negative_prompt 参数
  if (isSeedreamModel) {
    requestBody.size = size;
    if (negative_prompt) {
      requestBody.negative_prompt = negative_prompt;
    }
  } else {
    // 非 Seedream 模型（如 Nano_Banana_Pro）通过参数传递 size
    // 部分中转平台支持 size 参数
    requestBody.size = size;
  }

  const response = await axios.post(
    `${LAS_BASE_URL}/chat/completions`,
    requestBody,
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LAS_API_KEY}`,
      },
      timeout: REQUEST_TIMEOUT,
    }
  ).catch(err => {
    const errData = err.response?.data;
    console.error('[SeedreamClient] API 错误响应:', JSON.stringify(errData || err.message).substring(0, 500));
    throw err;
  });

  return parseChatResponse(response.data);
}

/**
 * 解析 chat/completions 格式的 Seedream 响应
 */
function parseChatResponse(respData) {
  if (respData.error) {
    const errMsg = respData.error.message || JSON.stringify(respData.error);
    throw new Error(`Seedream API 错误: ${errMsg}`);
  }

  const choices = respData.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('Seedream 未返回有效响应');
  }

  const content = choices[0].message?.content || '';
  const urls = extractImageUrls(content);

  if (urls.length === 0) {
    throw new Error('Seedream 响应中未找到图片 URL');
  }

  return {
    url: urls[0],
    urls,
    usage: respData.usage || null,
  };
}

/**
 * 流式调用 Seedream
 */
async function generateImageStream({ prompt, scene_image, extra_images = [], size = '2048x2048' }, onPartial) {
  if (!LAS_API_KEY) {
    throw new Error('LAS_API_KEY 未配置');
  }

  const content = [
    { type: 'text', text: prompt },
  ];

  if (scene_image) {
    content.push({
      type: 'image_url',
      image_url: { url: scene_image, detail: 'high' },
    });
  }

  for (const img of extra_images) {
    content.push({
      type: 'image_url',
      image_url: { url: img, detail: 'high' },
    });
  }

  const requestBody = {
    model: MODEL,
    messages: [{ role: 'user', content }],
    size,
    stream: true,
    watermark: false,
  };

  const response = await axios.post(
    `${LAS_BASE_URL}/chat/completions`,
    requestBody,
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LAS_API_KEY}`,
      },
      responseType: 'stream',
      timeout: STREAM_TIMEOUT,
    }
  );

  return new Promise((resolve, reject) => {
    let fullContent = '';

    response.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const event = JSON.parse(jsonStr);
          const delta = event.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullContent += delta;
            onPartial?.(delta, fullContent);
          }
        } catch {
          // 忽略非 JSON 行
        }
      }
    });

    response.data.on('end', () => {
      const urls = extractImageUrls(fullContent);
      if (urls.length > 0) {
        resolve({ url: urls[0], urls, usage: null });
      } else {
        reject(new Error('流式响应中未找到图片 URL'));
      }
    });

    response.data.on('error', reject);
  });
}

module.exports = { generateImage, generateImageStream, extractImageUrls };
