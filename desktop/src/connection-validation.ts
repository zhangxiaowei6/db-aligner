import type { ConnectionInfo } from './types';

/** 导入密码可由宿主暂存凭据或更新目标的已存密码提供，不能仅凭输入框是否为空判断。 */
export function importPasswordRequired(
  row: ConnectionInfo & { selected: boolean; warning?: string; credentialStatus: string },
  mode: string,
  connections: ConnectionInfo[],
) {
  if (!row.selected || row.warning) return false;
  const existing = connections.find(
    (c) => c.host === row.host && c.port === row.port && c.user === row.user,
  );
  if (existing && (mode === 'skip' || (mode === 'update' && existing.hasPassword))) return false;
  return !['已读取密码，可直接导入', '可导入密码'].includes(row.credentialStatus);
}

export function connectionTestError(config: unknown): string | undefined {
  const value = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  const missing = [
    ['name', '连接名称'],
    ['host', '服务器地址'],
    ['user', '用户名'],
  ].filter(([key]) => typeof value[key] !== 'string' || !(value[key] as string).trim());
  if (
    value.databaseType !== undefined &&
    !['mysql', 'postgresql'].includes(value.databaseType as string)
  )
    return '不支持的数据库类型';
  if (
    value.databaseType === 'postgresql' &&
    (typeof value.initialDatabase !== 'string' || !value.initialDatabase.trim())
  )
    return '请输入初始连接数据库';
  if (
    value.databaseType === 'postgresql' &&
    value.ssl &&
    (typeof value.ca !== 'string' || !value.ca.trim())
  )
    return 'PostgreSQL SSL 连接需要 CA 证书';
  if (missing.length) return '请填写' + missing.map(([, label]) => label).join('、');
  if (!/^[a-zA-Z0-9.\-:\[\]]+$/.test(value.host as string)) return '请输入有效的服务器地址';
  if (
    typeof value.port !== 'number' ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535
  )
    return '端口必须是 1–65535 的整数';
}

/** 保存时必须有新密码或可信的已存凭据；占位文字永远不是密码值。 */
export function connectionSaveError(
  config: unknown,
  hasSavedPassword: boolean,
): string | undefined {
  const error = connectionTestError(config);
  if (error) return error;
  const value = config as Record<string, unknown>;
  if (
    value.clearPassword === true ||
    (!hasSavedPassword && !(typeof value.password === 'string' && value.password.length))
  )
    return '请输入连接密码';
}
