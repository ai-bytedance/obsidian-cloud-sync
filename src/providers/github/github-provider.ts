import { App } from 'obsidian';
import {
  ConnectionStatus,
  FileInfo,
  FileMetadata,
  QuotaInfo,
  StorageProvider,
  StorageProviderError
} from '@providers/common/storage-provider';
import { GitHubSettings } from '@models/plugin-settings';
import { isBinaryFileType } from '@providers/webdav/webdav-parsers';
import { GitHubClient } from './github-client';
import { GitHubContentFile, GitHubContentItem } from './github-types';
import { toFileInfo, toFileMetadata } from './github-parsers';
import {
  decodeGitHubBinaryContent,
  decodeGitHubTextContent,
  normalizeGitHubPath
} from './github-utils';

export class GitHubProvider implements StorageProvider {
  private readonly client: GitHubClient;
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;

  constructor(
    private readonly config: GitHubSettings,
    private readonly app: App
  ) {
    this.client = new GitHubClient(config);
  }

  getName(): string {
    return 'GitHub';
  }

  getType(): string {
    return 'github';
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  async connect(): Promise<boolean> {
    if (!this.config.token.trim()) {
      this.status = ConnectionStatus.ERROR;
      throw new StorageProviderError('GitHub Token 不能为空', 'CONFIG_ERROR');
    }

    this.status = ConnectionStatus.CONNECTING;

    try {
      const repo = await this.client.getRepo();
      const branch = (this.config.branch || repo.default_branch || 'main').trim() || 'main';
      const branchExists = await this.client.branchExists(branch);

      if (!branchExists) {
        this.status = ConnectionStatus.ERROR;
        throw new StorageProviderError(`GitHub 分支不存在: ${branch}`, 'NOT_FOUND');
      }

      this.status = ConnectionStatus.CONNECTED;
      return true;
    } catch (error) {
      this.status = ConnectionStatus.ERROR;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.status = ConnectionStatus.DISCONNECTED;
  }

  async testConnection(): Promise<boolean> {
    const success = await this.connect();
    await this.disconnect();
    return success;
  }

  async listFiles(path: string): Promise<FileInfo[]> {
    await this.ensureConnected();

    const branch = this.getBranch();
    const normalizedPath = normalizeGitHubPath(path);
    const modifiedTime = await this.client.getLatestCommitDate(branch, normalizedPath);

    const results: FileInfo[] = [];
    await this.walkDirectory(normalizedPath, branch, modifiedTime, results, true);
    return results;
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const content = await this.downloadFileContent(remotePath);

    if (typeof content === 'string') {
      await this.app.vault.adapter.write(localPath, content);
    } else {
      await this.app.vault.adapter.writeBinary(localPath, content);
    }
  }

  async downloadFileContent(remotePath: string): Promise<string | ArrayBuffer> {
    await this.ensureConnected();

    const file = await this.client.getFile(remotePath, this.getBranch());
    const extension = file.path.split('.').pop()?.toLowerCase() || '';
    const content = file.content || '';

    if (isBinaryFileType(extension)) {
      return decodeGitHubBinaryContent(content);
    }

    return decodeGitHubTextContent(content);
  }

  async uploadFile(remotePath: string, content: string | ArrayBuffer): Promise<void> {
    await this.ensureConnected();

    const normalizedPath = normalizeGitHubPath(remotePath);
    if (!normalizedPath) {
      throw new StorageProviderError('GitHub 不支持写入空路径', 'INVALID_PATH');
    }

    const existing = await this.getFileIfExists(normalizedPath);
    const message = existing ? `Update ${normalizedPath}` : `Create ${normalizedPath}`;

    await this.client.putFile(
      normalizedPath,
      content,
      this.getBranch(),
      message,
      existing?.sha
    );
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.ensureConnected();

    const normalizedPath = normalizeGitHubPath(remotePath);
    const file = await this.getFileIfExists(normalizedPath);

    if (!file) {
      return;
    }

    await this.client.deleteFile(normalizedPath, file.sha, this.getBranch(), `Delete ${normalizedPath}`);
  }

  async moveFile(oldPath: string, newPath: string): Promise<void> {
    const content = await this.downloadFileContent(oldPath);
    await this.uploadFile(newPath, content);
    await this.deleteFile(oldPath);
  }

  async createFolder(_path: string): Promise<void> {
    // GitHub 不支持空目录，保留为 no-op 以兼容同步策略。
  }

  async deleteFolder(path: string): Promise<void> {
    const normalizedPath = normalizeGitHubPath(path);
    const files = await this.listFiles(normalizedPath);

    for (const file of files.filter(item => !item.isFolder).sort((a, b) => b.path.length - a.path.length)) {
      await this.deleteFile(file.path);
    }
  }

  async folderExists(path: string): Promise<boolean> {
    if (!normalizeGitHubPath(path)) {
      return true;
    }

    try {
      const result = await this.client.getContents(path, this.getBranch());
      return Array.isArray(result) || result.type === 'dir';
    } catch (error) {
      if (StorageProviderError.isStorageProviderError(error) && error.code === 'NOT_FOUND') {
        return false;
      }

      throw error;
    }
  }

  async getFileMetadata(path: string): Promise<FileMetadata> {
    const file = await this.client.getFile(path, this.getBranch());
    const modifiedTime = await this.client.getLatestCommitDate(this.getBranch(), normalizeGitHubPath(path));
    return toFileMetadata(file, modifiedTime);
  }

  async getQuota(): Promise<QuotaInfo> {
    return {
      used: -1,
      available: -1,
      total: -1
    };
  }

  private async ensureConnected(): Promise<void> {
    if (this.status !== ConnectionStatus.CONNECTED) {
      await this.connect();
    }
  }

  private getBranch(): string {
    return (this.config.branch || 'main').trim() || 'main';
  }

  private async getFileIfExists(path: string): Promise<GitHubContentFile | null> {
    try {
      return await this.client.getFile(path, this.getBranch());
    } catch (error) {
      if (StorageProviderError.isStorageProviderError(error) && error.code === 'NOT_FOUND') {
        return null;
      }

      throw error;
    }
  }

  private async walkDirectory(
    path: string,
    branch: string,
    modifiedTime: Date,
    output: FileInfo[],
    includeDirectoryChildren: boolean
  ): Promise<void> {
    let result: GitHubContentItem | GitHubContentItem[];

    try {
      result = await this.client.getContents(path, branch);
    } catch (error) {
      if (StorageProviderError.isStorageProviderError(error) && error.code === 'NOT_FOUND') {
        return;
      }

      throw error;
    }

    if (!Array.isArray(result)) {
      if (result.type === 'file') {
        output.push(toFileInfo(result, modifiedTime));
      }
      return;
    }

    for (const item of result) {
      if (item.type === 'dir') {
        output.push(toFileInfo(item, modifiedTime));
        if (includeDirectoryChildren) {
          await this.walkDirectory(item.path, branch, modifiedTime, output, true);
        }
      } else if (item.type === 'file') {
        output.push(toFileInfo(item, modifiedTime));
      }
    }
  }
}
