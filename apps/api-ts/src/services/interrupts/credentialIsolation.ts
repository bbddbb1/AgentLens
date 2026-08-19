const EXECUTABLE_CREDENTIAL_KEY = /(?:^|[._-])(resume[._-]?token|control[._-]?(?:ref|reference)|bridge[._-]?control[._-]?ref)(?:$|[._-])/i;

export function isExecutableCredentialKey(key: string): boolean {
  return EXECUTABLE_CREDENTIAL_KEY.test(key);
}

/** Remove executable control material before it reaches recorded evidence. */
export function stripExecutableCredentials<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripExecutableCredentials(entry)) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isExecutableCredentialKey(key)) continue;
    sanitized[key] = stripExecutableCredentials(entry);
  }
  return sanitized as T;
}
