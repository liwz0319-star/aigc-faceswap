# Scene 1 Archive

## 场景定义

- 业务名: `scene1`
- 场景名: `Oktoberfest Gathering`

## 版本 1: 单场景 faceswap 模板版

- 脚本: [test-faceswap-scene1.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-scene1.js)
- 核心方式: 视觉模型识别性别和外貌后，按性别选择模板图，直接调用 `buildFaceswapPrompt()` + `generateNativeImage()`
- 主要输出目录: `生成测试/faceswap_output`
- 适用场景: 快速验证场景 1 的性别分模板 faceswap

使用说明:

```powershell
node .\test-faceswap-scene1.js
node .\test-faceswap-scene1.js "生成测试\照片\xxx.jpg"
node .\test-faceswap-scene1.js "生成测试\照片\xxx.jpg" --gender male
```

回滚说明:

- 运行回滚: 直接重新使用该脚本复跑。
- 代码回滚: 如果后续该文件被改坏，优先从 git 历史恢复 `test-faceswap-scene1.js`。

## 版本 2: 单场景 faceswap + RegionSync

- 脚本: [test-faceswap-scene1-regionsync.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-scene1-regionsync.js)
- 核心方式: 先跑整图 Seedream，再用 `regionComposer` 只把编辑区域贴回模板，模板外区域 100% 保留
- 依赖: `server/src/regionComposer.js`、`server/src/data/faceswapRegions.json`
- 主要输出目录: `生成测试/faceswap_output`

使用说明:

```powershell
node .\test-faceswap-scene1-regionsync.js
node .\test-faceswap-scene1-regionsync.js "生成测试\照片\xxx.jpg" --gender female
node .\test-faceswap-scene1-regionsync.js "生成测试\照片\xxx.jpg" --no-region-sync
```

回滚说明:

- 运行回滚: 关闭 `--no-region-sync` 可直接退回同脚本下的原始整图输出对比。
- 代码回滚: 需要同时回滚 `test-faceswap-scene1-regionsync.js` 和 `server/src/regionComposer.js`。

## 版本 3: 局部 refine 精修版

- 脚本: [test-faceswap-scene1-refine.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-scene1-refine.js)
- 核心方式: 以已生成结果图为底，裁局部区域，针对头发、身高、logo 做二次修复，再融合回原图
- 适用场景: 首轮生成接近可用，但局部存在明显缺陷时

使用说明:

```powershell
node .\test-faceswap-scene1-refine.js
node .\test-faceswap-scene1-refine.js "生成测试\faceswap_output\scene1_xxx.jpg" "生成测试\照片\xxx.jpg"
```

回滚说明:

- 运行回滚: 不使用该脚本，直接回到版本 1 或版本 2 的原图结果。
- 代码回滚: 只需回滚 `test-faceswap-scene1-refine.js`。

## 版本 4: 新底图批量 inpaint 版

- 脚本: [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js)
- 版本范围: 同一脚本覆盖 `scene1/scene2/scene4`
- `scene1` 角色: 新底图批量 inpaint
- 核心方式: `mask_image + inpainting + post-composite`
- 主要输出目录: 默认 `生成测试/inpaint_output`，也可 `--outdir` 指向其它目录

使用说明:

```powershell
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 1
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 1 --gender female --outdir "生成测试\新底图1"
```

回滚说明:

- 运行回滚: 指定 `--scene 1` 即可只跑场景 1。
- 代码回滚: 由于该脚本同时影响 `scene1/scene2/scene4`，回滚前要确认不会误伤其它场景。
