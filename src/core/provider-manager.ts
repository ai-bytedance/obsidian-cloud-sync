import { StorageProvider, ConnectionStatus } from '@providers/common/storage-provider';
import { StorageProviderType, PluginSettings } from '@models/plugin-settings';
import { WebDAVProvider } from '@providers/webdav/webdav-provider';
import { NotificationManager } from '@services/notification/notification-manager';
import { App } from 'obsidian';
import { LogService, ModuleLogger } from '@services/log/log-service';

// 使用保存设置的接口
interface SettingsSaver {
  saveSettings(): Promise<void>;
  logService: LogService;
}

/**
 * 提供商管理器类
 * 负责管理存储提供商的初始化、连接和断开
 * @author Bing
 */
export class ProviderManager {
  private storageProviders: Map<StorageProviderType, StorageProvider> = new Map();
  private logger: ModuleLogger;
  
  /**
   * 构造函数
   * @param app Obsidian应用实例
   * @param settings 插件设置
   * @param notificationManager 通知管理器
   * @param settingsSaver 提供保存设置方法的对象
   * @author Bing
   */
  constructor(
    private app: App,
    private settings: PluginSettings,
    private notificationManager: NotificationManager,
    private settingsSaver: SettingsSaver
  ) {
    this.logger = this.settingsSaver.logService.getModuleLogger('ProviderManager');
  }
  
  /**
   * 获取存储提供商映射
   * @returns 存储提供商映射
   * @author Bing
   */
  getProviders(): Map<StorageProviderType, StorageProvider> {
    return this.storageProviders;
  }
  
