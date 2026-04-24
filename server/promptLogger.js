/**
 * promptLogger.js — 提示词记录工具
 *
 * 将每次测试的完整提示词保存为 Markdown 文件，便于审查和调试。
 *
 * 输出路径：生成测试/prompt-logs/YYYYMMDD_HHMMSS_<stars>_<mode>.md
 * 用法：
 *   const { savePromptLog } = require('./promptLogger');
 *   savePromptLog({ mode, starIds, starNames, scenes, promptMap, outputDir });
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '..', '生成测试', 'prompt-logs');

/**
 * 保存提示词记录
 *
 * @param {Object} opts
 * @param {string}   opts.mode        - 'relay' | 'native'
 * @param {string[]} opts.starIds     - 外部球星ID，如 ['101','103','105']
 * @param {string[]} opts.starNames   - 球星名称，如 ['Alphonso Davies', ...]
 * @param {string[]} opts.userPhotos  - 用户照片文件名数组
 * @param {Object}   opts.promptMap   - { sceneExtId: { prompt, player_names, ...extra } }
 * @param {string}  [opts.outputDir]  - 测试输出目录（写入 README 用）
 * @returns {string} 保存的文件路径
 */
function savePromptLog({ mode, starIds, starNames, userPhotos, promptMap, outputDir }) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const starsSlug = (starIds || []).join('-');
  const filename = `${ts}_stars${starsSlug}_${mode}.md`;
  const filePath = path.join(LOG_DIR, filename);

  const lines = [];

  // ─── 文件头 ───
  lines.push(`# 提示词记录`);
  lines.push('');
  lines.push(`| 字段 | 值 |`);
  lines.push(`|------|----|`);
  lines.push(`| 时间 | ${now.toLocaleString()} |`);
  lines.push(`| 模式 | ${mode} |`);
  lines.push(`| 球星ID | ${(starIds || []).join(', ')} |`);
  lines.push(`| 球星名 | ${(starNames || []).join(' / ')} |`);
  lines.push(`| 用户照片 | ${(userPhotos || []).map(p => path.basename(p)).join('<br>')} |`);
  if (outputDir) lines.push(`| 输出目录 | \`${outputDir}\` |`);
  lines.push('');

  // ─── 参考图说明（relay 模式专用） ───
  if (mode === 'relay' && promptMap) {
    const firstEntry = Object.values(promptMap)[0];
    const userCount = (userPhotos || []).length;
    const starCount = (starNames || []).length;
    lines.push('## 参考图顺序（relay 模式）');
    lines.push('');
    for (let i = 1; i <= userCount; i++) {
      lines.push(`- Image ${i}：用户照片 ${path.basename((userPhotos || [])[i - 1] || '')}`);
    }
    for (let j = 0; j < starCount; j++) {
      lines.push(`- Image ${userCount + 1 + j}：${(starNames || [])[j]} 参考图`);
    }
    const bgIdx = firstEntry?.bgIdx;
    if (bgIdx) lines.push(`- Image ${bgIdx}：场景背景参考图`);
    lines.push('');
  }

  // ─── 各场景提示词 ───
  lines.push('## 各场景提示词');
  lines.push('');

  if (!promptMap || Object.keys(promptMap).length === 0) {
    lines.push('_（无提示词数据，服务端生成）_');
  } else {
    for (const [sceneId, entry] of Object.entries(promptMap)) {
      const { prompt, player_names, bgIdx, jerseyIdx } = entry;
      lines.push(`### ${sceneId}`);
      lines.push('');
      lines.push(`- 球星：${(player_names || []).join(' / ')}`);
      lines.push(`- 字符数：${(prompt || '').length}`);
      if (bgIdx !== undefined) lines.push(`- bgIdx=${bgIdx}  jerseyIdx=${jerseyIdx ?? 0}`);
      lines.push('');
      lines.push('```');
      lines.push(prompt || '(无)');
      lines.push('```');
      lines.push('');
    }
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

module.exports = { savePromptLog, LOG_DIR };
