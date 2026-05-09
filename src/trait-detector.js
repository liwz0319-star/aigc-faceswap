'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

const VALID_GENDERS = new Set(['male', 'female']);
const VALID_EYEWEAR = new Set(['none', 'glasses', 'sunglasses']);
const VALID_HAIR_LENGTHS = new Set(['short', 'medium', 'long']);
const VALID_HAIR_STYLES = new Set(['straight', 'wavy', 'curly']);
const VALID_FACIAL_HAIR = new Set(['none', 'stubble', 'mustache', 'beard']);
const VALID_AGE_RANGES = new Set(['teens', '20s', '30s', '40s', '50s+']);

const DETECTION_SYSTEM_PROMPT = `You are a portrait analysis assistant for an image generation pipeline. Analyze the provided portrait photo and return a JSON object describing the person's visible appearance. Return ONLY valid JSON with no markdown, no code fences, no explanation.`;

const DETECTION_USER_PROMPT = `Analyze this portrait and return exactly this JSON structure (no markdown, no extra text):
{
  "gender": "male" or "female",
  "eyewear": "none" or "glasses" or "sunglasses",
  "eyewear_description": "describe frames (e.g. thin black rectangular frames) or empty string if none",
  "hair_length": "short" or "medium" or "long",
  "hair_color": "e.g. black, dark brown, brown, auburn, blonde, silver",
  "hair_style": "straight" or "wavy" or "curly",
  "facial_hair": "none" or "stubble" or "mustache" or "beard",
  "facial_hair_description": "describe (e.g. thin black mustache) or empty string if none",
  "age_range": "teens" or "20s" or "30s" or "40s" or "50s+",
  "note": "Image 2 shows [one sentence: adult Asian male/female with specific hair and eyewear details, for image generation]"
}`;

function validateTraits(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Trait detection returned non-object');
  if (!VALID_GENDERS.has(raw.gender)) throw new Error(`Invalid gender: ${raw.gender}`);
  if (!VALID_EYEWEAR.has(raw.eyewear)) throw new Error(`Invalid eyewear: ${raw.eyewear}`);
  if (!VALID_HAIR_LENGTHS.has(raw.hair_length)) throw new Error(`Invalid hair_length: ${raw.hair_length}`);
  if (!VALID_HAIR_STYLES.has(raw.hair_style)) throw new Error(`Invalid hair_style: ${raw.hair_style}`);
  if (!VALID_FACIAL_HAIR.has(raw.facial_hair)) throw new Error(`Invalid facial_hair: ${raw.facial_hair}`);
  if (!VALID_AGE_RANGES.has(raw.age_range)) throw new Error(`Invalid age_range: ${raw.age_range}`);
  if (typeof raw.note !== 'string' || raw.note.trim().length === 0) throw new Error('Invalid note field');
  return {
    gender: raw.gender,
    eyewear: raw.eyewear,
    eyewear_description: String(raw.eyewear_description || ''),
    hair_length: raw.hair_length,
    hair_color: String(raw.hair_color || 'black'),
    hair_style: raw.hair_style,
    facial_hair: raw.facial_hair,
    facial_hair_description: String(raw.facial_hair_description || ''),
    age_range: raw.age_range,
    note: raw.note,
  };
}

async function detectUserTraits(imagePath, { apiKey, model, baseUrl } = {}) {
  const resolvedApiKey = apiKey || process.env.VISION_API_KEY;
  if (!resolvedApiKey) throw new Error('VISION_API_KEY is required for trait detection');
  const resolvedModel = model || process.env.DOUBAO_VISION_MODEL || process.env.VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115';
  const resolvedBaseUrl = baseUrl || ARK_BASE_URL;

  const imageBuffer = await fs.promises.readFile(imagePath).catch((err) => {
    throw new Error(`Trait detection: cannot read image at ${imagePath}: ${err.message}`);
  });
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const SUPPORTED_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const mimeType = SUPPORTED_MIME[ext];
  if (!mimeType) throw new Error(`Trait detection: unsupported image format '${ext}' for ${imagePath}`);

  const response = await fetch(`${resolvedBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resolvedApiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages: [
        { role: 'system', content: DETECTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            { type: 'text', text: DETECTION_USER_PROMPT },
          ],
        },
      ],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Trait detection API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Trait detection: empty response from API');

  let raw;
  try {
    raw = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Trait detection: could not parse JSON from: ${content.slice(0, 200)}`);
    raw = JSON.parse(jsonMatch[0]);
  }

  return validateTraits(raw);
}

async function loadTraitsCache(cacheFile) {
  try {
    const text = await fs.promises.readFile(cacheFile, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`Failed to load traits cache at ${cacheFile}: ${err.message}`);
  }
}

async function saveTraitsCache(cacheFile, cache) {
  await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.promises.writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
}

async function loadOrDetectTraits(userId, imagePath, cacheFile, options = {}) {
  const cache = await loadTraitsCache(cacheFile);
  if (cache[userId]) return cache[userId];
  const traits = await detectUserTraits(imagePath, options);
  cache[userId] = traits;
  await saveTraitsCache(cacheFile, cache);
  return traits;
}

module.exports = { detectUserTraits, loadOrDetectTraits, loadTraitsCache, saveTraitsCache, validateTraits };
