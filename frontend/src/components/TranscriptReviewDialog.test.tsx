import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TranscriptReviewDialog } from "./TranscriptReviewDialog";

const matchedEntry = {
  rawCode: "AS.030.101",
  canonicalCode: "AS.030.101",
  status: "matched" as const,
  options: ["AS.030.101"],
  resolvedCourseTitle: "Intro Chemistry",
};

const ambiguousEntry = {
  rawCode: "EN.500.112",
  canonicalCode: "EN.500.112",
  status: "ambiguous" as const,
  options: ["EN.500.112", "EN.500.113"],
  optionDetails: [
    { courseCode: "EN.500.112", title: "Gateway Computing" },
    { courseCode: "EN.500.113", title: "Gateway Java" },
  ],
};

describe("TranscriptReviewDialog", () => {
  it("blocks save until ambiguous rows are resolved", async () => {
    const user = userEvent.setup();
    const onChangeEntry = vi.fn();
    const onSave = vi.fn();

    render(
      <TranscriptReviewDialog
        open
        entries={[matchedEntry, ambiguousEntry]}
        onClose={() => {}}
        onChangeEntry={onChangeEntry}
        onRemoveEntry={() => {}}
        onSave={onSave}
      />,
    );

    expect(screen.getByTestId("transcript-save-button")).toBeDisabled();

    await user.selectOptions(screen.getByTestId("transcript-option-1"), "EN.500.113");

    expect(onChangeEntry).toHaveBeenCalledWith(1, {
      ...ambiguousEntry,
      selectedCourseCode: "EN.500.113",
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("allows save when entries are resolved and removes rows by index", async () => {
    const user = userEvent.setup();
    const onRemoveEntry = vi.fn();
    const onSave = vi.fn();

    render(
      <TranscriptReviewDialog
        open
        entries={[matchedEntry, { ...ambiguousEntry, selectedCourseCode: "EN.500.113" }]}
        onClose={() => {}}
        onChangeEntry={() => {}}
        onRemoveEntry={onRemoveEntry}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove AS.030.101" }));
    expect(onRemoveEntry).toHaveBeenCalledWith(0);

    await user.click(screen.getByTestId("transcript-save-button"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("disables save while verifying or empty", () => {
    const { rerender } = render(
      <TranscriptReviewDialog
        open
        verifying
        entries={[matchedEntry]}
        onClose={() => {}}
        onChangeEntry={() => {}}
        onRemoveEntry={() => {}}
        onSave={() => {}}
      />,
    );

    expect(screen.getByTestId("transcript-save-button")).toBeDisabled();

    rerender(
      <TranscriptReviewDialog
        open
        entries={[]}
        onClose={() => {}}
        onChangeEntry={() => {}}
        onRemoveEntry={() => {}}
        onSave={() => {}}
      />,
    );

    expect(screen.getByTestId("transcript-save-button")).toBeDisabled();
  });
});
