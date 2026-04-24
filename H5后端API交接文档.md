# 拜仁球星球迷合照 H5 后端 API 交接文档

版本：v1.1  
日期：2026-04-17  
对接方向：H5 后端调用 AIGC 合成服务，AIGC 合成服务生成完成后回调 H5 后端

---

## 1. 对接结论

本项目已封装为后端 API，服务已部署上线。H5 后端只需提交合成任务，无需等待图片同步生成。

完整链路如下：

1. H5 前端采集用户选择的 3 个球星、1 个场景、用户照片。
2. H5 后端调用我方提交合成接口。
3. 我方接口立即返回 `task_id` 和 `status: "processing"`。
4. 我方服务异步生成合照（约 30～90 秒）。
5. 生成完成后，我方服务主动 POST H5 后端提供的回调接口。
6. H5 后端根据 `task_id` 保存生成结果图片地址 `user_image`，再通知或供 H5 前端查询展示。

---

## 2. 服务地址

当前服务地址：

```text
http://111.229.177.65
```

健康检查：

```http
GET http://111.229.177.65/health
```

> 生产环境建议后续替换为正式 HTTPS 域名。如正式域名上线，本文档中的 `http://111.229.177.65` 统一替换为正式域名即可。

---

## 3. 鉴权方式

H5 后端调用我方接口时，需在 Header 中传入 API Key：

```http
Content-Type: application/json
x-api-key: <SERVER_API_KEY>
```

- `<SERVER_API_KEY>` 由我方单独提供，请妥善保管。
- API Key 不得写入前端代码，必须保存在 H5 后端服务端配置中，不下发到浏览器。
- H5 前端不要直接调用我方接口，需由 H5 后端转发。

---

## 4. 提交合成任务接口

### 4.1 接口地址

```http
POST http://111.229.177.65/api/v1/synthesis/submit
```

### 4.2 请求 Header

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | 固定为 `application/json` |
| `x-api-key` | 是 | 我方提供的接口密钥 |

### 4.3 请求 Body

**必填字段：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `star_ids` | array | 是 | 球星 ID 数组，必须且只能传 3 个，不能重复 |
| `scene_id` | string | 是 | 场景 ID |
| `user_image` | string | 是 | 用户照片，支持图片 URL 或 `data:image/...;base64,...` |

**可选字段：**

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `user_mode` | string | `"child"` | 用户类型，`"adult"` 或 `"child"` |
| `gender` | string | `"male"` | 用户性别，`"male"` 或 `"female"` |
| `callback_url` | string | 服务器配置值 | 本次任务单独指定回调地址，不填则使用服务器默认配置的 `H5_CALLBACK_URL` |

> `user_mode` 影响生成提示词风格，正式业务建议根据实际用户类型传入。
> `gender` 影响人像生成效果，建议前端采集用户性别后传入，不传默认 `male`。

**最简请求示例（Base64）：**

```json
{
  "star_ids": ["101", "105", "108"],
  "scene_id": "scene_03",
  "user_image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
}
```

**带可选字段示例：**

```json
{
  "star_ids": ["101", "105", "108"],
  "scene_id": "scene_03",
  "user_image": "https://h5-cdn.example.com/uploads/user-photo.jpg",
  "user_mode": "adult",
  "gender": "female"
}
```

### 4.4 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "task_1234567890abcdef",
    "status": "processing"
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `code` | number | `0` 表示提交成功 |
| `data.task_id` | string | 任务 ID，H5 后端需保存此值 |
| `data.status` | string | 固定返回 `processing` |

**H5 后端处理建议：**

- 保存 `task_id` 与用户业务订单、用户 ID 之间的关联关系。
- 前端页面显示"生成中"状态。
- 最终图片结果以我方回调推送为准。

---

## 5. H5 后端回调接口要求

### 5.1 H5 后端需提供的地址

H5 后端需提供一个**公网可访问的 HTTPS POST 接口**，例如：

```text
https://h5-domain.example.com/api/aigc/photo-callback
```

此地址将配置为我方服务端环境变量 `H5_CALLBACK_URL`。

> - 该接口须能被服务器 `111.229.177.65` 访问。
> - 建议使用 HTTPS。
> - 如回调接口需鉴权，请提前告知我方鉴权方式，当前默认回调只发 JSON，不带额外 Header。

### 5.2 我方回调请求

图片生成完成后，我方向 `H5_CALLBACK_URL` 发送 POST 请求：

```http
POST <H5_CALLBACK_URL>
Content-Type: application/json
```

请求体：

```json
{
  "task_id": "task_1234567890abcdef",
  "user_image": "https://result-cdn.example.com/generated/result.jpg"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `task_id` | string | 提交任务时返回的任务 ID |
| `user_image` | string | 生成完成的合照图片 URL |

### 5.3 H5 后端回调响应要求

收到回调并保存成功后，建议返回：

```json
{
  "code": 0,
  "msg": "success"
}
```

我方重试规则：

- HTTP 请求失败、超时、或响应 `code` 非 `0` 时自动重试。
- 回调超时时间：10 秒。
- 最多重试 3 次，重试间隔约 2 秒、5 秒、10 秒。

**H5 后端注意事项：**

- 回调接口须支持**幂等处理**。
- 同一 `task_id` 可能因网络问题收到重复回调，如已存在直接更新或返回成功即可。
- 回调接口不建议执行耗时操作，保存结果后尽快返回。

---

## 6. 查询接口（兜底备用）

正式链路以回调为主。查询接口仅用于排查或前端轮询兜底。

### 6.1 接口地址

```http
GET http://111.229.177.65/api/v1/synthesis/query/{task_id}
```

请求 Header：

```http
x-api-key: <SERVER_API_KEY>
```

### 6.2 响应示例

处理中：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "task_1234567890abcdef",
    "status": "processing",
    "results": [],
    "error": null
  }
}
```

