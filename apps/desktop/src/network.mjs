export class NetworkError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Consume bodies inside the timeout window. Never follow even same-origin redirects.
export async function request(url, {
  fetchImpl = fetch, wait = delay, timeoutMs = 3000, attempts = 2,
  consume = async () => null, ...options
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, {
            ...options, redirect: "manual", credentials: "omit", signal: controller.signal,
          });
          if (response.redirected || (response.status >= 300 && response.status < 400)
              || (response.url && response.url !== url)) {
            throw new NetworkError("DESKTOP_REDIRECT_REJECTED");
          }
          if ([408, 500, 502, 503, 504].includes(response.status)) {
            throw new NetworkError("DESKTOP_NETWORK_UNAVAILABLE");
          }
          return await consume(response);
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new NetworkError("DESKTOP_NETWORK_TIMEOUT"));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error?.code === "DESKTOP_REDIRECT_REJECTED") throw error;
      if (attempt + 1 === attempts) throw new NetworkError("DESKTOP_NETWORK_UNAVAILABLE");
    } finally { clearTimeout(timer); controller.abort(); }
    await wait(200);
  }
  throw new NetworkError("DESKTOP_NETWORK_UNAVAILABLE");
}
