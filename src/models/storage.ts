/**
 * 文件信息接口
 */
export interface FileInfo {
  /**
   * 文件路径
   */
  path: string;
  
  /**
   * 文件名
   */
  name: string;
  
  /**
   * 是否为目录
   */
  isDir: boolean;
  
  /**
   * 文件大小（字节）
   */
  size: number;
  
  /**
   * 最后修改时间
   */
  mtime: Date;
  
  /**
   * 内容类型
   */
  contentType?: string;
  
  /**
   * ETag（实体标签）
   */
  etag?: string;
}

/**
 * 文件元数据接口
 */
export interface FileMetadata {
  /**
   * 文件路径
   */
  path: string;
  
  /**
   * 文件名
   */
  name: string;
  
  /**
   * 文件大小（字节）
   */
  size: number;
  
  /**
   * 最后修改时间
   */
  mtime: Date;
  
  /**
   * ETag（实体标签）
   */
  etag?: string;
}

/**
 * 配额信息接口
 */
export interface QuotaInfo {
  /**
   * 可用空间（字节）
   * -1 表示未知
   */
  available: number;
  
  /**
   * 已用空间（字节）
   * -1 表示未知
   */
  used: number;
} 