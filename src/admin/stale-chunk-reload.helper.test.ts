import { describe, expect, it } from 'vitest';

import { shouldShowStaleChunkBanner } from './stale-chunk-reload.helper';

describe('stale chunk reload banner', () => {
  it('shows the banner on the first stale chunk failure', () => {
    expect(shouldShowStaleChunkBanner(false)).toBe(true);
  });

  it('stays silent once the banner is already on screen', () => {
    expect(shouldShowStaleChunkBanner(true)).toBe(false);
  });
});
