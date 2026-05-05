# 场景配置版本更新日志 (CHANGELOG)

> 本文档记录 `scene-configs/` 目录下所有场景配置和生成脚本的版本变更。
>
> **规则：每次修改 `scene-configs/` 下的任何配置文件或生成脚本时，必须在此追加一条更新记录。**

---

## 版本格式说明

- 版本号：`v<主版本>.<次版本>`，例如 `v1.0`、`v1.1`、`v2.0`
  - **主版本**：底图更换、场景架构变更、模式切换（inpaint ↔ faceswap）等重大改动时 +1
  - **次版本**：mask 坐标调整、prompt 微调、参数优化等增量改动时 +1
- 每条记录必须包含：版本号、日期、修改人、影响范围、变更内容摘要、关联 commit

---

## v1.0 — 2026-05-04 — 新底图场景配置基线

**修改人**: liwz0319
**关联 commit**: `871299d` ~ `0efb202`
**影响范围**: 全部 4 个场景（scene1~scene4），全部配置文件

### 变更摘要

从旧底图（`素材/底图/`，分男女文件）迁移到新底图（`素材/新场景底图/`），并将 4 个场景的配置从主脚本中拆分为独立模块。

#### 底图映射

| 场景 | 新底图文件 | 输出尺寸 | 画面描述 |
|------|-----------|----------|---------|
| scene1 男 | `场景1男.jpg` | 2048×2560 | 更衣室合照 |
| scene1 女 | `场景1女.jpg` | 2048×2560 | 更衣室合照 |
| scene2 | `场景2.png` | 2048×2560 | 球场举旗 |
| scene3 | `场景3.jpg` | 2560×1536 | 通道举9号球衣 |
| scene4 男 | `场景4男.png` | 2560×1536 | 啤酒节合照（最左位） |
| scene4 女 | `场景4女.png` | 2560×1536 | 啤酒节合照（最左位） |

#### 配置文件结构

```
scene-configs/
├── index.js       # 统一导出入口
├── profiles.js    # 共用 inpaint prompt profile（scene1_portrait, scene4_festival, default）
├── scene1.js      # 场景1 男/女配置
├── scene2.js      # 场景2 男/女配置
├── scene3.js      # 场景3 男/女配置
└── scene4.js      # 场景4 男/女配置
```

### 场景详细配置快照

---

#### Scene 1 — 更衣室合照

**共用 profile**: `scene1_portrait`（profiles.js）
**底图**: `场景1男.jpg` / `场景1女.jpg`
**尺寸**: 2048×2560 | **guidance**: 10

##### Scene 1 男

| 参数 | 值 |
|------|----|
| refScale | 0.38 |
| refAnchor | north |
| refOffsetY | 0.10 |
| refScaleCandidates | [0.38, 0.48] |
| validateHeadSwap | true |
| includeOriginalReferenceFallback | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 1140 | 844 | 170 | 286 | — | — |
| api (hairDome) | 1142 | 838 | 176 | 300 | domeH=100, expandX=14 | sideHair: 20×58 @ (82,146) |
| comp (hairDome) | 1142 | 844 | 196 | 320 | domeH=110, expandX=18 | sideHair: 26×72 @ (88,156), feather=10 |

**Prompt 要点** (extraPromptLines, 共 17 条):
- 完整头部替换（crown→chin）
- 居中锁定、垂直锁定、crown clearance
- 颈部自然过渡、背景不变
- 单头规则、mannequin 残留抑制

**Negative terms**: 共 ~40 条，涵盖面部残影、mannequin残留、拼接痕迹、卡通化等

##### Scene 1 女

| 参数 | 值 |
|------|----|
| refScale | 0.30 |
| refAnchor | north |
| refOffsetY | 0.10 |
| refScaleCandidates | [0.26, 0.30, 0.36] |
| refAlwaysSoftOval | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 1140 | 846 | 164 | 282 | — | — |
| api (hairDome) | 1142 | 838 | 176 | 296 | domeH=112, expandX=18 | sideHair: 30×92 @ (92,156) |
| comp (hairDome) | 1142 | 848 | 200 | 334 | domeH=118, expandX=20 | sideHair: 36×118 @ (100,172), feather=11 |

**Prompt 要点** (extraPromptLines, 共 30 条):
- 同男版基础约束 +
- 发型源锁定（bang rule、hair state lock）
- 自拍/近拍处理（close-selfie handling）
- 参考隔离（headphones/hoodies 不带入）
- 长发路由（外肩方向，不挡啤酒杯/球衣）
- 颈部拼缝抑制（collar blend, seam suppression）

