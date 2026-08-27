import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const MAX_FILES = 100;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resolveWorkspaceRoot(rootDir) {
  const resolved = path.resolve(rootDir);
  if (!existsSync(resolved) || !lstatSync(resolved).isDirectory()) {
    throw new Error(`Workspace root does not exist or is not a directory: ${resolved}`);
  }
  return realpathSync(resolved);
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Each provisioning file requires a non-empty relative path');
  }
  const candidate = value.trim();
  if (candidate.includes('\\') || path.posix.isAbsolute(candidate)) {
    throw new Error(`Provisioning path must use portable relative '/' segments: '${value}'`);
  }
  const normalized = path.posix.normalize(candidate);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Provisioning path escapes the workspace: '${value}'`);
  }
  if (normalized.length > 240) {
    throw new Error(`Provisioning path exceeds 240 characters: '${value}'`);
  }
  return normalized;
}

function assertNoSymlinkTraversal(rootDir, relativePath) {
  const segments = relativePath.split('/');
  let current = rootDir;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`Provisioning path traverses a symbolic link: '${relativePath}'`);
    }
  }
}

export function validateWorkspaceFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Provisioning plan must contain a non-empty files array');
  }
  if (files.length > MAX_FILES) {
    throw new Error(`Provisioning plan exceeds the ${MAX_FILES}-file limit`);
  }

  const paths = new Set();
  let totalBytes = 0;
  const normalized = files.map((file) => {
    const relativePath = normalizeRelativePath(file?.path);
    if (paths.has(relativePath)) {
      throw new Error(`Duplicate provisioning path '${relativePath}'`);
    }
    paths.add(relativePath);
    if (typeof file?.content !== 'string') {
      throw new Error(`Provisioning file '${relativePath}' requires string content`);
    }
    const bytes = Buffer.byteLength(file.content, 'utf8');
    if (bytes > MAX_FILE_BYTES) {
      throw new Error(`Provisioning file '${relativePath}' exceeds ${MAX_FILE_BYTES} bytes`);
    }
    totalBytes += bytes;
    return { path: relativePath, content: file.content, bytes, digest: sha256(file.content) };
  });
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`Provisioning plan exceeds ${MAX_TOTAL_BYTES} total bytes`);
  }
  return normalized;
}

export function previewWorkspacePlan(rootDir, files) {
  const root = resolveWorkspaceRoot(rootDir);
  return validateWorkspaceFiles(files).map((file) => {
    assertNoSymlinkTraversal(root, file.path);
    const target = path.join(root, ...file.path.split('/'));
    const currentContent = existsSync(target) ? readFileSync(target, 'utf8') : null;
    return {
      path: file.path,
      operation: currentContent === null ? 'create' : currentContent === file.content ? 'unchanged' : 'update',
      bytes: file.bytes,
      digest: file.digest,
      ...(currentContent === null ? {} : { currentDigest: sha256(currentContent) }),
    };
  });
}

export function applyWorkspacePlan(rootDir, files) {
  const root = resolveWorkspaceRoot(rootDir);
  const normalizedFiles = validateWorkspaceFiles(files);
  const preview = previewWorkspacePlan(root, normalizedFiles);
  for (const [index, file] of normalizedFiles.entries()) {
    if (preview[index].operation === 'unchanged') continue;
    assertNoSymlinkTraversal(root, file.path);
    const target = path.join(root, ...file.path.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    assertNoSymlinkTraversal(root, file.path);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, file.content, { encoding: 'utf8', flag: 'wx' });
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return preview;
}

export function verifyWorkspacePlan(rootDir, files) {
  const root = resolveWorkspaceRoot(rootDir);
  return validateWorkspaceFiles(files).map((file) => {
    assertNoSymlinkTraversal(root, file.path);
    const target = path.join(root, ...file.path.split('/'));
    if (!existsSync(target)) {
      return { path: file.path, ok: false, reason: 'missing', expectedDigest: file.digest };
    }
    const actualDigest = sha256(readFileSync(target, 'utf8'));
    return {
      path: file.path,
      ok: actualDigest === file.digest,
      reason: actualDigest === file.digest ? 'matched' : 'content-mismatch',
      expectedDigest: file.digest,
      actualDigest,
    };
  });
}
