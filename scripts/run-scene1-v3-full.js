#!/usr/bin/env node
/**
 * run-scene1v3-v3-full.js
 * 场景6 v3 完整流程: Stage A 选图 → 固定场景区域直接回贴
 *
 * 从已有的 Stage A batch 结果出发:
 *   1. 读取 Stage A manifest.json，按 user 分组 (4.5 / 5.0 两版)
 *   2. Stage A 审核: 比较两版 Stage A，选择已达到视觉阈值的模型
 *   3. 将获胜 Stage A 图按底图固定 target ellipse 直接回贴，并还原啤酒杯保护区
 *   4. 若 Stage A 未达到阈值，重新生成两版 Stage A 后再审核
 *   5. 若达到最大回退轮次仍无可用 Stage A，则按 LLM 分数选择最高候选兜底输出
 *   6. 输出 result/{scene}_full_{timestamp}/
 *
 * 用法:
 *   node scripts/run-scene1v3-v3-full.js \
 *     --manifest result/scene1v3_stagea_20260505_052614/manifest.json \
 *     [--env path/.env] [--concurrency 4] [--users user1,user2] [--out-dir path]
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const {
  composeCleanBackgroundEditRegionsOverBase,
  restoreProtectedRegions,
  buildStagePrompts,
} = require('../src/pipeline');
const { loadSceneConfig } = require('../src/scenes');
const { validateTraits } = require('../src/trait-detector');
const {
  eyewearDescription,
  resolveScene6TraitsForUsers,
  resolveScene6v3SceneId,
  traitsHasEyewear,
  traitsHasNoEyewear,
} = require('../src/scene1v3-traits');

const execFileAsync = promisify(execFile);

// ─── Constants ─────────────────────────────────────────────────────────────────
const PROJECT_DIR        = path.resolve(__dirname, '..');
const DEFAULT_ENV        = path.join(PROJECT_DIR, 'server', '.env');
const DEFAULT_CONCURRENCY       = 4;
const DEFAULT_STAGE_ATTEMPTS    = 5;   // per-generation API retry limit
const DEFAULT_REVIEW_ATTEMPTS   = 3;   // LLM review retry limit
const MAX_STAGE_A_REGEN_ROUNDS  = 2;   // how many regeneration rounds before giving up
const DEFAULT_FETCH_TIMEOUT_MS  = 15 * 60 * 1000;
const DEFAULT_VISION_MODEL      = 'doubao-seed-2-0-pro';
const DEFAULT_TRAITS_CACHE      = path.join(PROJECT_DIR, '素材', '用户测试照片', 'traits.json');
const RESULT_DIR                = path.join(PROJECT_DIR, '生成测试', 'scene1v3_result');
const FIXED_SCENE_REGION_COMPOSE_MODE = 'fixed_scene_region';
const DIRECT_STAGE_A_SELECTION_MODE = 'stage_a_direct_fixed_region';
const FALLBACK_STAGE_A_SELECTION_MODE = 'stage_a_fallback_best_score_fixed_region';

const STAGE_A_DARK_INNER_COLLAR_GUARDS = [
  {
    id: 'central_white_undershirt_collar_dark_intrusion',
    x: 0.600,
    y: 0.440,
    width: 0.030,
    height: 0.018,
    darkRatioThreshold: 0.25,
  },
];

// ─── Stage A mask regions (copied from run-scene1v3-v3.js) ───────────────────────
const STAGE_A_MASK_REGIONS = {
  male:   [{ id: 'head_hair_neck', x: 0.52, y: 0.29, width: 0.17, height: 0.23, shape: 'ellipse', feather: 18 }],
  female: [{ id: 'head_hair_neck', x: 0.49, y: 0.25, width: 0.22, height: 0.28, shape: 'ellipse', feather: 18 }],
};

// ─── Model configs (copied from run-scene1v3-v3.js) ─────────────────────────────
const MODELS = {
  seedream_4_5: {
    id: 'seedream_4_5',
    model: 'doubao-seedream-4-5-251128',
    outputFormat: null,
    maskStrength: 0.78,   // used for Stage A regeneration
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

// ─── Stage A review prompt ────────────────────────────────────────────────────
const STAGE_A_REVIEW_PROMPT = `You are evaluating two AI-generated locker-room photos for direct fixed-region paste quality.

Scene context: Paulaner locker room. A faceless mannequin sits on a bench in the center bay, wearing a red-and-white FC Bayern jersey, holding a Paulaner beer glass.

Image 1: Stage A result from model 4.5
Image 2: Stage A result from model 5.0
Image 3: Original base image (the faceless mannequin — reference for SCALE, POSE, PROPORTIONS)
Image 4: User portrait (reference for IDENTITY and HAIRSTYLE)

Project calibration examples:
- A side-facing or obvious three-quarter Stage A head is NOT passable, even if the standalone image looks attractive.
- If the Stage A jersey collar/white undershirt neckline differs from Image 3, the direct paste can fail, so that candidate is NOT passable.
- Do NOT return or evaluate source_region coordinates. The compositor always uses Image 3's fixed target region for direct paste.

CRITICAL EVALUATION RULE — BODY SCALE:
Compare the person's full-body size in Images 1 and 2 against the mannequin's size in Image 3.
The generated person MUST appear at the same size and camera distance as the mannequin in Image 3.
The locker-room background, bench, hanging jerseys, and floor must be visible at the same relative scale.
If the person appears LARGER or CLOSER than the mannequin (zoomed-in feel, too much of the frame filled), it is a HARD FAIL for body_scale_matches_base.
The person may appear slightly SMALLER or FURTHER than the mannequin — that is acceptable.

Evaluate each result on ALL of these fields:

1. face_replaced (bool): A real human face is visible — the smooth featureless mannequin face has been replaced.
2. body_scale_matches_base (bool): The person's full-body size and camera distance matches Image 3. FAIL if the person is zoomed in, too large, or too close to camera compared to Image 3.
3. jersey_collar_unchanged (bool): The white undershirt collar and red jersey collar at the neck junction must match Image 3 in shape, color, position, and visible neckline. HARD FAIL if the collar is bleached, shifted, missing, widened/narrowed, V-shaped differently, visibly generated, black/dark, or replaced by a dark undershirt/inner collar. Do not pass "minor" collar differences here because final compositing uses this seam.
4. background_jerseys_unchanged (bool): The red FC Bayern jerseys hanging on the left and right walls in Image 3 must still be RED in the result. FAIL if any hanging jersey turned white or significantly changed color.
5. accessories_absent (bool): No earphones, earbuds, headphones, necklaces, pendants, or electronic accessories from Image 4 appear in the result. FAIL if any such accessory is visible.
6. no_big_head (bool): Head size is proportional to the body and comparable to the mannequin head size in Image 3. Not oversized.
7. no_halo_or_color_patch (bool): The area around hair, ears, temples, jawline, and neck blends into the blue locker background without a visible white glow, pale oval, square patch, light halo, or background color mismatch. HARD FAIL if a bright/white/gray aura or mismatched blue patch is visible around the head.
8. neck_integrated (bool): Chin, jaw, neck, throat, and collar transition read as one continuous photographed person. HARD FAIL for floating head, pasted-face effect, hard neck seam, mismatched face-vs-neck skin tone, missing neck, or a neck that stops above the jersey collar.
9. framing_matches_base (bool): The EXACT camera position, angle, and full-body framing match Image 3. This is a COMBINED check — ALL of the following must be true:
   a) The person's body is sitting straight/upright with LEVEL shoulders, matching the mannequin's posture in Image 3. FAIL if the person's torso or shoulders are tilted at any angle.
   b) The camera viewpoint is identical — the locker room bays appear from the SAME front-facing angle as Image 3. FAIL if the angle appears rotated/shifted even slightly (e.g., if the locker room appears from a slightly different left/right viewpoint).
   c) The full body proportions in the frame match Image 3: compare visible blue wall space ABOVE the person's head, visible bench on both sides, and visible floor. If the person appears noticeably larger (less surrounding locker room visible) or smaller, FAIL.
   FAIL framing_matches_base if ANY of (a), (b), or (c) is false.
10. hairstyle_ok (bool): Compare hairstyle direction (up/down), approximate length, and overall style against Image 4. FAIL if: (a) Image 4 has short hair in a bun but result has long flowing hair; (b) the hairstyle is a completely different style/direction. Do NOT fail for minor natural adaptation differences.
11. head_pose_matches_base (bool): The face/head is front-facing and aligned like the mannequin in Image 3. HARD FAIL if the nose-mouth-chin axis is not centered on the body, the head is side-facing, profile, noticeably three-quarter, rotated, tilted, or cannot be pasted onto the front-facing body naturally.
12. score (1-10): Overall quality. Deduct 3+ for wrong framing/scale/tilt. Deduct 3+ for side-facing/rotated head. Deduct 3+ for halo/color patch. Deduct 3+ for pasted/floating head or neck seam. Deduct 3+ for collar mismatch, black/dark inner collar, dark undershirt collar transfer, or altered white collar. Deduct 2+ for background jerseys. Deduct 2+ for big head. Deduct 2+ for accessories. Deduct 2+ for completely wrong hairstyle.

PASS condition: face_replaced=true AND body_scale_matches_base=true AND jersey_collar_unchanged=true AND background_jerseys_unchanged=true AND accessories_absent=true AND no_big_head=true AND no_halo_or_color_patch=true AND neck_integrated=true AND framing_matches_base=true AND hairstyle_ok=true AND head_pose_matches_base=true AND score >= 8
Score 7 is NOT pass for this workflow. It may look acceptable as a standalone image, but it is not reliable enough as a final compositing source.
The returned winner is the Stage A image the pipeline should directly paste with Image 3's fixed target region. If winner="neither", the pipeline regenerates Stage A.

WINNER selection rules (STRICTLY follow in order):
1. If only one passes → winner is that model.
2. If both pass → compare scores. If scores differ by 2+, pick the higher. If equal or differ by 1, pick "5_0".
3. If neither passes due to CRITICAL failures (face_replaced=false, framing_matches_base=false, body_scale_matches_base=false, no_big_head=false, no_halo_or_color_patch=false, neck_integrated=false, head_pose_matches_base=false, jersey_collar_unchanged=false, black/dark inner collar visible, background_jerseys_unchanged=false, accessories_absent=false, or hairstyle_ok=false) → winner is "neither".
4. If neither passes only because both scores are 7 with every bool true → winner is "neither" so the pipeline can regenerate a better source.

Return JSON ONLY — no markdown, no preamble:
{
  "result_4_5": {"face_replaced": bool, "body_scale_matches_base": bool, "jersey_collar_unchanged": bool, "background_jerseys_unchanged": bool, "accessories_absent": bool, "no_big_head": bool, "no_halo_or_color_patch": bool, "neck_integrated": bool, "framing_matches_base": bool, "hairstyle_ok": bool, "head_pose_matches_base": bool, "score": number, "issues": []},
  "result_5_0": {"face_replaced": bool, "body_scale_matches_base": bool, "jersey_collar_unchanged": bool, "background_jerseys_unchanged": bool, "accessories_absent": bool, "no_big_head": bool, "no_halo_or_color_patch": bool, "neck_integrated": bool, "framing_matches_base": bool, "hairstyle_ok": bool, "head_pose_matches_base": bool, "score": number, "issues": []},
  "winner": "4_5" | "5_0" | "neither",
  "reason": "one sentence"
}`;

// ─── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv(args.env);

  const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
  const reviewNotes = loadReviewNotes(args.reviewNotes);
  const userEntries = groupByUser(manifest.results);

  const allUserIds = [...userEntries.keys()].sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true })
  );
  const userIds = args.users ? args.users : allUserIds;

  // Validate requested users exist
  for (const uid of userIds) {
    if (!userEntries.has(uid)) throw new Error(`用户 ${uid} 不在 manifest 中`);
  }
  const traitsMap = await resolveFullRunnerTraits(userIds, userEntries, args);
  for (const userId of userIds) {
    const traits = traitsMap[userId];
    console.log(`[traits] ${userId}: source=${traits.traits_source || args.traitsSource}, gender=${traits.gender}, eyewear=${traits.eyewear}`);
  }

  const ts = formatTimestamp(new Date());
  const runRoot = path.join(PROJECT_DIR, 'runs', `user_folder_matrix_scene1v3_full_${ts}`);
  const outDir = args.outDir || path.join(RESULT_DIR, `scene1v3_full_${ts}`);

  await fs.promises.mkdir(path.join(runRoot, '00_masks'), { recursive: true });
  await fs.promises.mkdir(path.join(outDir, 'images'), { recursive: true });

  // Pre-generate masks (re-used from Stage A run if available, otherwise create fresh)
  console.log('Preparing base masks (for possible Stage A regeneration)...');
  const existingMaskDir = path.join(manifest.run_root, '00_masks');
  const baseMasks = await prepareMasks(path.join(runRoot, '00_masks'), existingMaskDir);
  console.log(`Masks ready: male=${baseMasks.male}, female=${baseMasks.female}`);

  // Load scene configs (unique scenes from manifest)
  const sceneCache = new Map();
  for (const sceneId of (manifest.resolved_scenes || [])) {
    if (!sceneCache.has(sceneId)) sceneCache.set(sceneId, loadSceneConfig(sceneId));
  }

  // Build per-user jobs
  const jobs = userIds.map((userId) => {
    const entries = userEntries.get(userId);
    const traits = traitsMap[userId];
    const sceneId = resolveScene6v3SceneId('scene1v3', traits);
    let scene = sceneCache.get(sceneId);
    if (!scene) {
      scene = loadSceneConfig(sceneId);
      sceneCache.set(sceneId, scene);
    }
    return {
      userId,
      entries,
      traits,
      scene,
      runRoot,
      outDir,
      baseMasks,
      humanReviewNotes: reviewNotes[userId] || [],
    };
  });

  console.log(`Source manifest: ${args.manifest}`);
  console.log(`Users (${userIds.length}): ${userIds.join(', ')}`);
  console.log(`Concurrency: ${args.concurrency}`);
  console.log(`Traits source fallback: ${args.traitsSource}`);
  if (args.reviewNotes) console.log(`Human review notes: ${args.reviewNotes}`);
  console.log(`Run root: ${runRoot}`);
  console.log(`Result dir: ${outDir}`);

  const results = await runPool(jobs, args.concurrency, runJob);

  const summary = {
    created_at: new Date().toISOString(),
    source_manifest: path.resolve(args.manifest),
    traits_source_fallback: args.traitsSource,
    traits_cache: args.traitsSource === 'cache' ? args.traitsCache : null,
    run_root: runRoot,
    out_dir: outDir,
    results,
  };
  await fs.promises.writeFile(path.join(runRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await fs.promises.writeFile(path.join(runRoot, 'summary.md'),   renderSummary(summary));
  await fs.promises.writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await fs.promises.writeFile(path.join(outDir, 'summary.md'),    renderSummary(summary));
  await fs.promises.writeFile(path.join(outDir, 'overview.html'), buildOverviewHtml(summary, outDir));

  console.log(`\nDone. Result: ${outDir}`);
  if (results.some((r) => r.status !== 'completed')) process.exitCode = 1;
}

function passesStageVisualQuality(r) {
  if (!r) return false;
  return r.face_replaced === true
    && r.body_scale_matches_base === true
    && r.jersey_collar_unchanged === true
    && r.background_jerseys_unchanged === true
    && r.accessories_absent === true
    && r.no_big_head === true
    && r.no_halo_or_color_patch === true
    && r.neck_integrated === true
    && r.hairstyle_ok === true
    && r.framing_matches_base === true
    && r.head_pose_matches_base === true
    && (r.score ?? 0) >= 8;
}

async function applyDeterministicStageGuards({ review, stageAImages, label }) {
  const findings = {};
  await Promise.all(
    Object.entries(stageAImages).map(async ([modelId, imagePath]) => {
      const darkCollar = await inspectDarkInnerCollar(imagePath).catch((error) => ({
        failed: false,
        warning: redactSecrets(error.message),
      }));
      if (darkCollar.failed) {
        findings[modelId] = [
          {
            field: 'jersey_collar_unchanged',
            issue: `black/dark inner collar detected in the white undershirt collar zone (${darkCollar.region.id}, dark_ratio=${darkCollar.dark_ratio.toFixed(3)})`,
            guard: darkCollar,
          },
        ];
      } else if (darkCollar.warning) {
        console.warn(`[guard] ${label}/${modelId}: ${darkCollar.warning}`);
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
  if (guarded.winner === 'neither' && review?.winner && review.winner !== 'neither') {
    guarded.reason = `Deterministic guard rejected LLM winner ${review.winner}; ${guarded.reason || 'no candidate passed all direct-paste gates'}`;
  }
  return guarded;
}

function applyHumanReviewNotes(review, notes = []) {
  const normalizedNotes = notes.map((note) => String(note || '').trim()).filter(Boolean);
  if (normalizedNotes.length === 0) return review;

  const findings = {
    seedream_4_5: [],
    seedream_5_0: [],
  };
  const fields = fieldsFromHumanReviewNotes(normalizedNotes);
  const issue = `Human review note: ${normalizedNotes.join(' | ')}`;
  for (const modelId of Object.keys(findings)) {
    for (const field of fields) {
      findings[modelId].push({ field, issue });
    }
  }
  return applyStageGuardFindings(review, findings);
}

function fieldsFromHumanReviewNotes(notes) {
  const text = notes.join('\n').toLowerCase();
  const fields = new Set();
  if (/白|亮|halo|white|bright|glow|patch|左上|不自然/.test(text)) {
    fields.add('no_halo_or_color_patch');
  }
  if (/脖子|一体|割裂|neck|floating|pasted|integrated/.test(text)) {
    fields.add('neck_integrated');
  }
  if (/领|衣领|内搭|collar|undershirt|neckline/.test(text)) {
    fields.add('jersey_collar_unchanged');
  }
  if (fields.size === 0) fields.add('no_halo_or_color_patch');
  return [...fields];
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

async function inspectDarkInnerCollar(imagePath) {
  const dimensions = await getImageDimensions(imagePath);
  const rgb = await readRgbFrame(imagePath, dimensions);
  return detectDarkInnerCollarFromRgb(rgb, dimensions);
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
    await fs.promises.writeFile(tempRaw, rgb);
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
    await fs.promises.unlink(tempRaw).catch(() => {});
  }
}

function detectDarkInnerCollarFromRgb(rgb, dimensions, guards = STAGE_A_DARK_INNER_COLLAR_GUARDS) {
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

// ─── Composite helper ────────────────────────────────────────────────────
async function generateFinalComposite({ stageAImage, baseImage, scene, finalDir, modelId }) {
  await fs.promises.mkdir(finalDir, { recursive: true });
  const finalImage = path.join(finalDir, `result_${modelId}.jpg`);

  await composeCleanBackgroundEditRegionsOverBase({
    sourceImage: baseImage,
    targetImage: stageAImage,
    outputImage: finalImage,
    regions: buildCleanFinalRegions(scene),
  });

  // Restore Paulaner beer glass from base
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

async function restoreMaskedProtectedRegions({ sourceImage, targetImage, outputImage, regions }) {
  const dimensions = await getImageDimensions(targetImage);
  const [sourceRgb, targetRgb] = await Promise.all([
    readRgbFrame(sourceImage, dimensions),
    readRgbFrame(targetImage, dimensions),
  ]);
  const outputRgb = restoreMaskedProtectedRegionsFromRgb({
    sourceRgb,
    targetRgb,
    dimensions,
    regions,
  });
  await writeRgbFrame(outputRgb, dimensions, outputImage);
}

function restoreMaskedProtectedRegionsFromRgb({ sourceRgb, targetRgb, dimensions, regions }) {
  const outputRgb = Buffer.from(targetRgb);
  for (const region of regions || []) {
    const normalized = normalizeProtectedRegionForRgb(region, dimensions);
    restoreMaskedRegionFromRgb({ sourceRgb, targetRgb, outputRgb, dimensions, region: normalized });
  }
  return outputRgb;
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

function normalizeProtectedRegionForRgb(region, dimensions) {
  const normalized = normalizeGuardRegion(region, dimensions);
  return {
    ...normalized,
    id: region.id || `region_${normalized.x}_${normalized.y}_${normalized.width}_${normalized.height}`,
    feather: region.feather || 0,
  };
}

function buildCleanFinalRegions(scene) {
  if (Array.isArray(scene.finalRegions) && scene.finalRegions.length > 0) {
    return scene.finalRegions.map((region) => ({ ...region }));
  }

  return (scene.finalRegions || scene.editRegions).map((region) => ({ ...region }));
}

// ─── Per-user job ──────────────────────────────────────────────────────
async function runJob({ userId, entries, traits, scene, runRoot, outDir, baseMasks, humanReviewNotes = [] }) {
  const jobDir   = path.join(runRoot, userId);
  const inputDir = path.join(jobDir, '00_inputs');
  const reviewDir = path.join(jobDir, 'llm_review');
  const finalDir  = path.join(jobDir, 'final');

  for (const dir of [inputDir, reviewDir, finalDir]) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  const label = userId;
  const startedAt = new Date();

  try {
    // ── Step 1: locate existing Stage A images ─────────────────────────────
    const entry45 = entries.find((e) => e.model === 'seedream_4_5');
    const entry50 = entries.find((e) => e.model === 'seedream_5_0');
    if (!entry45) throw new Error('缺少 seedream_4_5 的 Stage A 结果');
    if (!entry50) throw new Error('缺少 seedream_5_0 的 Stage A 结果');

    // ── Step 2: copy inputs from original Stage A job dir ─────────────────
    const srcJobDir = entry45.job_dir;
    const baseImage = path.join(inputDir, 'base.jpg');
    const userImage = path.join(inputDir, 'user.jpg');

    if (!fs.existsSync(baseImage)) {
      await fs.promises.copyFile(path.join(srcJobDir, '00_inputs', 'base.jpg'), baseImage);
    }
    if (!fs.existsSync(userImage)) {
      await fs.promises.copyFile(path.join(srcJobDir, '00_inputs', 'user.jpg'), userImage);
    }
    const userTraitsPath = path.join(inputDir, 'user_traits.json');
    await fs.promises.writeFile(userTraitsPath, `${JSON.stringify(traits, null, 2)}\n`);
    const referenceImages = await copyReferenceImages(srcJobDir, inputDir);

    // ── Step 3: build per-user prompts ────────────────────────────────────
    const basePrompts  = buildStagePrompts({
      targetPerson:        scene.target,
      targetDetail:        scene.targetDetail,
      protectedPerson:     scene.protectedPerson,
      referenceImageCount: (scene.referenceImages || []).length,
    });
    const userPrompts = buildUserPrompts(basePrompts, { id: userId }, traits);

    // ── Step 4/5: Stage A review → direct fixed-region paste ───────────────
    let stageAImages = {
      seedream_4_5: entry45.stage_a_image,
      seedream_5_0: entry50.stage_a_image,
    };
    let stageARegenRounds = 0;
    let finalStageReview = null;
    let selectedFinal = null;
    let compositeResults = {};
    let candidates = [];

    for (let round = 0; round <= MAX_STAGE_A_REGEN_ROUNDS; round += 1) {
      const reviewLabel = round === 0 ? label : `${label}/regen${round}`;
      console.log(`[review] ${reviewLabel}: LLM comparing Stage A 4.5 vs 5.0...`);
      let stageReview = await reviewStageASafe({
        image45: stageAImages.seedream_4_5,
        image50: stageAImages.seedream_5_0,
        baseImage,
        userImage,
        label: reviewLabel,
      });
      if (round === 0 && humanReviewNotes.length > 0) {
        stageReview = applyHumanReviewNotes(stageReview, humanReviewNotes);
      }
      stageReview = await applyDeterministicStageGuards({
        review: stageReview,
        stageAImages,
        label: reviewLabel,
      });
      finalStageReview = stageReview;
      await fs.promises.writeFile(
        path.join(reviewDir, round === 0 ? 'stage_a_review.json' : `stage_a_regen_${round}_review.json`),
        `${JSON.stringify(stageReview, null, 2)}\n`
      );
      console.log(`[review] ${reviewLabel}: winner=${stageReview.winner}  (4.5 score=${stageReview.result_4_5?.score}, 5.0 score=${stageReview.result_5_0?.score})`);

      candidates = buildStageCandidates(stageReview, stageAImages, scene);
      let selectedCandidate = candidates[0] || null;
      if (candidates.length === 0) {
        console.log(`[select] ${reviewLabel}: no Stage A image passed direct-paste quality checks`);
        if (round === MAX_STAGE_A_REGEN_ROUNDS) {
          selectedCandidate = buildFallbackStageCandidate(stageReview, stageAImages);
          candidates = selectedCandidate ? [selectedCandidate] : [];
          if (selectedCandidate) {
            console.log(`[select] ${reviewLabel}: fallback after max regen → ${selectedCandidate.modelId} (score=${selectedCandidate.score})`);
          }
        }
      }

      if (selectedCandidate) {
        const attemptFinalDir = round === 0 ? finalDir : path.join(finalDir, `regen_${round}`);
        const attemptCompositeResults = {};
        const cand = selectedCandidate;
        console.log(`[composite] ${label}/${cand.modelId}: direct fixed-region paste from Stage A...`);
        const finalImage = await generateFinalComposite({
          stageAImage: cand.stageAImage,
          baseImage,
          scene,
          finalDir: attemptFinalDir,
          modelId: cand.modelId,
        });
        attemptCompositeResults[cand.modelId] = finalImage;

        const candidateName = `${userId}_${cand.modelId}${round > 0 ? `_regen_${round}` : ''}.jpg`;
        const candidatePath = path.join(outDir, 'images', candidateName);
        await fs.promises.copyFile(finalImage, candidatePath);
        attemptCompositeResults[`${cand.modelId}_candidate_result`] = candidatePath;

        const selectedOutput = path.join(outDir, 'images', `${userId}.jpg`);
        await fs.promises.copyFile(finalImage, selectedOutput);
        attemptCompositeResults[`${cand.modelId}_result`] = selectedOutput;
        attemptCompositeResults.final_selected = selectedOutput;
        compositeResults = attemptCompositeResults;
        selectedFinal = {
          modelId: cand.modelId,
          resultImage: selectedOutput,
          stageAImage: cand.stageAImage,
          sourceRegion: null,
          composeMode: cand.composeMode,
          selectionMode: cand.selectionMode,
          fallback: cand.fallback === true,
        };
        const selectionReason = cand.fallback ? 'fallback selected' : 'passed';
        console.log(`[final] ${label}: Stage A ${cand.modelId} ${selectionReason}; direct paste → ${selectedOutput}`);
        break;
      }

      if (round === MAX_STAGE_A_REGEN_ROUNDS) {
        throw new Error(`No usable Stage A image after ${MAX_STAGE_A_REGEN_ROUNDS} regeneration rounds`);
      }

      const nextRound = round + 1;
      stageARegenRounds = nextRound;
      const regenBase = path.join(jobDir, `regen_${nextRound}`);
      const maskImage = baseMasks[traits.gender];
      const regenNote45 = buildRegenNote(nextRound, finalStageReview, 'seedream_4_5');
      const regenNote50 = buildRegenNote(nextRound, finalStageReview, 'seedream_5_0');
      const regenDir45 = path.join(regenBase, 'seedream_4_5', '02_stage_a_body_align');
      const regenDir50 = path.join(regenBase, 'seedream_5_0', '02_stage_a_body_align');

      console.log(`[regen] ${label}: round ${nextRound}/${MAX_STAGE_A_REGEN_ROUNDS} — regenerating Stage A after failed gate...`);
      const [promptRewrite45, promptRewrite50] = await Promise.all([
        rewriteStageAPrompt({
          modelId: 'seedream_4_5',
          round: nextRound,
          review: finalStageReview,
          currentStage: userPrompts.bodyAlign,
          failedImage: stageAImages.seedream_4_5,
          baseImage,
          userImage,
          outputDir: regenDir45,
          label: `${label}/regen${nextRound}/4.5`,
          regenNote: regenNote45,
        }),
        rewriteStageAPrompt({
          modelId: 'seedream_5_0',
          round: nextRound,
          review: finalStageReview,
          currentStage: userPrompts.bodyAlign,
          failedImage: stageAImages.seedream_5_0,
          baseImage,
          userImage,
          outputDir: regenDir50,
          label: `${label}/regen${nextRound}/5.0`,
          regenNote: regenNote50,
        }),
      ]);
      const regenResults = await Promise.allSettled([
        regenerateStageA({
          model: MODELS.seedream_4_5, scene, prompts: userPrompts,
          baseImage, userImage, referenceImages, maskImage,
          outputDir: regenDir45,
          label: `${label}/regen${nextRound}/4.5`, regenNote: regenNote45, promptRewrite: promptRewrite45,
        }),
        regenerateStageA({
          model: MODELS.seedream_5_0, scene, prompts: userPrompts,
          baseImage, userImage, referenceImages, maskImage,
          outputDir: regenDir50,
          label: `${label}/regen${nextRound}/5.0`, regenNote: regenNote50, promptRewrite: promptRewrite50,
        }),
      ]);

      const new45 = regenResults[0].status === 'fulfilled'
        ? regenResults[0].value
        : { image: stageAImages.seedream_4_5, failed: true, error: regenResults[0].reason };
      const new50 = regenResults[1].status === 'fulfilled'
        ? regenResults[1].value
        : { image: stageAImages.seedream_5_0, failed: true, error: regenResults[1].reason };

      if (new45.failed && new50.failed) {
        throw new Error(`Stage A regeneration failed for both models: 4.5=${redactSecrets(new45.error?.message || new45.error)}; 5.0=${redactSecrets(new50.error?.message || new50.error)}`);
      }

      stageAImages = {
        seedream_4_5: new45.image,
        seedream_5_0: new50.image,
      };
    }

    // User ref thumbnail
    const userThumbPath = path.join(outDir, 'images', `_ref_${userId}.jpg`);
    if (!fs.existsSync(userThumbPath)) await fs.promises.copyFile(userImage, userThumbPath);

    // ── Save selection + result ──────────────────────────────────────────────
    await fs.promises.writeFile(
      path.join(jobDir, 'selected_stage_a.json'),
      `${JSON.stringify({
        candidates,
        selected_final: selectedFinal,
        regen_rounds: stageARegenRounds,
        stage_a_review: finalStageReview,
        final_review: null,
        final_selection_mode: selectedFinal.selectionMode,
        traits,
      }, null, 2)}\n`
    );
    console.log(`[done] ${label}: ${selectedFinal.modelId} final selected`);

    const result = {
      user:                userId,
      scene:               scene.id,
      traits_source:       traits.traits_source || null,
      traits,
      status:              'completed',
      selected_model:      selectedFinal.modelId,
      both_finals:         false,
      stage_a_regenerated: stageARegenRounds > 0,
      stage_a_regen_rounds: stageARegenRounds,
      llm_winner:          finalStageReview.winner,
      llm_score_4_5:       finalStageReview.result_4_5?.score ?? null,
      llm_score_5_0:       finalStageReview.result_5_0?.score ?? null,
      final_llm_winner:    null,
      final_score_4_5:     null,
      final_score_5_0:     null,
      final_selection_mode: DIRECT_STAGE_A_SELECTION_MODE,
      fallback_best_score: selectedFinal.fallback === true,
      stage_a_images:      Object.fromEntries(candidates.map((c) => [c.modelId, c.stageAImage])),
      stage_a_source_regions: Object.fromEntries(candidates.map((c) => [c.modelId, c.sourceRegion])),
      final_images:        compositeResults,
      result_image:        selectedFinal.resultImage,
      started_at:          startedAt.toISOString(),
      finished_at:         new Date().toISOString(),
      error:               null,
    };
    await fs.promises.writeFile(path.join(jobDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;

  } catch (error) {
    console.error(`[fail] ${label}: ${redactSecrets(error.message)}`);
    const result = {
      user:        userId,
      scene:       scene.id,
      status:      'failed',
      started_at:  startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      traits_source: traits?.traits_source || null,
      traits,
      error:       redactSecrets(error.message),
    };
    await fs.promises.writeFile(
      path.join(jobDir, 'result.json'),
      `${JSON.stringify(result, null, 2)}\n`
    ).catch(() => {});
    return result;
  }
}

function buildStageCandidates(review, stageAImages) {
  for (const modelId of buildStageSelectionOrder(review)) {
    const result = reviewResultForModel(review, modelId);
    if (!stageAImages[modelId] || !passesStageVisualQuality(result)) continue;
    return [{
      modelId,
      stageAImage: stageAImages[modelId],
      score: result.score ?? 0,
      passes: true,
      probe: false,
      sourceRegion: null,
      composeMode: FIXED_SCENE_REGION_COMPOSE_MODE,
      selectionMode: DIRECT_STAGE_A_SELECTION_MODE,
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
      passes: false,
      fallback: true,
      probe: false,
      sourceRegion: null,
      composeMode: FIXED_SCENE_REGION_COMPOSE_MODE,
      selectionMode: FALLBACK_STAGE_A_SELECTION_MODE,
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

// ─── LLM Stage A review ────────────────────────────────────────────────────────
async function reviewStageASafe({ image45, image50, baseImage, userImage, label }) {
  let lastError;
  for (let attempt = 1; attempt <= DEFAULT_REVIEW_ATTEMPTS; attempt += 1) {
    try {
      return await callVisionJson({
        prompt: STAGE_A_REVIEW_PROMPT,
        images: [
          toDataUrl(image45),
          toDataUrl(image50),
          toDataUrl(baseImage),
          toDataUrl(userImage),
        ],
      });
    } catch (error) {
      lastError = error;
      if (attempt < DEFAULT_REVIEW_ATTEMPTS) {
        const delayMs = Math.min(5000 * attempt, 15000);
        console.error(`[review-retry] ${label} attempt ${attempt}/${DEFAULT_REVIEW_ATTEMPTS}: ${redactSecrets(error.message)}; retry in ${delayMs / 1000}s`);
        await sleep(delayMs);
      }
    }
  }

  console.error(`[review-error] ${label}: LLM 审核失败 (${redactSecrets(lastError.message)}), strict fallback rejects both models`);
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
    score,
    issues: ['Stage A review unavailable; strict fallback rejects both models'],
  };
}

async function callVisionJson({ prompt, images }) {
  const apiKey = process.env.VISION_API_KEY || process.env.SEEDREAM_NATIVE_API_KEY;
  const apiUrl = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const model  = process.env.VISION_MODEL  || DEFAULT_VISION_MODEL;

  if (!apiKey) throw new Error('VISION_API_KEY 或 SEEDREAM_NATIVE_API_KEY 未配置');

  const content = [
    ...images.map((image) => ({ type: 'image_url', image_url: { url: toVisionImageUrl(image) } })),
    { type: 'text', text: prompt },
  ];

  const response = await fetchWithTimeout(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      max_tokens: 2200,
      temperature: 0.2,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Vision API 请求失败: ${JSON.stringify(data)}`);

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Vision API 未返回内容');

  return parseJsonText(text);
}

// ─── Regen note builder ────────────────────────────────────────────────────────
function buildRegenNote(round, review, modelId) {
  const key    = modelId === 'seedream_4_5' ? 'result_4_5' : 'result_5_0';
  const result = review[key] || {};
  const failFields = [
    'face_replaced',
    'body_scale_matches_base',
    'jersey_collar_unchanged',
    'no_big_head',
    'no_halo_or_color_patch',
    'neck_integrated',
    'framing_matches_base',
    'head_pose_matches_base',
    'hairstyle_ok',
  ]
    .filter((f) => result[f] === false)
    .join(', ') || ((result.score ?? 0) < 8 ? 'score below 8' : 'score too low');
  const issues  = (result.issues || []).join('; ') || 'none recorded';
  const score   = result.score ?? '?';

  const corrections = [];
  if (result.face_replaced === false)
    corrections.push('CRITICAL: Ensure the mannequin blank face is FULLY replaced with a real human face — do not leave any smooth featureless area.');
  if (result.body_scale_matches_base === false)
    corrections.push('CRITICAL: The person must appear at the SAME size and camera distance as the mannequin in the base image. Do NOT zoom in or make the person larger. Keep the full locker-room visible at the original scale.');
  if (result.jersey_collar_unchanged === false)
    corrections.push('CRITICAL: Keep the jersey collar area at the neck junction IDENTICAL to the base image. This zone is the compositing seam — any change causes visible artifacts.');
  if (result.no_big_head === false)
    corrections.push('Head size must match the mannequin head size in the base image. Do not enlarge the head.');
  if (result.no_halo_or_color_patch === false)
    corrections.push('CRITICAL: Remove any white glow, pale oval, square patch, or mismatched blue background around hair, face, ears, jaw, and neck.');
  if (result.neck_integrated === false)
    corrections.push('CRITICAL: Generate head and neck as one continuous photographed person from chin through throat to the jersey collar. No floating head or hard neck seam.');
  if (result.framing_matches_base === false)
    corrections.push('Keep the person sitting upright, not tilted or rotated compared to the base image. Preserve the exact front-facing locker-room geometry.');
  if (result.head_pose_matches_base === false)
    corrections.push('CRITICAL: Make the face front-facing like the mannequin. No side profile, no strong three-quarter turn, no rotated or tilted head.');
  if (corrections.length === 0)
    corrections.push('Improve overall quality to 8/10 or higher while keeping the person at the same scale and distance as the base mannequin.');

  return [
    `REGENERATION ATTEMPT ${round}: Previous Stage A result failed quality check.`,
    `  Model: ${modelId}  |  Score: ${score}/10  |  Failed: ${failFields}`,
    `  Issues: ${issues}`,
    `Critical corrections required:`,
    ...corrections.map((c) => `  - ${c}`),
  ].join('\n');
}

async function rewriteStageAPrompt({
  modelId,
  round,
  review,
  currentStage,
  failedImage,
  baseImage,
  userImage,
  outputDir,
  label,
  regenNote,
}) {
  await fs.promises.mkdir(outputDir, { recursive: true });
  const prompt = buildRegenPromptRewritePrompt({
    modelId,
    round,
    review,
    currentStage,
    regenNote,
  });
  await fs.promises.writeFile(path.join(outputDir, 'regen_prompt_rewrite_request.txt'), prompt);

  let lastError;
  for (let attempt = 1; attempt <= DEFAULT_REVIEW_ATTEMPTS; attempt += 1) {
    try {
      const rewrite = normalizeRegenPromptRewrite(await callVisionJson({
        prompt,
        images: [failedImage, baseImage, userImage],
      }));
      await fs.promises.writeFile(
        path.join(outputDir, 'regen_prompt_rewrite.json'),
        `${JSON.stringify({ ...rewrite, local_attempt: attempt }, null, 2)}\n`
      );
      return rewrite;
    } catch (error) {
      lastError = error;
      await fs.promises.writeFile(
        path.join(outputDir, `regen_prompt_rewrite.attempt_${attempt}.error.txt`),
        redactSecrets(error.message)
      ).catch(() => {});
      if (attempt < DEFAULT_REVIEW_ATTEMPTS) {
        const delayMs = Math.min(5000 * attempt, 15000);
        console.error(`[prompt-rewrite-retry] ${label} attempt ${attempt}/${DEFAULT_REVIEW_ATTEMPTS}: ${redactSecrets(error.message)}; retry in ${delayMs / 1000}s`);
        await sleep(delayMs);
      }
    }
  }
  throw new Error(`LLM prompt rewrite failed for ${label}: ${redactSecrets(lastError.message)}`);
}

function buildRegenPromptRewritePrompt({ modelId, round, review, currentStage, regenNote }) {
  const key = modelId === 'seedream_4_5' ? 'result_4_5' : 'result_5_0';
  const modelReview = review?.[key] || {};
  return `You are rewriting a Stage A image-generation prompt as structured JSON.

Images:
Image 1 = the previous failed Stage A result for ${modelId}
Image 2 = the original base image. Preserve this image's exact seated pose, full-frame composition, jersey collar, beer glass, hands, body scale, and locker-room perspective.
Image 3 = the user portrait. Use it for identity only.

The previous result failed this gate:
${regenNote}

Model review JSON for this failed candidate:
${JSON.stringify(modelReview, null, 2)}

Rewrite the prompt so the next generation fixes the failure instead of repeating the same prompt with appended notes.

Hard requirements:
- Produce a complete replacement prompt, not a short patch.
- The result must be a direct fixed-region paste source: same full-body framing, same head center, same head size, same neck width, same jersey collar geometry, same beer glass and hands as Image 2.
- Preserve the white undershirt collar and red FC Bayern collar exactly. A black/dark collar, black undershirt, dark inner collar, shifted collar, missing collar, or changed neckline is an automatic failure.
- Generate the face, jaw, throat, and visible neck as one continuous photographed person into the original white collar.
- Avoid white or pale halo around hair/temples/ears/jaw; hair edges must blend into the blue locker background.
- Do not copy Image 3 clothing, earrings, earphones, necklaces, hoodie collars, black shirts, or indoor lighting.
- Prefer 1:1 fixed-layout generation: keep Image 2's aspect, crop, and pixel-aligned layout so the fixed final region can be pasted back directly.

Current base prompt:
${currentStage.prompt}

Current negative prompt:
${currentStage.negativePrompt || ''}

Return JSON ONLY:
{
  "prompt": "complete replacement generation prompt",
  "negative_prompt": "comma-separated negative prompt",
  "api_params": {
    "size": "${currentStage.apiParams?.size || '1920x2400'}"
  }
}`;
}

function normalizeRegenPromptRewrite(rewrite) {
  if (!rewrite || typeof rewrite.prompt !== 'string' || rewrite.prompt.trim().length < 40) {
    throw new Error('LLM prompt rewrite JSON missing usable prompt');
  }
  const normalized = {
    prompt: rewrite.prompt.trim(),
  };
  if (typeof rewrite.negative_prompt === 'string' && rewrite.negative_prompt.trim()) {
    normalized.negative_prompt = rewrite.negative_prompt.trim();
  }
  if (rewrite.api_params && typeof rewrite.api_params === 'object') {
    const apiParams = {};
    if (typeof rewrite.api_params.size === 'string' && /^\d+x\d+$/.test(rewrite.api_params.size)) {
      apiParams.size = rewrite.api_params.size;
    }
    if (Object.keys(apiParams).length > 0) normalized.api_params = apiParams;
  }
  return normalized;
}

function applyRegenPromptRewrite(stage, rewrite, regenNote) {
  if (!rewrite) {
    return regenNote ? { ...stage, prompt: `${stage.prompt}\n\n${regenNote}` } : stage;
  }
  const promptParts = [
    rewrite.prompt,
    regenNote ? `AUDIT CONTEXT FROM PREVIOUS FAILED RESULT:\n${regenNote}` : '',
  ].filter(Boolean);
  return {
    ...stage,
    prompt: promptParts.join('\n\n'),
    negativePrompt: rewrite.negative_prompt || stage.negativePrompt,
    apiParams: {
      ...stage.apiParams,
      ...(rewrite.api_params || {}),
    },
  };
}

// ─── Stage A regeneration ──────────────────────────────────────────────────────
async function regenerateStageA({ model, scene, prompts, baseImage, userImage, referenceImages, maskImage, outputDir, label, regenNote, promptRewrite }) {
  await fs.promises.mkdir(outputDir, { recursive: true });

  const ext         = model.outputFormat === 'png' ? '.png' : '.jpg';
  const outputPath  = path.join(outputDir, `image${ext}`);
  const responsePath = path.join(outputDir, 'response.json');

  const enhancedBodyAlign = applyRegenPromptRewrite(prompts.bodyAlign, promptRewrite, regenNote);

  // Save regen prompt notes to dedicated file
  if (regenNote) {
    await fs.promises.writeFile(path.join(outputDir, 'regen_prompt_notes.txt'), regenNote);
  }
  if (promptRewrite) {
    await fs.promises.writeFile(
      path.join(outputDir, 'regen_prompt_rewrite_applied.json'),
      `${JSON.stringify(promptRewrite, null, 2)}\n`
    );
  }

  await writePromptFiles(outputDir, enhancedBodyAlign);

  const payload = {
    model: model.model,
    prompt: enhancedBodyAlign.prompt,
    image: [baseImage, userImage, ...referenceImages].map(toDataUrl),
    sequential_image_generation: 'disabled',
    response_format: 'url',
    size: prompts.bodyAlign.apiParams.size,
    stream: false,
    watermark: true,
  };
  if (model.outputFormat)         payload.output_format  = model.outputFormat;
  if (model.includeStrength)      payload.strength       = model.maskStrength; // high strength for mask inpainting
  if (maskImage)                  payload.mask_image     = toDataUrl(maskImage);
  if (model.includeNegativePrompt) payload.negative_prompt = prompts.bodyAlign.negativePrompt;

  console.log(`[regen] ${label}: calling Seedream...`);
  await requestAndSave(payload, outputPath, responsePath, label);
  console.log(`[regen] ${label}: → ${outputPath}`);
  return { image: outputPath };
}

// ─── API request with retry ────────────────────────────────────────────────────
async function requestAndSave(payload, outputPath, responsePath, label = '') {
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
      ).catch(() => {});
      if (attempt < DEFAULT_STAGE_ATTEMPTS) {
        const delayMs = Math.min(15000 * attempt, 60000);
        console.error(
          `[retry] ${label} attempt ${attempt}/${DEFAULT_STAGE_ATTEMPTS}: ${redactSecrets(error.message)}; retry in ${delayMs / 1000}s`
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
  return fetch(url, { ...options, signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS) });
}

// ─── Mask generation ───────────────────────────────────────────────────────────
async function prepareMasks(maskDir, existingMaskDir) {
  const masks = {};
  for (const gender of ['male', 'female']) {
    const maskPath = path.join(maskDir, `mask_${gender}.png`);
    if (fs.existsSync(maskPath)) {
      masks[gender] = maskPath;
      continue;
    }
    const existingMask = path.join(existingMaskDir, `mask_${gender}.png`);
    if (fs.existsSync(existingMask)) {
      await fs.promises.copyFile(existingMask, maskPath);
    } else {
      const sceneId     = gender === 'male' ? 'scene1v3_male' : 'scene1v3_female';
      const sceneConfig = loadSceneConfig(sceneId);
      const sourceImage = path.join(PROJECT_DIR, sceneConfig.base);
      await createMask({ sourceImage, outputImage: maskPath, regions: STAGE_A_MASK_REGIONS[gender] });
    }
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
    width:  Math.round(dims.width  * r.width),
    height: Math.round(dims.height * r.height),
  }));
  const conditions = normalized.map((r) => {
    if (r.shape === 'ellipse') {
      const cx = r.x + r.width  / 2;
      const cy = r.y + r.height / 2;
      const rx = Math.max(1, r.width  / 2);
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

// ─── Prompt building (adapted from run-scene1v3-v3.js) ──────────────────────────
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

  const eyewearInstruction =
    traitsHasNoEyewear(resolvedTraits)
      ? [
          'Eyewear constraint: Image 2 has no glasses. The target person must NOT wear glasses, eyeglasses, spectacles, frames, lenses, or sunglasses.',
          'Remove any glasses from the generated target even if the original base target has glasses.',
        ].join('\n')
      : traitsHasEyewear(resolvedTraits)
        ? `Eyewear constraint: Preserve the glasses from Image 2${eyewearDescription(resolvedTraits)}. Match the user portrait eyewear shape and color; do not invent a different frame style.`
        : 'Eyewear constraint: Follow Image 2 exactly for whether the person wears glasses.';

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
    .replace(/The target should have short black hair and black rectangular glasses\./g,
      'The target should match Image 2 for hair, face shape, facial hair, skin tone, and whether glasses are present.')
    .replace(/The target person must look like the adult Asian male from Image 2:\nshort black hair,\nblack rectangular glasses,\nround broad face,/g,
      'The target person must look like the adult Asian male from Image 2:\nmatching hair from Image 2,\nmatching eyewear state from Image 2,\nmatching face shape from Image 2,')
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
    // Face-neck integration
    'disconnected face, floating head detached from neck, pasted face effect, face not integrated with neck, mismatched skin tone between face and neck',
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
    .replace(/Do not give the target long hair, bangs, or a bob haircut\./g,
      'Keep the hairstyle faithful to Image 2 while adapting it naturally to the locker-room photo.')
    .replace(/Do not use any fixed default face, fixed default glasses, or generic Asian male template\./g,
      'Do not use any fixed default face, fixed default glasses, or generic identity template.');
}

function adaptNegativePromptGender(negativePrompt, gender) {
  if (gender !== 'female') return negativePrompt;
  const removeTerms = new Set([
    'female target', 'young woman', 'feminine body', 'female face',
    'female body', 'bob haircut', 'bangs', 'long hair', 'generic Asian woman',
  ]);
  const femaleNegativeAdditions = [
    'male face', 'male body', 'masculinized face',
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

// ─── Utilities ─────────────────────────────────────────────────────────────────
async function copyReferenceImages(srcJobDir, inputDir) {
  const refs = [];
  for (let idx = 1; idx <= 10; idx += 1) {
    const srcRef  = path.join(srcJobDir, '00_inputs', `reference_${idx}.jpg`);
    if (!fs.existsSync(srcRef)) break;
    const destRef = path.join(inputDir, `reference_${idx}.jpg`);
    if (!fs.existsSync(destRef)) await fs.promises.copyFile(srcRef, destRef);
    refs.push(destRef);
  }
  return refs;
}

async function writePromptFiles(stageDir, stage) {
  await fs.promises.writeFile(path.join(stageDir, 'prompt.txt'),          stage.prompt);
  await fs.promises.writeFile(path.join(stageDir, 'negative_prompt.txt'), stage.negativePrompt);
  await fs.promises.writeFile(
    path.join(stageDir, 'api_params.json'),
    `${JSON.stringify(stage.apiParams, null, 2)}\n`
  );
}

function groupByUser(results) {
  const map = new Map();
  for (const result of results) {
    if (!map.has(result.user)) map.set(result.user, []);
    map.get(result.user).push(result);
  }
  return map;
}

async function resolveFullRunnerTraits(userIds, userEntries, args) {
  const traitsMap = {};
  const missingUsers = [];
  for (const userId of userIds) {
    const entries = userEntries.get(userId);
    const traits = readStageATraits(entries);
    if (traits) {
      traitsMap[userId] = { ...traits, traits_source: 'manifest' };
      continue;
    }
    missingUsers.push({
      id: userId,
      sourcePath: resolveUserImagePathFromEntries(entries),
    });
  }

  if (missingUsers.length > 0) {
    const fallbackTraits = await resolveScene6TraitsForUsers(missingUsers, {
      source: args.traitsSource,
      cacheFile: args.traitsCache,
    });
    for (const user of missingUsers) {
      traitsMap[user.id] = { ...fallbackTraits[user.id], traits_source: args.traitsSource };
    }
  }
  return traitsMap;
}

function readStageATraits(entries) {
  for (const entry of entries || []) {
    if (entry.traits) return validateTraits(entry.traits);
    const traitsPath = entry.user_traits_path || (entry.job_dir
      ? path.join(entry.job_dir, '00_inputs', 'user_traits.json')
      : null);
    if (traitsPath && fs.existsSync(traitsPath)) {
      return validateTraits(JSON.parse(fs.readFileSync(traitsPath, 'utf8')));
    }
  }
  return null;
}

function resolveUserImagePathFromEntries(entries) {
  const entry = (entries || [])[0];
  if (!entry) throw new Error('无法从 Stage A manifest 找到用户图片');
  if (entry.user_image) return entry.user_image;
  if (entry.job_dir) return path.join(entry.job_dir, '00_inputs', 'user.jpg');
  throw new Error(`无法从 Stage A manifest 找到 ${entry.user || 'unknown user'} 的 user image`);
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
  if (buffer.length >= 4 && buffer.toString('ascii', 1, 4) === 'PNG')  return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8)                         return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png')  return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function parseJsonText(text) {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1]);
  const start = trimmed.indexOf('{');
  const end   = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error(`无法解析 Vision JSON: ${trimmed.slice(0, 160)}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPool(items, concurrency, worker) {
  const results  = new Array(items.length);
  let nextIndex  = 0;
  async function runNext() {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await worker(items[i]);
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
    const sep = trimmed.indexOf('=');
    if (sep === -1) continue;
    const key   = trimmed.slice(0, sep).trim();
    const value = trimmed.slice(sep + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

function redactSecrets(text) {
  return String(text).replace(/(ark|sk)-[A-Za-z0-9_-]+/g, '$1-<redacted>');
}

function formatTimestamp(date) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}${v.month}${v.day}_${v.hour}${v.minute}${v.second}`;
}

// ─── Summary & HTML output ────────────────────────────────────────────────────
function renderSummary(summary) {
  const rows = (summary.results || []).map((r) => [
    r.user          || '',
    r.scene         || '',
    r.selected_model || '',
    r.stage_a_regen_rounds > 0 ? `yes (${r.stage_a_regen_rounds})` : 'no',
    `${r.llm_score_4_5 ?? '-'} / ${r.llm_score_5_0 ?? '-'}`,
    r.status        || '',
    r.error         || '',
  ]);
  return [
    `# scene1v3 Full Pipeline Summary`,
    ``,
    `- Created at: ${summary.created_at}`,
    `- Source manifest: ${summary.source_manifest}`,
    ``,
    `| User | Scene | Selected Model | Stage A Regen | LLM Score (4.5/5.0) | Status | Error |`,
    `|---|---|---|---|---|---|---|`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');
}

function escapeCell(v) {
  return String(v ?? '').replace(/\|/g, '\\|');
}

function buildOverviewHtml(summary, outDir) {
  const results  = summary.results || [];
  const userIds  = [...new Set(results.map((r) => r.user))].sort(
    (a, b) => a.localeCompare(b, 'en', { numeric: true })
  );

  const cards = userIds.map((uid) => {
    const result  = results.find((r) => r.user === uid);
    const status  = result?.status || 'unknown';
    const model   = result?.selected_model || '?';
    const regen   = result?.stage_a_regen_rounds > 0 ? ` (regen×${result.stage_a_regen_rounds})` : '';
    const score45 = result?.llm_score_4_5 ?? '-';
    const score50 = result?.llm_score_5_0 ?? '-';
    const winner  = result?.llm_winner || '?';

    const refPath = path.join(outDir, 'images', `_ref_${uid}.jpg`);
    const refHtml = fs.existsSync(refPath) ? `<img class="ref" src="images/_ref_${uid}.jpg" title="reference">` : '';

    // Support single or dual finals
    let finalHtml = '';
    if (result?.both_finals) {
      const p45 = path.join(outDir, 'images', `${uid}_seedream_4_5.jpg`);
      const p50 = path.join(outDir, 'images', `${uid}_seedream_5_0.jpg`);
      finalHtml += fs.existsSync(p45) ? `<figure><figcaption>Final 4.5${regen}</figcaption><img src="images/${uid}_seedream_4_5.jpg"></figure>` : '';
      finalHtml += fs.existsSync(p50) ? `<figure><figcaption>Final 5.0${regen}</figcaption><img src="images/${uid}_seedream_5_0.jpg"></figure>` : '';
    } else {
      const singlePath = path.join(outDir, 'images', `${uid}.jpg`);
      finalHtml = fs.existsSync(singlePath)
        ? `<figure><figcaption>Final (${model}${regen})</figcaption><img src="images/${uid}.jpg"></figure>`
        : `<p class="err">no output</p>`;
    }

    return `<section class="card ${status !== 'completed' ? 'failed' : ''}">
<h2>${uid}${refHtml}<span class="meta">4.5:${score45} / 5.0:${score50} | winner:${winner}</span></h2>
<div class="row">${finalHtml}</div></section>`;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>scene1v3 Full Pipeline — ${summary.created_at.slice(0, 10)}</title>
<style>
body{margin:0;background:#1a1a2e;color:#eee;font:13px/1.4 system-ui,sans-serif}
h1{text-align:center;padding:16px 0 4px;font-size:18px;color:#a0c4ff}
p.meta{text-align:center;color:#64748b;margin:0 0 10px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;padding:12px}
.card{background:#16213e;border:1px solid #0f3460;border-radius:8px;padding:10px}
.card.failed{border-color:#7f1d1d;background:#1c0a0a}
.card h2{margin:0 0 8px;font-size:13px;color:#e2e8f0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.meta{font-size:10px;color:#64748b;margin-left:auto}
.ref{width:40px;height:50px;object-fit:cover;border-radius:4px;border:1px solid #334}
.row{display:flex;gap:8px}
.row figure{margin:0;flex:1}
.row figcaption{font-size:11px;text-align:center;color:#94a3b8;margin-bottom:3px}
.row img{width:100%;display:block;border-radius:5px;background:#0f3460}
.err{color:#f87171;margin:8px 0;font-size:12px}
</style>
</head>
<body>
<h1>scene1v3 — Full Pipeline (Stage A Review → Clean-background Composite)</h1>
<p class="meta">Generated: ${summary.created_at.slice(0, 19).replace('T', ' ')} CST</p>
<div class="grid">${cards}</div>
</body>
</html>`;
}

// ─── Arg parsing ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    env:         DEFAULT_ENV,
    manifest:    null,
    concurrency: DEFAULT_CONCURRENCY,
    users:       null,
    outDir:      null,
    reviewNotes: null,
    traitsSource: 'cache',
    traitsCache: DEFAULT_TRAITS_CACHE,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env')         { args.env         = path.resolve(argv[++i]); }
    else if (arg === '--manifest')    { args.manifest    = path.resolve(argv[++i]); }
    else if (arg === '--concurrency') { args.concurrency = Number(argv[++i]); }
    else if (arg === '--users')       { args.users       = parseCsv(argv[++i]); }
    else if (arg === '--out-dir')     { args.outDir      = path.resolve(argv[++i]); }
    else if (arg === '--review-notes') { args.reviewNotes = path.resolve(argv[++i]); }
    else if (arg === '--traits-source') {
      args.traitsSource = argv[++i];
      if (!['cache', 'llm'].includes(args.traitsSource)) throw new Error('--traits-source 必须是 cache 或 llm');
    }
    else if (arg === '--traits-cache') { args.traitsCache = path.resolve(argv[++i]); }
    else if (arg === '--no-cache') { args.traitsSource = 'llm'; }
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else { throw new Error(`未知参数: ${arg}`); }
  }
  if (!args.manifest) throw new Error('必须指定 --manifest <path/to/manifest.json>');
  return args;
}

function parseCsv(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function loadReviewNotes(notesPath) {
  if (!notesPath) return {};
  const parsed = JSON.parse(fs.readFileSync(notesPath, 'utf8'));
  const notes = {};
  for (const [userId, value] of Object.entries(parsed)) {
    notes[userId] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return notes;
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-scene1v3-v3-full.js \\
    --manifest result/scene1v3_stagea_TIMESTAMP/manifest.json \\
    [--env path/.env] [--concurrency 4] [--users user1,user2] [--out-dir path] [--review-notes path.json]
    [--traits-source cache|llm] [--traits-cache user/traits.json]

从已有的 Stage A 批量结果出发，审核 Stage A 质量后按固定场景区域直接回贴，得到最终图。

  --manifest   (必填) Stage A manifest.json 路径
  --env        .env 文件路径 (default: server/.env)
  --concurrency 并发数 (default: ${DEFAULT_CONCURRENCY})
  --users      仅处理指定用户 (逗号分隔，默认全部)
  --out-dir    输出目录 (默认自动生成时间戳目录)
  --review-notes 可选，人审问题 JSON。仅用于初始轮次触发 regen，格式: {"user6":["头发左上角白色"]}
  --traits-source traits 来源。默认 cache；生产上传传 llm。若 Stage A manifest 已包含 traits，则优先使用 manifest。
  --traits-cache 测试缓存文件路径 (default: user/traits.json)
`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(redactSecrets(error.message));
    process.exit(1);
  });
}

module.exports = {
  applyRegenPromptRewrite,
  applyHumanReviewNotes,
  applyStageGuardFindings,
  buildFallbackStageCandidate,
  buildStageCandidates,
  buildStageSelectionOrder,
  passesStageVisualQuality,
  generateFinalComposite,
  buildCleanFinalRegions,
  customizeStageForUser,
  detectDarkInnerCollarFromRgb,
  restoreMaskedProtectedRegionsFromRgb,
};
