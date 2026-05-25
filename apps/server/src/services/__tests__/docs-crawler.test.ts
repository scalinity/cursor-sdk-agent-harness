import { describe, expect, it } from "vitest";
import {
  htmlToText,
  extractTitle,
  extractLinks,
  isBlockedIp,
  isPathAllowedByRobotsTxt,
} from "../docs-crawler.service.js";

describe("htmlToText", () => {
  it("strips script tags and their content", () => {
    const html = '<p>Hello</p><script>alert("bad")</script><p>World</p>';
    expect(htmlToText(html)).toBe("Hello World");
  });

  it("strips style tags", () => {
    const html = "<style>body { color: red; }</style><p>Content</p>";
    expect(htmlToText(html)).toBe("Content");
  });

  it("strips nav, header, footer", () => {
    const html =
      "<nav>nav</nav><header>header</header><main>Main Content</main><footer>footer</footer>";
    expect(htmlToText(html)).toBe("Main Content");
  });

  it("collapses whitespace", () => {
    const html = "<p>  Hello    World  </p>";
    expect(htmlToText(html)).toBe("Hello World");
  });

  it("decodes HTML entities", () => {
    const html = "<p>A &amp; B &lt; C &gt; D &quot;E&quot; F&#39;s</p>";
    expect(htmlToText(html)).toBe('A & B < C > D "E" F\'s');
  });

  it("does not double-decode &amp;lt;", () => {
    // A doc showing the escaped sequence &lt; encodes it as &amp;lt;.
    const html = "<p>Write &amp;lt; for a less-than sign</p>";
    expect(htmlToText(html)).toBe("Write &lt; for a less-than sign");
  });
});

describe("extractTitle", () => {
  it("extracts title from <title> tag", () => {
    const html = "<html><head><title>My Page</title></head></html>";
    expect(extractTitle(html)).toBe("My Page");
  });

  it("falls back to <h1>", () => {
    const html = "<html><body><h1>Main Heading</h1></body></html>";
    expect(extractTitle(html)).toBe("Main Heading");
  });

  it("returns 'Untitled' when no title found", () => {
    const html = "<html><body><p>Just text</p></body></html>";
    expect(extractTitle(html)).toBe("Untitled");
  });
});

describe("extractLinks", () => {
  it("extracts same-origin links", () => {
    const base = new URL("https://example.com/docs/");
    const html = '<a href="/page1">P1</a><a href="https://example.com/page2">P2</a>';
    const links = extractLinks(html, base);
    expect(links).toContain("https://example.com/page1");
    expect(links).toContain("https://example.com/page2");
  });

  it("skips cross-origin links", () => {
    const base = new URL("https://example.com/");
    const html = '<a href="https://other.com/page">External</a>';
    const links = extractLinks(html, base);
    expect(links).toHaveLength(0);
  });

  it("deduplicates links", () => {
    const base = new URL("https://example.com/");
    const html = '<a href="/page">A</a><a href="/page">B</a>';
    const links = extractLinks(html, base);
    expect(links).toHaveLength(1);
  });

  it("strips hash fragments", () => {
    const base = new URL("https://example.com/");
    const html = '<a href="/page#section1">A</a><a href="/page#section2">B</a>';
    const links = extractLinks(html, base);
    expect(links).toHaveLength(1);
    expect(links[0]).toBe("https://example.com/page");
  });
});

describe("isBlockedIp (SSRF guard)", () => {
  it("blocks loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
  });

  it("blocks cloud-metadata link-local", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });

  it("blocks RFC1918 private ranges", () => {
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  it("blocks carrier-grade NAT and IPv6 ULA/link-local", () => {
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isBlockedIp("93.184.216.34")).toBe(false); // example.com
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });

  it("fails closed on unparseable input", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
  });

  it("does not misclassify 172.x outside the private block", () => {
    expect(isBlockedIp("172.15.0.1")).toBe(false);
    expect(isBlockedIp("172.32.0.1")).toBe(false);
  });
});

describe("isPathAllowedByRobotsTxt", () => {
  it("disallows a path under a matching * group", () => {
    const robots = "User-agent: *\nDisallow: /private";
    expect(isPathAllowedByRobotsTxt(robots, "/private/secret")).toBe(false);
  });

  it("allows a path not covered by any disallow", () => {
    const robots = "User-agent: *\nDisallow: /private";
    expect(isPathAllowedByRobotsTxt(robots, "/public/page")).toBe(true);
  });

  it("ignores disallow rules under a non-matching user-agent", () => {
    const robots = "User-agent: Googlebot\nDisallow: /private";
    expect(isPathAllowedByRobotsTxt(robots, "/private/x")).toBe(true);
  });

  it("honors a rule targeting our crawler by name", () => {
    const robots = "User-agent: CursorHarness-DocsCrawler\nDisallow: /docs";
    expect(isPathAllowedByRobotsTxt(robots, "/docs/guide")).toBe(false);
  });

  it("treats an empty disallow as allow-all", () => {
    const robots = "User-agent: *\nDisallow:";
    expect(isPathAllowedByRobotsTxt(robots, "/anything")).toBe(true);
  });
});
