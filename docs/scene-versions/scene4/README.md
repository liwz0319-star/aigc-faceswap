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
