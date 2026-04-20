import { FileInfo, FileMetadata } from '@providers/common/storage-provider';
import { GitHubContentFile, GitHubContentItem } from './github-types';

export function toFileInfo(item: GitHubContentItem, modifiedTime: Date): FileInfo {
  return {
    path: item.path,
    name: item.name,
    isFolder: item.type === 'dir',
    size: item.type === 'file' ? item.size : 0,
    modifiedTime,
    etag: item.sha
  };
}

export function toFileMetadata(item: GitHubContentFile, modifiedTime: Date): FileMetadata {
  return {
    path: item.path,
    name: item.name,
    isFolder: false,
    size: item.size,
    modifiedTime,
    etag: item.sha,
    hash: item.sha
  };
}
