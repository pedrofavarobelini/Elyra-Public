import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopBrandMotion, MobilePreLoginSplash } from "./brand-experience";
afterEach(cleanup);
describe("public static identity", () => {
 it("does not delay mobile authentication", () => { const { container } = render(<MobilePreLoginSplash />); expect(container).toBeEmptyDOMElement(); });
 it("uses only the original neutral placeholder without media playback", () => { render(<DesktopBrandMotion />); const panel = screen.getByTestId("desktop-brand-motion"); expect(panel.querySelector("video")).toBeNull(); expect(panel.querySelector("img")).toHaveAttribute("src", "/placeholder/logo.svg"); expect(panel).toHaveAttribute("aria-hidden", "true"); });
});
