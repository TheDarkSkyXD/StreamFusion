import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type React from 'react';
import { vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

// Quiet QueryClient: no retries, no refetches — keeps tests deterministic and fast.
function makeQueryClient() {
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

function TestProviders({ children, queryClient }: ProvidersProps) {
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
  overrides: {
    params?: Record<string, string>;
    search?: Record<string, unknown>;
    pathname?: string;
  } = {}
) {
  const pathname = overrides.pathname ?? '/';
  const navigate = vi.fn();
  const back = vi.fn();
  const router = { navigate, history: { back } };
  return {
    Link: ({
      to,
      params,
      search,
      children,
      className,
      onClick,
      ...rest
    }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
      to?: string;
      params?: Record<string, unknown>;
      search?: Record<string, unknown>;
    }) => (
      // biome-ignore lint/a11y/useValidAnchor: stub for tests, not real navigation.
      <a
        href={typeof to === 'string' ? to : '#'}
        data-to={typeof to === 'string' ? to : ''}
        data-params={params ? JSON.stringify(params) : undefined}
        data-search={search ? JSON.stringify(search) : undefined}
        className={className}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          navigate({ to, params, search });
        }}
        {...rest}
      >
        {children}
      </a>
    ),
    useNavigate: () => navigate,
    useLocation: () => ({ pathname }),
    useParams: () => overrides.params ?? {},
    useSearch: () => overrides.search ?? {},
    useRouter: () => router,
    useRouterState: () => ({ location: { pathname } }),
    Outlet: () => null,
  };
}

// Stock electronAPI mock. Unspecified namespace methods return
// Promise<{ data: [], error: null }>; contract-specific boundaries are defined below.
// Override per test:
//   const api = installElectronAPIMock();
//   api.streams.getTop = vi.fn(async () => ({ data: [mockStream], error: null }));
/** Dynamic test-double surface: individual tests refine only the methods they exercise. */
type ElectronAPIMock = Window['electronAPI'] & Record<string, unknown>;

export function installElectronAPIMock(): ElectronAPIMock {
  const ok = <T,>(data: T) => ({ data, error: null });
  const namespaces: Record<string, Record<string, unknown>> = {};
  const stub = new Proxy<Record<string, unknown>>(
    {},
    {
      get(_target, prop: string) {
        if (!(prop in namespaces)) {
          namespaces[prop] = new Proxy(
            {},
            {
              get(target: Record<string, unknown>, _fn: string) {
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

  namespaces.connectivity = {
    check: vi.fn(async () => ({ reachable: true, latencyMs: 25 })),
  };

  namespaces.twitch = {
    execute: vi.fn(async (command: { operation?: string }) => {
      if (command.operation === 'get-moderated-channels') return { ok: true, data: [] };
      if (command.operation === 'resolve-channel') return { ok: true, data: null };
      if (command.operation === 'get-chat-settings') return { ok: true, data: null };
      if (command.operation?.includes('emote') || command.operation === 'get-users') {
        return { ok: true, data: { data: [], pagination: {} } };
      }
      if (command.operation === 'get-polls' || command.operation === 'get-predictions') {
        return { ok: true, data: { data: [] } };
      }
      return { ok: true, data: undefined };
    }),
    eventSub: {
      start: vi.fn(async () => ({ ok: true, data: undefined })),
      stop: vi.fn(async () => true),
      onEvent: vi.fn(() => () => undefined),
      onState: vi.fn(() => () => undefined),
    },
  };

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: stub,
  });
  (globalThis as { electronAPI?: unknown }).electronAPI = stub;

  // The proxy creates every Electron namespace lazily; tests override concrete
  // methods through the production Window contract.
  return stub as ElectronAPIMock;
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

export { screen, fireEvent, waitFor } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
