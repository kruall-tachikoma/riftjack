// Use an abortable request for ephemeral typing state instead of the SDK's
// 60-second request timeout. The caller serializes updates and owns the deadline.
export function matrixTyping(options: { homeserver: string; userId: string; accessToken: string }, fetcher: typeof fetch = fetch) {
  return async (room: string, typing: boolean, timeout: number, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    const path = '/_matrix/client/v3/rooms/' + encodeURIComponent(room) + '/typing/' + encodeURIComponent(options.userId);
    const response = await fetcher(options.homeserver.replace(/\/$/, '') + path, {
      method: 'PUT', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${options.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ typing, timeout }),
    });
    try {
      if (!response.ok) throw Object.assign(new Error('Matrix typing update failed'), { status: response.status });
    } finally { await response.body?.cancel(); }
  };
}
