import type { Version } from './types';

/** 与引擎一致：去除首尾空白，同一工作区内按原样比较版本号。 */
export function versionNumberError(
  number: string,
  versions: Version[],
  workspaceId: string,
  id = '',
) {
  const normalized = number.trim();
  if (!normalized) return '请输入版本号';
  if (
    versions.some(
      (version) =>
        version.workspaceId === workspaceId && version.id !== id && version.number === normalized,
    )
  )
    return '工作区内版本号已存在';
}
