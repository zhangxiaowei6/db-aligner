import { describe, it, expect } from 'vitest';
import { reactive } from 'vue';
import { copyModel } from './copy';
describe('Editable configuration drafts', () => {
  it('clones nested Vue proxies without changing the saved model', () => {
    const saved = reactive({
      name: '数据库',
      workspaces: ['a'],
      tables: [{ name: 'dict', keys: ['code'] }],
    });
    const draft = copyModel(saved);
    draft.tables[0]!.keys.push('type');
    draft.workspaces = [];
    expect(saved.tables[0]!.keys).toEqual(['code']);
    expect(saved.workspaces).toEqual(['a']);
  });
});
