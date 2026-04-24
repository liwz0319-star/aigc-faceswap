/**
 * 提示词生成效果测试脚本（扁平文本 Prompt 模式）
 * 用法: node test_prompt.js
 */

const { buildAllPrompts, validateParams } = require('./src/promptBuilder');

const testCases = [
  { starIds: ['1', '4', '7'], sceneId: '1', userMode: 'adult',  label: '场景1-啤酒节-成人' },
  { starIds: ['1', '4', '7'], sceneId: '1', userMode: 'child',  label: '场景1-啤酒节-儿童' },
  { starIds: ['3', '8', '10'], sceneId: '2', userMode: 'adult',  label: '场景2-更衣室-成人' },
  { starIds: ['3', '8', '10'], sceneId: '2', userMode: 'child',  label: '场景2-更衣室-儿童' },
  { starIds: ['7', '4', '1'], sceneId: '3', userMode: 'adult',  label: '场景3-冠军庆祝-成人' },
  { starIds: ['7', '4', '1'], sceneId: '3', userMode: 'child',  label: '场景3-冠军庆祝-儿童' },
  { starIds: ['6', '7', '8'], sceneId: '4', userMode: 'adult',  label: '场景4-吉祥物-成人' },
  { starIds: ['6', '7', '8'], sceneId: '4', userMode: 'child',  label: '场景4-吉祥物-儿童' },
];

const validationTests = [
  { starIds: ['1'],              sceneId: '1', userMode: 'adult', expectError: '恰好3个' },
  { starIds: ['1','2','3','4'],  sceneId: '1', userMode: 'adult', expectError: '恰好3个' },
  { starIds: ['1','1','2'],      sceneId: '1', userMode: 'adult', expectError: '重复' },
  { starIds: ['1','2','99'],     sceneId: '1', userMode: 'adult', expectError: '无效的 star_id' },
  { starIds: ['1','2','3'],      sceneId: '9', userMode: 'adult', expectError: '无效的 scene_id' },
  { starIds: ['1','2','3'],      sceneId: '1', userMode: 'teen',  expectError: 'adult 或 child' },
];

console.log('='.repeat(80));
console.log('  拜仁球迷合照 — 扁平文本 Prompt 测试');
console.log('='.repeat(80));

let passCount = 0;
let failCount = 0;

// ─── 1. 参数校验 ───
console.log('\n' + '─'.repeat(60));
console.log('  【一】参数校验');
console.log('─'.repeat(60));

for (const t of validationTests) {
  try {
    validateParams(t.starIds, t.sceneId, t.userMode);
    console.log(`  ✗ 未拦截: ${t.expectError}`);
    failCount++;
  } catch (err) {
    if (err.message.includes(t.expectError)) {
      console.log(`  ✓ ${err.message}`);
      passCount++;
    } else {
      console.log(`  ✗ 期望"${t.expectError}", 实际"${err.message}"`);
      failCount++;
    }
  }
}

// ─── 2. Prompt 文本输出 ───
console.log('\n' + '─'.repeat(60));
console.log('  【二】Prompt 文本输出');
console.log('─'.repeat(60));

const fanDesc = 'an Asian male in his 20s with short black hair';

for (const tc of testCases) {
  try {
    const { prompt, player_names } = buildAllPrompts(tc.starIds, tc.sceneId, tc.userMode, fanDesc);
    const overLimit = prompt.length > 2000;
    console.log(`\n  ${tc.label}`);
    console.log(`  球星: ${player_names.join(' / ')} | 字符: ${prompt.length} ${overLimit ? '✗ 超出2000' : '✓'}`);
    // 输出 prompt 关键段落
    const hasFaceRule = prompt.includes('CRITICAL FACE RULE');
    const hasPeople = prompt.includes('THE PEOPLE');
    const hasSetting = prompt.includes('SETTING');
    const hasClothing = prompt.includes('CLOTHING');
    const hasAction = prompt.includes('ACTION AND POSE');
    const hasQuality = prompt.includes('8K');
    console.log(`  结构: FACE_RULE=${hasFaceRule ? '✓' : '✗'} PEOPLE=${hasPeople ? '✓' : '✗'} SETTING=${hasSetting ? '✓' : '✗'} CLOTHING=${hasClothing ? '✓' : '✗'} ACTION=${hasAction ? '✓' : '✗'} 8K=${hasQuality ? '✓' : '✗'}`);

    if (hasFaceRule && hasPeople && hasSetting && hasClothing && hasAction && hasQuality) {
      passCount++;
    } else {
      failCount++;
    }
  } catch (err) {
    console.log(`  ✗ ${tc.label}: ${err.message}`);
    failCount++;
  }
}

// ─── 3. 结构完整性 ───
console.log('\n' + '─'.repeat(60));
console.log('  【三】结构完整性');
console.log('─'.repeat(60));

const { prompt: samplePrompt } = buildAllPrompts(['1','4','7'], '1', 'adult', fanDesc);

