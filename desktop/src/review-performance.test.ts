import { expect, it } from 'vitest';
import {
  initialModel,
  leaves,
  recoveryNodes,
  reviewCounts,
  reviewNodes,
  selection,
  toggleIds,
} from './model';
import { previewPlan } from './preview';

it('preserves first table appearance when displaying an old mixed plan', () => {
  const model = initialModel();
  model.plan = structuredClone(previewPlan);
  const target = model.plan.targets[0];
  const sample = target.changes[0];
  model.plan.targets = [target];
  target.changes = [
    { ...sample, id: 'a-data', table: 'a', kind: 'ADD_ROW' },
    { ...sample, id: 'b-structure', table: 'b', kind: 'ADD_COLUMN' },
    { ...sample, id: 'a-structure', table: 'a', kind: 'ADD_COLUMN' },
  ];
  model.diffTab = 'structure';
  expect(reviewNodes(model)[0].children!.map((node) => node.label)).toEqual(['a', 'b']);
});

it('groups large change lists in input order and selects the complete filtered range', () => {
  const model = initialModel();
  const plan = structuredClone(previewPlan);
  const sample = plan.targets[0].changes[0];
  plan.targets = [plan.targets[0]];
  plan.targets[0].changes = Array.from({ length: 20_000 }, (_, index) => ({
    ...sample,
    id: `change-${index}`,
    table: `table-${index % 298}`,
    label: `column-${index}`,
    kind: 'ADD_COLUMN',
    blocked: index % 10 === 0,
  }));
  model.plan = plan;
  model.diffTab = 'structure';
  model.diffSearch = 'table-29 ';
  const nodes = reviewNodes(model);
  const changes = leaves(nodes[0]);
  expect(changes.length).toBeGreaterThan(20);
  expect(changes.every((change) => change.table === 'table-29')).toBe(true);
  const eligible = changes.filter((change) => !change.blocked).map((change) => change.id);
  const selected = toggleIds(['unrelated'], eligible, true);
  expect(selection(selected, eligible).checked).toBe(true);
  expect(selection([eligible[0]], eligible).indeterminate).toBe(true);
  expect(toggleIds(selected, eligible, false)).toEqual(['unrelated']);
  const counts = reviewCounts(nodes, new Set(selected));
  expect(counts.get(nodes[0].id)).toEqual({
    total: changes.length,
    eligible: eligible.length,
    selected: eligible.length,
  });
});

it('groups recovery items without including ineligible items in parent selection', () => {
  const model = initialModel();
  model.rollback = {
    id: 'rollback',
    recordId: 'record',
    items: Array.from({ length: 20_000 }, (_, index) => ({
      id: `restore-${index}`,
      targetKey: `target-${index % 2}/db`,
      table: `table-${index % 298}`,
      label: 'restore',
      eligible: index % 10 !== 0,
      selected: true,
      reason: '',
      sql: ['SELECT 1'],
    })),
  };
  const nodes = recoveryNodes(model);
  expect(nodes).toHaveLength(2);
  const counts = reviewCounts(nodes, new Set(model.rollback.items.map((item) => item.id)));
  expect(nodes.reduce((total, node) => total + counts.get(node.id)!.total, 0)).toBe(20_000);
  expect(nodes.reduce((total, node) => total + counts.get(node.id)!.selected, 0)).toBe(18_000);
});
