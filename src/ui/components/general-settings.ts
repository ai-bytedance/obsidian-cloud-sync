import { Setting } from 'obsidian';
import { PluginSettings, FilterMode } from '@models/plugin-settings';
import CloudSyncPlugin from '@main';
import { SyncFileFilter } from '@src/utils/sync-file-filter';
import { ModuleLogger } from '@services/log/log-service';

// 模块级别的日志记录器
let logger: ModuleLogger | null = null;

/**
 * 配置模块日志记录器
 * @param moduleLogger 日志记录器实例
 */
export function configureGeneralSettingsLogger(moduleLogger: ModuleLogger): void {
  logger = moduleLogger;
}

/**
 * 创建通用设置部分
 * @param containerEl 容器元素
 * @param plugin 插件实例 
 * @param tempSettings 临时设置对象
 * @author Bing
 */
export function createGeneralSection(
  containerEl: HTMLElement, 
  plugin: CloudSyncPlugin, 
  tempSettings: PluginSettings
): void {
  // 初始化日志记录器，如果尚未初始化
  if (!logger && plugin.logService) {
    logger = plugin.logService.getModuleLogger('GeneralSettings');
  }
  
  // 添加一致性检查，确保enableSync和syncInterval的值保持一致
  if (!tempSettings.enableSync && tempSettings.syncInterval > 0) {
    logger?.info('UI初始化：同步未启用但间隔大于0，修正为0');
    tempSettings.syncInterval = 0;
  } else if (tempSettings.enableSync && tempSettings.syncInterval === 0) {
    logger?.info('UI初始化：同步已启用但间隔为0，修正为默认值5');
    tempSettings.syncInterval = 5;
  }
  
  const generalSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
  
  // 使用Setting.setHeading()创建标题
  new Setting(generalSection)
    .setName('通用设置')
    .setHeading();
  
  // 保存自动同步开关的引用
  let enableSyncToggleRef: any;

  // 自动同步设置
  new Setting(generalSection)
    .setName('自动同步')
    .setDesc('在Obsidian启动时自动同步，并按照设定的时间间隔自动同步')
    .addToggle(toggle => {
      // 保存引用以便后续使用
      enableSyncToggleRef = toggle;
      
      return toggle
        .setValue(tempSettings.enableSync)
        .onChange(async (value) => {
          tempSettings.enableSync = value;
          
          // 如果禁用同步，同步间隔设置为0
          if (!value && tempSettings.syncInterval > 0) {
            tempSettings.syncInterval = 0;
            
            // 更新滑动条和输入框显示
            if (textComponentRef) {
              textComponentRef.setValue("0");
            }
            if (valueDisplayEl) {
              valueDisplayEl.setText("0");
            }
          }
          
          // 如果自动同步且同步间隔为0，设置为默认值5
          if (value && tempSettings.syncInterval === 0) {
            tempSettings.syncInterval = 5;
            
            // 更新滑动条和输入框显示
            if (textComponentRef) {
              textComponentRef.setValue("5");
            }
            if (valueDisplayEl) {
              valueDisplayEl.setText("5");
            }
          }
          
          await plugin.saveSettings(tempSettings);
        });
    });
  
  // 同步间隔设置
  const syncIntervalSetting = new Setting(generalSection)
    .setName('同步间隔')
    .setDesc('设置同步间隔时间（分钟，0表示禁用自动同步）');
  
  // 添加数值显示元素
  const valueDisplayEl = syncIntervalSetting.controlEl.createEl("span", {
    cls: "sync-interval-display cs-value-display",
    text: `${tempSettings.syncInterval}`
  });
  
  // 添加滑动条和文本输入框
  // 保存文本组件引用
  let textComponentRef: any;
  // 保存滑动条实例的引用
  let sliderComponentRef: any;

  syncIntervalSetting.addSlider(slider => {
    // 保存滑动条实例
    const sliderComponent = slider
      .setLimits(0, 60, 1)
      .setValue(tempSettings.syncInterval)
      .setDynamicTooltip();
    
    // 保存滑动条引用以供文本输入框使用
    sliderComponentRef = sliderComponent;
    
    // 处理值变化事件
    sliderComponent.onChange(async (value) => {
      // 立即更新显示的数值
      valueDisplayEl.setText(`${value}`);
      
      // 更新输入框的值
      if (textComponentRef) {
        textComponentRef.setValue(`${value}`);
      }
      
      tempSettings.syncInterval = value;
      
      // 根据同步间隔值更新自动同步设置
      if (value === 0 && tempSettings.enableSync) {
        tempSettings.enableSync = false;
        
        // 更新UI上的开关状态
        if (enableSyncToggleRef) {
          enableSyncToggleRef.setValue(false);
        }
      } else if (value > 0 && !tempSettings.enableSync) {
        tempSettings.enableSync = true;
        
        // 更新UI上的开关状态
        if (enableSyncToggleRef) {
          enableSyncToggleRef.setValue(true);
        }
      }
      
      await plugin.saveSettings(tempSettings);
    });
    
    return sliderComponent;
  });
  
  // 添加文本输入框  
  syncIntervalSetting.addText(text => {
    const textComponent = text
      .setValue(tempSettings.syncInterval.toString())
      .setPlaceholder('分钟');
    
    // 保存文本组件引用以供滑动条使用
    textComponentRef = textComponent;
    
    textComponent.onChange(async (value) => {
      const interval = parseInt(value) || 0;
      
      // 限制范围
      let finalValue = interval;
      if (interval < 0) {
        finalValue = 0;
        // 更新输入框显示
        textComponent.setValue("0");
      } else if (interval > 60) {
        finalValue = 60;
        // 更新输入框显示
        textComponent.setValue("60");
      }
      
      tempSettings.syncInterval = finalValue;
      
      // 更新显示的数值
      valueDisplayEl.setText(`${finalValue}`);
      
      // 更新滑动条的位置
      if (sliderComponentRef) {
        sliderComponentRef.setValue(finalValue);
      }
      
      // 根据同步间隔值更新自动同步设置
      if (finalValue === 0 && tempSettings.enableSync) {
        tempSettings.enableSync = false;
        
        // 更新UI上的开关状态
        if (enableSyncToggleRef) {
          enableSyncToggleRef.setValue(false);
        }
      } else if (finalValue > 0 && !tempSettings.enableSync) {
        tempSettings.enableSync = true;
        
        // 更新UI上的开关状态
        if (enableSyncToggleRef) {
          enableSyncToggleRef.setValue(true);
        }
      }
      
      await plugin.saveSettings(tempSettings);
    });
    
    return textComponent;
  });
  
  // 手动同步按钮
  new Setting(generalSection)
    .setName('手动同步')
    .setDesc('手动同步本地文件和云盘文件')
    .addButton(button => button
      .setButtonText('立即同步')
      .setCta()
      .onClick(async () => {
        try {
          // 阻止重复点击
          if (button.buttonEl.disabled) {
            return;
          }
          
          // 按优先级顺序检查前置条件
          
          // 1. 检查是否有启用的存储提供商
          if (!plugin.settings.enabledProviders || plugin.settings.enabledProviders.length === 0) {
            plugin.notificationManager.show('sync-prereq', '请先在设置中启用至少一个云盘服务', 4000);
            return;
          }
          
          // 2. 对于已启用的存储提供商，检查配置是否完整
          if (plugin.settings.enabledProviders.includes('webdav')) {
            const webdavSettings = plugin.settings.providerSettings.webdav;
            if (!webdavSettings || !webdavSettings.username || !webdavSettings.password) {
              plugin.notificationManager.show('sync-prereq', '请先完成 WebDAV 配置，账号和密码不能为空', 4000);
              return;
            }
            
            if (!webdavSettings.serverUrl) {
              plugin.notificationManager.show('sync-prereq', '请先完成 WebDAV 配置，服务器URL不能为空', 4000);
              return;
            }
            
            // 检查URL格式
            if (!webdavSettings.serverUrl.startsWith('http://') && !webdavSettings.serverUrl.startsWith('https://')) {
              plugin.notificationManager.show('sync-prereq', 'WebDAV 服务器URL应以http://或https://开头', 4000);
              return;
            }
            
            // 如果是HTTP连接，显示警告（这个可以保留，因为是警告不是错误）
            if (webdavSettings.serverUrl.startsWith('http://')) {
              plugin.notificationManager.show('sync-warning', '警告：使用非加密连接可能导致数据泄露风险', 7000);
            }
          }
          
          // 所有检查通过，开始同步
          const syncButton = button.buttonEl;
          const originalText = syncButton.textContent;
          
          // 禁用按钮并显示状态
          syncButton.textContent = '同步中...';
          syncButton.disabled = true;
          
          // 使用通知管理器显示同步开始通知
          plugin.notificationManager.show('sync-start', '正在同步...', 30000);
          
          // 执行同步
          try {
            await plugin.manualSync();
            
            // 移除同步完成通知，该通知已在SyncManager中处理
            plugin.notificationManager.clear('sync-start');
          } catch (syncError) {
            logger?.error('同步执行失败:', syncError);
            
            // 清除开始通知
            plugin.notificationManager.clear('sync-start');
            
            // 提供详细的错误信息，使用单一通知
              let errorMessage = '同步失败';
              
              if (syncError.code === 'AUTH_FAILED' || 
                  (syncError.message && (syncError.message.includes('认证错误') || 
                                        syncError.message.includes('认证失败') || 
                                        syncError.message.includes('身份验证')))) {
                errorMessage = '同步失败: 认证错误，请检查账号和密码';
                
                // 如果是坚果云，添加特殊提示
                if (plugin.settings.providerSettings.webdav?.serverUrl?.includes('jianguoyun.com')) {
                  errorMessage += '\n坚果云用户请确认账号密码正确，且未开启二步验证';
                }
              } else if (syncError.code === 'NOT_FOUND' || 
                        (syncError.message && (syncError.message.includes('404') || 
                                              syncError.message.includes('不存在')))) {
                errorMessage = '同步失败: 远程目录不存在，请检查同步路径设置或创建指定的目录';
              } else if (syncError.code === 'FORBIDDEN' || 
                        (syncError.message && (syncError.message.includes('403') || 
                                              syncError.message.includes('权限')))) {
                errorMessage = '同步失败: 无访问权限，请检查账号权限设置';
              } else if (syncError.code === 'QUOTA_EXCEEDED' || 
                        (syncError.message && (syncError.message.includes('配额') || 
                                              syncError.message.includes('空间不足')))) {
                errorMessage = '同步失败: 云盘存储空间不足，请清理云盘或升级存储空间';
              } else if (syncError.message && syncError.message.includes('未启用任何存储提供商')) {
                errorMessage = '请先在设置中启用至少一个云盘服务';
              } else if (syncError.message) {
                errorMessage = `同步失败: ${syncError.message}`;
              }
              
              // 显示单一错误通知，包含完整信息
              plugin.notificationManager.show('sync-error', errorMessage, 8000); // 显示8秒，让用户有足够时间阅读
          }
        } catch (error) {
          logger?.error('同步过程中发生错误:', error);
          
          // 显示通用错误
          plugin.notificationManager.clear('sync-start');
          plugin.notificationManager.show('sync-error', `同步过程中发生错误: ${error.message || '未知错误'}`, 5000);
        } finally {
          // 确保按钮状态被重置
          button.setButtonText('立即同步');
          button.setDisabled(false);
        }
      }));
  
  // 忽略文件夹设置
  const ignoreFolderSection = new Setting(generalSection)
    .setName('忽略文件夹')
    .setDesc('忽略指定文件夹 (用逗号分隔，支持通配符*/?和正则表达式)');

  // 添加文本区域
  ignoreFolderSection.addTextArea(text => {
    const textArea = text.setValue(tempSettings.ignoreFolders.join(', '))
      .setPlaceholder('例如: .git, 配置目录, node_*, 系统文件夹/.*')
      .onChange(async (value) => {
        tempSettings.ignoreFolders = value.split(',').map(item => item.trim()).filter(item => !!item);
        await plugin.saveSettings(tempSettings);
      });
    
    // 设置文本区域样式
    textArea.inputEl.style.width = '300px';
    textArea.inputEl.style.height = '60px';
    
    return textArea;
  });
  
  // 忽略文件设置
  const ignoreFileSection = new Setting(generalSection)
    .setName('忽略文件')
    .setDesc('忽略指定文件 (用逗号分隔，支持通配符*/?和正则表达式)');
  
  // 添加文本区域
  ignoreFileSection.addTextArea(text => {
    const textArea = text.setValue(tempSettings.ignoreFiles.join(', '))
      .setPlaceholder('例如: .DS_Store, desktop.ini, *.tmp, thumb.*\\.db')
      .onChange(async (value) => {
        tempSettings.ignoreFiles = value.split(',').map(item => item.trim()).filter(item => !!item);
        await plugin.saveSettings(tempSettings);
      });
    
    // 设置文本区域样式
    textArea.inputEl.style.width = '300px';
    textArea.inputEl.style.height = '60px';
    
    return textArea;
  });
  
  // 忽略扩展名设置
  const ignoreExtensionSection = new Setting(generalSection)
    .setName('忽略扩展名')
    .setDesc('忽略指定扩展名 (用逗号分隔，不需要加点，支持通配符*/?和正则表达式)');
  
  // 添加文本区域
  ignoreExtensionSection.addTextArea(text => {
    const textArea = text.setValue(tempSettings.ignoreExtensions.join(', '))
      .setPlaceholder('例如: tmp, bak, t?p, sw.$')
      .onChange(async (value) => {
        tempSettings.ignoreExtensions = value.split(',').map(item => item.trim()).filter(item => !!item);
        await plugin.saveSettings(tempSettings);
      });
    
    // 设置文本区域样式
    textArea.inputEl.style.width = '300px';
    textArea.inputEl.style.height = '60px';
    
    return textArea;
  });
} 