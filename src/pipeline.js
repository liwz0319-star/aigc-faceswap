const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const TARGET_PERSON = 'second person from the right';
const DEFAULT_TARGET_DETAIL = 'the shorter female-presenting person standing between the center-right male and the rightmost male';
const DEFAULT_PROTECTED_PERSON = 'the rightmost person';
const DEFAULT_MODEL = 'doubao-seedream-4-5-251128';
const DEFAULT_VISION_MODEL = 'doubao-seed-2-0-pro';
const DEFAULT_SIZE = '1920x2400';
const execFileAsync = promisify(execFile);
const DEFAULT_LOGO_PROTECTION_REGIONS = [
  { id: 'upper_left_paulaner_text', x: 0.05, y: 0.225, width: 0.15, height: 0.07 },
  { id: 'upper_left_bayern_text', x: 0.225, y: 0.225, width: 0.145, height: 0.07 },
  { id: 'upper_right_paulaner_text', x: 0.675, y: 0.225, width: 0.145, height: 0.07 },
  { id: 'upper_right_bayern_text', x: 0.83, y: 0.225, width: 0.15, height: 0.07 },
];
const TACIT_REALISM_RULES = `TACIT GROUP-PHOTO REALISM CONTRACT:
Treat Image 1 as the only source of the target person's body, outfit, pose, hand geometry, beer mug, camera distance, lens perspective, and outdoor lighting.
Treat Image 2 as identity reference only: face structure, hair, skin tone, eyewear state, and age/gender presentation. Image 2 clothing, indoor lighting, selfie scale, shoulder width, body shape, and background are non-identity information and must not transfer.
The edited target must pass a human photographer's tacit judgment: at first glance the person should feel originally present in the group, with no visual clue that the face, body, clothes, or lighting came from a separate photo.
Use holistic recognition, not checklist maximization. Preserve the user's identity through the overall face impression while adapting every visible cue to the base photo's scale, light, blur, grain, expression, neck support, and social context.
If an explicit identity detail conflicts with whole-photo plausibility, prefer the tacit whole-photo judgment: the result should feel right before it can be fully explained.`;

const TACIT_IDENTITY_INTEGRATION_RULES = `TACIT IDENTITY INTEGRATION:
The result must look like the user was actually standing in Image 1 while beer was poured over them, not a pasted head or a pasted selfie face.
Do not transplant a clean, dry, front-facing portrait. Reconstruct the user's identity under Image 1's stadium light, wet hair, foam, beer streaks, facial softness, lens distance, and body scale.
Identity should be recognized by the whole face impression, not by copying every selfie feature sharply. If a sharp identity detail makes the person look edited, soften it into the scene.
Because Image 1 is a beer-shower moment, do not render a clean dry studio face. Keep wet hair, damp skin, foam on the hairline, and beer droplets on the cheeks, neck, and jersey.
Do not bury the user's whole face behind an opaque beer curtain. The eyes, nose, mouth, face shape, and natural expression should remain readable through sparse droplets and foam.
Beer and foam must feel physically present on the user, but it should be a believable splash pattern generated with the scene, not a flat pasted liquid layer over the face.
The jaw, neck, collar, shoulders, hands, and torso must read as one continuous photographed person in the same moment.`;

const TACIT_STADIUM_IDENTITY_RULES = `TACIT STADIUM IDENTITY INTEGRATION:
The result must look like the user was originally standing in Image 1 as a rear-row teammate, not like a pasted selfie face.
Do not transplant a clean, dry, front-facing portrait. Reconstruct the user's identity under Image 1's stadium light, facial softness, lens distance, and rear-row body scale.
Identity should be recognized by the whole face impression, not by copying every selfie feature sharply. If a sharp identity detail makes the person look edited, soften it into the scene.
Keep the face readable and naturally lit, with the same camera distance, blur, grain, and mild stadium highlights as the original rear-row player.
Do not add direct beer-bath effects to this rear target. Keep foreground beer, foam, spray, and wetness attached to the protected front-center player.
The jaw, neck, collar, shoulders, visible arm edge, and torso must read as one continuous photographed person in the same rear-row position.`;

const TACIT_LOCKER_ROOM_IDENTITY_RULES = `TACIT LOCKER-ROOM IDENTITY INTEGRATION:
The result must look like the user was originally seated in the Paulaner locker-room photo, not like a pasted selfie face on a mannequin body.
Replace the blank mannequin head with a real human head, face, hair, eyewear state, skin tone, and minimal neck transition from Image 2.
Do not keep the mannequin's faceless smooth mask, bald plastic head, wax texture, or featureless face.
Do not create a beer-shower, stadium celebration, wet hair, foam, spray, or liquid curtain. This is a clean seated locker-room portrait.
Identity should be recognized by the whole face impression while matching Image 1's locker-room lighting, lens distance, blur, grain, head scale, neck support, and seated body posture.
The jaw, neck, collar, shoulders, hands, Paulaner beer glass, jersey, shorts, and seated legs must read as one continuous photographed person in the same room.`;

const BEER_SHOWER_ACCEPTANCE_RULES = `NATURAL BEER-SHOWER ACCEPTANCE:
The target is willingly receiving a celebratory beer shower in the stadium. Their posture stays steady and relaxed, with a natural calm or slight squinting expression, not a passport-photo stare and not a shocked grimace.
Hair should look wet and compressed by beer, with a small foam cap and scattered droplets. Skin should be damp with stadium highlights, not dry, waxy, or pasted.
Keep the face visible enough for identity, but let small foam flecks and translucent beer streaks cross the forehead, hairline, cheeks, neck, collar, and upper chest.
Avoid both extremes: no clean floating face, and no full-face opaque beer mask. The tacit target is the earlier natural event-photo feeling where the user accepts the beer bath and belongs to the scene.`;

const NATURAL_BEER_REFERENCE_RULES = `NATURAL BEER REFERENCE IMAGE:
If an extra reference image is provided after Image 2, use it only as a tacit visual exemplar for beer-shower density, wet-hair behavior, relaxed acceptance, and event-photo realism.
Do not copy the reference image person's identity, facial features, gender, hairstyle, body, outfit changes, background crop, or exact layout. The only identity source is Image 2.
The reference image should steer the beer bath away from a pasted dry face and away from an opaque full-face foam curtain.`;

const WARDROBE_LOCK_RULE = `WARDROBE LOCK:
Copy the target person's Bavarian outfit from Image 1, including gray jacket, white shirt/collar, buttons, lederhosen, socks, shoes, beer mug, and hands.
Do not import, hallucinate, or blend any Image 2 clothing: no hoodie, fleece, black T-shirt, zipper jacket, casual coat, scarf, or indoor portrait garment.
The Image 1 collar, lapels, sleeve cuffs, waistline, mug handle, and hand contact points must remain visually continuous.`;

const JERSEY_SCENE_LOCK_RULE = `JERSEY SCENE LOCK:
Preserve the exact red-and-white FC Bayern jersey, shorts, socks, Adidas stripes, sponsor T, club crests, hands, arm position, stance, and body scale from Image 1.
Preserve the celebratory beer-shower context, but regenerate the beer and foam as a natural splash pattern around the user instead of copying the original opaque liquid curtain exactly.
Do not expose skin under the jersey, do not crop the torso, do not create a fashion top, and do not transfer Image 2 clothing, indoor lighting, selfie body shape, or close-up proportions.
Only adapt identity-bearing face, hair, eyewear state, skin tone, and the smallest necessary neck and hair transition so the user looks naturally present in the original stadium photo.`;

const BACKGROUND_REAR_PLAYER_LOCK_RULE = `BACKGROUND REAR PLAYER LOCK:
The target is the rear-row red-and-white FC Bayern player between the foreground beer-shower player and the right goalkeeper, not the foreground front-center beer-shower subject.
The foreground beer shower belongs to the protected front-center player. Keep the beer stream, foam curtain, front player's wet hair, left player's Paulaner glass, and all foreground arms unchanged.
Keep the rear target's head center, shoulder width, jersey collar, chest crest, visible right arm edge, torso height, and background stadium perspective from Image 1.
Do not move the rear target left, right, upward, forward, or into a larger front-row scale. Do not replace or beautify the foreground beer-shower player.
Replace only the rear target's identity-bearing face, hair, eyewear state, skin tone, neck transition, and minimal upper-body proportion cues needed for a natural match.`;

const LOCKER_ROOM_MANNEQUIN_LOCK_RULE = `LOCKER-ROOM MANNEQUIN LOCK:
The target is the seated faceless mannequin in the center locker-room bay, not the hanging jerseys or locker background.
Preserve the exact seated body pose, red-and-white FC Bayern jersey, shorts, socks, black shoes, shoulder line, arm angle, hands, Paulaner beer glass, bench, floor, blue locker walls, hanging jerseys, and Paulaner logos from Image 1.
Preserve the target head center, head size, neck width, collar contact, and seated camera distance from Image 1; do not move the head upward, sideways, forward, or into a larger close-up scale.
Replace only the blank mannequin head with the user's identity-bearing face, hair, eyewear state, skin tone, and the smallest necessary neck transition.
The Paulaner beer glass and hands must remain locked from Image 1 and must not be regenerated as a different cup, label, grip, or position.`;

const TACIT_LOCKER_ROOM_FACESWAP_IDENTITY_RULES = `TACIT LOCKER-ROOM FACESWAP IDENTITY INTEGRATION:
The result must look like the user was originally seated in the Paulaner locker-room photo, not like a pasted selfie face on the existing person's body.
Replace the existing person's face with the user's face, hair, eyewear state, skin tone, and minimal neck transition from Image 2.
Preserve the overall head size, head position, neck width, seated posture, and locker-room lighting from Image 1.
Do not create a beer-shower, stadium celebration, wet hair, foam, spray, or liquid curtain. This is a clean seated locker-room portrait.
Identity should be recognized by the whole face impression while matching Image 1's locker-room lighting, lens distance, blur, grain, head scale, neck support, and seated body posture.
The jaw, neck, collar, shoulders, hands, Paulaner beer glass, jersey, shorts, and seated legs must read as one continuous photographed person in the same room.`;

const LOCKER_ROOM_FACESWAP_LOCK_RULE = `LOCKER-ROOM FACESWAP LOCK:
The target is the seated person in the center locker-room bay, not the hanging jerseys or locker background.
Preserve the exact seated body pose, red-and-white FC Bayern jersey, shorts, socks, black shoes, shoulder line, arm angle, hands, Paulaner beer glass, bench, floor, blue locker walls, hanging jerseys, and Paulaner logos from Image 1.
Preserve the target head center, head size, neck width, collar contact, and seated camera distance from Image 1; do not move the head upward, sideways, forward, or into a larger close-up scale.
Replace only the existing face with the user's identity-bearing face, hair, eyewear state, skin tone, and the smallest necessary neck transition.
The Paulaner beer glass and hands must remain locked from Image 1 and must not be regenerated as a different cup, label, grip, or position.`;

