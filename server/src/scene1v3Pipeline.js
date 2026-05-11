const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const {
  buildStagePrompts,
  composeCleanBackgroundEditRegionsOverBase,
  normalizeProtectedRegion,
  restoreProtectedRegions,
} = require('../../src/pipeline');
const { loadSceneConfig } = require('../../src/scenes');
const { detectUserTraits } = require('../../src/trait-detector');
const {
  eyewearDescription,
  resolveScene1v3SceneId,
  traitsHasEyewear,
  traitsHasNoEyewear,
} = require('../../src/scene1v3-traits');

const execFileAsync = promisify(execFile);

const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_FETCH_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_REVIEW_ATTEMPTS = 3;
const DEFAULT_STAGE_ATTEMPTS = 5;
const DEFAULT_VISION_MODEL = 'doubao-seed-2-0-pro';
const USER_FOCUS_SIZE = 1024;

const USER_FACE_BOUNDS_PROMPT = `Look at the user portrait.
Return ONLY valid JSON with the bounding box of the full identity-bearing head region, including the full hair silhouette, forehead, ears when visible, cheeks, jawline, chin, moustache/beard when present, and a small amount of upper neck.
Use this exact schema:
{"x":number,"y":number,"w":number,"h":number}
All values must be percentages from 0 to 100 relative to the original image size.
x and y are the top-left corner.
The box must be tight enough that the face occupies a large part of the crop, but loose enough that no top hair, jawline, or facial hair is cut off.
Do not include torso, clothing, or large background areas.
Return JSON only.`;

const SCENE1_STAGE_A_MASK_REGIONS = {
  male: [{ id: 'head_hair_neck', x: 0.52, y: 0.29, width: 0.17, height: 0.23, shape: 'ellipse', feather: 18 }],
  female: [{ id: 'head_hair_neck', x: 0.510, y: 0.266, width: 0.18, height: 0.235, shape: 'ellipse', feather: 17 }],
};

const MODELS = {
  seedream_4_5: {
    id: 'seedream_4_5',
    model: 'doubao-seedream-4-5-251128',
    outputFormat: null,
    maskStrength: 0.78,
    includeStrength: true,
    includeNegativePrompt: true,
  },
  seedream_5_0: {
    id: 'seedream_5_0',
    model: 'doubao-seedream-5-0-260128',
    outputFormat: 'png',
    maskStrength: 0.82,
    includeStrength: true,
    includeNegativePrompt: false,
  },
};

const SCENE1_STAGE_A_DARK_INNER_COLLAR_GUARDS = [
  {
    id: 'central_white_undershirt_collar_dark_intrusion',
    x: 0.600,
    y: 0.440,
    width: 0.030,
    height: 0.018,
    darkRatioThreshold: 0.25,
  },
];

