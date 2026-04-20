export interface GitHubRepoRef {
  owner: string;
  repo: string;
  branch: string;
}

export interface GitHubRepoResponse {
  default_branch: string;
  full_name: string;
  private: boolean;
}

export interface GitHubContentFile {
  type: 'file';
  name: string;
  path: string;
  sha: string;
  size: number;
  encoding?: string;
  content?: string;
  download_url?: string | null;
}

export interface GitHubContentDirectory {
  type: 'dir';
  name: string;
  path: string;
  sha: string;
  size?: number;
}

export interface GitHubContentSymlink {
  type: 'symlink';
  name: string;
  path: string;
  sha: string;
  size?: number;
}

export interface GitHubContentSubmodule {
  type: 'submodule';
  name: string;
  path: string;
  sha: string;
  size?: number;
}

export type GitHubContentItem =
  | GitHubContentFile
  | GitHubContentDirectory
  | GitHubContentSymlink
  | GitHubContentSubmodule;

export interface GitHubCommitResponse {
  commit: {
    committer: {
      date: string;
    };
  };
  sha: string;
}

export interface GitHubPutFileResponse {
  content: GitHubContentFile;
  commit: {
    sha: string;
  };
}