  /**
   * 初始化存储提供商
   * @param forceInitialize 是否强制初始化（忽略全局同步开关状态）
   * @author Bing
   */
  async initializeProviders(forceInitialize: boolean = false) {
    this.logger.info('初始化存储提供商...');
    this.logger.info(`当前环境: forceInitialize=${forceInitialize}, enableSync=${this.settings.enableSync}`);
    this.logger.info(`当前enabledProviders=${JSON.stringify(this.settings.enabledProviders || [])}`);
    this.logger.info(`当前WebDAV配置: ${this.isWebDAVConfigComplete(this.settings.providerSettings?.webdav) ? '完整' : '不完整'}, enabled=${this.settings.providerSettings?.webdav?.enabled}`);
    
    // 改进：临时变量保存是否跳过enableSync检查
    let skipEnableSyncCheck = forceInitialize;
    
    // 改进：在强制初始化模式下，如果WebDAV配置完整，总是允许初始化
    if (forceInitialize) {
      const webdavConfigured = this.isWebDAVConfigComplete(this.settings.providerSettings.webdav);
        
      if (webdavConfigured) {
        this.logger.info('强制初始化模式：检测到WebDAV配置完整，允许初始化');
        skipEnableSyncCheck = true;
      }
    }
    
    // 如果同步功能未启用且不允许跳过检查，则不初始化提供商
    if (!this.settings.enableSync && !skipEnableSyncCheck) {
      this.logger.info('同步功能未启用，跳过初始化存储提供商');
      return;
    }
    
    // 检查 enabledProviders 是否存在且至少有一个元素
    if (!this.settings.enabledProviders || this.settings.enabledProviders.length === 0) {
      this.logger.info('没有启用的存储提供商，请在设置中至少启用一个提供商');
      this.logger.info('当前同步开关状态:', this.settings.enableSync);
      this.logger.info('当前WebDAV状态:', this.settings.providerSettings?.webdav?.enabled ? '已启用' : '未启用');
      this.logger.info('当前WebDAV配置状态:', 
        this.isWebDAVConfigComplete(this.settings.providerSettings?.webdav) ? '已配置' : '未配置');
      
      // 强制初始化时，如果WebDAV配置完整但未在列表中，临时添加它
      if (forceInitialize && this.isWebDAVConfigComplete(this.settings.providerSettings?.webdav)) {
        this.logger.info('强制初始化模式：WebDAV配置完整但不在启用列表中，临时添加');
        if (!this.settings.enabledProviders) {
          this.settings.enabledProviders = [];
        }
        if (!this.settings.enabledProviders.includes('webdav')) {
          this.settings.enabledProviders.push('webdav');
          
          // 确保WebDAV标记为启用
          if (this.settings.providerSettings?.webdav) {
            this.settings.providerSettings.webdav.enabled = true;
          }
        }
        
        // 记录更新后的状态
        this.logger.info(`临时添加后enabledProviders=${JSON.stringify(this.settings.enabledProviders)}`);
      } else {
        return;
      }
    }
    
    // 记录当前提供商映射状态
    this.logger.info(`初始化前，当前提供商映射大小: ${this.storageProviders.size}`);
    if (this.storageProviders.size > 0) {
      this.logger.info('当前已有的提供商:');
      for (const [key, provider] of this.storageProviders.entries()) {
        this.logger.info(`- ${key}: ${provider.getName()}`);
      }
    }
    
    // 添加安全机制：保存现有的WebDAV提供商实例（如果存在且有效）
    let existingWebDAVProvider: StorageProvider | undefined;
    if (this.storageProviders.has('webdav') && 
        this.isWebDAVConfigComplete(this.settings.providerSettings?.webdav)) {
      try {
        const provider = this.storageProviders.get('webdav');
        if (provider) {
          this.logger.info('保存现有WebDAV提供商实例，以备初始化失败时恢复');
          existingWebDAVProvider = provider;
        }
      } catch (e) {
        this.logger.info('获取现有WebDAV提供商时出错，将创建新实例', e);
      }
    }
    
    // 先清空现有提供商
    try {
      this.logger.info('清空现有提供商映射');
      this.storageProviders.clear();
      this.logger.info('提供商映射已清空，当前大小: 0');
    } catch (error) {
      this.logger.error('清空提供商映射时出错:', error);
      // 创建新的映射对象，以防止错误
      this.storageProviders = new Map();
    }
    
    // 临时变量跟踪初始化尝试的提供商数量
    let totalProvidersAttempted = 0;
    let successfulProviders = 0;
    
    // 初始化启用的提供商
    const enabledProviders = [...this.settings.enabledProviders]; // 创建副本以防止迭代期间修改
    this.logger.info(`准备初始化 ${enabledProviders.length} 个提供商: ${enabledProviders.join(', ')}`);
    
    for (const providerType of enabledProviders) {
      totalProvidersAttempted++;
      try {
        this.logger.info(`开始初始化提供商: ${providerType}`);
        const result = await this.initializeProvider(providerType);
        if (result) {
          successfulProviders++;
          this.logger.info(`提供商 ${providerType} 初始化成功`);
          
          // 验证提供商是否真的被添加到映射
          if (!this.storageProviders.has(providerType)) {
            this.logger.error(`警告: 提供商 ${providerType} 报告初始化成功，但未在映射中找到`);
            
            // 如果是WebDAV且配置完整，尝试手动添加
            if (providerType === 'webdav' && 
                this.isWebDAVConfigComplete(this.settings.providerSettings?.webdav) &&
                this.settings.providerSettings?.webdav) {
              try {
                this.logger.info('尝试手动创建WebDAV提供商实例');
                const webdavProvider = new WebDAVProvider(
                  this.settings.providerSettings.webdav, 
                  this.app
                );
                this.storageProviders.set('webdav', webdavProvider);
                this.logger.info('手动创建WebDAV提供商成功');
              } catch (e) {
                this.logger.error('手动创建WebDAV提供商失败:', e);
              }
            }
          }
        } else {
          this.logger.error(`提供商 ${providerType} 初始化失败`);
        }
      } catch (error) {
        this.logger.error(`初始化提供商 ${providerType} 时出错:`, error);
        
        // 如果是WebDAV提供商初始化失败，且之前有保存有效实例，尝试恢复
        if (providerType === 'webdav' && existingWebDAVProvider) {
          this.logger.info('WebDAV初始化失败，尝试恢复之前的有效实例');
          this.storageProviders.set('webdav', existingWebDAVProvider);
          successfulProviders++;
          
          // 验证恢复是否成功
          if (this.storageProviders.has('webdav')) {
            this.logger.info('WebDAV提供商恢复成功');
          } else {
            this.logger.error('WebDAV提供商恢复失败，映射中未找到');
          }
        }
      }
    }
    
    // 特别处理：如果WebDAV在启用列表中但未成功初始化，再尝试一次
    if (this.settings.enabledProviders.includes('webdav') && 
        !this.storageProviders.has('webdav') && 
        this.isWebDAVConfigComplete(this.settings.providerSettings?.webdav)) {
      this.logger.info('WebDAV在启用列表中但未初始化成功，尝试额外的恢复操作');
      
      try {
        if (this.settings.providerSettings?.webdav) {
          const webdavProvider = new WebDAVProvider(
            this.settings.providerSettings.webdav, 
            this.app
          );
          this.storageProviders.set('webdav', webdavProvider);
          successfulProviders++;
          
          // 验证恢复是否成功
          if (this.storageProviders.has('webdav')) {
            this.logger.info('WebDAV提供商额外恢复操作成功');
          } else {
            this.logger.error('WebDAV提供商额外恢复操作失败');
          }
        }
      } catch (e) {
        this.logger.error('WebDAV提供商额外恢复操作出错:', e);
      }
    }
    
    // 验证对象是否有效
    try {
      // 检查映射对象是否有效
      if (!this.storageProviders) {
        this.logger.error('提供商映射对象无效，创建新映射');
        this.storageProviders = new Map();
      }
    } catch (error) {
      this.logger.error('验证提供商映射对象时出错:', error);
      // 创建新的映射对象
      this.storageProviders = new Map();
    }
    
    if (this.storageProviders.size > 0) {
      this.logger.info(`已成功初始化的存储提供商 (${this.storageProviders.size}):`);
      for (const [key, provider] of this.storageProviders.entries()) {
        this.logger.info(`- ${key}: ${provider.getName()}`);
      }
    } else {
      this.logger.info('未能成功初始化任何提供商，请检查提供商配置和启用状态');
    }
  }
  
