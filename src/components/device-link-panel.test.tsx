/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createDeviceLinkCode } = vi.hoisted(() => ({ createDeviceLinkCode: vi.fn() }));
vi.mock("@/actions/identity", () => ({ createDeviceLinkCode }));

import { DeviceLinkPanel } from "./device-link-panel";

describe("DeviceLinkPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows Link another device and reveals an eight-digit code after generation", async () => {
    createDeviceLinkCode.mockResolvedValue({ ok: true, code: "01234567", expiresAt: "2026-09-27T00:42:00.000Z" });
    render(<DeviceLinkPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Link another device" }));

    expect(await screen.findByText("01234567")).toBeInTheDocument();
    expect(screen.getByText(/10/)).toBeInTheDocument();
  });
});
