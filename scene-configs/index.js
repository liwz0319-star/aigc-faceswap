const INPAINT_CONTROL_PROFILES = require('./profiles');
const scene1 = require('./scene1');
const scene2 = require('./scene2');
const scene3 = require('./scene3');
const scene4 = require('./scene4');

const SCENE_CONFIGS = {
  '1': scene1,
  '2': scene2,
  '3': scene3,
  '4': scene4,
};

// scene1v3 独立 pipeline 配置（mask-inpainting + LLM审核）
// 通过 scripts/run-scene1-v3.js 和 scripts/run-scene1-v3-full.js 运行
const SCENE1_V3_PIPELINE = scene1.v3 || null;
module.exports = {
  INPAINT_CONTROL_PROFILES,
  SCENE_CONFIGS,
  SCENE1_V3_PIPELINE,
};