const BODY_ANCHOR_RULE = `BODY ANCHOR AND SCALE:
Preserve the target's full-body height, foot position, shoulder line, hip line, knee line, arm angle, hand size, and beer-mug coordinates from Image 1.
Preserve the target head center, head size, neck width, and shoulder support from Image 1; do not move the head upward, sideways, forward, or into a larger close-up scale.
Only adapt the identity-bearing head/face/hair area and the smallest necessary neck transition.
Match neighboring heads and the original target for scale, blur, grain, lens perspective, and camera distance. The face must be integrated into the neck and collar, not pasted above them.`;

const FRAMING_LOCK_RULE = `FRAMING LOCK:
Preserve the exact Image 1 camera crop, field of view, four-person layout, and camera distance.
All four people must remain visible in the same positions and scale as Image 1.
Do not zoom in, do not make a close-up, do not crop off the target's head, torso, jersey, shorts, hands, or nearby people.
The target must not move toward the camera; target head and jersey scale must match the original target and nearby players.`;

function buildBaseAnalysisPrompt(targetPerson, targetDetail) {
  return `Analyze the base image.
Return structured JSON only.
Identify all visible people from left to right and right to left.
The target is the ${targetPerson}.
Target detail: ${targetDetail}.
Describe the target person's current body, pose, clothing, hair, gender presentation, hand position, beer mug position, and surrounding people.
Do not generate an image.`;
}

const USER_ANALYSIS_PROMPT = `Analyze the user portrait.
Return structured JSON only.
Describe identity-relevant physical features for face replacement.
Include gender presentation, age range, ethnicity, hair, face shape, glasses, skin tone, facial hair, and body/head proportion hints.
Explicitly separate identity traits from non-identity traits.
Mark clothing, body pose, body size, camera distance, lighting, and background as non_identity_do_not_transfer.
Do not describe clothing or background except to flag them as forbidden for transfer.`;

function buildQualityCheckPrompt(targetPerson, targetDetail, protectedPerson) {
  return `Compare the generated image with the base image and user portrait.
Return structured JSON only.
Evaluate whether the generated image successfully replaced only the ${targetPerson} with the adult Asian male from the user portrait.
Target detail: ${targetDetail}.
Do NOT treat ${protectedPerson} as the target.
Check person count, target location, adult male appearance, user-matching hair, user-matching eyewear status, natural head-body proportion, preserved clothing, preserved beer mug, preserved hands, unchanged other three people, unchanged protected people, and unchanged background.
Also check wardrobe_lock_from_base, no_reference_clothing_transfer, target_body_anchor_preserved, target_height_matches_base, face_scale_not_larger_than_neighbors, face_integrated_with_neck_and_lighting, and tacit_group_photo_realism.
Eyewear rule: if Image 2 has no eyeglasses, the generated target must not have eyeglasses; if Image 2 clearly has eyeglasses, preserve matching eyeglasses.
Also evaluate photographic naturalness with these exact boolean fields: looks_originally_photographed, no_pasted_selfie_feel, head_scale_matches_neighbors, neck_shoulders_support_head, identity_not_overfit_to_selfie, and subtle_flattering_event_photo_filter.
The target should be recognizable as Image 2 but with a slightly smaller, scene-matched head scale and a natural light beauty-retouched event-photo look.
Reject the result if the target looks like a pasted selfie face, a wax/plastic figure, a bobblehead, heavy beauty-app retouching, or a person whose face, neck, shoulders, lighting, camera distance, or expression do not belong naturally in the group photo, even when identity similarity is high.
Check all Paulaner and FC Bayern logos/signs remain identical to the base image, including lettering, crests, colors, and circular shapes.
For strict brand scenes, return these exact boolean fields and set passed=false if any is not true:
paulaner_logo_exact, bayern_logo_exact, jersey_logo_exact, player_proportion_ok.`;
}

async function createRunContext({ rootDir, now = new Date(), targetPerson = TARGET_PERSON } = {}) {
  const baseDir = rootDir || path.resolve(__dirname, '..', 'runs');
  const baseRunId = formatRunId(now);
  let runId = baseRunId;
  let runDir = path.join(baseDir, runId);
  let suffix = 2;
  while (fs.existsSync(runDir)) {
    runId = `${baseRunId}_${suffix}`;
    runDir = path.join(baseDir, runId);
    suffix += 1;
  }

  for (const dir of [
    '00_inputs',
    '01_analysis',
    '02_stage_a_body_align',
    '03_stage_b_faceswap',
    '04_quality_check',
    '05_retries',
    'final',
  ]) {
    await fs.promises.mkdir(path.join(runDir, dir), { recursive: true });
  }

  const context = {
    runId,
    runDir,
    createdAt: now.toISOString(),
    mode: 'faceswap_demo',
    targetPerson,
  };

  await writeJson(path.join(runDir, 'run.json'), {
    run_id: runId,
    created_at: context.createdAt,
    mode: context.mode,
    target_person: targetPerson,
  });
  await appendLog(context, `Run initialized: ${runId}`);

  return context;
}

async function archiveInputs(context, { basePath, userPath, referencePaths = [] }) {
  const baseLocal = path.join(context.runDir, '00_inputs/base.jpg');
  const userLocal = path.join(context.runDir, '00_inputs/user.jpg');

  await fs.promises.copyFile(basePath, baseLocal);
  await fs.promises.copyFile(userPath, userLocal);

  const manifest = {
    base_image: await buildImageManifest(basePath, '00_inputs/base.jpg', baseLocal),
    user_image: await buildImageManifest(userPath, '00_inputs/user.jpg', userLocal),
    reference_images: [],
  };
  for (let index = 0; index < referencePaths.length; index += 1) {
    const referencePath = referencePaths[index];
    const ext = path.extname(referencePath) || '.jpg';
    const localName = `reference_${index + 1}${ext}`;
    const localPath = path.join(context.runDir, '00_inputs', localName);
    await fs.promises.copyFile(referencePath, localPath);
    manifest.reference_images.push(await buildImageManifest(referencePath, `00_inputs/${localName}`, localPath));
  }

  await writeJson(path.join(context.runDir, '00_inputs/input_manifest.json'), manifest);
  await appendLog(context, 'Inputs archived');
  return manifest;
}

