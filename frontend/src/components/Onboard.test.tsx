import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import Onboard from "@/components/Onboard";
import {
  KRIEGER_SCHOOL_LABEL,
  WHITING_SCHOOL_LABEL,
} from "@/lib/programList";
import { testProgramListResponse } from "@/test/fixtures/programListResponse";

const getUserProfileMock = vi.fn().mockResolvedValue(null);
const getProgramListMock = vi.fn().mockResolvedValue(testProgramListResponse);
const submitUserProfileMock = vi.fn().mockResolvedValue({});

vi.mock("@/hooks/useApi", () => ({
  useApi: vi.fn(() => ({
    getUserProfile: getUserProfileMock,
    getProgramList: getProgramListMock,
    submitUserProfile: submitUserProfileMock,
    profileLoading: false,
    profileError: null,
    profileSubmitLoading: false,
    profileSubmitError: null,
  })),
}));

function renderOnboard() {
  return render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <Provider>
        <Onboard />
      </Provider>
    </MemoryRouter>
  );
}

async function waitForSurveyReady() {
  await waitFor(() => {
    expect(screen.queryByText(/Loading saved preferences/)).not.toBeInTheDocument();
  });
}

describe("Onboard survey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserProfileMock.mockResolvedValue(null);
    getProgramListMock.mockResolvedValue(testProgramListResponse);
    submitUserProfileMock.mockResolvedValue({});
  });

  it("shows Next disabled when step 1 fields are incomplete", async () => {
    renderOnboard();
    await waitForSurveyReady();

    const nextButton = screen.getByTestId("next-button");
    expect(nextButton).toBeDisabled();
  });

  it("enables Next after selecting major, graduation month, and year", async () => {
    const user = userEvent.setup();
    renderOnboard();
    await waitForSurveyReady();

    const programSearch = screen.getByTestId("program-search");
    await user.type(programSearch, "CS");
    const csOption = await screen.findByRole("button", {
      name: /Computer Science \(Major\)/,
    });
    await user.click(csOption);

    await user.click(screen.getByRole("button", { name: "May" }));
    await user.click(screen.getByRole("button", { name: "Select year" }));
    const yearOption = await screen.findByRole("menuitem", {
      name: new RegExp(String(new Date().getFullYear())),
    });
    await user.click(yearOption);

    const nextButton = screen.getByTestId("next-button");
    await waitFor(() => expect(nextButton).toBeEnabled());
  });

  it("selecting CS adds Computer Science major and shows Whiting School of Engineering", async () => {
    const user = userEvent.setup();
    renderOnboard();
    await waitForSurveyReady();

    const programSearch = screen.getByTestId("program-search");
    await user.type(programSearch, "CS");
    const csOption = await screen.findByRole("button", {
      name: /Computer Science \(Major\)/,
    });
    await user.click(csOption);

    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    const schoolDisplay = screen.getByTestId("school-display");
    expect(schoolDisplay).toHaveTextContent(WHITING_SCHOOL_LABEL);
  });

  it("adding Mathematics and setting it primary shows Krieger School of Arts & Sciences", async () => {
    const user = userEvent.setup();
    renderOnboard();
    await waitForSurveyReady();

    const programSearch = screen.getByTestId("program-search");
    await user.type(programSearch, "CS");
    const csOption = await screen.findByRole("button", {
      name: /Computer Science \(Major\)/,
    });
    await user.click(csOption);

    await user.type(programSearch, "math");
    const mathOption = await screen.findByRole("button", {
      name: /^Mathematics \(Major\)$/,
    });
    await user.click(mathOption);

    expect(screen.getByText("Computer Science")).toBeInTheDocument();
    expect(screen.getByText("Mathematics")).toBeInTheDocument();

    const moveMathUpButton = screen.getAllByRole("button", {
      name: "Move major up",
    })[1];
    await user.click(moveMathUpButton);

    const schoolDisplay = screen.getByTestId("school-display");
    expect(schoolDisplay).toHaveTextContent(KRIEGER_SCHOOL_LABEL);
  });

  it("submits correct payload after completing steps 2-4 with choices and descriptions", async () => {
    const user = userEvent.setup();
    renderOnboard();
    await waitForSurveyReady();

    // Step 1: major + graduation month/year
    const programSearch = screen.getByTestId("program-search");
    await user.type(programSearch, "CS");
    await user.click(
      await screen.findByRole("button", { name: /Computer Science \(Major\)/ })
    );
    await user.click(screen.getByRole("button", { name: "May" }));
    await user.click(screen.getByRole("button", { name: "Select year" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: new RegExp(String(new Date().getFullYear())),
      })
    );
    await user.click(screen.getByTestId("next-button"));

    // Step 2: select preset and add description (description should win)
    await user.click(
      screen.getByRole("button", { name: "Software Engineering" })
    );
    await user.type(
      screen.getByPlaceholderText(
        "Example: Quant research in finance, with strong ML and systems foundations."
      ),
      "Interested in AI product management"
    );
    await user.click(screen.getByTestId("next-button"));

    // Step 3: choose workload on plane
    const plane = screen.getByRole("button", {
      name: "Select workload and focus breadth preference",
    });
    Object.defineProperty(plane, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          left: 0,
          top: 0,
          width: 200,
          height: 200,
          right: 200,
          bottom: 200,
        }) as DOMRect,
    });
    fireEvent.click(plane, { clientX: 120, clientY: 80 });
    await user.click(screen.getByTestId("next-button"));

    // Step 4: select choices then provide custom description (description should win)
    await user.click(
      screen.getByRole("button", { name: "Afternoon (3pm-6pm)" })
    );
    await user.click(screen.getByRole("button", { name: "Evening (after 6pm)" }));
    await user.click(screen.getByRole("button", { name: "Tue" }));
    await user.click(screen.getByRole("button", { name: "Thu" }));
    await user.type(
      screen.getByPlaceholderText(
        "Example: Prefer Tue/Thu afternoons, avoid early mornings."
      ),
      "Prefer Tue/Thu afternoons"
    );

    await user.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => {
      expect(submitUserProfileMock).toHaveBeenCalledTimes(1);
    });

    expect(submitUserProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        graduation_month: 5,
        graduation_year: new Date().getFullYear(),
        school: WHITING_SCHOOL_LABEL,
        degrees: ["Computer Science (major)"],
        raw_goals_text: "Interested in AI product management",
        raw_preferences_text: "Prefer Tue/Thu afternoons",
      })
    );
    expect(
      (submitUserProfileMock.mock.calls[0]?.[0] as { raw_workload_text?: string })
        .raw_workload_text
    ).toMatch(/workload/i);
  });

  it("shows centered Save on steps 1–3 when modifying an existing profile, hidden on step 4", async () => {
    const user = userEvent.setup();
    const year = String(new Date().getFullYear());
    getUserProfileMock.mockResolvedValue({
      graduationMonth: "May",
      graduationYear: year,
      degrees: "Computer Science (major)",
      school: WHITING_SCHOOL_LABEL,
      goalsText: "Still exploring",
      workloadText: "medium workload balanced",
      preferencesText: "No preference",
    });

    renderOnboard();
    await waitForSurveyReady();

    expect(screen.getByTestId("save-survey-button")).toBeInTheDocument();

    await user.click(screen.getByTestId("next-button"));
    expect(screen.getByTestId("save-survey-button")).toBeInTheDocument();

    await user.click(screen.getByTestId("next-button"));
    expect(screen.getByTestId("save-survey-button")).toBeInTheDocument();

    await user.click(screen.getByTestId("next-button"));
    expect(screen.queryByTestId("save-survey-button")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });
});
