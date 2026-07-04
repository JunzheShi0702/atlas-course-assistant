import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CourseCard from "./CourseCard";
import type { CourseCard as CourseCardType } from "@/store/atoms";

const mockGetCourseSummary = vi.fn();
const mockGetSisCourseDetails = vi.fn();

vi.mock("@/hooks/useApi", () => ({
  useApi: () => ({
    getSisCourseDetails: mockGetSisCourseDetails,
    sisDetailsLoading: false,
    getCourseSummary: mockGetCourseSummary,
    summaryLoading: false,
  }),
}));

const baseCourse: CourseCardType = {
  id: "en-601-226-spring-2026",
  courseCode: "EN.601.226",
  courseTitle: "Data Structures",
  instructor: "Dr. Ada",
  description: "Core data structures.",
  sisOfferingName: "EN.601.226",
  term: "Spring 2026",
};

describe("CourseCard raw evaluation data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders prerequisites in full course details when provided", async () => {
    mockGetSisCourseDetails.mockResolvedValue({
      courseId: "en-601-226-spring-2026",
      details: {
        offeringName: "EN.601.226",
        sectionName: "01",
        title: "Data Structures",
        description: "Core data structures.",
        schoolName: "Whiting School of Engineering",
        department: "Computer Science",
        level: "Upper Level Undergraduate",
        timeOfDay: "afternoon",
        daysOfWeek: "Mon/Wed",
        location: "Malone 228",
        instructors: ["Dr. Ada"],
        status: "Open",
        prerequisites: "AS.110.108 and EN.601.220",
      },
    });

    const user = userEvent.setup();
    render(<CourseCard course={baseCourse} />);
    await user.click(screen.getByText(/EN\.601\.226/i));
    await user.click(screen.getByRole("button", { name: /(Load|Show) full course details/i }));

    await waitFor(() => {
      expect(screen.getByText(/Prerequisites:/i)).toBeInTheDocument();
      expect(screen.getByText("AS.110.108")).toBeInTheDocument();
      expect(screen.getByText("EN.601.220")).toBeInTheDocument();
    });
  }, 15000);

  it("keeps selection-mode checkmark clickable for clarification cards", async () => {
    const user = userEvent.setup();
    const onSelectOption = vi.fn();

    render(
      <CourseCard
        course={baseCourse}
        selectionMode
        onSelectOption={onSelectOption}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select course option" }));
    expect(onSelectOption).toHaveBeenCalledWith(expect.objectContaining({ id: baseCourse.id }));
  });

  it("uses resolved SIS offering id for clarification prerequisite status", async () => {
    const clarificationCourse: CourseCardType = {
      ...baseCourse,
      id: "EN.601.482-Spring 2026-0",
      courseCode: "EN.601.482",
      courseTitle: "Machine Learning: Deep Learning",
      sisOfferingName: "EN.601.482",
      term: "Spring 2026",
    };
    mockGetSisCourseDetails.mockResolvedValueOnce({
      courseId: "en-601-482-spring-2026",
      details: {
        offeringName: "EN.601.482",
        sectionName: "01",
        title: "Machine Learning: Deep Learning",
        description: "Deep learning topics.",
        schoolName: "Whiting School of Engineering",
        department: "Computer Science",
        level: "Upper Level Undergraduate",
        timeOfDay: "afternoon",
        daysOfWeek: "Tue/Thu",
        location: "Malone",
        instructors: ["Eric Nalisnick"],
        status: "Open",
        prerequisites: "EN.601.226",
      },
    });

    render(
      <CourseCard
        course={clarificationCourse}
        selectionMode
        onSelectOption={vi.fn()}
        takenCourseCodes={new Set(["EN.601.226"])}
        hasLoadedTakenCourseHistory
      />,
    );

    await waitFor(() => {
      expect(mockGetSisCourseDetails).toHaveBeenCalledWith("en-601-482-spring-2026");
      expect(screen.getByTestId("card-prereq-outcome")).toHaveTextContent("Fulfilled");
    });
  });

  it("renders prerequisites fallback text when SIS does not provide requirements", async () => {
    const fallbackCourse: CourseCardType = {
      ...baseCourse,
      id: "en-553-171-spring-2026",
      courseCode: "EN.553.171",
      courseTitle: "Discrete Mathematics",
      sisOfferingName: "EN.553.171",
    };
    mockGetSisCourseDetails.mockResolvedValue({
      courseId: "en-553-171-spring-2026",
      details: {
        offeringName: "EN.553.171",
        sectionName: "01",
        title: "Discrete Mathematics",
        description: "Proof techniques and discrete structures.",
        schoolName: "Whiting School of Engineering",
        department: "Computer Science",
        level: "Upper Level Undergraduate",
        timeOfDay: "afternoon",
        daysOfWeek: "Mon/Wed",
        location: "Maryland Hall",
        instructors: ["Dr. Ada"],
        status: "Open",
      },
    });

    const user = userEvent.setup();
    render(<CourseCard course={fallbackCourse} />);
    await user.click(screen.getByText(/EN\.553\.171/i));
    await user.click(screen.getByRole("button", { name: /(Load|Show) full course details/i }));

    await waitFor(() => {
      expect(screen.getByText(/Prerequisites:/i)).toBeInTheDocument();
      expect(screen.getByText("Not listed in SIS")).toBeInTheDocument();
    });
  });

  it("renders prerequisite tokens and marks taken/not-taken course codes", async () => {
    const prerequisitesCourse: CourseCardType = {
      ...baseCourse,
      id: "en-601-226-prereq-formatting-test",
      term: "Prereq Test 2026",
    };
    mockGetSisCourseDetails.mockResolvedValueOnce({
      courseId: "en-601-226-prereq-formatting-test",
      details: {
        offeringName: "EN.601.226",
        sectionName: "01",
        title: "Data Structures",
        description: "Core data structures.",
        schoolName: "Whiting School of Engineering",
        department: "Computer Science",
        level: "Upper Level Undergraduate",
        timeOfDay: "afternoon",
        daysOfWeek: "Mon/Wed",
        location: "Malone 228",
        instructors: ["Dr. Ada"],
        status: "Open",
        prerequisites:
          "Statistics Sequence restriction: students who have completed any of these courses may AND NOT EN 553 310 OR EN.560.435 OR EN.553.420 AND EN.553.421 OR EN.553.430 OR EN.560.348",
      },
    });

    const user = userEvent.setup();
    render(<CourseCard course={prerequisitesCourse} takenCourseCodes={new Set()} />);
    await user.click(screen.getByText(/EN\.601\.226/i));
    await user.click(screen.getByRole("button", { name: /(Load|Show) full course details/i }));

    await waitFor(() => {
      expect(screen.getByText("EN.553.310")).toBeInTheDocument();
      expect(screen.getByText("EN.560.435")).toBeInTheDocument();
      expect(screen.getByText("EN.553.420")).toBeInTheDocument();
      expect(screen.getByText("EN.553.421")).toBeInTheDocument();
      expect(screen.getByText("EN.553.430")).toBeInTheDocument();
      expect(screen.getByText("EN.560.348")).toBeInTheDocument();
      expect(screen.getAllByTestId("prereq-operator-token").map((node) => node.textContent)).toEqual(
        expect.arrayContaining(["AND", "OR", "NOT"]),
      );
      expect(screen.getAllByTestId("prereq-option-line")).toHaveLength(1);
      expect(screen.queryByText(/Statistics Sequence restriction/i)).not.toBeInTheDocument();
      expect(screen.getByTestId("prereq-outcome")).toHaveTextContent("Fulfilled");
    });

    const codeTokens = screen.getAllByTestId("prereq-code-token");
    const takenToken = codeTokens.find((node) => node.textContent === "EN.553.310");
    const notTakenToken = codeTokens.find((node) => node.textContent === "EN.560.435");
    expect(takenToken?.className).toContain("emerald");
    expect(notTakenToken?.className).toContain("rose");
    expect(takenToken?.getAttribute("title")).toBeNull();
    expect(screen.queryByTestId("prereq-negative-token")).not.toBeInTheDocument();
    expect(screen.queryByTestId("prereq-text-token")).not.toBeInTheDocument();
  });

  // Shared setup that opens the course modal and loads a summary with source rows.
  async function openSummaryWithSourceData(user: ReturnType<typeof userEvent.setup>) {
    mockGetCourseSummary.mockResolvedValueOnce({
      courseId: "EN.601.226",
      summary: "Students report strong outcomes.",
      hasData: true,
      sourceData: [
        {
          term: "Spring 2025",
          instructor: "Dr. Ada",
          metricName: "overall_quality",
          metricLabel: "Overall Quality",
          metricValue: 4.6,
          respondentCount: 20,
        },
      ],
      sourceDataMeta: {
        totalDataPoints: 1,
        returnedDataPoints: 1,
        truncated: false,
      },
    });

    render(<CourseCard course={baseCourse} />);
    await user.click(screen.getByText(/EN\.601\.226/i));
    await user.click(screen.getByRole("button", { name: /Summarize course evals/i }));

    await waitFor(() => {
      expect(screen.getByText("Students report strong outcomes.")).toBeInTheDocument();
    });
  }

  function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it("opens raw data modal and renders source rows after summary load", async () => {
    // Validates the happy path: summary -> raw data modal -> row rendering.
    mockGetCourseSummary.mockResolvedValueOnce({
      courseId: "EN.601.226",
      summary: "Students report strong outcomes.",
      hasData: true,
      sourceData: [
        {
          term: "Spring 2025",
          instructor: "Dr. Ada",
          metricName: "overall_quality",
          metricLabel: "Overall Quality",
          metricValue: 4.6,
          respondentCount: 20,
        },
        {
          term: "Fall 2024",
          instructor: "Dr. Turing",
          metricName: "work_load",
          metricLabel: "Workload",
          metricValue: 3.2,
          respondentCount: 18,
        },
      ],
      sourceDataMeta: {
        totalDataPoints: 2,
        returnedDataPoints: 2,
        truncated: false,
      },
    });

    const user = userEvent.setup();
    render(<CourseCard course={baseCourse} />);

    await user.click(screen.getByText(/EN\.601\.226/i));
    await user.click(screen.getByRole("button", { name: /Summarize course evals/i }));

    await waitFor(() => {
      expect(screen.getByText("Students report strong outcomes.")).toBeInTheDocument();
    });

    const rawDataButton = screen.getByTestId("raw-eval-data-button");
    expect(rawDataButton).toBeEnabled();
    await user.click(rawDataButton);

    expect(screen.getByTestId("raw-eval-data-modal")).toBeInTheDocument();
    expect(screen.getByText("Raw Evaluation Data")).toBeInTheDocument();
    expect(screen.getByText("Overall Quality")).toBeInTheDocument();
    expect(screen.getByText("Workload")).toBeInTheDocument();
    expect(screen.getByText("4.60")).toBeInTheDocument();
    expect(screen.getByText("3.20")).toBeInTheDocument();
    expect(screen.getAllByTestId("raw-eval-data-row")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /Close raw data/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("raw-eval-data-modal")).not.toBeInTheDocument();
    });

    expect(mockGetCourseSummary).toHaveBeenCalledWith("EN.601.226");
  });

  it("disables raw data button and shows fallback text when summary has no source data", async () => {
    // Validates no-data behavior so users cannot open an empty raw-data modal.
    mockGetCourseSummary.mockResolvedValueOnce({
      courseId: "EN.601.999",
      summary: "No evaluation data found for this course.",
      hasData: false,
      sourceData: [],
      sourceDataMeta: {
        totalDataPoints: 0,
        returnedDataPoints: 0,
        truncated: false,
      },
    });

    const user = userEvent.setup();
    render(<CourseCard course={{ ...baseCourse, courseCode: "EN.601.999", id: "en-601-999-spring-2026" }} />);

    await user.click(screen.getByText(/EN\.601\.999/i));
    await user.click(screen.getByRole("button", { name: /Summarize course evals/i }));

    await waitFor(() => {
      expect(screen.getByText("No evaluation data found for this course.")).toBeInTheDocument();
    });

    const rawDataButton = screen.getByTestId("raw-eval-data-button");
    expect(rawDataButton).toBeDisabled();
    expect(screen.getByText("Raw evaluation data is not available for this summary.")).toBeInTheDocument();
  });

  it("closes raw data modal when clicking the overlay", async () => {
    // Validates overlay-dismiss behavior for accidental or intentional outside clicks.
    const user = userEvent.setup();
    await openSummaryWithSourceData(user);

    await user.click(screen.getByTestId("raw-eval-data-button"));
    expect(screen.getByTestId("raw-eval-data-modal")).toBeInTheDocument();

    await user.click(screen.getByTestId("raw-eval-data-modal"));
    await waitFor(() => {
      expect(screen.queryByTestId("raw-eval-data-modal")).not.toBeInTheDocument();
    });
  });

  it("closes raw data modal when parent course modal is closed", async () => {
    // Ensures closing the parent modal cleans up nested raw-data modal state.
    const user = userEvent.setup();
    await openSummaryWithSourceData(user);

    await user.click(screen.getByTestId("raw-eval-data-button"));
    expect(screen.getByTestId("raw-eval-data-modal")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByTestId("raw-eval-data-modal")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog", { name: /course-info-title/i })).not.toBeInTheDocument();
  });

  it("closes raw data first when Escape is pressed", async () => {
    // Escape should dismiss only the top-most modal layer first.
    const user = userEvent.setup();
    await openSummaryWithSourceData(user);

    await user.click(screen.getByTestId("raw-eval-data-button"));
    expect(screen.getByTestId("raw-eval-data-modal")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("raw-eval-data-modal")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("dialog", { name: /EN\.601\.226 Data Structures/i })).toBeInTheDocument();
  });

  it("closes course modal when Escape is pressed and raw modal is not open", async () => {
    // Escape should close the course modal when there is no nested raw-data modal.
    const user = userEvent.setup();
    render(<CourseCard course={baseCourse} />);

    await user.click(screen.getByText(/EN\.601\.226/i));
    expect(screen.getByRole("dialog", { name: /EN\.601\.226 Data Structures/i })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /EN\.601\.226 Data Structures/i })).not.toBeInTheDocument();
    });
  });

  it("prevents duplicate summary requests during rapid clicks", async () => {
    // Rapid repeated clicks should trigger at most one fetch while in-flight.
    const pending = deferred<{
      courseId: string;
      summary: string;
      hasData: boolean;
      sourceData: Array<{
        term: string | null;
        instructor: string | null;
        metricName: string;
        metricLabel: string;
        metricValue: number;
        respondentCount: number | null;
      }>;
      sourceDataMeta: { totalDataPoints: number; returnedDataPoints: number; truncated: boolean };
    }>();
    mockGetCourseSummary.mockReturnValueOnce(pending.promise);

    const user = userEvent.setup();
    render(<CourseCard course={baseCourse} />);

    await user.click(screen.getByText(/EN\.601\.226/i));
    const summarizeButton = screen.getByRole("button", { name: /Summarize course evals/i });
    await user.click(summarizeButton);
    await user.click(summarizeButton);

    expect(mockGetCourseSummary).toHaveBeenCalledTimes(1);

    pending.resolve({
      courseId: "EN.601.226",
      summary: "Loaded once.",
      hasData: true,
      sourceData: [],
      sourceDataMeta: {
        totalDataPoints: 0,
        returnedDataPoints: 0,
        truncated: false,
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Loaded once.")).toBeInTheDocument();
    });
  });

  it("renders safe fallbacks for malformed raw source rows", async () => {
    // Malformed raw rows should display stable fallback values instead of broken content.
    mockGetCourseSummary.mockResolvedValueOnce({
      courseId: "EN.601.226",
      summary: "Fallback rendering check.",
      hasData: true,
      sourceData: [
        {
          term: null,
          instructor: null,
          metricName: "overall_quality",
          metricLabel: "",
          metricValue: Number.NaN,
          respondentCount: null,
        },
      ],
      sourceDataMeta: {
        totalDataPoints: 1,
        returnedDataPoints: 1,
        truncated: false,
      },
    });

    const user = userEvent.setup();
    render(<CourseCard course={baseCourse} />);

    await user.click(screen.getByText(/EN\.601\.226/i));
    await user.click(screen.getByRole("button", { name: /Summarize course evals/i }));
    await waitFor(() => {
      expect(screen.getByText("Fallback rendering check.")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("raw-eval-data-button"));
    const row = screen.getByTestId("raw-eval-data-row");
    expect(row).toHaveTextContent("overall_quality");
    expect(row).toHaveTextContent("N/A");
  });
});
