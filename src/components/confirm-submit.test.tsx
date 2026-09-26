// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmSubmit } from "./confirm-submit";

describe("ConfirmSubmit", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("confirms once and disables itself while the form is pending", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ConfirmSubmit message="ยืนยันหรือไม่">ลบทริป</ConfirmSubmit>);
    const button = screen.getByRole("button", { name: "ลบทริป" }) as HTMLButtonElement;

    fireEvent.click(button);
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toContain("กำลังดำเนินการ");
    fireEvent.click(button);
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  it("prevents submit when confirmation is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ConfirmSubmit message="ยืนยันหรือไม่">ลบทริป</ConfirmSubmit>);
    const button = screen.getByRole("button", { name: "ลบทริป" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
