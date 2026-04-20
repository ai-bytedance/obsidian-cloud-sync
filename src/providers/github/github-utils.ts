import { GitHubSettings } from '@models/plugin-settings';
import { GitHubRepoRef } from './github-types';

export function normalizeGitHubPath(path: string): string {
  return path.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

export function parseRepositoryConfig(settings: GitHubSettings): GitHubRepoRef {
  const repository = settings.repository.trim();
  const parts = repository.split('/').filter(Boolean);

  if (parts.length === 2) {
    return {
      owner: parts[0],
      repo: parts[1],
      branch: (settings.branch || 'main').trim() || 'main'
    };
  }

  if (parts.length === 1 && settings.username.trim()) {
    return {
      owner: settings.username.trim(),
      repo: parts[0],
      branch: (settings.branch || 'main').trim() || 'main'
    };
  }

  throw new Error('GitHub仓库格式无效，请填写为 owner/repo 或补全用户名');
}

export function encodeGitHubContent(content: string | ArrayBuffer): string {
  if (typeof content === 'string') {
    const bytes = new TextEncoder().encode(content);
    return arrayBufferToBase64(bytes.buffer);
  }

  return arrayBufferToBase64(content);
}

export function decodeGitHubTextContent(base64: string): string {
  const bytes = base64ToUint8Array(base64);
  return new TextDecoder().decode(bytes);
}

export function decodeGitHubBinaryContent(base64: string): ArrayBuffer {
  return base64ToUint8Array(base64).buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const normalized = base64.replace(/\n/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}
