import os from "node:os";

export function getLanUrls(port, networkInterfaces = os.networkInterfaces()) {
  const candidates = [];
  let order = 0;

  for (const entries of Object.values(networkInterfaces || {})) {
    for (const entry of entries || []) {
      const address = String(entry?.address || "");
      if ((entry?.family !== "IPv4" && entry?.family !== 4) || entry?.internal || !isUsableLanIpv4(address)) {
        continue;
      }
      candidates.push({
        url: `http://${address}:${port}`,
        priority: isPrivateIpv4(address) ? 0 : 1,
        order: order++
      });
    }
  }

  const urls = candidates
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .map((candidate) => candidate.url);
  return urls.length ? [...new Set(urls)] : [`http://localhost:${port}`];
}

export function isTailscaleAddress(address) {
  if (!address) return false;
  const raw = String(address).trim();
  const noZone = raw.split("%")[0];
  const clean = noZone.startsWith("::ffff:") ? noZone.slice(7) : noZone;
  const octets = ipv4Octets(clean);
  if (octets) {
    const [first, second] = octets;
    return first === 100 && second >= 64 && second <= 127;
  }
  return /^fd7a:115c:a1e0:/i.test(clean);
}

export function isTailscaleHost(hostHeader, hostname = os.hostname()) {
  if (!hostHeader) return false;
  const rawHost = String(hostHeader).trim();
  let host = rawHost;
  if (host.startsWith("[")) {
    const endBracket = host.indexOf("]");
    if (endBracket !== -1) {
      host = host.slice(1, endBracket);
    }
  } else {
    host = host.split(":")[0];
  }
  const normalized = host.toLowerCase().trim();
  if (!normalized) return false;
  if (normalized.endsWith(".ts.net") || normalized.endsWith(".ts.net.")) return true;
  if (hostname && normalized === String(hostname).toLowerCase().trim()) return true;
  return false;
}

export function isLoopbackOrLocalAddress(address, networkInterfaces = os.networkInterfaces()) {
  if (!address) return false;
  const raw = String(address).trim();
  const noZone = raw.split("%")[0].toLowerCase();
  const clean = noZone.startsWith("::ffff:") ? noZone.slice(7) : noZone;

  if (clean === "127.0.0.1" || clean === "::1" || clean === "localhost") {
    return true;
  }

  const octets = ipv4Octets(clean);
  if (octets && octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) {
    return true;
  }

  for (const entries of Object.values(networkInterfaces || {})) {
    for (const entry of entries || []) {
      const entryAddr = String(entry?.address || "").split("%")[0].toLowerCase();
      const entryClean = entryAddr.startsWith("::ffff:") ? entryAddr.slice(7) : entryAddr;
      if (entryClean && (clean === entryClean || noZone === entryAddr)) {
        return true;
      }
    }
  }

  return false;
}

export function getPrimaryLanUrl(port, networkInterfaces = os.networkInterfaces()) {
  return getLanUrls(port, networkInterfaces)[0];
}

function isUsableLanIpv4(address) {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [first, second] = octets;
  if (first === 0 || first === 127 || first >= 224) return false;
  if (first === 169 && second === 254) return false;
  if (first === 198 && (second === 18 || second === 19)) return false;
  return true;
}

function isPrivateIpv4(address) {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [first, second] = octets;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function ipv4Octets(address) {
  const parts = String(address).split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part, index) => !Number.isInteger(part) || part < 0 || part > 255 || String(part) !== parts[index])) {
    return null;
  }
  return octets;
}
