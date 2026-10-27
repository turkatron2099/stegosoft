#!/usr/bin/env node
// Builds threats.json, the snapshot the Threat Map page animates. Run every 2
// hours by .github/workflows/threat-map.yml, or manually to refresh locally.
//
// Sources:
//   - SANS ISC / DShield (no key): the IPs reported attacking the most
//     DShield sensors today, and the most-targeted ports.
//   - DB-IP IP to City Lite (CC BY 4.0, no key): turns those IPs into map
//     coordinates. It's a ~85 MB monthly download, so it's kept in
//     scripts/.cache/ (and in the Actions cache between runs).
//   - abuse.ch Feodo Tracker (no key): known botnet command-and-control
//     servers, which already come with a country.
//   - Cloudflare Radar (optional, free token in CLOUDFLARE_RADAR_TOKEN):
//     the top origin → target country pairs for layer 3 (network DDoS)
//     and layer 7 (application/HTTP) attacks. These become the map's
//     arcs; without a token the page just shows attack sources.

import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir, rename, unlink } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE_DIR = fileURLToPath(new URL(".cache/", import.meta.url));
const OUT = ROOT + "threats.json";
// DShield asks API users to identify themselves with a contact URL.
const USER_AGENT = "thagobyte-threatmap/1.0 (+https://thagobyte.com)";
const SOURCE_LIMIT = 300;
const PORT_LIMIT = 10;
const RADAR_LIMIT = 40;

// Names for the ports that usually show up in DShield's top 10; anything
// else is just shown as a number.
const PORT_NAMES = {
  21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS", 80: "HTTP",
  81: "HTTP alt", 110: "POP3", 123: "NTP", 135: "MS RPC", 139: "NetBIOS",
  143: "IMAP", 443: "HTTPS", 445: "SMB", 1433: "MS SQL", 1723: "PPTP",
  2222: "SSH alt", 2323: "Telnet alt", 3306: "MySQL", 3389: "RDP",
  5060: "SIP", 5432: "PostgreSQL", 5555: "Android ADB", 5900: "VNC",
  6379: "Redis", 7547: "TR-069", 8000: "HTTP alt", 8080: "HTTP proxy",
  8088: "HTTP alt", 8443: "HTTPS alt", 8888: "HTTP alt", 9200: "Elasticsearch",
  27017: "MongoDB",
};

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

function ipToInt(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !(p >= 0 && p <= 255))) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

async function fetchDshieldSources() {
  const rows = await getJson(`https://isc.sans.edu/api/sources/attacks/${SOURCE_LIMIT}?json`);
  return rows
    .filter((r) => r && r.ip && ipToInt(r.ip) !== null)
    .map((r) => ({ ip: r.ip, targets: Number(r.attacks) || 0, reports: Number(r.count) || 0 }));
}

async function fetchDshieldPorts() {
  const data = await getJson(`https://isc.sans.edu/api/topports/records/${PORT_LIMIT}?json`);
  return Object.values(data)
    .filter((r) => r && r.targetport != null)
    .sort((a, b) => a.rank - b.rank)
    .map((r) => ({
      port: Number(r.targetport),
      name: PORT_NAMES[r.targetport] || null,
      records: Number(r.records) || 0,
      sources: Number(r.sources) || 0,
    }));
}

async function fetchFeodo() {
  const rows = await getJson("https://feodotracker.abuse.ch/downloads/ipblocklist.json");
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  return rows
    .filter((r) => r.country && (r.status === "online" || Date.parse(r.last_online) >= cutoff))
    .map((r) => ({
      ip: r.ip_address,
      port: r.port,
      malware: r.malware,
      country: r.country,
      online: r.status === "online",
      lastOnline: r.last_online,
    }));
}

async function fetchRadarPairs(layer, token) {
  const params = new URLSearchParams({ dateRange: "1d", limit: String(RADAR_LIMIT), format: "JSON" });
  const data = await getJson(`https://api.cloudflare.com/client/v4/radar/attacks/${layer}/top/attacks?${params}`, {
    Authorization: `Bearer ${token}`,
  });
  return (data.result?.top_0 || [])
    .filter((r) => r.originCountryAlpha2 && r.targetCountryAlpha2)
    .map((r) => ({
      from: r.originCountryAlpha2,
      to: r.targetCountryAlpha2,
      share: Number(r.value) || 0,
      layer: layer === "layer3" ? "L3" : "L7",
    }));
}

