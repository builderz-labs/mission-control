import { allowsNavigation } from "./origin.mjs";

export function isBackendRequest(url, origin) {
  try {
    const target = new URL(url);
    if (target.protocol === "ws:") target.protocol = "http:";
    if (target.protocol === "wss:") target.protocol = "https:";
    return allowsNavigation(target.href, origin);
  } catch { return false; }
}

function withoutHeader(headers, name) {
  return Object.fromEntries(Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() !== name));
}

// Cookies have no port boundary. Gate ambient cookies independently of gateway traffic.
export function configureRequestCookies(session, origin) {
  const filter = { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] };
  session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    callback({ requestHeaders: isBackendRequest(details.url, origin)
      ? details.requestHeaders : withoutHeader(details.requestHeaders, "cookie") });
  });
  session.webRequest.onHeadersReceived(filter, (details, callback) => {
    callback({ responseHeaders: isBackendRequest(details.url, origin)
      ? details.responseHeaders : withoutHeader(details.responseHeaders, "set-cookie") });
  });
}