  /**
   * 验证并修复设置一致性问题
   * @returns 是否需要保存设置
   * @author Bing
   */
  validateAndFixSettings(): boolean {
    let needSave = false;
    
    // 确保基本设置结构存在
    if (!this.settings) {
      this.logger.error('设置对象不存在');
      return false;
    }
    
    // 确保providerSettings存在
    if (!this.settings.providerSettings) {
      this.logger.info('初始化providerSettings为空对象');
      this.settings.providerSettings = {};
      needSave = true;
    }
    
    // 初始化检查，确保enabledProviders是一个数组
    if (!this.settings.enabledProviders) {
      this.logger.info('初始化enabledProviders为空数组');
      this.settings.enabledProviders = [];
      needSave = true;
    }
    
    // 检查同步设置的一致性
    if (this.settings.enableSync === false && this.settings.syncInterval > 0) {
      this.logger.info('同步间隔大于0但同步未启用，修复为0');
      this.settings.syncInterval = 0;
      needSave = true;
    } else if (this.settings.enableSync === true && this.settings.syncInterval === 0) {
      this.logger.info('同步已启用但间隔为0，修复为默认值5');
      this.settings.syncInterval = 5;
      needSave = true;
    }
    
    // 检查WebDAV配置状态
    const webdavSettings = this.settings.providerSettings.webdav;
    const webdavConfigured = this.isWebDAVConfigComplete(webdavSettings);
    
    if (webdavConfigured) {
      this.logger.info('检测到WebDAV已配置完整');
      
      // 确保WebDAV的enabled标志与状态一致
      const isInEnabled = this.settings.enabledProviders.includes('webdav');
      // 配置已完整，webdavSettings一定存在
      const isWebDAVEnabled = webdavSettings?.enabled === true;
      
      this.logger.info(`当前WebDAV启用状态: ${isWebDAVEnabled ? '已启用' : '未启用'}`);
      this.logger.info(`当前WebDAV在提供商列表中: ${isInEnabled ? '是' : '否'}`);
      
      // 验证UI中开关状态与启用状态的一致性
      // 改进: 更主动地修复状态不一致问题，确保WebDAV在启用列表中且被标记为启用
      if (!isWebDAVEnabled || !isInEnabled) {
        if (!isWebDAVEnabled && webdavSettings) {
          this.logger.info('修复: 将WebDAV标记为已启用');
          webdavSettings.enabled = true;
          needSave = true;
        }
        
        if (!isInEnabled) {
          this.logger.info('修复: 将WebDAV添加到启用列表');
          this.settings.enabledProviders.push('webdav');
          needSave = true;
        }
      }
      
      // 改进: 当WebDAV配置完整且启用时，确保全局同步设置正确
      if (isWebDAVEnabled || (webdavSettings && webdavSettings.enabled)) {
        // 如果全局同步未启用，启用它并设置适当的同步间隔
        if (!this.settings.enableSync) {
          this.logger.info('修复：WebDAV已启用，但全局同步功能未开启，现自动启用全局同步');
          this.settings.enableSync = true;
          needSave = true;
        }
        
        // 确保同步间隔设置为合理值
        if (this.settings.syncInterval === 0) {
          this.logger.info('修复：WebDAV已启用，但同步间隔为0，设置为默认值5');
          this.settings.syncInterval = 5;
          needSave = true;
        }
      }
    } else {
      this.logger.info('WebDAV配置不完整');
      
      // 如果WebDAV配置不完整，确保它不在启用列表中
      if (this.settings.enabledProviders.includes('webdav')) {
        this.logger.info('修复: WebDAV配置不完整但在启用列表中，移除之');
        this.settings.enabledProviders = this.settings.enabledProviders.filter(p => p !== 'webdav');
        needSave = true;
      }
      
      // 如果没有启用的提供商且全局同步已启用，禁用全局同步
      if (this.settings.enabledProviders.length === 0 && this.settings.enableSync) {
        this.logger.info('修复: 没有启用的提供商但全局同步已启用，禁用全局同步');
        this.settings.enableSync = false;
        this.settings.syncInterval = 0;
        needSave = true;
      }
    }
    
    // 再次确认所有enabledProviders中的提供商都有正确的enabled标志
    if (this.settings.enabledProviders && this.settings.enabledProviders.length > 0) {
      for (const providerType of this.settings.enabledProviders) {
        if (providerType === 'webdav' && this.settings.providerSettings?.webdav) {
          if (this.settings.providerSettings.webdav.enabled !== true) {
            this.logger.info('修复: WebDAV在启用列表中但未标记为启用，设置其为启用');
            this.settings.providerSettings.webdav.enabled = true;
            needSave = true;
          }
        }
        // 为其他提供商类型添加类似的检查...
      }
    }
    
    // 如果进行了任何修复，输出修复后的状态
    if (needSave) {
      this.logger.info('修复后设置状态 - 同步启用:', this.settings.enableSync);
      this.logger.info('修复后设置状态 - 启用的提供商:', this.settings.enabledProviders);
      this.logger.info('修复后设置状态 - WebDAV启用:', 
        this.settings.providerSettings && 
        this.settings.providerSettings.webdav ? 
        this.settings.providerSettings.webdav.enabled : false);
    } else {
      this.logger.info('设置一致性验证完成，无需修复');
    }
    
    return needSave;
  }
  
