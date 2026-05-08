/**
 * Prompt builder for faceswap mode
 * 仅替换模板图中指定位置的头部，其余一切严格锁定
 * 零依赖 — 不读 scenes.json / players.json
 *
 * 两种模式：
 *   mannequin — 底图目标位置为空白/模糊占位头，向空位填入球迷人脸
 *   faceswap  — 底图目标位置为真实人脸，替换为球迷人脸
 */

/**
 * @param {Object} [options]
 * @param {string} [options.targetPerson]   - 目标人物位置描述，如 "the only person in the image"
 * @param {string} [options.userDescription]- 视觉模型生成的外貌描述（可选）
 * @param {string} [options.gender]         - 'male' | 'female' | 'unknown'
 * @param {string} [options.templateType]   - 'mannequin' | 'faceswap'
 * @param {string} [options.compositionNote]- 构图锚定备注（可选）
 * @param {string} [options.backgroundNote] - 背景锁定备注（可选）
 * @returns {{ prompt: string, negative_prompt: string, compactPrompt: string }}
 */
function buildFaceswapPrompt(options = {}) {
  const targetPerson    = options.targetPerson    || 'the only person in the image';
  const userDescription = options.userDescription || '';
  const gender          = options.gender          || 'unknown';
  const templateType    = options.templateType    || 'faceswap';
  const compositionNote = options.compositionNote || '';
  const backgroundNote  = options.backgroundNote  || '';

  const appearanceLine = userDescription
    ? `Additional appearance cues from Image 2: ${userDescription}`
    : '';

  // 从外貌描述中提取发型关键词，构建发型锁定 prompt
  let hairstyleLockLine = '';
  if (userDescription && gender === 'male') {
    const desc = userDescription.toLowerCase();
    const hasShortHair = desc.includes('short hair') || desc.includes('buzz') || desc.includes('crew') || desc.includes('fade') || desc.includes('cropped') || desc.includes('close-cropped') || desc.includes('clean-shaven');
    const hasNoBangs = desc.includes('no bangs') || desc.includes('exposed forehead') || desc.includes('receding') || desc.includes('bald');
    const hairKeywords = [];
    if (desc.includes('black hair')) hairKeywords.push('black');
    else if (desc.includes('dark hair')) hairKeywords.push('dark');
    else if (desc.includes('brown hair')) hairKeywords.push('brown');
    if (desc.includes('straight hair')) hairKeywords.push('straight');
    else if (desc.includes('wavy hair')) hairKeywords.push('wavy');
    else if (desc.includes('curly hair')) hairKeywords.push('curly');

    if (hasShortHair || hasNoBangs) {
      hairstyleLockLine = `REFERENCE HAIRSTYLE (ABSOLUTE LOCK): Image 2 shows a MALE with ${hasShortHair ? 'SHORT masculine hair' : 'hair'}. ${hasNoBangs ? 'The forehead is EXPOSED with NO bangs.' : ''} You MUST reproduce this EXACT short masculine hairstyle. Do NOT add bangs, fringe, or length. Do NOT generate a bob cut, bowl cut, pixie cut, or any feminine hairstyle.`;
    } else if (hairKeywords.length > 0) {
      hairstyleLockLine = `REFERENCE HAIRSTYLE: Image 2 shows ${hairKeywords.join(', ')} hair. Copy the EXACT hairstyle from Image 2 — same length, same texture, same fringe status.`;
    }
  }

  // 性别锁定
  const genderLockLine = gender === 'male'
    ? 'GENDER LOCK (MANDATORY): The person is MALE. Reproduce MALE facial structure, MALE hairstyle, and MALE appearance from Image 2. Do NOT generate feminine face shape, feminine hairstyle, or any female facial features.'
    : gender === 'female'
    ? 'GENDER LOCK (MANDATORY): The person is FEMALE. Reproduce FEMALE facial structure and FEMALE appearance from Image 2. Do NOT generate masculine facial features.'
    : '';

  // 发型规则（防止模型生成刻板亚洲男性发型）
  const hairstyleRules = [
    '- HAIRSTYLE (CRITICAL): The hairstyle must come EXCLUSIVELY from Image 2. Do NOT default to any generic hairstyle.',
    '- Reproduce the exact hair silhouette, volume, hairline shape, fringe/bang presence and shape, parting direction, and texture from Image 2.',
    '- If Image 2 shows NO fringe (forehead exposed), do NOT add a fringe. Keep the forehead exposed.',
    '- If Image 2 shows a NATURAL SOFT fringe, reproduce it as organic with visible individual strands — do NOT harden it into a straight-across bowl-cut line.',
    '- If Image 2 shows NO defined parting, do NOT add a center-part or side-part.',
    gender === 'male'
      ? '- MALE ANTI-BOWL-CUT (MANDATORY): Do NOT generate a bowl cut, mushroom cut, or any hairstyle uniformly cut in a straight horizontal line across the entire forehead. This is a photorealistic face swap — the hairstyle must come from Image 2 only.'
      : '',
  ].filter(Boolean).join('\n');

  let prompt;

  // ══════════════════════════════════════════════════════════════
  //  MANNEQUIN 模式：底图目标位置为空白/模糊占位头，只填入人脸
  // ══════════════════════════════════════════════════════════════
  if (templateType === 'mannequin') {
    prompt = [
      'Photorealistic photo. Minimal face-only insertion edit.',
      '',
      'Image 1 is the MASTER TEMPLATE. It is sacred and fixed. Reproduce every pixel of Image 1 with absolute fidelity — EXCEPT for the single blank oval head area.',
      `Image 1 contains a blank, featureless mannequin head on ${targetPerson}. This and ONLY this oval blank area should be modified.`,
      'Image 2 is the face identity source only.',
      '',
      '━━━ HEAD SIZE (HIGHEST PRIORITY — MUST FOLLOW EXACTLY) ━━━',
      'The blank head placeholder in Image 1 is a SMALL oval area. The inserted face must occupy EXACTLY that same small oval — no larger, no smaller.',
      'The face must look naturally proportionate with the body in Image 1. The head-to-body ratio must match the original mannequin proportions.',
      'DO NOT zoom in. DO NOT enlarge the head. DO NOT let the face overflow outside the oval placeholder boundary.',
      'If the face from Image 2 is large, scale it DOWN to fit the small placeholder. The result head must be SMALLER than it appears in Image 2.',
      '',
      '━━━ FACE IDENTITY ━━━',
      `Fill the blank oval with the face of the person from Image 2: their facial structure, eyes, nose, lips, skin tone, hairline, hairstyle, and hair length.`,
      appearanceLine,
      hairstyleRules,
      hairstyleLockLine,
      genderLockLine,
      '- If Image 2 shows glasses, add those. If not, no glasses.',
      '- Do not beautify or alter the face identity from Image 2.',
      '',
      '━━━ COMPOSITION & BACKGROUND (ABSOLUTE LOCK) ━━━',
      'The ENTIRE composition of Image 1 is FROZEN. Do not move, rearrange, resize, or alter ANY element:',
      '- Camera angle and perspective: IDENTICAL to Image 1. Do NOT change the viewpoint.',
      '- Body position and pose: IDENTICAL. The seated posture, limb angles, hand position — unchanged.',
      '- All clothing: jersey, shorts, socks, shoes — IDENTICAL pixel-for-pixel.',
      '- All jersey details: T-Mobile logo, Bayern crest, adidas stripes, colors — IDENTICAL.',
      '- Jersey positions on hangers in lockers: IDENTICAL — do NOT move or rearrange jerseys.',
      '- Locker structure, bench, floor, ceiling, walls: IDENTICAL.',
      '- All brand logos and signs (PAULANER etc.): IDENTICAL, sharp, correctly spelled.',
      backgroundNote
        ? `- BACKGROUND LOCK: ${backgroundNote} — IDENTICAL to Image 1.`
        : '- Every background element stays exactly where it is in Image 1.',
      '- Lighting, shadows, reflections, color grading: IDENTICAL.',
      compositionNote ? `- ${compositionNote}` : '',
      '',
      'The ONLY difference between Image 1 and the result is the face inside the small blank oval. Everything else is a perfect copy of Image 1.',
      '',
      'Photorealistic, 8K, sharp face.',
    ].filter(Boolean).join('\n');
  } else {
    // ══════════════════════════════════════════════════════════════
    //  FACESWAP 模式：底图目标位置为真实人脸，替换为球迷人脸
    // ══════════════════════════════════════════════════════════════
    prompt = [
      'Photorealistic photo. Identity-preserving face-swap edit.',
      '',
      'Image 1 is the FIXED TEMPLATE — reproduce it with maximum fidelity.',
      `Image 2 is the FACE REFERENCE — replace ONLY ${targetPerson}'s head and face with the identity from Image 2.`,
      appearanceLine,
      '',
      'Face replacement rules:',
      `- ${targetPerson} must be clearly identifiable as the exact same person from Image 2.`,
      '- Preserve the identity from Image 2: facial structure, face width, jawline, eye shape, eye openness, nose, lips, skin tone, hairline, hairstyle, hair length, glasses, and age presentation.',
      '- Replace the entire visible head identity of the target person, not just the inner face area.',
      hairstyleRules,
      hairstyleLockLine,
      genderLockLine,
      '- Do not beautify, feminize, masculinize, cartoonize, or generate a random similar-looking person.',
      '- If Image 2 shows glasses, keep those glasses. If Image 2 does NOT show glasses, do not add glasses.',
      '- If Image 1 and Image 2 conflict, follow Image 2 for the target person\'s head and face; keep the body, pose, and clothing from Image 1.',
      '- HEAD SIZE (CRITICAL): The replaced head must be the EXACT SAME SIZE as the original head in Image 1 at that position. Do NOT enlarge, shrink, or rescale the head.',
      '',
      'ABSOLUTE LOCK — everything below must be PIXEL-PERFECTLY IDENTICAL to Image 1:',
      '- All OTHER people in the image: their faces, expressions, body poses — completely unchanged.',
      '- All clothing items on ALL people: jerseys, shorts, socks, shoes, accessories — completely unchanged.',
      '- All jersey details: logos, badges, numbers, colors — completely unchanged.',
      '- The entire background: environment, stadium, Oktoberfest setting — completely unchanged.',
      backgroundNote
        ? `- BACKGROUND LOCK: ${backgroundNote} — reproduce EXACTLY, do NOT add, remove, or alter any element.`
        : '- All background brand logos, signs, and text: remain sharp and spelled exactly as in Image 1.',
      '- All props (beer mugs, flags, etc.): completely unchanged.',
      compositionNote ? `- COMPOSITION LOCK: ${compositionNote} — do NOT drop, add, or merge any person.` : '',
      '- Lighting, shadows, color grading: completely unchanged.',
      '- Camera angle and framing: completely unchanged.',
      `- Replace ONLY ${targetPerson}'s head/face. Every other part of Image 1 is final and locked.`,
      '',
      '8K quality, sharp faces, photorealistic.',
    ].filter(Boolean).join('\n');
  }

  const negative_prompt = [
    'changed background, altered environment, rearranged elements, shifted composition, different camera angle, changed perspective,',
    'moved jersey, relocated jersey, jersey in different locker, rearranged lockers, different bench position,',
    'different lighting, modified clothing, changed jersey color, altered jersey details,',
    'altered other person face, changed expression on non-target person, different pose on non-target person,',
    'blurry face, distorted face, deformed face, merged faces, cartoon, illustration, CGI, render,',
    'low quality, watermark, text overlay,',
    'wrong hairstyle, wrong hair length, wrong hairline, bowl cut, blunt bowl fringe, straight across fringe,',
    'center parted hair, middle part, neat cap-like haircut, generic asian bowl cut, flat uniform fringe,',
    'feminine bob on male, pixie cut on male, soft layers on male, curtain bangs on male, straight bangs on male,',
    'page boy cut, mushroom cut, helmet hair, cap-shaped hair, rounded fringe on male, baby bangs,',
    'hair covering forehead when reference shows no bangs, added bangs, invented fringe, hair lengthened from source,',
    'missing glasses, wrong glasses, added glasses when reference has none,',
    'feminine face when reference is masculine, masculine face when reference is feminine,',
    'oversized head, enlarged head, big head, huge head, disproportionate head, head larger than original, head larger than body, head too big, zoomed in face, face too close, face filling frame, head overflowing, face extending beyond oval,',
    'extra person, missing person, dropped character, merged characters,',
    'blurry logo, unreadable logo, distorted logo, broken text, warped sign, misspelled logo,',
    'beautified face, childlike face, doll face, identity drift, different person,',
    'repositioned body, changed body pose, altered clothing details,',
  ].join(' ');

  // relay 模式精简版（token 受限）
  const compactPrompt = templateType === 'mannequin'
    ? [
        'Photorealistic photo. Fill blank placeholder head with face from Image 2.',
        `Image 1 = template with blank head on ${targetPerson}. Image 2 = face reference.`,
        'Insert ONLY the face/head from Image 2 into the blank area. Everything else in Image 1 is LOCKED unchanged.',
        appearanceLine,
        '8K, photorealistic.',
      ].filter(Boolean).join(' ')
    : [
        'Photorealistic photo. Face-swap edit.',
        `Image 1 = template. Image 2 = face reference. Replace ONLY ${targetPerson} with the person from Image 2.`,
        appearanceLine,
        'All other people, jerseys, background, logos: IDENTICAL to Image 1.',
        '8K, photorealistic.',
      ].filter(Boolean).join(' ');

  return { prompt, negative_prompt, compactPrompt };
}

module.exports = { buildFaceswapPrompt };
