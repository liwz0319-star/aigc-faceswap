# Scene Configs

这个目录只放“场景 1-4 的配置文件”。

后续如果你要调某一个场景，只改对应文件即可，不需要改其他场景文件：

- `scene1.js`: 场景 1 配置
- `scene2.js`: 场景 2 配置
- `scene3.js`: 场景 3 配置
- `scene4.js`: 场景 4 配置
- `profiles.js`: 多个场景共用的 inpaint prompt profile
- `index.js`: 统一导出入口

使用规则：

- 只调单个场景参数时，只修改对应的 `sceneX.js`
- 只有多个场景共用的提示词策略需要调整时，才修改 `profiles.js`
- 主运行脚本负责读取这里的配置，后续场景参数尽量不要再写回主脚本
