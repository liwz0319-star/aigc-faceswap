# H5 与 AIGC 合成服务 API 接口文档

依据：`H5技术对接(2).doc`  
我方角色：交接文档中的“贵司”，即 AIGC 合成服务提供方。

## 1. 业务流程

```text
H5 采集：10 选 3 球星 + 3 选 1 场景 + 1 张自拍
  ↓
H5 后端调用我方提交合成接口
  ↓
我方创建合成任务，立即返回 task_id
  ↓
我方异步生成合成照片
  ↓
我方调用 H5 后端提供的返回结果接口
  ↓
H5 展示合成照片
```

## 2. 提交合成接口（我方提供）

Base URL：

```text
http://<服务器地址>:3000/api/v1/synthesis
```

接口：

```http
POST /submit
Content-Type: application/json
```

生产环境如开启鉴权，需要增加：

```http
x-api-key: <SERVER_API_KEY>
```

请求参数：

| 参数名 | 类型 | 必填 | 说明 | 示例 |
| --- | --- | --- | --- | --- |
| `star_ids` | `Array` | 是 | 选中的 3 个球星 ID | `["101", "105", "108"]` |
| `scene_id` | `String` | 是 | 选中的场景 ID | `"scene_03"` |
| `user_image` | `String` | 是 | 用户自拍，Base64 或图片地址 | `"data:image/jpeg;base64,..."` |

请求示例：

```json
{
  "star_ids": ["101", "105", "108"],
  "scene_id": "scene_03",
  "user_image": "data:image/jpeg;base64,/9j/4AAQ..."
}
```

成功响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "task_123456789",
    "status": "processing"
  }
}
```

失败响应示例：

```json
{
  "code": 400,
  "message": "必须选择恰好3个球星",
  "data": null
}
```

## 3. 返回结果接口（H5 提供，我方调用）

接口地址由 H5 提供，部署时配置为 `H5_CALLBACK_URL`。

```http
POST <H5提供的回调地址>
Content-Type: application/json
```

我方回调参数：

| 参数名 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `task_id` | `String` | 我方提交接口返回的任务 ID | `"task_123456789"` |
| `user_image` | `String` | 合成完成后的图片 URL 地址 | `"https://oss.example.com/result.jpg"` |

我方回调示例：

```json
{
  "task_id": "task_123456789",
  "user_image": "https://oss.example.com/result.jpg"
}
```

H5 建议响应：

```json
{
  "code": 0,
  "msg": "success"
}
```

说明：

- 交接文档没有定义失败回调结构，因此我方只按文档发送成功结果回调。
- 生成失败时，错误会记录在我方服务日志和查询接口中。

## 4. 查询接口（非交接必需，运维兜底）

该接口保留用于排查和兜底轮询，不属于交接文档中的核心接口。

```http
GET /query/:taskId
```

完成响应示例：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "task_123456789",
    "status": "completed",
    "results": [
      {
        "image_url": "https://...",
        "player_names": ["Alphonso Davies", "Luis Díaz", "Manuel Neuer"]
      }
    ],
    "error": null
  }
}
```

## 5. ID 对照表

球星 ID：

| ID | 球星名 |
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

场景 ID：

| ID | 场景名 | 类型 |
| --- | --- | --- |
| `scene_01` | Oktoberfest Gathering | 常规 |
| `scene_02` | Locker Room Celebration | 常规 |
| `scene_03` | Championship Shower | 隐藏 |
| `scene_04` | Bernie Mascot Interaction | 常规 |

## 6. H5 对接注意事项

- H5 只需要传 `star_ids`、`scene_id`、`user_image`。
- `user_image` 支持 `data:image/jpeg;base64,...` 或 HTTP/HTTPS 图片地址。
- 我方提交接口会立即返回 `task_id`，不会等待图片生成完成。
- 图片生成完成后，我方会回调 H5 提供的接口，回调字段为 `task_id` 和 `user_image`。
- H5 收到回调后，用回调里的 `user_image` 作为合成结果图 URL 展示。
