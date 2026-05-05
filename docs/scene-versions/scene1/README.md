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

## 版本 5: 当前配置版本（v1.1+ 迭代优化）

- 配置文件: [scene-configs/scene1.js](../../scene-configs/scene1.js)
- 共用 profile: `scene1_portrait`（[profiles.js](../../scene-configs/profiles.js)）
- 运行脚本: [test-faceswap-inpaint-scenes.js](../../test-faceswap-inpaint-scenes.js)
- 模式: `inpaint` + `post-composite`
- 关联 commit: `90e2519` 及后续迭代

### 与版本 4 的主要差异

1. **mask 从矩形改为 hairDome + neck 覆盖**: 新增 `apiNeckRx/apiNeckRy` 参数，贴合颈线，避免裁切
2. **大幅精简 prompt/negative terms**: 男版 17→7 条 prompt，~40→13 条 negative；女版 30→12 条 prompt，~55→18 条 negative
3. **refScale 收紧**: 男版 0.38→0.30，女版 0.30→0.24，减小参考图比例避免头部过大
4. **scene1_portrait profile 精简**: 去除适得其反的 skin transition prompt，7→4 条

### Scene 1 男

| 参数 | 值 |
|------|----|
| 底图 | `场景1男.jpg` |
| 尺寸 | 2048×2560 |
| guidance | 10 |
| refScale | 0.30 |
| refAnchor | north |
| refOffsetY | 0.08 |
| refScaleCandidates | [0.30, 0.36] |
| includeOriginalReferenceFallback | true |
| validateHeadSwap | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 1140 | 844 | 136 | 230 | — | — |
| api (hairDome) | 1142 | 832 | 144 | 253 | domeH=93, expandX=13 | sideHair: 18×50 @ (67,118), neck: rx=112, ry=136 @ offsetY=176 |
| comp (hairDome) | 1142 | 840 | 163 | 270 | domeH=99, expandX=16 | sideHair: 22×62 @ (74,128), neck: rx=128, ry=152 @ offsetY=184, feather=11 |

**Prompt 要点** (extraPromptLines, 7 条):
- Compact portrait fit, Crown clearance
- Jaw completion, No mannequin carry-over
- Single-head rule, Neck edge clarity
- Background consistency

**Negative terms** (13 条):
- half face, cropped crown, top-clipped hair
- double face, residual mannequin head
- missing chin, blank mannequin neck
- blurry neck, foggy neck edge
- dark head hole, black face void
- cartoon face, doll face, oversized eyes

### Scene 1 女

| 参数 | 值 |
|------|----|
| 底图 | `场景1女.jpg` |
| 尺寸 | 2048×2560 |
| guidance | 10 |
| refScale | 0.24 |
| refAnchor | north |
| refOffsetY | 0.08 |
| refScaleCandidates | [0.24, 0.30] |
| refAlwaysSoftOval | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 1140 | 846 | 131 | 226 | — | — |
| api (hairDome) | 1142 | 832 | 144 | 250 | domeH=101, expandX=16 | sideHair: 26×78 @ (75,128), neck: rx=104, ry=132 @ offsetY=176 |
| comp (hairDome) | 1142 | 840 | 166 | 280 | domeH=104, expandX=18 | sideHair: 30×101 @ (83,141), neck: rx=120, ry=148 @ offsetY=184, feather=12 |

**Prompt 要点** (extraPromptLines, 12 条):
- Compact portrait fit, Crown clearance
- Hairstyle source lock, Bang rule
- Close-selfie handling, Long-hair routing, Shoulder clearance
- Jaw completion, No mannequin carry-over
- Single-head rule, Neck edge clarity, Background consistency

**Negative terms** (18 条):
- half face, cropped crown, top-clipped hair
- double face, residual mannequin head
- invented bangs, ponytail from down hair
- long hair over center chest, hair covering beer glass
- blurry neck, missing chin, blank mannequin neck
- dark head hole, black face void
- literal selfie crop, source image patch
- cartoon face, doll face, oversized eyes

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
- 代码回滚: `git checkout 90e2519 -- scene-configs/scene1.js scene-configs/profiles.js`
