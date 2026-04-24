# H5_CALLBACK_URL 测试与宝塔 Node.js 项目配置

本文回答两个部署时常见问题：

- `H5_CALLBACK_URL` 能不能先写一个测试 URL？
- 是否需要在宝塔配置 Node.js 项目？

## 1. H5_CALLBACK_URL 能否先写测试 URL

可以。

`H5_CALLBACK_URL` 是合成服务在图片生成完成后，主动通知 H5 后端的回调地址。

如果正式 H5 后端接口还没有准备好，可以先使用测试 Webhook 地址进行联调。

## 2. 推荐测试 URL 方案

推荐使用 `webhook.site` 做临时测试。

操作步骤：

1. 打开：

```text
https://webhook.site
```

2. 页面会自动生成一个唯一测试 URL，例如：

```text
https://webhook.site/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

3. 把这个地址填到环境变量：

```env
H5_CALLBACK_URL=https://webhook.site/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

4. 提交一次图片合成任务。

5. 图片生成完成后，回到 `webhook.site` 页面查看是否收到 POST 请求。

收到的回调内容类似：

```json
{
  "task_id": "任务ID",
  "user_image": "生成后的图片URL"
}
```

如果能看到这个请求，说明合成服务的回调逻辑正常。

## 3. 测试 URL 注意事项

测试 URL 只能用于开发和联调，不建议用于正式环境。

正式上线时，必须改成 H5 后端自己的公网接口，例如：

```env
H5_CALLBACK_URL=https://你的H5后端域名/api/aigc/photo-callback
```

正式 H5 回调接口需要支持：

- `POST` 请求。
- `Content-Type: application/json`。
- 接收 `task_id`。
- 接收 `user_image`。
- 根据 `task_id` 保存生成结果。
- 返回成功状态，建议返回 `{"code":0}`。

## 4. 如果暂时不想配置 H5_CALLBACK_URL

也可以先留空：

```env
H5_CALLBACK_URL=
```

留空后：

- 不影响提交合成任务。
- 不影响图片生成。
- 生成完成后不会主动通知 H5。
- 业务侧需要通过查询接口获取任务状态和结果。

所以，部署初期可以选择：

```env
H5_CALLBACK_URL=
```

或：

```env
H5_CALLBACK_URL=https://webhook.site/你的测试URL
```

## 5. 是否需要在宝塔配置 Node.js 项目

需要。

这个项目的后端是 Node.js 服务，必须在宝塔中配置并运行 Node.js 项目，否则以下功能都不会工作：

- 提交合成任务接口。
- 查询任务状态接口。
- Redis 队列。
- 图片生成任务处理。
- 生成完成后的 H5 回调。

## 6. 宝塔 Node.js 项目配置

项目后端目录是：

```text
球星球迷合照/server
```

宝塔 Node.js 项目建议配置：

```text
项目目录：/你的服务器路径/球星球迷合照/server
启动文件：src/app.js
启动命令：npm start
端口：3000
Node 版本：建议 Node.js 18 或 Node.js 20
```

项目的 `package.json` 中启动脚本是：

```json
{
  "scripts": {
    "start": "node src/app.js"
  }
}
```

所以宝塔中使用 `npm start` 即可。

## 7. 宝塔环境变量示例

如果使用 `webhook.site` 测试回调：

```env
PORT=3000
NODE_ENV=production
ENABLE_EMBEDDED_WORKER=true

SERVER_API_KEY=请填写一个强随机字符串

H5_CALLBACK_URL=https://webhook.site/你的唯一ID

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

如果暂时不配置回调：

```env
PORT=3000
NODE_ENV=production
ENABLE_EMBEDDED_WORKER=true

SERVER_API_KEY=请填写一个强随机字符串

H5_CALLBACK_URL=

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

如果宝塔 Redis 设置了密码：

```env
REDIS_PASSWORD=你的Redis密码
```

如果宝塔 Redis 没有设置密码：

```env
REDIS_PASSWORD=
```

## 8. 推荐部署顺序

1. 在宝塔安装 Node.js。
2. 在宝塔安装 Redis。
3. 确认 Redis 是否需要密码。
4. 在宝塔创建 Node.js 项目，目录选择 `球星球迷合照/server`。
5. 配置环境变量。
6. 启动 Node.js 项目。
7. 访问健康检查接口或提交测试任务。
8. 如果配置了 `webhook.site`，等待生成完成后检查是否收到回调。
9. 正式上线前，将 `H5_CALLBACK_URL` 改成 H5 后端正式接口。

## 9. 结论

`H5_CALLBACK_URL` 可以先写测试 URL，推荐使用：

```env
H5_CALLBACK_URL=https://webhook.site/你的唯一ID
```

也可以先留空：

```env
H5_CALLBACK_URL=
```

但宝塔必须配置 Node.js 项目，并运行 `球星球迷合照/server` 目录下的后端服务。

