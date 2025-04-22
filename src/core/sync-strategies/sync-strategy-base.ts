import { StorageProvider, FileInfo } from '@providers/common/storage-provider';
import { StorageProviderType } from '@models/plugin-settings';

/**
 * 本地文件信息接口
 * @author Bing
 */
export interface LocalFileInfo {
  path: string;
  mtime: number;
  size: number;
  isFolder: boolean;
}

/**
 * 同步策略接口
 * 定义所有同步策略必须实现的方法
 * @author Bing
 */
export interface SyncStrategy {
  /**
   * 执行同步
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @author Bing
   */
  sync(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType
  ): Promise<void>;
}

/**
 * 同步策略基类
 * 实现同步策略的通用方法
 * @author Bing
 */
export abstract class SyncStrategyBase implements SyncStrategy {
  /**
   * 执行同步
   * @param provider 存储提供商
   * @param localFiles 本地文件列表
   * @param remoteFiles 远程文件列表
   * @param providerType 提供商类型
   * @author Bing
   */
  abstract sync(
    provider: StorageProvider,
    localFiles: LocalFileInfo[],
    remoteFiles: FileInfo[],
    providerType: StorageProviderType
  ): Promise<void>;
  
  /**
   * 获取本地文件映射
   * @param localFiles 本地文件列表
   * @returns 本地文件映射
   * @author Bing
   */
  protected createLocalFilesMap(localFiles: LocalFileInfo[]): Map<string, LocalFileInfo> {
    const map = new Map<string, LocalFileInfo>();
    for (const file of localFiles) {
      map.set(file.path, file);
    }
    return map;
  }
  
  /**
   * 获取远程文件映射
   * @param remoteFiles 远程文件列表
   * @returns 远程文件映射
   * @author Bing
   */
  protected createRemoteFilesMap(remoteFiles: FileInfo[]): Map<string, FileInfo> {
    const map = new Map<string, FileInfo>();
    for (const file of remoteFiles) {
      map.set(file.path, file);
    }
    return map;
  }
} 