const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DIAGNOSTICS_ENABLED = (process.env.TASK_DIAGNOSTICS_ENABLED || 'true').toLowerCase() !== 'false';
const DIAGNOSTICS_ROOT = path.resolve(__dirname, '..', '.runtime', 'diagnostics');

function isEnabled() {
  return DIAGNOSTICS_ENABLED;
}

function buildTaskDir(taskId) {
  return path.join(DIAGNOSTICS_ROOT, taskId);
}

function buildTaskFile(taskId) {
  return path.join(buildTaskDir(taskId), 'diagnostics.json');
}

async function ensureTaskDir(taskId) {
  if (!isEnabled()) return null;
  const taskDir = buildTaskDir(taskId);
  await fsp.mkdir(taskDir, { recursive: true });
  return taskDir;
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function summarizeUserImageInput(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { type: 'unknown', present: false };
  }
  const trimmed = input.trim();
  if (trimmed.startsWith('data:image/')) {
    const mimeMatch = trimmed.match(/^data:([^;]+);base64,/i);
    const payload = trimmed.replace(/^data:[^;]+;base64,/i, '');
    let byteLength = null;
    let sha256 = null;
    try {
      const buffer = Buffer.from(payload, 'base64');
      byteLength = buffer.length;
      sha256 = hashBuffer(buffer);
    } catch {
      byteLength = null;
    }
    return {
      type: 'data_url',
      present: true,
      mime_type: mimeMatch?.[1] || null,
      byte_length: byteLength,
      sha256,
    };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return {
      type: 'http_url',
      present: true,
      url: trimmed,
      sha256: hashBuffer(Buffer.from(trimmed)),
    };
  }
  return {
    type: 'string',
    present: true,
    preview: trimmed.slice(0, 120),
    sha256: hashBuffer(Buffer.from(trimmed)),
  };
}

function summarizeUserImageInputs(inputs = []) {
  return (Array.isArray(inputs) ? inputs : []).map(summarizeUserImageInput);
}

function sanitizeForJson(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Buffer.isBuffer(value)) {
    return { type: 'buffer', byte_length: value.length, sha256: hashBuffer(value) };
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForJson);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, innerValue]) => [key, sanitizeForJson(innerValue)])
    );
  }
  return value;
}

function deepMerge(baseValue, patchValue) {
  if (patchValue === undefined) return baseValue;
  if (Array.isArray(patchValue)) return patchValue.slice();
  if (!patchValue || typeof patchValue !== 'object') return patchValue;
  const baseObject = baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue) ? baseValue : {};
  const merged = { ...baseObject };
  for (const [key, value] of Object.entries(patchValue)) {
    merged[key] = deepMerge(baseObject[key], value);
  }
  return merged;
}

async function readTaskDiagnostics(taskId) {
  if (!isEnabled()) return null;
  const filePath = buildTaskFile(taskId);
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeTaskDiagnostics(taskId, data) {
  if (!isEnabled()) return null;
  await ensureTaskDir(taskId);
  const filePath = buildTaskFile(taskId);
  const taskDiagnostics = sanitizeForJson(data);
  await fsp.writeFile(filePath, `${JSON.stringify(taskDiagnostics, null, 2)}\n`, 'utf8');
  return taskDiagnostics;
}

async function patchTaskDiagnostics(taskId, patch) {
  if (!isEnabled()) return null;
  const current = await readTaskDiagnostics(taskId);
  const merged = deepMerge(current || {}, sanitizeForJson(patch));
  return writeTaskDiagnostics(taskId, merged);
}

async function appendTaskDiagnostics(taskId, key, item) {
  if (!isEnabled()) return null;
  const current = await readTaskDiagnostics(taskId);
  const nextItems = Array.isArray(current?.[key]) ? current[key].slice() : [];
  nextItems.push(sanitizeForJson(item));
  return patchTaskDiagnostics(taskId, { [key]: nextItems });
}

module.exports = {
  DIAGNOSTICS_ROOT,
  appendTaskDiagnostics,
  buildTaskDir,
  buildTaskFile,
  ensureTaskDir,
  hashBuffer,
  isEnabled,
  patchTaskDiagnostics,
  readTaskDiagnostics,
  summarizeUserImageInput,
  summarizeUserImageInputs,
  writeTaskDiagnostics,
};
