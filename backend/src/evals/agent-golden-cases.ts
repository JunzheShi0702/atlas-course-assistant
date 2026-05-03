export type EvalToolResult = {
  toolName: string;
  output: unknown;
};

export type AgentGoldenCase = {
  id: string;
  description: string;
  message: string;
  inScope: boolean;
  modelText?: string;
  toolResults?: EvalToolResult[];
  expected: {
    type: "search" | "summary" | "details" | "text" | "error";
    messageIncludes?: string[];
    messageExcludes?: string[];
    minResults?: number;
    hasData?: boolean;
    summaryContains?: string[];
  };
};

const COURSE_RESULT = {
  courseId: "en-601-226-spring-2026",
  code: "EN.601.226",
  title: "Data Structures",
  description: "Core data structures and complexity analysis.",
  term: "Spring 2026",
  rank: 1,
  relevanceScore: 0.94,
  clearlyMatches: true,
};

export const agentGoldenCases: AgentGoldenCase[] = [
  {
    id: "out-of-scope-redirect",
    description: "Out-of-scope prompts must return the fixed redirect text.",
    message: "Who won the NBA finals?",
    inScope: false,
    expected: {
      type: "text",
      messageIncludes: ["I can only help with JHU course planning right now."],
    },
  },
  {
    id: "search-results-shape",
    description: "Course recommendation prompts should return searchable card payloads.",
    message: "recommend a data structures course",
    inScope: true,
    modelText: JSON.stringify({
      type: "search",
      results: [COURSE_RESULT],
    }),
    expected: {
      type: "search",
      minResults: 1,
    },
  },
  {
    id: "search-empty-fallback",
    description: "Empty search responses keep search shape and include a no-results fallback message.",
    message: "find an underwater basket weaving course",
    inScope: true,
    modelText: JSON.stringify({
      type: "search",
      results: [],
    }),
    expected: {
      type: "search",
      minResults: 0,
      messageIncludes: ["I didn’t find any courses matching those criteria."],
    },
  },
  {
    id: "summary-no-data",
    description: "No-data evaluation summaries should stay structured and explicit.",
    message: "summarize evals for EN.601.999",
    inScope: true,
    modelText: JSON.stringify({
      type: "summary",
      courseId: "en-601-999-spring-2026",
      summaryText: "No evaluation data found for this course.",
      hasData: false,
    }),
    toolResults: [
      {
        toolName: "getCourseEvalSummary",
        output: { hasData: false, message: "No evaluation data found for this course." },
      },
    ],
    expected: {
      type: "summary",
      hasData: false,
      summaryContains: ["No evaluation data found for this course."],
    },
  },
  {
    id: "details-response-shape",
    description: "Details requests should return typed details payloads.",
    message: "show details for EN.601.226",
    inScope: true,
    modelText: JSON.stringify({
      type: "details",
      course: {
        offeringName: "EN.601.226",
        sectionName: "01",
        title: "Data Structures",
      },
    }),
    toolResults: [
      {
        toolName: "getSisCourseDetails",
        output: {
          courseId: "en-601-226-spring-2026",
          course: {
            offeringName: "EN.601.226",
            sectionName: "01",
            title: "Data Structures",
          },
        },
      },
    ],
    expected: {
      type: "details",
    },
  },
  {
    id: "out-of-scope-politics",
    description: "Non-product political prompts should remain out-of-scope redirects.",
    message: "Who is running for president?",
    inScope: false,
    expected: {
      type: "text",
      messageIncludes: ["I can only help with JHU course planning right now."],
    },
  },
  {
    id: "search-single-result-with-message",
    description: "Search payload can include message while preserving result cards.",
    message: "find me one intro cs class",
    inScope: true,
    modelText: JSON.stringify({
      type: "search",
      results: [COURSE_RESULT],
      message: "Here is a strong match.",
    }),
    expected: {
      type: "search",
      minResults: 1,
      messageIncludes: ["strong match"],
    },
  },
  {
    id: "search-empty-preserves-specific-message",
    description: "Empty search keeps a model-provided specific no-results message.",
    message: "find classes about quantum basket weaving",
    inScope: true,
    modelText: JSON.stringify({
      type: "search",
      results: [],
      message: "No matching courses for that niche topic.",
    }),
    expected: {
      type: "search",
      minResults: 0,
      messageIncludes: ["No matching courses for that niche topic."],
    },
  },
  {
    id: "summary-has-data-contract",
    description: "Eval summaries with data should preserve summary type and content.",
    message: "summarize evals for EN.601.226",
    inScope: true,
    modelText: JSON.stringify({
      type: "summary",
      courseId: "en-601-226-spring-2026",
      summaryText: "Workload is moderate and quality is high across recent terms.",
      hasData: true,
    }),
    toolResults: [
      {
        toolName: "getCourseEvalSummary",
        output: {
          hasData: true,
          summaryText: "Workload is moderate and quality is high across recent terms.",
        },
      },
    ],
    expected: {
      type: "summary",
      hasData: true,
      summaryContains: ["Workload is moderate"],
    },
  },
  {
    id: "details-null-course-contract",
    description: "Null SIS details are normalized to a user-facing text fallback.",
    message: "show details for EN.601.999",
    inScope: true,
    modelText: JSON.stringify({
      type: "details",
      course: null,
    }),
    toolResults: [
      {
        toolName: "getSisCourseDetails",
        output: {
          courseId: "en-601-999-spring-2026",
          course: null,
          message: "Course not found.",
        },
      },
    ],
    expected: {
      type: "text",
      messageIncludes: ["Course not found."],
    },
  },
  {
    id: "text-empty-message-normalized",
    description: "Blank text responses are normalized to fallback guidance.",
    message: "help",
    inScope: true,
    modelText: JSON.stringify({
      type: "text",
      message: "",
    }),
    expected: {
      type: "text",
      messageIncludes: ["I didn’t find any courses matching those criteria."],
    },
  },
  {
    id: "plain-text-response-contract",
    description: "Non-search advising messages remain typed text responses.",
    message: "how should I balance workload across my courses?",
    inScope: true,
    modelText: JSON.stringify({
      type: "text",
      message: "Aim for a balanced credit load and avoid clustering all high-workload courses.",
    }),
    expected: {
      type: "text",
      messageIncludes: ["balanced credit load"],
    },
  },
  {
    id: "markdown-fence-json-parse",
    description: "JSON wrapped in markdown fences should still parse into payloads.",
    message: "recommend a data structures class",
    inScope: true,
    modelText: "```json\n{\"type\":\"search\",\"results\":[{\"courseId\":\"en-601-226-spring-2026\",\"code\":\"EN.601.226\",\"title\":\"Data Structures\",\"description\":\"Core data structures and complexity analysis.\",\"term\":\"Spring 2026\",\"rank\":1,\"relevanceScore\":0.94,\"clearlyMatches\":true}]}\n```",
    expected: {
      type: "search",
      minResults: 1,
    },
  },
  {
    id: "search-two-results-shape",
    description: "Multiple result cards should be preserved under search type.",
    message: "show me cs systems courses",
    inScope: true,
    modelText: JSON.stringify({
      type: "search",
      results: [
        COURSE_RESULT,
        {
          ...COURSE_RESULT,
          courseId: "en-601-229-spring-2026",
          code: "EN.601.229",
          title: "Computer Systems Fundamentals",
          rank: 2,
          relevanceScore: 0.89,
        },
      ],
    }),
    expected: {
      type: "search",
      minResults: 2,
    },
  },
  {
    id: "out-of-scope-entertainment",
    description: "Entertainment prompts remain outside Atlas product scope.",
    message: "recommend me a movie to watch tonight",
    inScope: false,
    expected: {
      type: "text",
      messageIncludes: ["I can only help with JHU course planning right now."],
    },
  },
];
