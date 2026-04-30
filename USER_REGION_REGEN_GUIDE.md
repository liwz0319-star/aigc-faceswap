# 场景 1 / 场景 4 只重生成用户区域的复现说明

本文说明当前 `faceswap-demo` 中“只针对 user 区域编辑重新生成，不改变其他区域”的实现方法。核心不是单纯依赖提示词约束模型，而是使用“生成后局部回贴”的工程闭环：模型可以生成整张图，但最终交付图以原始底图为画布，只把用户目标区域从生成图贴回去。

## 1. 核心结论

当前方案分两层保证非用户区域不变：

1. 生成阶段：prompt 明确要求只编辑目标人物，保护其他人物、背景、Logo、酒杯、服装、手部等。
2. 合成阶段：无论模型实际有没有改到别处，最终图都会重新以底图为基础，只把配置的 `editRegions` 区域从生成图覆盖回来。

因此最终输出里，`editRegions` 外面的像素来自底图原图；只有 `editRegions` 内的用户区域来自 Seedream 生成结果。这个机制由 `--sync-base-outside-target` 和 `--edit-region` 触发。

## 2. 涉及文件

```text
faceswap-demo/
  run-scene.js                    # 场景入口，读取 scenes/*.json 并转成 run-demo 参数
  run-demo.js                     # 单次生成主入口
  src/scenes.js                   # 加载和校验场景配置
  src/pipeline.js                 # 两阶段生成、质量检查、最终局部合成
  scenes/scene1.json              # 场景 1 的目标用户区域
  scenes/scene4.json              # 场景 4 的目标用户区域
  scripts/run-user-folder-scene1.js # 批量用户图生成，同样复用局部回贴逻辑
```

## 3. 场景配置

### 场景 1

配置文件：`faceswap-demo/scenes/scene1.json`

```json
{
  "id": "scene1",
  "base": "assets/scenes/scene1/base.jpg",
  "target": "second person from the left",
  "targetDetail": "the adult Asian male standing second from the left, between the leftmost Black male and the center-right blond male, holding a beer mug",
  "protectedPerson": "the leftmost Black male, the center-right blond male, and the rightmost man",
  "syncBaseOutsideTarget": true,
  "editRegions": [
    {
      "id": "target_user",
      "x": 0.29,
      "y": 0.31,
      "width": 0.25,
      "height": 0.62,
      "feather": 48
    }
  ]
}
```

### 场景 4

配置文件：`faceswap-demo/scenes/scene4.json`

```json
{
  "id": "scene4",
  "base": "scenes/场景4底图男.png",
  "target": "front center person",
  "targetDetail": "the adult Asian male standing in the front center, wearing the red FC Bayern jersey and being covered by beer foam poured from the Paulaner glass above his head",
  "protectedPerson": "the leftmost Black male, the blond male behind the target, and the rightmost goalkeeper in green",
  "syncBaseOutsideTarget": true,
  "editRegions": [
    {
      "id": "target_user",
      "x": 0.29,
      "y": 0.34,
      "width": 0.43,
      "height": 0.65,
      "feather": 48
    }
  ]
}
```

## 4. 坐标含义

`editRegions` 是最终允许被替换的用户区域。每个区域字段含义如下：

| 字段 | 含义 |
|---|---|
| `id` | 区域名称，方便审计和输出记录 |
| `x` | 区域左上角横坐标 |
| `y` | 区域左上角纵坐标 |
| `width` | 区域宽度 |
| `height` | 区域高度 |
| `feather` | 边缘羽化像素，避免硬边 |

当前配置使用 0-1 归一化坐标。以 1920x2400 输出为例：

```text
scene1:
x = 0.29 * 1920 = 557
y = 0.31 * 2400 = 744
width = 0.25 * 1920 = 480
height = 0.62 * 2400 = 1488

scene4:
x = 0.29 * 1920 = 557
y = 0.34 * 2400 = 816
width = 0.43 * 1920 = 826
height = 0.65 * 2400 = 1560
```