**Negative terms**: 共 ~55 条，额外涵盖假刘海、扎发错误、自拍矩形、长发挡胸等

---

#### Scene 2 — 球场举旗

**底图**: `场景2.png`
**尺寸**: 2048×2560 | **guidance**: 10

##### Scene 2 男

| 参数 | 值 |
|------|----|
| 无 refScale（直接使用完整参考图） | — |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 附加 |
|------|----|----|---|---|------|
| 基础 | 360 | 174 | 162 | 236 | — |
| api | 360 | 158 | 128 | 228 | — |
| comp | 360 | 174 | 162 | 236 | solidTopH=68 |

##### Scene 2 女

| 参数 | 值 |
|------|----|
| refScale | 0.30 |
| refAnchor | north |
| refOffsetY | 0.06 |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 360 | 158 | 150 | 246 | — | — |
| api (hairDome) | 394 | 134 | 196 | 218 | domeH=82, expandX=16 | sideHair: 24×58 @ (78,138) |
| comp (hairDome) | 396 | 146 | 220 | 248 | domeH=92, expandX=20 | sideHair: 30×74 @ (86,150), feather=10 |

**Prompt 要点** (extraPromptLines, 共 20 条):
- 旗后人物头部适配
- 发型源锁定、刘海规则、长发路由
- 右耳/右侧头发可见性保护
- 自拍/矩形 patch 抑制
- 球衣领口保护

**Negative terms**: 共 ~40 条

---

#### Scene 3 — 通道举9号球衣

**底图**: `场景3.jpg`
**尺寸**: 2560×1536 | **guidance**: 10

##### Scene 3 男

| 参数 | 值 |
|------|----|
| refScale | 0.36 |
| refAnchor | north |
| refOffsetY | 0.05 |
| refSoftOvalOnFlatBackground | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 附加 |
|------|----|----|---|---|------|
| 基础 | 934 | 288 | 214 | 382 | — |
| api | 934 | 270 | 190 | 350 | — |
| comp | 934 | 274 | 236 | 394 | solidTopH=136, solidTopInset=14, feather=12 |

**Prompt 要点** (extraPromptLines, 共 10 条):
- 通道 portrait fit
- 模板头部大小锁定、比例锁定
- 颈部就位、crown clearance
- patch 抑制、背景锁定

##### Scene 3 女

| 参数 | 值 |
|------|----|
| refScale | 0.20 |
| refAnchor | north |
| refOffsetY | 0.04 |
| refCrop | width=0.62, height=0.86, offsetX=0.5, anchor=north, offsetY=0.0 |
| refAlwaysSoftOval | true |
| refSoftOvalOnFlatBackground | true |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 934 | 284 | 202 | 374 | — | — |
| api (hairDome) | 934 | 266 | 186 | 344 | domeH=86, expandX=8 | sideHair: 16×60 @ (86,160) |
| comp (hairDome) | 934 | 270 | 228 | 390 | domeH=94, expandX=10 | sideHair: 20×76 @ (94,170), feather=10 |

**Prompt 要点** (extraPromptLines, 共 20 条):
- 女性头部紧凑定位
- 颈部可见性、下脸保护
- 发型源锁定、长发路由
- 自拍处理、参考隔离
- 球衣前部不被头发遮挡

**Negative terms**: 共 ~30 条

---

#### Scene 4 — 啤酒节合照

**共用 profile**: `scene4_festival`（profiles.js）
**底图**: `场景4男.png` / `场景4女.png`
**尺寸**: 2560×1536 | **guidance**: 10

##### Scene 4 男

| 参数 | 值 |
|------|----|
| refScaleCandidates | [0.42, 0.48] |
| refAnchor | north |
| refOffsetY | 0.08 |
| refCrop | width=0.74, height=0.60, offsetX=0.5, offsetY=0.02 |
| validateHeadSwap | true |
| validationTarget | the person on the far left |
| validationRule | 必须保留灰外套/酒红马甲/白衬衫/啤酒杯姿势 |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 附加 |
|------|----|----|---|---|------|
| 基础 | 74 | 132 | 60 | 92 | — |
| api | 79 | 131 | 70 | 92 | — |
| comp | 79 | 131 | 92 | 112 | solidTopH=18, solidTopInset=8, feather=5 |

**Prompt 要点** (extraPromptLines, 共 15 条):
- 啤酒节群像头部适配
- 全脸可见、全宽填充
- 右侧头发保护
- 颈线合并、patch 抑制
- 占位头部完全替换

