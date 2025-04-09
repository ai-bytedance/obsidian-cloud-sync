/**
 * 存储提供商类型
 */
export type StorageProviderType = 'webdav' | 'gdrive' | 'onedrive';

/**
 * 冲突策略
 */
export type ConflictPolicy = 'overwrite' | 'keepLocal' | 'keepRemote' | 'merge';

/**
 * 同步模式
 */
export type SyncMode = 'incremental' | 'full';

/**
 * 同步方向
 */
export type SyncDirection = 'bidirectional' | 'uploadOnly' | 'downloadOnly';

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/**
 * WebDAV设置
 */
export interface WebDAVSettings {
  enabled: boolean;
  username: string;
  password: string;
  serverUrl: string;
  syncPath: string;
}

/**
 * Google Drive设置
 */
export interface GoogleDriveSettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  syncPath: string;
}

/**
 * OneDrive设置
 */
export interface OneDriveSettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  syncPath: string;
}

/**
 * 加密设置
 */
export interface EncryptionSettings {
  enabled: boolean;
  key: string;
}

/**
 * 存储提供商设置
 */
export interface ProviderSettings {
  webdav?: WebDAVSettings;
  gdrive?: GoogleDriveSettings;
  onedrive?: OneDriveSettings;
}

/**
 * 插件设置
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
 */
export const DEFAULT_SETTINGS: PluginSettings = {
  // 通用设置
  enableSync: false,
  syncInterval: 5, // 默认5分钟
  
  // 存储提供商设置
  enabledProviders: [],
  providerSettings: {
    webdav: {
      enabled: false,
      username: '',
      password: '',
      serverUrl: '',
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