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
