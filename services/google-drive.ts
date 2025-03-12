import { requestUrl, RequestUrlParam, Notice } from 'obsidian';
import { GoogleDriveSettings } from '../settings';

export class GoogleDriveService {
  private settings: GoogleDriveSettings;
  private baseUrl = 'https://www.googleapis.com/drive/v3';
  private uploadUrl = 'https://www.googleapis.com/upload/drive/v3';
  private oauthUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  private tokenUrl = 'https://oauth2.googleapis.com/token';
  private authWindow: Window | null = null;
  
  constructor(settings: GoogleDriveSettings) {
    this.settings = settings;
  }

  async authorize() {
    if (!this.settings.clientId || !this.settings.clientSecret) {
      new Notice('请先设置Google Drive客户端 ID 和密钥');
      return;
    }
    
    // 构建授权 URL
    const redirectUri = 'https://obsidian.md/callback';
    const scope = 'https://www.googleapis.com/auth/drive.file';
    const authUrl = `${this.oauthUrl}?client_id=${this.settings.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;
    
    // 打开授权窗口
    this.authWindow = window.open(authUrl, 'googleAuth', 'width=800,height=600');
    
    // 监听消息
    window.addEventListener('message', this.handleAuthCallback.bind(this), { once: true });
    
    new Notice('请在打开的窗口中完成Google Drive授权');
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
      new Notice(`Google Drive授权失败: ${error}`);
      return;
    }
    
    if (!code) {
      new Notice('Google Drive授权失败: 未收到授权码');
      return;
    }
    
    try {
      // 获取访问令牌
      await this.getAccessToken(code);
      new Notice('Google Drive授权成功');
    } catch (error) {
      new Notice(`Google Drive授权失败: ${error.message}`);
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
        code,
        client_id: this.settings.clientId,
        client_secret: this.settings.clientSecret,
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
          refresh_token: this.settings.refreshToken,
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret,
          grant_type: 'refresh_token'
        }).toString()
      });
      
      const data = response.json;
      this.settings.accessToken = data.access_token;
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
        throw new Error('未授权，请先授权Google Drive');
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
  private async getOrCreateFolder(folderName: string, parentId: string = 'root'): Promise<string> {
    try {
      // 查询文件夹是否存在
      const response = await this.request({
        url: `${this.baseUrl}/files?q=name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
        method: 'GET'
      });
      
      if (response.json.files && response.json.files.length > 0) {
        return response.json.files[0].id;
      }
      
      // 创建文件夹
      const createResponse = await this.request({
        url: `${this.baseUrl}/files`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId]
        })
      });
      
      return createResponse.json.id;
    } catch (error) {
      console.error('获取或创建文件夹失败', error);
      throw new Error('获取或创建文件夹失败: ' + error.message);
    }
  }

  // 确保路径存在，返回最后一个文件夹的 ID
  private async ensurePath(path: string): Promise<string> {
    const parts = path.split('/').filter(p => p);
    let parentId = 'root';
    
    // 确保同步根目录存在
    if (this.settings.syncFolder && this.settings.syncFolder !== '/') {
      const rootParts = this.settings.syncFolder.split('/').filter(p => p);
      for (const part of rootParts) {
        parentId = await this.getOrCreateFolder(part, parentId);
      }
    }
    
    for (const part of parts) {
      parentId = await this.getOrCreateFolder(part, parentId);
    }
    
    return parentId;
  }

  // 获取文件 ID
  private async getFileId(path: string): Promise<string | null> {
    try {
      const fileName = path.split('/').pop();
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      
      const parentId = await this.ensurePath(dirPath);
      
      const response = await this.request({
        url: `${this.baseUrl}/files?q=name='${fileName}' and '${parentId}' in parents and trashed=false`,
        method: 'GET'
      });
      
      if (response.json.files && response.json.files.length > 0) {
        return response.json.files[0].id;
      }
      
      return null;
    } catch (error) {
      console.error('获取文件 ID 失败', error);
      return null;
    }
  }

  // 上传文件
  async uploadFile(path: string, content: ArrayBuffer): Promise<void> {
    try {
      const fileName = path.split('/').pop();
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      
      const parentId = await this.ensurePath(dirPath);
      
      // 检查文件是否已存在
      const existingFileId = await this.getFileId(path);
      
      if (existingFileId) {
        // 更新文件
        await this.request({
          url: `${this.uploadUrl}/files/${existingFileId}?uploadType=media`,
          method: 'PATCH',
          body: content
        });
      } else {
        // 创建新文件
        const metadata = {
          name: fileName,
          parents: [parentId]
        };
        
        // 使用多部分上传
        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const closeDelimiter = "\r\n--" + boundary + "--";
        
        const metadataContent = JSON.stringify(metadata);
        
        // 创建多部分请求体
        const multipartRequestBody =
          delimiter +
          'Content-Type: application/json\r\n\r\n' +
          metadataContent +
          delimiter +
          'Content-Type: application/octet-stream\r\n\r\n';
        
        // 将字符串转换为 ArrayBuffer
        const encoder = new TextEncoder();
        const metadataBuffer = encoder.encode(multipartRequestBody);
        const closeBuffer = encoder.encode(closeDelimiter);
        
        // 合并所有部分
        const body = new Uint8Array(metadataBuffer.length + content.byteLength + closeBuffer.length);
        body.set(new Uint8Array(metadataBuffer), 0);
        body.set(new Uint8Array(content), metadataBuffer.length);
        body.set(new Uint8Array(closeBuffer), metadataBuffer.length + content.byteLength);
        
        await this.request({
          url: `${this.uploadUrl}/files?uploadType=multipart`,
          method: 'POST',
          headers: {
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          body: body.buffer
        });
      }
    } catch (error) {
      console.error('上传文件失败', error);
      throw new Error('上传文件失败: ' + error.message);
    }
  }

  // 下载文件
  async downloadFile(filePath: string): Promise<ArrayBuffer> {
    try {
      const fileId = await this.getFileId(filePath);
      if (!fileId) {
        throw new Error(`文件不存在: ${filePath}`);
      }
      
      const response = await this.request({
        url: `${this.baseUrl}/files/${fileId}?alt=media`,
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
      const fileId = await this.getFileId(filePath);
      if (!fileId) {
        return { success: true }; // 文件不存在，视为删除成功
      }
      
      await this.request({
        url: `${this.baseUrl}/files/${fileId}`,
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
      const fileId = await this.getFileId(oldPath);
      if (!fileId) {
        throw new Error(`文件不存在: ${oldPath}`);
      }
      
      const newFileName = newPath.split('/').pop();
      
      await this.request({
        url: `${this.baseUrl}/files/${fileId}`,
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
      let parentId = 'root';
      
      if (dirPath !== '/') {
        const folderId = await this.getFileId(dirPath);
        if (!folderId) {
          return [];
        }
        parentId = folderId;
      }
      
      const response = await this.request({
        url: `${this.baseUrl}/files?q='${parentId}' in parents and trashed=false`,
        method: 'GET'
      });
      
      return response.json.files || [];
    } catch (error) {
      console.error('列出文件失败', error);
      return [];
    }
  }
} 