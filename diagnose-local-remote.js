const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const PROJECT_ROOT = __dirname;
const LOCAL_ENV_PATH = path.join(PROJECT_ROOT, 'server', '.env');
const DEFAULT_REMOTE_URL = 'http://111.229.177.65:3001';
const DEFAULT_LOCAL_URL = 'http://127.0.0.1:3001';
const DEFAULT_REMOTE_API_KEY = 'StavZC8fVTLd4xOkhqKbsyGjgEn39WHF6RmBA2eUIl7MYNPc';
const DEFAULT_STAR_IDS = ['104', '105', '107'];
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;
const VOLATILE_KEYS = new Set([
  'created_at',
  'started_at',
  'completed_at',
  'failed_at',
  'elapsed_ms',
  'total_elapsed_ms',
]);
let inlineLocalApp = null;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

const LOCAL_ENV = parseEnvFile(LOCAL_ENV_PATH);

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = 'true';
      continue;
    }
    result[key] = next;
    i += 1;
  }
  return result;
}

function normalizeBaseUrl(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeFileLabel(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function toDataUrl(imagePath) {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function buildHeaders(apiKey, payload) {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
  };
}

function requestJson(method, urlString, apiKey, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = body ? JSON.stringify(body) : null;
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: buildHeaders(apiKey, payload),
      timeout: 30000,
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch (error) {
            return reject(new Error(`JSON parse failed: ${error.message}; body=${raw.slice(0, 500)}`));
          }
        }
        resolve({ status: res.statusCode, data, raw });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function submitTask(baseUrl, apiKey, payload) {
  const response = await requestJson('POST', `${baseUrl}/api/v1/synthesis/submit`, apiKey, payload);
  if (response.status !== 200 || response.data?.code !== 0) {
    throw new Error(`submit failed: HTTP ${response.status} ${response.raw?.slice(0, 300)}`);
  }
  return response.data.data.task_id;
}

async function queryTask(baseUrl, apiKey, taskId) {
  const response = await requestJson('GET', `${baseUrl}/api/v1/synthesis/query/${taskId}`, apiKey);
  if (response.status !== 200 || response.data?.code !== 0) {
    throw new Error(`query failed: HTTP ${response.status} ${response.raw?.slice(0, 300)}`);
  }
  return response.data.data;
}

async function fetchDiagnostics(baseUrl, apiKey, taskId) {
  const response = await requestJson('GET', `${baseUrl}/api/v1/synthesis/diagnostics/${taskId}`, apiKey);
  if (response.status === 404) return null;
  if (response.status !== 200 || response.data?.code !== 0) {
    throw new Error(`diagnostics failed: HTTP ${response.status} ${response.raw?.slice(0, 300)}`);
  }
  return response.data.data;
}

async function waitForTerminalStatus(baseUrl, apiKey, taskId, timeoutMs, pollIntervalMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const task = await queryTask(baseUrl, apiKey, taskId);
    console.log(`[${label}] ${taskId} -> ${task.status}`);
    if (task.status === 'completed' || task.status === 'failed') {
      return task;
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`poll timeout after ${timeoutMs}ms`);
}

function normalizeForComparison(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeForComparison);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const result = {};
  for (const [key, innerValue] of Object.entries(value)) {
    if (VOLATILE_KEYS.has(key)) continue;
    result[key] = normalizeForComparison(innerValue);
  }
  return result;
}

function getAtPath(object, dottedPath) {
  return dottedPath.split('.').reduce((current, part) => (
    current && Object.prototype.hasOwnProperty.call(current, part) ? current[part] : undefined
  ), object);
}

function diffValues(left, right, basePath = '') {
  if (left === right) return [];

  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray || rightArray) {
    if (!(leftArray && rightArray)) {
      return [{ path: basePath, type: 'type_mismatch', left, right }];
    }
    const diffs = [];
    if (left.length !== right.length) {
      diffs.push({ path: basePath, type: 'array_length_mismatch', left: left.length, right: right.length });
    }
    const maxLength = Math.max(left.length, right.length);
    for (let i = 0; i < maxLength; i += 1) {
      diffs.push(...diffValues(left[i], right[i], `${basePath}[${i}]`));
    }
    return diffs;
  }

  const leftObject = left && typeof left === 'object';
  const rightObject = right && typeof right === 'object';
  if (leftObject || rightObject) {
    if (!(leftObject && rightObject)) {
      return [{ path: basePath, type: 'type_mismatch', left, right }];
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    const diffs = [];
    for (const key of keys) {
      const nextPath = basePath ? `${basePath}.${key}` : key;
      if (!Object.prototype.hasOwnProperty.call(left, key)) {
        diffs.push({ path: nextPath, type: 'missing_left', right: right[key] });
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(right, key)) {
        diffs.push({ path: nextPath, type: 'missing_right', left: left[key] });
        continue;
      }
      diffs.push(...diffValues(left[key], right[key], nextPath));
    }
    return diffs;
  }

  return [{ path: basePath, type: 'value_mismatch', left, right }];
}

function summarizeStepDiffs(leftDiagnostics, rightDiagnostics) {
  const steps = [
    ['request', '提交参数'],
    ['route_resolution', '路由分流'],
    ['runtime', '运行环境'],
    ['worker.vision', '视觉描述'],
    ['worker.resolution', 'Worker 决策'],
    ['reference_preprocess', '参考图预处理'],
    ['prompt', 'Prompt'],
    ['mask', 'Mask'],
    ['attempts', '生成尝试'],
    ['scene1_v3', 'Scene1V3'],
    ['final_result', '最终结果'],
  ];
  return steps.map(([pathName, label]) => {
    const leftValue = getAtPath(leftDiagnostics, pathName);
    const rightValue = getAtPath(rightDiagnostics, pathName);
    const diffs = diffValues(leftValue, rightValue, pathName);
    return {
      step: pathName,
      label,
      equal: diffs.length === 0,
      diff_count: diffs.length,
      sample_diffs: diffs.slice(0, 20),
    };
  });
}

function buildMarkdownReport(context) {
  const lines = [];
  lines.push('# 本地/线上一致性诊断');
  lines.push('');
  lines.push(`- 左侧: ${context.left.label} (${context.left.baseUrl})`);
  lines.push(`- 右侧: ${context.right.label} (${context.right.baseUrl})`);
  lines.push(`- 左任务: ${context.left.taskId}`);
  lines.push(`- 右任务: ${context.right.taskId}`);
  lines.push('');
  lines.push('## 最终状态');
  lines.push('');
  lines.push(`- 左侧状态: ${context.left.finalTask?.status || 'unknown'}`);
  lines.push(`- 右侧状态: ${context.right.finalTask?.status || 'unknown'}`);
  if (context.left.finalTask?.error || context.right.finalTask?.error) {
    lines.push(`- 左侧错误: ${context.left.finalTask?.error || 'none'}`);
    lines.push(`- 右侧错误: ${context.right.finalTask?.error || 'none'}`);
  }
  lines.push('');
  lines.push('## 步骤差异');
  lines.push('');
  for (const step of context.stepDiffs) {
    lines.push(`### ${step.label} \`${step.step}\``);
    if (step.equal) {
      lines.push('');
      lines.push('- 无差异');
      lines.push('');
      continue;
    }
    lines.push('');
    lines.push(`- 差异数: ${step.diff_count}`);
    for (const diff of step.sample_diffs.slice(0, 8)) {
      lines.push(`- ${diff.path}: ${diff.type}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function loadTaskSide({ label, baseUrl, apiKey, taskId, payload, timeoutMs, pollIntervalMs }) {
  let resolvedTaskId = taskId || null;
  if (!resolvedTaskId) {
    resolvedTaskId = await submitTask(baseUrl, apiKey, payload);
    console.log(`[${label}] submitted ${resolvedTaskId}`);
  }
  const finalTask = await waitForTerminalStatus(baseUrl, apiKey, resolvedTaskId, timeoutMs, pollIntervalMs, label);
  const diagnostics = await fetchDiagnostics(baseUrl, apiKey, resolvedTaskId).catch(error => ({
    diagnostics_error: error.message,
  }));
  return {
    label,
    baseUrl,
    apiKeyPresent: Boolean(apiKey),
    taskId: resolvedTaskId,
    finalTask,
    diagnostics,
  };
}

async function maybeStartInlineLocalServer({ enabled, baseUrl }) {
  if (!enabled) return;
  const url = new URL(baseUrl);
  const isLocalHost = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!isLocalHost) return;
  if (inlineLocalApp) return;

  for (const [key, value] of Object.entries(LOCAL_ENV)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
  process.env.TASK_QUEUE_MODE = 'memory';
  process.env.ENABLE_EMBEDDED_WORKER = process.env.ENABLE_EMBEDDED_WORKER || 'true';
  const appModule = require('./server/src/app');
  if (typeof appModule.startServer !== 'function') {
    throw new Error('Inline local server startServer() is unavailable');
  }
  await appModule.startServer();
  inlineLocalApp = appModule;
}

async function maybeStopInlineLocalServer() {
  if (!inlineLocalApp || typeof inlineLocalApp.gracefulShutdown !== 'function') {
    return;
  }
  const gracefulShutdown = inlineLocalApp.gracefulShutdown;
  const originalExit = process.exit;
  process.exit = () => {};
  try {
    await gracefulShutdown('diagnose-local-remote');
  } finally {
    process.exit = originalExit;
    inlineLocalApp = null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const leftBaseUrl = normalizeBaseUrl(args['left-url'] || process.env.LEFT_BASE_URL || DEFAULT_LOCAL_URL);
  const rightBaseUrl = normalizeBaseUrl(args['right-url'] || process.env.RIGHT_BASE_URL || DEFAULT_REMOTE_URL);
  const leftLabel = args['left-label'] || 'local';
  const rightLabel = args['right-label'] || 'remote';
  const leftApiKey = args['left-api-key'] || process.env.LEFT_API_KEY || LOCAL_ENV.SERVER_API_KEY || '';
  const rightApiKey = args['right-api-key'] || process.env.RIGHT_API_KEY || process.env.SERVER_API_KEY || DEFAULT_REMOTE_API_KEY;
  const timeoutMs = Number(args['timeout-ms'] || process.env.DIAG_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = Number(args['poll-interval-ms'] || process.env.DIAG_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
  const inlineLocal = parseBooleanFlag(args['inline-local'] ?? process.env.DIAG_INLINE_LOCAL, true);

  let payload = null;
  if (!args['left-task'] || !args['right-task']) {
    if (!args.photo || !args.scene) {
      throw new Error('When task ids are not provided, --photo and --scene are required');
    }
    const photoPath = path.resolve(PROJECT_ROOT, args.photo);
    if (!fs.existsSync(photoPath)) {
      throw new Error(`Photo not found: ${photoPath}`);
    }
    payload = {
      star_ids: (args['star-ids'] || DEFAULT_STAR_IDS.join(',')).split(',').map(v => v.trim()).filter(Boolean),
      scene_id: args.scene,
      user_images: [toDataUrl(photoPath)],
      ...(args.gender ? { gender: args.gender } : {}),
    };
  }

  const outputDir = path.join(
    PROJECT_ROOT,
    '下载结果',
    `diagnostic_compare_${nowStamp()}_${safeFileLabel(args.scene || 'tasks')}`
  );
  fs.mkdirSync(outputDir, { recursive: true });

  if (payload) {
    writeJson(path.join(outputDir, 'request_payload.json'), payload);
  }

  await maybeStartInlineLocalServer({ enabled: inlineLocal, baseUrl: leftBaseUrl });

  let left;
  let right;
  try {
    [left, right] = await Promise.all([
      loadTaskSide({
        label: leftLabel,
        baseUrl: leftBaseUrl,
        apiKey: leftApiKey,
        taskId: args['left-task'] || null,
        payload,
        timeoutMs,
        pollIntervalMs,
      }),
      loadTaskSide({
        label: rightLabel,
        baseUrl: rightBaseUrl,
        apiKey: rightApiKey,
        taskId: args['right-task'] || null,
        payload,
        timeoutMs,
        pollIntervalMs,
      }),
    ]);
  } finally {
    await maybeStopInlineLocalServer();
  }

  writeJson(path.join(outputDir, `${leftLabel}_task.json`), left.finalTask);
  writeJson(path.join(outputDir, `${rightLabel}_task.json`), right.finalTask);
  writeJson(path.join(outputDir, `${leftLabel}_diagnostics.json`), left.diagnostics);
  writeJson(path.join(outputDir, `${rightLabel}_diagnostics.json`), right.diagnostics);

  const normalizedLeftDiagnostics = normalizeForComparison(left.diagnostics);
  const normalizedRightDiagnostics = normalizeForComparison(right.diagnostics);
  const rawDiffs = diffValues(left.diagnostics, right.diagnostics);
  const normalizedDiffs = diffValues(normalizedLeftDiagnostics, normalizedRightDiagnostics);
  const stepDiffs = summarizeStepDiffs(normalizedLeftDiagnostics, normalizedRightDiagnostics);

  const summary = {
    left: {
      label: left.label,
      baseUrl: left.baseUrl,
      taskId: left.taskId,
      status: left.finalTask?.status || null,
      error: left.finalTask?.error || null,
    },
    right: {
      label: right.label,
      baseUrl: right.baseUrl,
      taskId: right.taskId,
      status: right.finalTask?.status || null,
      error: right.finalTask?.error || null,
    },
    raw_diff_count: rawDiffs.length,
    normalized_diff_count: normalizedDiffs.length,
    step_diffs: stepDiffs,
  };

  writeJson(path.join(outputDir, 'normalized_left_diagnostics.json'), normalizedLeftDiagnostics);
  writeJson(path.join(outputDir, 'normalized_right_diagnostics.json'), normalizedRightDiagnostics);
  writeJson(path.join(outputDir, 'raw_diffs.json'), rawDiffs);
  writeJson(path.join(outputDir, 'normalized_diffs.json'), normalizedDiffs);
  writeJson(path.join(outputDir, 'summary.json'), summary);
  fs.writeFileSync(
    path.join(outputDir, 'report.md'),
    buildMarkdownReport({ left, right, stepDiffs }),
    'utf8'
  );

  console.log(JSON.stringify({ outputDir, summary }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
