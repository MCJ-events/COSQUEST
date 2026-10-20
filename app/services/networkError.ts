// What people see when the chat backend can't be reached at all.
//
// fetch() rejects with the platform's own words when there is no answer:
// "fetch failed: java.net.ConnectException: Failed to connect to
// localhost/127.0.0.1:4120", "java.io.IOException: unexpected end of stream",
// "Network request failed". Sign-in and other screens showed that text as is.
// apiRequest turns it into a plain sentence, and retries a GET once (a pooled
// connection the server already closed fails like this the first time).

export const OFFLINE_MESSAGE = "Can't reach CosQuest right now. Check your connection and try again.";

/** True for errors fetch() throws when no HTTP answer came back. */
export function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  return (
    error instanceof TypeError ||
    /fetch failed|network request failed|failed to connect|connectexception|unexpected end of stream|socket|timeout|unable to resolve host|ECONN|ENOTFOUND/i.test(
      error.message,
    )
  );
}

/** Only requests that change nothing are retried without asking. */
export function canRetrySilently(method: string): boolean {
  return method === "GET";
}