  /**
   * 检查WebDAV配置是否完整
   * @param settings WebDAV设置对象
   * @returns 配置是否完整
   * @private
   */
  private isWebDAVConfigComplete(settings: any | undefined | null): boolean {
    // 首先检查整个设置对象是否存在
    if (!settings) {
      this.logger.info('WebDAV配置不完整：整个设置对象不存在');
      return false;
    }
    
    // 检查每个必要字段
    const hasServerUrl = typeof settings.serverUrl === 'string' && settings.serverUrl.trim() !== '';
    const hasUsername = typeof settings.username === 'string' && settings.username.trim() !== '';
    const hasPassword = typeof settings.password === 'string' && settings.password !== '';  // 密码可以是空白字符
    
    // 记录详细验证信息
    if (!hasServerUrl) {
      this.logger.info('WebDAV配置不完整：serverUrl无效 -', 
        typeof settings.serverUrl === 'string' ? `"${settings.serverUrl}"` : typeof settings.serverUrl);
    }
    
    if (!hasUsername) {
      this.logger.info('WebDAV配置不完整：username无效 -', 
        typeof settings.username === 'string' ? `"${settings.username}"` : typeof settings.username);
    }
    
    if (!hasPassword) {
      this.logger.info('WebDAV配置不完整：password无效 -', 
        settings.password === '' ? '空字符串' : (settings.password ? 'exists但无效' : '不存在'));
    }
    
    // 综合判断
    const isComplete = hasServerUrl && hasUsername && hasPassword;
    
    if (isComplete) {
      this.logger.info('WebDAV配置完整性检查通过');
    } else {
      this.logger.info('WebDAV配置不完整，缺少必要信息');
    }
    
    return isComplete;
  }
  
