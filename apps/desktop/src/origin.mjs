export const DEFAULT_ORIGIN = "http://127.0.0.1:3000";
const BLOCKED_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6697, 10080]);

export function validateOrigin(value = DEFAULT_ORIGIN) {
  const fail = () => { throw new Error("DESKTOP_ORIGIN_INVALID"); };
  if (typeof value !== "string" || !/^http:\/\/[^/?#\\\s@%]+\/?$/.test(value)) fail();
  let url;
  try { url = new URL(value); } catch { fail(); }
  const host = url.hostname;
  const ipv4 = /^127(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host)
    && host.split(".").every((part) => Number(part) <= 255);
  const authority = value.slice(7).replace(/\/$/, "");
  // Require literal, canonical host spelling: reject URL-parser numeric aliases.
  if (!authority.startsWith(`${host}:`)) fail();
  if (!(ipv4 || host === "localhost" || host === "[::1]")) fail();
  const port = Number(url.port);
  if (!/^\d+$/.test(authority.slice(host.length + 1))
      || port < 1024 || port > 65535 || BLOCKED_PORTS.has(port)) fail();
  return url.origin;
}

export function allowsNavigation(target, origin) {
  try {
    const url = new URL(target);
    return url.origin === validateOrigin(origin) && !url.username && !url.password;
  } catch { return false; }
}
