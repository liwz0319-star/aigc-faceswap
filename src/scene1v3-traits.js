'use strict';

const { detectUserTraits, loadTraitsCache, validateTraits } = require('./trait-detector');

const TRAITS_SOURCE_CACHE = 'cache';
const TRAITS_SOURCE_LLM = 'llm';
const VALID_TRAITS_SOURCES = new Set([TRAITS_SOURCE_CACHE, TRAITS_SOURCE_LLM]);

function normalizeTraitsSource(source) {
  const normalized = String(source || TRAITS_SOURCE_CACHE).trim().toLowerCase();
  if (!VALID_TRAITS_SOURCES.has(normalized)) {
    throw new Error(`Invalid traits source: ${source}; expected cache or llm`);
  }
  return normalized;
}

async function resolveScene6TraitsForUsers(users, {
  source = TRAITS_SOURCE_CACHE,
  cacheFile,
  detector = detectUserTraits,
} = {}) {
  const normalizedSource = normalizeTraitsSource(source);
  if (normalizedSource === TRAITS_SOURCE_LLM) {
    return resolveTraitsFromLlm(users, detector);
  }
  return resolveTraitsFromCache(users, cacheFile);
}

async function resolveTraitsFromCache(users, cacheFile) {
  if (!cacheFile) throw new Error('Traits cache file is required when traits source is cache');
  const cache = await loadTraitsCache(cacheFile);
  const missing = [];
  const traitsMap = {};
  for (const user of users) {
    if (!cache[user.id]) {
      missing.push(user.id);
      continue;
    }
    traitsMap[user.id] = validateTraits(cache[user.id]);
  }
  if (missing.length > 0) {
    throw new Error(
      `Traits cache missing users: ${missing.join(', ')} in ${cacheFile}. ` +
      'Use --traits-source llm for production uploads or update the test cache.'
    );
  }
  return traitsMap;
}

async function resolveTraitsFromLlm(users, detector) {
  const traitsMap = {};
  for (const user of users) {
    traitsMap[user.id] = validateTraits(await detector(user.sourcePath));
  }
  return traitsMap;
}

function resolveScene1v3SceneId(defaultSceneId, traits) {
  if (defaultSceneId === 'scene1v3') {
    return traits?.gender === 'female' ? 'scene1v3_female' : 'scene1v3_male';
  }
  return defaultSceneId;
}

function traitsHasNoEyewear(traits) {
  return traits?.eyewear === 'none' || traits?.eyewear === 'no_glasses';
}

function traitsHasEyewear(traits) {
  return ['glasses', 'sunglasses', 'wears_glasses'].includes(traits?.eyewear);
}

function eyewearDescription(traits) {
  return traits?.eyewear_description ? ` (${traits.eyewear_description})` : '';
}

module.exports = {
  TRAITS_SOURCE_CACHE,
  TRAITS_SOURCE_LLM,
  normalizeTraitsSource,
  resolveScene6TraitsForUsers,
  resolveScene1v3SceneId,
  traitsHasNoEyewear,
  traitsHasEyewear,
  eyewearDescription,
};
