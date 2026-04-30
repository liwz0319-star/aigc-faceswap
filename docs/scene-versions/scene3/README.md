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
