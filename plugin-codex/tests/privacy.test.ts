import { describe, expect, test } from "bun:test";
import { isFullyPrivate, stripPrivateContent } from "../src/privacy";

describe("privacy", () => {
  test("strips private blocks", () => {
    expect(stripPrivateContent("keep <private>secret</private> done")).toBe("keep  done");
  });

  test("detects fully private content", () => {
    expect(isFullyPrivate("<private>secret</private>")).toBe(true);
    expect(isFullyPrivate("visible <private>secret</private>")).toBe(false);
  });
});
