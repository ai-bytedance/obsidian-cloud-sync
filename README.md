# 云盘同步插件

## 开发状态

> 当前项目仍处于 **Alpha** 阶段，请在同步重要笔记前先做好备份。

这是一个 Obsidian 云同步插件，目标是把 Vault 中的笔记同步到常见云存储。  
目前已经有两条真实可用的同步链路：

- `WebDAV`
- `GitHub`

其他云盘入口目前仍处于开发中或仅有界面占位。

![image](https://github.com/user-attachments/assets/278e09f5-7f04-4de8-bfd1-3d3dfc3017ae)
![image](https://github.com/user-attachments/assets/ab77642b-ed03-4493-ace8-beec5da4a284)
![image](https://github.com/user-attachments/assets/904823cb-e977-4169-a216-7256f9b5d353)
![image](https://github.com/user-attachments/assets/b3c55798-68a5-47a9-b624-b2c29d2a1c68)

## 核心功能

- 支持 `双向同步`、`仅上传`、`仅下载`
- 支持 `自动同步`、`定时同步`、`手动同步`
- 支持基础 `冲突处理策略`
- 支持 `文件创建 / 修改 / 删除` 同步
- 支持 `Markdown 链接转换`
- 支持 `选择性同步`，可忽略文件、文件夹和扩展名
- 支持可选 `内容加密`

## 当前支持情况

### WebDAV

- 已实现，可用于实际同步
- 适用于坚果云、Nextcloud 等兼容 WebDAV 的服务
- 支持同步路径、自定义目录、自动同步、手动同步

### GitHub

- 已实现 MVP，可用于实际同步
- 支持公开仓库和私有仓库
- 支持：
  - 测试连接
  - 递归列出远端文件
  - 上传新文件
  - 更新已有文件
  - 删除远端文件
  - 接入现有手动同步 / 自动同步主链路
- 推荐使用 `owner/repo` 形式填写仓库，例如：`ai-bytedance/obsidian-test`

### iCloud

- 开发中
- 当前仅有界面和占位逻辑，尚不可用

### Google Drive / OneDrive

- 规划中
- 当前尚未实现后端同步能力

## 安装

当前仅支持从源码安装。

```bash
git clone https://github.com/ai-bytedance/obsidian-cloud-sync.git
cd obsidian-cloud-sync
npm install
npm run build
```

然后将以下文件复制到你的 Vault 目录下：

```text
.obsidian/plugins/cloud-sync/
```

需要复制的文件：

- `main.js`
- `manifest.json`
- `styles.css`

## 基本配置

安装并启用插件后：

1. 打开插件设置
2. 选择要启用的云盘
3. 填写对应凭据
4. 设置同步方向、同步策略和同步路径
5. 点击“测试连接”
6. 通过后再执行首次同步

## GitHub 配置说明

GitHub 建议使用 `Fine-grained personal access token`。

最小权限建议：

- `Contents: Read and write`
- `Metadata: Read-only`

推荐配置项：

- `仓库`：填写 `owner/repo`
- `个人访问令牌`：GitHub Token
- `分支`：通常为 `main`
- `同步路径`：可留空；如需同步到子目录，可填写如 `notes`
- `用户名（兼容，可选）`：仅当你在“仓库”里只填写 `repo` 时才需要

### GitHub 已知限制

- GitHub **不支持空目录**
  - 只创建文件夹、不创建文件时，远端不会出现该目录
  - 目录中有实际文件后，才会通过文件路径在仓库中体现出来
- 当前更推荐使用 `owner/repo`，不要依赖兼容用户名回退逻辑
- 文件时间在 GitHub 下是近似值，极端情况下可能影响个别边界同步判断

## WebDAV 配置说明

需要填写：

- 服务器地址
- 用户名
- 密码
- 同步路径（可选）

常见注意点：

- 服务器地址必须带协议头，如 `https://`
- 部分服务对路径格式较敏感，建议先通过“测试连接”确认
- 坚果云等服务可能有频率限制，频繁同步时要注意 API 限额

## 注意事项

- 当前版本仍为 Alpha，请务必先备份
- 开启加密后，请妥善保存密钥；密钥丢失将无法解密历史内容
- 网络不稳定时，同步失败概率会明显上升
- 大文件和大量附件同步会更慢
- 若使用 GitHub，同步本质上会转化为仓库内容写入，不适合作为超大文件存储方案
- Markdown 链接会在上传时做兼容性处理，某些特殊写法在其他编辑器中的显示可能与 Obsidian 不完全一致

## 常见问题

### 现在可以实际使用哪些云盘？

目前可实际使用：

- `WebDAV`
- `GitHub`

其余提供商尚未完成后端实现。

### 为什么创建了文件夹但 GitHub 上没看到？

因为 GitHub 不支持空目录。  
如果只是创建了目录，没有目录内文件，远端不会显示该目录。

### GitHub 同步失败怎么办？

- 检查 `Token` 是否有效
- 检查 Token 是否具有 `Contents: Read and write`
- 检查仓库格式是否为 `owner/repo`
- 检查分支是否存在
- 检查仓库是否对当前 Token 可访问

### WebDAV 同步失败怎么办？

- 检查服务器地址是否正确
- 检查用户名和密码
- 检查网络是否正常
- 检查服务端路径和权限
- 尝试先用“测试连接”定位问题

### 为什么插件还没上架 Obsidian 插件市场？

因为项目还处于 Alpha 阶段，功能和稳定性仍在持续打磨。

## 开发

常用命令：

```bash
npm install
npm run build
```

当前构建命令会先做 TypeScript 检查，再执行打包。

## 捐赠支持

插件开发者为这款插件付出了大量的时间与精力。如果你觉得这个插件有帮助，欢迎支持开发。

![merged_qr](https://github.com/user-attachments/assets/4f302ecd-b8ea-4930-9980-35b8943ddb0e)
![企业微信截图_20250312104609](https://github.com/user-attachments/assets/1a6d5d0c-4714-41e5-b0fe-363b86761c8a)