function buildStagePrompts(options = {}) {
  const targetPerson = options.targetPerson || TARGET_PERSON;
  const targetDetail = options.targetDetail || DEFAULT_TARGET_DETAIL;
  const protectedPerson = options.protectedPerson || DEFAULT_PROTECTED_PERSON;
  const referenceImageCount = options.referenceImageCount || 0;
  const isBayernJerseyScene = /FC Bayern jersey|Bayern jersey|red FC Bayern|red-and-white FC Bayern/i.test(targetDetail);
  const isLockerRoomFaceSwapTarget = isBayernJerseyScene
    && /locker-faceswap-target/i.test(targetDetail);
  const isLockerRoomMannequinTarget = isBayernJerseyScene
    && !isLockerRoomFaceSwapTarget
    && /locker|locker-room|dressing room|changing room|mannequin|faceless|seated/i.test(`${targetPerson} ${targetDetail}`);
  const isRearBayernTarget = isBayernJerseyScene
    && !isLockerRoomMannequinTarget
    && !isLockerRoomFaceSwapTarget
    && /rear middle|rear-row|behind the foreground|background stadium perspective/i.test(targetDetail);
  const isDirectBeerShowerTarget = isBayernJerseyScene && !isRearBayernTarget && !isLockerRoomMannequinTarget && !isLockerRoomFaceSwapTarget;
  const wardrobeLockRule = isRearBayernTarget
    ? BACKGROUND_REAR_PLAYER_LOCK_RULE
    : isLockerRoomMannequinTarget ? LOCKER_ROOM_MANNEQUIN_LOCK_RULE
    : isLockerRoomFaceSwapTarget ? LOCKER_ROOM_FACESWAP_LOCK_RULE
    : isBayernJerseyScene ? JERSEY_SCENE_LOCK_RULE : WARDROBE_LOCK_RULE;
  const framingLockRule = `\n\n${FRAMING_LOCK_RULE}`;
  const identityIntegrationRules = isRearBayernTarget
    ? TACIT_STADIUM_IDENTITY_RULES
    : isLockerRoomMannequinTarget ? TACIT_LOCKER_ROOM_IDENTITY_RULES
    : isLockerRoomFaceSwapTarget ? TACIT_LOCKER_ROOM_FACESWAP_IDENTITY_RULES
    : TACIT_IDENTITY_INTEGRATION_RULES;
  const beerShowerGuidance = isDirectBeerShowerTarget ? `\n\n${BEER_SHOWER_ACCEPTANCE_RULES}` : '';
  const referenceGuidance = referenceImageCount > 0 && isDirectBeerShowerTarget ? `\n\n${NATURAL_BEER_REFERENCE_RULES}` : '';
  const scenePromptGuidance = `\n\n${TACIT_REALISM_RULES}\n\n${identityIntegrationRules}${beerShowerGuidance}${referenceGuidance}\n\n${wardrobeLockRule}\n\n${BODY_ANCHOR_RULE}${framingLockRule}`;
  const bodyOutfitDescription = isRearBayernTarget
    ? 'red-and-white FC Bayern kit, rear-row standing pose, visible right arm edge, and upper-body scale'
    : (isLockerRoomMannequinTarget || isLockerRoomFaceSwapTarget)
    ? 'red-and-white FC Bayern kit, seated locker-room pose, Paulaner beer glass, hands, and full-body scale'
    : isBayernJerseyScene
    ? 'red-and-white FC Bayern kit, natural beer splash context, hands, and full-body stance'
    : 'Bavarian outfit';
  const faceswapOutfitDescription = isRearBayernTarget
    ? 'red-and-white FC Bayern kit, rear-row stance, and visible right arm edge'
    : (isLockerRoomMannequinTarget || isLockerRoomFaceSwapTarget)
    ? 'red-and-white FC Bayern kit, seated locker-room pose, Paulaner beer glass, and hands'
    : isBayernJerseyScene
    ? 'red-and-white FC Bayern kit'
    : 'Bavarian outfit style';
  const bodyKeepContext = isRearBayernTarget
    ? 'Keep the same rear-row location, standing pose, head center, shoulder width, jersey collar, visible right arm edge, background, lighting, camera angle, and four-person composition. Keep the foreground Paulaner glass, beer splash, hand positions, and front-center beer-shower player unchanged.'
    : (isLockerRoomMannequinTarget || isLockerRoomFaceSwapTarget)
    ? 'Keep the same seated locker-room location, body pose, head center, head size, neck width, jersey collar, Paulaner beer glass, hand positions, hanging jerseys, locker walls, bench, floor, lighting, camera angle, and full-frame composition.'
    : `Keep the same location, standing pose, ${bodyOutfitDescription}, beer mug, hand position, background, lighting, camera angle, and four-person composition.`;
  const faceCollarContext = isRearBayernTarget
    ? 'jersey collar, neck, shoulders, rear-row stadium lighting, and visible arm edge'
    : (isLockerRoomMannequinTarget || isLockerRoomFaceSwapTarget)
    ? 'jersey collar, natural neck, locker-room lighting, and seated body scale'
    : 'jersey collar, wet hair, and beer-shower context';
  const finalKeepContext = isRearBayernTarget
    ? 'Keep the target person in the same rear-row standing position, pose, red-and-white FC Bayern kit, visible right arm edge, lighting, and camera angle from Image 1. Keep the foreground beer shower, Paulaner glass, hands, and front-center player unchanged.'
    : (isLockerRoomMannequinTarget || isLockerRoomFaceSwapTarget)
    ? 'Keep the target person in the same seated locker-room position, pose, red-and-white FC Bayern kit, Paulaner beer glass, hands, lighting, and camera angle from Image 1.'
    : `Keep the target person's standing position, pose, ${faceswapOutfitDescription}, beer mug, hands, lighting, and camera angle from Image 1.`;
  const bodyAlignPrompt = `Use Image 1 as the base photo.
Edit ONLY the ${targetPerson}.
The target is ${targetDetail}.
Do NOT edit ${protectedPerson}.
${bodyKeepContext}${scenePromptGuidance}

Transform the target person into a natural adult Asian male body match for the identity in Image 2.
Subtly adjust only the target person's head, neck, shoulders, and upper torso proportions so the body reads as an adult male and the head-body ratio is anatomically consistent.
Use Image 2 only for identity guidance, not for selfie scale, head size, camera distance, or lighting.
The target should inherit the visible hair style, facial hair, face shape, and eyewear status from Image 2.
Do not add eyeglasses if Image 2 does not clearly show eyeglasses.
Do not copy the indoor background or clothing from Image 2.
Keep the same full-body framing and original head size relative to the jersey; do not zoom in or crop the target.
Make the head slightly smaller and more proportional than a selfie portrait, matching the original target body and nearby players.
Keep believable neck width, shoulder support, jersey collar fit, and natural stadium-photo contact with the jersey.

Do not change the other three people.
Do not add or remove people.
Do not change logos, signs, beer mugs, clothing style, hands, or background.`;

  const lockerRoomNegativeAdditions = isLockerRoomMannequinTarget
    ? 'beer shower, wet hair, foam, spray, liquid curtain, stadium background, standing pose, changed locker room, changed hanging jerseys, changed Paulaner glass, changed hands, blank mannequin face, faceless mannequin, bald plastic head, wax mannequin head'
    : isLockerRoomFaceSwapTarget
    ? 'beer shower, wet hair, foam, spray, liquid curtain, stadium background, standing pose, changed locker room, changed hanging jerseys, changed Paulaner glass, changed hands'
    : '';
  const bodyAlignNegative = isBayernJerseyScene
    ? ['female target, childlike body, young woman, feminine body, mismatched head and body, oversized head, big head, selfie head scale, portrait head on body, pasted face, head too large for shoulders, narrow weak neck, mismatched neck, tiny head, zoomed-in target, cropped upper body, wrong person replaced, extra people, missing people, changed background, changed outfit, changed beer mug, eyeglasses added when absent from Image 2, missing eyeglasses when present in Image 2, distorted hands, blurry face, cartoon, illustration', lockerRoomNegativeAdditions].filter(Boolean).join(', ')
    : 'female target, childlike body, young woman, feminine body, mismatched head and body, oversized head, big head, selfie head scale, portrait head on body, pasted face, head too large for shoulders, narrow weak neck, mismatched neck, tiny head, zoomed-in target, cropped upper body, wrong person replaced, extra people, missing people, changed background, changed outfit, changed clothing, copied Image 2 clothing, hoodie, fleece jacket, black T-shirt, zipper jacket, casual coat, changed beer mug, changed hands, changed hand size, shifted beer mug, eyeglasses added when absent from Image 2, missing eyeglasses when present in Image 2, distorted hands, blurry face, cartoon, illustration';

  const faceswapPrompt = `Use Image 1 as the base photo.
Use Image 2 as the target identity reference.
Replace ONLY the target person's identity: the ${targetPerson}.
The target is ${targetDetail}.
Do NOT replace ${protectedPerson}.${scenePromptGuidance}

The replacement should read as the whole target person becoming the adult Asian male from Image 2, not as a pasted face on the original body.
Adjust the target person's head, face, hair, glasses, neck, shoulders, and upper torso proportions as needed for a natural adult male body match.
The goal is not a literal face paste. The target person should appear as if the adult Asian male from Image 2 was physically present in the original group photo.

Use the user reference only for identity, not for selfie scale, head size, camera distance, or lighting.
The fan must remain recognizable as the same person, but naturally adapted into the base photo.
Use Image 2 for identity likeness: hairline, face shape, eyes, nose, mouth, skin tone, facial hair, and eyewear status. However, adapt these traits to Image 1's camera distance, lens perspective, body scale, outdoor lighting, and group-photo realism.
Use Image 2 as identity guidance, but adapt the face to the base photo's camera distance, focal length, angle, and body scale. Keep recognizable identity traits without copying selfie perspective, selfie head size, indoor lighting, or close-up facial proportions.
Eyewear must match Image 2 exactly: do not add glasses if Image 2 has no glasses; if Image 2 clearly has glasses, preserve matching glasses.

HEAD AND BODY PROPORTION RULE:
The fan's head must be slightly smaller and more proportional than a selfie portrait.
Match the head size of the original target body and nearby players.
Do not enlarge the head to preserve facial details.
Keep a natural adult head-to-shoulder ratio, with believable neck width and shoulder support.
The face should sit naturally inside the ${faceCollarContext}.

BEAUTY-RETOUCHED REALISM RULE:
Apply a subtle flattering event-photo beauty filter.
Make the user look slightly better than the reference photo: cleaner skin, healthier complexion, gentle facial symmetry, relaxed expression, neat hair, natural bright eyes.
Keep real skin texture and normal stadium-photo softness.
Do not over-smooth, do not make plastic skin, do not create a beauty-app face, do not change the person into someone else.

${finalKeepContext}
Keep the head size, neck width, shoulder width, and upper torso proportions natural and consistent with an adult male.
The target should look like a real person who was originally photographed in this group photo, not like a selfie face pasted onto a body. Preserve photographic plausibility: natural head scale, neck thickness, shoulder support, jaw-to-neck transition, relaxed facial muscles, matching camera distance, lens perspective, lighting direction, skin texture, and grain.
Photographic naturalness has priority over overfitting the selfie. The head must be slightly smaller than selfie scale and match the surrounding people's visual scale, naturally supported by the neck and shoulders. The jaw, neck, collar, shoulders, and torso must read as one continuous adult male body. Facial expression should be relaxed and socially consistent with the group photo.
Before rendering, judge the whole target person as a photographer would: the head must feel supported by the neck and shoulders, the face must belong to this body, the expression must match the group mood, and the person must not draw attention as edited.
Preserve the full-body framing from Image 1; do not enlarge the head, do not zoom in, and do not crop the upper body.
Do not copy Image 2's selfie framing, close-up head size, indoor lighting, clothing, background, or phone-camera distortion.
Do not feminize the target.
Do not give the target long hair, bangs, or a bob haircut.

Do not change the other three people.
Do not change ${protectedPerson}.
Do not change the background, logos, signs, beer mugs, or clothing.`;

  const faceswapNegative = isBayernJerseyScene
    ? ['rightmost person changed, wrong target, face pasted onto original body, pasted selfie face, face cutout, artificial face blend, full-face opaque beer mask, thick liquid curtain covering the face, face buried under foam, unreadable face, dry clean studio face, female face, female body, bob haircut, bangs, long hair, child face, anime face, generic Asian woman, mismatched head-body proportion, oversized head, big head, selfie head scale, portrait head on body, bobblehead, oversized cranium, swollen head, head too large for shoulders, face larger than nearby players, tiny neck, narrow weak neck, weak neck support, mismatched neck, unnatural jaw-neck transition, zoomed-in target, cropped upper body, selfie perspective, phone-camera face distortion, mismatched facial lighting, overly sharp face, waxy skin, wax figure, plastic skin, heavy beauty filter, over-smoothed skin, fake influencer face, unnatural facial symmetry, changed identity, unrecognizable person, changed other people, extra people, missing people, eyeglasses added when absent from Image 2, missing eyeglasses when present in Image 2, distorted glasses, changed hands, changed beer mug, changed background, blurry, low quality', lockerRoomNegativeAdditions].filter(Boolean).join(', ')
    : 'rightmost person changed, wrong target, face pasted onto original body, pasted selfie face, face cutout, artificial face blend, female face, female body, bob haircut, bangs, long hair, child face, anime face, generic Asian woman, mismatched head-body proportion, oversized head, big head, selfie head scale, portrait head on body, bobblehead, oversized cranium, swollen head, head too large for shoulders, face larger than nearby players, tiny neck, narrow weak neck, weak neck support, mismatched neck, unnatural jaw-neck transition, zoomed-in target, cropped upper body, selfie perspective, phone-camera face distortion, mismatched facial lighting, overly sharp face, waxy skin, wax figure, plastic skin, heavy beauty filter, over-smoothed skin, fake influencer face, unnatural facial symmetry, changed identity, unrecognizable person, copied Image 2 clothing, hoodie, fleece jacket, black T-shirt, zipper jacket, casual coat, changed Bavarian outfit, changed jacket, changed shirt collar, changed lederhosen, changed other people, extra people, missing people, eyeglasses added when absent from Image 2, missing eyeglasses when present in Image 2, distorted glasses, changed hands, changed hand size, shifted beer mug, changed beer mug, changed background, blurry, low quality';

  return {
    baseAnalysis: { prompt: buildBaseAnalysisPrompt(targetPerson, targetDetail) },
    userAnalysis: { prompt: USER_ANALYSIS_PROMPT },
    bodyAlign: {
      prompt: bodyAlignPrompt,
      negativePrompt: bodyAlignNegative,
      apiParams: {
        model: DEFAULT_MODEL,
        size: DEFAULT_SIZE,
        strength: 0.28,
        guidance_scale: 10,
        images: referenceImageCount > 0 ? ['base image', 'user portrait', 'natural beer-shower reference'] : ['base image', 'user portrait'],
      },
    },
    faceswap: {
      prompt: faceswapPrompt,
      negativePrompt: faceswapNegative,
      apiParams: {
        model: DEFAULT_MODEL,
        size: DEFAULT_SIZE,
        strength: 0.26,
        guidance_scale: 10,
        images: referenceImageCount > 0 ? ['stage A image', 'user portrait', 'natural beer-shower reference'] : ['stage A image', 'user portrait'],
      },
    },
    qualityCheck: { prompt: buildQualityCheckPrompt(targetPerson, targetDetail, protectedPerson) },
  };
}

