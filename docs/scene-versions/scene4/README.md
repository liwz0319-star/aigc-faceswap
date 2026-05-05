# Scene 4 Archive

## 场景定义

- 业务名: `scene4`
- 场景名: `Championship Shower`

## 版本 1: 新底图纯 faceswap 实验版

- 脚本: [test-faceswap-new-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-new-scenes.js)
- 场景入口: `SCENE_CONFIGS['4']`
- 核心方式: 对新底图 `场景4男/女` 直接做 faceswap
- 主要输出目录: `生成测试/new_scenes_output`

使用说明:

```powershell
node .\test-faceswap-new-scenes.js "生成测试\照片\xxx.jpg" --scene 4
node .\test-faceswap-new-scenes.js "生成测试\照片\xxx.jpg" --scene 4 --gender male
```

回滚说明:

- 运行回滚: 这是场景 4 的纯 faceswap 入口。
- 代码回滚: 恢复 `test-faceswap-new-scenes.js`。

## 版本 2: 新底图批量 inpaint 版

- 脚本: [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js)
- 场景入口: `SCENE_CONFIGS['4']`
- 核心方式: 使用新底图 `场景4男/女`，构建 mask 后跑 inpainting，再 post-composite
- 主要输出目录: 默认 `生成测试/inpaint_output`
- 适用场景: 需要比纯 faceswap 更强的背景锁定时

使用说明:

```powershell
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 4 --gender male
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 4 --gender female --outdir "生成测试\新底图3"
```

回滚说明:

- 运行回滚: 直接用该脚本并指定 `--scene 4`。
- 代码回滚: 因为该脚本同时管理 `scene1/scene2/scene4`，回滚前需确认不会影响其它场景。

## 版本 3: 服务端定向测试版

- 脚本: [server/test_scene04_kane_musiala_neuer.js](F:\AAA Work\AIproject\demo\球星球迷合照\server\test_scene04_kane_musiala_neuer.js)
- 性质: 服务端链路的定向测试，不是本地批量出图主入口
- 适用场景: 验证服务端 `scene_04` 在特定球星组合下的行为

使用说明:

```powershell
node .\server\test_scene04_kane_musiala_neuer.js
```

回滚说明:

- 运行回滚: 该脚本是独立测试，不影响本地批量脚本。
- 代码回滚: 恢复 `server/test_scene04_kane_musiala_neuer.js` 即可。

## 版本 4: 当前配置版本（v1.1+ faceswap-composite 模式）

- 配置文件: [scene-configs/scene4.js](../../scene-configs/scene4.js)
- 共用 profile: `scene4_festival`（[profiles.js](../../scene-configs/profiles.js)）
- 运行脚本: [test-faceswap-inpaint-scenes.js](../../test-faceswap-inpaint-scenes.js)
- 模式: `faceswap-composite`（先用 faceswap 模式生成完整换脸图，再用 post-composite mask 锁定背景）
- 关联 commit: `90e2519` 及后续迭代

### 与版本 2 的主要差异（重大架构变更）

1. **模式从 inpaint 切换为 faceswap-composite**: Seedream inpaint 在远端边缘 100% 失败，faceswap 使用语义级背景锁替代像素级 mask
2. **输出尺寸变更**: 2560×1536 → 男 2326×1588 / 女 2328×1586（匹配新底图分辨率）
3. **guidance 降低**: 10 → 8，防止过度处理
4. **男版 skipComposite: false**: 必须 composite 把原始底图 mask 外像素贴回，锁定背景
5. **mask 扩大 ~50%**: 横向和纵向均大幅扩展
6. **prompt 全面替换**: 从 inpaint prompt 改为 faceswap prompt，侧重发型忠实复制和场景衣物保留

### Scene 4 男

| 参数 | 值 |
|------|----|
| 底图 | `场景4男.png` |
| 尺寸 | 2326×1588 |
| guidance | 8 |
| strength | 0.45 |
| templateType | faceswap |
| refScale | 0.42 |
| refAnchor | north |
| refOffsetY | 0.08 |
| refCrop | width=0.72, height=0.55, offsetX=0.5, offsetY=0.02 |
| skipComposite | false（必须 composite 锁定背景） |
| validateHeadSwap | false |
| validationTarget | the person on the far left |

**Mask 坐标**（基于新底图 1005×686）:

| 用途 | cx | cy | w | h | 附加 |
|------|----|----|---|---|------|
| 基础 | 142 | 242 | 100 | 170 | — |
| api | 144 | 238 | 112 | 166 | — |
| comp | 144 | 240 | 140 | 194 | solidTopH=26, solidTopInset=12, feather=8 |

**Prompt 要点** (extraPromptLines, 8 条):
- Hairstyle source lock (HIGHEST PRIORITY), Short-hair fidelity
- Hair length copy, Hair texture copy
- Head proportion
- Scene clothing preservation (CRITICAL), Source clothing exclusion
- Single-head rule

**Negative terms** (13 条):
- invented hairstyle, added hair length, extra hair volume
- bob cut from short hair, long hair from buzz cut
- different hairstyle, changed hair texture
- oversized head, source photo clothing
- user collar visible, reference shirt collar
- source jacket, double face, residual mannequin head

### Scene 4 女

| 参数 | 值 |
|------|----|
| 底图 | `场景4女.png` |
| 尺寸 | 2328×1586 |
| guidance | 8 |
| strength | 0.65 |
| templateType | faceswap |
| refScale | 0.30 |
| refAnchor | north |
| refOffsetY | 0.08 |
| refCrop | width=0.68, height=0.40, offsetX=0.5, offsetY=0.03 |
| skipComposite | false |
| validateHeadSwap | false |
| validationTarget | the person on the far left |

**Mask 坐标**（基于新底图 1004×684）:

| 用途 | cx | cy | w | h | 附加 |
|------|----|----|---|---|------|
| 基础 | 170 | 235 | 100 | 166 | — |
| api | 170 | 230 | 106 | 162 | — |
| comp | 170 | 232 | 130 | 188 | solidTopH=20, solidTopInset=12, feather=8 |

**Prompt 要点** (extraPromptLines, 10 条):
- Hairstyle source lock (HIGHEST PRIORITY), Hair length copy, Hair texture copy
- Festival portrait fit, Female head scale, Center lock, Crown clearance
- Long-hair routing
- Scene clothing preservation (CRITICAL), Source clothing exclusion
- Single-head rule

**Negative terms** (~18 条):
- invented hairstyle, added hair length, extra hair volume
- bob cut from short hair, different hairstyle, changed hair texture
- missing chin, blank mannequin neck
- double face, residual mannequin head
- oversized head, cropped crown
- source photo clothing, user collar visible
- reference shirt collar, wrong collar color
- source top, reference clothing fabric, source photo background

### 效果

- **scene4 男**: faceswap-composite 解决了 inpaint 模式下远端边缘 100% 失败的问题
- **scene4 女**: 0.65 strength + 扩大 mask 改善了面部覆盖
- `素材/用户测试照片` 批量测试结果: 18/18 成功

使用说明:

```powershell
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 4 --gender male
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 4 --gender female --outdir "生成测试\新底图4"
```

回滚说明:

- 运行回滚: 指定 `--scene 4` 复跑当前配置。
- 代码回滚: `git checkout 90e2519 -- scene-configs/scene4.js`