##### Scene 4 女

| 参数 | 值 |
|------|----|
| refScaleCandidates | [0.34, 0.40] |
| refAnchor | north |
| refOffsetY | 0.08 |
| refCrop | width=0.68, height=0.50, offsetX=0.5, offsetY=0.04 |
| validateHeadSwap | false |
| validationTarget | the person on the far left |

**Mask 坐标**:

| 用途 | cx | cy | w | h | 附加 |
|------|----|----|---|---|------|
| 基础 | 82 | 98 | 56 | 88 | — |
| api | 81 | 100 | 60 | 90 | — |
| comp | 81 | 102 | 78 | 112 | solidTopH=14, solidTopInset=8, feather=5 |

**Prompt 要点** (extraPromptLines, 共 17 条):
- 女性头部紧凑适配
- 长发长度保护（不截断为 bob）
- 长发路由（优先后方，不挡前胸）
- 场景衣物保留（灰外套/酒红马甲）
- 下颌完成、mannequin 残留抑制

**Negative terms**: 共 ~30 条

---

### 共用 Profile（profiles.js）

| Profile 名称 | 用途 | taskLine 概要 |
|--------------|------|--------------|
| `default` | 兜底 | 替换白 mask 区域内头颈部 |
| `scene1_portrait` | scene1 男/女 | 照片级头部替换，含背景锁定/尺寸锁定/写实锁定 |
| `scene4_festival` | scene4 男/女 | 户外啤酒节群像头部替换，含下颌完成/占位覆盖/写实锁定 |

### 主运行脚本

- **批量入口**: `test-faceswap-inpaint-scenes.js`
- **参考图预处理**: 支持 head-shoulder crop、多 refScaleCandidates 重试、soft oval
- **后处理**: post-composite 背景锁定（用原始底图像素覆盖非 mask 区域）
- **校验**: `validateHeadSwapResult()` — 检测空头、mannequin patch、source-photo clothing 携入

### 已知问题 & 注意事项

1. **scene4 女版自动校验已关闭** — 女版底图是红裙造型，基于"衣服复制"的规则会误判
2. **scene2 男版无 refScale** — 直接使用完整参考图，无裁切
3. **scene3 使用不同输出尺寸** — 2560×1536（横版），其余竖版场景为 2048×2560
4. **旧底图保留** — `素材/底图/` 目录保留旧版底图文件，用于回滚参考

---

## v1.4 — 2026-05-06 — 全场景统一升级：hairDome mask、refNormalize、validateHeadSwap、prompt 扩充

**修改人**: liwz0319
**关联 commit**: （待提交）
**影响范围**: 全部 4 个场景（scene1~scene4），全部配置文件 + 主运行脚本

### 变更摘要

对所有 4 个场景进行统一升级，核心变更包括：
1. **hairDome mask 统一化**: scene4 男/女从矩形 mask 切换为 hairDome，与 scene1/scene3 保持一致
2. **refNormalize 统一启用**: 所有场景新增 `refNormalize: true`，参考图标准化处理
3. **validateHeadSwap 统一启用**: 所有场景启用自动校验（scene4 从 false 改为 true），并配置场景化校验规则
4. **strength 参数新增**: scene1 新增 `strength: 0.85`；scene4 女版降低至 0.55
5. **preFillMask 新增**: scene1 男/女新增 `preFillMask: true`
6. **prompt 大幅扩充**: 所有场景新增发型锁定、颈部肤色过渡、写实锁定等 prompt
7. **negative terms 大幅扩充**: 所有场景新增 neck color seam、oversized head 系列、cartoon 全系列、invented hairstyle 系列等
8. **mask 坐标调整**: scene1/scene3 domeH 扩大、feather 增大、neck 椭圆参数调整；scene4 整体改为 hairDome

### 参数变更对照

#### Scene 1 男