也支持像素坐标。如果 `x/width` 或 `y/height` 大于 1，代码会按像素值处理。

## 5. 运行链路

### 5.1 `run-scene.js` 读取场景

执行：

```bash
cd "/Users/ZenoWang/Documents/project/宝拉纳AIGC/faceswap-demo"
node run-scene.js scene1 --execute --env ".env" --user "/path/to/user.jpg"
node run-scene.js scene4 --execute --env ".env" --user "/path/to/user.jpg"
```

`run-scene.js` 会读取 `scenes/<scene>.json`，然后把配置转成 `run-demo.js` 参数。关键参数是：

```bash
--sync-base-outside-target
--edit-region target_user:0.29,0.31,0.25,0.62,48
```

场景 4 对应：

```bash
--sync-base-outside-target
--edit-region target_user:0.29,0.34,0.43,0.65,48
```

### 5.2 `src/scenes.js` 强制校验局部回贴

`src/scenes.js` 的 `validateSceneConfig()` 会要求：

```js
config.syncBaseOutsideTarget === true
config.editRegions.length > 0
```

这两个条件缺一不可。目的是避免同事新增场景时忘记开启底图同步，导致最终图直接使用模型整图输出。

### 5.3 `run-demo.js` 传入局部区域

`run-demo.js` 解析参数后，只有在 `--sync-base-outside-target` 存在时才会把 `--edit-region` 传给执行管线：

```js
editRegions: args.syncBaseOutsideTarget ? args.editRegions : []
```

同时它有保护逻辑：

```js
if (args.syncBaseOutsideTarget && args.editRegions.length === 0) {
  throw new Error('--sync-base-outside-target 需要至少一个 --edit-region，避免误覆盖目标人物');
}
```

### 5.4 `src/pipeline.js` 先生成整图，再只回贴用户区域

真实执行时流程是：

1. 归档底图和用户图到 `runs/<run_id>/00_inputs/`。
2. 用视觉模型分析底图和用户头像。
3. Stage A 生成身体/比例适配图。
4. Stage B 基于 Stage A 和用户头像做身份替换。
5. 质量检查，不通过时重试。
6. 如果存在 `editRegions`，调用 `composeEditRegionsOverBase()` 生成最终图。

关键逻辑：

```js
if (editRegions.length > 0) {
  baseSync = await composeEditRegionsOverBase({
    sourceImage: baseImage,
    targetImage: selectedImage,
    outputImage: finalImage,
    regions: editRegions,
  });
  selectedStage = `${selectedStage}+base_sync`;
}
```

这里的命名容易误解，需要记住：

| 参数 | 实际含义 |
|---|---|
| `sourceImage` | 原始底图，最终画布来源 |
| `targetImage` | 模型生成图，只提供用户区域 |
| `outputImage` | 最终结果 |
| `regions` | 允许从生成图取回的用户区域 |

## 6. FFmpeg 合成原理

最终局部合成由 `composeEditRegionsOverBase()` 完成。它内部构造 FFmpeg filter graph：

1. 把原始底图缩放到生成图尺寸。
2. 从生成图裁剪 `editRegions` 指定区域。
3. 对裁剪区域增加 alpha mask。
4. 把裁剪区域 overlay 到底图相同坐标。
5. 输出 `final/result.jpg`。

等价伪代码：

```text
base_canvas = resize(base_image, generated_image.size)
patch = crop(generated_image, edit_region)
patch = apply_alpha_feather(patch, feather)
final = overlay(base_canvas, patch, edit_region.x, edit_region.y)
```

当前代码实际使用的 FFmpeg 参数形态：

```bash
ffmpeg -y \
  -i "<generated-image>" \
  -i "<base-image>" \
  -filter_complex "<filter-graph>" \
  -map "[out]" \
  -frames:v 1 \
  -q:v 2 \
  "<final/result.jpg>"
```

注意输入顺序：

```text
[0:v] = 生成图
[1:v] = 原始底图
```

