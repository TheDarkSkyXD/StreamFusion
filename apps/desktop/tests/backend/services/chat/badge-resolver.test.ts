import { describe, expect, it } from 'vitest';

import { BadgeResolver } from '@/backend/services/chat/badge-resolver';
import type { ChatBadge } from '@/shared/chat-types';

function makeBadges(): ChatBadge[] {
  return [
    { setId: 'subscriber', version: '6', imageUrl: '', title: '' },
    { setId: 'moderator', version: '1', imageUrl: '', title: '' },
  ];
}

describe('BadgeResolver.resolveBadges', () => {
  it('returns the same array reference for identical inputs', () => {
    const resolver = new BadgeResolver();
    const a = resolver.resolveBadges(makeBadges());
    const b = resolver.resolveBadges(makeBadges());
    expect(b).toBe(a);
  });

  it('returns equivalent values for distinct calls', () => {
    const resolver = new BadgeResolver();
    const a = resolver.resolveBadges(makeBadges());
    const b = resolver.resolveBadges(makeBadges());
    // Same array reference and same per-element identity (since it's literally
    // the same array object).
    expect(a).toBe(b);
    expect(a.length).toBe(2);
  });

  it('returns distinct references when broadcasterId differs', () => {
    const resolver = new BadgeResolver();
    const a = resolver.resolveBadges(makeBadges(), 'channel-1');
    const b = resolver.resolveBadges(makeBadges(), 'channel-2');
    expect(b).not.toBe(a);
  });

  it('returns distinct references when set/version differs', () => {
    const resolver = new BadgeResolver();
    const a = resolver.resolveBadges([
      { setId: 'subscriber', version: '6', imageUrl: '', title: '' },
    ]);
    const b = resolver.resolveBadges([
      { setId: 'subscriber', version: '12', imageUrl: '', title: '' },
    ]);
    expect(b).not.toBe(a);
  });

  it('drops the cache after clearCache()', () => {
    const resolver = new BadgeResolver();
    const a = resolver.resolveBadges(makeBadges());
    resolver.clearCache();
    const b = resolver.resolveBadges(makeBadges());
    expect(b).not.toBe(a);
  });

  it('handles empty badges arrays without caching', () => {
    const resolver = new BadgeResolver();
    const empty: ChatBadge[] = [];
    expect(resolver.resolveBadges(empty)).toBe(empty);
  });
});
