import { FileInfo, QuotaInfo } from '@providers/common/storage-provider';

/**
 * 解析WebDAV文件列表XML
 * @param xmlText XML文本
 * @param baseUrl 基础URL
 * @param basePath 基础路径
 * @returns 文件信息数组
 * @author Bing
 */
export function parseFileInfoFromResponse(xmlText: string, baseUrl: string, basePath: string): FileInfo[] {
  try {
    // 创建解析器
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    
    // 获取所有response元素
    const responses = xmlDoc.getElementsByTagNameNS('DAV:', 'response');
    
    if (!responses || responses.length === 0) {
      console.warn('WebDAV响应中未找到response元素');
      return [];
    }
    
    const fileInfos: FileInfo[] = [];
    
    // 处理每个response元素
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      
      // 获取href元素
      const hrefElement = response.getElementsByTagNameNS('DAV:', 'href')[0];
      if (!hrefElement) {
        console.warn('响应中缺少href元素');
        continue;
      }
      
      // 获取href值并解码
      let href = decodeURIComponent(hrefElement.textContent || '');
      
      // 跳过不相关的URL
      if (!href || !baseUrl || !href.startsWith(new URL(baseUrl).pathname)) {
        continue;
      }
      
      // 计算相对路径
      let relativePath = href;
      const parsedBaseUrl = new URL(baseUrl);
      const baseUrlPath = parsedBaseUrl.pathname;
      
      if (relativePath.startsWith(baseUrlPath)) {
        relativePath = relativePath.substring(baseUrlPath.length);
      }
      
      // 构建完整的文件路径
      let fullPath = basePath;
      if (!fullPath.endsWith('/')) {
        fullPath += '/';
      }
      
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.substring(1);
      }
      
      if (relativePath && relativePath !== '/') {
        fullPath += relativePath;
      }
      
      // 规范化路径
      fullPath = fullPath.replace(/\/+/g, '/');
      
      // 获取文件名
      let fileName = relativePath;
      if (fileName.endsWith('/')) {
        fileName = fileName.substring(0, fileName.length - 1);
      }
      
      const lastSlashIndex = fileName.lastIndexOf('/');
      if (lastSlashIndex !== -1) {
        fileName = fileName.substring(lastSlashIndex + 1);
      }
      
      // 获取prop元素
      const propElement = response.getElementsByTagNameNS('DAV:', 'propstat')[0]?.
                          getElementsByTagNameNS('DAV:', 'prop')[0];
      
      if (!propElement) {
        console.warn(`响应中缺少prop元素: ${href}`);
        continue;
      }
      
      // 检查资源类型
      const resourceTypeElement = propElement.getElementsByTagNameNS('DAV:', 'resourcetype')[0];
      const isFolder = resourceTypeElement && 
                    resourceTypeElement.getElementsByTagNameNS('DAV:', 'collection').length > 0;
      
      // 获取内容长度
      let size = 0;
      const contentLengthElement = propElement.getElementsByTagNameNS('DAV:', 'getcontentlength')[0];
      if (contentLengthElement && contentLengthElement.textContent) {
        size = parseInt(contentLengthElement.textContent, 10) || 0;
      }
      
      // 获取最后修改时间
      let modifiedTime = new Date();
      const lastModifiedElement = propElement.getElementsByTagNameNS('DAV:', 'getlastmodified')[0];
      if (lastModifiedElement && lastModifiedElement.textContent) {
        modifiedTime = new Date(lastModifiedElement.textContent);
      }
      
      // 获取etag
      let etag = undefined;
      const etagElement = propElement.getElementsByTagNameNS('DAV:', 'getetag')[0];
      if (etagElement && etagElement.textContent) {
        etag = etagElement.textContent.replace(/"/g, ''); // 移除引号
      }
      
      // 创建文件信息对象
      fileInfos.push({
        path: fullPath,
        name: fileName || (isFolder ? '根目录' : 'file'),
        isFolder: isFolder,
        size: size,
        modifiedTime: modifiedTime,
        etag: etag
      });
    }
    
    return fileInfos;
  } catch (error) {
    console.error('解析WebDAV响应失败:', error);
    return [];
  }
}

/**
 * 解析WebDAV配额信息
 * @param xmlText XML文本
 * @returns 配额信息
 * @author Bing
 */
export function parseQuotaFromResponse(xmlText: string): QuotaInfo {
  try {
    // 创建解析器
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    
    // 获取配额元素
    const quotaAvailableBytesElement = xmlDoc.getElementsByTagNameNS('DAV:', 'quota-available-bytes')[0];
    const quotaUsedBytesElement = xmlDoc.getElementsByTagNameNS('DAV:', 'quota-used-bytes')[0];
    
    let available = -1;
    let used = -1;
    
    // 解析可用空间
    if (quotaAvailableBytesElement && quotaAvailableBytesElement.textContent) {
      available = parseInt(quotaAvailableBytesElement.textContent, 10) || -1;
    }
    
    // 解析已用空间
    if (quotaUsedBytesElement && quotaUsedBytesElement.textContent) {
      used = parseInt(quotaUsedBytesElement.textContent, 10) || -1;
    }
    
    // 计算总空间
    let total = -1;
    if (available >= 0 && used >= 0) {
      total = available + used;
    }
    
    return {
      available,
      used,
      total
    };
  } catch (error) {
    console.error('解析WebDAV配额信息失败:', error);
    return {
      available: -1,
      used: -1,
      total: -1
    };
  }
}

/**
 * 检查文件类型是否为二进制
 * @param fileExt 文件扩展名
 * @returns 是否为二进制文件
 * @author Bing
 */
export function isBinaryFileType(fileExt: string): boolean {
  if (!fileExt) {
    return false;
  }
  
  // 确保扩展名不包含点号
  if (fileExt.startsWith('.')) {
    fileExt = fileExt.substring(1);
  }
  
  // 常见二进制文件扩展名
  const binaryExtensions = [
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'ico', 'webp', 'tiff', 'tif',
    'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
    'mp3', 'wav', 'ogg', 'flac', 'aac', 'wma',
    'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv',
    'exe', 'dll', 'so', 'bin', 'dat'
  ];
  
  return binaryExtensions.includes(fileExt.toLowerCase());
}

/**
 * 检查内容类型是否为二进制
 * @param contentType 内容类型
 * @returns 是否为二进制内容
 * @author Bing
 */
export function isBinaryContentType(contentType: string): boolean {
  if (!contentType) {
    return false;
  }
  
  // 文本内容类型
  const textTypes = [
    'text/',
    'application/json',
    'application/xml',
    'application/javascript',
    'application/x-javascript',
    'application/ecmascript',
    'application/x-ecmascript',
  ];
  
  // 检查内容类型是否为文本类型
  for (const textType of textTypes) {
    if (contentType.startsWith(textType)) {
      return false;
    }
  }
  
  return true;
}

/**
 * 检查内容类型是否为文本
 * @param contentType 内容类型
 * @returns 是否为文本内容
 * @author Bing
 */
export function isTextContentType(contentType: string): boolean {
  return !isBinaryContentType(contentType);
}

/**
 * 格式化路径
 * @param path 路径
 * @returns 格式化后的路径
 * @author Bing
 */
export function formatPath(path: string): string {
  if (!path) {
    return '/';
  }
  
  // 确保路径以斜杠开头
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  
  // 移除末尾斜杠（除了根路径）
  if (path !== '/' && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  
  // 移除多余斜杠
  path = path.replace(/\/+/g, '/');
  
  return path;
} 