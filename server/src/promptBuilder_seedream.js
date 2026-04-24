/**
 * Prompt 构建引擎
 *
 * 结构（与 scenes.json 对齐）：
 *   1. 开头声明（类型 + 人脸规则）
 *   2. 人物列表（编号列表）
 *   3. SETTING（环境）
 *   4. CLOTHING（服装）
 *   5. ACTION AND POSE（动作）
 *   6. 质量标签
 */

const players = require('./data/players');
const scenes = require('./data/scenes_seedream');

/**
 * 校验参数
 */
function validateParams(starIds, sceneId, userMode) {
  if (!Array.isArray(starIds) || starIds.length !== 3) {
    throw new Error('star_ids 必须是恰好3个球星的数组');
  }
  if (!scenes[sceneId]) {
    throw new Error(`无效的 scene_id: ${sceneId}`);
  }
  if (!['adult'].includes(userMode)) {
    throw new Error('user_mode 仅支持 adult');
  }
  const seen = new Set();
  for (const sid of starIds) {
    if (!players[sid]) {
      throw new Error(`无效的 star_id: ${sid}`);
    }
    if (seen.has(sid)) {
      throw new Error(`star_ids 中存在重复: ${sid}`);
    }
    seen.add(sid);
  }
}

/**
 * 构建人物列表段落（场景1/2/3 — 4人）
 * @param {string[]} starIds - 球星ID数组
 * @param {string} userDescription - 用户描述
 * @param {string} [clothingTag] - 服装标签（直接嵌入人物描述，增强服装统一约束）
 * @param {number} [userImageCount=1] - 用户参考图数量
 */
function buildPeopleSection(starIds, userDescription, clothingTag, userImageCount = 1) {
  const clothingNote = clothingTag ? `, wearing ${clothingTag}` : '';
  const faceRef = userImageCount === 1
    ? 'This is the person whose face matches reference image 1.'
    : `This is the person whose face matches reference images 1 through ${userImageCount} (all show the SAME person).`;

  const playerTexts = starIds.map(sid => {
    const p = players[sid];
    const desc = p.prompt_desc || `${p.identity_anchor}. ${p.expression}, ${p.body}`;
    return `${desc}${clothingNote}`;
  });

  return `THE PEOPLE (exactly 4):
1. ${playerTexts[0]}
2. ${playerTexts[1]}
3. THE FAN — an adult supporter (${userDescription})${clothingNote}. ${faceRef} The fan is a full-grown ADULT. The fan has a CLOSED-MOUTH gentle smile — NOT open mouth, NOT laughing with teeth showing. The fan's EYES are the SAME SIZE and shape as in the reference photo — do NOT make eyes smaller.
4. ${playerTexts[2]}`;
}

/**
 * 构建人物列表段落（场景4专属 — 5主体：3球星+球迷+Bernie）
 */
function buildPeopleSection5(starIds, userDescription, clothingTag, userImageCount = 1) {
  const clothingNote = clothingTag ? `, wearing ${clothingTag}` : '';
  const faceRef = userImageCount === 1
    ? 'Face matches reference image 1.'
    : `Face matches reference images 1 through ${userImageCount} (all show the SAME person).`;

  const playerTexts = starIds.map(sid => {
    const p = players[sid];
    const desc = p.prompt_desc || `${p.identity_anchor}. ${p.expression}, ${p.body}`;
    return `${desc}${clothingNote}`;
  });

  // 场景4：将第3位球星（starIds[2]）提前至第1位，远离画面边缘，防止被省略
  return `THE SUBJECTS (exactly 5 — 3 players + 1 fan + 1 bear mascot):
1. ${playerTexts[2]} — standing in the background, face fully visible. MUST appear in this image.
2. ${playerTexts[0]}
3. THE FAN — an adult supporter (${userDescription})${clothingNote}. ${faceRef} Full-grown ADULT. Standing in FOREGROUND CENTER. The fan has a CLOSED-MOUTH gentle smile — NOT open mouth, NOT laughing with teeth showing. The fan's EYES are the SAME SIZE and shape as in the reference photo — do NOT make eyes smaller.
4. ${playerTexts[1]}
5. BERNIE THE BEAR MASCOT — FC Bayern Munich's official large brown bear mascot in full bear costume. Standing IMMEDIATELY NEXT TO THE FAN in FOREGROUND.`;
}