  /**
   * 初始化指定的提供商
   * @param providerName 提供商名称
   * @returns 是否初始化成功
   */
  public async initializeProvider(providerName: StorageProviderType): Promise<boolean> {
    // 首先检查是否在启用列表中
    if (!this.settings.enabledProviders.includes(providerName)) {
      this.logger.info(`提供商 ${providerName} 未在启用列表中，跳过初始化`);
      return false;
    }

    try {
      this.logger.info(`开始初始化提供商: ${providerName}`);
      
      // WebDAV特殊处理 - 在初始化前再次验证配置
      if (providerName === 'webdav') {
        const webdavSettings = this.settings.providerSettings?.webdav;
        const isComplete = this.isWebDAVConfigComplete(webdavSettings);
        this.logger.info(`尝试初始化WebDAV - 配置完整: ${isComplete}, 设置:`, 
          webdavSettings ? 
          `serverUrl: ${!!webdavSettings.serverUrl}, username: ${!!webdavSettings.username}, password: ${!!webdavSettings.password?.length}` : 
          'webdav设置不存在');
        
        if (!isComplete) {
          this.logger.info(`WebDAV配置不完整，无法初始化`);
          return false;
        }
      }

      // 根据提供商类型创建实例
      let storageProvider: StorageProvider | null = null;
      
      if (providerName === 'webdav') {
        const webdavSettings = this.settings.providerSettings?.webdav;
        if (webdavSettings) {
          storageProvider = new WebDAVProvider(webdavSettings, this.app);
        }
      } else {
        this.logger.warning(`不支持的提供商类型: ${providerName}`);
        return false;
      }

      // 保存提供商实例
      if (storageProvider) {
        this.storageProviders.set(providerName, storageProvider);
        
        // 验证提供商是否成功添加到映射
        const wasAdded = this.storageProviders.has(providerName);
        this.logger.info(`提供商 ${providerName} 添加到映射结果: ${wasAdded ? '成功' : '失败'}`);
        
        if (!wasAdded) {
          this.logger.error(`提供商 ${providerName} 创建后未成功添加到映射，这不应该发生`);
          
          // 再次尝试添加
          this.storageProviders.set(providerName, storageProvider);
          const retrySuccess = this.storageProviders.has(providerName);
          
          if (!retrySuccess) {
            this.logger.error(`再次尝试将 ${providerName} 添加到映射失败`);
            return false;
          } else {
            this.logger.info(`再次尝试添加 ${providerName} 到映射成功`);
          }
        }
        
        this.logger.info(`提供商 ${providerName} 初始化成功，当前映射大小: ${this.storageProviders.size}`);
        return true;
      }

      this.logger.info(`无法为提供商 ${providerName} 创建实例`);
      return false;
    } catch (error) {
      this.logger.error(`初始化提供商 ${providerName} 时发生错误:`, error);
      return false;
    }
  }
  
  /**
   * 断开所有存储提供商的连接
   * @author Bing
   */
  async disconnectAllProviders() {
    for (const provider of this.storageProviders.values()) {
      try {
        await provider.disconnect();
      } catch (error) {
        this.logger.error(`断开存储提供商 ${provider.getName()} 连接失败:`, error);
      }
    }
  }

