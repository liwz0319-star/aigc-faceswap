/**
 * A/B测试配置 - Seedream 4.5 vs 5.0
 *
 * 使用方法：
 * - 设置环境变量 SEEDREAM_MODEL_VERSION=4.5 或 5.0
 * - 如果未设置，默认使用 AB_TEST_MODE=true 进行A/B测试
 * - A/B测试模式下，任务随机分配到4.5或5.0（50%/50%）
 */

// 环境变量指定的模型版本（固定模式）
const SPECIFIED_MODEL = process.env.SEEDREAM_MODEL_VERSION?.toLowerCase() || null;

// A/B测试模式开关
const AB_TEST_MODE = process.env.AB_TEST_MODE === 'true' || (!SPECIFIED_MODEL && process.env.AB_TEST_MODE !== 'false');

// A/B测试分配比例（4.5版本的概率）
const AB_TEST_RATIO_4_5 = parseFloat(process.env.AB_TEST_RATIO_4_5 || '0.5');

// 可用的模型版本
const MODEL_VERSIONS = {
  '4.5': 'doubao-seedream-4-5',
  '5.0': 'doubao-seedream-5-0-260128'
};

/**
 * 获取当前应该使用的模型版本
 * @param {string} taskId - 任务ID（用于随机种子，确保同一任务使用相同模型）
 * @returns {string} 模型版本 ('4.5' 或 '5.0')
 */
function getModelVersion(taskId) {
  // 如果指定了具体版本，直接返回
  if (SPECIFIED_MODEL) {
    if (SPECIFIED_MODEL === '4.5' || SPECIFIED_MODEL === '5.0') {
      return SPECIFIED_MODEL;
    }
    console.warn(`[AB测试] 无效的模型版本: ${SPECIFIED_MODEL}，使用默认值`);
    return '4.5';
  }

  // 如果不是A/B测试模式，默认使用4.5
  if (!AB_TEST_MODE) {
    return '4.5';
  }

  // A/B测试模式：随机分配
  // 使用taskId的哈希值作为随机种子，确保同一任务使用相同模型
  const hash = taskId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const probability = (hash % 100) / 100;

  const version = probability < AB_TEST_RATIO_4_5 ? '4.5' : '5.0';

  console.log(`[AB测试] 任务 ${taskId} 分配到 Seedream ${version} (概率: ${AB_TEST_RATIO_4_5})`);

  return version;
}

/**
 * 获取模型的API名称
 * @param {string} version - 模型版本 ('4.5' 或 '5.0')
 * @returns {string} API模型名称
 */
function getModelName(version) {
  return MODEL_VERSIONS[version] || MODEL_VERSIONS['4.5'];
}

/**
 * 检查是否在A/B测试模式
 */
function isABTestMode() {
  return AB_TEST_MODE;
}

/**
 * 获取A/B测试统计信息
 */
function getABTestInfo() {
  return {
    mode: AB_TEST_MODE ? 'A/B测试' : (SPECIFIED_MODEL ? `固定版本${SPECIFIED_MODEL}` : '默认4.5'),
    ratio_4_5: AB_TEST_RATIO_4_5,
    ratio_5_0: (1 - AB_TEST_RATIO_4_5).toFixed(2),
    specified_model: SPECIFIED_MODEL
  };
}

module.exports = {
  getModelVersion,
  getModelName,
  isABTestMode,
  getABTestInfo,
  MODEL_VERSIONS
};
