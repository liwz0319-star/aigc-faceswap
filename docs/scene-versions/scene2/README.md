# Scene 2 Archive

## 场景定义

- 业务名: `scene2`
- 场景名: `Locker Room Celebration`

## 版本 1: 单场景 inpaint mask 版

- 脚本: [test-faceswap-scene2.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-scene2.js)
- 核心方式: 按性别选择模板，生成精确脸部 mask，调用 inpainting，仅修改 mask 区域
- 主要输出目录: `生成测试/场景2测试2`
- 适用场景: 早期单场景场景 2 面部精确替换

使用说明:

```powershell
node .\test-faceswap-scene2.js
node .\test-faceswap-scene2.js "生成测试\照片\xxx.jpg" --gender male
```

回滚说明:

- 运行回滚: 直接重新使用该脚本复跑。
- 代码回滚: 恢复 `test-faceswap-scene2.js` 即可。

## 版本 2: prompt 引导 i2i 版

- 脚本: [test-faceswap-scene2-prompt.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-scene2-prompt.js)
- 核心方式: 不走 mask，改成 prompt 引导的 i2i，再叠加 `composeEditRegionsOverBase`
- 主要输出目录: `生成测试/场景2测试13`
- 适用场景: 想测试“纯 prompt 改头”而不是“mask 定点换头”

使用说明:

```powershell
node .\test-faceswap-scene2-prompt.js
node .\test-faceswap-scene2-prompt.js "生成测试\照片\xxx.jpg" --gender female
```

回滚说明:

- 运行回滚: 直接退回版本 1 或版本 3。
- 代码回滚: 恢复 `test-faceswap-scene2-prompt.js`。

## 版本 3: faceswap + RegionSync 版

- 脚本: [test-faceswap-scene2-regionsync.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-scene2-regionsync.js)
- 核心方式: 整图生成后，用 `faceswapRegions.json` 配置的 edit region 回贴模板
- 主要输出目录: `生成测试/场景2测试1`
- 适用场景: 锁更衣室背景、PAULANER logo 和其他球员不变

使用说明:

```powershell
node .\test-faceswap-scene2-regionsync.js
node .\test-faceswap-scene2-regionsync.js "生成测试\照片\xxx.jpg" --strength 0.5
node .\test-faceswap-scene2-regionsync.js "生成测试\照片\xxx.jpg" --no-region-sync
```

回滚说明:

- 运行回滚: 用 `--no-region-sync` 先对比裸 Seedream 输出。
- 代码回滚: 需要一起关注 `test-faceswap-scene2-regionsync.js`、`server/src/regionComposer.js`、`server/src/data/faceswapRegions.json`。

## 版本 4: 新底图批量 inpaint 旧版恢复版

- 脚本: [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js)
- 当前状态: 已恢复到你指定的旧版工作流
- 关联说明: [scene2_inpaint_M_5fe55765_1777451788653_旧版工作流.md](F:\AAA Work\AIproject\demo\球星球迷合照\生成测试\新底图3\scene2_inpaint_M_5fe55765_1777451788653_旧版工作流.md)
- 关键 commit:
  - `9a4703e` `restore old scene2 inpaint workflow`
  - `2f37d28` `add restored workflow notes`

核心方式:

- 使用新底图 `场景2.jpg`
- 构建矩形 mask
- 调用 native inpainting 接口
- 下载 AI 结果
- 用 feather 后的合成 mask 只保留头部区域
- 再覆盖回底图

使用说明:

```powershell
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\5fe55765165278b200197663a336e3dd.jpg" --scene 2 --gender male --outdir "生成测试\新底图3"
```

回滚说明:

- 运行回滚: 这是当前推荐的旧版回滚入口。
- 代码回滚:

```powershell
git checkout 9a4703e -- test-faceswap-inpaint-scenes.js
git checkout 2f37d28 -- "生成测试/新底图3/scene2_inpaint_M_5fe55765_1777451788653_旧版工作流.md"
```

- 如果只是想恢复该版本脚本，不需要动其它文件。

## 版本 5: 新底图纯 faceswap 实验版

- 脚本: [test-faceswap-new-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-new-scenes.js)
- 核心方式: 直接对新底图做 faceswap，不走 inpaint/post-composite
- 主要输出目录: `生成测试/new_scenes_output`
- 状态: 实验线，适合和版本 4 做对比，不建议当主交付线

使用说明:

```powershell
node .\test-faceswap-new-scenes.js "生成测试\照片\xxx.jpg" --scene 2
```

回滚说明:

- 运行回滚: 直接用该脚本独立复跑，不影响版本 4。
- 代码回滚: 恢复 `test-faceswap-new-scenes.js`。
