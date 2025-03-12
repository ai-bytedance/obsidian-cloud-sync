
# Obsidian 云盘同步插件

一款强大的 Obsidian 插件，支持将笔记自动同步到百度网盘和阿里云盘，提供端到端加密保护，让您的笔记既安全又便捷。

![demo](https://github.com/user-attachments/assets/13cd2327-7ee1-45d2-bae3-a07d3a4956fe)


## 核心功能

- 多云盘支持：同时支持百度网盘和阿里云盘

- 端到端加密：所有文件在上传前进行加密，保护您的隐私

- 自动同步：文件变更时自动同步到云盘

- 定时同步：支持设置定时同步间隔

- 选择性同步：可配置需要同步的文件类型和排除特定文件夹

- 完整操作同步：支持文件创建、修改、删除、重命名等操作的同步

- 状态栏提示：直观显示同步状态和进度

## 安装方法

### 从 Obsidian 插件市场安装

- 打开 Obsidian 设置

- 进入"第三方插件"

- 关闭"安全模式"

- 点击"浏览"按钮

- 搜索"Cloud Sync"

- 点击安装

### 手动安装

- 从 GitHub Releases 下载最新版本

- 解压下载的文件

- 将解压后的文件夹复制到您的 Obsidian 库的 .obsidian/plugins/ 目录下

- 在 Obsidian 中启用插件

### 从源码安装

```
git clone https://github.com/ai-bytedance/obsidian-cloud-sync.git
cd obsidian-cloud-sync
npm install
npm run build
```


将生成的 main.js、manifest.json 和 styles.css 复制到您的 Obsidian 库的 .obsidian/plugins/cloud-sync/ 目录下。

## 初始配置

- 安装并启用插件后，点击插件设置

- 选择要使用的云盘（百度网盘和/或阿里云盘）

- 配置云盘 API 密钥（需要先申请开发者权限）

	- [百度网盘开发者中心](https://pan.baidu.com/union/home)

	- [阿里云盘开放平台](https://www.aliyun.com/product/storage/disk)

- 设置加密密钥（请妥善保管，丢失将无法恢复已加密文件）

- 配置同步文件夹路径

- 点击"授权"按钮，完成云盘授权

## 使用方法

### 手动同步

- 点击状态栏中的云盘图标

- 选择"全量同步"进行手动同步

### 自动同步

插件会自动监听文件变更并同步到云盘，您也可以设置定时同步：

- 在插件设置中启用"定时同步"

- 设置同步间隔（分钟）

## 配置选项

### 通用设置

- 加密密钥：用于加密文件的密钥，请妥善保管

- 同步间隔：自动同步的时间间隔（分钟），设为 0 禁用定时同步

- 排除文件夹：不需要同步的文件夹列表，用逗号分隔

- 排除文件类型：不需要同步的文件类型，用逗号分隔

### 百度网盘设置

- 启用百度网盘：开启/关闭百度网盘同步

- App Key：百度网盘应用的 App Key

- App Secret：百度网盘应用的 App Secret

- 同步文件夹：百度网盘中的同步目录路径

### 阿里云盘设置

- 启用阿里云盘：开启/关闭阿里云盘同步

- App Key：阿里云盘应用的 App Key

- App Secret：阿里云盘应用的 App Secret

- 同步文件夹：阿里云盘中的同步目录路径

## 注意事项

- 加密密钥安全：请务必备份您的加密密钥，密钥丢失将导致无法恢复已加密文件

- 网络依赖：同步功能依赖网络连接，请确保网络稳定

- API 限制：云盘 API 可能有调用频率和流量限制，过于频繁的同步可能触发限制

- 大文件同步：大文件同步可能需要较长时间，请耐心等待

- 冲突处理：当前版本在冲突时会优先使用本地版本

## 常见问题

### 授权失败怎么办？

- 确认您的 App Key 和 App Secret 正确无误

- 检查网络连接是否正常

- 确认您的应用已通过云盘平台审核

- 尝试重新授权

### 同步失败怎么办？

- 检查网络连接

- 确认云盘空间是否充足

- 查看控制台错误日志

- 尝试重新授权云盘

- 重启 Obsidian 后再试

### 如何更换加密密钥？

更换加密密钥会导致无法解密之前加密的文件，建议：

- 先备份所有文件

- 更改加密密钥

- 重新同步所有文件

### 如何在多设备间使用？

- 在每台设备上安装插件

- 使用相同的云盘账号和加密密钥

- 配置相同的同步设置

## 捐赠支持

插件开发者为这款插件付出了大量的时间与精力。如果你觉得这个插件很有用，就支持一下开发吧！

![merged_qr](https://github.com/user-attachments/assets/4f302ecd-b8ea-4930-9980-35b8943ddb0e)
![企业微信截图_20250312104609](https://github.com/user-attachments/assets/1a6d5d0c-4714-41e5-b0fe-363b86761c8a)