const SCENE1_STAGE_A_REVIEW_PROMPT = `You are evaluating two AI-generated locker-room photos for direct fixed-region paste quality.

Scene context: Paulaner locker room. A faceless mannequin sits on a bench in the center bay, wearing a red-and-white FC Bayern jersey, holding a Paulaner beer glass.

Image 1: Stage A result from model 4.5
Image 2: Stage A result from model 5.0
Image 3: Original base image (the faceless mannequin - reference for SCALE, POSE, PROPORTIONS)
Image 4: User portrait (reference for IDENTITY and HAIRSTYLE)

Project calibration examples:
- A side-facing or obvious three-quarter Stage A head is NOT passable, even if the standalone image looks attractive.
- If the Stage A jersey collar/white undershirt neckline differs from Image 3, the direct paste can fail, so that candidate is NOT passable.
- Do NOT return or evaluate source_region coordinates. The compositor always uses Image 3's fixed target region for direct paste.

CRITICAL EVALUATION RULE - BODY SCALE:
Compare the person's full-body size in Images 1 and 2 against the mannequin's size in Image 3.
The generated person MUST appear at the same size and camera distance as the mannequin in Image 3.
The locker-room background, bench, hanging jerseys, and floor must be visible at the same relative scale.
If the person appears LARGER or CLOSER than the mannequin (zoomed-in feel, too much of the frame filled), it is a HARD FAIL for body_scale_matches_base.
The person may appear slightly SMALLER or FURTHER than the mannequin - that is acceptable.

Evaluate each result on ALL of these fields:

1. face_replaced (bool): A real human face is visible - the smooth featureless mannequin face has been replaced.
2. body_scale_matches_base (bool): The person's full-body size and camera distance matches Image 3. FAIL if the person is zoomed in, too large, or too close to camera compared to Image 3.
3. jersey_collar_unchanged (bool): The white undershirt collar and red jersey collar at the neck junction must match Image 3 in shape, color, position, and visible neckline. HARD FAIL if the collar is bleached, shifted, missing, widened/narrowed, V-shaped differently, visibly generated, black/dark, or replaced by a dark undershirt/inner collar. Do not pass "minor" collar differences here because final compositing uses this seam.
4. background_jerseys_unchanged (bool): The red FC Bayern jerseys hanging on the left and right walls in Image 3 must still be RED in the result. FAIL if any hanging jersey turned white or significantly changed color.
5. accessories_absent (bool): No earphones, earbuds, headphones, necklaces, pendants, or electronic accessories from Image 4 appear in the result. FAIL if any such accessory is visible.
6. no_big_head (bool): Head size is proportional to the body and comparable to the mannequin head size in Image 3. Not oversized.
7. no_halo_or_color_patch (bool): The area around hair, ears, temples, jawline, and neck blends into the blue locker background without a visible white glow, pale oval, square patch, light halo, or background color mismatch. HARD FAIL if a bright/white/gray aura or mismatched blue patch is visible around the head.
8. neck_integrated (bool): Chin, jaw, neck, throat, and collar transition read as one continuous photographed person. HARD FAIL for floating head, pasted-face effect, hard neck seam, mismatched face-vs-neck skin tone, missing neck, or a neck that stops above the jersey collar.
9. framing_matches_base (bool): The EXACT camera position, angle, and full-body framing match Image 3. This is a COMBINED check - ALL of the following must be true:
   a) The person's body is sitting straight/upright with LEVEL shoulders, matching the mannequin's posture in Image 3. FAIL if the person's torso or shoulders are tilted at any angle.
   b) The camera viewpoint is identical - the locker room bays appear from the SAME front-facing angle as Image 3. FAIL if the angle appears rotated/shifted even slightly (for example, if the locker room appears from a slightly different left/right viewpoint).
   c) The full body proportions in the frame match Image 3: compare visible blue wall space ABOVE the person's head, visible bench on both sides, and visible floor. If the person appears noticeably larger (less surrounding locker room visible) or smaller, FAIL.
   FAIL framing_matches_base if ANY of (a), (b), or (c) is false.
10. hairstyle_ok (bool): Compare hairstyle direction (up/down), approximate length, and overall style against Image 4. FAIL if: (a) Image 4 has short hair in a bun but result has long flowing hair; (b) the hairstyle is a completely different style/direction. Do NOT fail for minor natural adaptation differences.
11. head_pose_matches_base (bool): The face/head is front-facing and aligned like the mannequin in Image 3. HARD FAIL if the nose-mouth-chin axis is not centered on the body, the head is side-facing, profile, noticeably three-quarter, rotated, tilted, or cannot be pasted onto the front-facing body naturally.
12. identity_similarity (bool): The generated face should be recognizably the SAME PERSON as Image 4, not merely a plausible similar person. FAIL if the result looks like a different person with reassembled features.
13. facial_feature_consistency (bool): Eyes, brows, nose shape/width, mouth shape, lip thickness, philtrum, face width, cheek fullness, and jawline must remain consistent with Image 4. FAIL if multiple core features are shifted, narrowed, widened, or genericized.
14. facial_hair_consistency (bool): Moustache, beard, stubble, sideburns, or clean-shaven state must match Image 4. FAIL if facial hair is invented, removed, or changed significantly.
15. score (1-10): Overall quality. Deduct 3+ for wrong framing/scale/tilt. Deduct 3+ for side-facing/rotated head. Deduct 3+ for halo/color patch. Deduct 3+ for pasted/floating head or neck seam. Deduct 3+ for collar mismatch, black/dark inner collar, dark undershirt collar transfer, or altered white collar. Deduct 3+ for wrong identity or reassembled facial features. Deduct 2+ for background jerseys. Deduct 2+ for big head. Deduct 2+ for accessories. Deduct 2+ for completely wrong hairstyle.

PASS condition: face_replaced=true AND body_scale_matches_base=true AND jersey_collar_unchanged=true AND background_jerseys_unchanged=true AND accessories_absent=true AND no_big_head=true AND no_halo_or_color_patch=true AND neck_integrated=true AND framing_matches_base=true AND hairstyle_ok=true AND head_pose_matches_base=true AND identity_similarity=true AND facial_feature_consistency=true AND facial_hair_consistency=true AND score >= 8
Score 7 is NOT pass for this workflow. It may look acceptable as a standalone image, but it is not reliable enough as a final compositing source.
The returned winner is the Stage A image the pipeline should directly paste with Image 3's fixed target region. If winner="neither", the pipeline uses a fallback best-score candidate.

WINNER selection rules (STRICTLY follow in order):
1. If only one passes - winner is that model.
2. If both pass - compare scores. If scores differ by 2+, pick the higher. If equal or differ by 1, pick "5_0".
3. If neither passes due to CRITICAL failures (face_replaced=false, framing_matches_base=false, body_scale_matches_base=false, no_big_head=false, no_halo_or_color_patch=false, neck_integrated=false, head_pose_matches_base=false, jersey_collar_unchanged=false, black/dark inner collar visible, background_jerseys_unchanged=false, accessories_absent=false, hairstyle_ok=false, identity_similarity=false, facial_feature_consistency=false, or facial_hair_consistency=false) - winner is "neither".
4. If neither passes only because both scores are 7 with every bool true - winner is "neither".

Return JSON ONLY - no markdown, no preamble:
{
  "result_4_5": {"face_replaced": bool, "body_scale_matches_base": bool, "jersey_collar_unchanged": bool, "background_jerseys_unchanged": bool, "accessories_absent": bool, "no_big_head": bool, "no_halo_or_color_patch": bool, "neck_integrated": bool, "framing_matches_base": bool, "hairstyle_ok": bool, "head_pose_matches_base": bool, "identity_similarity": bool, "facial_feature_consistency": bool, "facial_hair_consistency": bool, "score": number, "issues": []},
  "result_5_0": {"face_replaced": bool, "body_scale_matches_base": bool, "jersey_collar_unchanged": bool, "background_jerseys_unchanged": bool, "accessories_absent": bool, "no_big_head": bool, "no_halo_or_color_patch": bool, "neck_integrated": bool, "framing_matches_base": bool, "hairstyle_ok": bool, "head_pose_matches_base": bool, "identity_similarity": bool, "facial_feature_consistency": bool, "facial_hair_consistency": bool, "score": number, "issues": []},
  "winner": "4_5" | "5_0" | "neither",
  "reason": "one sentence"
}`;

