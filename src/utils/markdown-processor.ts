/**
 * Markdown处理工具
 * 用于处理Markdown文件中的Obsidian特有格式
 * @author Bing
 */

/**
 * 处理Markdown内容，转换Obsidian内部链接为标准Markdown格式
 * @param content Markdown内容
 * @param basePath 基础路径（如果图片不在根目录，需要添加路径前缀）
 * @param serverType 服务器类型（可选，用于特定类型服务器的路径优化）
 * @returns 处理后的Markdown内容
 */
export function processMarkdownContent(content: string, basePath: string = '', serverType: string = 'default'): string {
  // 检查内容是否为字符串
  if (typeof content !== 'string') {
    console.error('处理Markdown内容失败：内容不是字符串');
    return content;
  }

  console.log('开始处理Markdown内容，基础路径:', basePath, '服务器类型:', serverType);

  // 处理Obsidian的内部链接格式 ![[image.png]] -> ![](image.png)
  // 匹配图片链接模式，扩展以支持更多图片格式
  const obsidianImagePattern = /!\[\[(.*?\.(?:png|jpg|jpeg|gif|svg|webp))\]\]/g;
  
  // 替换为标准Markdown图片链接格式
  let processedContent = content.replace(obsidianImagePattern, (match, imagePath) => {
    console.log(`处理图片链接: ${match} -> ${imagePath}`);
    
    // 处理可能的路径分隔符问题（替换反斜杠为正斜杠）
    const normalizedImagePath = imagePath.replace(/\\/g, '/');
    
    // 获取图片文件名（不包含路径）
    const imageName = normalizedImagePath.split('/').pop() || normalizedImagePath;
    
    // 检查是否是粘贴图片格式（Pasted image ...）
    const isPastedImage = /Pasted image \d+\.\w+/i.test(imageName);
    
    // 构建最终的图片URL
    let finalImagePath;
    if (isPastedImage) {
      // 对于粘贴图片，优先使用仅包含文件名的路径，避免路径中混入不必要的前缀
      console.log(`检测到粘贴图片: ${imageName}`);
      
      // 处理文件名，确保URL兼容性
      // 去除文件名前面的路径分隔符
      let cleanImageName = imageName.replace(/^\/+/, '');
      
      // 重要：将文件名中的空格替换为%20，以确保URL兼容性
      const encodedImageName = cleanImageName.replace(/ /g, '%20');
      
      console.log(`处理后的图片名: ${cleanImageName} (URL编码后: ${encodedImageName})`);
      
      // 根据服务器类型选择最佳路径格式
      if (serverType === 'webdav' || serverType === 'github') {
        // WebDAV和GitHub通常需要URL编码的路径
        finalImagePath = basePath ? `${basePath}/${encodedImageName}` : encodedImageName;
        console.log(`为${serverType}服务器使用URL编码路径: ${finalImagePath}`);
      } else {
        // 对于其他服务器或默认情况，使用不带URL编码的路径
        // 大多数Markdown渲染器能正确处理带空格的路径
        finalImagePath = basePath ? `${basePath}/${cleanImageName}` : cleanImageName;
        console.log(`使用标准路径: ${finalImagePath}`);
      }
      
      console.log(`粘贴图片处理后路径: ${finalImagePath}`);
    } else {
      // 标准图片处理
      // 检查是否包含附件目录前缀
      const attachmentPrefixes = ['attachments/', 'assets/', 'images/', 'img/', 'resources/'];
      let hasAttachmentPrefix = false;
      let prefixUsed = '';
      
      for (const prefix of attachmentPrefixes) {
        if (normalizedImagePath.startsWith(prefix)) {
          hasAttachmentPrefix = true;
          prefixUsed = prefix;
          break;
        }
      }
      
      // 如果basePath已经包含了附件目录，并且路径也以附件目录开头，则移除重复
      if (hasAttachmentPrefix && basePath && 
          attachmentPrefixes.some(prefix => basePath.endsWith(prefix.slice(0, -1)))) {
        console.log(`检测到附件路径重复，移除前缀: ${prefixUsed}`);
        const imagePathWithoutPrefix = normalizedImagePath.substring(prefixUsed.length);
        
        // 处理空格
        if (serverType === 'webdav' || serverType === 'github') {
          // 对特定服务器进行URL编码
          const encodedPath = imagePathWithoutPrefix.replace(/ /g, '%20');
          finalImagePath = `${basePath}/${encodedPath}`;
        } else {
          finalImagePath = `${basePath}/${imagePathWithoutPrefix}`;
        }
      } else {
        // 处理空格
        if (serverType === 'webdav' || serverType === 'github') {
          // 对特定服务器进行URL编码
          const encodedPath = normalizedImagePath.replace(/ /g, '%20');
          finalImagePath = basePath ? `${basePath}/${encodedPath}` : encodedPath;
        } else {
          finalImagePath = basePath ? `${basePath}/${normalizedImagePath}` : normalizedImagePath;
        }
      }
    }
    
    console.log(`图片链接转换: ${match} -> ![](${finalImagePath})`);
    
    // 使用标准Markdown图片语法
    return `![](${finalImagePath})`;
  });

  // 处理Obsidian的内链附件格式 ![[file.pdf]] -> [file.pdf](file.pdf)
  const obsidianAttachmentPattern = /!\[\[(.*?\.(?:pdf|doc|docx|xls|xlsx|csv|txt))\]\]/g;
  
  processedContent = processedContent.replace(obsidianAttachmentPattern, (match, filePath) => {
    // 处理可能的路径分隔符问题
    const normalizedFilePath = filePath.replace(/\\/g, '/');
    
    // 获取文件名（不包含路径）
    const fileName = normalizedFilePath.split('/').pop() || normalizedFilePath;
    
    // 处理特定服务器的URL编码需求
    let processedFilePath;
    if (serverType === 'webdav' || serverType === 'github') {
      // 使用URL编码的路径
      const encodedFileName = fileName.replace(/ /g, '%20');
      const encodedFilePath = normalizedFilePath.replace(/ /g, '%20');
      processedFilePath = basePath ? `${basePath}/${encodedFilePath}` : encodedFilePath;
      console.log(`为${serverType}服务器使用URL编码附件路径: ${processedFilePath}`);
    } else {
      // 使用标准路径
      processedFilePath = basePath ? `${basePath}/${normalizedFilePath}` : normalizedFilePath;
    }
    
    console.log(`附件链接转换: ${match} -> [${fileName}](${processedFilePath})`);
    
    // 使用标准Markdown链接语法
    return `[${fileName}](${processedFilePath})`;
  });

  // 处理Obsidian的内部链接格式 [[note]] -> [note](note.md)
  const obsidianLinkPattern = /\[\[(.*?)\]\]/g;
  
  processedContent = processedContent.replace(obsidianLinkPattern, (match, linkPath) => {
    // 处理链接可能包含的别名
    const parts = linkPath.split('|');
    const path = parts[0].trim();
    const alias = parts.length > 1 ? parts[1].trim() : path;
    
    // 处理可能的路径分隔符问题
    const normalizedPath = path.replace(/\\/g, '/');
    
    // 如果链接没有扩展名，添加.md扩展名
    const fullPath = normalizedPath.includes('.') ? normalizedPath : `${normalizedPath}.md`;
    
    // 处理特定服务器的URL编码需求
    let processedLinkPath;
    if (serverType === 'webdav' || serverType === 'github') {
      // 使用URL编码的路径
      const encodedPath = fullPath.replace(/ /g, '%20');
      processedLinkPath = basePath ? `${basePath}/${encodedPath}` : encodedPath;
    } else {
      // 使用标准路径
      processedLinkPath = basePath ? `${basePath}/${fullPath}` : fullPath;
    }
    
    console.log(`内部链接转换: ${match} -> [${alias}](${processedLinkPath})`);
    
    // 使用标准Markdown链接语法
    return `[${alias}](${processedLinkPath})`;
  });

  return processedContent;
} 