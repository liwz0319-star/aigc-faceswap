# Scene 4 Snapshot 2026-05-04

## Summary

本次记录的是 `scene4` 的“头肩参考修复版”。

修复目标:

- 解决用户整张半身照被直接搬进场景的问题
- 限制模型只使用用户头部/头发身份信息
- 收紧 `scene4 female` 的参考裁切和 split-mask

## Files

- [scene-configs/scene4.js](F:\AAA Work\AIproject\demo\球星球迷合照\scene-configs\scene4.js)
- [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js)
- [test-faceswap-new-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-new-scenes.js)
- [../current-flow-2026-05-04.md](F:\AAA Work\AIproject\demo\球星球迷合照\docs\scene-versions\current-flow-2026-05-04.md)

## Current Config

### Male

- `refScaleCandidates: [0.42, 0.48]`
- `refCrop: { width: 0.74, height: 0.60, offsetX: 0.5, offsetY: 0.02 }`
- `validateHeadSwap: true`
- split-mask:
  - `cx=74, cy=132, w=60, h=92`
  - `apiCx=79, apiCy=131, apiW=70, apiH=92`
  - `compCx=79, compCy=131, compW=92, compH=112`

### Female

- `refScaleCandidates: [0.34, 0.40]`
- `refCrop: { width: 0.68, height: 0.50, offsetX: 0.5, offsetY: 0.04 }`
- `validateHeadSwap: false`
- split-mask:
  - `cx=82, cy=98, w=56, h=88`
  - `apiCx=81, apiCy=100, apiW=60, apiH=90`
  - `compCx=81, compCy=102, compW=78, compH=112`

## Validation

- 男版保留自动校验，目标是 `the person on the far left`
- 女版暂时关闭自动校验

原因:

- 女版底图本身就是红裙举杯造型
- 如果按“必须保留灰外套”的逻辑去校验，会把正确结果误判为失败

## Batch Test

- 输入目录: `素材/用户测试照片`
- 实际照片数: `18`
- 输出目录: `生成测试/用户测试照片_scene4_rerun_after_fix`
- 结果: `18 成功 / 0 失败`

## Commands

```powershell
node .\test-faceswap-inpaint-scenes.js "素材\用户测试照片\1.jpg" --scene 4
node .\test-faceswap-inpaint-scenes.js "素材\用户测试照片\1.jpg" --scene 4 --outdir "生成测试\scene4_fix_final_check"
node .\test-faceswap-new-scenes.js "素材\用户测试照片\8.jpg" --scene 4 --gender male
```
