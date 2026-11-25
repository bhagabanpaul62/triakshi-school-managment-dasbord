import { describe, expect, it } from "vitest";
import { markdownToHtml, markdownToText, parseMarkdown } from "./markdown";

describe("markdown", () => {
  it("parses blocks and inline marks", () => {
    const b = parseMarkdown("## Trip\n\nBring **water** and *lunch*.\n\n- one\n- two\n\n1. a\n2. b");
    expect(b.map((x) => x.t)).toEqual(["h", "p", "ul", "ol"]);
    expect(markdownToText("## Trip\n\nBring **water** and *lunch*.\n\n- one\n- two\n\n1. a\n2. b")).toBe("Trip\n\nBring water and lunch.\n\n- one\n- two\n\n1. a\n2. b");
  });
  it("keeps only safe link schemes", () => {
    expect(markdownToHtml("[x](javascript:alert(1))")).not.toContain("<a");
    expect(markdownToHtml("[x](data:text/html,hi)")).not.toContain("<a");
    expect(markdownToHtml("[x](  JavaScript:alert(1))")).not.toContain("<a");
    expect(markdownToHtml("[call](tel:+911234567890) [mail](mailto:a@b.in) [site](https://a.in/x?y=1&z=2)")).toContain('href="https://a.in/x?y=1&amp;z=2"');
  });
  it("linkifies bare urls and strips trailing punctuation", () => {
    expect(markdownToHtml("See https://school.in/fees.")).toBe('<p>See <a href="https://school.in/fees" rel="noopener noreferrer">https://school.in/fees</a>.</p>');
  });
  it("never lets html through", () => {
    const h = markdownToHtml('<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>** [a"onmouseover="x](https://a.in/"onclick="y)');
    expect(h).not.toMatch(/<script|<img|<b>/);
    expect(h).not.toMatch(/ on\w+="/);
    expect(h).toContain("&lt;script&gt;");
  });
  it("treats unmatched and nested markers as text", () => {
    expect(markdownToText("**open and *half")).toBe("**open and *half");
    expect(markdownToText("**bold *and italic* inside**")).toBe("bold and italic inside");
    expect(markdownToText("[a](https://x.in) [broken](nothing) [no close")).toBe("a (https://x.in) [broken](nothing) [no close");
  });
  it("is fast on hostile 20k input", () => {
    for (const bad of ["*".repeat(20000), "**a ".repeat(5000), "[".repeat(20000), "[a](".repeat(5000), "**".repeat(10000), "*a *".repeat(5000), "> ".repeat(10000)]) {
      const t = performance.now();
      markdownToHtml(bad);
      expect(performance.now() - t).toBeLessThan(250);
    }
  });
  it("handles Hindi and truncates by character", () => {
    expect(markdownToText("**कल** छुट्टी रहेगी।")).toBe("कल छुट्टी रहेगी।");
    expect(markdownToText("नमस्ते दोस्तों", 5)).toBe("नमस्…");
    expect(markdownToText("short", 50)).toBe("short");
  });
});