// Downloads this month's DB-IP City Lite CSV (falling back to last month's
// in the first days of a month, before the new one is published) unless
// it's already cached, and deletes older copies.
async function ensureGeoDb() {
  await mkdir(CACHE_DIR, { recursive: true });
  const now = new Date();
  const months = [0, 1].map((back) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return d.toISOString().slice(0, 7);
  });
  for (const month of months) {
    const file = `${CACHE_DIR}dbip-city-lite-${month}.csv.gz`;
    if (existsSync(file)) return file;
  }
  for (const month of months) {
    const file = `${CACHE_DIR}dbip-city-lite-${month}.csv.gz`;
    const res = await fetch(`https://download.db-ip.com/free/dbip-city-lite-${month}.csv.gz`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) continue;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file + ".part"));
    await rename(file + ".part", file);
    for (const old of await readdir(CACHE_DIR)) {
      if (old.startsWith("dbip-city-lite-") && CACHE_DIR + old !== file) await unlink(CACHE_DIR + old);
    }
    return file;
  }
  throw new Error("Couldn't download the DB-IP City Lite database");
}

// The CSV is sorted by range start, so instead of loading ~3 million ranges
// into memory, sort the handful of IPs we care about and walk both lists
// together in one streaming pass.
async function geolocate(ips, dbFile) {
  const wanted = [...new Set(ips)]
    .map((ip) => ({ ip, n: ipToInt(ip) }))
    .filter((x) => x.n !== null)
    .sort((a, b) => a.n - b.n);
  const found = new Map();
  let i = 0;
  const lines = createInterface({ input: createReadStream(dbFile).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (i >= wanted.length) break;
    const c1 = line.indexOf(",");
    const c2 = line.indexOf(",", c1 + 1);
    const start = line.slice(0, c1);
    if (start.includes(":")) continue; // IPv6 ranges come after all the IPv4 ones
    const lo = ipToInt(start);
    const hi = ipToInt(line.slice(c1 + 1, c2));
    if (lo === null || hi === null) continue;
    while (i < wanted.length && wanted[i].n < lo) i++;
    if (i >= wanted.length || wanted[i].n > hi) continue;
    // Region/city names can be quoted and contain commas, but the country
    // is always field 4 and lat/lon are always the last two fields.
    const country = line.split(",", 4)[3];
    const lonAt = line.lastIndexOf(",");
    const latAt = line.lastIndexOf(",", lonAt - 1);
    const lat = Number(line.slice(latAt + 1, lonAt));
    const lon = Number(line.slice(lonAt + 1));
    while (i < wanted.length && wanted[i].n <= hi) {
      if (country !== "ZZ") found.set(wanted[i].ip, { country, lat, lon });
      i++;
    }
  }
  lines.close();
  return found;
}

async function settle(label, promise) {
  try {
    return await promise;
  } catch (err) {
    console.warn(`${label} failed: ${err.message}`);
    return null;
  }
}

async function main() {
  const token = process.env.CLOUDFLARE_RADAR_TOKEN || "";
  const [sources, ports, c2, l3, l7] = await Promise.all([
    settle("DShield sources", fetchDshieldSources()),
    settle("DShield ports", fetchDshieldPorts()),
    settle("Feodo Tracker", fetchFeodo()),
    token ? settle("Radar layer 3", fetchRadarPairs("layer3", token)) : null,
    token ? settle("Radar layer 7", fetchRadarPairs("layer7", token)) : null,
  ]);
  if (!token) console.warn("CLOUDFLARE_RADAR_TOKEN not set, so no attack arcs this run");

  // If everything failed, keep the last good snapshot rather than
  // replacing it with an empty map.
  if (!sources && !l3 && !l7) throw new Error("No threat data could be fetched");

  let geo = new Map();
  if (sources?.length) geo = await geolocate(sources.map((s) => s.ip), await ensureGeoDb());

  const centroids = JSON.parse(await readFile(new URL("country-centroids.json", import.meta.url), "utf8"));
  const placedSources = (sources || [])
    .filter((s) => geo.has(s.ip))
    .map((s) => ({ ...s, ...geo.get(s.ip) }));
  const arcs = [...(l3 || []), ...(l7 || [])].filter((a) => centroids[a.from] && centroids[a.to]);
  const usedCountries = new Set([
    ...arcs.flatMap((a) => [a.from, a.to]),
    ...(c2 || []).map((c) => c.country),
  ]);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    sources: placedSources,
    ports: ports || [],
    c2: (c2 || []).filter((c) => centroids[c.country]),
    arcs,
    // Only the centroids the page actually needs, to keep the file small.
    countries: Object.fromEntries([...usedCountries].filter((c) => centroids[c]).map((c) => [c, centroids[c]])),
  };
  await writeFile(OUT, JSON.stringify(snapshot) + "\n");
  console.log(
    `threats.json: ${placedSources.length}/${sources?.length ?? 0} sources placed, ` +
      `${snapshot.ports.length} ports, ${snapshot.c2.length} C2 servers, ${arcs.length} arcs`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
