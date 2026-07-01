import { describe, expect, it } from 'vitest';
import { L3_COLLAPSED_PREVIEW_MAX, L3_EXPANDED_PREVIEW_MAX, safePreview } from '@/lib/safePreview';

describe('safePreview', () => {
  it('exports L3 preview caps', () => {
    expect(L3_COLLAPSED_PREVIEW_MAX).toBe(240);
    expect(L3_EXPANDED_PREVIEW_MAX).toBe(4096);
  });

  it('truncates beyond max length', () => {
    const long = 'a'.repeat(300);
    const result = safePreview(long, L3_COLLAPSED_PREVIEW_MAX);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(long.length);
  });

  it('expands preview window at L3 expanded cap', () => {
    const medium = 'b'.repeat(500);
    const collapsed = safePreview(medium, L3_COLLAPSED_PREVIEW_MAX);
    const expanded = safePreview(medium, L3_EXPANDED_PREVIEW_MAX);
    expect(collapsed.truncated).toBe(true);
    expect(expanded.truncated).toBe(false);
    expect(expanded.text.length).toBeGreaterThan(collapsed.text.length);
  });
});
