import { emptyConnection } from './model';
// @vitest-environment jsdom
import { expect, it } from 'vitest';
import {
  connectionSaveError,
  connectionTestError,
  importPasswordRequired,
} from './connection-validation';
import { previewBridge } from './preview';

const valid = { name: '示例', host: 'localhost', port: 3306, user: 'tester', password: '' };

it('requires a password for saving, while allowing actual saved credentials and preserving whitespace', () => {
  expect(connectionSaveError(valid, false)).toBe('请输入连接密码');
  expect(connectionSaveError({ ...valid, hasPassword: true }, false)).toBe('请输入连接密码');
  expect(connectionSaveError(valid, true)).toBeUndefined();
  expect(connectionSaveError({ ...valid, password: '  ' }, false)).toBeUndefined();
  expect(connectionSaveError({ ...valid, clearPassword: true }, true)).toBe('请输入连接密码');
});

it.each([
  [undefined, '请填写连接名称、服务器地址、用户名'],
  [{ ...valid, name: ' ', user: '' }, '请填写连接名称、用户名'],
  [{ ...valid, host: '' }, '请填写服务器地址'],
  [{ ...valid, port: 0 }, '端口必须是 1–65535 的整数'],
  [{ ...valid, port: 65536 }, '端口必须是 1–65535 的整数'],
  [{ ...valid, port: 3.5 }, '端口必须是 1–65535 的整数'],
  [{ ...valid, host: 'https://localhost' }, '请输入有效的服务器地址'],
])('rejects incomplete or invalid connection parameters %j', (config, error) => {
  expect(connectionTestError(config)).toBe(error);
});

it('allows valid connection parameters, including an empty password and IPv6', () => {
  expect(connectionTestError(valid)).toBeUndefined();
  expect(connectionTestError({ ...valid, host: '[::1]', port: 65535 })).toBeUndefined();
});

it('does not simulate success when the preview connection is incomplete', async () => {
  await expect(
    previewBridge.invoke('connections.test', { config: { ...valid, user: '' } }),
  ).rejects.toThrow('请填写用户名');
  await expect(previewBridge.invoke('connections.test', { config: valid })).resolves.toEqual({
    serverVersion: '8.4.8 · 虚构预览数据',
  });
});

it('marks import passwords only when the selected row needs a new credential', () => {
  const row = {
    ...emptyConnection('default'),
    ...valid,
    id: 'imported',
    selected: true,
    credentialStatus: '需填写密码',
  };
  expect(importPasswordRequired(row, 'copy', [])).toBe(true);
  expect(
    importPasswordRequired({ ...row, password: 'filled', hasPassword: true }, 'copy', []),
  ).toBe(true);
  expect(
    importPasswordRequired({ ...row, credentialStatus: '已读取密码，可直接导入' }, 'copy', []),
  ).toBe(false);
  expect(importPasswordRequired({ ...row, selected: false }, 'copy', [])).toBe(false);
  expect(importPasswordRequired({ ...row, warning: '不支持' }, 'copy', [])).toBe(false);
  const existing = { ...row, id: 'saved', hasPassword: true };
  expect(importPasswordRequired(row, 'skip', [existing])).toBe(false);
  expect(importPasswordRequired(row, 'update', [existing])).toBe(false);
  expect(importPasswordRequired(row, 'copy', [existing])).toBe(true);
  expect(importPasswordRequired(row, 'update', [{ ...existing, hasPassword: false }])).toBe(true);
});
