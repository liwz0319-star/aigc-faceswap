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

## 版本 6: 当前配置版本（v1.0 基线 + hairDome mask）

- 配置文件: [scene-configs/scene2.js](../../scene-configs/scene2.js)
- 运行脚本: [test-faceswap-inpaint-scenes.js](../../test-faceswap-inpaint-scenes.js)
- 模式: `inpaint` + `post-composite`
- 关联 commit: `871299d` ~ `0efb202`（v1.0 基线）

### 与版本 4 的主要差异

1. **男版**: 参数基本不变，仍为矩形 mask + inpaint，无 refScale（使用完整参考图）
2. **女版**: 新增 `hairDome` mask 形状，带 sideHair 覆盖长发；新增精细 prompt（18 条）和 negative terms（~40 条）

### Scene 2 男

| 参数 | 值 |
|------|----|
| 底图 | `场景2.png` |
| 尺寸 | 2048×2560 |
| guidance | 10 |
| refScale | 无（直接使用完整参考图） |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 附加 |
|------|----|----|---|---|------|
| 基础 | 360 | 174 | 162 | 236 | — |
| api | 360 | 158 | 128 | 228 | — |
| comp | 360 | 174 | 162 | 236 | solidTopH=68 |

### Scene 2 女

| 参数 | 值 |
|------|----|
| 底图 | `场景2.png` |
| 尺寸 | 2048×2560 |
| guidance | 10 |
| refScale | 0.30 |
| refAnchor | north |
| refOffsetY | 0.06 |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 360 | 158 | 150 | 246 | — | — |
| api (hairDome) | 394 | 134 | 196 | 218 | domeH=82, expandX=16 | sideHair: 24×58 @ (78,138) |
| comp (hairDome) | 396 | 146 | 220 | 248 | domeH=92, expandX=20 | sideHair: 30×74 @ (86,150), feather=10 |

**Prompt 要点** (extraPromptLines, 18 条):
- Flag portrait fit, Female head scale, Center lock, Vertical lock, Crown clearance
- Hairstyle source lock, Bang rule, Hair state lock
- Close-selfie handling, Full-head completion, Realism lock
- Jersey preservation, Shoulder protection
- Long-hair routing, Right-ear visibility, Hair silhouette, Right-side coverage
- Patch suppression, Background lock

**Negative terms** (~40 条):
- oversized/giant head, off-center/shifted head, cropped crown
- invented bangs/curtain bangs, tied-up from loose source
- cartoon/avatar/doll/cgi face
- missing right ear, missing right-side hair
- literal selfie crop, source image patch
- face inside flag, hair curtain over flag
- altered jersey collar, source photo background/corner

使用说明:

```powershell
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 2
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 2 --gender female --outdir "生成测试\新底图2"
```

回滚说明:

- 运行回滚: 指定 `--scene 2` 复跑当前配置即可。
- 代码回滚: `git checkout 0efb202 -- scene-configs/scene2.js`
