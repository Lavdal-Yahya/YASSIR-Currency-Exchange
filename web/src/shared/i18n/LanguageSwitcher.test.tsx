import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { i18n, setLanguage } from './i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

afterEach(() => {
  // Reset for the next test so parity/order doesn't leak.
  setLanguage('fr');
});

describe('LanguageSwitcher', () => {
  it('flips <html dir> to rtl when Arabic is chosen', async () => {
    render(<LanguageSwitcher />);
    await act(async () => {
      setLanguage('ar');
    });
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });

  it('marks the active language with aria-pressed', async () => {
    render(<LanguageSwitcher />);
    await act(async () => {
      setLanguage('fr');
    });
    const frBtn = screen.getByRole('button', { name: /Français/i });
    const arBtn = screen.getByRole('button', { name: /العربية/ });
    expect(frBtn.getAttribute('aria-pressed')).toBe('true');
    expect(arBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('persists the choice to localStorage', async () => {
    render(<LanguageSwitcher />);
    await act(async () => {
      setLanguage('ar');
    });
    expect(localStorage.getItem('ce.lang')).toBe('ar');
    // i18n instance reports the same
    expect(i18n.language).toBe('ar');
  });
});
