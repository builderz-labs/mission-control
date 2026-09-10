export function isLoginPage(target, origin) {
  try {
    const url = new URL(target);
    return url.origin === origin && url.pathname === "/login";
  } catch { return false; }
}
