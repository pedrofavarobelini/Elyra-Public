import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import { APP_VERSION } from "@/lib/app-version";

describe("versão da Elyra", () => {
  it("usa package.json como fonte única da UI", () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(APP_VERSION).toMatch(/^0\.2\.\d+$/);
  });
});
