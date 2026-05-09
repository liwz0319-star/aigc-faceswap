#!/usr/bin/env node
/**
 * run-scene1-v3.js  (v2 — mask inpainting)
 * 场景1 v3 — 只生成 Stage A（head inpainting）。
 *
 * 核心优化 (v2):
 *   1. 使用 mask_image 把编辑区限定在头/发/颈区域，彻底保护背景和身体。
 *   2. 修正所有 20 个 user 的性别/底图路由。
 *   3. Seedream 4.5: strength=0.78（有 mask 时用高 strength 才能覆盖空脸人台）
 *      Seedream 5.0: strength=0.82（同上，并开启 strength 参数）
 *
 * 用法:
 *   node scripts/run-scene1-v3.js [--scene scene1v3] [--env path/.env]
 *     [--user-dir path/to/user] [--concurrency 4] [--models seedream_4_5,seedream_5_0]
 *     [--users user1,user2] [--traits-source cache|llm]
 *
 * 支持的 --scene 值: scene1v3 (按 traits.gender 路由), scene1v3_male, scene1v3_female
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const { buildStagePrompts } = require('../src/pipeline');
const { loadSceneConfig } = require('../src/scenes');
const {
  eyewearDescription,
  resolveScene6TraitsForUsers,
  resolveScene1v3SceneId,
  traitsHasEyewear,
  traitsHasNoEyewear,
} = require('../src/scene1v3-traits');

const execFileAsync = promisify(execFile);

const PROJECT_DIR = path.resolve(__dirname, '..');
const DEFAULT_ENV = path.join(PROJECT_DIR, 'server', '.env');
const DEFAULT_USER_DIR = path.join(PROJECT_DIR, '素材', '用户测试照片');
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_STAGE_ATTEMPTS = 5;
const DEFAULT_FETCH_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_TRAITS_CACHE = path.join(PROJECT_DIR, '素材', '用户测试照片', 'traits.json');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const BASE_IMAGE_MAX_PX = 1920;
const USER_IMAGE_MAX_PX = 1024;
const RESULT_DIR = path.join(PROJECT_DIR, '下载结果');

// Stage A mask regions.
// KEY INSIGHT (Polanyi): mask area = head size. The model fills the white ellipse
// "naturally", so mask geometry is the primary scale controller — not prompt text.
// These are derived from the scene editRegions (tight head bounds) + 35-50% hair clearance.
// Male editRegion center: (0.616, 0.365); female center: (0.620, 0.332).
const STAGE_A_MASK_REGIONS = {
  // Male: editRegion w:0.2015, h:0.1947 → Stage A adds ~35% for hair clearance
  male:   [{ id: 'head_hair_neck', x: 0.52, y: 0.29, width: 0.17, height: 0.23, shape: 'ellipse', feather: 18 }],
  // Female: editRegion w:0.2047, h:0.2125 → Stage A adds ~50% width (long hair) and ~80% height (hair above)
  female: [{ id: 'head_hair_neck', x: 0.49, y: 0.25, width: 0.22, height: 0.28, shape: 'ellipse', feather: 18 }],
};

const MODELS = [
  {
    id: 'seedream_4_5',
    model: 'doubao-seedream-4-5-251128',
    outputFormat: null,
    // Reduced from 0.85: smaller mask → less creative license needed to fill it
    maskStrength: 0.78,
    includeStrength: true,
    includeNegativePrompt: true,
  },
  {
    id: 'seedream_5_0',
    model: 'doubao-seedream-5-0-260128',
    outputFormat: 'png',
    // Reduced from 0.88
    maskStrength: 0.82,
    includeStrength: true,
    includeNegativePrompt: false,
  },
];

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv(args.env);

  const users = filterUsers(listUserImages(args.userDir), args.users);
  if (users.length === 0) throw new Error(`${args.userDir} 下没有可用图片`);
  const traitsMap = await resolveScene6TraitsForUsers(users, {
    source: args.traitsSource,
    cacheFile: args.traitsCache,
  });
  for (const user of users) {
    const traits = traitsMap[user.id];
    console.log(`[traits] ${user.id}: source=${args.traitsSource}, gender=${traits.gender}, eyewear=${traits.eyewear}`);
  }

  const sceneCache = new Map();
  const getScene = (traits) => {
    const sceneId = resolveSceneId(args.scene, traits);
    if (!sceneCache.has(sceneId)) {
      sceneCache.set(sceneId, loadSceneConfig(sceneId));
    }
    return sceneCache.get(sceneId);
  };

  const selectedModels = selectModels(args.models);

  const ts = formatTimestamp(new Date());
  const runRoot = path.join(
    PROJECT_DIR,
    'runs',
    `user_folder_matrix_${args.scene}_stagea_${ts}`
  );
  const outDir = args.outDir || path.join(RESULT_DIR, `${args.scene}_stagea_${ts}`);
  await fs.promises.mkdir(runRoot, { recursive: true });
  await fs.promises.mkdir(path.join(outDir, 'images'), { recursive: true });

  // Pre-generate head masks for male and female bases (shared across all jobs).
  console.log('Generating base masks...');
  const maskDir = path.join(runRoot, '00_masks');
  await fs.promises.mkdir(maskDir, { recursive: true });
  const baseMasks = await prepareBaseMasks(maskDir);
  console.log(`Masks ready: male=${baseMasks.male}, female=${baseMasks.female}`);

  const jobs = users.flatMap((user) => {
    const traits = traitsMap[user.id];
    const scene = getScene(traits);
    const gender = traits.gender || 'male';
    const maskImage = baseMasks[gender];
    const prompts = buildStagePrompts({
      targetPerson: scene.target,
      targetDetail: scene.targetDetail,
      protectedPerson: scene.protectedPerson,
      referenceImageCount: scene.referenceImages?.length || 0,
    });
    return selectedModels.map((model) => ({
      runRoot,
      outDir,
      scene,
      prompts,
      user,
      model,
      maskImage,
      traits,
      traitsSource: args.traitsSource,
    }));
  });

  for (const scene of sceneCache.values()) {
    await fs.promises.writeFile(
      path.join(runRoot, `${scene.id}.json`),
      `${JSON.stringify(scene, null, 2)}\n`
    );
  }

  console.log(`Scene: ${args.scene}`);
  console.log(`Resolved scenes: ${Array.from(sceneCache.keys()).join(', ')}`);
  console.log(`Users: ${users.map((user) => user.id).join(', ')}`);
  console.log(`Models: ${selectedModels.map((model) => model.id).join(', ')}`);
  console.log(`Jobs: ${jobs.length}; concurrency: ${args.concurrency}`);
  console.log(`Stage A only (mask inpainting) — Stage B and compositing are skipped.`);
  console.log(`Result dir: ${outDir}`);

  const results = await runPool(jobs, args.concurrency, runJob);

  const summary = {
    created_at: new Date().toISOString(),
    user_dir: args.userDir,
    env_file: args.env,
    traits_source: args.traitsSource,
    traits_cache: args.traitsSource === 'cache' ? args.traitsCache : null,
    scene: args.scene,
    stage: 'stage_a_mask_inpainting',
    run_root: runRoot,
    out_dir: outDir,
    resolved_scenes: Array.from(sceneCache.keys()),
    results,
  };
  // Write to runs/ (debug)
  await fs.promises.writeFile(
    path.join(runRoot, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`
  );
  await fs.promises.writeFile(path.join(runRoot, 'summary.md'), renderSummary(summary));

  // Write to result/ (clean outputs)
  await fs.promises.writeFile(
    path.join(outDir, 'manifest.json'),
    `${JSON.stringify(summary, null, 2)}\n`
  );
  await fs.promises.writeFile(path.join(outDir, 'summary.md'), renderSummary(summary));
  await fs.promises.writeFile(path.join(outDir, 'overview.html'), buildOverviewHtml(summary, outDir));

  console.log(`\nResult: ${outDir}`);
  console.log(`Summary: ${path.join(runRoot, 'summary.md')}`);

  if (results.some((item) => item.status !== 'completed')) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// mask generation
// ---------------------------------------------------------------------------

async function prepareBaseMasks(maskDir) {
  const masks = {};
  for (const gender of ['male', 'female']) {
    const sceneId = gender === 'male' ? 'scene1v3_male' : 'scene1v3_female';
    const scene = loadSceneConfig(sceneId);
    const sourceImage = path.join(PROJECT_DIR, scene.base);
    const maskPath = path.join(maskDir, `mask_${gender}.png`);
    await createMask({ sourceImage, outputImage: maskPath, regions: STAGE_A_MASK_REGIONS[gender] });
    masks[gender] = maskPath;
  }
  return masks;
}

async function createMask({ sourceImage, outputImage, regions }) {
  const dims = await getImageDimensions(sourceImage);
  const normalized = regions.map((r) => ({
    ...r,
    x: Math.round(dims.width * r.x),
    y: Math.round(dims.height * r.y),
    width: Math.round(dims.width * r.width),
    height: Math.round(dims.height * r.height),
  }));
  const conditions = normalized.map((r) => {
    if (r.shape === 'ellipse') {
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const rx = Math.max(1, r.width / 2);
      const ry = Math.max(1, r.height / 2);
      return `lte(pow((X-${cx})/${rx},2)+pow((Y-${cy})/${ry},2),1)`;
    }
    return `between(X,${r.x},${r.x + r.width})*between(Y,${r.y},${r.y + r.height})`;
  });
  const filter = `format=gray,geq=lum='if(gt(${conditions.join('+')},0),255,0)'`;
  await execFileAsync('ffmpeg', [
    '-y', '-f', 'lavfi',
    '-i', `color=c=black:s=${dims.width}x${dims.height}`,
    '-vf', filter, '-frames:v', '1', outputImage,
  ]);
}

async function getImageDimensions(imagePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0:s=x', imagePath,
  ]);
  const [width, height] = stdout.trim().split('x').map(Number);
  if (!width || !height) throw new Error(`无法读取图片尺寸: ${imagePath}`);
  return { width, height };
}

// ---------------------------------------------------------------------------
// job runner — Stage A only
// ---------------------------------------------------------------------------

async function runJob({ runRoot, outDir, scene, prompts, user, model, maskImage, traits, traitsSource }) {
  const userPrompts = buildUserPrompts(prompts, user, traits);
  const jobDir = path.join(runRoot, user.id, model.id);
  const inputDir = path.join(jobDir, '00_inputs');
  const stageADir = path.join(jobDir, '02_stage_a_body_align');
  const referenceImagePaths = resolveSceneReferenceImages(scene);

  for (const dir of [inputDir, stageADir]) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  const userTraitsPath = path.join(inputDir, 'user_traits.json');
  await fs.promises.writeFile(userTraitsPath, `${JSON.stringify(traits, null, 2)}\n`);

  const baseImage = path.join(inputDir, 'base.jpg');
  const userImage = path.join(inputDir, 'user.jpg');
  const stageAImage = path.join(
    stageADir,
    `image${model.outputFormat === 'png' ? '.png' : '.jpg'}`
  );

  await copyAndCompress(path.join(PROJECT_DIR, scene.base), baseImage, BASE_IMAGE_MAX_PX);
  await copyAndCompress(user.sourcePath, userImage, USER_IMAGE_MAX_PX);

  const referenceInputImages = [];
  for (let index = 0; index < referenceImagePaths.length; index += 1) {
    const source = referenceImagePaths[index];
    const local = path.join(inputDir, `reference_${index + 1}.jpg`);
    await copyAndCompress(source, local, BASE_IMAGE_MAX_PX);
    referenceInputImages.push(local);
  }

  await writePromptFiles(stageADir, userPrompts.bodyAlign);

  const label = `${user.id} / ${model.id}`;
  console.log(`[start] ${label}`);
  const startedAt = new Date();

  try {
    await generateStage({
      model,
      stage: userPrompts.bodyAlign,
      imagePaths: [baseImage, userImage, ...referenceInputImages],
      maskImagePath: maskImage,
      outputPath: stageAImage,
      responsePath: path.join(stageADir, 'response.json'),
    });

    // Copy to result/images/ for easy access
    const ext = path.extname(stageAImage);
    const resultImageName = `${user.id}_${model.id}${ext}`;
    const resultImagePath = path.join(outDir, 'images', resultImageName);
    await fs.promises.copyFile(stageAImage, resultImagePath);
    // Copy user portrait thumbnail too (once per user; safe to overwrite)
    const userThumbPath = path.join(outDir, 'images', `_ref_${user.id}.jpg`);
    if (!fs.existsSync(userThumbPath)) {
      await fs.promises.copyFile(path.join(jobDir, '00_inputs', 'user.jpg'), userThumbPath);
    }

    const result = buildResult({
      scene,
      user,
      model,
      status: 'completed',
      startedAt,
      jobDir,
      stageAImage,
      resultImagePath,
      traits,
      traitsSource,
      userTraitsPath,
    });
    console.log(`[done] ${label}: ${stageAImage}`);
    await fs.promises.writeFile(
      path.join(jobDir, 'result.json'),
      `${JSON.stringify(result, null, 2)}\n`
    );
    return result;
  } catch (error) {
    const result = buildResult({
      scene,
      user,
      model,
      status: 'failed',
      startedAt,
      jobDir,
      stageAImage: null,
      traits,
      traitsSource,
      userTraitsPath,
      error: error.message,
    });
    console.error(`[fail] ${label}: ${redactSecrets(error.message)}`);
    await fs.promises.writeFile(
      path.join(jobDir, 'result.json'),
      `${JSON.stringify(result, null, 2)}\n`
    );
    return result;
  }
}

// ---------------------------------------------------------------------------
// image generation
// ---------------------------------------------------------------------------

async function generateStage({ model, stage, imagePaths, maskImagePath, outputPath, responsePath }) {
  const payload = {
    model: model.model,
    prompt: stage.prompt,
    image: imagePaths.map(toDataUrl),
    sequential_image_generation: 'disabled',
    response_format: 'url',
    size: stage.apiParams.size,
    stream: false,
    watermark: true,
  };

  if (model.outputFormat) payload.output_format = model.outputFormat;
  // Use maskStrength (high, for inpainting blank head) instead of bodyAlign strength
  if (model.includeStrength) payload.strength = model.maskStrength;
  if (maskImagePath) payload.mask_image = toDataUrl(maskImagePath);
  if (model.includeNegativePrompt) payload.negative_prompt = stage.negativePrompt;

  let lastError;
  for (let attempt = 1; attempt <= DEFAULT_STAGE_ATTEMPTS; attempt += 1) {
    try {
      const data = await requestSeedreamImage(payload);
      await fs.promises.writeFile(
        responsePath,
        `${JSON.stringify({ ...data, local_attempt: attempt }, null, 2)}\n`
      );
      const url = data.data?.find((item) => item.url)?.url;
      if (!url) throw new Error('Seedream 响应中没有图片 URL');
      await downloadGeneratedImage(url, outputPath);
      return;
    } catch (error) {
      lastError = error;
      await fs.promises.writeFile(
        `${responsePath}.attempt_${attempt}.error.txt`,
        redactSecrets(error.message)
      );
      if (attempt < DEFAULT_STAGE_ATTEMPTS) {
        const delayMs = Math.min(15000 * attempt, 60000);
        console.error(
          `[retry] ${path.basename(path.dirname(responsePath))} attempt ${attempt}/${DEFAULT_STAGE_ATTEMPTS} failed: ${redactSecrets(error.message)}; retry in ${delayMs / 1000}s`
        );
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

async function requestSeedreamImage(payload) {
  const response = await fetchWithTimeout(
    process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SEEDREAM_NATIVE_API_KEY}`,
      },
      body: JSON.stringify(payload),
    }
  );
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(`Seedream 请求失败: ${JSON.stringify(data)}`);
  return data;
}

async function downloadGeneratedImage(url, outputPath) {
  const imageResponse = await fetchWithTimeout(url);
  if (!imageResponse.ok)
    throw new Error(`图片下载失败: ${imageResponse.status} ${imageResponse.statusText}`);
  await fs.promises.writeFile(outputPath, Buffer.from(await imageResponse.arrayBuffer()));
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });
}

// ---------------------------------------------------------------------------
// prompt building (same logic as v2)
// ---------------------------------------------------------------------------

function buildUserPrompts(prompts, user, traits) {
  return {
    ...prompts,
    bodyAlign: customizeStageForUser(prompts.bodyAlign, user, traits, 'body alignment'),
    faceswap: customizeStageForUser(prompts.faceswap, user, traits, 'identity replacement'),
  };
}

function customizeStageForUser(stage, user, traits, stageName) {
  const resolvedTraits = traits || {};
  const resolvedStageName = stageName || 'generation';
  const gender = resolvedTraits.gender || 'male';
  const isBayernJerseyScene = /FC Bayern jersey|Bayern jersey|red FC Bayern|red-and-white FC Bayern/i.test(stage.prompt);

  const eyewearInstruction =
    traitsHasNoEyewear(resolvedTraits)
      ? [
          'Eyewear constraint: Image 2 has no glasses. The target person must NOT wear glasses, eyeglasses, spectacles, frames, lenses, or sunglasses.',
          'Remove any glasses from the generated target even if the original base target has glasses.',
        ].join('\n')
      : traitsHasEyewear(resolvedTraits)
        ? `Eyewear constraint: Preserve the glasses from Image 2${eyewearDescription(resolvedTraits)}. Match the user portrait eyewear shape and color; do not invent a different frame style.`
        : 'Eyewear constraint: Follow Image 2 exactly for whether the person wears glasses.';

  // Scale anchor: prevent head enlargement regardless of prompt wording
  const headScaleAnchor = isLockerRoomScene(stage.prompt)
    ? 'HEAD SCALE LOCK: the generated head must exactly match the compact blank-mannequin head size visible in Image 1. Use the jersey collar width and shoulder span in Image 1 as hard upper limits for head width. Do not make the head larger than the original blank mannequin head in any dimension. If the face feels too small, that is correct — the camera distance in Image 1 makes heads appear small relative to full-body scale.'
    : '';

  const accessoryBlock = [
    'ACCESSORY EXCLUSION (hard rule): Do NOT copy any accessories from Image 2 into the result.',
    'Forbidden items: earphones, earbuds, headphones, wireless earphones, necklaces, pendants, visible jewelry at neck, earrings, electronic devices, bag straps.',
    'Even if Image 2 clearly shows these items, they must NOT appear in the generated result.',
    'The result must only show the person wearing the FC Bayern jersey from Image 1 — no added accessories from any source.',
  ].join(' ');

  const collarLock = isLockerRoomScene(stage.prompt)
    ? 'COLLAR LOCK (hard rule): The white undershirt collar and red FC Bayern jersey collar at the neck junction must be IDENTICAL to Image 1. Do not bleach, modify, remove, or alter the collar in any way. The collar area is the compositing boundary — any change here ruins the final result.'
    : '';

  const identityInstruction = isBayernJerseyScene
      ? [
          `User-specific identity constraint for ${user.id} during ${resolvedStageName}:`,
          resolvedTraits.note || 'Use Image 2 as the only source of identity traits.',
        eyewearInstruction,
        accessoryBlock,
        collarLock,
        'Do not copy any headwear, hat, beanie, cap, or accessory from Image 2. If Image 2 shows a hair bun or updo, render it as natural tied-up hair without adding any hat or headwear.',
        gender === 'female'
          ? 'Do not use any fixed default face, fixed default glasses, or generic identity template.'
          : 'Do not use any fixed default face, fixed default glasses, or generic Asian male template.',
        headScaleAnchor,
      ].filter(Boolean).join('\n')
      : [
          `User-specific identity constraint for ${user.id} during ${resolvedStageName}:`,
          resolvedTraits.note || 'Use Image 2 as the only source of identity traits.',
        eyewearInstruction,
        accessoryBlock,
        collarLock,
        'Tacit transfer boundary: copy identity, not clothing or body context.',
        'Do not copy any headwear, hat, beanie, cap, or accessory from Image 2.',
        'Do not use any fixed default face, fixed default glasses, or generic identity template.',
        headScaleAnchor,
      ].filter(Boolean).join('\n');

  let prompt = stage.prompt
    .replace(
      /The target should have short black hair and black rectangular glasses\./g,
      'The target should match Image 2 for hair, face shape, facial hair, skin tone, and whether glasses are present.'
    )
    .replace(
      /The target person must look like the adult Asian male from Image 2:\nshort black hair,\nblack rectangular glasses,\nround broad face,/g,
      'The target person must look like the adult Asian male from Image 2:\nmatching hair from Image 2,\nmatching eyewear state from Image 2,\nmatching face shape from Image 2,'
    )
    .replace(/head, face, hair, glasses, neck, shoulders/g, 'head, face, hair, eyewear state, neck, shoulders')
    .replace(/missing glasses, /g, '')
    .replace(/distorted glasses, /g, '');
  prompt = adaptPromptGender(prompt, gender);
  prompt = `${prompt}\n\n${identityInstruction}`;

  const negativeAdditions = [
    traitsHasNoEyewear(resolvedTraits)
      ? 'glasses, eyeglasses, spectacles, frames, lenses, sunglasses, black rectangular glasses, invented eyewear'
      : traitsHasEyewear(resolvedTraits)
        ? 'missing glasses, wrong glasses, distorted glasses'
        : '',
    // Head scale
    'oversized head, enlarged face, head larger than mannequin, zoomed-in face, close-up face scale',
    // Headwear
    'hat, beanie, cap, knit cap, winter hat, headband, headwear copied from source photo',
    // Accessories from user photo
    'earphones, earbuds, headphones, wireless earphones, necklace, pendant, visible neck jewelry, earring, electronic device at neck',
    // Background jersey preservation
    'white hanging jersey, changed jersey color on wall, white jersey on locker, altered background jersey',
    // Collar protection
    'bleached collar, missing white collar, altered jersey collar, changed neckline',
  ].filter(Boolean).join(', ');

  const negativePrompt = [adaptNegativePromptGender(stage.negativePrompt, gender), negativeAdditions]
    .filter(Boolean)
    .join(', ');

  return { ...stage, prompt, negativePrompt };
}

function isLockerRoomScene(promptText) {
  return /locker|mannequin|faceless|seated.*jersey|Paulaner.*locker/i.test(promptText);
}

function adaptPromptGender(prompt, gender) {
  if (gender !== 'female') return prompt;
  return prompt
    .replace(/adult Asian male/g, 'adult Asian female')
    .replace(/adult male/g, 'adult female')
    .replace(/male body/g, 'female body')
    .replace(/Do not feminize the target\./g, 'Do not masculinize the target.')
    .replace(
      /Do not give the target long hair, bangs, or a bob haircut\./g,
      'Keep the hairstyle faithful to Image 2 while adapting it naturally to the locker-room photo.'
    )
    .replace(
      /Do not use any fixed default face, fixed default glasses, or generic Asian male template\./g,
      'Do not use any fixed default face, fixed default glasses, or generic identity template.'
    );
}

function adaptNegativePromptGender(negativePrompt, gender) {
  if (gender !== 'female') return negativePrompt;
  const removeTerms = new Set([
    'female target',
    'young woman',
    'feminine body',
    'female face',
    'female body',
    'bob haircut',
    'bangs',
    'long hair',
    'generic Asian woman',
  ]);
  const femaleNegativeAdditions = [
    'male face',
    'male body',
    'masculinized face',
    'short male haircut when Image 2 has long hair',
    'beard or moustache when absent from Image 2',
    'generic Asian male template',
  ];
  const filtered = String(negativePrompt)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && !removeTerms.has(item));
  return [...filtered, ...femaleNegativeAdditions].join(', ');
}

// ---------------------------------------------------------------------------
// utilities
// ---------------------------------------------------------------------------

async function copyAndCompress(sourcePath, destPath, maxLongEdge) {
  await execFileAsync('sips', [
    '-Z', String(maxLongEdge),
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', 'normal',
    sourcePath,
    '--out', destPath,
  ]);
}

function resolveSceneReferenceImages(scene) {
  return (scene.referenceImages || []).map((ref) => path.resolve(PROJECT_DIR, ref));
}

async function writePromptFiles(stageDir, stage) {
  await fs.promises.writeFile(path.join(stageDir, 'prompt.txt'), stage.prompt);
  await fs.promises.writeFile(path.join(stageDir, 'negative_prompt.txt'), stage.negativePrompt);
  await fs.promises.writeFile(
    path.join(stageDir, 'api_params.json'),
    `${JSON.stringify(stage.apiParams, null, 2)}\n`
  );
}

function buildResult({
  scene,
  user,
  model,
  status,
  startedAt,
  jobDir,
  stageAImage,
  resultImagePath,
  traits,
  traitsSource,
  userTraitsPath,
  error,
}) {
  return {
    scene: scene.id,
    user: user.id,
    user_image: user.sourcePath,
    model: model.id,
    model_name: model.model,
    traits_source: traitsSource,
    traits,
    user_traits_path: userTraitsPath || null,
    stage: 'stage_a_only',
    status,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    job_dir: jobDir,
    stage_a_image: stageAImage,
    result_image: resultImagePath || null,
    final_image: stageAImage,
    error: error ? redactSecrets(error) : null,
  };
}

function buildOverviewHtml(summary, outDir) {
  const userIds = [...new Set(summary.results.map((r) => r.user))].sort(
    (a, b) => a.localeCompare(b, 'en', { numeric: true })
  );
  const cards = userIds.map((uid) => {
    const items = summary.results.filter((r) => r.user === uid && r.status === 'completed');
    const ref = path.join(outDir, 'images', `_ref_${uid}.jpg`);
    const refHtml = fs.existsSync(ref)
      ? `<img class="ref" src="images/_ref_${uid}.jpg" title="reference">`
      : '';
    const figures = items.map((item) => {
      if (!item.result_image) return '';
      const fname = path.basename(item.result_image);
      const modelLabel = item.model === 'seedream_4_5' ? '4.5' : '5.0';
      return `<figure><figcaption>${modelLabel}</figcaption><img src="images/${fname}"></figure>`;
    }).join('');
    return `<section class="card"><h2>${uid}${refHtml}</h2><div class="row">${figures}</div></section>`;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${summary.scene} Stage A — ${summary.created_at.slice(0, 10)}</title>
<style>
body{margin:0;background:#1a1a2e;color:#eee;font:13px/1.4 system-ui,sans-serif}
h1{text-align:center;padding:16px 0 4px;font-size:18px;color:#a0c4ff}
p.meta{text-align:center;color:#64748b;margin:0 0 10px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:12px;padding:12px}
.card{background:#16213e;border:1px solid #0f3460;border-radius:8px;padding:10px}
.card h2{margin:0 0 8px;font-size:13px;color:#e2e8f0;display:flex;align-items:center;gap:8px}
.ref{width:40px;height:50px;object-fit:cover;border-radius:4px;border:1px solid #334}
.row{display:flex;gap:8px}
.row figure{margin:0;flex:1}
.row figcaption{font-size:11px;text-align:center;color:#94a3b8;margin-bottom:3px}
.row img{width:100%;display:block;border-radius:5px;background:#0f3460}
</style>
</head>
<body>
<h1>${summary.scene} — Stage A (mask inpainting)</h1>
<p class="meta">左: Seedream 4.5 &nbsp;|&nbsp; 右: Seedream 5.0 &nbsp;|&nbsp; 生成时间: ${summary.created_at.slice(0, 19).replace('T', ' ')} CST</p>
<div class="grid">${cards}</div>
</body>
</html>`;
}

function toDataUrl(filePath) {
  const buffer = fs.readFileSync(filePath);
  return `data:${detectMime(buffer, filePath)};base64,${buffer.toString('base64')}`;
}

function detectMime(buffer, filePath) {
  if (buffer.length >= 4 && buffer.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderSummary(summary) {
  const rows = summary.results.map((item) => [
    item.scene,
    item.user,
    item.model,
    item.status,
    item.stage_a_image || '',
    item.error || '',
  ]);
  return `# ${summary.scene} Stage A User Matrix\n\n- Created at: ${summary.created_at}\n- Scene: ${summary.scene}\n- Stage: ${summary.stage}\n- User dir: ${summary.user_dir}\n\n| Scene | User | Model | Status | Stage A Image | Error |\n|---|---|---|---|---|---|\n${rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`).join('\n')}\n`;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

// ---------------------------------------------------------------------------
// arg parsing & helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    env: DEFAULT_ENV,
    userDir: DEFAULT_USER_DIR,
    scene: 'scene1v3',
    concurrency: DEFAULT_CONCURRENCY,
    models: null,
    users: null,
    outDir: null,
    traitsSource: 'cache',
    traitsCache: DEFAULT_TRAITS_CACHE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env') {
      args.env = path.resolve(argv[++index]);
    } else if (arg === '--user-dir') {
      args.userDir = path.resolve(argv[++index]);
    } else if (arg === '--out-dir') {
      args.outDir = path.resolve(argv[++index]);
    } else if (arg === '--scene') {
      args.scene = argv[++index];
    } else if (arg === '--concurrency') {
      args.concurrency = Number(argv[++index]);
      if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
        throw new Error('--concurrency 必须是正整数');
      }
    } else if (arg === '--models') {
      args.models = parseCsv(argv[++index]);
    } else if (arg === '--users') {
      args.users = parseCsv(argv[++index]);
    } else if (arg === '--traits-source') {
      args.traitsSource = argv[++index];
      if (!['cache', 'llm'].includes(args.traitsSource)) throw new Error('--traits-source 必须是 cache 或 llm');
    } else if (arg === '--traits-cache') {
      args.traitsCache = path.resolve(argv[++index]);
    } else if (arg === '--no-cache') {
      args.traitsSource = 'llm';
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  return args;
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectModels(ids) {
  if (ids?.length) {
    const selected = MODELS.filter((model) => ids.includes(model.id));
    if (selected.length !== ids.length) {
      const available = MODELS.map((model) => model.id).join(', ');
      throw new Error(`未知模型: ${ids.join(', ')}；可选值: ${available}`);
    }
    return selected;
  }
  return MODELS;
}

function resolveSceneId(defaultSceneId, traits) {
  return resolveScene1v3SceneId(defaultSceneId, traits);
}

function listUserImages(userDir) {
  return fs.readdirSync(userDir)
    .filter((fileName) => IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((fileName) => ({
      id: path.basename(fileName, path.extname(fileName)).replace(/[^a-zA-Z0-9_-]/g, '_'),
      fileName,
      sourcePath: path.join(userDir, fileName),
    }));
}

function filterUsers(users, ids) {
  if (!ids?.length) return users;
  const selected = users.filter((user) => ids.includes(user.id));
  if (selected.length !== ids.length) throw new Error(`部分用户不存在: ${ids.join(', ')}`);
  return selected;
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
  return results;
}

function loadEnv(envPath) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

function redactSecrets(text) {
  return String(text).replace(/(ark|sk)-[A-Za-z0-9_-]+/g, '$1-<redacted>');
}

function formatTimestamp(date) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}_${value.hour}${value.minute}${value.second}`;
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-scene1-v3.js [--scene scene1v3] [--env path/.env]
    [--user-dir path/to/user] [--concurrency 4]
    [--models seedream_4_5,seedream_5_0] [--users user1,user2]
    [--traits-source cache|llm] [--traits-cache 素材/用户测试照片/traits.json]

场景1 v3 Stage A 批量生成脚本。只运行 Stage A（body alignment），跳过 Stage B 和合成。
--scene 支持: scene1v3（按 traits.gender 路由）, scene1v3_male, scene1v3_female
默认 traits-source=cache，只读取测试缓存；生产上传请传 --traits-source llm（或 --no-cache）实时识别。
默认并发: ${DEFAULT_CONCURRENCY}，默认同时跑 Seedream 4.5 和 5.0。
`);
}

main().catch((error) => {
  console.error(redactSecrets(error.message));
  process.exit(1);
});