const checks = [
  { desc: '包含 CRITICAL FACE RULE',      fn: () => samplePrompt.includes('CRITICAL FACE RULE') },
  { desc: '包含 THE PEOPLE 段落',          fn: () => samplePrompt.includes('THE PEOPLE:') },
  { desc: '包含 3 个球员描述',             fn: () => {
    return samplePrompt.includes('Alphonso Davies') && samplePrompt.includes('Harry Kane') && samplePrompt.includes('Jamal Musiala');
  }},
  { desc: '包含球迷描述 (THE FAN)',        fn: () => samplePrompt.includes('THE FAN') },
  { desc: '包含 SETTING 段落',             fn: () => samplePrompt.includes('SETTING:') },
  { desc: '包含 CLOTHING 段落',            fn: () => samplePrompt.includes('CLOTHING:') },
  { desc: '包含 ACTION AND POSE 段落',     fn: () => samplePrompt.includes('ACTION AND POSE:') },
  { desc: '包含质量标签 8K',               fn: () => samplePrompt.includes('8K') },
  { desc: '包含 Photorealistic',           fn: () => samplePrompt.includes('Photorealistic') },
  { desc: '包含 reference image',          fn: () => samplePrompt.includes('reference image') },
];

for (const c of checks) {
  try {
    const ok = c.fn();
    console.log(`  ${ok ? '✓' : '✗'} ${c.desc}`);
    if (ok) passCount++; else failCount++;
  } catch {
    console.log(`  ✗ ${c.desc}`);
    failCount++;
  }
}

// ─── 4. 场景3 儿童安全 ───
console.log('\n' + '─'.repeat(60));
console.log('  【四】场景3 儿童安全');
console.log('─'.repeat(60));

try {
  const { prompt: p3child } = buildAllPrompts(['7','4','1'], '3', 'child', 'a young Asian boy aged 8 with short black hair');
  const lowerPrompt = p3child.toLowerCase();
  const actionSection = lowerPrompt.split('action and pose:')[1] || '';
  const hasBeer = actionSection.includes('beer');
  const hasConfetti = actionSection.includes('confetti');
  console.log(`  ${!hasBeer ? '✓' : '✗'} 儿童模式 action: ${!hasBeer ? '无' : '有'}beer`);
  console.log(`  ${hasConfetti ? '✓' : '✗'} 儿童模式 action: ${hasConfetti ? '有' : '无'}confetti`);
  if (!hasBeer) passCount++; else failCount++;
  if (hasConfetti) passCount++; else failCount++;
} catch (err) {
  console.log(`  ✗ ${err.message}`);
  failCount++;
}

// ─── 5. 场景3/4 新配置验证 ───
console.log('\n' + '─'.repeat(60));
console.log('  【五】新配置内容验证');
console.log('─'.repeat(60));

try {
  // 场景3 成人 - 拜仁主场球衣
  const { prompt: p3a } = buildAllPrompts(['7','4','1'], '3', 'adult', fanDesc);
  const hasJersey3a = p3a.includes('FC Bayern Munich home kit');
  console.log(`  ${hasJersey3a ? '✓' : '✗'} 场景3成人: 拜仁主场球衣`);
  if (hasJersey3a) passCount++; else failCount++;

  // 场景3 儿童 - 拜仁主场球衣
  const { prompt: p3c } = buildAllPrompts(['7','4','1'], '3', 'child', 'a young Asian boy');
  const hasJersey3c = p3c.includes('FC Bayern Munich home kit');
  console.log(`  ${hasJersey3c ? '✓' : '✗'} 场景3儿童: 拜仁主场球衣`);
  if (hasJersey3c) passCount++; else failCount++;

  // 场景4 成人 - 拜仁主场球衣
  const { prompt: p4a } = buildAllPrompts(['6','7','8'], '4', 'adult', fanDesc);
  const hasJersey4a = p4a.includes('FC Bayern Munich home kit');
  console.log(`  ${hasJersey4a ? '✓' : '✗'} 场景4成人: 拜仁主场球衣`);
  if (hasJersey4a) passCount++; else failCount++;

  // 场景4 儿童 - 拜仁主场球衣
  const { prompt: p4c } = buildAllPrompts(['6','7','8'], '4', 'child', 'a young Asian girl');
  const hasJersey4c = p4c.includes('FC Bayern Munich home kit');
  console.log(`  ${hasJersey4c ? '✓' : '✗'} 场景4儿童: 拜仁主场球衣`);
  if (hasJersey4c) passCount++; else failCount++;

  // 场景2/3/4 服装一致性
  const jerseyKit = 'FC Bayern Munich home kit';
  const s2 = buildAllPrompts(['1','2','3'], '2', 'adult', fanDesc).prompt.includes(jerseyKit);
  const s3 = buildAllPrompts(['1','2','3'], '3', 'adult', fanDesc).prompt.includes(jerseyKit);
  const s4 = buildAllPrompts(['1','2','3'], '4', 'adult', fanDesc).prompt.includes(jerseyKit);
  const allConsistent = s2 && s3 && s4;
  console.log(`  ${allConsistent ? '✓' : '✗'} 场景2/3/4成人服装一致: 拜仁主场球衣`);
  if (allConsistent) passCount++; else failCount++;
} catch (err) {
  console.log(`  ✗ ${err.message}`);
  failCount++;
}

// ─── 总结 ───
console.log('\n' + '='.repeat(80));
console.log(`  结果: ${passCount} 通过, ${failCount} 失败`);
console.log('='.repeat(80));
