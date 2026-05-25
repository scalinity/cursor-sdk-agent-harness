import dns from "node:dns/promises";
import net from "node:net";
import type { DocsRepo } from "../db/repositories/docs.repo.js";

const MAX_CONCURRENT = 2;
const DELAY_MS = 500;
const PAGE_TIMEOUT_MS = 10_000;
const TOTAL_TIMEOUT_MS = 5 * 60_000;
const MAX_REDIRECT_HOPS = 5;

/**
 * SSRF guard: reject IPs in private, loopback, link-local, or
 * carrier-grade-NAT ranges (CWE-918). The crawler fetches arbitrary
 * user-supplied URLs server-side, so without this a base URL of
 * `http://169.254.169.254/...` would reach cloud-metadata services.
 */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    return (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return (
      v === "::1" ||
      v === "::" ||
      v.startsWith("fe80") ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("::ffff:")
    );
  }
  // Unknown address family — fail closed.
  return true;
}

/**
 * Validate a URL is safe to fetch: http(s) only, and its resolved IP is
 * not in a blocked range. Residual TOCTOU exists between this lookup and
 * fetch()'s own resolution; acceptable for a local single-user tool, and
 * paired with manual-redirect re-validation below.
 */
export async function assertPublicUrl(raw: string): Promise<void> {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked protocol: ${u.protocol}`);
  }
  const { address } = await dns.lookup(u.hostname);
  if (isBlockedIp(address)) {
    throw new Error(`Blocked address: ${u.hostname} -> ${address}`);
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) return htmlToText(titleMatch[1]).slice(0, 200);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) return htmlToText(h1Match[1]).slice(0, 200);
  return "Untitled";
}

export function extractLinks(html: string, baseUrl: URL): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const re = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      const url = new URL(match[1]!, baseUrl);
      url.hash = "";
      if (url.origin !== baseUrl.origin) continue;
      const normalized = url.href;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push(normalized);
    } catch {
      // invalid URL
    }
  }
  return links;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; text: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Follow redirects manually so each hop's destination is re-validated
    // against the SSRF guard — `redirect: "follow"` would let an allowlisted
    // public host 302 to 169.254.169.254 unchecked.
    let currentUrl = url;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      await assertPublicUrl(currentUrl);
      const resp = await fetch(currentUrl, {
        signal: controller.signal,
        headers: { "User-Agent": "CursorHarness-DocsCrawler/1.0" },
        redirect: "manual",
      });
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get("location");
        if (!location) {
          return { ok: false, text: "", status: resp.status };
        }
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }
      const text = await resp.text();
      return { ok: resp.ok, text, status: resp.status };
    }
    // Too many redirects.
    return { ok: false, text: "", status: 310 };
  } finally {
    clearTimeout(timer);
  }
}

async function isAllowedByRobots(url: URL): Promise<boolean> {
  try {
    const robotsUrl = `${url.origin}/robots.txt`;
    const resp = await fetchWithTimeout(robotsUrl, 5000);
    if (!resp.ok) return true;
    const lines = resp.text.split("\n");
    let inUserAgent = false;
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith("user-agent:")) {
        const agent = trimmed.slice("user-agent:".length).trim();
        inUserAgent = agent === "*" || agent === "cursorharness-docscrawler";
      } else if (inUserAgent && trimmed.startsWith("disallow:")) {
        const path = trimmed.slice("disallow:".length).trim();
        if (path && url.pathname.startsWith(path)) return false;
      }
    }
    return true;
  } catch {
    return true;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function crawlDocumentation(
  sourceId: string,
  baseUrl: string,
  maxPages: number,
  docsRepo: DocsRepo,
): Promise<void> {
  docsRepo.updateSourceStatus(sourceId, "crawling");

  const startUrl = new URL(baseUrl);
  const queue: string[] = [startUrl.href];
  const visited = new Set<string>();
  let pageCount = 0;
  const startTime = Date.now();

  try {
    while (queue.length > 0 && pageCount < maxPages) {
      if (Date.now() - startTime > TOTAL_TIMEOUT_MS) break;

      // Clamp the batch to the remaining page budget. Without this, a final
      // batch of MAX_CONCURRENT could each insert a page when only one slot
      // remained, overshooting maxPages by up to MAX_CONCURRENT - 1.
      const remaining = maxPages - pageCount;
      const batch = queue.splice(0, Math.min(MAX_CONCURRENT, remaining));
      const promises = batch.map(async (url) => {
        if (visited.has(url)) return;
        visited.add(url);

        const parsedUrl = new URL(url);
        const allowed = await isAllowedByRobots(parsedUrl);
        if (!allowed) return;

        try {
          const resp = await fetchWithTimeout(url, PAGE_TIMEOUT_MS);
          if (!resp.ok) return;
          if (!resp.text.includes("<")) return;

          const title = extractTitle(resp.text);
          const content = htmlToText(resp.text);
          if (content.length < 50) return;

          const pageId = crypto.randomUUID();
          docsRepo.insertPage(pageId, sourceId, url, title, content);
          pageCount++;
          docsRepo.updateSourcePageCount(sourceId, pageCount);

          const links = extractLinks(resp.text, parsedUrl);
          for (const link of links) {
            if (!visited.has(link) && !queue.includes(link)) {
              queue.push(link);
            }
          }
        } catch {
          // skip failed pages
        }
      });

      await Promise.all(promises);
      if (queue.length > 0) await delay(DELAY_MS);
    }

    docsRepo.updateSourceStatus(sourceId, "indexed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    docsRepo.updateSourceStatus(sourceId, "error", msg);
  }
}