| 参数 | v1.3 | v1.4 | 原因 |
|------|------|------|------|
| strength | 无 | **0.85** | 新增 inpaint 强度控制 |
| refScale | 0.30 | **0.34** | 提升参考图比例 |
| refScaleCandidates | [0.30, 0.36] | **[0.34, 0.40]** | 配合 refScale |
| preFillMask | 无 | **true** | 预填充 mask 改善质量 |
| refNormalize | 无 | **true** | 参考图标准化 |
| extraPromptLines | 7 条 | **17 条** | 新增 Strict head size, Neck skin tone, Head proportion, Hairstyle lock 等 |
| extraNegativeTerms | 13 条 | **~50 条** | 新增 neck color seam, oversized 系列, hairstyle 系列, cartoon 全系列 |
| apiDomeH | 93 | **126** | dome 扩大 |
| compDomeH | 99 | **152** | composite dome 大幅扩大 |
| compFeather | 11 | **30** | feather 增大让边缘更柔和 |
| apiCy | 832 | **812** | API mask 上移 |
| compCy | 840 | **814** | composite mask 上移 |
| apiNeckRy | 136 | **144** | 颈部椭圆扩大 |
| compNeckRy | 152 | **188** | composite 颈部椭圆大幅扩大 |

#### Scene 1 女

| 参数 | v1.3 | v1.4 | 原因 |
|------|------|------|------|
| strength | 无 | **0.85** | 新增 inpaint 强度控制 |
| refScale | 0.24 | **0.30** | 提升参考图比例 |
| refScaleCandidates | [0.24, 0.30] | **[0.30, 0.36]** | 配合 refScale |
| preFillMask | 无 | **true** | 预填充 mask |
| refNormalize | 无 | **true** | 参考图标准化 |
| validateHeadSwap | 无 | **true** | 新增校验 |
| extraPromptLines | 12 条 | **18 条** | 新增 Strict head size, Neck skin tone, Head proportion, Hair side coverage 等 |
| extraNegativeTerms | 18 条 | **~50 条** | 同男版扩充 |
| apiDomeH | 101 | **128** | dome 扩大 |
| compDomeH | 104 | **144** | composite dome 大幅扩大 |
| compFeather | 12 | **30** | feather 增大 |
| apiCy | 832 | **810** | API mask 上移 |
| compCy | 840 | **814** | composite mask 上移 |

#### Scene 2 男

| 参数 | v1.3 | v1.4 | 原因 |
|------|------|------|------|
| refNormalize | 无 | **true** | 参考图标准化 |
| validateHeadSwap | 无 | **true** | 新增校验 |
| validationTarget | 无 | **the main swapped person behind the flag** | 校验目标 |
| validationRule | 无 | **head centered, flag+jersey preserved** | 校验规则 |

#### Scene 2 女

| 参数 | v1.3 | v1.4 | 原因 |
|------|------|------|------|
| refNormalize | 无 | **true** | 参考图标准化 |
| validateHeadSwap | 无 | **true** | 新增校验 |
| validationTarget | 无 | **the main swapped person behind the flag** | 校验目标 |
| extraPromptLines | 18 条 | **20 条** | 新增 Maximum head size prompt |

#### Scene 3 男

| 参数 | v1.3 | v1.4 | 原因 |
|------|------|------|------|
| refScale | 0.36 | **0.42** | 增大参考图比例改善面部质量 |
| refNormalize | 无 | **true** | 参考图标准化 |
| validateHeadSwap | 无 | **true** | 新增校验 |
| extraPromptLines | 12 条 | **20 条** | 新增 Hairstyle source lock, Short-hair fidelity, Bang rule, Hair state lock, Neck-to-collar blend, Shoulder integrity, Realism lock |
| extraNegativeTerms | ~20 条 | **~60 条** | 新增 invented hairstyle 系列, neck color seam, ghost shoulder 系列, cartoon 全系列, selfie crop |
| apiDomeH | 120 | **138** | dome 扩大 |
| compDomeH | 128 | **148** | composite dome 扩大 |
| compFeather | 12 | **18** | feather 增大 |
| apiCy | 260 | **254** | 上移 |
| compCy | 264 | **258** | 上移 |
| apiW | 190 | **196** | 微调 |
| compW | 236 | **240** | 微调 |
| compH | 406 | **420** | 扩大 |

#### Scene 3 女

| 参数 | v1.3 | v1.4 | 原因 |
|------|------|------|------|
| refScale | 0.28 | **0.26** | 收紧参考图比例修复头部过大 |
| refNormalize | 无 | **true** | 参考图标准化 |
| validateHeadSwap | 无 | **true** | 新增校验 |
| extraPromptLines | 12 条 | **18 条** | 新增 Hairstyle lock, Bang/Hair state lock, Neck-to-collar, Shoulder integrity, Realism lock |
| extraNegativeTerms | ~15 条 | **~40 条** | 大幅扩充 |
| apiDomeH | 100 | **96** | 微调 |
| compDomeH | 108 | **104** | 微调 |
| apiH | 390 | **356** | 收窄 |
| compH | 434 | **398** | 收窄 |
| base w | 202 | **198** | 微调 |
| base h | 404 | **356** | 收窄 |

