// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppearanceProvider } from './appearance';
import { BusinessProvider, useController, type Controller } from './controller';
import { previewBridge, previewPlan } from './preview';
import { defaultStructureOptions } from './structure-options';
import type { SyncRecord } from './types';

vi.mock('./api', async () => {
  const { previewBridge } = await import('./preview');
  return {
    preview: true,
    api: previewBridge.invoke,
    onEvent: previewBridge.onEvent,
    windowAction: previewBridge.window,
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('starts the showcase with the current scope and a registered single-mode plan that can be saved', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  let controller!: Controller;
  function Probe() {
    controller = useController();
    return null;
  }
  render(
    <AppearanceProvider initial={{ themeMode: 'light', resolvedTheme: 'light' }}>
      <BusinessProvider>
        <Probe />
      </BusinessProvider>
    </AppearanceProvider>,
  );
  await waitFor(() => expect(controller.m.page).toBe('diff'));
  const { plan, scopeTables } = controller.m;
  expect(plan?.id).not.toBe(previewPlan.id);
  expect(plan?.tables).toEqual(
    scopeTables
      .filter((table) => table.structure)
      .map((table) => ({
        name: table.name,
        structure: true,
        data: false,
        keyColumns: ['code'],
        structureOptions: defaultStructureOptions,
      })),
  );
  expect(
    plan?.targets
      .flatMap((target) => target.changes)
      .some((change) => change.kind.endsWith('_ROW') || change.kind.includes('INDEX')),
  ).toBe(false);
  const saved = await previewBridge.invoke<SyncRecord>('sync.save', {
    planId: plan!.id,
    selectedIds: controller.m.selectedIds,
    mode: 'SAVE_ONLY',
    remark: 'startup test',
  });
  expect(saved.plan?.id).toBe(plan!.id);
  await act(async () => controller.navigate('scope'));
  expect(controller.m.scopeTables).toEqual(scopeTables);
}, 10_000);
