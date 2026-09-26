/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/actions/identity", () => ({ bootstrapIdentity: vi.fn(), redeemDeviceLinkCode: vi.fn() }));

import { IdentityBootstrap } from "./identity-bootstrap";

describe("IdentityBootstrap", () => {
  it("offers I already use Paipa on first use", async () => {
    window.localStorage.clear();
    render(<IdentityBootstrap nextPath="/trips" />);
    expect(await screen.findByRole("button", { name: "I already use Paipa" })).toBeInTheDocument();
  });
});
