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

## 版本 5: 当前配置版本（v1.4 全面升级）

- 配置文件: [scene-configs/scene1.js](../../scene-configs/scene1.js)
- 共用 profile: `scene1_portrait`（[profiles.js](../../scene-configs/profiles.js)）
- 运行脚本: [test-faceswap-inpaint-scenes.js](../../test-faceswap-inpaint-scenes.js)
- 模式: `inpaint` + `post-composite`
- 关联 commit: 待提交

### 与版本 4 (v1.3) 的主要差异

1. **新增 `strength: 0.85`**: 控制 inpaint 强度
2. **新增 `preFillMask: true`**: 预填充 mask 区域，改善生成质量
3. **新增 `refNormalize: true`**: 参考图标准化处理
4. **prompt 大幅扩充**: 男版 7→17 条、女版 12→18 条，新增 Strict head size、Neck skin tone continuity、Neck depth coverage、Head proportion constraint、Hairstyle source lock、Short-hair fidelity、Realism lock 等
5. **negative terms 大幅扩充**: 男版 13→~50 条、女版 18→~50 条，新增 neck color seam、two-tone neck、oversized head 系列、invented hairstyle 系列、cartoon 全系列等
6. **refScale 调整**: 男版 0.30→0.34，女版 0.24→0.30
7. **mask 坐标调整**: apiCy 上移（832→812/810），domeH 扩大（93→126/101→128），feather 增大（11/12→30），neck 椭圆参数调整

### Scene 1 男

| 参数 | 值 |
|------|----|
| 底图 | `场景1男.jpg` |
| 尺寸 | 2048×2560 |
| guidance | 10 |
| strength | 0.85 |
| refScale | 0.34 |
| refAnchor | north |
| refOffsetY | 0.08 |
| refScaleCandidates | [0.34, 0.40] |
| includeOriginalReferenceFallback | true |
| validateHeadSwap | true |
| preFillMask | true |
| refNormalize | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 1140 | 844 | 136 | 230 | — | — |
| api (hairDome) | 1142 | 812 | 108 | 226 | domeH=126, expandX=10 | sideHair: 16×52 @ (56,112), neck: rx=66, ry=144 @ offsetY=200 |
| comp (hairDome) | 1142 | 814 | 160 | 318 | domeH=152, expandX=26 | sideHair: 28×68 @ (74,128), neck: rx=100, ry=188 @ offsetY=218, feather=30 |

**Prompt 要点** (extraPromptLines, 17 条):
- Strict head size, Compact portrait fit, Crown clearance, Hair side coverage
- Jaw completion, No mannequin carry-over, Single-head rule
- Neck edge clarity, Neck skin tone continuity, Neck depth coverage
- Head proportion constraint
- Background consistency
- Hairstyle source lock, Short-hair fidelity, Bang rule
- Close-selfie handling, Realism lock

**Negative terms** (~50 条):
- half face, cropped crown, top-clipped hair, side-clipped hair
- double face, residual mannequin head
- missing chin, blank mannequin neck, blurry neck
- dark head hole, black face void
- neck color seam, two-tone neck, neck skin tone jump, visible neck boundary line
- oversized head, giant head, head filling mask, head overflowing, head touching edge, wide head, broad face
- invented hairstyle, added hair length, extra hair volume, different hairstyle, invented bangs, bob from buzz cut
- cartoon/anime/cgi/doll/pixar/emoji face, oversized eyes, plastic skin, 3d render

### Scene 1 女

| 参数 | 值 |
|------|----|
| 底图 | `场景1女.jpg` |
| 尺寸 | 2048×2560 |
| guidance | 10 |
| strength | 0.85 |
| refScale | 0.30 |
| refAnchor | north |
| refOffsetY | 0.08 |
| refScaleCandidates | [0.30, 0.36] |
| refAlwaysSoftOval | true |
| validateHeadSwap | true |
| preFillMask | true |
| refNormalize | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 1140 | 846 | 131 | 226 | — | — |
| api (hairDome) | 1142 | 810 | 110 | 230 | domeH=128, expandX=12 | sideHair: 20×72 @ (62,122), neck: rx=68, ry=142 @ offsetY=200 |
| comp (hairDome) | 1142 | 814 | 164 | 332 | domeH=144, expandX=24 | sideHair: 30×100 @ (80,138), neck: rx=104, ry=184 @ offsetY=218, feather=30 |

**Prompt 要点** (extraPromptLines, 18 条):
- Strict head size, Compact portrait fit, Crown clearance, Hair side coverage
- Head proportion constraint
- Hairstyle source lock, Bang rule, Close-selfie handling
- Long-hair routing, Shoulder clearance
- Jaw completion, No mannequin carry-over, Single-head rule
- Neck edge clarity, Neck skin tone continuity, Neck depth coverage
- Background consistency, Realism lock

**Negative terms** (~50 条):
- half face, cropped crown, top-clipped hair, side-clipped hair
- double face, residual mannequin head
- invented bangs, ponytail from down hair, long hair over chest, hair covering beer glass
- blurry neck, missing chin, blank mannequin neck
- dark head hole, black face void, literal selfie crop, source image patch
- neck color seam, two-tone neck, neck skin tone jump, visible neck boundary line
- oversized head, giant head, head filling mask, head overflowing, wide head, broad face
- invented hairstyle, added hair length, extra hair volume, different hairstyle
- cartoon/anime/cgi/doll/pixar/emoji face, oversized eyes, plastic skin, 3d render

### 共用 profile (scene1_portrait)

| 参数 | 值 |
|------|----|
| promptLines | 4 条: Head swap framing, Head size lock, Realism lock, Neck blend |
| negativeTerms | 5 条: half face, cropped forehead/chin, off-center face, cartoon/anime/cgi/doll face, oversized eyes |

使用说明:

```powershell
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 1
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 1 --gender female --outdir "生成测试\新底图1"
```

回滚说明:

- 运行回滚: 指定 `--scene 1` 复跑当前配置即可。
- 代码回滚: `git checkout 78e9ce2 -- scene-configs/scene1.js scene-configs/profiles.js`
