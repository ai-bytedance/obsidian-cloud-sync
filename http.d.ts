// 使用更具体的模块路径来避免冲突
declare module 'node:http' {
  // 使用 type 而不是 interface 来避免重复定义错误
  export type RequestListener = (req: any, res: any) => void;
} 