const RUNTIME_ROOT = path.resolve(__dirname, '..', '.runtime', 'scene1v3');

async function runScene1V3Pipeline({ taskId, userImages = [], genderHint = null }) {
  if (!Array.isArray(userImages) || userImages.length === 0) {
    throw new Error('scene1v3 requires at least one user image');
  }

  const taskDir = path.join(RUNTIME_ROOT, taskId);
  const inputDir = path.join(taskDir, '00_inputs');
  const stageADir = path.join(taskDir, '02_stage_a_body_align');
  const reviewDir = path.join(taskDir, 'llm_review');
  const finalDir = path.join(taskDir, 'final');
  const maskDir = path.join(taskDir, '00_masks');
  await Promise.all([inputDir, stageADir, reviewDir, finalDir, maskDir].map((dir) => fsp.mkdir(dir, { recursive: true })));

  const userImagePath = path.join(inputDir, 'user_original.jpg');
  const userFocusedImagePath = path.join(inputDir, 'user_focus.jpg');
  const userInput = userImages[0];
  await materializeImageInput(userInput, userImagePath);
  const userFocusMeta = await buildFocusedUserPortrait({
    sourceImage: userImagePath,
    outputImage: userFocusedImagePath,
  });

  let traits;
  try {
    traits = await detectUserTraits(userImagePath);
  } catch (error) {
    if (!genderHint) throw error;
    traits = buildFallbackTraits(genderHint);
  }

  const sceneId = resolveScene1v3SceneId('scene1v3', traits);
  const scene = loadSceneConfig(sceneId);
  const baseImagePath = path.join(inputDir, 'base.jpg');
  await fsp.copyFile(path.resolve(PROJECT_DIR, scene.base), baseImagePath);

  const maskImagePath = path.join(maskDir, `mask_${traits.gender || 'male'}.png`);
  await createMask({
    sourceImage: baseImagePath,
    outputImage: maskImagePath,
    regions: SCENE1_STAGE_A_MASK_REGIONS[traits.gender || 'male'] || SCENE1_STAGE_A_MASK_REGIONS.male,
  });

  const prompts = buildUserPrompts(
    buildStagePrompts({
      targetPerson: scene.target,
      targetDetail: scene.targetDetail,
      protectedPerson: scene.protectedPerson,
      referenceImageCount: (scene.referenceImages || []).length,
    }),
    { id: taskId },
    traits
  );

  const stageAImages = {};
  for (const model of [MODELS.seedream_4_5, MODELS.seedream_5_0]) {
    const modelDir = path.join(stageADir, model.id);
    await fsp.mkdir(modelDir, { recursive: true });
    const outputPath = path.join(modelDir, `image${model.outputFormat === 'png' ? '.png' : '.jpg'}`);
    const responsePath = path.join(modelDir, 'response.json');
    await requestAndSaveStageA({
      model,
      prompts,
      baseImage: baseImagePath,
      userImage: userFocusedImagePath,
      maskImage: maskImagePath,
      outputPath,
      responsePath,
      label: `${taskId}/${model.id}`,
    });
    stageAImages[model.id] = outputPath;
  }

  let review = await reviewStageASafe({
    image45: stageAImages.seedream_4_5,
    image50: stageAImages.seedream_5_0,
    baseImage: baseImagePath,
    userImage: userImagePath,
    label: taskId,
    reviewPrompt: SCENE1_STAGE_A_REVIEW_PROMPT,
  });
  review = await applyDeterministicStageGuards({
    review,
    stageAImages,
    label: taskId,
    guards: SCENE1_STAGE_A_DARK_INNER_COLLAR_GUARDS,
  });
  await fsp.writeFile(path.join(reviewDir, 'stage_a_review.json'), `${JSON.stringify(review, null, 2)}\n`);

  let candidates = buildStageCandidates(review, stageAImages);
  if (candidates.length === 0) {
    const fallback = buildFallbackStageCandidate(review, stageAImages);
    if (!fallback) {
      throw new Error('scene1v3 review did not produce any usable candidate');
    }
    candidates = [fallback];
  }
  const selected = candidates[0];

  const finalImagePath = await generateFinalComposite({
    stageAImage: selected.stageAImage,
    baseImage: baseImagePath,
    scene,
    finalDir,
    modelId: selected.modelId,
  });

  await fsp.writeFile(
    path.join(taskDir, 'result.json'),
    `${JSON.stringify({
      task_id: taskId,
      scene_id: sceneId,
      traits,
      user_focus: userFocusMeta,
      selected_model: selected.modelId,
      selection_mode: selected.selectionMode,
      fallback_best_score: selected.fallback === true,
      review,
      final_image: finalImagePath,
    }, null, 2)}\n`
  );

  return {
    finalImagePath,
    sceneId,
    traits,
    selectedModel: selected.modelId,
    llmWinner: review.winner,
    llmScore45: review.result_4_5?.score ?? null,
    llmScore50: review.result_5_0?.score ?? null,
    fallbackBestScore: selected.fallback === true,
  };
}

function buildFallbackTraits(genderHint) {
  const normalized = genderHint === 'female' ? 'female' : 'male';
  return {
    gender: normalized,
    eyewear: 'none',
    eyewear_description: '',
    hair_length: 'short',
    hair_color: 'black',
    hair_style: 'straight',
    facial_hair: 'none',
    facial_hair_description: '',
    age_range: '20s',
    note: `Image 2 shows an adult Asian ${normalized} whose identity should be taken from the user portrait.`,
  };
}