#### Scene 4 男（重大 mask 变更）

| 参数 | v1.3 | v1.4 | 原因 |
|------|------|------|------|
| refScale | 0.42 | **0.45** | 微调 |
| refCrop height | 0.55 | **0.78** | 大幅扩大裁切范围 |
| refNormalize | 无 | **true** | 参考图标准化 |
| validateHeadSwap | false | **true** | 启用校验 |
| **mask apiShape** | **矩形** | **hairDome** | **核心变更**：贴合头冠弧度 |
| mask cy | 242 | **234** | 上移 |
| mask w | 100 | **116** | 扩大 |
| mask h | 170 | **186** | 扩大 |
| apiDomeH | 无 | **70** | 新增 dome |
| compDomeH | 无 | **82** | 新增 composite dome |
| compFeather | 8 | **10** | 微调 |
| extraPromptLines | 8 条 | **12 条** | 新增 Anti-feminization lock, Crown clearance, Neck-clothing boundary, Realism lock |
| extraNegativeTerms | 13 条 | **~25 条** | 新增 feminine bob/pixie, gender swapped hairstyle, collar bleeding, cartoon 全系列 |

#### Scene 4 女（重大 mask 变更）

| 参数 | v1.3 | v1.4 | 原因 |
|------|------|------|------|
| strength | 0.65 | **0.55** | 降低强度 |
| refScale | 0.30 | **0.33** | 微调 |
| refCrop height | 0.40 | **0.72** | 大幅扩大裁切范围 |
| refNormalize | 无 | **true** | 参考图标准化 |
| validateHeadSwap | false | **true** | 启用校验 |
| **mask apiShape** | **矩形** | **hairDome** | **核心变更**：贴合头冠弧度 |
| mask cy | 235 | **230** | 微调 |
| mask w | 100 | **120** | 扩大 |
| mask h | 166 | **190** | 扩大 |
| apiDomeH | 无 | **84** | 新增 dome |
| compDomeH | 无 | **96** | 新增 composite dome |
| compFeather | 8 | **12** | 微调 |
| extraPromptLines | 10 条 | **14 条** | 新增 Crown clearance, Full hair rendering, Neck-clothing boundary, Realism lock |
| extraNegativeTerms | ~18 条 | **~35 条** | 新增 truncated hair, collar bleeding, cartoon 全系列 |

---

## v1.2 — 2026-05-05 — Scene3 回退 inpaint 模式 + hairDome mask 优化

**修改人**: liwz0319
**关联 commit**: `90e2519`
**影响范围**: scene3 男/女

### 变更摘要

Scene3 从 `faceswap-composite` + `skipComposite: true` 回退为 `inpaint` 模式。原因是 faceswap-composite 不做 post-composite 导致：
1. 背景通道墙壁色彩偏移（平均差值 28 vs JPEG 正常值 0.4）
2. Seedream "AI生成" 水印直接留在输出图上
3. 脖子与肩膀肤色两截色（AI 生成肤色与底图原始肤色不匹配）

回退 inpaint 后，AI 能看到 mask 外的原始像素并主动匹配肤色，post-composite 确保背景 100% 锁定。

同时采纳了 faceswap-composite 版本中优化过的 hairDome mask 坐标和精简后的 prompt。

### 参数变更对照

#### Scene 3 男（mask 从矩形改为 hairDome）

| 参数 | v1.1 (inpaint) | v1.2 (inpaint 优化) | 原因 |
|------|---------------|-------------------|------|
| mask apiShape | 无（矩形） | **hairDome** | 贴合头冠弧度，覆盖更完整 |
| mask compShape | 无（矩形） | **hairDome** | 同步 composite mask |
| mask apiDomeH | 无 | **120** | dome 高度覆盖头冠 |
| mask compDomeH | 无 | **128** | composite dome |
| mask cy | 288 | **280** | 微调中心位置 |
| mask apiCy | 270 | **260** | API mask 上移 |
| mask h | 382 | **394** | 纵向扩大 |
| mask apiH | 350 | **362** | API mask 扩大 |
| mask compH | 394 | **406** | composite mask 扩大 |
| compSolidTopH | 136 | **移除**（由 hairDome 替代） | hairDome 天然覆盖顶部 |

**新增 prompt** (3 条):
- `Jaw completion`: 确保生成完整下颌和颈部
- `Full-head completion`: 防止生成不完整头部/暗块
- `Skin tone continuity`: 脖子肤色与肩膀肤色平滑过渡

