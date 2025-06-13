import { Setting } from 'obsidian';
import { PluginSettings } from '@models/plugin-settings';
import CloudSyncPlugin from '@main';
import { ModuleLogger } from '@services/log/log-service';

// 模块级别的日志记录器
let logger: ModuleLogger | null = null;

/**
 * 配置模块日志记录器
 * @param moduleLogger 日志记录器实例
 */
export function configureProviderSettingsLogger(moduleLogger: ModuleLogger): void {
  logger = moduleLogger;
}

/**
 * 创建云盘提供商选择部分
 * @param containerEl 容器元素
 * @param plugin 插件实例 
 * @param tempSettings 临时设置对象
 * @param displayFunc 刷新界面函数
 * @author Bing
 */
export function createCloudProvidersSection(
  containerEl: HTMLElement, 
  plugin: CloudSyncPlugin, 
  tempSettings: PluginSettings,
  displayFunc: () => Promise<void>
): void {
  // 初始化日志记录器，如果尚未初始化
  if (!logger && plugin.logService) {
    logger = plugin.logService.getModuleLogger('ProviderSettings');
  }
  
  const providersSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
  
  // 使用Setting.setHeading()创建标题
  new Setting(providersSection)
    .setName('云盘')
    .setHeading();
  
  // WebDAV选项
  new Setting(providersSection)
    .setName('WebDAV')
    .setDesc('使用WebDAV同步数据')
    .addToggle(toggle => toggle
      .setValue(tempSettings.enabledProviders.includes('webdav'))
      .onChange(async (value) => {
        if (value) {
          logger?.info('WebDAV开关打开，开始配置...');
          
          // 添加WebDAV作为启用的提供商
          if (!tempSettings.enabledProviders.includes('webdav')) {
            tempSettings.enabledProviders.push('webdav');
            logger?.info('将WebDAV添加到已启用提供商列表');
          }
          
          // 初始化WebDAV设置
          if (!tempSettings.providerSettings.webdav) {
            tempSettings.providerSettings.webdav = {
              enabled: true,
              username: '',
              password: '',
              serverUrl: '',
              syncPath: ''
            };
            logger?.info('初始化WebDAV设置对象');
          } else {
            tempSettings.providerSettings.webdav.enabled = true;
            logger?.info('将WebDAV标记为已启用');
          }
          
          // 不再强制启用全局同步开关，尊重用户设置
          logger?.info('WebDAV已启用，但不自动开启全局同步');
        } else {
          logger?.info('WebDAV开关关闭，开始清理...');
          
          // 从启用的提供商中移除WebDAV
          tempSettings.enabledProviders = tempSettings.enabledProviders.filter(p => p !== 'webdav');
          logger?.info('从已启用提供商列表中移除WebDAV');
          
          // 禁用WebDAV设置
          if (tempSettings.providerSettings.webdav) {
            tempSettings.providerSettings.webdav.enabled = false;
            logger?.info('将WebDAV标记为未启用');
          }
        }
        
        // 保存设置
        logger?.info('保存WebDAV设置更改并初始化提供商...');
        await plugin.saveSettings(tempSettings);
        
        // 刷新界面
        await displayFunc();
      }));
  
  // Google Drive选项
  const googleDriveSetting = new Setting(providersSection)
    .setName('Google Drive')
    .setDesc('【开发中】使用Google Drive同步数据')
    .addToggle(toggle => toggle
      .setValue(false)
      .setDisabled(true));
  
  // 添加点击事件处理，显示友好提示
  googleDriveSetting.settingEl.addEventListener('click', () => {
    plugin.notificationManager.show('gdrive-dev', 'Google Drive同步功能正在开发中，敬请期待！', 3000);
  });
  
  // 添加开发中的视觉提示
  googleDriveSetting.settingEl.addClass('cloud-sync-developing');
  
  // OneDrive选项
  const oneDriveSetting = new Setting(providersSection)
    .setName('OneDrive')
    .setDesc('【开发中】使用OneDrive同步数据')
    .addToggle(toggle => toggle
      .setValue(false)
      .setDisabled(true));
  
  // 添加点击事件处理，显示友好提示
  oneDriveSetting.settingEl.addEventListener('click', () => {
    plugin.notificationManager.show('onedrive-dev', 'OneDrive同步功能正在开发中，敬请期待！', 3000);
  });
  
  // 添加开发中的视觉提示
  oneDriveSetting.settingEl.addClass('cloud-sync-developing');
  
  // iCloud选项
  const iCloudSetting = new Setting(providersSection)
    .setName('iCloud')
    .setDesc('【开发中】使用iCloud同步数据')
    .addToggle(toggle => toggle
      .setValue(false)
      .setDisabled(true));
  
  // 添加点击事件处理，显示友好提示
  iCloudSetting.settingEl.addEventListener('click', () => {
    plugin.notificationManager.show('icloud-dev', 'iCloud同步功能正在开发中，敬请期待！', 3000);
  });
  
  // 添加开发中的视觉提示
  iCloudSetting.settingEl.addClass('cloud-sync-developing');

  // GitHub选项
  const gitHubSetting = new Setting(providersSection)
    .setName('GitHub')
    .setDesc('【开发中】使用GitHub同步数据')
    .addToggle(toggle => toggle
      .setValue(false)
      .setDisabled(true));
  
  // 添加点击事件处理，显示友好提示
  gitHubSetting.settingEl.addEventListener('click', () => {
    plugin.notificationManager.show('github-dev', 'GitHub同步功能正在开发中，敬请期待！', 3000);
  });
  
  // 添加开发中的视觉提示
  gitHubSetting.settingEl.addClass('cloud-sync-developing');
} 