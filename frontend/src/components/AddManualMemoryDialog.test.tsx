import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddManualMemoryDialog } from "./AddManualMemoryDialog";

describe("AddManualMemoryDialog", () => {
  it("requires non-empty text and saves the selected type", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<AddManualMemoryDialog open onClose={() => {}} onSave={onSave} />);

    const save = screen.getByRole("button", { name: "Save memory" });
    expect(save).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Type"), "constraint");
    await user.type(screen.getByLabelText("Text"), "Must stay under 16 credits");
    await user.click(save);

    expect(onSave).toHaveBeenCalledWith("Must stay under 16 credits", "constraint");
  });

  it("closes on Escape and overlay click when not loading", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<AddManualMemoryDialog open onClose={onClose} onSave={() => {}} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders loading/error state without allowing cancellation", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <AddManualMemoryDialog
        open
        loading
        errorText="Could not save memory"
        onClose={onClose}
        onSave={() => {}}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Could not save memory");
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});