**新增 negativeTerms** (6 条):
- `missing chin`, `melted lower face`, `blank mannequin neck`, `unfinished jawline`
- `dark head hole`, `black face void`

#### Scene 3 女（mask 扩大 + 新增 prompt）

| 参数 | v1.1 (inpaint) | v1.2 (inpaint 优化) | 原因 |
|------|---------------|-------------------|------|
| mask cy | 284 | **298** | 微调中心 |
| mask h | 374 | **404** | 纵向扩大 8% |
| mask apiH | 360 | **390** | API mask 扩大 |
| mask compH | 404 | **434** | composite mask 扩大 |
| mask compDomeH | 108 | **108**（不变） | — |
| mask compSideHairH | 84 | **84**（不变） | — |
| compSideHairOffsetY | 174 | **184** | 侧发位置下移 |

**新增 prompt** (2 条):
- `Jaw completion`: 确保完整下颌
- `Skin tone continuity`: 防止两截色脖子

**新增 negativeTerms** (6 条):
- `missing chin`, `melted lower face`, `blank mannequin neck`
- `dark head hole`, `black face void`
- `source photo background`, `indoor wall patch`

---

## v1.1 — 2026-05-05 — 简化 prompt、扩大 mask、scene4 男版切换 faceswap-composite

**修改人**: liwz0319
**关联 commit**: `90e2519`
**影响范围**: scene1 男/女、scene3 女、scene4 男/女、profiles.js、test-faceswap-inpaint-scenes.js

### 变更摘要

大幅精简 prompt 负载，扩大 mask 覆盖范围，scene4 男版从 inpaint 切换为 faceswap-composite 模式解决 Seedream 在远端边缘无法生成面部的 100% 失败问题。

### 参数变更对照

#### Scene 1 男

| 参数 | v1.0 | v1.1 | 原因 |
|------|------|------|------|
| refScale | 0.38 | **0.35** | 减小参考图比例，避免头部过大 |
| refOffsetY | 0.10 | **0.08** | 上移参考图定位 |
| refScaleCandidates | [0.38, 0.48] | **[0.35, 0.42]** | 配合 refScale 调整候选值 |
| extraPromptLines | 17 条 | **7 条** | 去除冗余 prompt，减轻 Seedream prompt 负载 |
| extraNegativeTerms | ~40 条 | **13 条** | 保留核心负面词，去除重叠/低效条目 |
| api domeH | 100 | **116** | 扩大 dome 覆盖，避免头顶裁切 |
| api h | 300 | **316** | mask 纵向扩展 |
| comp domeH | 110 | **124** | 同步扩大 composite mask |
| comp h | 320 | **338** | 同步扩大 composite mask |
| comp w | 196 | **204** | composite 横向扩展 |

#### Scene 1 女

| 参数 | v1.0 | v1.1 | 原因 |
|------|------|------|------|
| refScale | 0.30 | **0.28** | 减小参考图比例 |
| refOffsetY | 0.10 | **0.08** | 上移参考图定位 |
| refScaleCandidates | [0.26, 0.30, 0.36] | **[0.28, 0.34]** | 配合 refScale 调整 |
| extraPromptLines | 30 条 | **12 条** | 大幅精简，保留核心约束 |
| extraNegativeTerms | ~55 条 | **18 条** | 保留核心负面词 |
| api domeH | 112 | **126** | 扩大 dome 覆盖 |
| api h | 296 | **312** | mask 纵向扩展 |
| comp domeH | 118 | **130** | 同步扩大 composite |
| comp h | 334 | **350** | 同步扩大 composite |
| comp sideHairH | 118 | **126** | 侧发覆盖扩大 |

#### Scene 3 女

| 参数 | v1.0 | v1.1 | 原因 |
|------|------|------|------|
| refScale | 0.20 | **0.28** | +40% 增大参考图，改善面部生成质量 |
| refCrop width | 0.62 | **0.72** | 放宽裁切宽度 |
| refCrop height | 0.86 | **0.88** | 放宽裁切高度 |
| extraPromptLines | 20 条 | **10 条** | 精简至核心约束 |
| extraNegativeTerms | ~30 条 | **13 条** | 保留核心负面词 |
| api domeH | 86 | **100** | 扩大 dome |
| api h | 344 | **360** | mask 纵向扩展 |
| comp domeH | 94 | **108** | 同步扩大 |
| comp h | 390 | **404** | 同步扩大 |

