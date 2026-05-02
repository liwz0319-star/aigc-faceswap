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

module.exports = {
  INPAINT_CONTROL_PROFILES,
  SCENE_CONFIGS,
};