/**
 * 获取场景字段（支持扁平结构，回退兼容旧嵌套结构）
 */
function getSceneField(scene, flatKey, ...nestedPath) {
  if (scene[flatKey] !== undefined) {
    return scene[flatKey];
  }
  let obj = scene;
  for (const key of nestedPath) {
    if (obj && typeof obj === 'object' && key in obj) {
      obj = obj[key];
    } else {
      return '';
    }
  }
  return typeof obj === 'string' ? obj : '';
}

/**
 * 获取场景级 native_params
 */
function getNativeParams(sceneId) {
  const scene = scenes[sceneId];
  return scene?.native_params || {};
}

/**
 * 组装 Master Prompt
 *
 * @param {string[]} starIds - 3个球星的ID数组
 * @param {string} sceneId - 场景ID
 * @param {string} userMode - adult
 * @param {string} userDescription - 用户外貌文字描述
 * @param {Object} [options] - 可选参数
 * @param {boolean} [options.nativeMode=false] - 是否为 native 模式
 * @param {number} [options.userImageCount=1] - 用户照片数量（1-3张）
 * @returns {{ prompt: string, player_names: string[], native_params: Object }}
 */
function buildAllPrompts(starIds, sceneId, userMode, userDescription, options = {}) {
  validateParams(starIds, sceneId, userMode);

  const playerNames = starIds.map(sid => players[sid].name);
  const scene = scenes[sceneId];
  const clothingTag = scene.clothing_tag || '';

  const modeSuffix = 'adult';

  const environment = getSceneField(scene, 'environment', 'environment', 'setting')
    || buildLegacyEnvironment(scene);
  const clothing = getSceneField(scene, `clothing_${modeSuffix}`, 'attire_rules', 'fan_adult')
    || buildLegacyAttire(scene, userMode);
  const action = getSceneField(scene, `action_${modeSuffix}`, 'action_and_props', 'adult_mode')
    || buildLegacyAction(scene, userMode);

  const isScene4 = sceneId === '3';

  const userImageCount = options.userImageCount || 1;

  // 构建用户照片引用行（多张时强调"同一人"）
  const userImageRef = userImageCount === 1
    ? 'Reference image 1: THE FAN — reproduce this face exactly as shown. CRITICAL EYE RULE: The fan\'s EYES must be reproduced at EXACTLY the same size, shape, and openness as in reference image 1 — do NOT shrink, narrow, or make the eyes smaller under any circumstances. Eyes must be fully open and natural. Only include glasses if the reference photo clearly shows them.'
    : `Reference images 1 through ${userImageCount}: ALL show THE SAME PERSON (the fan) from different angles or moments. They are the SAME individual — reproduce this person\'s face exactly as shown. CRITICAL EYE RULE: The fan\'s EYES must be reproduced at EXACTLY the same size, shape, and openness as in these reference images — do NOT shrink, narrow, or make the eyes smaller. Eyes must be fully open and natural. Only include glasses if the reference photos clearly show them. Use ALL ${userImageCount} images as face reference.`;

  const faceRule = options.nativeMode
    ? `FACE RULE (HIGHEST PRIORITY): Fan's face MUST exactly match reference image 1 — identical features, skin tone, face shape, hair. EYE RULE (CRITICAL): The fan's eye size, eye shape, and eye opening must EXACTLY match reference image 1 — do NOT make the eyes smaller, narrower, or more squinted than the reference. Reproduce the EXACT same eye proportions. MOUTH RULE: The fan must have a CLOSED-MOUTH gentle smile — NOT open mouth, NOT showing teeth, NOT laughing with mouth open. ONLY add glasses if the reference photo clearly shows the fan wearing glasses. If the reference photo shows NO glasses, do NOT add any glasses. Reference image 1 is the GROUND TRUTH for the fan's appearance including eyes — the fan's eyes must be fully open and natural, NOT squinting or half-closed. The text description below is APPROXIMATE and may contain inaccuracies — ALWAYS trust reference image 1 over the text description when they conflict. Do NOT copy clothing from reference image 1. Star players must be immediately recognizable — same face, hairstyle, and features as shown in their reference images.`
    : `FACE RULE (HIGHEST PRIORITY — OVERRIDES ALL OTHER INSTRUCTIONS): THE FAN'S FACE IS THE MOST IMPORTANT ELEMENT IN THIS IMAGE. Fan's face MUST exactly match the person shown in reference image${userImageCount > 1 ? `s 1 through ${userImageCount}` : ' 1'} — identical bone structure, skin tone, face shape, eye shape, nose, mouth, hair. EYE RULE (CRITICAL): The fan's eye size, eye shape, and eye opening must EXACTLY match the reference photo — do NOT make the eyes smaller, narrower, more squinted, or more "Asian-stereotyped" than what is shown. Reproduce the EXACT same eye proportions and openness as the reference. MOUTH RULE: The fan must have a CLOSED-MOUTH gentle smile — NOT open mouth, NOT showing teeth, NOT laughing with mouth open. EYEWEAR RULE: ONLY add glasses/sunglasses if the reference photo clearly shows the fan wearing them. If the reference photo shows NO glasses, do NOT add any glasses — the fan should have bare eyes with NO eyewear. The fan's eyes must be fully open, bright and natural — NOT squinting, NOT half-closed, NOT narrow, NOT small. These reference images are the ABSOLUTE GROUND TRUTH for the fan's appearance. Do NOT copy clothing from the fan's reference images. Do NOT replace the fan with a generic face. Do NOT westernize or change the fan's ethnicity. Star players must be immediately recognizable as real public figures.`;

  // 构建 FACE REFERENCE MAPPING
  // 用户照片占 Image 1 ~ userImageCount，球星从 userImageCount+1 开始
  const playerOffset = userImageCount + 1; // 球星起始 Image 索引

  let faceAnchors;
  if (options.playerImageMap) {
    faceAnchors = starIds.map(sid => {
      const indices = options.playerImageMap[sid] || [];
      const p = players[sid];
      const name = p.name;
      const anchor = p.identity_anchor || name;
      if (indices.length === 0) return `- ${name}: reproduce this person's face EXACTLY. ${anchor}.`;
      if (indices.length === 1) {
        return `- Reference image ${indices[0]}: CRITICAL FACE ANCHOR — ${name}. Distinctive features: ${anchor}. Reproduce this face EXACTLY — same skin tone, same hair, same facial bone structure. Do NOT alter or generalize these features.`;
      }
      return `- Reference images ${indices.join(' and ')}: BOTH show ${name} (same person) — ${anchor}. Reproduce this face EXACTLY.`;
    }).join('\n');
  } else {
    faceAnchors = starIds.map((sid, i) => {
      const p = players[sid];
      const anchor = p.identity_anchor || p.name;
      return `- Reference image ${playerOffset + i}: CRITICAL FACE ANCHOR — ${p.name}. Distinctive features: ${anchor}. Reproduce this face EXACTLY — same skin tone, same hair, same facial bone structure.`;
    }).join('\n');
  }

  // 注意：宽高比必须用中文写在 prompt 中，API 文档要求此格式
  // scene 2 (locker room) = sitting on bench；scene 1/4 = standing；scene 3 (Bernie) = 5 subjects
  const isLockerRoom = sceneId === '2';
  const openingLine = isScene4
    ? `Photorealistic group photo of exactly 5 subjects (3 football players + 1 fan + 1 bear mascot). Tall portrait orientation. Real photograph. No missing subjects, no one cut off. 图片长宽比4:5`
    : isLockerRoom
      ? `Photorealistic group photo of exactly 4 people SITTING CLOSELY SIDE-BY-SIDE on a bench. Tall portrait orientation. Real photograph. ALL people visible from head to feet — NO cropped bodies. No extra people, no missing people. 图片长宽比4:5`
      : `Photorealistic group photo of exactly 4 people standing CLOSE TOGETHER. Tall portrait orientation. Real photograph. ALL people visible full body from head to feet — NO cropped bodies, NO half-body framing. People stand close together, NOT far apart. No extra people, no missing people. 图片长宽比4:5`;

  const clothingCount = isScene4 ? '4 human adults' : '4 people';
  const qualityTag = isScene4
    ? `Photorealistic, sharp focus on all 5 subjects, 8K quality.`
    : `Photorealistic, sharp focus on all 4 faces, 8K quality.`;

  const peopleSection = isScene4
    ? buildPeopleSection5(starIds, userDescription, clothingTag, userImageCount)
    : buildPeopleSection(starIds, userDescription, clothingTag, userImageCount);

  // 精简模式：为有 prompt 长度限制的模型（如 Nano_Banana_Pro）生成优化 prompt
  // 结构: Subject > Clothing > Props > Faces > People > Setting > Action > Exclude
  if (options.compact) {
    const MAX_COMPACT = 3850; // 安全余量，低于4000字限制

    // 固定部分
    const header = `${openingLine}\n`;
    // 服装描述：显式声明忽略用户参考图中的服装
    const isBavarian = clothingTag && clothingTag.toLowerCase().includes('bavarian');
    const outfitOverride = isBavarian
      ? ''
      : 'CRITICAL: Ignore clothing in reference image 1. ALL people including the fan wear identical team kit — NO jeans, NO long pants, ONLY team shorts.\n';
    const jerseyIdx = options.jerseyImageIdx || 0;
    const jerseyRefLine = jerseyIdx > 0
      ? `JERSEY (MANDATORY): Reference image ${jerseyIdx} shows the EXACT jersey ALL people must wear. Copy this jersey design EXACTLY — same red color, same white stripe pattern, same white T logo, same crest position. Do NOT invent a different jersey. ALL 4 humans wear this IDENTICAL jersey.\n`
      : '';
    // clothingTag 只保留简短版本，不描述细节（让参考图主导）
    const shortClothingTag = clothingTag
      ? clothingTag.split('—')[0].trim()
      : (clothing.substring(0, 80) || 'FC Bayern Munich home kit');
    const outfit = `Outfit: ${shortClothingTag}. ALL people wear the EXACT same jersey — see reference image ${jerseyIdx > 0 ? jerseyIdx : ''}.\n${jerseyRefLine}${outfitOverride}`;

    // Props（啤酒杯等道具描述）
    const propsDesc = scene.beer_mug_description
      ? `Props: Each person holds ${scene.beer_mug_description.substring(0, 130)}.\n`
      : '';

    // Faces: 显式引用参考图（Gemini 最佳实践）
    const fanFaceRef = userImageCount === 1
      ? 'Keep Image 1 face EXACTLY for the fan — same eye size, eye shape, eye openness, do NOT make eyes smaller'
      : `Keep Image 1 through ${userImageCount} faces EXACTLY for the fan (same person) — same eye size, eye shape, eye openness, do NOT make eyes smaller`;
    const facesLine = `Faces: ${fanFaceRef}. ${starIds.map((sid, i) => `Image ${playerOffset + i} = ${players[sid].name} (${players[sid].identity_anchor || players[sid].name})`).join('. ')}.\n`;

    // 计算剩余字符预算
    const fixedLen = header.length + outfit.length + propsDesc.length + facesLine.length
      + peopleSection.length + 1 + qualityTag.length;
    const remaining = MAX_COMPACT - fixedLen;

    // 动态分配：30% environment，70% action
    const envBudget = Math.max(80, Math.min(300, Math.floor(remaining * 0.3)));
    const actionBudget = Math.max(200, remaining - envBudget - 22);

    // EXCLUDE 块（Gemini 模型用 EXCLUDE 替代 negative_prompt）
    const excludeTerms = isScene4
      ? ''
      : '\nEXCLUDE: extra people, bystanders, cartoon, illustration, blurry, distorted faces, oversized heads, disproportionate bodies.';

    const compactPrompt = `${header}${outfit}${propsDesc}${facesLine}${peopleSection}
Setting: ${environment.substring(0, envBudget)}.
Action: CAMERA: PERFECTLY STRAIGHT EYE-LEVEL shot — camera at face height, looking horizontally. NO downward tilt, NO overhead angle, NO bird's eye view. BODY PROPORTION RULE: All people must have realistic natural proportions — heads are proportional to bodies, NOT oversized. ${action.substring(0, actionBudget)}.
${qualityTag}${excludeTerms}`;

    console.log(`[PromptBuilder] compact prompt: ${compactPrompt.length} chars (env=${envBudget}, action=${actionBudget})`);
    const fs = require('fs');
    fs.writeFileSync(`/tmp/prompt_scene_${sceneId}.txt`, `[SCENE ${sceneId}] FULL COMPACT PROMPT (${compactPrompt.length} chars):\n${compactPrompt}\n`);
    console.log(`[PromptBuilder] Prompt written to /tmp/prompt_scene_${sceneId}.txt`);

    return {
      prompt: compactPrompt,
      player_names: playerNames,
      native_params: getNativeParams(sceneId),
    };
  }

  // 背景图引用（如果有背景参考图，在 SETTING 中显式引用 Image 索引）
  const bgIdx = options.backgroundImageIdx || 0;
  const settingLine = bgIdx > 0
    ? `SETTING (background MUST match reference image ${bgIdx} — reproduce the same room, walls, lockers, lighting, and atmosphere):\n${environment}`
    : `SETTING:\n${environment}`;

  const jerseyIdx = options.jerseyImageIdx || 0;
  const jerseyRefLine = jerseyIdx > 0
    ? ` JERSEY REFERENCE: Reference image ${jerseyIdx} shows the EXACT jersey — copy this jersey design precisely (color, stripes, logo, crest). ALL people wear this identical jersey.`
    : '';

  const prompt = `${openingLine}

CLOTHING (apply first — all ${clothingCount} wear identical outfits):
${clothing}${jerseyRefLine} Every human person wears this exact same outfit. Ignore any clothing visible in reference photos.

FACES:
${faceRule}

FACE REFERENCE MAPPING (strictly follow):
- ${userImageRef}
${faceAnchors}

${peopleSection}

${settingLine}

ACTION:
${action}

${qualityTag}`;

  return {
    prompt,
    player_names: playerNames,
    native_params: getNativeParams(sceneId),
  };
}

/**
 * 兼容旧嵌套结构的回退方法
 */
function buildLegacyEnvironment(scene) {
  if (!scene.environment || typeof scene.environment === 'string') return '';
  const e = scene.environment;
  return `${e.setting || ''}. ${e.background || ''}. ${e.details || ''}`;
}

function buildLegacyAttire(scene) {
  if (!scene.attire_rules) return '';
  return `${scene.attire_rules.players}. The fan wears ${scene.attire_rules.fan_adult}`;
}

function buildLegacyAction(scene) {
  if (!scene.action_and_props) return '';
  return scene.action_and_props.adult_mode;
}

module.exports = { buildAllPrompts, validateParams };
