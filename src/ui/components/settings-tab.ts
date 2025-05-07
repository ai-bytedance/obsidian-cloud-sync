import { App, Notice, PluginSettingTab, Setting, ButtonComponent } from 'obsidian';
import CloudSyncPlugin from '@main';
import { PluginSettings, WebDAVSettings, RequestDelayLevel } from '@models/plugin-settings';
import { WebDAVProvider } from '@providers/webdav/webdav-provider';
import { ConnectionStatus } from '@providers/common/storage-provider';
import { ConflictPolicy, SyncDirection, SyncMode } from '@models/plugin-settings';
import { ModuleLogger } from '@services/log/log-service';

// 引入拆分后的组件
import { createGeneralSection } from './general-settings';
import { createCloudProvidersSection } from './provider-settings';
import { createWebDAVSection } from './webdav-settings-ui';
import { createAdvancedSection } from './advanced-settings';

// 模块级别的日志记录器
let logger: ModuleLogger | null = null;

/**
 * 配置模块日志记录器
 * @param moduleLogger 日志记录器实例
 */
export function configureSettingsTabLogger(moduleLogger: ModuleLogger): void {
  logger = moduleLogger;
}

// 添加CSS样式
const JIANGUOYUN_SETTINGS_STYLES = `
.cloud-sync-provider-specific-settings {
  margin: 10px 0;
}

.cloud-sync-jianguoyun-settings {
  background-color: rgba(14, 101, 235, 0.05);
  border: 1px solid rgba(14, 101, 235, 0.2);
  border-radius: 8px;
  padding: 12px 15px;
  margin-bottom: 15px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.cloud-sync-jianguoyun-header {
  margin-bottom: 10px;
}

.cloud-sync-subtitle {
  margin: 0;
  font-size: 16px !important;
  font-weight: 600 !important;
  color: var(--text-normal) !important;
  line-height: 24px !important;
  font-family: var(--font-interface) !important;
}

.cloud-sync-info-panel {
  background-color: rgba(14, 101, 235, 0.1);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 15px;
}

.cloud-sync-info-text {
  margin: 0;
  font-size: 13px !important;
  line-height: 1.4 !important;
  color: var(--text-normal) !important;
  font-family: var(--font-interface) !important;
}

.cloud-sync-jianguoyun-setting {
  border-top: 1px solid rgba(14, 101, 235, 0.1);
  padding-top: 10px;
}

.cloud-sync-jianguoyun-setting:last-child {
  margin-bottom: 0;
}

.cloud-sync-other-provider {
  display: flex;
  align-items: center;
  background-color: rgba(255, 204, 0, 0.05);
  border: 1px dashed rgba(255, 204, 0, 0.3);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 8px 0 15px 0;
  font-size: 12px;
}

.cloud-sync-tip-icon {
  margin-right: 8px;
  font-size: 14px;
  flex-shrink: 0;
  color: #f5a623;
}

.cloud-sync-tip-text {
  margin: 0;
  font-size: 13px !important;
  line-height: 1.4 !important;
  color: var(--text-normal) !important;
  font-family: var(--font-interface) !important;
}

.cloud-sync-required::after {
  content: " *";
  color: var(--text-error);
}
`;

/**
 * Cloud Sync插件设置界面
 * @author Bing
 */
export class CloudSyncSettingTab extends PluginSettingTab {
  plugin: CloudSyncPlugin;
  tempSettings: PluginSettings;
  testingConnection: boolean = false;
  styleElement: HTMLStyleElement | null = null;

  constructor(app: App, plugin: CloudSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    
    // 初始化日志记录器，如果尚未初始化
    if (!logger && plugin.logService) {
      logger = plugin.logService.getModuleLogger('SettingsTab');
    }
    
    // 添加CSS样式
    this.styleElement = document.head.createEl('style');
    this.styleElement.textContent = JIANGUOYUN_SETTINGS_STYLES;
  }
  