#### Scene 4 男（重大架构变更）

| 参数 | v1.0 | v1.1 | 原因 |
|------|------|------|------|
| **mode** | **inpaint** | **faceswap-composite** | **核心变更**：Seedream inpaint 在远端边缘 100% 失败，切换为 faceswap-composite |
| guidance | 10 | **8** | 降低 guidance 防止过度处理 |
| strength | 无 | **0.65** | faceswap 模式强度 |
| templateType | 无 | **faceswap** | faceswap 模式标识 |
| refScale | 无 (用 candidates) | **0.40** | faceswap 使用固定 refScale |
| refCrop | w=0.74, h=0.60 | **w=0.78, h=0.68** | 扩大参考裁切范围 |
| skipComposite | 无 | **true** | faceswap prompt 已锁定背景，跳过 post-composite |
| validateHeadSwap | true | **false** | faceswap 模式下关闭旧版校验 |
| extraPromptLines | 15 条 | **0 条**（由 faceswap prompt 取代） | faceswap 使用 buildFaceswapPrompt |
| extraNegativeTerms | ~30 条 | **0 条** | 同上 |
| mask cx | 74 | **80** | 扩大 mask ~50% |
| mask w | 60 | **90** | 横向扩大 50% |
| mask h | 92 | **138** | 纵向扩大 50% |
| api w | 70 | **104** | API mask 同步扩大 |
| api h | 92 | **136** | API mask 同步扩大 |
| comp w | 92 | **134** | composite mask 同步扩大 |
| comp h | 112 | **164** | composite mask 同步扩大 |

#### Scene 4 女

| 参数 | v1.0 | v1.1 | 原因 |
|------|------|------|------|
| refScaleCandidates | [0.34, 0.40] | **[0.30, 0.36]** | 收紧参考图比例 |
| refCrop width | 0.68 | **0.72** | 调整裁切范围 |
| refCrop height | 0.50 | **0.56** | 调整裁切范围 |
| extraPromptLines | 17 条 | **8 条** | 大幅精简 |
| extraNegativeTerms | ~30 条 | **8 条** | 精简至核心 |
| mask cx | 82 | **84** | 微调中心 |
| mask w | 56 | **84** | 扩大 ~50% |
| mask h | 88 | **132** | 扩大 ~50% |

#### profiles.js (scene1_portrait)

| 参数 | v1.0 | v1.1 | 原因 |
|------|------|------|------|
| promptLines | 7 条 | **4 条** | 去除适得其反的 skin transition prompt，精简至核心 |

#### test-faceswap-inpaint-scenes.js

新增功能：
- `faceswap-composite` 模式支持（先 faceswap 再可选 post-composite）
- `skipComposite` 标志：faceswap prompt 已锁背景时跳过 composite
- `FAIL_DEBUG` 保存：校验失败时保存 debug 图
- `preFillMask` 预处理支持

### 效果验证

- **scene4 男**：faceswap-composite 解决了 inpaint 模式下远端边缘 100% 失败的问题，质量从 1/10 提升至 6-8/10
- **scene1**：prompt 精简 + mask 扩大改善了头部覆盖
- **scene3 女**：refScale +40% 改善了面部生成质量

---

## v1.3 — 2026-05-05 — Scene1/Scene4 后续迭代优化

**修改人**: liwz0319
**关联 commit**: `90e2519`（包含在 v1.1 同一提交中，代码实际参数与 v1.1 CHANGELOG 记录有差异）
**影响范围**: scene1 男/女、scene4 男/女

### 变更摘要

v1.1 提交 `90e2519` 中 scene1 和 scene4 的实际代码参数与 CHANGELOG v1.1 记录存在差异，说明在提交前经历了多轮快速迭代（commits `3279f58` ~ `0efb202`），最终值在 `90e2519` 中确定。此版本条目记录当前代码中的实际参数快照。

### 参数变更对照

#### Scene 1 男（v1.1 → v1.3 实际值）

| 参数 | v1.1 CHANGELOG | v1.3 实际值 | 说明 |
|------|---------------|------------|------|
| refScale | 0.35 | **0.30** | 进一步收紧参考图比例 |
| refScaleCandidates | [0.35, 0.42] | **[0.30, 0.36]** | 配合 refScale 调整 |
| mask w | 170 | **136** | 收窄 mask 宽度 |
| mask h | 286 | **230** | 收窄 mask 高度 |
| api domeH | 116 | **93** | 收紧 dome 高度 |
| api w | 176 | **144** | 收紧 API mask |
| api h | 300 | **253** | 收紧 API mask |
| comp domeH | 124 | **99** | 收紧 composite dome |
| comp w | 196 | **163** | 收紧 composite mask |
| comp h | 320 | **270** | 收紧 composite mask |
| **新增** apiNeckRx/ry | 无 | **112/136** | 新增颈部椭圆覆盖 |
| **新增** compNeckRx/ry | 无 | **128/152** | 新增 composite 颈部覆盖 |

