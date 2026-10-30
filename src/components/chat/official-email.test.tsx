// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPIED_EMAIL_LABEL, OfficialEmail } from "./official-email";

const ADDRESS = "cobros@ccss.sa.cr";

function pointer(desk: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: desk } as MediaQueryList),
  );
}

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

/** Clicks the link and reports whether the browser would have followed it. */
async function click(link: HTMLElement): Promise<boolean> {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => {
    fireEvent(link, event);
  });
  return !event.defaultPrevented;
}

describe("OfficialEmail", () => {
  it("is a mailto link showing the address", () => {
    render(<OfficialEmail address={ADDRESS} />);
    const link = screen.getByRole("link", { name: ADDRESS });

    expect(link.getAttribute("href")).toBe(`mailto:${ADDRESS}`);
  });

  it("copies the address with a mouse instead of opening a mail app", async () => {
    pointer(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard(writeText);
    render(<OfficialEmail address={ADDRESS} />);

    const followed = await click(screen.getByRole("link", { name: ADDRESS }));

    expect(followed).toBe(false);
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(await screen.findByText(COPIED_EMAIL_LABEL)).toBeTruthy();
  });

  it("opens the mail app on a phone", async () => {
    pointer(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard(writeText);
    render(<OfficialEmail address={ADDRESS} />);

    const followed = await click(screen.getByRole("link", { name: ADDRESS }));

    expect(followed).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("follows the mailto when there is no clipboard to copy to", async () => {
    pointer(true);
    render(<OfficialEmail address={ADDRESS} />);

    const followed = await click(screen.getByRole("link", { name: ADDRESS }));

    expect(followed).toBe(true);
    expect(screen.queryByText(COPIED_EMAIL_LABEL)).toBeNull();
  });
});
