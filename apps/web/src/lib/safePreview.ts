export interface SafePreviewResult {
  text: string;
  truncated: boolean;
}

/** Max preview length for normalized I/O in the selected-activity summary row. */
export const SUMMARY_IO_PREVIEW_MAX = 120;

/** Max safe preview at L3 when JsonBlock is expanded (rops.md §7.4). */
export const L3_EXPANDED_PREVIEW_MAX = 4096;

export const L3_COLLAPSED_PREVIEW_MAX = 240;

export function safePreview(value: unknown, maxLength = 200): SafePreviewResult {
  if (value === undefined || value === null) {
    return { text: '—', truncated: false };
  }

  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }

  if (text.length <= maxLength) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, maxLength)}…`,
    truncated: true,
  };
}
