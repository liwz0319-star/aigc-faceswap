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

## 版本 5: 当前配置版本（v1.2 inpaint + hairDome mask 优化）

- 配置文件: [scene-configs/scene3.js](../../scene-configs/scene3.js)
- 运行脚本: [test-faceswap-inpaint-scenes.js](../../test-faceswap-inpaint-scenes.js)
- 模式: `inpaint` + `post-composite`
- 关联 commit: v1.2 变更（包含在 `90e2519` 中）

### 与版本 4 的主要差异

1. **从 faceswap-composite 回退为 inpaint**: faceswap-composite 模式导致背景色彩偏移、AI 水印残留、脖子两截色三个问题，回退 inpaint 后 AI 能看到 mask 外原始像素并主动匹配
2. **mask 从矩形改为 hairDome**: 贴合头冠弧度，覆盖更完整（男版新增 domeH=120/128）
3. **女版 refScale 增大 40%**: 0.20→0.28，改善面部生成质量
4. **prompt 精简**: 男版 10→12 条（新增 jaw/skin tone），女版 20→12 条
5. **新增 skin tone continuity prompt**: 防止脖子与肩膀两截色
6. **新增 negative terms**: missing chin, melted lower face, dark head hole, black face void 等

### Scene 3 男

| 参数 | 值 |
|------|----|
| 底图 | `场景3.jpg` |
| 尺寸 | 2560×1536（横版） |
| guidance | 10 |
| refScale | 0.36 |
| refAnchor | north |
| refOffsetY | 0.05 |
| refSoftOvalOnFlatBackground | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 934 | 280 | 214 | 394 | — | — |
| api (hairDome) | 934 | 260 | 190 | 362 | domeH=120, expandX=14 | sideHair: 18×60 @ (86,148) |
| comp (hairDome) | 934 | 264 | 236 | 406 | domeH=128, expandX=16 | sideHair: 22×74 @ (94,158), feather=12 |

**Prompt 要点** (extraPromptLines, 12 条):
- Tunnel portrait fit, Head size lock, Template size lock
- Center lock, Vertical lock, Neck seat lock, Crown clearance
- Jaw completion, Full-head completion, Skin tone continuity
- Patch suppression, Background lock

**Negative terms** (~20 条):
- oversized/giant/bobblehead head, off-center/shifted head
- cropped crown, missing chin, melted lower face, blank mannequin neck
- face inside jersey, dark head hole, black face void
- source photo corner/background, cartoon/anime/cgi/doll face

### Scene 3 女

| 参数 | 值 |
|------|----|
| 底图 | `场景3.jpg` |
| 尺寸 | 2560×1536（横版） |
| guidance | 10 |
| refScale | 0.28 |
| refAnchor | north |
| refOffsetY | 0.04 |
| refCrop | width=0.72, height=0.88, offsetX=0.5, anchor=north, offsetY=0.0 |
| refAlwaysSoftOval | true |
| refSoftOvalOnFlatBackground | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 934 | 298 | 202 | 404 | — | — |
| api (hairDome) | 934 | 274 | 194 | 390 | domeH=100, expandX=12 | sideHair: 20×68 @ (90,164) |
| comp (hairDome) | 934 | 278 | 236 | 434 | domeH=108, expandX=14 | sideHair: 24×84 @ (98,184), feather=12 |

**Prompt 要点** (extraPromptLines, 12 条):
- Tunnel portrait fit, Female head scale, Center lock, Vertical lock
- Crown clearance, Hairstyle source lock, Long-hair routing
- Full-head completion, Jaw completion, Skin tone continuity
- Patch suppression, Background lock

**Negative terms** (~15 条):
- oversized female head, bobblehead proportions, cropped crown
- missing chin, melted lower face, blank mannequin neck
- literal selfie crop, stiff side hair strip
- dark head hole, black face void
- source photo background, indoor wall patch
- long hair over front jersey, cartoon/anime/cgi/doll face

使用说明:

```powershell
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 3
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 3 --gender female --outdir "生成测试\scene3_check"
```

回滚说明:

- 运行回滚: 指定 `--scene 3` 复跑当前配置即可。
- 代码回滚: `git checkout 90e2519 -- scene-configs/scene3.js`
