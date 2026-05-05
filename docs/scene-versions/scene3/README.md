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

## 版本 5: 当前配置版本（v1.4 inpaint + hairDome mask + neck ellipse 优化）

- 配置文件: [scene-configs/scene3.js](../../scene-configs/scene3.js)
- 运行脚本: [test-faceswap-inpaint-scenes.js](../../test-faceswap-inpaint-scenes.js)
- 调试工具: [tools/debug_mask_scene3.js](../../tools/debug_mask_scene3.js)
- 模式: `inpaint` + `post-composite`

### 与 v1.2 的主要差异

1. **新增 neck ellipse**: API mask 和 composite mask 底部各增加一个窄椭圆，延伸到领口以下 ~30-50px，让 AI 有足够空间生成平滑的脖子到领口肤色过渡
2. **refScale 调整**: 男版 0.36（保持不变），女版 0.28→0.30（小幅提升）
3. **feather 增大**: 12→18，让 mask 边缘渐变更柔和
4. **dome 扩大**: 男版 domeH 120→138（api）/ 128→148（comp）；女版 100→118 / 108→128
5. **新增 Hairstyle source lock 系列 prompt**: 锁定发型、短发保真、刘海规则、发态锁定
7. **新增 Neck-to-collar blend prompt**: 明确要求脖子到领口的平滑肤色过渡
8. **新增 Shoulder integrity prompt**: 保持原始肩膀线和球衣领口不变
9. **新增 validateHeadSwap 校验**: 自动验证换脸结果质量
10. **新增 neck/shoulder negative terms**: two-tone neck, neck color seam, ghost shoulder 等

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
| validateHeadSwap | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 934 | 280 | 214 | 394 | — | — |
| api (hairDome) | 934 | 260 | 190 | 362 | domeH=120, expandX=14 | sideHair: 18×60 @ (86,148), neck: rx=60, ry=58, offsetY=352 |
| comp (hairDome) | 934 | 264 | 236 | 406 | domeH=128, expandX=16 | sideHair: 22×74 @ (94,158), neck: rx=74, ry=70, offsetY=392, feather=18 |

**Prompt 要点** (extraPromptLines, ~22 条):
- Tunnel portrait fit, Head size lock, Template size lock, Center lock
- Vertical lock, Neck seat lock, Crown clearance
- Hairstyle source lock, Short-hair fidelity, Bang rule, Hair state lock
- Jaw completion, Full-head completion, Skin tone continuity
- Neck-to-collar blend, Shoulder integrity
- Close-selfie handling, Patch suppression, Background lock, Realism lock

**Negative terms** (~55 条):
- oversized/giant/bobblehead head, off-center/shifted head, floating head
- cropped crown, missing chin, melted lower face, blank mannequin neck
- face inside jersey, dark head hole, black face void
- invented/changed hairstyle, invented bangs, bob from buzz cut
- tied-up from loose source, cartoon/anime/cgi/doll face
- source photo corner/background, visible square crop edge
- two-tone neck, neck color seam, ghost shoulder, duplicate shoulder

### Scene 3 女

| 参数 | 值 |
|------|----|
| 底图 | `场景3.jpg` |
| 尺寸 | 2560×1536（横版） |
| guidance | 10 |
| refScale | 0.26 |
| refAnchor | north |
| refOffsetY | 0.04 |
| refCrop | width=0.72, height=0.88, offsetX=0.5, anchor=north, offsetY=0.0 |
| refAlwaysSoftOval | true |
| refSoftOvalOnFlatBackground | true |
| validateHeadSwap | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 934 | 298 | 198 | 356 | — | — |
| api (hairDome) | 934 | 268 | 188 | 356 | domeH=96, expandX=12 | sideHair: 22×72 @ (88,158), neck: rx=56, ry=60, offsetY=335 |
| comp (hairDome) | 934 | 272 | 232 | 398 | domeH=104, expandX=14 | sideHair: 26×88 @ (96,174), neck: rx=68, ry=68, offsetY=365, feather=18 |

**Prompt 要点** (extraPromptLines, ~15 条):
- Tunnel portrait fit, Female head scale, Center lock, Vertical lock
- Crown clearance, Hairstyle source lock, Bang rule, Hair state lock
- Long-hair routing, Close-selfie handling, Full-head completion
- Jaw completion, Skin tone continuity, Neck-to-collar blend
- Shoulder integrity, Patch suppression, Background lock, Realism lock

**Negative terms** (~35 条):
- oversized female head, bobblehead proportions, cropped crown
- missing chin, melted lower face, blank mannequin neck
- literal selfie crop, stiff side hair strip
- invented bangs, tied-up from loose source, invented hairstyle
- dark head hole, black face void
- source photo background, indoor wall patch
- long hair over front jersey, cartoon/anime/cgi/doll face
- two-tone neck, neck color seam, ghost shoulder, duplicate shoulder

使用说明:

```powershell
# 正常生成
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 3
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 3 --gender female --outdir "生成测试\scene3_check"

# 调试 mask 位置可视化
node tools\debug_mask_scene3.js          # 男女都生成
node tools\debug_mask_scene3.js male     # 仅男版
```

回滚说明:

- 运行回滚: 指定 `--scene 3` 复跑当前配置即可。
- 代码回滚: `git checkout 90e2519 -- scene-configs/scene3.js`（回退到 v1.2）
