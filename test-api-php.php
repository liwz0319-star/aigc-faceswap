<?php
/**
 * 拜仁球星球迷合照 API 测试脚本 (PHP)
 * 用法: php test-api-php.php [API_KEY]
 */

$HOST   = '111.229.177.65';
$API_KEY = isset($argv[1]) ? $argv[1] : 'your_server_api_key_here';

echo "=== 拜仁球星球迷合照 API 测试 ===\n\n";
echo "目标: http://{$HOST}\n";
echo "API Key: " . substr($API_KEY, 0, 6) . '...' . substr($API_KEY, -4) . "\n\n";

// 通用请求函数
function apiRequest($method, $url, $body = null, $apiKey = null) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HEADER         => false,
    ]);
    $headers = ['Content-Type: application/json'];
    if ($apiKey) $headers[] = "x-api-key: {$apiKey}";
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    if ($body) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);

    $resp     = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($error) return ['error' => $error];
    return ['status' => $httpCode, 'body' => $resp];
}

// 1. 健康检查
echo "【1】健康检查 GET /health\n";
$r = apiRequest('GET', "http://{$HOST}/health");
if (isset($r['error'])) {
    echo "  错误: {$r['error']}\n";
} else {
    echo "  HTTP 状态码: {$r['status']}\n";
    echo "  响应: " . substr($r['body'], 0, 200) . "\n";
    echo $r['status'] === 200 ? "  结果: OK ✓\n" : "  结果: FAIL ✗\n";
}

// 2. 提交合成任务
echo "\n【2】提交合成任务 POST /api/v1/synthesis/submit\n";
$submitBody = json_encode([
    'star_ids'   => ['101', '105', '108'],
    'scene_id'   => 'scene_03',
    'user_image' => 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png',
]);
$r = apiRequest('POST', "http://{$HOST}/api/v1/synthesis/submit", $submitBody, $API_KEY);
if (isset($r['error'])) {
    echo "  错误: {$r['error']}\n";
} else {
    echo "  HTTP 状态码: {$r['status']}\n";
    $j = json_decode($r['body'], true);
    if ($j) {
        echo "  code: " . ($j['code'] ?? 'N/A') . "\n";
        echo "  message: " . ($j['message'] ?? 'N/A') . "\n";
        if (isset($j['data'])) {
            echo "  task_id: " . ($j['data']['task_id'] ?? 'N/A') . "\n";
            echo "  status: " . ($j['data']['status'] ?? 'N/A') . "\n";
        }
    } else {
        echo "  响应: " . substr($r['body'], 0, 200) . "\n";
    }
    echo $r['status'] === 200 ? "  结果: OK ✓\n" : "  结果: FAIL ✗\n";
}

// 3. 查询接口
echo "\n【3】查询接口 GET /api/v1/synthesis/query/test_123\n";
$r = apiRequest('GET', "http://{$HOST}/api/v1/synthesis/query/test_123", null, $API_KEY);
if (isset($r['error'])) {
    echo "  错误: {$r['error']}\n";
} else {
    echo "  HTTP 状态码: {$r['status']}\n";
    echo "  响应: " . substr($r['body'], 0, 200) . "\n";
    echo in_array($r['status'], [200, 404]) ? "  结果: OK ✓\n" : "  结果: FAIL ✗\n";
}

// 4. 鉴权测试（不带 key）
echo "\n【4】鉴权测试 POST /api/v1/synthesis/submit (不带 API Key)\n";
$noKeyBody = json_encode(['star_ids' => ['101'], 'scene_id' => 'scene_03', 'user_image' => 'test']);
$r = apiRequest('POST', "http://{$HOST}/api/v1/synthesis/submit", $noKeyBody);
if (isset($r['error'])) {
    echo "  错误: {$r['error']}\n";
} else {
    echo "  HTTP 状态码: {$r['status']}\n";
    echo "  响应: " . substr($r['body'], 0, 200) . "\n";
    echo $r['status'] === 401 ? "  鉴权生效 ✓\n" : "  鉴权未生效，请检查 SERVER_API_KEY 配置\n";
}

echo "\n=== 测试完成 ===\n";