`buildBaseSyncFilter()` 会先生成底图画布：

```text
[1:v]scale=<width>:<height>:flags=lanczos[base]
```

再从生成图裁剪 patch：

```text
[0:v]split=<n>[edit0][edit1]...
[edit0]crop=<w>:<h>:<x>:<y>,format=rgba,geq=...[patch0]
```

最后贴回到底图：

```text
[base][patch0]overlay=<x>:<y>[out]
```

## 7. 羽化如何实现

如果配置了 `feather`，代码会给 patch 生成透明度渐变：

```js
a='min(min(min(X,W-1-X),min(Y,H-1-Y))*255/feather,255)'
```

含义：

1. patch 边缘透明度低。
2. 越靠近 patch 中心透明度越高。
3. `feather` 越大，边缘过渡越宽。

当前场景 1 和场景 4 都用 `feather: 48`，适合 1920x2400 这类高分辨率图。一般不要小于 24，否则容易有矩形硬边；也不要盲目大于 80，否则用户区域边缘会把生成效果冲淡。

## 8. 如何复现单张图

### 8.1 准备环境

```bash
cd "/Users/ZenoWang/Documents/project/宝拉纳AIGC/faceswap-demo"
npm install
cp ".env.example" ".env"
```

`.env` 至少需要：

```text
SEEDREAM_NATIVE_API_KEY=你的火山方舟 API Key
SEEDREAM_NATIVE_API_URL=https://ark.cn-beijing.volces.com/api/v3/images/generations
VISION_API_KEY=可选，不填则复用 SEEDREAM_NATIVE_API_KEY
VISION_API_URL=https://ark.cn-beijing.volces.com/api/v3/chat/completions
```

如果没有 `.env.example`，直接新建 `.env`，填上上述字段即可。

### 8.2 运行场景 1

```bash
node run-scene.js scene1 \
  --execute \
  --env ".env" \
  --user "/path/to/user.jpg" \
  --model "doubao-seedream-4-5-251128"
```

### 8.3 运行场景 4

```bash
node run-scene.js scene4 \
  --execute \
  --env ".env" \
  --user "/path/to/user.jpg" \
  --model "doubao-seedream-5-0-260128"
```

场景 4 当前批量脚本默认优先用 Seedream 5.0，因为旧模型更容易把头像生成成近景化效果。

### 8.4 查看结果

运行完成后会输出：

```text
Faceswap demo run created: /.../faceswap-demo/runs/<run_id>
Report: final/report.md
```

重点文件：

```text
runs/<run_id>/03_stage_b_faceswap/image.jpg      # 模型整图输出，可能改到非用户区域
runs/<run_id>/final/result.jpg                   # 最终交付图，只回贴用户区域
runs/<run_id>/final/base_sync_regions.json       # 实际使用的像素区域
runs/<run_id>/final/report.md                    # 运行报告
```

验收时以 `final/result.jpg` 为准，不以 `03_stage_b_faceswap/image.jpg` 为准。

## 9. 如何批量复现

用户图放在：

```text
faceswap-demo/user/
```

执行：

```bash
node scripts/run-user-folder-scene1.js \
  --scene scene1 \
  --env ".env" \
  --user-dir "./user" \
  --concurrency 2
```

场景 4：

```bash
node scripts/run-user-folder-scene1.js \
  --scene scene4 \
  --env ".env" \
  --user-dir "./user" \
  --concurrency 2 \
  --models seedream_5_0
```

批量脚本也会调用：

```js
composeEditRegionsOverBase({
  sourceImage: baseImage,
  targetImage: stageBImage,
  outputImage: finalImage,
  regions: scene.editRegions,
});
```

所以批量产物同样只允许用户区域变更。

## 10. 如何调整用户区域

如果最终图出现以下问题，需要调整 `editRegions`：

