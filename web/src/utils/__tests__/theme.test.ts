import { expect, test } from "bun:test";
import { resolveTheme } from "@/utils/theme";

test("system follows the OS, an explicit choice wins", () => {
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});
