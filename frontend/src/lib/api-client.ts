/** Browser-side helper: unwraps the API's error envelope into a thrown Error. */
export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.error?.details?.[0]?.message ??
      payload?.error?.message ??
      'Something went wrong. Please try again.';
    throw new Error(message);
  }

  return payload as T;
}
