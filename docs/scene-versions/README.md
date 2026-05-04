# Scene Version Archive

本目录用于梳理仓库内和 4 个业务场景直接相关的测试脚本、版本线和回滚入口。

## 场景映射

- `scene1`: Oktoberfest Gathering
- `scene2`: Locker Room Celebration
- `scene3`: Bernie Mascot Interaction
- `scene4`: Championship Shower

## 目录结构

- [current-flow-2026-05-01.md](F:\AAA Work\AIproject\demo\球星球迷合照\docs\scene-versions\current-flow-2026-05-01.md)
- [current-flow-2026-05-04.md](F:\AAA Work\AIproject\demo\球星球迷合照\docs\scene-versions\current-flow-2026-05-04.md)
- [scene1/README.md](F:\AAA Work\AIproject\demo\球星球迷合照\docs\scene-versions\scene1\README.md)
- [scene2/README.md](F:\AAA Work\AIproject\demo\球星球迷合照\docs\scene-versions\scene2\README.md)
- [scene3/README.md](F:\AAA Work\AIproject\demo\球星球迷合照\docs\scene-versions\scene3\README.md)
- [scene4/README.md](F:\AAA Work\AIproject\demo\球星球迷合照\docs\scene-versions\scene4\README.md)

## 场景配置拆分

- 批量脚本运行入口仍然是 [test-faceswap-inpaint-scenes.js](F:\AAA Work\AIproject\demo\球星球迷合照\test-faceswap-inpaint-scenes.js)
- 四个场景的独立配置现在位于 [scene-configs](F:\AAA Work\AIproject\demo\球星球迷合照\scene-configs)
- 以后只调某一个场景时，直接修改对应文件即可：
- [scene1.js](F:\AAA Work\AIproject\demo\球星球迷合照\scene-configs\scene1.js)
- [scene2.js](F:\AAA Work\AIproject\demo\球星球迷合照\scene-configs\scene2.js)
- [scene3.js](F:\AAA Work\AIproject\demo\球星球迷合照\scene-configs\scene3.js)
- [scene4.js](F:\AAA Work\AIproject\demo\球星球迷合照\scene-configs\scene4.js)
- 公共 inpaint prompt profile 位于 [profiles.js](F:\AAA Work\AIproject\demo\球星球迷合照\scene-configs\profiles.js)

## 版本线总览

| 场景 | 主要版本线 | 当前建议查看 |
| --- | --- | --- |
| `scene1` | 单场景 faceswap / RegionSync / 局部 refine / 新底图批量 inpaint | `scene1/README.md` |
| `scene2` | 单场景 inpaint / prompt-i2i / RegionSync / 新底图批量 inpaint | `scene2/README.md` |
| `scene3` | 单场景 faceswap / RegionSync / 单场景 inpaint | `scene3/README.md` |
| `scene4` | 新底图纯 faceswap / 新底图批量 inpaint / 服务端定向测试 | `scene4/README.md` |

## 使用原则

- 这里的“回滚”分两类：
  - `运行回滚`: 直接重新使用旧脚本和旧输出目录复跑。
  - `代码回滚`: 用 `git checkout <commit> -- <file>` 恢复特定文件版本。
- 已有明确提交号的版本，会在对应场景文档中写出 commit。
- 还没有独立 commit 的历史实验版本，这里只保留脚本入口、目录和运行方式，不伪造 commit。

## 当前重点版本

当前已经明确恢复并提交的版本是 `scene2` 的“旧版批量 inpaint 工流”，见：

- [scene2/README.md](F:\AAA Work\AIproject\demo\球星球迷合照\docs\scene-versions\scene2\README.md)

当前正在使用和继续调参的批量流程快照见：

- [current-flow-2026-05-01.md](F:\AAA Work\AIproject\demo\球星球迷合照\docs\scene-versions\current-flow-2026-05-01.md)
- [current-flow-2026-05-04.md](F:\AAA Work\AIproject\demo\球星球迷合照\docs\scene-versions\current-flow-2026-05-04.md)

鏈€鏂扮殑 `scene4` 淇蹇収鏄?`current-flow-2026-05-04.md`锛屽叧閿彉鏇村寘鎷?:

- `scene4` 鍙傝€冨浘鏀逛负鈥滃ご鑲╁弬鑰冣€?
- 鐢风増淇濈暀鑷姩缁撴灉鏍￠獙
- 濂崇増鏀剁揣 `refCrop` 鍜?mask锛屾殏鏃朵笉鍚敤鑷姩鏍￠獙
- `素材/用户测试照片` 瀵?`scene4` 鐨勬渶鏂版壒閲忕粨鏋滄槸 `18/18` 鎴愬姛

其中对应的已提交 commit：

- `9a4703e` `restore old scene2 inpaint workflow`
- `2f37d28` `add restored workflow notes`
