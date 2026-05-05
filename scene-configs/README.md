# Scene Configs

这个目录只放”场景 1-4 的配置文件”。

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

---

## 版本更新规范（必读）

**每次修改本目录下的任何文件（sceneX.js / profiles.js / index.js）或生成脚本（test-faceswap-inpaint-scenes.js 等）时，必须同步更新版本记录。**

### 版本记录位置

版本更新日志统一写在：
```
docs/scene-versions/CHANGELOG.md
```

### 版本号规则

- 格式：`v<主版本>.<次版本>`，如 `v1.0` → `v1.1` → `v2.0`
- **主版本 +1**：底图更换、场景架构变更、模式切换（inpaint ↔ faceswap）
- **次版本 +1**：mask 坐标调整、prompt 增删、参数微调、negative terms 修改

### 每次修改必须完成的步骤

1. **修改代码前**：先在 `CHANGELOG.md` 末尾追加新版本号条目
2. **填写变更记录**：至少包含以下信息：

```markdown
## vX.Y — YYYY-MM-DD — <简述标题>

**修改人**: <名字>
**关联 commit**: `<commit hash>`（提交后补充）
**影响范围**: <涉及的 scene / 文件>

### 变更摘要

<具体改了什么，为什么改>

### 参数变更对照（如有坐标/数值变化）

| 参数 | 旧值 | 新值 | 原因 |
|------|------|------|------|
| ... | ... | ... | ... |
```

3. **提交时**：commit message 中包含版本号，例如：
   ```
   v1.1: adjust scene1 male mask coordinates for better chin coverage
   ```

### 当前版本

- **版本号**: v1.4
- **日期**: 2026-05-06
- **基线说明**: 全场景统一升级：hairDome mask 统一化、refNormalize、validateHeadSwap、prompt 大幅扩充，详见 `docs/scene-versions/CHANGELOG.md`