async function writePromptArtifacts(context, prompts) {
  await fs.promises.writeFile(path.join(context.runDir, '01_analysis/base_analysis_prompt.txt'), prompts.baseAnalysis.prompt);
  await fs.promises.writeFile(path.join(context.runDir, '01_analysis/user_analysis_prompt.txt'), prompts.userAnalysis.prompt);

  await writeStagePrompt(context, '02_stage_a_body_align', prompts.bodyAlign);
  await writeStagePrompt(context, '03_stage_b_faceswap', prompts.faceswap);
  await fs.promises.writeFile(path.join(context.runDir, '04_quality_check/check_prompt.txt'), prompts.qualityCheck.prompt);
}

async function runDryPipeline(context, prompts) {
  const baseImage = path.join(context.runDir, '00_inputs/base.jpg');
  const stageAImage = path.join(context.runDir, '02_stage_a_body_align/image.jpg');
  const stageBImage = path.join(context.runDir, '03_stage_b_faceswap/image.jpg');
  const checkedImage = path.join(context.runDir, '04_quality_check/checked_image.jpg');
  const finalImage = path.join(context.runDir, 'final/result.jpg');

  await fs.promises.copyFile(baseImage, stageAImage);
  await fs.promises.copyFile(baseImage, stageBImage);
  await fs.promises.copyFile(baseImage, checkedImage);
  await fs.promises.copyFile(baseImage, finalImage);

  const baseAnalysis = {
    person_count: 4,
    target: {
      position: context.targetPerson,
      current_gender_presentation: 'unknown',
      body_proportion_risk: 'high',
    },
    dry_run: true,
  };
  const userAnalysis = {
    gender_presentation: 'adult male',
    age_range: 'adult',
    ethnicity: 'Asian',
    hair: 'short black hair',
    glasses: 'match Image 2 eyewear status',
    dry_run: true,
  };
  const response = { dry_run: true, image_source: '00_inputs/base.jpg' };
  const qualityCheck = {
    person_count: 4,
    target_is_second_from_right: true,
    target_replaced: false,
    target_is_adult_male: false,
    has_short_black_hair: false,
    eyewear_matches_user_portrait: false,
    head_body_match: false,
    body_gender_consistent: false,
    looks_originally_photographed: false,
    no_pasted_selfie_feel: false,
    head_scale_matches_neighbors: false,
    neck_shoulders_support_head: false,
    identity_not_overfit_to_selfie: false,
    subtle_flattering_event_photo_filter: false,
    other_people_unchanged: true,
    background_preserved: true,
    passed: false,
    failure_reason: 'Dry run did not call image generation APIs.',
    recommended_retry_strategy: 'Run with --execute after API keys are configured.',
  };

  await writeJson(path.join(context.runDir, '01_analysis/base_analysis_result.json'), baseAnalysis);
  await writeJson(path.join(context.runDir, '01_analysis/user_analysis_result.json'), userAnalysis);
  await writeJson(path.join(context.runDir, '02_stage_a_body_align/response.json'), response);
  await writeJson(path.join(context.runDir, '03_stage_b_faceswap/response.json'), response);
  await writeJson(path.join(context.runDir, '04_quality_check/check_result.json'), qualityCheck);
  await appendLog(context, 'Dry pipeline completed');

  return {
    baseAnalysis,
    userAnalysis,
    qualityCheck,
    finalImage: 'final/result.jpg',
    selectedStage: 'dry_run_copy',
    passedQualityCheck: false,
    attempts: 1,
  };
}

async function runExecutePipeline(context, prompts, options = {}) {
  loadEnvFile(options.envPath);
  const protectedRegions = options.protectedRegions || [];
  const editRegions = options.editRegions || [];
  const highlightOcclusionRegions = options.highlightOcclusionRegions || [];
  const referenceImagePaths = options.referenceImagePaths || [];
  const generatedCrop = options.generatedCrop || null;
  const outputCrop = options.outputCrop || null;
  const finalOutputStage = options.finalOutputStage || null;
  const qualityPolicy = { strictBrandQc: Boolean(options.strictBrandQc) };

  const baseImage = path.join(context.runDir, '00_inputs/base.jpg');
  const userImage = path.join(context.runDir, '00_inputs/user.jpg');
  const stageAImage = path.join(context.runDir, '02_stage_a_body_align/image.jpg');
  const stageBImage = path.join(context.runDir, '03_stage_b_faceswap/image.jpg');
  const checkedImage = path.join(context.runDir, '04_quality_check/checked_image.jpg');
  const finalImage = path.join(context.runDir, 'final/result.jpg');

  const baseDataUrl = await toDataUrl(baseImage, 'image/jpeg');
  const userDataUrl = await toDataUrl(userImage, 'image/jpeg');
  const referenceDataUrls = [];
  for (const referenceImagePath of referenceImagePaths) {
    referenceDataUrls.push(await toDataUrl(referenceImagePath, 'image/jpeg'));
  }

  const baseAnalysis = await callVisionJson({
    prompt: prompts.baseAnalysis.prompt,
    images: [baseDataUrl],
  });
  await writeJson(path.join(context.runDir, '01_analysis/base_analysis_result.json'), baseAnalysis);

  const userAnalysis = await callVisionJson({
    prompt: prompts.userAnalysis.prompt,
    images: [userDataUrl],
  });
  await writeJson(path.join(context.runDir, '01_analysis/user_analysis_result.json'), userAnalysis);

  const stageAResponse = await generateSeedreamImage({
    prompt: prompts.bodyAlign.prompt,
    negativePrompt: prompts.bodyAlign.negativePrompt,
    apiParams: prompts.bodyAlign.apiParams,
    images: [baseDataUrl, userDataUrl, ...referenceDataUrls],
  });
  await writeJson(path.join(context.runDir, '02_stage_a_body_align/response.json'), stageAResponse);
  await downloadImage(firstImageUrl(stageAResponse), stageAImage);

  const stageADataUrl = await toDataUrl(stageAImage, 'image/jpeg');
  const stageBResponse = await generateSeedreamImage({
    prompt: prompts.faceswap.prompt,
    negativePrompt: prompts.faceswap.negativePrompt,
    apiParams: prompts.faceswap.apiParams,
    images: [stageADataUrl, userDataUrl, ...referenceDataUrls],
  });
  await writeJson(path.join(context.runDir, '03_stage_b_faceswap/response.json'), stageBResponse);
  await downloadImage(firstImageUrl(stageBResponse), stageBImage);

  let selectedStage = '03_stage_b_faceswap';
  let attempts = 1;
  let qualityCheck = await checkQuality(prompts.qualityCheck.prompt, stageBImage, baseImage, userImage);
  await writeJson(path.join(context.runDir, '04_quality_check/check_result.json'), qualityCheck);
  await fs.promises.copyFile(stageBImage, checkedImage);

  let selectedImage = stageBImage;
  if (!passesQuality(qualityCheck, qualityPolicy)) {
    const retryResult = await runRetries(context, prompts, {
      baseImage,
      userImage,
      stageBImage,
      qualityPrompt: prompts.qualityCheck.prompt,
      initialQualityCheck: qualityCheck,
      qualityPolicy,
    });
    selectedImage = retryResult.selectedImage;
    selectedStage = retryResult.selectedStage;
    qualityCheck = retryResult.qualityCheck;
    attempts = retryResult.attempts;
  }

  let logoProtection = { enabled: false, regions: [] };
  let highlightOcclusion = { enabled: false, regions: [] };
  let baseSync = { enabled: false, regions: [] };
  let composedImage = selectedImage;
  let generatedCropResult = { enabled: false };
  if (finalOutputStage === 'stage_b') {
    await fs.promises.copyFile(selectedImage, finalImage);
    selectedStage = `${selectedStage}+stage_b_output`;
    await appendLog(context, `Execute pipeline completed: ${selectedStage}`);

    return {
      baseAnalysis,
      userAnalysis,
      qualityCheck,
      finalImage: 'final/result.jpg',
      selectedStage,
      passedQualityCheck: passesQuality(qualityCheck, qualityPolicy),
      attempts,
      logoProtection,
      highlightOcclusion,
      baseSync,
      generatedCrop: generatedCropResult,
      outputCrop: { enabled: false },
      finalOutputStage,
      strictBrandQc: qualityPolicy.strictBrandQc,
    };
  }
  if (generatedCrop) {
    generatedCropResult = await cropGeneratedImage({
      sourceImage: selectedImage,
      outputImage: finalImage,
      crop: generatedCrop,
    });
    selectedStage = `${selectedStage}+generated_crop`;
    composedImage = finalImage;
  } else if (editRegions.length > 0) {
    baseSync = await composeEditRegionsOverBase({
      sourceImage: baseImage,
      targetImage: selectedImage,
      outputImage: finalImage,
      regions: editRegions,
    });
    await writeJson(path.join(context.runDir, 'final/base_sync_regions.json'), baseSync);
    selectedStage = `${selectedStage}+base_sync`;
    composedImage = finalImage;
  }
  if (!generatedCrop && protectedRegions.length > 0) {
    logoProtection = await restoreProtectedRegions({
      sourceImage: baseImage,
      targetImage: composedImage,
      outputImage: finalImage,
      regions: protectedRegions,
    });
    await writeJson(path.join(context.runDir, 'final/protected_regions.json'), logoProtection);
    selectedStage = `${selectedStage}+protected_regions`;
  } else if (!generatedCrop && editRegions.length === 0) {
    await fs.promises.copyFile(selectedImage, finalImage);
  }
  if (!generatedCrop && highlightOcclusionRegions.length > 0) {
    highlightOcclusion = await restoreHighlightOcclusionRegions({
      sourceImage: baseImage,
      targetImage: finalImage,
      outputImage: finalImage,
      regions: highlightOcclusionRegions,
    });
    await writeJson(path.join(context.runDir, 'final/highlight_occlusion_regions.json'), highlightOcclusion);
    selectedStage = `${selectedStage}+highlight_occlusion`;
  }
  let outputCropResult = { enabled: false };
  if (outputCrop) {
    outputCropResult = await cropGeneratedImage({
      sourceImage: finalImage,
      outputImage: finalImage,
      crop: outputCrop,
    });
    await writeJson(path.join(context.runDir, 'final/output_crop.json'), outputCropResult);
    selectedStage = `${selectedStage}+output_crop`;
  }
  await appendLog(context, `Execute pipeline completed: ${selectedStage}`);

  return {
    baseAnalysis,
    userAnalysis,
    qualityCheck,
    finalImage: 'final/result.jpg',
    selectedStage,
    passedQualityCheck: passesQuality(qualityCheck, qualityPolicy),
    attempts,
    logoProtection,
    highlightOcclusion,
    baseSync,
    generatedCrop: generatedCropResult,
    outputCrop: outputCropResult,
    strictBrandQc: qualityPolicy.strictBrandQc,
  };
}

