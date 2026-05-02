# Scene 3 Archive

## 场景定义

- 业务名: `scene3`
- 场景名: `Bernie Mascot Interaction`

## 版本 1: 单场景 faceswap native 版

- 脚本: [test-faceswap-scene3.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-scene3.js)
- 核心方式: 按性别选模板，走 `buildFaceswapPrompt()`，直接 native 生成
- 主要输出目录: `生成测试/faceswap_output`
- 特点: 带 `compositionNote`、`poseNote`、`backgroundNote`

使用说明:

```powershell
node .\test-faceswap-scene3.js
node .\test-faceswap-scene3.js "生成测试\照片\xxx.jpg" --gender male
```

回滚说明:

- 运行回滚: 直接用该脚本复跑即可。
- 代码回滚: 恢复 `test-faceswap-scene3.js`。

## 版本 2: faceswap + RegionSync 版

- 脚本: [test-faceswap-scene3-regionsync.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-scene3-regionsync.js)
- 核心方式: 先整图生成，再把 edit region 回贴模板
- 主要输出目录: `生成测试/faceswap_output`
- 特点: 去掉额外的背景恢复步骤，直接依赖模板保住 PAULANER 横幅

使用说明:

```powershell
node .\test-faceswap-scene3-regionsync.js
node .\test-faceswap-scene3-regionsync.js "生成测试\照片\xxx.jpg" --shrink
node .\test-faceswap-scene3-regionsync.js "生成测试\照片\xxx.jpg" --no-region-sync
```

回滚说明:

- 运行回滚: 对照 `--no-region-sync` 输出和 `final` 输出判断是否需要回退。
- 代码回滚: 恢复 `test-faceswap-scene3-regionsync.js`，必要时连同 `server/src/regionComposer.js` 一起回退。

## 版本 3: 单场景 inpaint mask 版

- 脚本: [test-faceswap-scene3-inpaint.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-scene3-inpaint.js)
- 核心方式: 按性别选模板和 mask，走 inpainting
- 主要输出目录: `生成测试/faceswap_output`
- 适用场景: 只针对场景 3 做点位式面部替换

使用说明:

```powershell
node .\test-faceswap-scene3-inpaint.js
node .\test-faceswap-scene3-inpaint.js "生成测试\照片\xxx.jpg" --gender female
```

回滚说明:

- 运行回滚: 直接重新跑该脚本。
- 代码回滚: 恢复 `test-faceswap-scene3-inpaint.js`。

## 版本 4: 新底图批量 inpaint 初始接入版

- 脚本: [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js)
- 场景入口: `SCENE_CONFIGS['3']`
- 底图: `素材/新场景底图/场景3.png`
- 核心方式: 新底图单人模板，走 `split-mask inpaint + post-composite`
- 输出尺寸: `2560x1536`
- 当前 split-mask:
  - male: `cx=1050, cy=314, w=214, h=286`
  - male API: `apiCx=1050, apiCy=296, apiW=182, apiH=268`
  - male composite: `compCx=1050, compCy=320, compW=222, compH=292, compSolidTopH=92`
  - female: `cx=1050, cy=314, w=202, h=274`
  - female API: `apiCx=1050, apiCy=296, apiW=170, apiH=256`
  - female composite: `compCx=1050, compCy=320, compW=210, compH=280, compSolidTopH=88`
- 主要输出目录: 默认 `生成测试/inpaint_output`

使用说明:

```powershell
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 3
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 3 --gender female --outdir "生成测试\scene3_check"
```

回滚说明:

- 运行回滚: 直接指定 `--scene 3` 复跑当前版本。
- 代码回滚: 如果后续继续调坏，优先恢复 [current-flow-2026-05-01.md](F:\AAA Work\AIproject\demo\球星球迷合照\docs\scene-versions\current-flow-2026-05-01.md) 对应提交里的 `test-faceswap-inpaint-scenes.js`。
