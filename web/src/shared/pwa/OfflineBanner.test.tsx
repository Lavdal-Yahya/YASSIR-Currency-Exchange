import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner } from './OfflineBanner';

const originalDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

beforeEach(() => {
  setOnLine(true);
});

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(navigator, 'onLine', originalDescriptor);
  }
  vi.restoreAllMocks();
});

describe('OfflineBanner', () => {
  it('renders nothing when online', () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('appears when the browser fires "offline"', () => {
    render(<OfflineBanner />);
    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('disappears when the browser fires "online" again', () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toBeTruthy();

    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
