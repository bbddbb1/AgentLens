export interface SafePreviewResult {
  text: string;
  truncated: boolean;
}

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
