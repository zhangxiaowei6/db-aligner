import { describe, expect, it } from 'vitest';
import { previewPlan } from './preview';
import { columnChangeSummary } from './column-comparison';

describe('planned column change summaries', () => {
  it('compares only planned properties, preserving unselected source differences', () => {
    const plan = structuredClone(previewPlan);
    const target = plan.targets[0];
    const change = target.changes.find((c) => c.kind === 'MODIFY_COLUMN')!;
    const before = target.before[change.table].columns.find((c) => c.name === change.label)!;
    change.after = { column: { ...before, comment: '新注释' } };
    plan.sourceSnapshot[change.table].columns.find((c) => c.name === change.label)!.type =
      'varchar(999)';
    expect(columnChangeSummary(plan, change)).toBe('注释');
    change.after = {
      column: { ...before, type: 'varchar(99)', defaultValue: 'new', comment: before.comment },
    };
    expect(columnChangeSummary(plan, change)).toBe('数据类型、默认值');
    change.after = { column: before, first: true };
    expect(columnChangeSummary(plan, change)).toBe('字段位置');
  });
  it('does not report unrelated targets or non-modification changes', () => {
    const plan = structuredClone(previewPlan);
    const change = plan.targets[0].changes.find((c) => c.kind === 'MODIFY_COLUMN')!;
    change.targetKey = 'missing/database';
    expect(columnChangeSummary(plan, change)).toBe('—');
    change.kind = 'ADD_COLUMN';
    expect(columnChangeSummary(plan, change)).toBe('—');
  });
});
