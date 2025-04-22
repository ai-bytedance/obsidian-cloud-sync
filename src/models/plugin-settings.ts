/**
 * 存储提供商类型
 * @author Bing
 */
export type StorageProviderType = 'webdav' | 'gdrive' | 'onedrive' | 'icloud' | 'github';

/**
 * 冲突策略
 * @author Bing
 */
export type ConflictPolicy = 'overwrite' | 'keepLocal' | 'keepRemote' | 'merge';

/**
 * 同步模式
 * @author Bing
 */
export type SyncMode = 'incremental' | 'full';

/**
 * 同步方向
 * @author Bing
 */
export type SyncDirection = 'bidirectional' | 'uploadOnly' | 'downloadOnly';

/**
 * 日志级别
 * @author Bing
 */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/**
 * 请求延迟级别
 * @author Bing
 */
export type RequestDelayLevel = 'normal' | 'slow' | 'very-slow';

/**
 * WebDAV设置
 * @author Bing
 */
export interface WebDAVSettings {
  enabled: boolean;
  username: string;
  password: string;
  serverUrl: string;
  syncPath: string;
  // 坚果云特定设置
  isPaidUser?: boolean;
  requestDelay?: RequestDelayLevel;
}

/**
 * Google Drive设置
 * @author Bing
 */
export interface GoogleDriveSettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  syncPath: string;
}

/**
 * OneDrive设置
 * @author Bing
 */
export interface OneDriveSettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  syncPath: string;
}

/**
 * iCloud设置
 * @author Bing
 */
export interface iCloudSettings {
  enabled: boolean;
  appId: string;
  password: string;
  syncPath: string;
}

/**
 * GitHub设置
 * @author Bing
 */
export interface GitHubSettings {
  enabled: boolean;
  username: string;
  token: string;
  repository: string;
  branch: string;
  syncPath: string;
}

/**
 * 加密设置
 * @author Bing
 */
export interface EncryptionSettings {
  enabled: boolean;
  key: string;
}

/**
 * 存储提供商设置
 * @author Bing
 */
export interface ProviderSettings {
  webdav?: WebDAVSettings;
  gdrive?: GoogleDriveSettings;
  onedrive?: OneDriveSettings;
  icloud?: iCloudSettings;
  github?: GitHubSettings;
}

/**
 * 插件设置
 * @author Bing
 */
export interface PluginSettings {
  // 通用设置
  enableSync: boolean;
  syncInterval: number; // 分钟，0表示禁用自动同步
  
  // 存储提供商设置
  enabledProviders: StorageProviderType[];
  providerSettings: ProviderSettings;
  
  // 加密设置
  encryption: EncryptionSettings;
  
  // 同步设置
  conflictPolicy: ConflictPolicy;
  syncMode: SyncMode;
  syncDirection: SyncDirection;
  deleteRemoteExtraFiles: boolean; // 删除远程端多余文件
  deleteLocalExtraFiles: boolean;  // 删除本地端多余文件
  
  // 过滤设置
  ignoreFolders: string[];
  ignoreFiles: string[];
  ignoreExtensions: string[];
  
  // 高级设置
  debugMode: boolean;
  logLevel: LogLevel;
  networkDetection: boolean;
}

/**
 * 默认设置
 * @author Bing
 */
export const DEFAULT_SETTINGS: PluginSettings = {
  // 通用设置
  enableSync: false,
  syncInterval: 0, // 默认值改为0，与enableSync=false保持一致
  
  // 存储提供商设置
  enabledProviders: [],
  providerSettings: {
    webdav: {
      enabled: false,
      username: '',
      password: '',
      serverUrl: '',
      syncPath: '',
      isPaidUser: false,
      requestDelay: 'normal'
    },
    icloud: {
      enabled: false,
      appId: '',
      password: '',
      syncPath: ''
    },
    github: {
      enabled: false,
      username: '',
      token: '',
      repository: '',
      branch: 'main',
      syncPath: ''
    }
  },
  
  // 加密设置
  encryption: {
    enabled: false,
    key: ''
  },
  
  // 同步设置
  conflictPolicy: 'overwrite',
  syncMode: 'incremental',
  syncDirection: 'bidirectional',
  deleteRemoteExtraFiles: false, // 默认不删除远程端多余文件
  deleteLocalExtraFiles: false,  // 默认不删除本地端多余文件
  
  // 过滤设置
  ignoreFolders: ['.git', '.obsidian', 'node_modules'],
  ignoreFiles: ['.DS_Store', 'desktop.ini', 'thumbs.db'],
  ignoreExtensions: ['tmp', 'bak', 'swp'],
  
  // 高级设置
  debugMode: false,
  logLevel: 'info',
  networkDetection: false
}; 