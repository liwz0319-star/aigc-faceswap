/**
 * 豆包视觉模型客户端
 * 用途：分析用户照片，生成个性化外貌文字描述，提升 Seedream 人脸还原准确度
 *
 * API: doubao-1-5-vision-pro-32k-250115
 * Endpoint: https://ark.cn-beijing.volces.com/api/v3/chat/completions
 */

const axios = require('axios');

const VISION_API_URL   = process.env.VISION_API_URL   || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const VISION_API_KEY   = process.env.VISION_API_KEY   || '';
const VISION_MODEL     = process.env.VISION_MODEL     || 'doubao-1-5-vision-pro-32k-250115';
const VISION_TIMEOUT   = 30000;

const FACE_DESCRIBE_PROMPT = `You are analyzing a person's facial appearance to help an AI image generator reproduce their face accurately. Look at the provided photo(s) carefully.

Describe this person's appearance in a single detailed English paragraph covering:
- Approximate age range and gender
- Face shape (oval / round / square / heart / diamond)
- Eyes: size (large/medium/small), shape (almond/round/monolid/double eyelid), openness
- Skin tone (fair / light / medium / tan / dark brown, etc.)
- Hair: color, length, style (straight/wavy/curly, short/medium/long)
- Nose: bridge height, width
- Lips: thickness, shape
- Any notable features (high cheekbones, strong jaw, dimples, freckles, glasses, etc.)

Be factual and specific. Do NOT include guesses about ethnicity as a label — just describe physical features. Output English only. One paragraph, no bullet points.`;

/**
 * 将 base64 data URL 转为 API 所需格式的 image_url 对象
 */
function toImageUrlObj(base64DataUrl) {
  return {
    type: 'image_url',
    image_url: { url: base64DataUrl },
  };
}

/**
 * 调用豆包视觉模型分析用户照片，返回个性化外貌描述
 * @param {string[]} userImages - base64 data URL 数组（1~4张）
 * @returns {Promise<string>} 英文外貌描述文字
 */
async function describeUserAppearance(userImages) {
  if (!VISION_API_KEY) throw new Error('[VisionClient] VISION_API_KEY 未配置');
  if (!userImages || userImages.length === 0) throw new Error('[VisionClient] 无用户照片');

  const imageContents = userImages.map(toImageUrlObj);

  const messages = [
    {
      role: 'user',
      content: [
        ...imageContents,
        { type: 'text', text: FACE_DESCRIBE_PROMPT },
      ],
    },
  ];

  const t0 = Date.now();
  const res = await axios.post(
    VISION_API_URL,
    {
      model: VISION_MODEL,
      messages,
      max_tokens: 400,
      temperature: 0.3,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VISION_API_KEY}`,
      },
      timeout: VISION_TIMEOUT,
    }
  );

  const description = res.data?.choices?.[0]?.message?.content?.trim();
  if (!description) throw new Error('[VisionClient] 模型返回空描述');

  console.log(`[VisionClient] 外貌解读完成 (${Date.now() - t0}ms): ${description.substring(0, 120)}...`);
  return description;
}

module.exports = { describeUserAppearance };