| 现象 | 调整方式 |
|---|---|
| 用户头发或肩膀被底图切掉 | 扩大 `width` / `height`，或微调 `x` / `y` |
| 改到了旁边人物 | 缩小 `width`，或把 `x` 往目标人物中心移 |
| 边缘有明显矩形痕迹 | 增大 `feather` |
| 用户区域和底图过渡太糊 | 减小 `feather` |
| 手、酒杯、Logo 被模型改坏 | 缩小区域，不要把这些元素包进 `editRegions` |
| 用户脸完整但身体违和 | 适度扩大区域，让脖子、肩膀、衣领一起来自生成图 |

推荐调参顺序：

1. 先调 `x/y/width/height`，确保区域只覆盖目标用户。
2. 再调 `feather`，解决边缘融合。
3. 最后再调 prompt 或模型参数。

不要一开始就改 prompt。局部回贴的核心价值是把不可控问题变成可控坐标问题。

## 11. 如何检查非用户区域是否真的没变

### 11.1 看 `base_sync_regions.json`

每次成功执行后会生成：

```text
runs/<run_id>/final/base_sync_regions.json
```

里面会记录归一化坐标换算后的像素区域，例如：

```json
{
  "enabled": true,
  "source_image": ".../00_inputs/base.jpg",
  "target_image": ".../03_stage_b_faceswap/image.jpg",
  "output_image": ".../final/result.jpg",
  "regions": [
    {
      "id": "target_user",
      "x": 557,
      "y": 744,
      "width": 480,
      "height": 1488,
      "feather": 48
    }
  ]
}
```

### 11.2 对比最终图和底图

原则：

```text
final/result.jpg 在 editRegions 外应和 00_inputs/base.jpg 一致。
final/result.jpg 在 editRegions 内来自 03_stage_b_faceswap/image.jpg。
```

如果肉眼检查，重点看：

1. 其他人物脸部是否与底图一致。
2. Paulaner / FC Bayern 标识是否与底图一致。
3. 背景边缘、服装、酒杯、手部是否没有漂移。
4. `target_user` 区域边界是否自然。

## 12. 新增类似场景的模板

新增场景时复制下面结构：

```json
{
  "id": "scene_new",
  "name": "Readable Scene Name",
  "base": "scenes/your-base.png",
  "target": "clear target person description",
  "targetDetail": "detailed target location and visual relation to nearby people",
  "protectedPerson": "all people or objects that must not change",
  "syncBaseOutsideTarget": true,
  "editRegions": [
    {
      "id": "target_user",
      "x": 0.30,
      "y": 0.30,
      "width": 0.30,
      "height": 0.60,
      "feather": 48
    }
  ]
}
```

必须保留：

```json
"syncBaseOutsideTarget": true
```

并且至少配置一个 `editRegions`。这是防止模型整图输出污染其他区域的关键开关。

## 13. 常见误区

1. 误区：只靠 prompt 就能保证其他区域不变。
   事实：图片生成模型仍可能改动背景、Logo、旁边人物、手部。当前方案靠后处理强制还原。

2. 误区：`03_stage_b_faceswap/image.jpg` 就是最终图。
   事实：它是模型整图输出。最终交付必须看 `final/result.jpg`。

3. 误区：`editRegions` 越大越好。
   事实：区域越大，模型污染进入最终图的范围越大。只包住目标用户必要区域即可。

4. 误区：`feather` 越大越自然。
   事实：过大的 feather 会把用户区域边缘冲淡，甚至让底图原人物残留。

5. 误区：场景 1 的坐标可以直接套场景 4。
   事实：两个场景构图不同，必须分别配置。当前场景 1 是 `0.29,0.31,0.25,0.62,48`，场景 4 是 `0.29,0.34,0.43,0.65,48`。

## 14. 一句话交接

场景 1 和场景 4 的“只改 user 区域”是通过 `syncBaseOutsideTarget + editRegions + FFmpeg overlay` 实现的：先让模型生成整图，再以原始底图作为最终画布，只把目标用户矩形区域从生成图裁剪、羽化、贴回，因此其他区域天然保持底图原像素。
