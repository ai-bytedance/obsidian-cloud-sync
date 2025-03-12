import { requestUrl, RequestUrlParam, Notice } from 'obsidian';
import { JianguoyunDriveSettings } from '../settings';

export class JianguoyunDriveService {
  private settings: JianguoyunDriveSettings;
  private baseUrl = 'https://dav.jianguoyun.com/dav';
  
  constructor(settings: JianguoyunDriveSettings) {
    this.settings = settings;
  }

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
      
      new Notice('坚果云授权成功');
      return true;
    } catch (error) {
      console.error('坚果云授权失败', error);
      new Notice('坚果云授权失败: ' + error.message);
      return false;
    }
  }

  // 坚果云不需要刷新令牌，使用基本认证
  async refreshToken() {
    return true;
  }

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
    
    return await requestUrl(params);
  }

  // 上传文件
  async uploadFile(path: string, content: ArrayBuffer): Promise<void> {
    try {
      // 确保目录存在
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      await this.ensureDir(dirPath);
      
      // 上传文件
      await this.request({
        url: `${this.baseUrl}/${this.settings.syncFolder}${path}`,
        method: 'PUT',
        body: content
      });
      
      return;
    } catch (error) {
      console.error('上传文件失败', error);
      throw new Error('上传文件失败: ' + error.message);
    }
  }

  // 下载文件
  async downloadFile(filePath: string): Promise<ArrayBuffer> {
    try {
      const response = await this.request({
        url: `${this.baseUrl}/${this.settings.syncFolder}${filePath}`,
        method: 'GET'
      });
      
      return response.arrayBuffer;
    } catch (error) {
      console.error('下载文件失败', error);
      throw new Error('下载文件失败: ' + error.message);
    }
  }

  // 删除文件
  async deleteFile(filePath: string): Promise<any> {
    try {
      await this.request({
        url: `${this.baseUrl}/${this.settings.syncFolder}${filePath}`,
        method: 'DELETE'
      });
      
      return { success: true };
    } catch (error) {
      console.error('删除文件失败', error);
      throw new Error('删除文件失败: ' + error.message);
    }
  }

  // 重命名文件
  async renameFile(oldPath: string, newPath: string): Promise<any> {
    try {
      await this.request({
        url: `${this.baseUrl}/${this.settings.syncFolder}${oldPath}`,
        method: 'MOVE',
        headers: {
          'Destination': `${this.baseUrl}/${this.settings.syncFolder}${newPath}`
        }
      });
      
      return { success: true };
    } catch (error) {
      console.error('重命名文件失败', error);
      throw new Error('重命名文件失败: ' + error.message);
    }
  }

  // 列出文件
  async listFiles(dirPath: string = '/'): Promise<any[]> {
    try {
      const response = await this.request({
        url: `${this.baseUrl}/${this.settings.syncFolder}${dirPath}`,
        method: 'PROPFIND',
        headers: {
          'Depth': '1',
          'Content-Type': 'application/xml'
        }
      });
      
      // 解析 WebDAV 响应
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(response.text, "text/xml");
      const responses = xmlDoc.getElementsByTagNameNS("DAV:", "response");
      
      const files = [];
      for (let i = 0; i < responses.length; i++) {
        const hrefElement = responses[i].getElementsByTagNameNS("DAV:", "href")[0];
        // 检查 href 是否存在
        if (!hrefElement || !hrefElement.textContent) {
          continue; // 跳过没有 href 的项
        }
        
        const href = hrefElement.textContent;
        const propstat = responses[i].getElementsByTagNameNS("DAV:", "propstat")[0];
        const prop = propstat.getElementsByTagNameNS("DAV:", "prop")[0];
        const resourcetype = prop.getElementsByTagNameNS("DAV:", "resourcetype")[0];
        const isCollection = resourcetype.getElementsByTagNameNS("DAV:", "collection").length > 0;
        
        // 跳过当前目录
        if (href === `${this.baseUrl}/${this.settings.syncFolder}${dirPath}`) {
          continue;
        }
        
        files.push({
          path: href.replace(`${this.baseUrl}/${this.settings.syncFolder}`, ''),
          isdir: isCollection ? 1 : 0
        });
      }
      
      return files;
    } catch (error) {
      console.error('列出文件失败', error);
      return [];
    }
  }

  // 确保目录存在
  private async ensureDir(dirPath: string) {
    // 分割路径
    const parts = dirPath.split('/').filter(p => p);
    let currentPath = '';
    
    for (const part of parts) {
      currentPath += '/' + part;
      
      try {
        // 检查目录是否存在
        await this.request({
          url: `${this.baseUrl}/${this.settings.syncFolder}${currentPath}`,
          method: 'PROPFIND',
          headers: {
            'Depth': '0',
            'Content-Type': 'application/xml'
          }
        });
      } catch (error) {
        // 目录不存在，创建它
        await this.request({
          url: `${this.baseUrl}/${this.settings.syncFolder}${currentPath}`,
          method: 'MKCOL'
        });
      }
    }
    
    return currentPath;
  }
} 