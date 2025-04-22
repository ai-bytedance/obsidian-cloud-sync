import { PluginSettings, StorageProviderType } from '@models/plugin-settings';

/**
 * 同步路径工具类
 * 提供与同步相关的路径处理工具方法
 * 包括远程基础路径获取、路径转换等功能
 * @author Bing
 */
export class SyncPathUtils {
  /**
   * 获取远程根路径
   * @param settings 插件设置
   * @param providerType 提供商类型
   * @returns 远程根路径
   * @author Bing
   */
  static getRemoteBasePath(settings: PluginSettings, providerType: StorageProviderType): string {
    // 获取设置中的同步路径
    if (providerType === 'webdav' && settings.providerSettings.webdav) {
      const syncPath = settings.providerSettings.webdav.syncPath;
      if (syncPath && syncPath.trim()) {
        let path = syncPath.trim();
        // 移除前导和尾部斜杠以确保一致性
        path = path.replace(/^\/+/, '').replace(/\/+$/, '');
        if (path) {
          console.log(`使用WebDAV同步路径: ${path}`);
          return path;
        }
      }
    }
    
    // 如果没有设置同步路径或者是其他提供商，使用空路径
    return '';
  }
  
  /**
   * 格式化路径，确保路径格式的一致性
   * @param path 需要格式化的路径
   * @returns 格式化后的路径
   * @author Bing
   */
  static formatPath(path: string): string {
    // 去除开头和结尾的空格
    path = path.trim();
    
    // 确保路径以/开头
    if (path && !path.startsWith('/')) {
      path = '/' + path;
    }
    
    // 确保路径不以/结尾(除非是根路径)
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    
    return path;
  }
  
  /**
   * 合并两个路径
   * @param basePath 基础路径
   * @param relativePath 相对路径
   * @returns 合并后的路径
   * @author Bing
   */
  static joinPaths(basePath: string, relativePath: string): string {
    if (!basePath) {
      return relativePath;
    }
    
    if (!relativePath) {
      return basePath;
    }
    
    // 规范化路径
    basePath = basePath.trim();
    relativePath = relativePath.trim();
    
    // 移除基础路径末尾的斜杠和相对路径开头的斜杠
    basePath = basePath.replace(/\/+$/, '');
    relativePath = relativePath.replace(/^\/+/, '');
    
    return basePath + '/' + relativePath;
  }
  
  /**
   * 将远程路径映射到本地路径
   * 避免路径冗余问题，特别是basePath重复的情况
   * @param remotePath 远程文件路径
   * @param basePath 远程基础路径
   * @returns 映射后的本地路径
   * @author Claude
   */
  static mapRemotePathToLocal(remotePath: string, basePath: string): string {
    // 如果没有basePath，则直接返回远程路径
    if (!basePath || basePath.trim() === '') {
      console.log(`未设置basePath，直接使用远程路径: ${remotePath}`);
      return remotePath;
    }
    
    // 规范化路径
    remotePath = remotePath.trim();
    basePath = basePath.trim();
    
    // 移除所有路径中的前导和尾部斜杠
    remotePath = remotePath.replace(/^\/+/, '').replace(/\/+$/, '');
    basePath = basePath.replace(/^\/+/, '').replace(/\/+$/, '');
    
    // 特殊情况1: 远程路径与basePath完全相同
    if (remotePath === basePath) {
      console.log(`远程路径与basePath完全相同，返回空路径: ${remotePath} === ${basePath}`);
      return '';
    }
    
    // 特殊情况2: 远程路径是basePath的子路径
    if (remotePath.startsWith(basePath + '/')) {
      const localPath = remotePath.substring(basePath.length + 1);
      console.log(`远程路径是basePath的子路径，提取子路径: ${remotePath} -> ${localPath}`);
      return localPath;
    }
    
    // 特殊情况3: basePath是TEST，远程路径是TEST/TEST/file.md这样的情况（远程路径错误地包含了重复的basePath）
    const basePathSegments = basePath.split('/');
    const remotePathSegments = remotePath.split('/');
    
    // 检查是否有路径重复问题
    if (remotePathSegments.length >= basePathSegments.length) {
      // 检查远程路径的前n段是否与basePath相同
      let allMatch = true;
      for (let i = 0; i < basePathSegments.length; i++) {
        if (remotePathSegments[i] !== basePathSegments[i]) {
          allMatch = false;
          break;
        }
      }
      
      if (allMatch) {
        // 移除前n段，剩余部分作为相对路径
        const localPath = remotePathSegments.slice(basePathSegments.length).join('/');
        console.log(`检测到路径前缀与basePath匹配，移除重复部分: ${remotePath} -> ${localPath}`);
        return localPath;
      }
    }
    
    // 默认情况: 路径没有明显的重复，但不在basePath下，直接返回远程路径
    console.log(`远程路径不在basePath下，直接使用: ${remotePath}`);
    return remotePath;
  }
} 