async function runRetries(context, prompts, input) {
  const retryPlans = [
    {
      attempt: 2,
      sourceImage: input.stageBImage,
      strength: 0.24,
      guidance_scale: 10,
      extraPrompt: `The previous result may have looked female, had mismatched head-body proportions, added incorrect eyeglasses, looked too much like a pasted selfie, or zoomed in too much. Correct this.
The target must clearly be the adult Asian male from Image 2.
Eyewear must match Image 2 exactly; do not add glasses if Image 2 has no glasses.
The target's head must be smaller than selfie scale and match the nearby players' head size.
The target's neck, shoulders, jersey collar, foam coverage, and head size must be physically natural, with the same full-body framing as Image 1.
Keep a subtle flattering event-photo beauty filter: cleaner skin and healthier complexion, but no heavy smoothing, no plastic skin, and no changed identity.`,
    },
    {
      attempt: 3,
      sourceImage: input.baseImage,
      strength: 0.22,
      guidance_scale: 10,
      extraPrompt: `Change only face, hair, eyewear status, facial hair, skin tone, and very light natural beauty retouching.
Do not modify body shape except minimal neck blending.
Keep the head scale from Image 1 and nearby players; do not import Image 2's selfie head size.
Do not add glasses if Image 2 has no glasses.`,
    },
  ];

  let best = {
    selectedImage: input.stageBImage,
    selectedStage: '03_stage_b_faceswap',
    qualityCheck: input.initialQualityCheck,
    attempts: 1,
  };

  for (const plan of retryPlans) {
    const attemptDir = path.join(context.runDir, `05_retries/attempt_${plan.attempt}`);
    await fs.promises.mkdir(attemptDir, { recursive: true });

    const prompt = `${prompts.faceswap.prompt}\n\n${plan.extraPrompt}`;
    const apiParams = {
      ...prompts.faceswap.apiParams,
      strength: plan.strength,
      guidance_scale: plan.guidance_scale,
      images: ['retry source image', 'user portrait'],
    };

    await fs.promises.writeFile(path.join(attemptDir, 'prompt.txt'), prompt);
    await fs.promises.writeFile(path.join(attemptDir, 'negative_prompt.txt'), prompts.faceswap.negativePrompt);
    await writeJson(path.join(attemptDir, 'api_params.json'), apiParams);

    const response = await generateSeedreamImage({
      prompt,
      negativePrompt: prompts.faceswap.negativePrompt,
      apiParams,
      images: [
        await toDataUrl(plan.sourceImage, 'image/jpeg'),
        await toDataUrl(input.userImage, 'image/jpeg'),
      ],
    });
    await writeJson(path.join(attemptDir, 'response.json'), response);

    const imagePath = path.join(attemptDir, 'image.jpg');
    await downloadImage(firstImageUrl(response), imagePath);

    const checkResult = await checkQuality(input.qualityPrompt, imagePath, input.baseImage, input.userImage);
    await writeJson(path.join(attemptDir, 'check_result.json'), checkResult);

    best = {
      selectedImage: imagePath,
      selectedStage: `05_retries/attempt_${plan.attempt}`,
      qualityCheck: checkResult,
      attempts: plan.attempt,
    };

    if (passesQuality(checkResult, input.qualityPolicy)) break;
  }

  return best;
}

async function generateReport(context, data) {
  const executionMode = data.executionMode || 'execute';
  const dryRunNotice = executionMode === 'dry-run'
    ? `> 注意：本次是 dry-run，占位结果直接复制自底图，没有调用视觉分析或图片生成模型，因此 final/result.jpg 不会包含换脸效果。\n`
    : '';

  const report = `# Faceswap Demo 报告

${dryRunNotice}

## 1. 运行摘要

- Run ID: ${context.runId}
- 创建时间: ${context.createdAt}
- 状态: ${data.status}
- 运行模式: ${executionMode}
- 最终图片: ${data.finalImage}
- 目标人物: ${context.targetPerson}
- 尝试次数: ${data.attempts}

## 2. 输入文件

| 类型 | 路径 | 尺寸 | SHA256 |
|---|---|---:|---|
| 底图 | ${data.inputManifest.base_image.local} | ${formatSize(data.inputManifest.base_image)} | ${data.inputManifest.base_image.sha256} |
| 用户头像 | ${data.inputManifest.user_image.local} | ${formatSize(data.inputManifest.user_image)} | ${data.inputManifest.user_image.sha256} |

## 3. 目标定义

- 替换目标: ${context.targetPerson}
- 期望身份: 成年亚洲男性、短黑发、黑色矩形眼镜
- 必须保持: 4 人构图、其他 3 人、背景、服装、啤酒杯、手部、光照、相机角度
- 已知风险: 底图目标人物身体比例可能与用户头像身份不匹配

## 4. 底图分析

\`\`\`json
${JSON.stringify(data.baseAnalysis, null, 2)}
\`\`\`

## 5. 用户头像分析

\`\`\`json
${JSON.stringify(data.userAnalysis, null, 2)}
\`\`\`

## 6. Stage A：身体比例适配

### Prompt

\`\`\`text
${data.prompts.bodyAlign.prompt}
\`\`\`

### Negative Prompt

\`\`\`text
${data.prompts.bodyAlign.negativePrompt}
\`\`\`

### API Params

\`\`\`json
${JSON.stringify(data.prompts.bodyAlign.apiParams, null, 2)}
\`\`\`

### 输出

![Stage A](../02_stage_a_body_align/image.jpg)

## 7. Stage B：用户脸替换

### Prompt

\`\`\`text
${data.prompts.faceswap.prompt}
\`\`\`

### Negative Prompt

\`\`\`text
${data.prompts.faceswap.negativePrompt}
\`\`\`

### API Params

\`\`\`json
${JSON.stringify(data.prompts.faceswap.apiParams, null, 2)}
\`\`\`

### 输出

![Stage B](../03_stage_b_faceswap/image.jpg)

## 8. 质量审核

\`\`\`json
${JSON.stringify(data.qualityCheck, null, 2)}
\`\`\`

## 9. 重试记录

- Attempt 2: 首轮未触发或未运行
- Attempt 3: 首轮未触发或未运行

## 10. 最终结果

![最终结果](result.jpg)

## 11. 备注

- 选择阶段: ${data.selectedStage}
- 是否通过质量审核: ${passesQuality(data.qualityCheck, { strictBrandQc: data.strictBrandQc })}
- 结果说明: ${executionMode === 'dry-run' ? '占位结果，未实际替换用户头像。' : '真实模型执行结果。'}
- 建议下一步: ${data.qualityCheck.recommended_retry_strategy || '无'}
`;

  const reportPath = path.join(context.runDir, 'final/report.md');
  await fs.promises.writeFile(reportPath, report);
  return report;
}

async function writeFinalManifest(context, data) {
  const manifest = {
    run_id: context.runId,
    status: data.status,
    final_image: data.finalImage,
    selected_stage: data.selectedStage,
    passed_quality_check: data.passedQualityCheck,
    attempts: data.attempts,
    inputs: {
      base: '00_inputs/base.jpg',
      user: '00_inputs/user.jpg',
    },
    artifacts: {
      base_analysis: '01_analysis/base_analysis_result.json',
      user_analysis: '01_analysis/user_analysis_result.json',
      body_align_image: '02_stage_a_body_align/image.jpg',
      faceswap_image: '03_stage_b_faceswap/image.jpg',
      quality_check: '04_quality_check/check_result.json',
    },
  };

  await writeJson(path.join(context.runDir, 'final/final_manifest.json'), manifest);
  return manifest;
}

async function writeStagePrompt(context, stageDir, stage) {
  await fs.promises.writeFile(path.join(context.runDir, stageDir, 'prompt.txt'), stage.prompt);
  await fs.promises.writeFile(path.join(context.runDir, stageDir, 'negative_prompt.txt'), stage.negativePrompt);
  await writeJson(path.join(context.runDir, stageDir, 'api_params.json'), stage.apiParams);
}

async function buildImageManifest(source, local, filePath) {
  const buffer = await fs.promises.readFile(filePath);
  const dimensions = readImageDimensions(buffer);
  return {
    source,
    local,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    width: dimensions.width,
    height: dimensions.height,
    mime: dimensions.mime,
  };
}

function readImageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      mime: 'image/png',
    };
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
          mime: 'image/jpeg',
        };
      }
      offset += 2 + length;
    }
    return { width: null, height: null, mime: 'image/jpeg' };
  }

  return { width: null, height: null, mime: 'application/octet-stream' };
}