async function materializeImageInput(input, outputPath) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Unsupported user image input');
  }
  const trimmed = input.trim();
  if (trimmed.startsWith('data:image/')) {
    const payload = trimmed.replace(/^data:[^;]+;base64,/, '');
    await fsp.writeFile(outputPath, Buffer.from(payload, 'base64'));
    return;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const response = await fetchWithTimeout(trimmed);
    if (!response.ok) {
      throw new Error(`User image download failed: ${response.status} ${response.statusText}`);
    }
    await fsp.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
    return;
  }
  throw new Error('User image must be a data URL or http/https URL');
}

async function buildFocusedUserPortrait({ sourceImage, outputImage }) {
  try {
    const dimensions = await getImageDimensions(sourceImage);
    const bounds = await detectUserFaceBounds(sourceImage, dimensions);
    if (!bounds) {
      await fsp.copyFile(sourceImage, outputImage);
      return { used_focus: false, reason: 'no_face_bounds' };
    }
    const crop = expandUserPortraitCrop(bounds, dimensions);
    await cropAndSquareUserPortrait({ sourceImage, outputImage, crop });
    return {
      used_focus: true,
      bounds,
      crop,
      output_image: outputImage,
      output_size: USER_FOCUS_SIZE,
    };
  } catch (error) {
    await fsp.copyFile(sourceImage, outputImage);
    return { used_focus: false, reason: redactSecrets(error.message) };
  }
}

async function detectUserFaceBounds(imagePath, dimensions) {
  const raw = await callVisionJson({
    prompt: USER_FACE_BOUNDS_PROMPT,
    images: [imagePath],
  });
  return normalizeUserFaceBounds(raw, dimensions);
}

function normalizeUserFaceBounds(raw, dimensions) {
  if (!raw || typeof raw !== 'object') return null;
  let x = Number(raw.x);
  let y = Number(raw.y);
  let w = Number(raw.w);
  let h = Number(raw.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (x > 100 || y > 100 || w > 100 || h > 100) {
    x = (x / dimensions.width) * 100;
    y = (y / dimensions.height) * 100;
    w = (w / dimensions.width) * 100;
    h = (h / dimensions.height) * 100;
  }
  x = clamp(x, 0, 95);
  y = clamp(y, 0, 95);
  w = clamp(w, 5, 95);
  h = clamp(h, 5, 95);
  if (x + w > 100) w = Math.max(5, 100 - x);
  if (y + h > 100) h = Math.max(5, 100 - y);
  if (w > 85 || h > 85) return null;
  return { x, y, w, h };
}

function expandUserPortraitCrop(bounds, dimensions) {
  const xPx = dimensions.width * (bounds.x / 100);
  const yPx = dimensions.height * (bounds.y / 100);
  const wPx = dimensions.width * (bounds.w / 100);
  const hPx = dimensions.height * (bounds.h / 100);
  const sidePad = wPx * 0.42;
  const topPad = hPx * 0.42;
  const bottomPad = hPx * 0.34;
  const left = clamp(Math.round(xPx - sidePad), 0, dimensions.width - 1);
  const top = clamp(Math.round(yPx - topPad), 0, dimensions.height - 1);
  const right = clamp(Math.round(xPx + wPx + sidePad), left + 1, dimensions.width);
  const bottom = clamp(Math.round(yPx + hPx + bottomPad), top + 1, dimensions.height);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

async function cropAndSquareUserPortrait({ sourceImage, outputImage, crop }) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-v', 'error',
    '-i', sourceImage,
    '-vf',
    `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` +
    `scale=${USER_FOCUS_SIZE}:${USER_FOCUS_SIZE}:force_original_aspect_ratio=decrease,` +
    `pad=${USER_FOCUS_SIZE}:${USER_FOCUS_SIZE}:(ow-iw)/2:(oh-ih)/2:white`,
    '-frames:v', '1',
    '-q:v', '2',
    outputImage,
  ]);
}

