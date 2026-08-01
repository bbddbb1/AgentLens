import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReplayControls, replayFramePresentation } from '@/components/replay/ReplayControls';

describe('ReplayControls frame bounds', () => {
  it('renders an honest disabled zero-frame state without invalid progress', () => {
    const html = renderToStaticMarkup(createElement(ReplayControls));

    expect(html).toContain('0/0');
    expect(html).not.toContain('NaN');
    expect(html).toMatch(/disabled="" aria-label="Play replay"/);
    expect(html).toContain('aria-label="Replay frame"');
  });

  it('treats one frame as a stable position rather than playable transport', () => {
    expect(replayFramePresentation(1, 0)).toEqual({
      hasFrames: true,
      canPlay: false,
      progress: 0,
      frameLabel: '1/1',
    });
    expect(replayFramePresentation(4, 99)).toEqual({
      hasFrames: true,
      canPlay: true,
      progress: 100,
      frameLabel: '4/4',
    });
  });
});