function formatRunId(date) {
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

function formatSize(image) {
  if (!image.width || !image.height) return 'unknown';
  return `${image.width}x${image.height}`;
}

async function writeJson(filePath, value) {
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendLog(context, message) {
  await fs.promises.appendFile(path.join(context.runDir, 'run.log'), `[${new Date().toISOString()}] ${message}\n`);
}

function loadEnvFile(envPath) {
  const resolved = envPath || path.resolve(__dirname, '..', '..', '解压结果/claude/server/.env');
  if (!fs.existsSync(resolved)) return;

  const content = fs.readFileSync(resolved, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

async function callVisionJson({ prompt, images }) {
  const apiKey = process.env.VISION_API_KEY || process.env.SEEDREAM_NATIVE_API_KEY;
  const apiUrl = process.env.VISION_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const model = process.env.VISION_MODEL || DEFAULT_VISION_MODEL;

  if (!apiKey) throw new Error('VISION_API_KEY 或 SEEDREAM_NATIVE_API_KEY 未配置');

  const content = [
    ...images.map((image) => ({ type: 'image_url', image_url: { url: image } })),
    { type: 'text', text: prompt },
  ];

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      max_tokens: 1200,
      temperature: 0.2,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Vision API 请求失败: ${JSON.stringify(data)}`);

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Vision API 未返回内容');

  return parseJsonText(text);
}

async function generateSeedreamImage({ prompt, negativePrompt, apiParams, images }) {
  const apiKey = process.env.SEEDREAM_NATIVE_API_KEY;
  const apiUrl = process.env.SEEDREAM_NATIVE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
  const model = process.env.SEEDREAM_NATIVE_MODEL || apiParams.model;

  if (!apiKey) throw new Error('SEEDREAM_NATIVE_API_KEY 未配置');

  const payload = {
    model,
    prompt,
    image: images,
    sequential_image_generation: 'disabled',
    response_format: 'url',
    size: apiParams.size,
    stream: false,
    watermark: true,
    strength: apiParams.strength,
    negative_prompt: negativePrompt,
  };

  if (!model.includes('5-0')) {
    payload.guidance_scale = apiParams.guidance_scale;
  }

  let response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const cause = error.cause?.message || error.cause?.code || error.message;
    throw new Error(`Seedream API 网络请求失败: ${cause}`);
  }

  const data = await response.json();
  if (!response.ok || data.error) throw new Error(`Seedream API 请求失败: ${JSON.stringify(data)}`);
  return data;
}

async function checkQuality(prompt, generatedImage, baseImage, userImage) {
  return callVisionJson({
    prompt,
    images: [
      await toDataUrl(generatedImage, 'image/jpeg'),
      await toDataUrl(baseImage, 'image/jpeg'),
      await toDataUrl(userImage, 'image/jpeg'),
    ],
  });
}

function passesQuality(result, options = {}) {
  const value = (...keys) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(result, key) && result[key] !== undefined) return result[key];
    }
    return undefined;
  };
  const isPositive = (item) => {
    if (item === true) return true;
    if (typeof item !== 'string') return false;
    return /^(match|matches|matched|natural|black|black rectangular|second from|front center|success|true|exact|identical|correct|pass)/i.test(item.trim())
      || /matches|preserved|unchanged|natural|front center|exact|identical|correct|black rectangular|no glasses|no eyeglasses|absent when absent|not added|matches user/i.test(item);
  };

  const personCount = value('person_count', 'personCount');
  const personCountMatch = value('person_count_match');
  const targetCorrect = value('target_is_second_from_right', 'target_location_correct', 'targetLocationCorrect', 'target_location', 'target_location_match');
  const targetReplaced = value('target_replaced', 'adult_male_appearance', 'adultMaleAppearance', 'adult_male_appearance_match');
  const adultMale = value('target_is_adult_male', 'adult_male_appearance', 'adultMaleAppearance', 'adult_male_appearance_match');
  const shortHair = value('has_short_black_hair', 'short_black_hair', 'shortBlackHair', 'short_black_hair_match', 'hair_color', 'hair_length');
  const eyewear = value('eyewear_matches_user_portrait', 'eyewearMatchesUserPortrait', 'eyewear_matches_user', 'eyewearMatchesUser', 'glasses_match_user_portrait', 'glasses_match_user', 'has_black_rectangular_glasses', 'black_rectangular_glasses', 'blackRectangularGlasses', 'black_rectangular_glasses_match', 'glasses');
  const headBody = value('head_body_match', 'natural_head_body_proportion', 'naturalHeadBodyProportion', 'natural_head_body_proportion_match', 'head_body_proportion');
  const bodyConsistent = value('body_gender_consistent', 'adult_male_appearance', 'adultMaleAppearance', 'adult_male_appearance_match');
  const othersUnchanged = value('other_people_unchanged', 'unchanged_other_three_people', 'otherThreePeopleUnchanged', 'other_three_people_unchanged');
  const background = value('background_preserved', 'unchanged_background', 'backgroundUnchanged', 'background_unchanged', 'unchanged_background_match');
  const protectedUnchanged = value('rightmost_person_unchanged', 'rightmostPersonUnchanged', 'protected_people_unchanged', 'unchanged_protected_people');
  const logosUnchanged = value('logos_unchanged', 'logoSignsUnchanged', 'paulaner_logo_unchanged', 'bayern_logo_unchanged', 'protected_logos_unchanged');
  const originallyPhotographed = value('looks_originally_photographed', 'looksOriginallyPhotographed');
  const noPastedSelfie = value('no_pasted_selfie_feel', 'noPastedSelfieFeel');
  const headScaleMatches = value('head_scale_matches_neighbors', 'headScaleMatchesNeighbors');
  const neckShouldersSupport = value('neck_shoulders_support_head', 'neckShouldersSupportHead');
  const identityNotOverfit = value('identity_not_overfit_to_selfie', 'identityNotOverfitToSelfie');
  const subtleBeauty = value('subtle_flattering_event_photo_filter', 'subtleFlatteringEventPhotoFilter');
  const wardrobeLock = value('wardrobe_lock_from_base', 'wardrobeLockFromBase', 'base_clothing_preserved', 'clothing_preserved');
  const noReferenceClothing = value('no_reference_clothing_transfer', 'noReferenceClothingTransfer', 'no_user_clothing_transfer');
  const bodyAnchor = value('target_body_anchor_preserved', 'targetBodyAnchorPreserved', 'body_anchor_preserved');
  const heightMatches = value('target_height_matches_base', 'targetHeightMatchesBase');
  const faceScale = value('face_scale_not_larger_than_neighbors', 'faceScaleNotLargerThanNeighbors');
  const faceIntegrated = value('face_integrated_with_neck_and_lighting', 'faceIntegratedWithNeckAndLighting');
  const tacitRealism = value('tacit_group_photo_realism', 'tacitGroupPhotoRealism');
  const explicitSuccess = value('passed', 'success', 'isSuccess');
  const customerLogoExact = value('paulaner_logo_exact', 'customer_logo_exact', 'customerLogoExact');
  const bayernLogoExact = value('bayern_logo_exact', 'fc_bayern_logo_exact', 'bayernLogoExact');
  const jerseyLogoExact = value('jersey_logo_exact', 'jersey_logos_exact', 'jerseyLogoExact');
  const playerProportionOk = value('player_proportion_ok', 'target_player_proportion_ok', 'playerProportionOk');

  const basicPassed = (personCount === 4 || personCountMatch === true)
    && isPositive(targetCorrect)
    && isPositive(targetReplaced)
    && isPositive(adultMale)
    && isPositive(shortHair)
    && (eyewear === undefined || isPositive(eyewear))
    && isPositive(headBody)
    && isPositive(bodyConsistent)
    && isPositive(othersUnchanged)
    && isPositive(background)
    && protectedUnchanged !== false
    && logosUnchanged !== false
    && originallyPhotographed !== false
    && noPastedSelfie !== false
    && headScaleMatches !== false
    && neckShouldersSupport !== false
    && identityNotOverfit !== false
    && subtleBeauty !== false
    && wardrobeLock !== false
    && noReferenceClothing !== false
    && bodyAnchor !== false
    && heightMatches !== false
    && faceScale !== false
    && faceIntegrated !== false
    && tacitRealism !== false
    && explicitSuccess !== false;

  if (!basicPassed) return false;
  if (!options.strictBrandQc) return true;
  return isPositive(customerLogoExact)
    && isPositive(bayernLogoExact)
    && isPositive(jerseyLogoExact)
    && isPositive(playerProportionOk);
}

async function restoreProtectedRegions({ sourceImage, targetImage, outputImage, regions }) {
  const targetDimensions = readImageDimensions(await fs.promises.readFile(targetImage));
  const sourceDimensions = readImageDimensions(await fs.promises.readFile(sourceImage));
  if (!targetDimensions.width || !targetDimensions.height || !sourceDimensions.width || !sourceDimensions.height) {
    throw new Error('无法读取图片尺寸，不能执行商标区域保护');
  }

  const normalizedRegions = regions.map((region) => normalizeProtectedRegion(region, targetDimensions));
  if (normalizedRegions.length === 0) {
    await fs.promises.copyFile(targetImage, outputImage);
    return { enabled: false, regions: [] };
  }

  const tempOutput = outputImage === targetImage
    ? path.join(path.dirname(outputImage), `.${path.basename(outputImage)}.tmp.jpg`)
    : outputImage;
  const filterGraph = buildProtectedRegionFilter(targetDimensions, normalizedRegions);

  await execFileAsync('ffmpeg', [
    '-y',
    '-i', targetImage,
    '-i', sourceImage,
    '-filter_complex', filterGraph,
    '-map', '[out]',
    '-frames:v', '1',
    '-q:v', '2',
    tempOutput,
  ]);

  if (tempOutput !== outputImage) {
    await fs.promises.rename(tempOutput, outputImage);
  }

  return {
    enabled: true,
    source_image: sourceImage,
    target_image: targetImage,
    output_image: outputImage,
    source_size: { width: sourceDimensions.width, height: sourceDimensions.height },
    target_size: { width: targetDimensions.width, height: targetDimensions.height },
    regions: normalizedRegions,
  };
}

function buildProtectedRegionFilter(dimensions, regions) {
  const splitLabels = regions.map((_, index) => `[base${index}]`).join('');
  const filters = [`[1:v]scale=${dimensions.width}:${dimensions.height}:flags=lanczos,split=${regions.length}${splitLabels}`];
  let previous = '[0:v]';

  regions.forEach((region, index) => {
    const patch = `[patch${index}]`;
    const output = index === regions.length - 1 ? '[out]' : `[tmp${index}]`;
    const mask = buildAlphaMask(region);
    filters.push(`[base${index}]crop=${region.width}:${region.height}:${region.x}:${region.y}${mask}${patch}`);
    filters.push(`${previous}${patch}overlay=${region.x}:${region.y}${output}`);
    previous = output;
  });

  return filters.join(';');
}

async function composeEditRegionsOverBase({ sourceImage, targetImage, outputImage, regions }) {
  const targetDimensions = readImageDimensions(await fs.promises.readFile(targetImage));
  const sourceDimensions = readImageDimensions(await fs.promises.readFile(sourceImage));
  if (!targetDimensions.width || !targetDimensions.height || !sourceDimensions.width || !sourceDimensions.height) {
    throw new Error('无法读取图片尺寸，不能执行底图同步');
  }

  const normalizedRegions = regions.map((region) => normalizeProtectedRegion(region, sourceDimensions));
  if (normalizedRegions.length === 0) {
    await fs.promises.copyFile(targetImage, outputImage);
    return { enabled: false, regions: [] };
  }

  const tempOutput = outputImage === targetImage
    ? path.join(path.dirname(outputImage), `.${path.basename(outputImage)}.tmp.jpg`)
    : outputImage;
  const filterGraph = buildBaseSyncFilter(sourceDimensions, normalizedRegions);

  await execFileAsync('ffmpeg', [
    '-y',
    '-i', targetImage,
    '-i', sourceImage,
    '-filter_complex', filterGraph,
    '-map', '[out]',
    '-frames:v', '1',
    '-q:v', '2',
    tempOutput,
  ]);

  if (tempOutput !== outputImage) {
    await fs.promises.rename(tempOutput, outputImage);
  }

  return {
    enabled: true,
    source_image: sourceImage,
    target_image: targetImage,
    output_image: outputImage,
    source_size: { width: sourceDimensions.width, height: sourceDimensions.height },
    target_size: { width: targetDimensions.width, height: targetDimensions.height },
    regions: normalizedRegions,
  };
}

async function composeCleanBackgroundEditRegionsOverBase({ sourceImage, targetImage, outputImage, regions }) {
  const targetDimensions = readImageDimensions(await fs.promises.readFile(targetImage));
  const sourceDimensions = readImageDimensions(await fs.promises.readFile(sourceImage));
  if (!targetDimensions.width || !targetDimensions.height || !sourceDimensions.width || !sourceDimensions.height) {
    throw new Error('无法读取图片尺寸，不能执行干净背景合成');
  }

  const normalizedRegions = regions.map((region) => normalizeProtectedRegion(region, sourceDimensions));
  if (normalizedRegions.length === 0) {
    await fs.promises.copyFile(targetImage, outputImage);
    return { enabled: false, regions: [] };
  }

  const [sourceRgb, targetRgb] = await Promise.all([
    readRgbFrame(sourceImage, sourceDimensions),
    readRgbFrame(targetImage, sourceDimensions),
  ]);
  const outputRgb = Buffer.from(sourceRgb);

  for (const region of normalizedRegions) {
    cleanComposeRegion({ sourceRgb, targetRgb, outputRgb, dimensions: sourceDimensions, region });
  }

  await writeRgbFrame(outputRgb, sourceDimensions, outputImage);

  return {
    enabled: true,
    mode: 'clean_background',
    source_image: sourceImage,
    target_image: targetImage,
    output_image: outputImage,
    source_size: { width: sourceDimensions.width, height: sourceDimensions.height },
    target_size: { width: targetDimensions.width, height: targetDimensions.height },
    regions: normalizedRegions,
  };
}

async function composeCleanBackgroundMappedRegionsOverBase({ sourceImage, targetImage, outputImage, regionPairs }) {
  const targetDimensions = readImageDimensions(await fs.promises.readFile(targetImage));
  const sourceDimensions = readImageDimensions(await fs.promises.readFile(sourceImage));
  if (!targetDimensions.width || !targetDimensions.height || !sourceDimensions.width || !sourceDimensions.height) {
    throw new Error('无法读取图片尺寸，不能执行映射区域合成');
  }

  const normalizedPairs = (regionPairs || []).map((pair) => ({
    id: pair.id,
    sourceRegion: normalizeProtectedRegion(pair.sourceRegion, targetDimensions),
    targetRegion: normalizeProtectedRegion(pair.targetRegion, sourceDimensions),
  }));
  if (normalizedPairs.length === 0) {
    await fs.promises.copyFile(sourceImage, outputImage);
    return { enabled: false, region_pairs: [] };
  }

  const [sourceRgb, targetRgb] = await Promise.all([
    readRgbFrame(sourceImage, sourceDimensions),
    readRgbFrame(targetImage, targetDimensions),
  ]);
  const outputRgb = Buffer.from(sourceRgb);

  for (const pair of normalizedPairs) {
    cleanComposeMappedRegion({
      sourceRgb,
      targetRgb,
      outputRgb,
      sourceDimensions,
      targetDimensions,
      sourceRegion: pair.sourceRegion,
      targetRegion: pair.targetRegion,
    });
  }

  await writeRgbFrame(outputRgb, sourceDimensions, outputImage);

  return {
    enabled: true,
    mode: 'clean_background_mapped',
    source_image: sourceImage,
    target_image: targetImage,
    output_image: outputImage,
    source_size: { width: sourceDimensions.width, height: sourceDimensions.height },
    target_size: { width: targetDimensions.width, height: targetDimensions.height },
    region_pairs: normalizedPairs,
  };
}

function buildBaseSyncFilter(dimensions, regions) {
  const splitLabels = regions.map((_, index) => `[edit${index}]`).join('');
  const filters = [
    `[1:v]scale=${dimensions.width}:${dimensions.height}:flags=lanczos[base]`,
    `[0:v]scale=${dimensions.width}:${dimensions.height}:flags=lanczos,split=${regions.length}${splitLabels}`,
  ];
  let previous = '[base]';

  regions.forEach((region, index) => {
    const patch = `[patch${index}]`;
    const output = index === regions.length - 1 ? '[out]' : `[sync${index}]`;
    const mask = buildAlphaMask(region);
    filters.push(`[edit${index}]crop=${region.width}:${region.height}:${region.x}:${region.y}${mask}${patch}`);
    filters.push(`${previous}${patch}overlay=${region.x}:${region.y}${output}`);
    previous = output;
  });

  return filters.join(';');
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

async function writeRgbFrame(buffer, dimensions, outputImage) {
  const { width, height } = dimensions;
  const tempRaw = path.join(path.dirname(outputImage), `.${path.basename(outputImage)}.${process.pid}.rgb`);
  const tempOutput = outputImage.endsWith('.png')
    ? outputImage
    : path.join(path.dirname(outputImage), `.${path.basename(outputImage)}.${process.pid}.tmp.jpg`);

  try {
    await fs.promises.writeFile(tempRaw, buffer);
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-s', `${width}x${height}`,
      '-i', tempRaw,
      '-frames:v', '1',
      '-q:v', '2',
      tempOutput,
    ]);
    if (tempOutput !== outputImage) {
      await fs.promises.rename(tempOutput, outputImage);
    }
  } finally {
    await fs.promises.unlink(tempRaw).catch(() => {});
  }
}

function cleanComposeRegion({ sourceRgb, targetRgb, outputRgb, dimensions, region }) {
  const patchPixels = region.width * region.height;
  const patch = Buffer.alloc(patchPixels * 3);
  const alphas = new Uint8Array(patchPixels);
  const restored = new Uint8Array(patchPixels);
  let ringCount = 0;
  const ringDelta = [0, 0, 0];

  for (let localY = 0; localY < region.height; localY += 1) {
    for (let localX = 0; localX < region.width; localX += 1) {
      const patchIndex = localY * region.width + localX;
      const globalIndex = ((region.y + localY) * dimensions.width + region.x + localX) * 3;
      const alpha = alphaForRegion(region, localX, localY);
      alphas[patchIndex] = alpha;
      if (alpha === 0) continue;

      let tr = targetRgb[globalIndex];
      let tg = targetRgb[globalIndex + 1];
      let tb = targetRgb[globalIndex + 2];
      const br = sourceRgb[globalIndex];
      const bg = sourceRgb[globalIndex + 1];
      const bb = sourceRgb[globalIndex + 2];

      if (shouldRestoreBaseBlue({ br, bg, bb, tr, tg, tb })) {
        tr = br;
        tg = bg;
        tb = bb;
        restored[patchIndex] = 1;
      }

      const patchOffset = patchIndex * 3;
      patch[patchOffset] = tr;
      patch[patchOffset + 1] = tg;
      patch[patchOffset + 2] = tb;

      if (!restored[patchIndex] && alpha > 5 && alpha < 180) {
        ringDelta[0] += br - tr;
        ringDelta[1] += bg - tg;
        ringDelta[2] += bb - tb;
        ringCount += 1;
      }
    }
  }

  if (ringCount > 0) {
    ringDelta[0] /= ringCount;
    ringDelta[1] /= ringCount;
    ringDelta[2] /= ringCount;
  }

  for (let localY = 0; localY < region.height; localY += 1) {
    for (let localX = 0; localX < region.width; localX += 1) {
      const patchIndex = localY * region.width + localX;
      const alpha = alphas[patchIndex];
      if (alpha === 0) continue;

      const globalIndex = ((region.y + localY) * dimensions.width + region.x + localX) * 3;
      const patchOffset = patchIndex * 3;
      const correctionWeight = restored[patchIndex] ? 0 : Math.max(0, Math.min(1, (230 - alpha) / 230)) * 0.85;
      const blend = alpha / 255;

      for (let channel = 0; channel < 3; channel += 1) {
        const sourceValue = sourceRgb[globalIndex + channel];
        const targetValue = clampByte(patch[patchOffset + channel] + ringDelta[channel] * correctionWeight);
        outputRgb[globalIndex + channel] = clampByte(sourceValue * (1 - blend) + targetValue * blend);
      }
    }
  }
}

function cleanComposeMappedRegion({
  sourceRgb,
  targetRgb,
  outputRgb,
  sourceDimensions,
  targetDimensions,
  sourceRegion,
  targetRegion,
}) {
  const patchPixels = targetRegion.width * targetRegion.height;
  const patch = Buffer.alloc(patchPixels * 3);
  const alphas = new Uint8Array(patchPixels);
  const restored = new Uint8Array(patchPixels);
  let ringCount = 0;
  const ringDelta = [0, 0, 0];

  for (let localY = 0; localY < targetRegion.height; localY += 1) {
    for (let localX = 0; localX < targetRegion.width; localX += 1) {
      const patchIndex = localY * targetRegion.width + localX;
      const alpha = alphaForRegion(targetRegion, localX, localY);
      alphas[patchIndex] = alpha;
      if (alpha === 0) continue;

      const baseX = targetRegion.x + localX;
      const baseY = targetRegion.y + localY;
      const targetX = Math.max(
        0,
        Math.min(targetDimensions.width - 1, Math.round(sourceRegion.x + ((localX + 0.5) * sourceRegion.width / targetRegion.width) - 0.5))
      );
      const targetY = Math.max(
        0,
        Math.min(targetDimensions.height - 1, Math.round(sourceRegion.y + ((localY + 0.5) * sourceRegion.height / targetRegion.height) - 0.5))
      );
      const baseIndex = (baseY * sourceDimensions.width + baseX) * 3;
      const targetIndex = (targetY * targetDimensions.width + targetX) * 3;

      let tr = targetRgb[targetIndex];
      let tg = targetRgb[targetIndex + 1];
      let tb = targetRgb[targetIndex + 2];
      const br = sourceRgb[baseIndex];
      const bg = sourceRgb[baseIndex + 1];
      const bb = sourceRgb[baseIndex + 2];

      if (shouldRestoreBaseBlue({ br, bg, bb, tr, tg, tb })) {
        tr = br;
        tg = bg;
        tb = bb;
        restored[patchIndex] = 1;
      }

      const patchOffset = patchIndex * 3;
      patch[patchOffset] = tr;
      patch[patchOffset + 1] = tg;
      patch[patchOffset + 2] = tb;

      if (!restored[patchIndex] && alpha > 5 && alpha < 180) {
        ringDelta[0] += br - tr;
        ringDelta[1] += bg - tg;
        ringDelta[2] += bb - tb;
        ringCount += 1;
      }
    }
  }

  if (ringCount > 0) {
    ringDelta[0] /= ringCount;
    ringDelta[1] /= ringCount;
    ringDelta[2] /= ringCount;
  }

  for (let localY = 0; localY < targetRegion.height; localY += 1) {
    for (let localX = 0; localX < targetRegion.width; localX += 1) {
      const patchIndex = localY * targetRegion.width + localX;
      const alpha = alphas[patchIndex];
      if (alpha === 0) continue;

      const baseIndex = ((targetRegion.y + localY) * sourceDimensions.width + targetRegion.x + localX) * 3;
      const patchOffset = patchIndex * 3;
      const correctionWeight = restored[patchIndex] ? 0 : Math.max(0, Math.min(1, (230 - alpha) / 230)) * 0.85;
      const blend = alpha / 255;

      for (let channel = 0; channel < 3; channel += 1) {
        const sourceValue = sourceRgb[baseIndex + channel];
        const targetValue = clampByte(patch[patchOffset + channel] + ringDelta[channel] * correctionWeight);
        outputRgb[baseIndex + channel] = clampByte(sourceValue * (1 - blend) + targetValue * blend);
      }
    }
  }
}

function shouldRestoreBaseBlue({ br, bg, bb, tr, tg, tb }) {
  const targetMean = (tr + tg + tb) / 3;
  const baseBlue = bb > br + 18 && bb > bg - 12 && bb > 45;
  const targetBlueish = tb > tr + 8 && tb > tg - 18;
  const targetWhiteHalo = targetMean > 178 && Math.abs(tr - tb) < 55 && Math.abs(tg - tb) < 55;
  const skin = tr > tg + 12 && tg > tb + 5 && targetMean > 70 && targetMean < 230;
  const darkHair = targetMean < 70;
  return baseBlue && (targetBlueish || targetWhiteHalo) && !skin && !darkHair;
}

function alphaForRegion(region, localX, localY) {
  if (region.shape === 'ellipse') {
    const featherRatio = region.feather
      ? Math.min(0.95, Math.max(0.01, region.feather / (Math.min(region.width, region.height) / 2)))
      : 0.01;
    const radius = Math.sqrt(
      ((localX - region.width / 2) / (region.width / 2)) ** 2
      + ((localY - region.height / 2) / (region.height / 2)) ** 2
    );
    if (radius <= 1 - featherRatio) return 255;
    if (radius <= 1) return clampByte((1 - radius) * 255 / featherRatio);
    return 0;
  }
  if (region.feather > 0) {
    const distance = Math.min(localX, localY, region.width - 1 - localX, region.height - 1 - localY);
    return clampByte(distance * 255 / region.feather);
  }
  return 255;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

async function cropGeneratedImage({ sourceImage, outputImage, crop }) {
  const sourceDimensions = readImageDimensions(await fs.promises.readFile(sourceImage));
  if (!sourceDimensions.width || !sourceDimensions.height) {
    throw new Error('无法读取图片尺寸，不能执行生成图裁切');
  }

  const normalized = normalizeGeneratedCrop(crop, sourceDimensions);
  const tempOutput = outputImage === sourceImage
    ? path.join(path.dirname(outputImage), `.${path.basename(outputImage)}.tmp.jpg`)
    : outputImage;
  const scaleFilter = normalized.outWidth && normalized.outHeight
    ? `,scale=${normalized.outWidth}:${normalized.outHeight}:flags=lanczos`
    : '';

  await execFileAsync('ffmpeg', [
    '-y',
    '-i', sourceImage,
    '-vf', `crop=${normalized.width}:${normalized.height}:${normalized.x}:${normalized.y}${scaleFilter}`,
    '-frames:v', '1',
    '-q:v', '2',
    tempOutput,
  ]);

  if (tempOutput !== outputImage) {
    await fs.promises.rename(tempOutput, outputImage);
  }

  return {
    enabled: true,
    source_image: sourceImage,
    output_image: outputImage,
    source_size: { width: sourceDimensions.width, height: sourceDimensions.height },
    crop: normalized,
  };
}

function normalizeGeneratedCrop(crop, dimensions) {
  const scaleX = crop.x <= 1 && crop.width <= 1 ? dimensions.width : 1;
  const scaleY = crop.y <= 1 && crop.height <= 1 ? dimensions.height : 1;
  const x = clamp(Math.round(crop.x * scaleX), 0, dimensions.width - 1);
  const y = clamp(Math.round(crop.y * scaleY), 0, dimensions.height - 1);
  const width = clamp(Math.round(crop.width * scaleX), 1, dimensions.width - x);
  const height = clamp(Math.round(crop.height * scaleY), 1, dimensions.height - y);
  return {
    id: crop.id || `crop_${x}_${y}_${width}_${height}`,
    x,
    y,
    width,
    height,
    ...(crop.outWidth ? { outWidth: Math.round(crop.outWidth) } : {}),
    ...(crop.outHeight ? { outHeight: Math.round(crop.outHeight) } : {}),
  };
}

async function restoreHighlightOcclusionRegions({ sourceImage, targetImage, outputImage, regions }) {
  const targetDimensions = readImageDimensions(await fs.promises.readFile(targetImage));
  const sourceDimensions = readImageDimensions(await fs.promises.readFile(sourceImage));
  if (!targetDimensions.width || !targetDimensions.height || !sourceDimensions.width || !sourceDimensions.height) {
    throw new Error('无法读取图片尺寸，不能执行高光啤酒遮挡恢复');
  }

  const normalizedRegions = regions.map((region) => normalizeProtectedRegion(region, targetDimensions));
  if (normalizedRegions.length === 0) {
    await fs.promises.copyFile(targetImage, outputImage);
    return { enabled: false, regions: [] };
  }

  const tempOutput = outputImage === targetImage
    ? path.join(path.dirname(outputImage), `.${path.basename(outputImage)}.tmp.jpg`)
    : outputImage;
  const filterGraph = buildHighlightOcclusionFilter(targetDimensions, normalizedRegions);

  await execFileAsync('ffmpeg', [
    '-y',
    '-i', targetImage,
    '-i', sourceImage,
    '-filter_complex', filterGraph,
    '-map', '[out]',
    '-frames:v', '1',
    '-q:v', '2',
    tempOutput,
  ]);

  if (tempOutput !== outputImage) {
    await fs.promises.rename(tempOutput, outputImage);
  }

  return {
    enabled: true,
    source_image: sourceImage,
    target_image: targetImage,
    output_image: outputImage,
    source_size: { width: sourceDimensions.width, height: sourceDimensions.height },
    target_size: { width: targetDimensions.width, height: targetDimensions.height },
    regions: normalizedRegions,
  };
}

function buildHighlightOcclusionFilter(dimensions, regions) {
  const splitLabels = regions.map((_, index) => `[occ${index}]`).join('');
  const filters = [`[1:v]scale=${dimensions.width}:${dimensions.height}:flags=lanczos,split=${regions.length}${splitLabels}`];
  let previous = '[0:v]';

  regions.forEach((region, index) => {
    const patch = `[patch${index}]`;
    const output = index === regions.length - 1 ? '[out]' : `[occ_out${index}]`;
    filters.push(`[occ${index}]crop=${region.width}:${region.height}:${region.x}:${region.y}${buildHighlightAlphaMask()}${patch}`);
    filters.push(`${previous}${patch}overlay=${region.x}:${region.y}${output}`);
    previous = output;
  });

  return filters.join(';');
}

function buildHighlightAlphaMask() {
  const highlight = 'max(max(r(X,Y),g(X,Y)),b(X,Y))';
  return `,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gte(r(X,Y),160)*gte(g(X,Y),130)*gte(b(X,Y),95),min((${highlight}-120)*2,220),0)'`;
}

function buildAlphaMask(region) {
  if (region.shape === 'ellipse') {
    const featherRatio = region.feather
      ? Math.min(0.95, Math.max(0.01, region.feather / (Math.min(region.width, region.height) / 2)))
      : 0.01;
    const edge = featherRatio.toFixed(4);
    const radius = 'sqrt(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2))';
    return `,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(${radius},1-${edge}),255,if(lte(${radius},1),(1-${radius})*255/${edge},0))'`;
  }
  if (region.feather > 0) {
    const feather = Math.round(region.feather);
    return `,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='min(min(min(X,W-1-X),min(Y,H-1-Y))*255/${feather},255)'`;
  }
  return '';
}

function normalizeProtectedRegion(region, dimensions) {
  const scaleX = region.x <= 1 && region.width <= 1 ? dimensions.width : 1;
  const scaleY = region.y <= 1 && region.height <= 1 ? dimensions.height : 1;
  const x = clamp(Math.round(region.x * scaleX), 0, dimensions.width - 1);
  const y = clamp(Math.round(region.y * scaleY), 0, dimensions.height - 1);
  const width = clamp(Math.round(region.width * scaleX), 1, dimensions.width - x);
  const height = clamp(Math.round(region.height * scaleY), 1, dimensions.height - y);
  return {
    id: region.id || `region_${x}_${y}_${width}_${height}`,
    x,
    y,
    width,
    height,
    shape: region.shape || 'rectangle',
    ...(region.feather ? { feather: region.feather } : {}),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function toDataUrl(filePath, fallbackMime) {
  const buffer = await fs.promises.readFile(filePath);
  const dimensions = readImageDimensions(buffer);
  const mime = dimensions.mime === 'application/octet-stream' ? fallbackMime : dimensions.mime;
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片下载失败: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(outputPath, buffer);
}

function firstImageUrl(response) {
  const url = response.data?.find((item) => item.url)?.url;
  if (!url) throw new Error('Seedream 响应中未找到图片 URL');
  return url;
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
    throw new Error(`无法解析 Vision JSON: ${trimmed.slice(0, 160)}`);
  }
}

module.exports = {
  TARGET_PERSON,
  DEFAULT_LOGO_PROTECTION_REGIONS,
  DEFAULT_VISION_MODEL,
  createRunContext,
  archiveInputs,
  buildStagePrompts,
  writePromptArtifacts,
  runDryPipeline,
  runExecutePipeline,
  generateReport,
  writeFinalManifest,
  passesQuality,
  normalizeProtectedRegion,
  buildBaseSyncFilter,
  buildHighlightOcclusionFilter,
  composeEditRegionsOverBase,
  composeCleanBackgroundEditRegionsOverBase,
  composeCleanBackgroundMappedRegionsOverBase,
  cropGeneratedImage,
  normalizeGeneratedCrop,
  restoreProtectedRegions,
  restoreHighlightOcclusionRegions,
};
