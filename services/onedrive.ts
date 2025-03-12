import { requestUrl, RequestUrlParam, Notice } from 'obsidian';
import { OneDriveSettings } from '../settings';

export class OneDriveService {
  private settings: OneDriveSettings;
  private baseUrl = 'https://graph.microsoft.com/v1.0/me/drive';
  private oauthUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  private tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  private authWindow: Window | null = null;
  
  constructor(settings: OneDriveSettings) {
    this.settings = settings;
  }

  async authorize() {
    if (!this.settings.clientId) {
      new Notice('请先设置 OneDrive 客户端 ID');
      return;
    }
    
    // 构建授权 URL
    const redirectUri = 'https://obsidian.md/callback';
    const scope = 'files.readwrite offline_access';
    const authUrl = `${this.oauthUrl}?client_id=${this.settings.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;
    
    // 打开授权窗口
    this.authWindow = window.open(authUrl, 'onedriveAuth', 'width=800,height=600');
    
    // 监听消息
    window.addEventListener('message', this.handleAuthCallback.bind(this), { once: true });
    
    new Notice('请在打开的窗口中完成 OneDrive 授权');
  }

  private async handleAuthCallback(event: MessageEvent) {
    if (event.origin !== window.location.origin) {
      return;
    }
    
    if (this.authWindow) {
      this.authWindow.close();
      this.authWindow = null;
    }
    
    const { code, error } = event.data;
    
    if (error) {
      new Notice(`OneDrive 授权失败: ${error}`);
      return;
    }
    
    if (!code) {
      new Notice('OneDrive 授权失败: 未收到授权码');
      return;
    }
    
    try {
      // 获取访问令牌
      await this.getAccessToken(code);
      new Notice('OneDrive 授权成功');
    } catch (error) {
      new Notice(`OneDrive 授权失败: ${error.message}`);
    }
  }

  private async getAccessToken(code: string) {
    const response = await requestUrl({
      url: this.tokenUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret || '',
        code,
        redirect_uri: 'https://obsidian.md/callback',
        grant_type: 'authorization_code'
      }).toString()
    });
    
    const data = response.json;
    
    this.settings.accessToken = data.access_token;
    this.settings.refreshToken = data.refresh_token;
    this.settings.expiresAt = Date.now() + data.expires_in * 1000;
  }

  async refreshToken() {
    if (!this.settings.refreshToken) {
      throw new Error('刷新令牌不存在，请重新授权');
    }
    
    try {
      const response = await requestUrl({
        url: this.tokenUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret || '',
          refresh_token: this.settings.refreshToken,
          grant_type: 'refresh_token'
        }).toString()
      });
      
      const data = response.json;
      this.settings.accessToken = data.access_token;
      this.settings.refreshToken = data.refresh_token;
      this.settings.expiresAt = Date.now() + data.expires_in * 1000;
      
      return true;
    } catch (error) {
      console.error('刷新令牌失败', error);
      throw new Error('刷新令牌失败: ' + error.message);
    }
  }

  private async request(params: RequestUrlParam) {
    try {
      if (!this.settings.accessToken) {
        throw new Error('未授权，请先授权 OneDrive');
      }
      
      // 检查令牌是否过期
      if (this.settings.expiresAt && Date.now() > this.settings.expiresAt) {
        await this.refreshToken();
      }
      
      // 添加访问令牌
      params.headers = {
        ...params.headers || {},
        'Authorization': `Bearer ${this.settings.accessToken}`
      };
      
      return await requestUrl(params);
    } catch (error) {
      // 如果是令牌过期，尝试刷新令牌
      if (error.status === 401) {
        await this.refreshToken();
        // 重试请求
        params.headers = {
          ...params.headers || {},
          'Authorization': `Bearer ${this.settings.accessToken}`
        };
        return await requestUrl(params);
      }
      throw error;
    }
  }

  // 获取或创建文件夹
  private async getOrCreateFolder(folderPath: string): Promise<string> {
    try {
      // 尝试获取文件夹
      try {
        const response = await this.request({
          url: `${this.baseUrl}/root:/${this.settings.syncFolder}${folderPath}`,
          method: 'GET'
        });
        
        return response.json.id;
      } catch (error) {
        // 文件夹不存在，创建它
        const parentPath = folderPath.substring(0, folderPath.lastIndexOf('/'));
        const folderName = folderPath.split('/').pop();
        
        // 确保父文件夹存在
        let parentId;
        if (parentPath) {
          parentId = await this.getOrCreateFolder(parentPath);
        }
        
        // 创建文件夹
        const createResponse = await this.request({
          url: parentId 
            ? `${this.baseUrl}/items/${parentId}/children` 
            : `${this.baseUrl}/root:/${this.settings.syncFolder}:/children`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: folderName,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'rename'
          })
        });
        
        return createResponse.json.id;
      }
    } catch (error) {
      console.error('获取或创建文件夹失败', error);
      throw new Error('获取或创建文件夹失败: ' + error.message);
    }
  }

  // 上传文件
  async uploadFile(path: string, content: ArrayBuffer): Promise<void> {
    try {
      // 确保目录存在
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      const fileName = path.substring(path.lastIndexOf('/') + 1);
      
      // 获取父目录ID
      let parentId;
      if (dirPath) {
        parentId = await this.getOrCreateFolder(dirPath);
      }
      
      // 上传文件
      if (content.byteLength < 4 * 1024 * 1024) { // 小于 4MB 的文件
        // 直接上传
        await this.request({
          url: parentId 
            ? `${this.baseUrl}/items/${parentId}:/${fileName}:/content` 
            : `${this.baseUrl}/root:/${this.settings.syncFolder}${path}:/content`,
          method: 'PUT',
          body: content
        });
      } else {
        // 创建上传会话
        const sessionResponse = await this.request({
          url: parentId 
            ? `${this.baseUrl}/items/${parentId}:/${fileName}:/createUploadSession` 
            : `${this.baseUrl}/root:/${this.settings.syncFolder}${path}:/createUploadSession`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            item: {
              '@microsoft.graph.conflictBehavior': 'replace'
            }
          })
        });
        
        const uploadUrl = sessionResponse.json.uploadUrl;
        
        // 分片上传
        const chunkSize = 4 * 1024 * 1024; // 4MB
        const chunks = Math.ceil(content.byteLength / chunkSize);
        
        for (let i = 0; i < chunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, content.byteLength);
          const chunk = content.slice(start, end);
          
          await requestUrl({
            url: uploadUrl,
            method: 'PUT',
            headers: {
              'Content-Length': `${chunk.byteLength}`,
              'Content-Range': `bytes ${start}-${end-1}/${content.byteLength}`
            },
            body: chunk
          });
        }
      }
    } catch (error) {
      console.error('上传文件失败', error);
      throw new Error('上传文件失败: ' + error.message);
    }
  }

  // 下载文件
  async downloadFile(filePath: string): Promise<ArrayBuffer> {
    try {
      const response = await this.request({
        url: `${this.baseUrl}/root:/${this.settings.syncFolder}${filePath}:/content`,
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
        url: `${this.baseUrl}/root:/${this.settings.syncFolder}${filePath}`,
        method: 'DELETE'
      });
      
      return { success: true };
    } catch (error) {
      // 如果文件不存在，视为删除成功
      if (error.status === 404) {
        return { success: true };
      }
      
      console.error('删除文件失败', error);
      throw new Error('删除文件失败: ' + error.message);
    }
  }

  // 重命名文件
  async renameFile(oldPath: string, newPath: string): Promise<any> {
    try {
      const newFileName = newPath.split('/').pop();
      
      await this.request({
        url: `${this.baseUrl}/root:/${this.settings.syncFolder}${oldPath}`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: newFileName
        })
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
        url: `${this.baseUrl}/root:/${this.settings.syncFolder}${dirPath}:/children`,
        method: 'GET'
      });
      
      return response.json.value || [];
    } catch (error) {
      // 如果目录不存在，返回空数组
      if (error.status === 404) {
        return [];
      }
      
      console.error('列出文件失败', error);
      return [];
    }
  }
} 