import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type React from 'react';
import { vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

// Quiet QueryClient: no retries, no refetches — keeps tests deterministic and fast.
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface ProvidersProps {
  children: React.ReactNode;
  queryClient?: QueryClient;
}

export function TestProviders({ children, queryClient }: ProvidersProps) {
  const client = queryClient ?? makeQueryClient();
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient }
) {
  const { queryClient, ...rest } = options ?? {};
  return render(ui, {
    wrapper: ({ children }) => (
      <TestProviders queryClient={queryClient}>{children}</TestProviders>
    ),
    ...rest,
  });
}

// Router mock factory. Use it like:
//   vi.mock('@tanstack/react-router', () => routerMock());
// or with overrides for useParams/useSearch:
//   vi.mock('@tanstack/react-router', () => routerMock({ params: { foo: 'bar' } }));
export function routerMock(
  overrides: { params?: Record<string, string>; search?: Record<string, unknown> } = {}
) {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: test shim.
    Link: ({ to, params, search, children, className, onClick, ...rest }: any) => (
      // biome-ignore lint/a11y/useValidAnchor: stub for tests, not real navigation.
      <a
        href={typeof to === 'string' ? to : '#'}
        data-to={typeof to === 'string' ? to : ''}
        data-params={params ? JSON.stringify(params) : undefined}
        data-search={search ? JSON.stringify(search) : undefined}
        className={className}
        onClick={onClick}
        {...rest}
      >
        {children}
      </a>
    ),
    useNavigate: () => vi.fn(),
    useParams: () => overrides.params ?? {},
    useSearch: () => overrides.search ?? {},
    useRouter: () => ({ navigate: vi.fn(), history: { back: vi.fn() } }),
    useRouterState: () => ({ location: { pathname: '/' } }),
    Outlet: () => null,
  };
}

// Stock electronAPI mock. Every namespace.fn returns Promise<{ data: [], error: null }>.
// Override per test:
//   const api = installElectronAPIMock();
//   api.streams.getTop = vi.fn(async () => ({ data: [mockStream], error: null }));
// biome-ignore lint/suspicious/noExplicitAny: test fixture for arbitrary IPC surface.
export function installElectronAPIMock(): any {
  const ok = <T,>(data: T) => ({ data, error: null });
  // biome-ignore lint/suspicious/noExplicitAny: dynamic surface.
  const namespaces: Record<string, any> = {};
  // biome-ignore lint/suspicious/noExplicitAny: dynamic proxy.
  const stub: any = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (!(prop in namespaces)) {
          namespaces[prop] = new Proxy(
            {},
            {
              // biome-ignore lint/suspicious/noExplicitAny: vi.fn loose typing.
              get(target: any, _fn: string) {
                if (_fn in target) return target[_fn];
                const fn = vi.fn(async () => ok([]));
                target[_fn] = fn;
                return fn;
              },
              set(target, fn: string, value) {
                target[fn] = value;
                return true;
              },
            }
          );
        }
        return namespaces[prop];
      },
      set(_target, prop: string, value) {
        namespaces[prop] = value;
        return true;
      },
    }
  );

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: stub,
  });
  // biome-ignore lint/suspicious/noExplicitAny: cross-realm assignment.
  (globalThis as any).electronAPI = stub;

  return stub;
}

// Minimal fixtures for common payloads.
export const fixtures = {
  stream(overrides: Partial<import('@/backend/api/unified/platform-types').UnifiedStream> = {}) {
    return {
      id: 'stream-1',
      platform: 'twitch' as const,
      channelId: 'chan-1',
      channelName: 'testchannel',
      channelDisplayName: 'TestChannel',
      channelAvatar: 'https://example.com/avatar.png',
      title: 'Test stream title',
      viewerCount: 1234,
      thumbnailUrl: 'https://example.com/thumb.jpg',
      isLive: true,
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      language: 'en',
      tags: ['english'],
      isMature: false,
      categoryId: 'cat-1',
      categoryName: 'Just Chatting',
      ...overrides,
    };
  },
  channel(
    overrides: Partial<import('@/backend/api/unified/platform-types').UnifiedChannel> = {}
  ) {
    return {
      id: 'chan-1',
      platform: 'twitch' as const,
      username: 'testchannel',
      displayName: 'TestChannel',
      avatarUrl: 'https://example.com/avatar.png',
      isLive: false,
      isVerified: false,
      isPartner: false,
      ...overrides,
    };
  },
  category(
    overrides: Partial<import('@/backend/api/unified/platform-types').UnifiedCategory> = {}
  ) {
    return {
      id: 'cat-1',
      platform: 'twitch' as const,
      name: 'Just Chatting',
      boxArtUrl: 'https://example.com/box.jpg',
      viewerCount: 100_000,
      slug: 'just-chatting',
      ...overrides,
    };
  },
};

export { screen, fireEvent, waitFor, act } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
