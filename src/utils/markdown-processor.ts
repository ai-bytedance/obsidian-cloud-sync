/**
 * Markdown处理工具
 * 用于处理Markdown文件中的Obsidian特有格式
 * @author Bing
 */
import { ModuleLogger } from '@services/log/log-service';

// 模块级日志记录器
let logger: ModuleLogger | null = null;

/**
 * 配置Markdown处理器的日志记录器
 * @param moduleLogger 日志记录器
 */
export function configureMarkdownProcessor(moduleLogger: ModuleLogger): void {
  logger = moduleLogger;
}

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
    logger?.error('处理Markdown内容失败：内容不是字符串', { content: typeof content });
    return '';
  }

  try {
    logger?.debug('开始处理Markdown内容', { contentLength: content.length, basePath, serverType });
    
    // 替换Obsidian内部链接格式的图片引用
    // 例如 ![[image.png]] -> ![](attachments/image.png)
    let processedContent = content.replace(/!\[\[(.*?)\]\]/g, (match, fileName) => {
      // 提取文件名，并检查是否有替代文本
      const parts = fileName.split('|');
      const actualFileName = parts[0].trim();
      const altText = parts.length > 1 ? parts[1].trim() : actualFileName;
      
      // 构建标准Markdown图片链接格式
      // 根据服务器类型和基础路径，可能需要特殊处理URL
      let attachmentPath = '';
      
      // 处理相对路径
      if (basePath) {
        attachmentPath = basePath.endsWith('/') ? basePath : basePath + '/';
      }
      
      // 添加附件目录前缀（如果文件名中没有路径）
      if (!actualFileName.includes('/')) {
        attachmentPath += 'attachments/';
      }
      
      const imageUrl = attachmentPath + actualFileName;
      logger?.debug('转换Obsidian内部图片链接', { 
        from: match, 
        to: `![${altText}](${imageUrl})`,
        fileName: actualFileName,
        altText
      });
      
      return `![${altText}](${imageUrl})`;
    });
    
    // 替换Obsidian内部链接格式的文件引用
    // 例如 [[file.md]] -> [file](file.md)
    processedContent = processedContent.replace(/\[\[(.*?)\]\]/g, (match, linkText) => {
      // 提取链接文本和显示文本
      const parts = linkText.split('|');
      const link = parts[0].trim();
      const display = parts.length > 1 ? parts[1].trim() : link;
      
      // 检查是否是外部链接（以http开头）
      if (link.startsWith('http')) {
        logger?.debug('跳过外部链接的转换', { link });
        return `[${display}](${link})`;
      }
      
      // 构建标准Markdown链接
      const normalizedLink = link.replace(/ /g, '%20');
      logger?.debug('转换Obsidian内部文件链接', { 
        from: match, 
        to: `[${display}](${normalizedLink})`,
        link,
        display
      });
      
      return `[${display}](${normalizedLink})`;
    });
    
    // 处理高亮标记
    // 例如 ==highlighted text== -> <mark>highlighted text</mark>
    processedContent = processedContent.replace(/==(.*?)==/g, (match, text) => {
      logger?.debug('转换高亮标记', { from: match, to: `<mark>${text}</mark>` });
      return `<mark>${text}</mark>`;
    });
    
    logger?.debug('Markdown内容处理完成', { 
      originalLength: content.length, 
      processedLength: processedContent.length
    });
    
    return processedContent;
  } catch (error) {
    logger?.error('处理Markdown内容时发生错误', { error: error instanceof Error ? error.message : String(error) });
    return content; // 出错时返回原始内容
  }
}

/**
 * 还原标准Markdown格式为Obsidian内部链接格式
 * @param content 标准Markdown格式的内容
 * @param basePath 基础路径（用于移除图片链接中的前缀）
 * @returns 还原后的Obsidian格式内容
 */
export function restoreObsidianFormat(content: string, basePath: string = ''): string {
  if (typeof content !== 'string') {
    logger?.error('还原Obsidian格式失败：内容不是字符串', { content: typeof content });
    return '';
  }
  
  try {
    logger?.debug('开始还原Obsidian格式', { contentLength: content.length, basePath });
    
    // 移除可能的基础路径前缀
    let normalizedBasePath = '';
    if (basePath) {
      normalizedBasePath = basePath.endsWith('/') ? basePath : basePath + '/';
    }
    
    // 还原图片链接 ![alt](path/to/image.png) -> ![[image.png]]
    let restoredContent = content.replace(/!\[(.*?)]\((.*?)\)/g, (match, alt, url) => {
      // 移除URL中的基础路径和附件目录前缀
      let cleanUrl = url;
      if (normalizedBasePath && cleanUrl.startsWith(normalizedBasePath)) {
        cleanUrl = cleanUrl.substring(normalizedBasePath.length);
      }
      
      // 移除"attachments/"等常见附件目录前缀
      const attachmentsPrefixes = ['attachments/', 'assets/', 'images/', 'img/', 'resources/'];
      for (const prefix of attachmentsPrefixes) {
        if (cleanUrl.startsWith(prefix)) {
          cleanUrl = cleanUrl.substring(prefix.length);
          break;
        }
      }
      
      // 判断是否需要添加替代文本（如果与文件名不同）
      const fileName = cleanUrl.split('/').pop() || '';
      const obsidianLink = alt !== fileName && alt !== cleanUrl ? `![[${cleanUrl}|${alt}]]` : `![[${cleanUrl}]]`;
      
      logger?.debug('还原Markdown图片链接为Obsidian格式', { 
        from: match, 
        to: obsidianLink,
        alt,
        url,
        cleanUrl
      });
      
      return obsidianLink;
    });
    
    // 还原普通链接 [text](link) -> [[link|text]] 或 [[link]]
    restoredContent = restoredContent.replace(/\[([^\]]*?)]\(([^)]*?)\)/g, (match, text, link) => {
      // 忽略外部链接（http或https开头）
      if (link.startsWith('http')) {
        logger?.debug('跳过外部链接的还原', { link });
        return match;
      }
      
      // 还原URL编码的空格
      const decodedLink = link.replace(/%20/g, ' ');
      
      // 判断是否需要添加显示文本（如果与链接不同）
      const obsidianLink = text !== decodedLink ? `[[${decodedLink}|${text}]]` : `[[${decodedLink}]]`;
      
      logger?.debug('还原Markdown链接为Obsidian格式', { 
        from: match, 
        to: obsidianLink,
        text,
        link,
        decodedLink
      });
      
      return obsidianLink;
    });
    
    // 还原高亮标记 <mark>text</mark> -> ==text==
    restoredContent = restoredContent.replace(/<mark>(.*?)<\/mark>/g, (match, text) => {
      logger?.debug('还原高亮标记为Obsidian格式', { from: match, to: `==${text}==` });
      return `==${text}==`;
    });
    
    logger?.debug('Obsidian格式还原完成', { 
      originalLength: content.length, 
      restoredLength: restoredContent.length
    });
    
    return restoredContent;
  } catch (error) {
    logger?.error('还原Obsidian格式时发生错误', { error: error instanceof Error ? error.message : String(error) });
    return content; // 出错时返回原始内容
  }
} 