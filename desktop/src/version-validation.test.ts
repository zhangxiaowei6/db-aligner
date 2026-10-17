import { expect, it } from 'vitest';
import { versionNumberError } from './version-validation';

const versions = [{ id: 'one', workspaceId: 'a', number: 'v1.0', description: '', createdAt: '' }];
it('matches engine uniqueness, ignores the edited object, and keeps workspaces independent', () => {
  expect(versionNumberError('', versions, 'a')).toBe('请输入版本号');
  expect(versionNumberError(' v1.0 ', versions, 'a')).toBe('工作区内版本号已存在');
  expect(versionNumberError('v1.0', versions, 'a', 'one')).toBeUndefined();
  expect(versionNumberError('v1.0', versions, 'b')).toBeUndefined();
});