已完成：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "task_1234567890abcdef",
    "status": "completed",
    "results": [
      {
        "player_names": ["Alphonso Davies", "Luis Díaz", "Manuel Neuer"],
        "image_url": "https://result-cdn.example.com/generated/result.jpg",
        "urls": ["https://result-cdn.example.com/generated/result.jpg"]
      }
    ],
    "error": null
  }
}
```

失败：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "task_1234567890abcdef",
    "status": "failed",
    "results": [],
    "error": "失败原因描述"
  }
}
```

状态值说明：

| 状态 | 说明 |
| --- | --- |
| `processing` | 任务处理中 |
| `completed` | 任务完成 |
| `failed` | 任务失败 |

---

## 7. 字段取值范围

### 7.1 球星 ID

`star_ids` 必须选择 3 个（不能重复）：

| ID | 球星 |
| --- | --- |
| `101` | Alphonso Davies |
| `102` | Michael Olise |
| `103` | Joshua Kimmich |
| `104` | Harry Kane |
| `105` | Luis Díaz |
| `106` | Lennart Karl |
| `107` | Jamal Musiala |
| `108` | Manuel Neuer |
| `109` | Aleksandar Pavlović |
| `110` | Dayot Upamecano |

### 7.2 场景 ID

| ID | 场景 |
| --- | --- |
| `scene_01` | Oktoberfest Gathering |
| `scene_02` | Locker Room Celebration |
| `scene_03` | Championship Shower |
| `scene_04` | Bernie Mascot Interaction |

---

## 8. 错误响应

所有错误响应格式：

```json
{
  "code": 400,
  "message": "错误原因",
  "data": null
}
```

常见错误：

| HTTP 状态码 | `code` | 说明 |
| --- | --- | --- |
| 400 | 400 | 参数错误（球星数量不是 3 个、场景 ID 无效、图片格式无效等） |
| 401 | 401 | `x-api-key` 缺失或错误 |
| 404 | 404 | 查询的任务不存在 |
| 429 | 429 | 请求过于频繁（每 IP 每分钟最多 10 次） |
| 500 | 500 | 服务内部异常 |

参数校验规则：

- `star_ids` 必须是数组，正好 3 个，不能重复。
- `scene_id` 必须是有效场景 ID。
- `user_image` 必须是 HTTP/HTTPS 图片 URL 或 `data:image/...;base64,...`。
- `user_mode` 只能是 `adult` 或 `child`。
- `gender` 只能是 `male` 或 `female`。
- 单次 JSON 请求体大小限制为 10 MB。

---

## 9. 调用示例

### curl

```bash
curl -X POST "http://111.229.177.65/api/v1/synthesis/submit" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <SERVER_API_KEY>" \
  -d '{
    "star_ids": ["101", "105", "108"],
    "scene_id": "scene_03",
    "user_image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...",
    "user_mode": "adult",
    "gender": "female"
  }'
```

### Node.js

```js
const axios = require('axios');

const response = await axios.post(
  'http://111.229.177.65/api/v1/synthesis/submit',
  {
    star_ids: ['101', '105', '108'],
    scene_id: 'scene_03',
    user_image: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...',
    user_mode: 'adult',
    gender: 'female',
  },
  {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': '<SERVER_API_KEY>',
    },
    timeout: 15000,
  }
);

const { task_id } = response.data.data;
// 保存 task_id 与业务记录的关联
```

### Java（伪代码）

```text
POST http://111.229.177.65/api/v1/synthesis/submit
Header:
  Content-Type: application/json
  x-api-key: <SERVER_API_KEY>
Body:
{
  "star_ids": ["101", "105", "108"],
  "scene_id": "scene_03",
  "user_image": "data:image/jpeg;base64,...",
  "user_mode": "adult",
  "gender": "female"
}
```

---

## 10. H5 后端需要完成的工作

1. 提供公网 HTTPS 回调接口地址（即 `H5_CALLBACK_URL`）给我方配置。
2. 回调接口接收 `task_id` 和 `user_image`，幂等保存生成结果。
3. 提交任务时保存我方返回的 `task_id`，与用户业务记录绑定。
4. 前端查询生成状态时，通过 H5 自身业务接口返回结果，不直接暴露我方接口给前端。
5. API Key 只保存在 H5 后端服务端，禁止下发到浏览器。

---

## 11. 联调检查清单

**联调前确认：**

- [ ] H5 后端已收到 `<SERVER_API_KEY>`
- [ ] H5 后端已提供 `H5_CALLBACK_URL`，已告知我方配置
- [ ] `H5_CALLBACK_URL` 可被 `111.229.177.65` 公网访问
- [ ] `H5_CALLBACK_URL` 支持 POST JSON
- [ ] H5 后端能保存 `task_id` 与用户业务记录的绑定关系

**联调步骤：**

1. H5 后端调用提交合成任务接口。
2. 确认响应 `code: 0`、有效 `task_id`、`status: "processing"`。
3. H5 后端保存 `task_id`。
4. 等待约 30～90 秒，等我方服务生成完成。
5. H5 后端确认收到回调，回调体包含 `task_id` 和 `user_image`。
6. H5 前端通过 H5 自身接口取回 `user_image` 并展示。

---

## 12. 需要 H5 后端提供给我方的信息

请提供以下信息用于配置：

```text
H5_CALLBACK_URL=https://你的正式回调接口地址
```

如回调接口需鉴权，一并提供：

```text
回调鉴权方式：
Header 名称：
Header 值：
验签规则：
```

当前我方默认回调请求不带额外鉴权 Header。如必须鉴权，需双方确认后补充配置。