  /**
   * 确保所有启用的提供商已被初始化
   * @param forceInit 即使提供商已初始化也重新初始化
   * @returns 提供商是否全部成功初始化
   */
  public async ensureProvidersInitialized(forceInit: boolean = false): Promise<boolean> {
    this.logger.info(`确保提供商初始化 - forceInitialize: ${forceInit}, 当前映射大小: ${this.storageProviders.size}`);
    // 保存原始同步状态
    const originalSyncEnabled = this.settings.enableSync;

    try {
      // 强制初始化时临时启用同步
      if (forceInit) {
        this.logger.info("强制初始化标志设置为 true，临时启用同步");
        this.settings.enableSync = true;
        
        // 保存设置以确保初始化过程有效
        await this.settingsSaver.saveSettings();
        
        // 添加短暂延迟，确保设置已保存并生效
        await new Promise(resolve => setTimeout(resolve, 100));
        this.logger.info('已保存临时启用的同步设置');
      }

      // 初始化提供商
      await this.initializeProviders(forceInit);
      
      // 验证WebDAV提供商是否在映射中
      const webdavSettingsComplete = this.isWebDAVConfigComplete(this.settings.providerSettings?.webdav);
      const webdavEnabled = this.settings.enabledProviders.includes('webdav');
      
      if (webdavEnabled && webdavSettingsComplete) {
        const hasWebDAV = this.storageProviders.has('webdav');
        this.logger.info(`WebDAV启用和配置完整, 在映射中存在: ${hasWebDAV}, 映射大小: ${this.storageProviders.size}`);
        
        if (!hasWebDAV) {
          this.logger.warning("WebDAV配置完整但未在映射中找到, 尝试紧急初始化");
          // 紧急尝试单独初始化WebDAV
          try {
            const webdavSettings = this.settings.providerSettings?.webdav;
            
            // 类型安全检查：确保webdavSettings存在且完整
            if (webdavSettings && this.isWebDAVConfigComplete(webdavSettings)) {
              // 直接创建WebDAV提供商
              const webdavProvider = new WebDAVProvider(webdavSettings, this.app);
              this.storageProviders.set('webdav', webdavProvider);
              
              const retrySuccess = this.storageProviders.has('webdav');
              this.logger.info(`WebDAV紧急初始化结果: ${retrySuccess ? '成功' : '失败'}`);
              
              if (!retrySuccess) {
                this.logger.info('尝试第二种紧急初始化方法');
                await this.initializeProvider('webdav');
              }
            } else {
              this.logger.error('WebDAV设置不完整，无法执行紧急初始化');
              await this.initializeProvider('webdav');
            }
          } catch (err) {
            this.logger.error("WebDAV紧急初始化失败:", err);
            // 再次尝试通过常规方法初始化
            await this.initializeProvider('webdav');
          }
        }
      } else {
        this.logger.info(`WebDAV状态 - 配置完整: ${webdavSettingsComplete}, 已启用: ${webdavEnabled}`);
      }

      // 如果没有提供商被初始化，返回错误
      if (this.storageProviders.size === 0) {
        this.logger.warning("常规初始化未能添加提供商，将在同步时通过恢复机制处理");
        return false;
      }

      this.logger.info(`提供商初始化完成, 映射大小: ${this.storageProviders.size}`);
      this.logger.info(`提供商包括: ${Array.from(this.storageProviders.keys()).join(', ')}`);
      return true;
    } catch (error) {
      this.logger.error("初始化提供商时出错:", error);
      return false;
    } finally {
      // 恢复原始同步状态
      if (forceInit && this.settings.enableSync !== originalSyncEnabled) {
        this.logger.info(`恢复原始同步状态: ${originalSyncEnabled}`);
        this.settings.enableSync = originalSyncEnabled;
        // 保存设置以确保状态被正确保存
        try {
          await this.settingsSaver.saveSettings();
          this.logger.info("原始同步状态已恢复并保存");
        } catch (err) {
          this.logger.error("保存恢复的同步状态时发生错误:", err);
        }
      }
    }
  }

  // 获取提供商映射大小的辅助方法
  private getProviderMappingSize(): number {
    try {
      return this.storageProviders.size;
    } catch (err) {
      this.logger.error("获取提供商映射大小时出错:", err);
      return -1;
    }
  }
} 