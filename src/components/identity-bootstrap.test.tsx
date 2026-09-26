/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { routerReplace, routerRefresh, bootstrapIdentity, redeemDeviceLinkCode } = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
  bootstrapIdentity: vi.fn(),
  redeemDeviceLinkCode: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplace, refresh: routerRefresh }) }));
vi.mock("@/actions/identity", () => ({ bootstrapIdentity, redeemDeviceLinkCode }));

import { IdentityBootstrap } from "./identity-bootstrap";

describe("IdentityBootstrap", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("offers I already use Paipa on first use", async () => {
    render(<IdentityBootstrap nextPath="/trips" />);
    expect(await screen.findByRole("button", { name: "I already use Paipa" })).toBeTruthy();
  });

  it("reconciles stale localStorage to the linked primary before navigation", async () => {
    window.localStorage.setItem("paipa_identity", JSON.stringify({ id: "550e8400-e29b-41d4-a716-446655440000", displayName: "Secondary" }));
    redeemDeviceLinkCode.mockResolvedValue({
      ok: true,
      identity: { id: "550e8400-e29b-41d4-a716-446655440001", displayName: "Primary" },
      cleanedCount: 1,
      retainedCount: 0,
    });
    render(<IdentityBootstrap nextPath="/trips" />);
    await screen.findByRole("button", { name: "I already use Paipa" });
    screen.getByRole("button", { name: "I already use Paipa" }).click();
    const input = await screen.findByLabelText("รหัสเชื่อมอุปกรณ์");
    fireEvent.change(input, { target: { value: "01234567" } });
    screen.getByRole("button", { name: "เชื่อมกับโปรไฟล์เดิม" }).click();

    await vi.waitFor(() => expect(JSON.parse(window.localStorage.getItem("paipa_identity") ?? "null")).toEqual({ id: "550e8400-e29b-41d4-a716-446655440001", displayName: "Primary" }));
    expect(routerReplace).toHaveBeenCalledWith("/trips");
  });
});
