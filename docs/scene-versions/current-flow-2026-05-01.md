# Current Flow Snapshot 2026-05-01

当前批量出图主入口仍然是 [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js)。

这个快照用于两件事：

- 记录 2026-05-01 当前正在调试的批量流程参数。
- 提供一份可直接回滚的说明，避免后续继续调参时丢掉当前状态。

## 入口

- 主脚本: [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js)
- 默认模板目录: `素材/新场景底图`
- 默认输出目录: `生成测试/inpaint_output`
- 当前最近一次全量测试目录:
  [生成测试/all_scenes_rerun_2026-05-01](F:\AAA Work\AIproject\demo\球星球迷合照\生成测试\all_scenes_rerun_2026-05-01)

## 当前场景配置

### Scene 1

- 底图:
  - `场景1男.jpg`
  - `场景1女.jpg`
- 模式: `inpaint`
- 输出尺寸: `2048x2560`
- 当前 mask:
  - male: `cx=1140, cy=850, rx=85, ry=125`
  - female: `cx=1140, cy=850, rx=80, ry=130`
- 当前已知问题:
  - 女版仍沿用男版中心点，只改了半径，容易出现落点偏移。
  - 男版头部偏大，说明椭圆范围仍偏大。

### Scene 2

- 底图: `场景2.png`
- 模式: `inpaint`
- 输出尺寸: `2048x2560`
- 当前 split-mask:
  - `cx=360, cy=174, w=162, h=236`
  - `apiCx=360, apiCy=158, apiW=128, apiH=228`
  - `compCx=360, compCy=174, compW=162, compH=236`
  - `compSolidTopH=68`
- 当前已知问题:
  - 个别照片头顶仍可能不完整。
  - `API mask` 对高发型或更高头顶容错不够。

### Scene 3

- 底图: `场景3.png`
- 模式: `inpaint`
- 输出尺寸: `2560x1536`
- 当前 split-mask:
  - male: `cx=1050, cy=314, w=214, h=286`
  - male API: `apiCx=1050, apiCy=296, apiW=182, apiH=268`
  - male composite: `compCx=1050, compCy=320, compW=222, compH=292, compSolidTopH=92`
  - female: `cx=1050, cy=314, w=202, h=274`
  - female API: `apiCx=1050, apiCy=296, apiW=170, apiH=256`
  - female composite: `compCx=1050, compCy=320, compW=210, compH=280, compSolidTopH=88`
- 说明:
  - 这版已切到和 `scene2` 相同的 split-mask 工流。
  - 后续如继续调参，应以本快照为回退基线。

### Scene 4

- 底图:
  - `场景4男.png`
  - `场景4女.png`
- 模式: `inpaint`
- 输出尺寸: `2560x1536`
- 当前 mask:
  - male: `cx=76, cy=133, rx=26, ry=38`
  - female: `cx=87, cy=88, rx=26, ry=38`

## 当前 Prompt 约束

当前主脚本的 `runInpaintTest()` 已包含这些约束：

- 只替换头颈区域，不改动底图主体。
- 头顶到下巴、下巴到锁骨窝的比例按性别锁定。
- 脸和脖子肤色连续。
- 头发顶部需要完整、清晰、不可半透明。
- 尽量锁定衣服、肩膀、手和背景不被重画。

## 当前回滚方式

### 运行回滚

直接按当前脚本复跑，例如：

```powershell
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\1.jpg" --scene 1
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\1.jpg" --scene 2
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\1.jpg" --scene 3
node .\test-faceswap-inpaint-scenes.js "生成测试\照片\1.jpg" --scene 4
```

### 代码回滚

如果后续调参把当前状态改坏，优先直接从本次提交恢复：

```powershell
git checkout <this-commit> -- test-faceswap-inpaint-scenes.js
git checkout <this-commit> -- docs/scene-versions/current-flow-2026-05-01.md
```

提交号在本次整理完成后补充。
