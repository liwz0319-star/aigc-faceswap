/**
 * Prompt builder for faceswap mode
 * 仅替换模板图中球迷的人脸，保持其余一切不变
 * 零依赖 — 不读 scenes.json / players.json
 */

const SCENE_TARGETS = {
  '1': 'the 2nd person from the right (the fan standing beside the rightmost player)',
  '2': 'the 2nd person from the right (the fan standing beside the rightmost player)',
  '3': 'the person who is high-fiving the mascot on the left',
};

function buildFaceswapPrompt(options = {}) {
  const { scene_id, gender, userAppearanceDesc = '', userPhotoCount = 1 } = options;
  const genderLabel = gender === 'female' ? 'female' : 'male';

  const targetDesc = SCENE_TARGETS[scene_id] || 'the fan (the non-player person)';

  // 计算模板图的引用索引（用户照片在前面）
  const templateImgIdx = userPhotoCount + 1;
  const userImgRef = userPhotoCount === 1
    ? 'reference image 1'
    : 'reference images 1 through ' + userPhotoCount + ' (all show the SAME person)';

  const prompt = [
    'Photorealistic group photo with Bayern football players and a fan. Full-body vertical framing, aspect ratio 4:5. All people shown at full height — do NOT compress or crop any person.',
    '',
    'FACE RULE (HIGHEST PRIORITY): The ' + genderLabel + ' fan\'s face MUST exactly match ' + userImgRef + ' — identical bone structure, skin tone, face shape, eye shape, eye size, nose, mouth, hair, and ALL facial features.',
  ];

  // 如果有视觉模型描述，加入详细外貌信息
  if (userAppearanceDesc) {
    prompt.push('ADDITIONAL APPEARANCE DETAILS from analysis: ' + userAppearanceDesc);
  }

  prompt.push('');
  prompt.push('EYE RULE (CRITICAL): The fan\'s eye size, eye shape, and eye opening must EXACTLY match ' + userImgRef + ' — do NOT make the eyes smaller, narrower, or more squinted. Eyes must be fully open and natural.');
  prompt.push(userImgRef + ' is the ABSOLUTE GROUND TRUTH for the fan\'s appearance. ALWAYS trust ' + userImgRef + ' over any other instructions.');
  prompt.push('');
  prompt.push('TARGET PERSON: Replace ONLY the face of ' + targetDesc + ' in reference image ' + templateImgIdx + ' with the face from ' + userImgRef + '.');
  prompt.push('The target person\'s body, clothing, pose, and position remain EXACTLY as shown in reference image ' + templateImgIdx + '.');
  prompt.push('');
  prompt.push('COMPOSITION RULE: Reproduce reference image ' + templateImgIdx + ' EXACTLY for composition — keep ALL player faces, their poses, expressions, clothing, background, props, and lighting IDENTICAL.');
  prompt.push('ONLY the target person\'s face changes (to match ' + userImgRef + '). Everything else stays the same.');
  prompt.push('');
  prompt.push('HEIGHT RULE: Do NOT compress or shrink any person\'s height. All people must stand at their natural full height with proper body proportions.');

  // 性别参考图说明
  const genderRefIdx = templateImgIdx + 1;
  if (scene_id === '3' || scene_id === '4') {
    prompt.push('');
    prompt.push('BODY REFERENCE: reference image ' + genderRefIdx + ' shows the correct ' + genderLabel + ' body type and pose for this scene. Match the target person\'s body proportions to reference image ' + genderRefIdx + '.');
  }

  prompt.push('');
  prompt.push('CRITICAL RULES:');
  prompt.push('- Do NOT alter any player\'s face, body, or appearance — they must be immediately recognizable.');
  prompt.push('- Do NOT change the background, props, or lighting from reference image ' + templateImgIdx + '.');
  prompt.push('- Do NOT add or remove any person.');
  prompt.push('- Do NOT copy clothing from ' + userImgRef + ' — the fan wears the same outfit as in reference image ' + templateImgIdx + '.');
  prompt.push('- Only include glasses/sunglasses if ' + userImgRef + ' shows them.');
  prompt.push('- The fan\'s new face must be seamlessly blended — match skin tone and lighting to the scene.');
  prompt.push('- Do NOT compress any person\'s height — maintain full-body proportions.');
  prompt.push('- Keep vertical 4:5 aspect ratio — full-body shot, NOT cropped or compressed.');
  prompt.push('');
  prompt.push('8K quality, sharp focus on all faces, photorealistic, full-body vertical composition.');

  const negative_prompt = [
    'altered background, changed clothing, extra people, missing people, blurry face,',
    'distorted face, different pose, different angle, deformed face, merged faces,',
    'cartoon, illustration, low quality, watermark, text overlay, cropped body,',
    'half-body framing, head-only framing, compressed height, squished body, short person,',
    'wrong jersey color, wrong face, generic face, different person,',
    'westernized face, changed ethnicity, squinted eyes, narrow eyes, small eyes,',
    'copied clothing from user reference, horizontal aspect ratio, wide framing,',
    'altered player face, unrecognizable player, changed player appearance,',
  ].join(', ');

  return { prompt: prompt.join('\n'), negative_prompt };
}

module.exports = { buildFaceswapPrompt };
