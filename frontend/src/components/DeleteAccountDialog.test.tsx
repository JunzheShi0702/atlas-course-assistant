import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

describe("DeleteAccountDialog", () => {
  it("does not call onConfirm until DELETE is typed", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <DeleteAccountDialog open onCancel={onCancel} onConfirm={onConfirm} />,
    );

    const confirmBtn = screen.getByTestId("delete-account-confirm-button");
    expect(confirmBtn).toBeDisabled();

    await user.type(screen.getByTestId("delete-account-confirm-input"), "DELETE");
    expect(confirmBtn).not.toBeDisabled();

    await user.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <DeleteAccountDialog open={false} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