async function requestAndSaveStageA({ model, prompts, baseImage, userImage, maskImage, outputPath, responsePath, label }) {
  const payload = {
    model: model.model,
    prompt: prompts.bodyAlign.prompt,
    image: [baseImage, userImage].map(toDataUrl),
    sequential_image_generation: 'disabled',
    response_format: 'url',
    size: prompts.bodyAlign.apiParams.size,
    stream: false,
    watermark: true,
  };
  if (model.outputFormat) payload.output_format = model.outputFormat;
  if (model.includeStrength) payload.strength = model.maskStrength;
  if (maskImage) payload.mask_image = toDataUrl(maskImage);
  if (model.includeNegativePrompt) payload.negative_prompt = prompts.bodyAlign.negativePrompt;

  let lastError;
  for (let attempt = 1; attempt <= DEFAULT_STAGE_ATTEMPTS; attempt += 1) {
    try {
      const data = await requestSeedreamImage(payload);
      await fsp.writeFile(responsePath, `${JSON.stringify({ ...data, local_attempt: attempt }, null, 2)}\n`);
      const url = data.data?.find((item) => item.url)?.url;
      if (!url) throw new Error('Seedream response missing image URL');
      await downloadGeneratedImage(url, outputPath);
      return;
    } catch (error) {
      lastError = error;
      await fsp.writeFile(`${responsePath}.attempt_${attempt}.error.txt`, redactSecrets(error.message)).catch(() => {});
      if (attempt < DEFAULT_STAGE_ATTEMPTS) {
        const delayMs = Math.min(15000 * attempt, 60000);
        console.error(`[scene1v3] ${label} attempt ${attempt}/${DEFAULT_STAGE_ATTEMPTS}: ${redactSecrets(error.message)}; retry in ${delayMs / 1000}s`);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

async function reviewStageASafe({ image45, image50, baseImage, userImage, label, reviewPrompt, logTag = 'scene1v3' }) {
  let lastError;
  for (let attempt = 1; attempt <= DEFAULT_REVIEW_ATTEMPTS; attempt += 1) {
    try {
      return await callVisionJson({
        prompt: reviewPrompt,
        images: [image45, image50, baseImage, userImage],
      });
    } catch (error) {
      lastError = error;
      if (attempt < DEFAULT_REVIEW_ATTEMPTS) {
        const delayMs = Math.min(5000 * attempt, 15000);
        console.error(`[${logTag}] review ${label} attempt ${attempt}/${DEFAULT_REVIEW_ATTEMPTS}: ${redactSecrets(error.message)}; retry in ${delayMs / 1000}s`);
        await sleep(delayMs);
      }
    }
  }

  console.error(`[${logTag}] review ${label} failed: ${redactSecrets(lastError.message)}`);
  return {
    result_4_5: strictFallbackReview(0),
    result_5_0: strictFallbackReview(0),
    winner: 'neither',
    reason: 'LLM review failed; strict fallback rejects both models',
  };
}

function strictFallbackReview(score) {
  return {
    face_replaced: true,
    body_scale_matches_base: true,
    jersey_collar_unchanged: true,
    background_jerseys_unchanged: true,
    accessories_absent: true,
    no_big_head: true,
    no_halo_or_color_patch: false,
    neck_integrated: false,
    framing_matches_base: true,
    hairstyle_ok: true,
    head_pose_matches_base: false,
    identity_similarity: false,
    facial_feature_consistency: false,
    facial_hair_consistency: false,
    score,
    issues: ['Stage A review unavailable; strict fallback rejects both models'],
  };
}

function buildStageCandidates(review, stageAImages) {
  for (const modelId of buildStageSelectionOrder(review)) {
    const result = reviewResultForModel(review, modelId);
    if (!stageAImages[modelId] || !passesStageVisualQuality(result)) continue;
    return [{
      modelId,
      stageAImage: stageAImages[modelId],
      score: result.score ?? 0,
      composeMode: 'fixed_scene_region',
      selectionMode: 'stage_a_direct_fixed_region',
    }];
  }
  return [];
}

function buildFallbackStageCandidate(review, stageAImages) {
  const candidates = ['seedream_5_0', 'seedream_4_5']
    .filter((modelId) => stageAImages[modelId])
    .map((modelId) => ({
      modelId,
      stageAImage: stageAImages[modelId],
      score: reviewResultForModel(review, modelId)?.score ?? 0,
      fallback: true,
      composeMode: 'fixed_scene_region',
      selectionMode: 'stage_a_fallback_best_score_fixed_region',
    }))
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return a.modelId === 'seedream_5_0' ? -1 : 1;
    });

  return candidates[0] || null;
}

function buildStageSelectionOrder(review) {
  const modelIds = ['seedream_5_0', 'seedream_4_5'];
  const winner = stageWinnerModel(review);
  if (winner) return [winner, ...modelIds.filter((modelId) => modelId !== winner)];
  return [...modelIds].sort((a, b) => {
    const scoreDiff = (reviewResultForModel(review, b)?.score ?? 0) - (reviewResultForModel(review, a)?.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a === 'seedream_5_0' ? -1 : 1;
  });
}

function stageWinnerModel(review) {
  if (review?.winner === '4_5') return 'seedream_4_5';
  if (review?.winner === '5_0') return 'seedream_5_0';
  return null;
}

function reviewResultForModel(review, modelId) {
  return modelId === 'seedream_4_5' ? review?.result_4_5 : review?.result_5_0;
}

function passesStageVisualQuality(result) {
  if (!result) return false;
  return result.face_replaced === true
    && result.body_scale_matches_base === true
    && result.jersey_collar_unchanged === true
    && result.background_jerseys_unchanged === true
    && result.accessories_absent === true
    && result.no_big_head === true
    && result.no_halo_or_color_patch === true
    && result.neck_integrated === true
    && result.hairstyle_ok === true
    && result.framing_matches_base === true
    && result.head_pose_matches_base === true
    && result.identity_similarity === true
    && result.facial_feature_consistency === true
    && result.facial_hair_consistency === true
    && (result.score ?? 0) >= 8;
}

async function applyDeterministicStageGuards({ review, stageAImages, label, guards = [], logTag = 'scene1v3' }) {
  if (!Array.isArray(guards) || guards.length === 0) {
    return review;
  }
  const findings = {};
  await Promise.all(
    Object.entries(stageAImages).map(async ([modelId, imagePath]) => {
      const darkCollar = await inspectDarkInnerCollar(imagePath, guards).catch((error) => ({
        failed: false,
        warning: redactSecrets(error.message),
      }));
      if (darkCollar.failed) {
        findings[modelId] = [{
          field: 'jersey_collar_unchanged',
          issue: `black/dark inner collar detected in the white undershirt collar zone (${darkCollar.region.id}, dark_ratio=${darkCollar.dark_ratio.toFixed(3)})`,
          guard: darkCollar,
        }];
      } else if (darkCollar.warning) {
        console.warn(`[${logTag}] guard ${label}/${modelId}: ${darkCollar.warning}`);
      }
    })
  );
  return applyStageGuardFindings(review, findings);
}

function applyStageGuardFindings(review, findings = {}) {
  const guarded = JSON.parse(JSON.stringify(review || {}));
  for (const [modelId, modelFindings] of Object.entries(findings)) {
    const key = modelId === 'seedream_4_5' ? 'result_4_5' : 'result_5_0';
    const result = guarded[key];
    if (!result || !Array.isArray(modelFindings) || modelFindings.length === 0) continue;
    result.issues = Array.isArray(result.issues) ? result.issues : [];
    for (const finding of modelFindings) {
      if (finding.field) result[finding.field] = false;
      if (finding.issue && !result.issues.includes(finding.issue)) result.issues.push(finding.issue);
    }
    result.score = Math.min(result.score ?? 7, 7);
    result.deterministic_guards = [
      ...(result.deterministic_guards || []),
      ...modelFindings.map((finding) => ({
        field: finding.field,
        issue: finding.issue,
        ...(finding.guard ? { guard: finding.guard } : {}),
      })),
    ];
  }
  guarded.winner = selectStageWinnerFromReview(guarded);
  return guarded;
}

function selectStageWinnerFromReview(review) {
  const pass45 = passesStageVisualQuality(review?.result_4_5);
  const pass50 = passesStageVisualQuality(review?.result_5_0);
  if (pass45 && !pass50) return '4_5';
  if (pass50 && !pass45) return '5_0';
  if (!pass45 && !pass50) return 'neither';
  const score45 = review.result_4_5.score ?? 0;
  const score50 = review.result_5_0.score ?? 0;
  if (score45 - score50 >= 2) return '4_5';
  return '5_0';
}

async function generateFinalComposite({ stageAImage, baseImage, scene, finalDir, modelId }) {
  await fsp.mkdir(finalDir, { recursive: true });
  const finalImage = path.join(finalDir, `result_${modelId}.jpg`);

  await composeCleanBackgroundEditRegionsOverBase({
    sourceImage: baseImage,
    targetImage: stageAImage,
    outputImage: finalImage,
    regions: buildCleanFinalRegions(scene),
  });

  if (scene.protectedRegions?.length) {
    await restoreProtectedRegions({
      sourceImage: baseImage,
      targetImage: finalImage,
      outputImage: finalImage,
      regions: scene.protectedRegions,
    });
  }
  if (scene.maskedProtectedRegions?.length) {
    await restoreMaskedProtectedRegions({
      sourceImage: baseImage,
      targetImage: finalImage,
      outputImage: finalImage,
      regions: scene.maskedProtectedRegions,
    });
  }

  return finalImage;
}

function buildCleanFinalRegions(scene) {
  if (Array.isArray(scene.finalRegions) && scene.finalRegions.length > 0) {
    return scene.finalRegions.map((region) => ({ ...region }));
  }
  return (scene.editRegions || []).map((region) => ({ ...region }));
}

async function restoreMaskedProtectedRegions({ sourceImage, targetImage, outputImage, regions }) {
  const dimensions = await getImageDimensions(targetImage);
  const [sourceRgb, targetRgb] = await Promise.all([
    readRgbFrame(sourceImage, dimensions),
    readRgbFrame(targetImage, dimensions),
  ]);
  const outputRgb = Buffer.from(targetRgb);

  for (const region of regions || []) {
    const normalized = {
      ...normalizeProtectedRegion(region, dimensions),
      feather: region.feather || 0,
    };
    restoreMaskedRegionFromRgb({ sourceRgb, targetRgb, outputRgb, dimensions, region: normalized });
  }

  await writeRgbFrame(outputRgb, dimensions, outputImage);
}

function restoreMaskedRegionFromRgb({ sourceRgb, targetRgb, outputRgb, dimensions, region }) {
  for (let localY = 0; localY < region.height; localY += 1) {
    for (let localX = 0; localX < region.width; localX += 1) {
      const globalIndex = ((region.y + localY) * dimensions.width + region.x + localX) * 3;
      const tr = targetRgb[globalIndex];
      const tg = targetRgb[globalIndex + 1];
      const tb = targetRgb[globalIndex + 2];
      if (looksLikeHairPixel(tr, tg, tb)) continue;

      const alpha = alphaForRectRegion(region, localX, localY);
      for (let channel = 0; channel < 3; channel += 1) {
        outputRgb[globalIndex + channel] = Math.round(
          targetRgb[globalIndex + channel] * (1 - alpha) + sourceRgb[globalIndex + channel] * alpha
        );
      }
    }
  }
}

function looksLikeHairPixel(r, g, b) {
  const mean = (r + g + b) / 3;
  const darkHair = mean < 88;
  const brownHair = mean < 158 && r < 178 && g < 142 && b < 130 && r > g + 6 && g > b + 4;
  const redJersey = r > 140 && r > g + 38 && r > b + 35;
  const whiteLogo = r > 185 && g > 185 && b > 185;
  return (darkHair || brownHair) && !redJersey && !whiteLogo;
}

function alphaForRectRegion(region, localX, localY) {
  if (!region.feather) return 1;
  const distance = Math.min(localX, localY, region.width - 1 - localX, region.height - 1 - localY);
  return Math.max(0, Math.min(1, distance / region.feather));
}

async function inspectDarkInnerCollar(imagePath, guards = SCENE1_STAGE_A_DARK_INNER_COLLAR_GUARDS) {
  const dimensions = await getImageDimensions(imagePath);
  const rgb = await readRgbFrame(imagePath, dimensions);
  return detectDarkInnerCollarFromRgb(rgb, dimensions, guards);
}

function detectDarkInnerCollarFromRgb(rgb, dimensions, guards = SCENE1_STAGE_A_DARK_INNER_COLLAR_GUARDS) {
  for (const guard of guards) {
    const region = normalizeGuardRegion(guard, dimensions);
    let darkPixels = 0;
    let totalPixels = 0;
    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        const idx = (y * dimensions.width + x) * 3;
        const r = rgb[idx];
        const g = rgb[idx + 1];
        const b = rgb[idx + 2];
        if (r < 85 && g < 85 && b < 85) darkPixels += 1;
        totalPixels += 1;
      }
    }
    const darkRatio = totalPixels > 0 ? darkPixels / totalPixels : 0;
    if (darkRatio > guard.darkRatioThreshold) {
      return {
        failed: true,
        dark_ratio: darkRatio,
        region: {
          id: guard.id,
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
        },
      };
    }
  }
  return { failed: false };
}

function normalizeGuardRegion(region, dimensions) {
  const x = Math.max(0, Math.min(dimensions.width - 1, Math.round(region.x * dimensions.width)));
  const y = Math.max(0, Math.min(dimensions.height - 1, Math.round(region.y * dimensions.height)));
  const width = Math.max(1, Math.min(dimensions.width - x, Math.round(region.width * dimensions.width)));
  const height = Math.max(1, Math.min(dimensions.height - y, Math.round(region.height * dimensions.height)));
  return { x, y, width, height };
}

function buildUserPrompts(prompts, user, traits) {
  return {
    ...prompts,
    bodyAlign: customizeStageForUser(prompts.bodyAlign, user, traits, 'body alignment'),
  };
}

function customizeStageForUser(stage, user, traits, stageName) {
  const resolvedTraits = traits || {};
  const resolvedStageName = stageName || 'generation';
  const gender = resolvedTraits.gender || 'male';
  const isBayernJerseyScene = /FC Bayern jersey|Bayern jersey|red FC Bayern|red-and-white FC Bayern/i.test(stage.prompt);

  const eyewearInstruction = traitsHasNoEyewear(resolvedTraits)
    ? [
        'Eyewear constraint: Image 2 has no glasses. The target person must NOT wear glasses, eyeglasses, spectacles, frames, lenses, or sunglasses.',
        'Remove any glasses from the generated target even if the original base target has glasses.',
      ].join('\n')
    : traitsHasEyewear(resolvedTraits)
      ? `Eyewear constraint: Preserve the glasses from Image 2${eyewearDescription(resolvedTraits)}. Match the user portrait eyewear shape and color; do not invent a different frame style.`
      : 'Eyewear constraint: Follow Image 2 exactly for whether the person wears glasses.';

  const headScaleAnchor = isLockerRoomScene(stage.prompt)
    ? 'HEAD SCALE LOCK: the generated head must exactly match the compact blank-mannequin head size visible in Image 1. Use the jersey collar width and shoulder span in Image 1 as hard upper limits for head width. Do not make the head larger than the original blank mannequin head in any dimension. Prefer a slightly smaller head over a larger head. If the face feels too small, that is correct - the camera distance in Image 1 makes heads appear small relative to full-body scale. A cute oversized portrait head is always wrong for this scene.'
    : '';

  const accessoryBlock = [
    'ACCESSORY EXCLUSION (hard rule): Do NOT copy any accessories from Image 2 into the result.',
    'Forbidden items: earphones, earbuds, headphones, wireless earphones, necklaces, pendants, visible jewelry at neck, earrings, electronic devices, bag straps.',
    'Even if Image 2 clearly shows these items, they must NOT appear in the generated result.',
    'The result must only show the person wearing the FC Bayern jersey from Image 1 - no added accessories from any source.',
  ].join(' ');

  const collarLock = isLockerRoomScene(stage.prompt)
    ? 'COLLAR LOCK (hard rule): The white undershirt collar and red FC Bayern jersey collar at the neck junction must be IDENTICAL to Image 1. Do not bleach, modify, remove, or alter the collar in any way. The collar area is the compositing boundary - any change here ruins the final result.'
    : '';

  const identityInstruction = isBayernJerseyScene
    ? [
        `User-specific identity constraint for ${user.id} during ${resolvedStageName}:`,
        resolvedTraits.note || 'Use Image 2 as the only source of identity traits.',
        'Identity lock (highest priority): Preserve the same person identity from Image 2. Do not synthesize a generic similar face.',
        'Facial feature lock: Keep the same eye spacing, eyelid shape, brow shape, nose width and bridge, philtrum length, mouth shape, lip thickness, cheek fullness, face width, jawline, chin shape, and facial-hair pattern from Image 2.',
        'If any of these identity-bearing features conflict with a generic attractive face prior, always prefer Image 2 over the generic face prior.',
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
        'Identity lock (highest priority): Preserve the same person identity from Image 2. Do not synthesize a generic similar face.',
        'Facial feature lock: Keep the same eye spacing, eyelid shape, brow shape, nose width and bridge, philtrum length, mouth shape, lip thickness, cheek fullness, face width, jawline, chin shape, and facial-hair pattern from Image 2.',
        eyewearInstruction,
        accessoryBlock,
        collarLock,
        'Tacit transfer boundary: copy identity, not clothing or body context.',
        'Do not copy any headwear, hat, beanie, cap, or accessory from Image 2.',
        'Do not use any fixed default face, fixed default glasses, or generic identity template.',
        headScaleAnchor,
      ].filter(Boolean).join('\n');

  let prompt = stage.prompt
    .replace(/The target should have short black hair and black rectangular glasses\./g, 'The target should match Image 2 for hair, face shape, facial hair, skin tone, and whether glasses are present.')
    .replace(/The target person must look like the adult Asian male from Image 2:\nshort black hair,\nblack rectangular glasses,\nround broad face,/g, 'The target person must look like the adult Asian male from Image 2:\nmatching hair from Image 2,\nmatching eyewear state from Image 2,\nmatching face shape from Image 2,')
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
    'oversized head, enlarged face, head larger than mannequin, zoomed-in face, close-up face scale',
    'hat, beanie, cap, knit cap, winter hat, headband, headwear copied from source photo',
    'earphones, earbuds, headphones, wireless earphones, necklace, pendant, visible neck jewelry, earring, electronic device at neck',
    'white hanging jersey, changed jersey color on wall, white jersey on locker, altered background jersey',
    'bleached collar, missing white collar, altered jersey collar, changed neckline',
    'disconnected face, floating head detached from neck, pasted face effect, face not integrated with neck, mismatched skin tone between face and neck',
    'generic face, reassembled facial features, wrong jawline, wrong eye spacing, wrong nose shape, wrong mouth shape, wrong moustache, wrong beard pattern',
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
    .replace(/\badult Asian male\b/g, 'adult Asian female')
    .replace(/\badult male\b/g, 'adult female')
    .replace(/\bmale body\b/g, 'female body')
    .replace(/Do not feminize the target\./g, 'Do not masculinize the target.')
    .replace(/Do not give the target long hair, bangs, or a bob haircut\./g, 'Keep the hairstyle faithful to Image 2 while adapting it naturally to the locker-room photo.')
    .replace(/Do not use any fixed default face, fixed default glasses, or generic Asian male template\./g, 'Do not use any fixed default face, fixed default glasses, or generic identity template.');
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

async function createMask({ sourceImage, outputImage, regions }) {
  const dims = await getImageDimensions(sourceImage);
  const normalized = regions.map((region) => ({
    ...region,
    x: Math.round(dims.width * region.x),
    y: Math.round(dims.height * region.y),
    width: Math.round(dims.width * region.width),
    height: Math.round(dims.height * region.height),
  }));
  const conditions = normalized.map((region) => {
    if (region.shape === 'ellipse') {
      const cx = region.x + region.width / 2;
      const cy = region.y + region.height / 2;
      const rx = Math.max(1, region.width / 2);
      const ry = Math.max(1, region.height / 2);
      return `lte(pow((X-${cx})/${rx},2)+pow((Y-${cy})/${ry},2),1)`;
    }
    return `between(X,${region.x},${region.x + region.width})*between(Y,${region.y},${region.y + region.height})`;
  });
  const filter = `format=gray,geq=lum='if(gt(${conditions.join('+')},0),255,0)'`;
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=black:s=${dims.width}x${dims.height}`,
    '-vf', filter,
    '-frames:v', '1',
    outputImage,
  ]);
}

async function getImageDimensions(imagePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0:s=x',
    imagePath,
  ]);
  const [width, height] = stdout.trim().split('x').map(Number);
  if (!width || !height) throw new Error(`Could not read image dimensions: ${imagePath}`);
  return { width, height };
}

async function readRgbFrame(imagePath, dimensions) {
  const { width, height } = dimensions;
  const { stdout } = await execFileAsync('ffmpeg', [
    '-v', 'error',
    '-i', imagePath,
    '-vf', `scale=${width}:${height}:flags=lanczos,format=rgb24`,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ], {
    encoding: 'buffer',
    maxBuffer: width * height * 3 + 1024,
  });
  return stdout;
}

async function writeRgbFrame(rgb, dimensions, outputImage) {
  const tempRaw = `${outputImage}.${Date.now()}.rgb`;
  try {
    await fsp.writeFile(tempRaw, rgb);
    await execFileAsync('ffmpeg', [
      '-y',
      '-v', 'error',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-s', `${dimensions.width}x${dimensions.height}`,
      '-i', tempRaw,
      '-frames:v', '1',
      '-q:v', '2',
      outputImage,
    ]);
  } finally {
    await fsp.unlink(tempRaw).catch(() => {});
  }
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
  if (!response.ok || data.error) {
    throw new Error(`Seedream request failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function callVisionJson({ prompt, images }) {
  const apiKey = process.env.VISION_API_KEY || process.env.SEEDREAM_NATIVE_API_KEY;
  if (!apiKey) throw new Error('VISION_API_KEY or SEEDREAM_NATIVE_API_KEY is required');

  const response = await fetchWithTimeout(
    process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.VISION_MODEL || DEFAULT_VISION_MODEL,
        messages: [{
          role: 'user',
          content: [
            ...images.map((image) => ({ type: 'image_url', image_url: { url: toVisionImageUrl(image) } })),
            { type: 'text', text: prompt },
          ],
        }],
        max_tokens: 2200,
        temperature: 0.2,
      }),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(`Vision request failed: ${JSON.stringify(data)}`);
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Vision response was empty');
  return parseJsonText(text);
}

async function downloadGeneratedImage(url, outputPath) {
  const imageResponse = await fetchWithTimeout(url);
  if (!imageResponse.ok) {
    throw new Error(`Generated image download failed: ${imageResponse.status} ${imageResponse.statusText}`);
  }
  await fsp.writeFile(outputPath, Buffer.from(await imageResponse.arrayBuffer()));
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS) });
}

function toDataUrl(filePath) {
  const buffer = fs.readFileSync(filePath);
  return `data:${detectMime(buffer, filePath)};base64,${buffer.toString('base64')}`;
}

function toVisionImageUrl(image) {
  if (typeof image !== 'string') throw new Error('Vision image must be a string path or URL');
  if (/^(data:|https?:\/\/)/i.test(image)) return image;
  return toDataUrl(image);
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

function parseJsonText(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]);
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`Could not parse JSON: ${trimmed.slice(0, 160)}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactSecrets(text) {
  return String(text).replace(/(ark|sk)-[A-Za-z0-9_-]+/g, '$1-<redacted>');
}

module.exports = {
  runScene1V3Pipeline,
};