#### Scene 1 女（v1.1 → v1.3 实际值）

| 参数 | v1.1 CHANGELOG | v1.3 实际值 | 说明 |
|------|---------------|------------|------|
| refScale | 0.28 | **0.24** | 进一步收紧参考图比例 |
| refScaleCandidates | [0.28, 0.34] | **[0.24, 0.30]** | 配合 refScale 调整 |
| mask w | 164 | **131** | 收窄 mask |
| mask h | 282 | **226** | 收窄 mask |
| api domeH | 126 | **101** | 收紧 dome |
| api h | 296 | **250** | 收紧 API mask |
| comp domeH | 130 | **104** | 收紧 composite dome |
| comp h | 334 | **280** | 收紧 composite mask |
| comp sideHairH | 126 | **101** | 收紧侧发覆盖 |
| **新增** apiNeckRx/ry | 无 | **104/132** | 新增颈部椭圆覆盖 |
| **新增** compNeckRx/ry | 无 | **120/148** | 新增 composite 颈部覆盖 |

#### Scene 4 男（v1.1 → v1.3 实际值）

| 参数 | v1.1 CHANGELOG | v1.3 实际值 | 说明 |
|------|---------------|------------|------|
| **size** | 2560×1536 | **2326×1588** | 输出尺寸匹配新底图分辨率 |
| strength | 0.65 | **0.45** | 降低强度，减少过度换脸 |
| refScale | 0.40 | **0.42** | 微调 |
| refCrop width | 0.78 | **0.72** | 收窄裁切范围 |
| refCrop height | 0.68 | **0.55** | 收窄裁切范围 |
| skipComposite | true | **false** | 改为必须 composite，锁定背景 |
| mask cx | 80 | **142** | 大幅调整 mask 位置 |
| mask cy | 132 | **242** | 大幅下移 mask |
| mask w | 90 | **100** | 微调 |
| mask h | 138 | **170** | 扩大 |
| api cx | 79 | **144** | 大幅调整 |
| api cy | 131 | **238** | 大幅调整 |
| api w | 104 | **112** | 微调 |
| api h | 136 | **166** | 扩大 |
| comp cx | 79 | **144** | 大幅调整 |
| comp cy | 131 | **240** | 大幅调整 |
| comp w | 134 | **140** | 微调 |
| comp h | 164 | **194** | 扩大 |
| extraPromptLines | 0 条 | **8 条** | 重新启用自定义 prompt（发型锁定+衣物保留） |
| extraNegativeTerms | 0 条 | **13 条** | 重新启用 negative terms |

#### Scene 4 女（v1.1 → v1.3 实际值）

| 参数 | v1.1 CHANGELOG | v1.3 实际值 | 说明 |
|------|---------------|------------|------|
| **size** | 2560×1536 | **2328×1586** | 输出尺寸匹配新底图分辨率 |
| refScale | 无 (用 candidates) | **0.30** | 改为固定 refScale |
| refScaleCandidates | [0.30, 0.36] | **移除** | 改为固定 refScale |
| refCrop width | 0.72 | **0.68** | 收窄 |
| refCrop height | 0.56 | **0.40** | 大幅收窄裁切高度 |
| mask cx | 84 | **170** | 大幅调整 mask 位置 |
| mask cy | 98 | **235** | 大幅下移 mask |
| mask w | 84 | **100** | 扩大 |
| mask h | 132 | **166** | 扩大 |
| api cx | 81 | **170** | 大幅调整 |
| api cy | 100 | **230** | 大幅调整 |
| api w | 60 | **106** | 大幅扩大 |
| api h | 90 | **162** | 大幅扩大 |
| comp cx | 81 | **170** | 大幅调整 |
| comp cy | 102 | **232** | 大幅调整 |
| comp w | 78 | **130** | 大幅扩大 |
| comp h | 112 | **188** | 大幅扩大 |
| extraPromptLines | 8 条 | **10 条** | 新增发型锁定+衣物保留 prompt |
| extraNegativeTerms | 8 条 | **~18 条** | 扩充 negative terms |

---
