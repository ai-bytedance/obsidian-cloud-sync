import { requestUrl, RequestUrlParam, Notice } from 'obsidian';
import { JianguoyunDriveSettings } from '../settings';

/**
 * 坚果云WebDAV服务类
 * 实现了与坚果云WebDAV服务的交互，包括文件上传、下载、删除等操作
 */
export class JianguoyunDriveService {
  private settings: JianguoyunDriveSettings;
  private baseUrl = 'https://dav.jianguoyun.com/dav';
  
  constructor(settings: JianguoyunDriveSettings) {
    this.settings = settings;
  }

  /**
   * 授权验证
   * 验证坚果云账号凭据并确保同步根目录存在
   */
  async authorize() {
    if (!this.settings.username || !this.settings.password) {
      new Notice('请先设置坚果云用户名和密码');
      return;
    }
    
    try {
      // 坚果云使用 WebDAV 协议，尝试列出根目录验证凭据
      await this.request({
        url: this.baseUrl,
        method: 'PROPFIND',
        headers: {
          'Depth': '1',
          'Content-Type': 'application/xml'
        }
      });
      
      // 确保同步根目录存在
      await this.ensureRootDir();
      
      new Notice('坚果云授权成功');
      return true;
    } catch (error) {
      console.error('坚果云授权失败', error);
      new Notice('坚果云授权失败: ' + error.message);
      return false;
    }
  }

  /**
   * 刷新令牌
   * 坚果云使用基本认证，不需要刷新令牌
   */
  async refreshToken() {
    return true;
  }

