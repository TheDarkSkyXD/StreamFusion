import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installElectronAPIMock,
  renderWithProviders,
  screen,
  waitFor,
} from '../../test-utils';

const mocks = vi.hoisted(() => ({
  authState: { twitchUser: { id: '111', login: 'streamer' } as { id: string; login: string } | null },
  getPredictions: vi.fn(),
  getPolls: vi.fn(),
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (s: typeof mocks.authState) => unknown) =>
    selector(mocks.authState),
}));

vi.mock('@/backend/api/platforms/twitch/twitch-helix-predictions', () => ({
  getPredictions: mocks.getPredictions,
}));
vi.mock('@/backend/api/platforms/twitch/twitch-helix-polls', () => ({
  getPolls: mocks.getPolls,
}));

// Mod page index supplies the refresh-counter context. EngagementAggregate
// imports `useModRefreshCounter` from './index' — stub to a constant.
vi.mock('@/pages/Mod/index', () => ({
  useModRefreshCounter: () => 0,
}));

import { EngagementAggregate } from '@/pages/Mod/EngagementAggregate';

describe('EngagementAggregate', () => {
  beforeEach(() => {
    mocks.getPredictions.mockReset();
    mocks.getPolls.mockReset();
    mocks.authState.twitchUser = { id: '111', login: 'streamer' };
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'tok' }));
  });

  it('renders nothing when there is no signed-in Twitch user', () => {
    mocks.authState.twitchUser = null;
    const { container } = renderWithProviders(<EngagementAggregate />);
    expect(container.firstChild).toBeNull();
  });

  it('renders empty state when both predictions and polls are empty', async () => {
    mocks.getPredictions.mockResolvedValue({ ok: true, payload: { data: [] } });
    mocks.getPolls.mockResolvedValue({ ok: true, payload: { data: [] } });
    renderWithProviders(<EngagementAggregate />);
    await waitFor(() => {
      expect(screen.getByTestId('engagement-empty-111')).toBeInTheDocument();
    });
  });

  it('renders prediction + poll when both are active', async () => {
    mocks.getPredictions.mockResolvedValue({
      ok: true,
      payload: {
        data: [
          {
            id: 'p1',
            broadcaster_id: '111',
            title: 'Will we win?',
            winning_outcome_id: null,
            outcomes: [
              { id: 'o1', title: 'Yes', users: 5, channel_points: 100, color: 'BLUE' },
              { id: 'o2', title: 'No', users: 3, channel_points: 50, color: 'PINK' },
            ],
            prediction_window: 120,
            status: 'ACTIVE',
            created_at: '2026-05-18T00:00:00Z',
            ended_at: null,
            locked_at: null,
          },
        ],
      },
    });
    mocks.getPolls.mockResolvedValue({
      ok: true,
      payload: {
        data: [
          {
            id: 'poll1',
            broadcaster_id: '111',
            title: 'Pick one',
            choices: [
              { id: 'c1', title: 'Red', votes: 10, channel_points_votes: 0, bits_votes: 0 },
              { id: 'c2', title: 'Blue', votes: 20, channel_points_votes: 0, bits_votes: 0 },
            ],
            bits_voting_enabled: false,
            bits_per_vote: 0,
            channel_points_voting_enabled: false,
            channel_points_per_vote: 0,
            status: 'ACTIVE',
            duration: 60,
            started_at: '2026-05-18T00:00:00Z',
            ended_at: null,
          },
        ],
      },
    });
    renderWithProviders(<EngagementAggregate />);
    await waitFor(() => {
      expect(screen.getByTestId('engagement-prediction-111')).toBeInTheDocument();
      expect(screen.getByTestId('engagement-poll-111')).toBeInTheDocument();
    });
    expect(screen.getByText('Will we win?')).toBeInTheDocument();
    expect(screen.getByText('Pick one')).toBeInTheDocument();
  });
});
