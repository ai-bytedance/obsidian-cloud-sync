import { requestUrl, RequestUrlParam } from 'obsidian';
import { StorageProviderError } from '@providers/common/storage-provider';
import { GitHubSettings } from '@models/plugin-settings';
import {
  GitHubCommitResponse,
  GitHubContentFile,
  GitHubContentItem,
  GitHubPutFileResponse,
  GitHubRepoRef,
  GitHubRepoResponse
} from './github-types';
import {
  encodeGitHubContent,
  normalizeGitHubPath,
  parseRepositoryConfig
} from './github-utils';

export class GitHubClient {
  private readonly apiBase = 'https://api.github.com';

  constructor(private readonly settings: GitHubSettings) {}

  getRepoRef(): GitHubRepoRef {
    return parseRepositoryConfig(this.settings);
  }

  async getRepo(): Promise<GitHubRepoResponse> {
    const { owner, repo } = this.getRepoRef();
    return this.requestJson<GitHubRepoResponse>(`/repos/${owner}/${repo}`);
  }

  async branchExists(branch: string): Promise<boolean> {
    const { owner, repo } = this.getRepoRef();

    try {
      await this.requestJson(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
      return true;
    } catch (error) {
      if (StorageProviderError.isStorageProviderError(error) && error.code === 'NOT_FOUND') {
        return false;
      }

      throw error;
    }
  }

  async getLatestCommitDate(branch: string, path?: string): Promise<Date> {
    const { owner, repo } = this.getRepoRef();
    const query = new URLSearchParams({
      sha: branch,
      per_page: '1'
    });

    const normalizedPath = path ? normalizeGitHubPath(path) : '';
    if (normalizedPath) {
      query.set('path', normalizedPath);
    }

    const commits = await this.requestJson<GitHubCommitResponse[]>(
      `/repos/${owner}/${repo}/commits?${query.toString()}`
    );

    if (!Array.isArray(commits) || commits.length === 0) {
      return new Date(0);
    }

    return new Date(commits[0].commit.committer.date);
  }

  async getContents(path: string, branch: string): Promise<GitHubContentItem | GitHubContentItem[]> {
    const { owner, repo } = this.getRepoRef();
    const normalizedPath = normalizeGitHubPath(path);
    const suffix = normalizedPath ? `/${encodeURI(normalizedPath)}` : '';
    const query = new URLSearchParams({ ref: branch });

    return this.requestJson<GitHubContentItem | GitHubContentItem[]>(
      `/repos/${owner}/${repo}/contents${suffix}?${query.toString()}`
    );
  }

  async putFile(
    path: string,
    content: string | ArrayBuffer,
    branch: string,
    message: string,
    sha?: string
  ): Promise<GitHubPutFileResponse> {
    const { owner, repo } = this.getRepoRef();
    const normalizedPath = normalizeGitHubPath(path);

    if (!normalizedPath) {
      throw new StorageProviderError('GitHub 不支持将内容写入仓库根路径', 'INVALID_PATH');
    }

    const body = {
      message,
      content: encodeGitHubContent(content),
      branch,
      sha
    };

    return this.requestJson<GitHubPutFileResponse>(`/repos/${owner}/${repo}/contents/${encodeURI(normalizedPath)}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }

  async deleteFile(path: string, sha: string, branch: string, message: string): Promise<void> {
    const { owner, repo } = this.getRepoRef();
    const normalizedPath = normalizeGitHubPath(path);

    await this.requestJson(`/repos/${owner}/${repo}/contents/${encodeURI(normalizedPath)}`, {
      method: 'DELETE',
      body: JSON.stringify({
        message,
        sha,
        branch
      })
    });
  }

  private async requestJson<T>(path: string, options: Partial<RequestUrlParam> = {}): Promise<T> {
    const params: RequestUrlParam = {
      url: `${this.apiBase}${path}`,
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${this.settings.token.trim()}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      },
      body: options.body,
      throw: false
    };

    const response = await requestUrl(params);

    if (response.status < 200 || response.status >= 300) {
      throw this.handleError(response.status, response.text);
    }

    if (!response.text) {
      return undefined as T;
    }

    return JSON.parse(response.text) as T;
  }

  private handleError(status: number, responseText: string): StorageProviderError {
    let message = 'GitHub 请求失败';

    try {
      const parsed = JSON.parse(responseText) as { message?: string };
      if (parsed.message) {
        message = parsed.message;
      }
    } catch (_error) {
      if (responseText) {
        message = responseText;
      }
    }

    switch (status) {
      case 401:
        return new StorageProviderError('GitHub 认证失败，请检查 Token', 'AUTH_FAILED');
      case 403:
        return new StorageProviderError(`GitHub 拒绝访问: ${message}`, 'FORBIDDEN');
      case 404:
        return new StorageProviderError(`GitHub 资源不存在: ${message}`, 'NOT_FOUND');
      case 409:
        return new StorageProviderError(`GitHub 资源冲突: ${message}`, 'CONFLICT');
      case 422:
        return new StorageProviderError(`GitHub 请求无效: ${message}`, 'INVALID_REQUEST');
      default:
        return new StorageProviderError(`GitHub 请求失败(${status}): ${message}`, 'UNKNOWN_ERROR');
    }
  }

  async getFile(path: string, branch: string): Promise<GitHubContentFile> {
    const result = await this.getContents(path, branch);

    if (Array.isArray(result) || result.type !== 'file') {
      throw new StorageProviderError('目标路径不是文件', 'INVALID_PATH');
    }

    return result;
  }
}
