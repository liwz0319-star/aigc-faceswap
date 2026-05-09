const fs = require('node:fs');
const path = require('node:path');

const PROJECT_DIR = path.resolve(__dirname, '..');
const SCENES_DIR = path.join(PROJECT_DIR, 'scenes');

function loadSceneConfig(sceneId) {
  const safeId = String(sceneId || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(safeId)) {
    throw new Error(`无效场景 ID: ${sceneId}`);
  }

  const configPath = path.join(SCENES_DIR, `${safeId}.json`);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  validateSceneConfig(config, configPath);
  return config;
}

function validateSceneConfig(config, configPath) {
  for (const key of ['id', 'base', 'target', 'targetDetail', 'protectedPerson']) {
    if (!config[key]) throw new Error(`${configPath} 缺少字段: ${key}`);
  }
  if (config.syncBaseOutsideTarget !== true) {
    throw new Error(`${configPath} 必须启用 syncBaseOutsideTarget`);
  }
  if (!Array.isArray(config.editRegions) || config.editRegions.length === 0) {
    throw new Error(`${configPath} 必须配置 editRegions`);
  }
  if (config.finalOutputStage && !['stage_b'].includes(config.finalOutputStage)) {
    throw new Error(`${configPath} finalOutputStage 仅支持 stage_b`);
  }
}

function buildRunDemoArgv(config, options = {}) {
  const argv = [];
  const outputStageOnly = config.finalOutputStage === 'stage_b';
  const composeRegions = config.finalRegions || config.editRegions;
  if (options.execute) argv.push('--execute');
  if (options.env) argv.push('--env', options.env);
  argv.push('--base', path.resolve(PROJECT_DIR, config.base));
  if (options.user) argv.push('--user', options.user);
  for (const referenceImage of config.referenceImages || []) {
    argv.push('--reference-image', path.resolve(PROJECT_DIR, referenceImage));
  }
  argv.push(
    '--target', config.target,
    '--target-detail', config.targetDetail,
    '--protected-person', config.protectedPerson
  );
  if (outputStageOnly) {
    argv.push('--final-output-stage', config.finalOutputStage);
  } else if (config.syncBaseOutsideTarget) {
    argv.push('--sync-base-outside-target');
    for (const region of composeRegions) {
      argv.push('--edit-region', formatRegion(region));
    }
  }
  if (!outputStageOnly && config.generatedCrop) {
    argv.push('--generated-crop', formatCrop(config.generatedCrop));
  }
  if (config.strictBrandQc) argv.push('--strict-brand-qc');
  for (const region of outputStageOnly ? [] : config.protectedRegions || []) {
    argv.push('--protect-region', formatRegion(region));
  }
  for (const region of outputStageOnly ? [] : config.highlightOcclusionRegions || []) {
    argv.push('--highlight-occlusion-region', formatRegion(region));
  }
  if (!outputStageOnly && config.outputCrop) {
    argv.push('--output-crop', formatCrop(config.outputCrop));
  }
  return argv;
}

function formatRegion(region) {
  const prefix = region.id ? `${region.id}:` : '';
  const coords = [region.x, region.y, region.width, region.height];
  if (region.feather) coords.push(region.feather);
  if (region.shape) coords.push(region.shape);
  return `${prefix}${coords.join(',')}`;
}

function formatCrop(crop) {
  const prefix = crop.id ? `${crop.id}:` : '';
  const coords = [crop.x, crop.y, crop.width, crop.height];
  if (crop.outWidth || crop.outHeight) coords.push(crop.outWidth, crop.outHeight);
  return `${prefix}${coords.join(',')}`;
}

module.exports = {
  buildRunDemoArgv,
  loadSceneConfig,
};
