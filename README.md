# obsidian-cloud-sync

云盘同步插件是一款 Obsidian 插件，可以将您的笔记安全地同步到百度网盘和阿里云盘。通过强大的 AES 加密保护您的数据隐私，同时提供灵活的同步选项，让您的笔记随时随地保持同步。

## 核心功能

### 多云盘支持
- **百度网盘集成**：直接连接到您的百度网盘账户

## 安装方法

1. 打开 Obsidian 设置
2. 进入插件管理页面
3. 搜索 "云盘同步插件"
4. 点击安装并等待安装完成

## 手动安装

如果您想手动安装此插件，请按照以下步骤操作：

### 方法一：从发布版本安装

1. 访问[插件发布页面](https://github.com/ai-bytedance/obsidian-cloud-sync)
2. 下载最新版本的发布包（通常命名为`obsidian-cloud-sync-x.x.x.zip`）
3. 解压下载的文件，您将得到`main.js`、`manifest.json`和`styles.css`等文件
4. 打开您的Obsidian保险库（vault）文件夹
5. 导航到`.obsidian/plugins/`目录（如果不存在，请创建它）
6. 在此目录下创建一个名为`obsidian-cloud-sync`的新文件夹
7. 将解压出的文件复制到新创建的文件夹中
8. 重启Obsidian
9. 在Obsidian中，进入设置 > 第三方插件，启用"Cloud Sync"插件

### 方法二：从源代码构建安装

如果您想从源代码构建并安装插件，请按照以下步骤操作：

1. 确保您已安装[Node.js](https://nodejs.org/)（推荐使用LTS版本）
2. 克隆或下载此仓库到本地：
   ```bash
   git clone https://github.com/ai-bytedance/obsidian-cloud-sync.git
   ```
3. 进入项目目录：
   ```bash
   cd obsidian-cloud-sync
   ```
4. 安装依赖：
   ```bash
   npm install
   ```
5. 构建插件：
   ```bash
   npm run build
   ```
6. 将构建好的文件复制到您的Obsidian插件目录：
   ```bash
   mkdir -p /path/to/your/vault/.obsidian/plugins/obsidian-cloud-sync/
   cp main.js manifest.json styles.css /path/to/your/vault/.obsidian/plugins/obsidian-cloud-sync/
   ```
   注意：请将`/path/to/your/vault/`替换为您实际的Obsidian保险库路径
7. 重启Obsidian
8. 在Obsidian中，进入设置 > 第三方插件，启用"Cloud Sync"插件

## 初始配置

安装完成后，您需要进行以下配置：

1. 在Obsidian中，进入设置 > 第三方插件 > Cloud Sync > 设置
2. 选择您想要使用的云盘服务（百度网盘或阿里云盘）并启用它
3. 输入相应的API密钥（App Key和App Secret）
   - 对于百度网盘，您需要在[百度开放平台](https://pan.baidu.com/union/home)申请
   - 对于阿里云盘，您需要在[阿里云盘开放平台](https://www.aliyundrive.com/developer)申请
4. 设置同步文件夹路径（云盘上的目标文件夹）
5. 设置加密密钥（强烈建议设置，以保护您的数据安全）
6. 设置同步间隔（分钟）
7. 点击"授权"按钮，按照提示完成云盘授权流程

## 使用方法

1. 打开 Obsidian 设置
2. 进入云盘同步插件设置页面
3. 登录您的百度网盘和阿里云盘账户
4. 选择要同步的笔记和文件
5. 设置同步选项和配置

## 配置选项

- **加密保护**：使用 AES 加密保护文件内容
- **同步选项**：支持增量同步和自动同步
- **文件排除**：有文件排除功能

## 注意事项

- 确保您的网络连接稳定
- 不要在同步过程中关闭 Obsidian 或断开网络连接
- 定期检查同步状态和配置

## 常见问题

1. **授权失败**
   - 确保您的App Key和App Secret正确
   - 检查网络连接是否正常
   - 尝试重新授权

2. **同步失败**
   - 检查云盘空间是否足够
   - 确认文件路径不包含特殊字符
   - 查看开发者控制台日志（Ctrl+Shift+I）获取详细错误信息

3. **加密问题**
   - 请务必记住您的加密密钥，丢失后将无法恢复已加密的数据
   - 如果更改加密密钥，之前同步的文件将无法正常解密

4. **插件不显示**
   - 确保您已启用第三方插件功能
   - 检查插件文件是否正确放置在插件目录中
