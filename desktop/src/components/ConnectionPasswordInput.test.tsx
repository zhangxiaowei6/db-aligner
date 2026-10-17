// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { ConnectionPasswordInput } from './ConnectionPasswordInput';

afterEach(cleanup);
function Editor() {
  const [password, setPassword] = useState('');
  return (
    <>
      <ConnectionPasswordInput
        id="password"
        hasSavedPassword
        value={password}
        onChange={setPassword}
      />
      <label htmlFor="password">密码</label>
      <output data-testid="actual">{password}</output>
    </>
  );
}
it('shows a fixed real mask without putting it in the saved value, and replaces it on input', async () => {
  render(<Editor />);
  const input = screen.getByLabelText('密码') as HTMLInputElement;
  expect(input.type).toBe('password');
  expect(input.value).toBe('********');
  expect(screen.getByTestId('actual').textContent).toBe('');
  await userEvent.click(input);
  await userEvent.keyboard('{ArrowRight}new-password');
  expect(screen.getByTestId('actual').textContent).toBe('new-password');
  await userEvent.clear(input);
  expect(input.value).toBe('********');
  expect(screen.getByTestId('actual').textContent).toBe('');
});
it('pastes over the entire saved mask and keeps clearing distinct from deleting stored credentials', async () => {
  const user = userEvent.setup();
  render(<Editor />);
  const input = screen.getByLabelText('密码') as HTMLInputElement;
  await user.click(input);
  await user.keyboard('{Backspace}');
  expect(screen.getByTestId('actual').textContent).toBe('');
  await user.paste(' pasted password ');
  expect(screen.getByTestId('actual').textContent).toBe(' pasted password ');
});