  // 在卸载时移除样式
  hide() {
    if (this.styleElement && this.styleElement.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement);
      this.styleElement = null;
    }
    super.hide();
  }

  async display(): Promise<void> {
    const { containerEl } = this;

    // 克隆设置对象以便取消时恢复
    this.tempSettings = JSON.parse(JSON.stringify(this.plugin.settings));
    
    // 调试日志：输出初始化的tempSettings值
    logger?.debug('初始化的tempSettings:', {
      syncMode: this.tempSettings.syncMode,
      syncDirection: this.tempSettings.syncDirection
    });
    
    // 确保同步模式和同步方向有有效值
    if (!this.tempSettings.syncMode) {
      logger?.info('同步模式无效，设置为默认值: incremental');
      this.tempSettings.syncMode = 'incremental';
    }
    
    if (!this.tempSettings.syncDirection) {
      logger?.info('同步方向无效，设置为默认值: bidirectional');
      this.tempSettings.syncDirection = 'bidirectional';
    }
    
    // 检查设置的一致性
    this.checkSettingsConsistency();

    // 清除现有内容
    containerEl.empty();

    // 创建通用设置部分 - 调用拆分后的组件
    createGeneralSection(containerEl, this.plugin, this.tempSettings);

    // 创建云盘选择部分 - 调用拆分后的组件
    createCloudProvidersSection(containerEl, this.plugin, this.tempSettings, this.display.bind(this));

    // 创建WebDAV设置部分 (如果启用) - 调用拆分后的组件
    if (this.tempSettings.enabledProviders.includes('webdav')) {
      createWebDAVSection(
        containerEl, 
        this.plugin, 
        this.tempSettings, 
        this.testingConnection, 
        (value: boolean) => this.testingConnection = value,
        this.display.bind(this)
      );
    }
    
    // 创建iCloud设置部分 (如果启用)
    if (this.tempSettings.enabledProviders.includes('icloud')) {
      this.createICloudSection(containerEl);
    }
    
    // 创建GitHub设置部分 (如果启用)
    if (this.tempSettings.enabledProviders.includes('github')) {
      this.createGitHubSection(containerEl);
    }

    // 创建高级设置部分 - 调用拆分后的组件
    createAdvancedSection(containerEl, this.plugin, this.tempSettings, this.display.bind(this));
  }
  
  /**
   * 检查设置的一致性，确保UI状态和内部配置一致
   * @author Bing
   */
  private checkSettingsConsistency(): boolean {
    let needSave = false;
    
    // 检查WebDAV设置的一致性
    if (this.tempSettings.enabledProviders.includes('webdav')) {
      // 如果WebDAV在启用列表中，但WebDAV设置未启用
      if (this.tempSettings.providerSettings.webdav && !this.tempSettings.providerSettings.webdav.enabled) {
        logger?.info('修复：WebDAV在enabledProviders列表中但设置中未启用');
        this.tempSettings.providerSettings.webdav.enabled = true;
        needSave = true;
      }
    } else {
      // 如果WebDAV不在启用列表中，但WebDAV设置启用了
      if (this.tempSettings.providerSettings.webdav?.enabled) {
        logger?.info('修复：WebDAV设置启用但不在enabledProviders列表中');
        this.tempSettings.enabledProviders.push('webdav');
        needSave = true;
      }
    }
    
    // 处理同步间隔与自动同步关联逻辑
    if (this.tempSettings.syncInterval === 0 && this.tempSettings.enableSync) {
      logger?.info('检测到同步间隔为0但同步已启用，同步间隔与状态不一致');
      this.tempSettings.enableSync = false;
      needSave = true;
    }
    
    if (needSave) {
      // 异步保存设置
      this.plugin.saveSettings(this.tempSettings).catch(error => {
        logger?.error('保存修复后的设置失败:', error);
      });
    }
    
    return needSave;
  }

  // iCloud设置部分
  createICloudSection(containerEl: HTMLElement): void {
    const icloudSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
    
    icloudSection.createEl('h3', { text: 'iCloud设置' });
    
    // App ID设置
    new Setting(icloudSection)
      .setName('App ID')
      .setDesc('iCloud账号')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.icloud?.appId || '')
        .setPlaceholder('请输入iCloud账号')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.icloud) {
            this.tempSettings.providerSettings.icloud = {
              enabled: true,
              appId: '',
              password: '',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.icloud.appId = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 密码设置
    new Setting(icloudSection)
      .setName('密码')
      .setDesc('iCloud密码')
      .addText(text => {
        let isPasswordVisible = false;
        
        text.setValue(this.tempSettings.providerSettings.icloud?.password || '')
          .setPlaceholder('请输入iCloud密码')
          .onChange(async (value) => {
            if (!this.tempSettings.providerSettings.icloud) {
              this.tempSettings.providerSettings.icloud = {
                enabled: true,
                appId: '',
                password: '',
                syncPath: ''
              };
            }
            this.tempSettings.providerSettings.icloud.password = value;
            await this.plugin.saveSettings(this.tempSettings);
          });
          
        // 添加密码可见性切换功能
        const togglePasswordVisibility = (show: boolean) => {
          isPasswordVisible = show;
          text.inputEl.type = show ? 'text' : 'password';
        };
        
        // 默认为密码模式（隐藏）
        togglePasswordVisibility(false);
        
        // 获取输入框元素
        const inputEl = text.inputEl;
        
        // 调整输入框样式，为图标留出空间
        inputEl.style.paddingRight = '30px';
        
        // 创建一个容器来包含输入框和图标
        const containerEl = inputEl.parentElement;
        if (containerEl) {
          containerEl.style.position = 'relative';
          
          // 添加显示/隐藏按钮到输入框容器中
          const eyeIconContainer = containerEl.createSpan({ cls: 'eye-icon-container' });
          eyeIconContainer.style.position = 'absolute';
          eyeIconContainer.style.right = '8px';
          eyeIconContainer.style.top = '50%';
          eyeIconContainer.style.transform = 'translateY(-50%)';
          eyeIconContainer.style.cursor = 'pointer';
          eyeIconContainer.style.zIndex = '1';
          eyeIconContainer.style.fontSize = '16px';
          eyeIconContainer.style.opacity = '0.7';
          eyeIconContainer.style.color = 'var(--text-normal)';
          eyeIconContainer.style.pointerEvents = 'auto';
          eyeIconContainer.innerHTML = isPasswordVisible ? '👁️' : '👁️‍🗨️';
          
          eyeIconContainer.addEventListener('click', () => {
            togglePasswordVisibility(!isPasswordVisible);
            eyeIconContainer.innerHTML = isPasswordVisible ? '👁️' : '👁️‍🗨️';
          });
        }
        
        return text;
      });
    
    // 同步路径设置
    new Setting(icloudSection)
      .setName('同步路径')
      .setDesc('设置iCloud同步数据的存储路径（留空表示同步到根目录）')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.icloud?.syncPath || '')
        .setPlaceholder('例如: obsidian-notes')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.icloud) {
            this.tempSettings.providerSettings.icloud = {
              enabled: true,
              appId: '',
              password: '',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.icloud.syncPath = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 授权按钮
    new Setting(icloudSection)
      .setName('授权')
      .setDesc('授权访问iCloud')
      .addButton(button => button
        .setButtonText('授权')
        .setCta()
        .onClick(async () => {
          // 显示未实现提示
          this.plugin.notificationManager.show('icloud-auth', '授权iCloud功能尚未实现', 4000);
        }))
      .setDisabled(true); // 暂时禁用，因为尚未实现
  }

  // GitHub设置部分
  createGitHubSection(containerEl: HTMLElement): void {
    const githubSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
    
    githubSection.createEl('h3', { text: 'GitHub设置' });
    
    // 用户名设置
    new Setting(githubSection)
      .setName('用户名')
      .setDesc('GitHub仓库所有者用户名')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.github?.username || '')
        .setPlaceholder('请输入GitHub用户名')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.github) {
            this.tempSettings.providerSettings.github = {
              enabled: true,
              username: '',
              token: '',
              repository: '',
              branch: 'main',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.github.username = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 访问令牌设置
    new Setting(githubSection)
      .setName('个人访问令牌')
      .setDesc('GitHub个人访问令牌（Personal Access Token）')
      .addText(text => {
        let isTokenVisible = false;
        
        text.setValue(this.tempSettings.providerSettings.github?.token || '')
          .setPlaceholder('请输入GitHub个人访问令牌')
          .onChange(async (value) => {
            if (!this.tempSettings.providerSettings.github) {
              this.tempSettings.providerSettings.github = {
                enabled: true,
                username: '',
                token: '',
                repository: '',
                branch: 'main',
                syncPath: ''
              };
            }
            this.tempSettings.providerSettings.github.token = value;
            await this.plugin.saveSettings(this.tempSettings);
          });
          
        // 添加令牌可见性切换功能
        const toggleTokenVisibility = (show: boolean) => {
          isTokenVisible = show;
          text.inputEl.type = show ? 'text' : 'password';
        };
        
        // 默认为密码模式（隐藏）
        toggleTokenVisibility(false);
        
        // 获取输入框元素
        const inputEl = text.inputEl;
        
        // 调整输入框样式，为图标留出空间
        inputEl.style.paddingRight = '30px';
        
        // 创建一个容器来包含输入框和图标
        const containerEl = inputEl.parentElement;
        if (containerEl) {
          containerEl.style.position = 'relative';
          
          // 添加显示/隐藏按钮到输入框容器中
          const eyeIconContainer = containerEl.createSpan({ cls: 'eye-icon-container' });
          eyeIconContainer.style.position = 'absolute';
          eyeIconContainer.style.right = '8px';
          eyeIconContainer.style.top = '50%';
          eyeIconContainer.style.transform = 'translateY(-50%)';
          eyeIconContainer.style.cursor = 'pointer';
          eyeIconContainer.style.zIndex = '1';
          eyeIconContainer.style.fontSize = '16px';
          eyeIconContainer.style.opacity = '0.7';
          eyeIconContainer.style.color = 'var(--text-normal)';
          eyeIconContainer.style.pointerEvents = 'auto';
          eyeIconContainer.innerHTML = isTokenVisible ? '👁️' : '👁️‍🗨️';
          
          eyeIconContainer.addEventListener('click', () => {
            toggleTokenVisibility(!isTokenVisible);
            eyeIconContainer.innerHTML = isTokenVisible ? '👁️' : '👁️‍🗨️';
          });
        }
        
        return text;
      });
    
    // 仓库名称设置
    new Setting(githubSection)
      .setName('仓库名称')
      .setDesc('GitHub仓库名称')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.github?.repository || '')
        .setPlaceholder('例如: obsidian-notes')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.github) {
            this.tempSettings.providerSettings.github = {
              enabled: true,
              username: '',
              token: '',
              repository: '',
              branch: 'main',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.github.repository = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 分支设置
    new Setting(githubSection)
      .setName('分支')
      .setDesc('GitHub仓库分支')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.github?.branch || 'main')
        .setPlaceholder('例如: main')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.github) {
            this.tempSettings.providerSettings.github = {
              enabled: true,
              username: '',
              token: '',
              repository: '',
              branch: 'main',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.github.branch = value || 'main';
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 同步路径设置
    new Setting(githubSection)
      .setName('同步路径')
      .setDesc('设置GitHub同步数据的存储路径（留空表示同步到根目录）')
      .addText(text => text
        .setValue(this.tempSettings.providerSettings.github?.syncPath || '')
        .setPlaceholder('例如: notes')
        .onChange(async (value) => {
          if (!this.tempSettings.providerSettings.github) {
            this.tempSettings.providerSettings.github = {
              enabled: true,
              username: '',
              token: '',
              repository: '',
              branch: 'main',
              syncPath: ''
            };
          }
          this.tempSettings.providerSettings.github.syncPath = value;
          await this.plugin.saveSettings(this.tempSettings);
        }));
    
    // 测试连接按钮
    new Setting(githubSection)
      .setName('测试连接')
      .setDesc('测试GitHub连接是否正常')
      .addButton(button => button
        .setButtonText('测试连接')
        .setCta()
        .onClick(async () => {
          // 显示未实现提示
          this.plugin.notificationManager.show('github-test', 'GitHub连接测试功能尚未实现', 4000);
        }))
      .setDisabled(true); // 暂时禁用，因为尚未实现
  }
} 