export function authenticatedUrl(input, token, base = globalThis.location?.origin || "http://localhost") {
  const url = new URL(input, base);
  const normalizedToken = String(token || "").trim();
  if (normalizedToken) url.searchParams.set("token", normalizedToken);
  return url.origin === new URL(base).origin
    ? `${url.pathname}${url.search}${url.hash}`
    : url.toString();
}

export function webSocketUrl(locationLike, token) {
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${locationLike.host}/ws`);
  const normalizedToken = String(token || "").trim();
  if (normalizedToken) url.searchParams.set("token", normalizedToken);
  return url.toString();
}

export function authenticationAccepted(info) {
  return Boolean(info?.authenticated && ["token", "cloudflare-access"].includes(info?.authMode));
}
