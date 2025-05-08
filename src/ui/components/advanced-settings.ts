import { Setting, ButtonComponent } from 'obsidian';
import { PluginSettings, SyncDirection } from '@models/plugin-settings';
import CloudSyncPlugin from '@main';
import { ModuleLogger } from '@services/log/log-service';

// 模块级别的日志记录器
let logger: ModuleLogger | null = null;

/**
 * 配置模块日志记录器
 * @param moduleLogger 日志记录器实例
 */
export function configureAdvancedSettingsLogger(moduleLogger: ModuleLogger): void {
  logger = moduleLogger;
}

/**
 * 创建高级设置部分
 * @param containerEl 容器元素
 * @param plugin 插件实例 
 * @param tempSettings 临时设置对象
 * @param displayFunc 刷新界面函数
 * @author Bing
 */
export function createAdvancedSection(
  containerEl: HTMLElement, 
  plugin: CloudSyncPlugin, 
  tempSettings: PluginSettings,
  displayFunc: () => Promise<void>
): void {
  // 初始化日志记录器，如果尚未初始化
  if (!logger && plugin.logService) {
    logger = plugin.logService.getModuleLogger('AdvancedSettings');
  }
  
  const advancedSection = containerEl.createEl('div', { cls: 'cloud-sync-settings' });
  
  // 使用Setting.setHeading()创建标题
  new Setting(advancedSection)
    .setName('高级设置')
    .setHeading();
  
  // 安全设置
  const securitySection = advancedSection.createEl('div', { cls: 'cloud-sync-settings cloud-sync-subsection' });
  
  // 使用Setting.setHeading()创建子标题
  new Setting(securitySection)
    .setName('安全设置')
    .setHeading();
  
  // 启用加密
  const encryptionSetting = new Setting(securitySection)
    .setName('启用加密')
    .setDesc('加密同步的内容')
    .addToggle(toggle => toggle
      .setValue(tempSettings.encryption.enabled)
      .onChange(async (value) => {
        const wasEnabled = tempSettings.encryption.enabled;
        tempSettings.encryption.enabled = value;
        await plugin.saveSettings(tempSettings);
        
        // 如果用户从启用状态切换到禁用状态，显示通知
        if (wasEnabled && !value) {
          plugin.notificationManager.show('encryption-warning', '关闭加密后，远端加密的内容会被解密展示！', 5000);
        }
        
        await displayFunc(); // 刷新界面以显示/隐藏加密设置
      }));
  
  // 当加密功能关闭时，显示警告信息
  if (!tempSettings.encryption.enabled) {
    const warningEl = encryptionSetting.descEl.createDiv({
      text: '关闭加密后，远端加密的内容会被解密展示！',
      cls: 'setting-item-description cloud-sync-warning cs-warning-text'
    });
    // 设置警告文字为粗体
    warningEl.style.fontWeight = 'bold';
  }
  
  // 加密设置
  if (tempSettings.encryption.enabled) {
    const encryptionKeySetting = new Setting(securitySection)
      .setName('加密密钥')
      .setDesc('用于加密的密钥，请妥善保管')
      .addText(text => {
        let isPasswordVisible = false;
        
        // 设置输入框类型为密码
        text.inputEl.type = 'password';
        
        // 获取输入框元素
        const inputEl = text.inputEl;
        
        // 调整输入框样式，为图标留出空间
        inputEl.addClass('cs-input-with-icon');
        
        text.setPlaceholder('16位加密密钥')
          .setValue(tempSettings.encryption.key)
          .onChange(async (value) => {
            // 验证密钥长度
            if (value && value.length !== 16) {
              plugin.notificationManager.show('encryption-error', '密钥长度必须为16位', 4000);
              return;
            }
            
            tempSettings.encryption.key = value;
            await plugin.saveSettings(tempSettings);
          });
        
        // 创建一个容器来包含输入框和图标
        const containerEl = inputEl.parentElement;
        if (containerEl) {
          containerEl.style.position = 'relative';
          
          // 添加显示/隐藏按钮到输入框容器中
          const eyeIconContainer = containerEl.createSpan({ cls: 'eye-icon-container cs-eye-icon' });
          
          // 使用setText替代innerHTML
          eyeIconContainer.setText(isPasswordVisible ? '👁️' : '👁️‍🗨️');
          
          // 添加密码可见性切换功能
          const togglePasswordVisibility = (show: boolean) => {
            isPasswordVisible = show;
            inputEl.type = show ? 'text' : 'password';
            eyeIconContainer.setText(show ? '👁️' : '👁️‍🗨️');
          };
          
          eyeIconContainer.addEventListener('click', () => {
            togglePasswordVisibility(!isPasswordVisible);
          });
        }
        
        return text;
      });
    
    // 为加密密钥单独添加按钮，而不是使用addExtraButton
    const encryptionKeyButtonContainer = encryptionKeySetting.settingEl.createDiv('setting-item-control');
    encryptionKeyButtonContainer.style.flexShrink = '0';
    encryptionKeyButtonContainer.addClass('cs-button-container');
    // 按钮之间的间距保留
    encryptionKeyButtonContainer.style.gap = '6px';
    
    // 添加生成随机密钥按钮
    const genKeyButton = new ButtonComponent(encryptionKeyButtonContainer);
    genKeyButton
      .setIcon('reset')
      .setTooltip('生成随机密钥')
      .onClick(async () => {
        // 通常我们会使用AESCryptoService.generateKey()，但为简化，这里直接生成
        const randGen = () => Math.floor(Math.random() * 16).toString(16);
        const randomKey = Array(16).fill(0).map(() => randGen()).join('');
        
        tempSettings.encryption.key = randomKey;
        await plugin.saveSettings(tempSettings);
        
        // 不再刷新整个设置界面，而是直接更新输入框的值
        const inputFields = securitySection.querySelectorAll('input');
        inputFields.forEach(input => {
          if (input.placeholder === '16位加密密钥') {
            input.value = randomKey;
            // 不改变当前密码可见性状态
          }
        });
        
        plugin.notificationManager.show('encryption-complete', '已生成新的加密密钥', 4000);
      });
    
    // 美化生成按钮
    const genKeyEl = genKeyButton.buttonEl;
    genKeyEl.addClass('cs-button');
    genKeyEl.addClass('cs-primary-button');
    
    // 添加复制密钥按钮
    const copyKeyButton = new ButtonComponent(encryptionKeyButtonContainer);
    copyKeyButton
      .setIcon('copy')
      .setTooltip('复制密钥')
      .onClick(() => {
        navigator.clipboard.writeText(tempSettings.encryption.key);
        plugin.notificationManager.show('encryption-copy', '加密密钥已复制到剪贴板', 4000);
      });
    
    // 美化复制按钮
    const copyKeyEl = copyKeyButton.buttonEl;
    copyKeyEl.addClass('cs-button');
    copyKeyEl.addClass('cs-secondary-button');
    
    encryptionKeySetting.descEl.createDiv({
      text: '必须输入16位密钥。请务必备份密钥，密钥丢失将导致无法恢复加密的数据！',
      cls: 'setting-item-description cloud-sync-warning'
    });
  }
  
  // 同步设置
  const syncSection = advancedSection.createEl('div', { cls: 'cloud-sync-settings cloud-sync-subsection' });
  
  // 使用Setting.setHeading()创建子标题
  new Setting(syncSection)
    .setName('同步设置')
    .setHeading();
  
  // 冲突策略
  new Setting(syncSection)
    .setName('冲突策略')
    .setDesc('设置冲突处理策略')
    .addDropdown(dropdown => dropdown
      .addOption('overwrite', '覆盖')
      .addOption('keepLocal', '保留本地')
      .addOption('keepRemote', '保留云盘')
      .addOption('merge', '合并')
      .setValue(tempSettings.conflictPolicy)
      .onChange(async (value: any) => {
        tempSettings.conflictPolicy = value;
        await plugin.saveSettings(tempSettings);
      }));
  
  // 同步模式
  new Setting(syncSection)
    .setName('同步模式')
    .setDesc('设置同步模式')
    .addDropdown(dropdown => {
      // 添加选项
      dropdown.addOption('incremental', '增量同步')
        .addOption('full', '全量同步');
      
      // 手动检查当前选择的值并设置
      const currentSyncMode = tempSettings.syncMode;
      logger?.debug('设置同步模式下拉框，当前值:', { value: currentSyncMode });
      
      if (currentSyncMode && (currentSyncMode === 'incremental' || currentSyncMode === 'full')) {
        dropdown.setValue(currentSyncMode);
      } else {
        logger?.info('同步模式值无效，设置为默认值: incremental');
        dropdown.setValue('incremental');
        tempSettings.syncMode = 'incremental';
      }
      
      // 处理值变化
      dropdown.onChange(async (value: any) => {
        logger?.debug('同步模式变更为:', { value });
        tempSettings.syncMode = value;
        await plugin.saveSettings(tempSettings);
      });
      
      return dropdown;
    });
  
  // 同步方向
  new Setting(syncSection)
    .setName('同步方向')
    .setDesc('设置同步方向')
    .addDropdown(dropdown => {
      // 添加选项
      dropdown.addOption('bidirectional', '双向同步')
        .addOption('uploadOnly', '仅上传')
        .addOption('downloadOnly', '仅下载');
      
      // 手动检查当前选择的值并设置
      const currentSyncDirection = tempSettings.syncDirection;
      logger?.debug('设置同步方向下拉框，当前值:', { value: currentSyncDirection });
      
      if (currentSyncDirection && 
         (currentSyncDirection === 'bidirectional' || 
          currentSyncDirection === 'uploadOnly' || 
          currentSyncDirection === 'downloadOnly')) {
        dropdown.setValue(currentSyncDirection);
      } else {
        logger?.info('同步方向值无效，设置为默认值: bidirectional');
        dropdown.setValue('bidirectional');
        tempSettings.syncDirection = 'bidirectional';
      }
      
      // 处理值变化
      dropdown.onChange(async (value) => {
        logger?.debug('同步方向变更为:', { value });
        tempSettings.syncDirection = value as SyncDirection;
        await plugin.saveSettings(tempSettings);
      });
      
      return dropdown;
    });
  
  // 远程文件删除
  const remoteFilesDeleteSetting = new Setting(syncSection)
    .setName('删除远程多余文件夹及文件')
    .setDesc('警告: 启用此选项将删除远程存在但本地不存在的文件和文件夹！')
    .addToggle(toggle => toggle
      .setValue(tempSettings.deleteRemoteExtraFiles)
      .onChange(async (value) => {
        tempSettings.deleteRemoteExtraFiles = value;
        await plugin.saveSettings(tempSettings);
        
        // 当用户开启此功能时显示警告提示
        if (value) {
          plugin.notificationManager.show(
            'delete-remote-warning', 
            '请谨慎启用此选项，开启后会永久删除您的文件和文件夹!', 
            3000
          );
        }
      }));
  
  // 添加额外的警告样式
  remoteFilesDeleteSetting.descEl.addClass('cs-small-warning-text');
  
  // 本地文件删除
  const localFilesDeleteSetting = new Setting(syncSection)
    .setName('删除本地多余文件夹及文件')
    .setDesc('警告: 启用此选项将删除本地存在但远程不存在的文件和文件夹！')
    .addToggle(toggle => toggle
      .setValue(tempSettings.deleteLocalExtraFiles)
      .onChange(async (value) => {
        tempSettings.deleteLocalExtraFiles = value;
        await plugin.saveSettings(tempSettings);
        
        // 当用户开启此功能时显示警告提示
        if (value) {
          plugin.notificationManager.show(
            'delete-local-warning', 
            '请谨慎启用此选项，开启后会永久删除您的文件和文件夹！', 
            3000
          );
        }
      }));
  
  // 添加额外的警告样式
  localFilesDeleteSetting.descEl.addClass('cs-small-warning-text');
  
  // 基础设置
  const baseSection = advancedSection.createEl('div', { cls: 'cloud-sync-settings cloud-sync-subsection' });
  
  // 使用Setting.setHeading()创建子标题
  new Setting(baseSection)
    .setName('基础设置')
    .setHeading();
  
  // 调试模式
  new Setting(baseSection)
    .setName('调试模式')
    .setDesc('启用详细日志记录')
    .addToggle(toggle => toggle
      .setValue(tempSettings.debugMode)
      .onChange(async (value) => {
        tempSettings.debugMode = value;
        await plugin.saveSettings(tempSettings);
        
        // 根据调试模式状态启用或禁用控制台拦截
        if (value) {
          plugin.logService?.interceptConsole();
          logger?.info('已启用控制台拦截（调试模式）');
        } else {
          plugin.logService?.restoreConsole();
          logger?.info('已禁用控制台拦截（调试模式关闭）');
        }
        
        await displayFunc(); // 刷新界面以显示/隐藏日志级别设置
      }));
  
  // 日志级别
  if (tempSettings.debugMode) {
    new Setting(baseSection)
      .setName('日志级别')
      .setDesc('设置日志记录的详细程度')
      .addDropdown(dropdown => dropdown
        .addOption('debug', '调试')
        .addOption('info', '信息')
        .addOption('warning', '警告')
        .addOption('error', '错误')
        .setValue(tempSettings.logLevel)
        .onChange(async (value: any) => {
          tempSettings.logLevel = value;
          await plugin.saveSettings(tempSettings);
        }));
  }
  
  // 导出日志
  new Setting(baseSection)
    .setName('导出日志')
    .setDesc('导出插件日志以便排查问题')
    .addButton(button => button
      .setButtonText('导出')
      .onClick(async () => {
        // 使用日志服务获取日志
        let logContent = '';
        
        if (plugin.logService) {
          // 确保始终使用用户界面中选择的日志级别
          // 即使调试模式关闭，也尊重用户之前选择的级别
          const logLevel = tempSettings.logLevel;
          
          // 在导出前记录各种级别的测试日志，确保有内容可见
          logger?.debug('【测试】这是一条调试级别的日志消息');
          logger?.info('【测试】这是一条信息级别的日志消息');
          logger?.warning('【测试】这是一条警告级别的日志消息');
          logger?.error('【测试】这是一条错误级别的日志消息');
          
          // 记录一条包含控制台日志测试的消息
          logger?.debug('【测试】如果启用了控制台拦截，控制台输出也会被记录');
          // 测试一次控制台输出
          console.log('【测试】这是一条控制台日志消息，用于测试控制台拦截');
          
          // 记录导出操作和使用的日志级别
          logger?.info(`开始导出日志，使用级别: ${logLevel}`);
          
          // 明确传递日志级别参数
          logContent = plugin.logService.export(logLevel);
        } else {
          // 兼容性处理，如果未找到日志服务
          logContent = "=== Cloud Sync 日志 ===\n时间: " + new Date().toISOString() + "\n日志服务未初始化，无法获取日志数据";
        }
        
        // 创建一个下载链接
        const blob = new Blob([logContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cloud-sync-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        
        // 清理
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
        
        // 提示用户日志已导出
        const logLevelText = tempSettings.logLevel === 'debug' ? '调试' : 
                            tempSettings.logLevel === 'info' ? '信息' : 
                            tempSettings.logLevel === 'warning' ? '警告' : '错误';
                            
        plugin.notificationManager.show('log-exported', `日志已导出(${logLevelText}级别)`, 3000);
        if (plugin.logService) {
          logger?.info(`用户导出了${logLevelText}级别的日志文件`);
        }
      }));
  
  // 网络检测
  new Setting(baseSection)
    .setName('网络检测')
    .setDesc('仅在WiFi网络同步')
    .addToggle(toggle => toggle
      .setValue(tempSettings.networkDetection)
      .onChange(async (value) => {
        tempSettings.networkDetection = value;
        await plugin.saveSettings(tempSettings);
      }));
  
  // 清除缓存
  new Setting(baseSection)
    .setName('清除缓存')
    .setDesc('清除同步缓存数据')
    .addButton(button => button
      .setButtonText('清除')
      .onClick(async () => {
        try {
          await plugin.clearCache();
        } catch (error) {
          logger?.error('清除缓存失败', { error: error instanceof Error ? error.message : String(error) });
          plugin.notificationManager.show('cache-error', `清除缓存失败: ${error.message || error}`, 5000);
        }
      }));
} 