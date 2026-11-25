import { describe, expect, it } from "vitest";
import { pickView } from "./site-routes";

const pages = [{ slug: "home" }, { slug: "admissions" }, { slug: "secret", hidden: true }];

describe("pickView: an address with nothing behind it is null, so the page answers 404", () => {
  it("knows the real addresses", () => {
    expect(pickView([], pages, false)).toEqual({ k: "page", slug: "home" });
    expect(pickView(["admissions"], pages, false)).toEqual({ k: "page", slug: "admissions" });
    expect(pickView(["news"], pages, false)).toEqual({ k: "news" });
    expect(pickView(["privacy"], pages, false)).toEqual({ k: "privacy" });
    expect(pickView(["news", "abc"], pages, false)).toEqual({ k: "newsItem", id: "abc" });
  });
  it("is null for unknown, deep and hidden addresses", () => {
    expect(pickView(["no-such-page"], pages, false)).toBeNull();
    expect(pickView(["a", "b", "c"], pages, false)).toBeNull();
    expect(pickView(["a", "b"], pages, false)).toBeNull();
    expect(pickView(["news", "x", "y"], pages, false)).toBeNull();
    expect(pickView(["secret"], pages, false)).toBeNull();
    expect(pickView(["secret"], pages, true)).toEqual({ k: "page", slug: "secret" });
    expect(pickView([], [], false)).toBeNull();
  });
});
