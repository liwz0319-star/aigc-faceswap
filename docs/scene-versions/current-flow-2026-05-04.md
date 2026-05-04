# Current Flow Snapshot 2026-05-04

当前批量出图主入口仍然是 [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js)。

这份快照记录的是 2026-05-04 针对 `scene4` 的一次定向修复，重点是解决“把用户整张半身照一起搬进场景”的问题。

## 入口

- 主脚本: [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js)
- 场景 4 配置: [scene-configs/scene4.js](F:\AAA Work\AIproject\demo\球星球迷合照\scene-configs\scene4.js)
- 纯 faceswap 对照脚本: [test-faceswap-new-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-new-scenes.js)
- 默认模板目录: `素材/新场景底图`
- 本次验证输出:
  - `生成测试/scene4_fix_final_check`
  - `生成测试/用户测试照片_scene4_rerun_after_fix`

## 本次修复结论

- 根因不是单纯 mask 偏移，而是 `scene4` 参考图以前直接使用整张用户半身照缩放上白底，模型会把原图衣服、肩膀、胸口一起迁移进场景。
- 现在 `scene4` 的参考图改成“头肩参考”：
  - 先裁切头肩区域
  - 再缩放并居中铺到白底
  - Prompt 明确声明 `Image 2` 只作为身份/头发参考，不允许复制原图衣服和背景
- 男版保留结果校验，校验目标改为 “the person on the far left”。
- 女版 mask 和参考裁切继续收紧，但自动校验暂时关闭。
  - 原因: `场景4女.png` 底图本身就是红裙造型，之前基于“衣服复制”的规则会把正确结果误判成失败。

## 当前 scene4 配置

### Scene 4 Male

- 模式: `inpaint`
- 输出尺寸: `2560x1536`
- 参考图策略:
  - `refScaleCandidates: [0.42, 0.48]`
  - `refCrop: { width: 0.74, height: 0.60, offsetX: 0.5, offsetY: 0.02 }`
- 校验:
  - `validateHeadSwap: true`
  - `validationTarget: the person on the far left`
- 当前 split-mask:
  - `cx=74, cy=132, w=60, h=92`
  - `apiCx=79, apiCy=131, apiW=70, apiH=92`
  - `compCx=79, compCy=131, compW=92, compH=112`
  - `compSolidTopH=18, compSolidTopInset=8, compFeather=5`

### Scene 4 Female

- 模式: `inpaint`
- 输出尺寸: `2560x1536`
- 参考图策略:
  - `refScaleCandidates: [0.34, 0.40]`
  - `refCrop: { width: 0.68, height: 0.50, offsetX: 0.5, offsetY: 0.04 }`
- 校验:
  - `validateHeadSwap: false`
  - `validationTarget: the person on the far left`
- 当前 split-mask:
  - `cx=82, cy=98, w=56, h=88`
  - `apiCx=81, apiCy=100, apiW=60, apiH=90`
  - `compCx=81, compCy=102, compW=78, compH=112`
  - `compSolidTopH=14, compSolidTopInset=8, compFeather=5`

## 当前脚本行为

### 参考图预处理

- [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js) 当前为 `scene4` 增加了:
  - `toScaledReferenceDataUrl(..., crop)`
  - `toSoftOvalReferenceDataUrl(..., crop)`
  - `buildReferenceVariants(...)`
- 参考图现在支持:
  - 头肩裁切
  - 多个 `refScaleCandidates`
  - 必要时切换参考变体重试

### Prompt 约束

- 当前 `runInpaintTest()` 已加入:
  - `Image 2 = a head-and-hair identity reference of the real person`
  - `Do NOT copy Image 2 clothing, chest, shoulders, hands, pose, or source background`
  - `Reference role lock`
- 负面词已补充:
  - `source photo jacket`
  - `source photo shirt`
  - `source photo dress`
  - `source photo torso`
  - `source photo background`

### 校验

- [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js) 当前有 `validateHeadSwapResult(...)`
- 能检查:
  - 空头
  - mannequin patch
  - 是否把 source-photo clothing / background 复制进场景
- 当前只对 `scene4 male` 启用；`scene4 female` 暂时不启用

## 本次验证结果

### 定向验证

- 男图样例: `生成测试/scene4_fix_final_check/scene4_inpaint_M_8_1777908410861.jpg`
- 女图样例: `生成测试/scene4_fix_final_check/scene4_inpaint_F_1_1777908413324.jpg`

结论:

- 男图已明显避免把原图黑外套/西装直接带进场景。
- 女图保留了女版底图自身的红裙造型，不再把整张用户半身照硬搬进来。

### 批量验证

- 输入目录: `素材/用户测试照片`
- 本次实际照片数: `18`
- 输出目录: `生成测试/用户测试照片_scene4_rerun_after_fix`
- 结果: `18 成功 / 0 失败`

## 当前已知注意点

- `scene4 female` 的底图本身不是灰外套，而是红裙举杯造型，所以女版不能沿用男版“必须保留灰外套”的自动校验规则。
- 如果后续要恢复女版自动校验，应该改成“只检查是否复制了用户原图衣服/背景”，而不是检查必须长成男版服装。

## 回滚方式

### 运行回滚

如果只想回到本次修复前的常规入口，仍然直接使用：

```powershell
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\1.jpg" --scene 4
node .\test-faceswap-new-scenes.js "生成测试\照片\1.jpg" --scene 4 --gender male
```

### 代码回滚

如需回滚本次 scene4 修复，优先恢复这些文件：

```powershell
git checkout <commit> -- scene-configs/scene4.js
git checkout <commit> -- test-faceswap-inpaint-scenes.js
git checkout <commit> -- test-faceswap-new-scenes.js
git checkout <commit> -- docs/scene-versions/current-flow-2026-05-04.md
```
