# 球星球迷合照 AIGC 合成服务 API 文档

版本：v4.0  
更新：2026-04-12  
依据：`H5技术对接(2).doc`

## 1. 对接角色

本服务为交接文档中的“贵司技术合成”服务，负责：

- 接收 H5 后端提交的球星、场景、用户自拍
- 创建异步合成任务并立即返回 `task_id`
- 生成完成后调用 H5 后端提供的“返回结果接口”

H5 后端负责：

- 调用本服务的提交合成接口
- 提供一个可公网访问的结果回调接口
- 接收回调后把合成照片展示给 H5 前端

## 2. 提交合成接口

接口地址：

```http
POST /api/v1/synthesis/submit
```

请求头：

```http
Content-Type: application/json
x-api-key: your_api_key_here
```

说明：

- `x-api-key` 只有在服务端配置了真实 `SERVER_API_KEY` 时才校验。
- 交接文档只要求 H5 传 `star_ids`、`scene_id`、`user_image` 三个字段。
- H5 回调地址推荐由服务端环境变量 `H5_CALLBACK_URL` 固定配置。

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
  "user_image": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
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

失败响应：

```json
{
  "code": 400,
  "message": "无效的 scene_id: scene_99",
  "data": null
}
```

## 3. H5 返回结果接口

该接口由 H5 后端提供，本服务生成完成后调用。

请求方式：

```http
POST [H5提供的回调地址]
Content-Type: application/json
```

本服务请求参数：

| 参数名 | 类型 | 说明 | 示例 |
| --- | --- | --- | --- |
| `task_id` | `String` | 本服务在提交接口返回的任务 ID | `"task_123456789"` |
| `user_image` | `String` | 合成完成后的结果图片 URL | `"https://oss.example.com/result.jpg"` |

成功回调示例：

```json
{
  "task_id": "task_123456789",
  "user_image": "https://oss.example.com/result.jpg"
}
```

H5 后端建议响应：

```json
{
  "code": 0,
  "msg": "success"
}
```

说明：

- 交接文档没有定义失败回调结构，因此本服务只按文档格式发送成功结果回调。
- 生成失败信息会保留在服务日志和查询接口中，便于排查。

## 4. 查询任务状态接口

该接口不是交接文档的必要接口，保留用于调试、运维和 H5 兜底轮询。

接口地址：

```http
GET /api/v1/synthesis/query/:taskId
```

响应示例：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "task_123456789",
    "status": "completed",
    "results": [
      {
        "player_names": ["Alphonso Davies", "Luis Díaz", "Manuel Neuer"],
        "image_url": "https://...",
        "urls": ["https://..."],
        "user_description": "A male..."
      }
    ],
    "error": null
  }
}
```

状态枚举：

- `pending`：已入队，等待执行
- `processing`：处理中
- `completed`：已完成
- `failed`：已失败

## 5. ID 对照

球星 ID：

| H5 球星 ID | 内部 ID | 球星 |
| --- | --- | --- |
| `101` | `1` | Alphonso Davies |
| `102` | `2` | Michael Olise |
| `103` | `3` | Joshua Kimmich |
| `104` | `4` | Harry Kane |
| `105` | `5` | Luis Díaz |
| `106` | `6` | Lennart Karl |
| `107` | `7` | Jamal Musiala |
| `108` | `8` | Manuel Neuer |
| `109` | `9` | Aleksandar Pavlovic |
| `110` | `10` | Dayot Upamecano |

场景 ID：

| H5 场景 ID | 内部 ID | 场景 |
| --- | --- | --- |
| `scene_01` | `1` | Oktoberfest Gathering |
| `scene_02` | `2` | Locker Room Celebration |
| `scene_03` | `3` | Championship Shower |
| `scene_04` | `4` | Bernie Mascot Interaction |

## 6. 必要环境变量

```bash
SEEDREAM_MODE=native
SEEDREAM_NATIVE_API_KEY=your_seedream_native_api_key
SEEDREAM_NATIVE_API_URL=https://ark.cn-beijing.volces.com/api/v3/images/generations
SEEDREAM_NATIVE_MODEL=doubao-seedream-4-5-251128

LAS_API_KEY=your_las_api_key
LAS_BASE_URL=https://operator.las.cn-beijing.volces.com/api/v1
VISION_MODEL=gemini-2.5-flash

PORT=3000
NODE_ENV=production
DEFAULT_USER_MODE=child
SERVER_API_KEY=your_server_api_key
H5_CALLBACK_URL=https://h5.example.com/api/callback

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
TASK_RETENTION_SECONDS=7200
MAX_CONCURRENT=3
```

## 7. 部署说明

单进程部署：

```bash
npm start
```

API 和 Worker 分离部署：

```bash
ENABLE_EMBEDDED_WORKER=false npm start
npm run worker
```

Redis 必须可用，否则服务启动会失败。
