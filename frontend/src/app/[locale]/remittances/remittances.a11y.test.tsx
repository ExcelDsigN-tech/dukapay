/**
 * Accessibility tests for the remittances filter inputs (issue #537).
 *
 * Verifies that every filter label is programmatically associated with its
 * input via htmlFor/id, and that helper-text spans are wired up with
 * aria-describedby.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '../../../test-utils/intl';

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('next/link', () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children);
  MockLink.displayName = 'MockLink';
  return MockLink;
});

jest.mock('../../../hooks/useApi', () => ({
  useRemittancesPage: () => ({ data: null, isLoading: false, isError: false }),
}));

jest.mock('../../../stores/useWalletStore', () => ({
  useWalletStore: (selector: (s: { isConnected: boolean; address: string | null }) => unknown) =>
    selector({ isConnected: true, address: 'GABCD1234' }),
  selectIsWalletConnected: (s: { isConnected: boolean }) => s.isConnected,
  selectWalletAddress: (s: { address: string | null }) => s.address,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

// Lazy import to allow mocks to settle
const getPage = () =>
  import('../page').then((m) => m.default);

const FILTER_LABELS = ['From Date', 'To Date', 'Min Amount', 'Max Amount'] as const;
const FILTER_IDS = [
  'filter-date-from',
  'filter-date-to',
  'filter-min-amount',
  'filter-max-amount',
] as const;

describe('Remittances page — filter input accessibility (#537)', () => {
  let Page: React.ComponentType;

  beforeAll(async () => {
    Page = await getPage();
  });

  beforeEach(() => {
    renderWithIntl(React.createElement(Page));
  });

  it.each(FILTER_LABELS)('label "%s" is rendered', (labelText) => {
    expect(screen.getByText(labelText)).toBeInTheDocument();
  });

  it.each(FILTER_IDS)('input with id="%s" exists', (id) => {
    expect(document.getElementById(id)).not.toBeNull();
  });

  it.each([
    ['From Date', 'filter-date-from'],
    ['To Date', 'filter-date-to'],
    ['Min Amount', 'filter-min-amount'],
    ['Max Amount', 'filter-max-amount'],
  ] as const)('label "%s" is associated with input id="%s"', (labelText, inputId) => {
    const label = screen.getByText(labelText);
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', inputId);

    const input = document.getElementById(inputId);
    expect(input).not.toBeNull();
  });

  it.each(FILTER_IDS)(
    'input "%s" has aria-describedby pointing to an existing element',
    (id) => {
      const input = document.getElementById(id);
      expect(input).not.toBeNull();
      const describedBy = input!.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)).not.toBeNull();
    },
  );
});
