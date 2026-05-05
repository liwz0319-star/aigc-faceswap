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

## 版本 4: 当前配置版本（v1.4 faceswap-composite + hairDome mask + 防女性化）

- 配置文件: [scene-configs/scene4.js](../../scene-configs/scene4.js)
- 共用 profile: `scene4_festival`（[profiles.js](../../scene-configs/profiles.js)）
- 运行脚本: [test-faceswap-inpaint-scenes.js](../../test-faceswap-inpaint-scenes.js)
- 模式: `faceswap-composite`（先用 faceswap 模式生成完整换脸图，再用 post-composite mask 锁定背景）
- 关联 commit: 待提交

### 与版本 4 (v1.3) 的主要差异

1. **mask 从矩形改为 hairDome**: 男版和女版都使用 hairDome + sideHair 形状，贴合头冠弧度
2. **新增 `validateHeadSwap: true`**: 男版和女版都启用自动校验（之前为 false）
3. **新增 `refNormalize: true`**: 参考图标准化
4. **男版新增 Anti-feminization lock**: 防止短发男性被女性化为 bob/pixie 发型
5. **男版新增 Neck-clothing boundary prompt**: 防止 AI 渲染参考图衣物到场景中
6. **女版新增 Full hair rendering prompt**: 确保完整长发长度不被截断
7. **女版新增 Crown clearance prompt**: 防止头顶被裁切
8. **refCrop 调整**: 男版 height 0.55→0.78，女版 height 0.40→0.72，大幅扩大裁切范围
9. **女版 strength 降低**: 0.65→0.55
10. **negative terms 大幅扩充**: 男版 13→~25 条、女版 ~18→~35 条

### Scene 4 男

| 参数 | 值 |
|------|----|
| 底图 | `场景4男.png` |
| 尺寸 | 2326×1588 |
| guidance | 8 |
| strength | 0.45 |
| templateType | faceswap |
| refScale | 0.45 |
| refAnchor | north |
| refOffsetY | 0.08 |
| refCrop | width=0.72, height=0.78, offsetX=0.5, offsetY=0.00 |
| refNormalize | true |
| skipComposite | false（必须 composite 锁定背景） |
| validateHeadSwap | true |
| validationTarget | the person on the far left |
| validationRule | 男版发型必须匹配源照片，短发保持短发，无女性化 bob/pixie。完整头部 crown→chin。巴伐利亚服装保留。 |

**Mask 坐标**（基于新底图 1005×686，v6 hairDome）:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 142 | 234 | 116 | 186 | — | — |
| api (hairDome) | 144 | 228 | 118 | 178 | domeH=70, expandX=12 | sideHair: 16×42 @ (50,82) |
| comp (hairDome) | 144 | 230 | 148 | 198 | domeH=82, expandX=16 | sideHair: 22×54 @ (58,90), feather=10 |

**Prompt 要点** (extraPromptLines, 12 条):
- Hairstyle source lock (HIGHEST PRIORITY), Short-hair fidelity
- Anti-feminization lock (MANDATORY)
- Hair length copy, Hair texture copy, Crown clearance
- Head proportion
- Scene clothing preservation (CRITICAL), Source clothing exclusion
- Neck-clothing boundary (CRITICAL)
- Single-head rule, Realism lock

**Negative terms** (~25 条):
- invented/added/changed hairstyle, bob from short hair, long from buzz cut
- feminine bob from male, pixie from male, feminized male hair, gender swapped hairstyle
- cropped crown, oversized head
- source photo clothing, user/reference collar, collar bleeding, user neckline fabric
- double face, residual mannequin head
- cartoon/anime/cgi/doll/pixar/emoji face, oversized eyes, plastic skin, 3d render

### Scene 4 女

| 参数 | 值 |
|------|----|
| 底图 | `场景4女.png` |
| 尺寸 | 2328×1586 |
| guidance | 8 |
| strength | 0.55 |
| templateType | faceswap |
| refScale | 0.33 |
| refAnchor | north |
| refOffsetY | 0.08 |
| refCrop | width=0.68, height=0.72, offsetX=0.5, offsetY=0.01 |
| refNormalize | true |
| skipComposite | false |
| validateHeadSwap | true |
| validationTarget | the person on the far left |
| validationRule | 女版头部完整 crown→hair 可见，无裁切。写实面部。巴伐利亚 dirndl 保留。无源衣物。 |

**Mask 坐标**（基于新底图 1004×684，v6 hairDome 大幅扩大）:

| 用途 | cx | cy | w | h | 形状 | 附加参数 |
|------|----|----|---|---|------|---------|
| 基础 | 170 | 230 | 120 | 190 | — | — |
| api (hairDome) | 170 | 222 | 128 | 198 | domeH=84, expandX=18 | sideHair: 26×66 @ (56,76) |
| comp (hairDome) | 170 | 224 | 162 | 238 | domeH=96, expandX=24 | sideHair: 34×82 @ (64,86), feather=12 |

**Prompt 要点** (extraPromptLines, 14 条):
- Hairstyle source lock (HIGHEST PRIORITY), Hair length copy, Hair texture copy
- Crown clearance, Full hair rendering
- Festival portrait fit, Female head scale, Center lock
- Long-hair routing
- Scene clothing preservation (CRITICAL), Source clothing exclusion
- Neck-clothing boundary (CRITICAL)
- Single-head rule, Realism lock

**Negative terms** (~35 条):
- invented/changed hairstyle, bob from short, different texture
- cropped crown, truncated hair, incomplete hair, half hair, shortened long hair
- missing chin, blank mannequin neck
- double face, residual mannequin head, oversized head
- source photo clothing, user/reference collar, wrong collar color, collar bleeding, user neckline fabric
- source top, reference clothing fabric, source photo background
- cartoon/anime/cgi/doll/pixar/emoji face, oversized eyes, plastic skin, 3d render

使用说明:

```powershell
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 4 --gender male
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\xxx.jpg" --scene 4 --gender female --outdir "生成测试\新底图4"
```

回滚说明:

- 运行回滚: 指定 `--scene 4` 复跑当前配置。
- 代码回滚: `git checkout 78e9ce2 -- scene-configs/scene4.js`
