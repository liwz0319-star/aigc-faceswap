/**
 * Prompt builder for faceswap mode
 * 仅替换模板图中指定位置球迷的人脸，保持其余一切不变
 * 零依赖 — 不读 scenes.json / players.json
 */

/**
 * 构建 faceswap 提示词
 *
 * Image 1 = 模板图（底图，保留结构）
 * Image 2 = 球迷照片（人脸来源）
 *
 * @param {Object} [options]
 * @param {string} [options.targetPerson] - 要替换的人物位置描述，如 "the second person from the right"
 * @param {string} [options.userDescription] - 视觉模型生成的外貌描述（可选，增强人脸还原）
 * @returns {{ prompt: string, negative_prompt: string }}
 */
function buildFaceswapPrompt(options = {}) {
  const targetPerson = options.targetPerson || 'the fan (the non-player person)';
  const userDescription = options.userDescription || '';
  const gender = options.gender || 'unknown';

  const appearanceLine = userDescription
    ? `Additional appearance cues from Image 2: ${userDescription}`
    : '';

  const bodyRuleLine = gender === 'male'
    ? '- If the target person is male, keep full adult male proportions and make the target person visually the same standing height as the adjacent adult players. Match the neighboring players at eye-line, shoulder height, torso length, hip height, and leg length. Do not make him shorter, smaller, younger, stockier, compressed, or childlike.'
    : gender === 'female'
      ? '- Keep full adult proportions for the target person. Do not make the target person childlike or unusually short.'
      : '- Keep full adult proportions for the target person.';

  const prompt = [
    'Photorealistic group photo. Identity-preserving head-swap edit.',
    '',
    'Image 1 is the source template group photo — reproduce it with maximum fidelity.',
    `Image 2 is the identity reference — replace ONLY ${targetPerson} with the SAME PERSON as Image 2.`,
    appearanceLine,
    '',
    'Critical identity rules:',
    `- ${targetPerson} must be clearly identifiable as the exact same person from Image 2.`,
    `- Preserve the identity from Image 2: facial structure, face width, jawline, eye shape, eye openness, nose, lips, skin tone, hairline, hairstyle, hair length, glasses, and age presentation.`,
    '- Replace the entire visible head identity of the target person, not just the inner face area.',
    '- The hairstyle from Image 2 overrides Image 1 for the target person. Preserve the exact hair silhouette, hair volume, hairline, fringe/bangs shape, and hair parting direction from Image 2.',
    '- Keep the target hairstyle natural and realistic. Do not simplify it into a generic bowl cut, flat straight fringe, or stereotyped neat cap-like haircut unless Image 2 actually shows that.',
    '- Do not beautify, feminize, masculinize, cartoonize, or generate a random similar-looking person.',
    '- If Image 2 shows glasses, keep the same glasses. If Image 2 does not show glasses, do not add glasses.',
    '- If Image 1 conflicts with Image 2, follow Image 2 for the target person head and face, but keep the body, pose, and clothing from Image 1.',
    bodyRuleLine,
    '',
    'Strict preservation rules for the rest of the image:',
    '- All players\' faces, expressions, and appearances: IDENTICAL to Image 1.',
    '- All jerseys, numbers, badges: IDENTICAL to Image 1.',
    '- All body poses and positions: IDENTICAL to Image 1.',
    '- Background, lighting, shadows, colors: IDENTICAL to Image 1.',
    '- Background brand logos and text must remain sharp, centered, and clearly readable, especially the PAULANER and FC BAYERN circular signs.',
    '- Keep the original camera framing and group composition from Image 1.',
    `- Replace only ${targetPerson}'s head/face identity to match Image 2.`,
    '',
    '8K quality, sharp faces, photorealistic.',
  ].filter(Boolean).join('\n');

  const negative_prompt = [
    'changed background, altered stadium, different lighting, modified jersey, wrong jersey number,',
    'altered player face, changed player expression, different player pose, extra people, missing people,',
    'blurry face, distorted face, deformed face, merged faces, cartoon, illustration,',
    'low quality, watermark, text overlay, wrong skin tone on players, wrong hairstyle, wrong hair length,',
    'wrong hairline, wrong fringe, wrong bangs, bowl cut, flat hair, missing hair volume, wrong parting,',
    'missing glasses, wrong glasses, feminine face when reference is masculine, masculine face when reference is feminine,',
    'shorter body, small body, child proportions, oversized head, short legs,',
    'blurry logo, unreadable logo, distorted logo, broken text, warped sign, soft background signage,',
    'beautified face, childlike face, doll face, generic asian face, identity drift',
  ].join(' ');

  return { prompt, negative_prompt };
}

module.exports = { buildFaceswapPrompt };
