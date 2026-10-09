import { describe, it, expect } from 'vitest';
import { copyModel } from './copy';
describe('Editable configuration drafts', () => {
  it('clones nested drafts without changing the saved model', () => {
    const saved = {
      name: '数据库',
      workspaces: ['a'],
      tables: [{ name: 'dict', keys: ['code'] }],
    };
    const draft = copyModel(saved);
    draft.tables[0]!.keys.push('type');
    draft.workspaces = [];
    expect(saved.tables[0]!.keys).toEqual(['code']);
    expect(saved.workspaces).toEqual(['a']);
  });
});