  /**
   * 确保根目录存在
   * 检查并创建同步根目录
   */
  private async ensureRootDir() {
    const syncFolder = this.settings.syncFolder || 'obsidian';
    const rootPath = this.getFullPath('');
    
    try {
      // 检查根目录是否存在
      await this.request({
        url: rootPath,
        method: 'PROPFIND',
        headers: {
          'Depth': '0',
          'Content-Type': 'application/xml'
        }
      });
      console.log(`根目录已存在: ${syncFolder}`);
    } catch (error) {
      if (error.status === 404) {
        // 根目录不存在，创建它
        try {
          console.log(`创建根目录: ${syncFolder}`);
          await this.request({
            url: rootPath,
            method: 'MKCOL'
          });
          console.log(`根目录创建成功: ${syncFolder}`);
        } catch (createError) {
          console.error(`创建根目录失败: ${syncFolder}`, createError);
          throw new Error(`创建根目录失败: ${createError.message}`);
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * 上传文件
   * 将文件上传到坚果云WebDAV服务
   * @param path 文件路径
   * @param content 文件内容
   */
  async uploadFile(path: string, content: ArrayBuffer): Promise<void> {
    try {
      // 确保根目录存在
      await this.ensureRootDir();
      
      // 确保目录存在
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      await this.ensureDir(dirPath);
      
      // 获取完整路径
      const fullPath = this.getFullPath(path);
      
      // 尝试直接上传文件，使用PUT方法
      const maxRetries = 3;
      let lastError = null;
      
      for (let i = 0; i < maxRetries; i++) {
        try {
          console.log(`尝试上传文件 (${i+1}/${maxRetries}): ${path}`);
          
          // 先尝试删除现有文件，不管是否存在
          try {
            await this.request({
              url: fullPath,
              method: 'DELETE'
            });
            console.log(`删除现有文件成功: ${path}`);
            
            // 等待删除操作完成
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (deleteError) {
            // 忽略删除错误，继续上传
            if (deleteError.status !== 404) {
              console.warn(`删除现有文件失败: ${path}`, deleteError);
            }
          }
          
          // 使用PUT方法上传文件
          await this.request({
            url: fullPath,
            method: 'PUT',
            body: content,
            headers: {
              'Content-Type': 'application/octet-stream',
              'Overwrite': 'T'
            }
          });
          
          console.log(`文件上传成功: ${path}`);
          return;
        } catch (error) {
          lastError = error;
          console.warn(`上传失败 (${i+1}/${maxRetries}): ${path}`, error);
          
          // 如果不是409错误，可能是其他问题，直接抛出
          if (error.status !== 409) {
            throw error;
          }
          
          // 等待更长时间后重试
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      // 所有重试都失败，尝试使用临时文件名上传
      try {
        // 生成一个唯一的文件名，使用更长的随机字符串
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 15) + 
                          Math.random().toString(36).substring(2, 15);
        const fileName = path.substring(path.lastIndexOf('/') + 1);
        const uniqueFileName = `temp_${timestamp}_${randomStr}_${fileName}`;
        const uniquePath = `${dirPath}/${uniqueFileName}`;
        const fullUniquePath = this.getFullPath(uniquePath);
        
        console.log(`尝试使用临时文件名上传: ${uniquePath}`);
        
        // 上传到临时文件名
        await this.request({
          url: fullUniquePath,
          method: 'PUT',
          body: content,
          headers: {
            'Content-Type': 'application/octet-stream'
          }
        });
        
        console.log(`临时文件上传成功: ${uniquePath}`);
        
        // 等待上传完成
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 尝试删除目标文件
        try {
          await this.request({
            url: fullPath,
            method: 'DELETE'
          });
          console.log(`删除目标文件成功: ${path}`);
          
          // 等待删除操作完成
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (deleteError) {
          // 忽略404错误（文件不存在）
          if (deleteError.status !== 404) {
            console.warn(`删除目标文件失败: ${path}，将尝试覆盖`, deleteError);
          }
        }
        
        // 重命名临时文件到目标文件
        try {
          await this.request({
            url: fullUniquePath,
            method: 'MOVE',
            headers: {
              'Destination': fullPath,
              'Overwrite': 'T'
            }
          });
          
          console.log(`重命名临时文件成功: ${uniquePath} -> ${path}`);
          return;
        } catch (moveError) {
          console.error(`重命名临时文件失败: ${uniquePath} -> ${path}`, moveError);
          
          // 如果重命名失败，尝试直接复制内容
          try {
            await this.request({
              url: fullPath,
              method: 'PUT',
              body: content,
              headers: {
                'Content-Type': 'application/octet-stream',
                'Overwrite': 'T'
              }
            });
            
            console.log(`直接复制内容成功: ${path}`);
            
            // 尝试删除临时文件
            try {
              await this.request({
                url: fullUniquePath,
                method: 'DELETE'
              });
            } catch (cleanupError) {
              console.warn(`删除临时文件失败: ${uniquePath}`, cleanupError);
            }
            
            return;
          } catch (copyError) {
            console.error(`直接复制内容失败: ${path}`, copyError);
            throw new Error(`上传文件失败: 重命名和复制都失败 (${moveError.message}, ${copyError.message})`);
          }
        }
      } catch (tempError) {
        console.error(`临时文件上传失败: ${path}`, tempError);
        throw new Error(`上传文件失败: 所有方法都失败 (${lastError?.message || '未知错误'}, ${tempError.message})`);
      }
    } catch (error) {
      console.error('上传文件失败', error);
      throw new Error('上传文件失败: ' + error.message);
    }
  }

  /**
   * 下载文件
   * 从坚果云WebDAV服务下载文件
   * @param path 文件路径
   * @returns 文件内容
   */
  async downloadFile(path: string): Promise<ArrayBuffer> {
    try {
      const fullPath = this.getFullPath(path);
      
      const response = await this.request({
        url: fullPath,
        method: 'GET'
      });
      
      return response.arrayBuffer;
    } catch (error) {
      console.error('下载文件失败', error);
      throw new Error('下载文件失败: ' + error.message);
    }
  }

  /**
   * 删除文件
   * 从坚果云WebDAV服务删除文件
   * @param path 文件路径
   */
  async deleteFile(path: string): Promise<void> {
    try {
      const fullPath = this.getFullPath(path);
      
      await this.request({
        url: fullPath,
        method: 'DELETE'
      });
    } catch (error) {
      // 如果文件不存在，视为删除成功
      if (error.status === 404) {
        return;
      }
      
      console.error('删除文件失败', error);
      throw new Error('删除文件失败: ' + error.message);
    }
  }

  /**
   * 列出文件
   * 列出坚果云WebDAV服务中的文件
   * @param dirPath 目录路径
   * @returns 文件列表
   */
  async listFiles(dirPath: string = ''): Promise<{path: string, isdir: number}[]> {
    try {
      const fullPath = this.getFullPath(dirPath);
      let syncFolderPath = this.settings.syncFolder || 'obsidian';
      
      if (!syncFolderPath.endsWith('/')) {
        syncFolderPath += '/';
      }
      
      const response = await this.request({
        url: fullPath,
        method: 'PROPFIND',
        headers: {
          'Depth': '1',
          'Content-Type': 'application/xml'
        }
      });
      
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(response.text, 'text/xml');
      const responses = xmlDoc.getElementsByTagNameNS('DAV:', 'response');
      
      const files: {path: string, isdir: number}[] = [];
      
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        const hrefElement = response.getElementsByTagNameNS('DAV:', 'href')[0];
        
        // 确保href元素存在并且有文本内容
        if (!hrefElement || !hrefElement.textContent) {
          console.warn('跳过无效的响应项：缺少href元素或内容');
          continue;
        }
        
        const href = hrefElement.textContent;
        const propstat = response.getElementsByTagNameNS('DAV:', 'propstat')[0];
        const prop = propstat.getElementsByTagNameNS('DAV:', 'prop')[0];
        const resourcetype = prop.getElementsByTagNameNS('DAV:', 'resourcetype')[0];
        const isCollection = resourcetype.getElementsByTagNameNS('DAV:', 'collection').length > 0;
        
        // 跳过当前目录
        if (href.endsWith('/') && fullPath.endsWith(href)) {
          continue;
        }
        
        // 处理路径
        let relativePath = decodeURIComponent(href);
        
        // 移除基础URL部分
        const baseUrlParts = this.baseUrl.split('/');
        const basePath = baseUrlParts[baseUrlParts.length - 1];
        if (relativePath.startsWith('/' + basePath + '/')) {
          relativePath = relativePath.substring(basePath.length + 2);
        } else if (relativePath.startsWith('/')) {
          relativePath = relativePath.substring(1);
        }
        
        // 移除同步文件夹前缀
        if (relativePath.startsWith(syncFolderPath)) {
          relativePath = relativePath.substring(syncFolderPath.length);
        }
        
        // 移除尾部斜杠
        if (isCollection && relativePath.endsWith('/')) {
          relativePath = relativePath.substring(0, relativePath.length - 1);
        }
        
        // 移除开头的斜杠
        if (relativePath.startsWith('/')) {
          relativePath = relativePath.substring(1);
        }
        
        files.push({
          path: relativePath,
          isdir: isCollection ? 1 : 0
        });
      }
      
      return files;
    } catch (error) {
      console.error('列出文件失败', error);
      return [];
    }
  }

  /**
   * 获取完整路径
   * 根据相对路径获取完整的WebDAV URL
   * @param path 相对路径
   * @returns 完整的WebDAV URL
   */
  private getFullPath(path: string): string {
    let syncFolder = this.settings.syncFolder || 'obsidian';
    
    // 确保同步文件夹路径格式正确
    if (syncFolder && !syncFolder.startsWith('/')) {
      syncFolder = '/' + syncFolder;
    }
    if (syncFolder && !syncFolder.endsWith('/')) {
      syncFolder = syncFolder + '/';
    }
    
    // 组合路径
    let fullPath = path ? (syncFolder + path) : syncFolder;
    
    // 确保路径以斜杠开头
    if (!fullPath.startsWith('/')) {
      fullPath = '/' + fullPath;
    }
    
    // 移除多余的斜杠
    fullPath = fullPath.replace(/\/+/g, '/');
    
    // 构建完整URL
    return `${this.baseUrl}${fullPath}`;
  }

  /**
   * 发送请求
   * 向坚果云WebDAV服务发送HTTP请求
   * @param params 请求参数
   * @returns 请求响应
   */
  private async request(params: RequestUrlParam) {
    if (!this.settings.username || !this.settings.password) {
      throw new Error('未设置坚果云用户名和密码');
    }
    
    // 添加基本认证头
    const authHeader = 'Basic ' + btoa(`${this.settings.username}:${this.settings.password}`);
    params.headers = {
      ...params.headers || {},
      'Authorization': authHeader
    };
    
    try {
      return await requestUrl(params);
    } catch (error) {
      // 增强错误信息
      if (error.status === 409) {
        console.error(`坚果云请求冲突(409): ${params.url}`, error);
        throw new Error(`坚果云请求冲突: 文件可能已存在或被锁定 (${error.message})`);
      } else if (error.status === 400) {
        console.error(`坚果云请求错误(400): ${params.url}`, error);
        throw new Error(`坚果云请求格式错误: 请检查文件名是否包含特殊字符 (${error.message})`);
      } else if (error.status === 423) {
        console.error(`坚果云资源锁定(423): ${params.url}`, error);
        throw new Error(`坚果云资源被锁定: 请稍后再试 (${error.message})`);
      } else if (error.status === 404) {
        console.warn(`坚果云资源不存在(404): ${params.url}`);
        throw error; // 保留404错误，让调用者处理
      } else if (error.status === 401) {
        console.error(`坚果云认证失败(401): ${params.url}`);
        throw new Error(`坚果云认证失败: 请检查用户名和密码 (${error.message})`);
      } else {
        console.error(`坚果云请求失败(${error.status || '未知状态码'}): ${params.url}`, error);
        throw error;
      }
    }
  }

  /**
   * 确保目录存在
   * 检查并创建目录路径
   * @param dirPath 目录路径
   */
  private async ensureDir(dirPath: string) {
    if (!dirPath || dirPath === '/') {
      return;
    }
    
    // 分割路径
    const parts = dirPath.split('/').filter(p => p);
    let currentPath = '';
    
    for (const part of parts) {
      currentPath += '/' + part;
      const fullPath = this.getFullPath(currentPath);
      
      try {
        // 使用PROPFIND检查目录是否存在
        await this.request({
          url: fullPath,
          method: 'PROPFIND',
          headers: {
            'Depth': '0',
            'Content-Type': 'application/xml'
          }
        });
      } catch (error) {
        // 目录不存在，创建它
        if (error.status === 404) {
          try {
            await this.request({
              url: fullPath,
              method: 'MKCOL'
            });
          } catch (createError) {
            // 如果是409错误，可能是目录已存在（并发创建）
            if (createError.status === 409) {
              // 目录可能已存在，继续处理下一级
              continue;
            }
            
            // 如果是400错误，可能是路径格式问题
            if (createError.status === 400) {
              console.error(`创建目录失败(400): ${currentPath}，可能是路径格式问题`, createError);
              throw new Error(`创建目录失败: 路径格式错误 (${currentPath})`);
            }
            
            throw createError;
          }
        } else {
          throw error;
        }
      }
    }
  }
} 