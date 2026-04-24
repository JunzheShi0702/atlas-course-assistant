import { useState, useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { addMessageAtom, CourseCard } from '../store/atoms';
import { apiUrl } from '../lib/apiUrl';
import { ensureCatalogCourseCode } from '../lib/catalogCourseCode';
import { normalizeAgentApiPayload } from '../lib/parseAgentPayload';

// Types for API responses
export interface SearchResult {
  id: string;
  title: string;
  code?: string;
  description?: string;
  instructor?: string;
  credits?: number;
  workload?: number;
  difficulty?: number;
  matchExplanation?: string;
  matchType?: 'exact' | 'constraint' | 'semantic' | 'hybrid';
  constraintAlignment?: 'aligned' | 'mismatch' | 'unknown';
  constraintMismatchReasons?: Array<
    | 'days'
    | 'time_window'
    | 'school'
    | 'level'
    | 'department'
    | 'credits'
    | 'writing_intensive'
    | 'course_number'
    | 'instructor'
  >;
  preferenceAlignment?: 'aligned' | 'mismatch';
  preferenceMismatchReasons?: Array<'days' | 'time_window'>;
  sisOfferingName?: string;
  term?: string;
}

export interface SisCourseDetailsResponse {
  courseId: string;
  details: {
    offeringName: string;
    sectionName: string;
    title: string;
    description: string;
    schoolName: string;
    department: string;
    level: string;
    timeOfDay: string;
    daysOfWeek: string;
    location: string;
    instructors: string[];
    status: string;
  } | null;
}

export interface CourseSummary {
  courseId: string;
  summary: string | null;
  hasData: boolean;
  sourceData: Array<{
    term: string | null;
    instructor: string | null;
    metricName: string;
    metricLabel: string;
    metricValue: number;
    respondentCount: number | null;
  }>;
  sourceDataMeta: {
    totalDataPoints: number;
    returnedDataPoints: number;
    truncated: boolean;
  };
}

export interface SisCourseSuggestion {
  code: string;
  title: string;
}

export type { UserProfilePayload } from '../lib/buildUserProfilePayload';
import type { UserProfilePayload } from '../lib/buildUserProfilePayload';
import type { ProgramListResponse } from '../lib/programList';

/** Profile returned by GET/POST /api/user/profile (shape mirrors stored fields). */
export interface UserProfile {
  graduationMonth?: string | null;
  graduationYear?: string | null;
  degrees?: string | null;
  school?: string | null;
  goalsText?: string | null;
  workloadText?: string | null;
  preferencesText?: string | null;
}

/** One row from GET /api/user/memories (mirrors backend MemoryItem). */
export interface MemoryItem {
  id: string;
  text: string;
  type: string;
  source: string;
  confidence: number;
  createdAt: string;
}

/** Allowed `memoryType` for POST /api/user/memories/manual (excludes course_history). */
export type ManualMemoryType = "goal" | "preference" | "constraint" | "learning_style";

interface UseApiReturn {
  searchCourses: (query: string) => Promise<SearchResult[]>;
  searchResults: SearchResult[];
  searchLoading: boolean;
  searchError: string | null;

  getCourseSummary: (courseId: string) => Promise<CourseSummary | null>;
  courseSummary: CourseSummary | null;
  summaryLoading: boolean;
  summaryError: string | null;

  getSisCourseDetails: (courseId: string) => Promise<SisCourseDetailsResponse | null>;
  sisDetailsLoading: boolean;
  sisDetailsError: string | null;
  searchSisCourses: (query: string, limit?: number) => Promise<SisCourseSuggestion[]>;

  sendChatMessage: (message: string) => Promise<any>;
  chatLoading: boolean;
  chatError: string | null;

  getUserProfile: () => Promise<UserProfile | null>;
  userProfile: UserProfile | null;
  profileLoading: boolean;
  profileError: string | null;

  submitUserProfile: (body: UserProfilePayload) => Promise<UserProfile>;
  profileSubmitLoading: boolean;
  profileSubmitError: string | null;

  getProgramList: () => Promise<ProgramListResponse>;

  /** GET /api/user/memories */
  getUserMemories: () => Promise<MemoryItem[]>;
  userMemories: MemoryItem[] | null;
  memoriesLoading: boolean;
  memoriesError: string | null;
  /** DELETE /api/user/memories/:id — chat/manual/course_history; 409 for onboarding */
  deleteUserMemory: (id: string) => Promise<void>;
  memoryDeleteId: string | null;
  addCourseHistoryMemory: (courseCode: string) => Promise<{ id: string; courseCode: string }>;
  /** POST /api/user/memories/clear-conversations — removes chat + manual rows only. */
  clearConversationMemories: () => Promise<{ deleted: number }>;
  /** POST /api/user/memories/manual — stored with confidence 1.0. */
  addManualMemory: (text: string, memoryType?: ManualMemoryType) => Promise<MemoryItem>;

  /** DELETE /api/user — full account deletion (body `{ confirm: true }`). */
  deleteUserAccount: () => Promise<void>;
  accountDeleteLoading: boolean;

  clearErrors: () => void;
}

export const useApi = (): UseApiReturn => {
  const addMessage = useSetAtom(addMessageAtom);

  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Course summary state
  const [courseSummary, setCourseSummary] = useState<CourseSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // SIS details state
  const [sisDetailsLoading, setSisDetailsLoading] = useState<boolean>(false);
  const [sisDetailsError, setSisDetailsError] = useState<string | null>(null);

  // Chat state
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // User profile (onboarding)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSubmitLoading, setProfileSubmitLoading] = useState<boolean>(false);
  const [profileSubmitError, setProfileSubmitError] = useState<string | null>(null);

  const [userMemories, setUserMemories] = useState<MemoryItem[] | null>(null);
  const [memoriesLoading, setMemoriesLoading] = useState<boolean>(false);
  const [memoriesError, setMemoriesError] = useState<string | null>(null);
  const [memoryDeleteId, setMemoryDeleteId] = useState<string | null>(null);
  const [accountDeleteLoading, setAccountDeleteLoading] = useState(false);

  // Generic fetch wrapper
  const fetchApi = async <T,>(
    url: string,
    options?: RequestInit
  ): Promise<T> => {
    const response = await fetch(apiUrl(url), {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      let message = `HTTP error! status: ${response.status}`;
      try {
        const body = await response.json();
        const raw = body?.error ?? body?.detail ?? body?.message;
        if (raw) {
          message = typeof raw === "string" ? raw : JSON.stringify(raw);
        }
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    return response.json();
  };

  // Convert SearchResult to CourseCard
  const convertToCourseCard = (result: SearchResult): CourseCard => ({
    id: result.id,
    courseCode: ensureCatalogCourseCode(result.code || 'N/A', result.sisOfferingName),
    courseTitle: result.title,
    instructor: result.instructor || 'TBD',
    description: result.description || 'No description available',
    credits: result.credits,
    workload: result.workload,
    difficulty: result.difficulty,
    matchReasoning: result.matchExplanation,
    matchType: result.matchType,
    constraintAlignment: result.constraintAlignment,
    constraintMismatchReasons: result.constraintMismatchReasons,
    preferenceAlignment: result.preferenceAlignment,
    preferenceMismatchReasons: result.preferenceMismatchReasons,
    sisOfferingName: result.sisOfferingName,
    term: result.term,
  });

  // Search courses — calls POST /api/agent (single entry point for search/summary/details)
  const searchCourses = useCallback(async (query: string): Promise<SearchResult[]> => {
    setSearchLoading(true);
    setSearchError(null);

    try {
      const agentPayload = await fetchApi<{ type: string; results?: Array<{
        courseId: string;
        code: string;
        title: string;
        description?: string;
        term?: string;
        sisOfferingName?: string;
        rank?: number | null;
        relevanceScore?: number | null;
        matchExplanation?: string;
        matchType?: 'exact' | 'constraint' | 'semantic' | 'hybrid';
        constraintAlignment?: 'aligned' | 'mismatch' | 'unknown';
        constraintMismatchReasons?: Array<
          | 'days'
          | 'time_window'
          | 'school'
          | 'level'
          | 'department'
          | 'credits'
          | 'writing_intensive'
          | 'course_number'
          | 'instructor'
        >;
        preferenceAlignment?: 'aligned' | 'mismatch';
        preferenceMismatchReasons?: Array<'days' | 'time_window'>;
      }>; message?: string; error?: string }>(`/api/agent`, {
        method: 'POST',
        body: JSON.stringify({ message: query }),
      });
      const data = normalizeAgentApiPayload(agentPayload);

      if (data.type === 'error' && data.error) {
        throw new Error(data.error);
      }

      const rows = data.type === 'search' && data.results ? data.results : [];
      const results: SearchResult[] = rows.map((r) => ({
        id: r.courseId,
        title: r.title,
        code: r.code,
        description: r.description ?? '',
        matchExplanation: r.matchExplanation,
        matchType: r.matchType,
        constraintAlignment: r.constraintAlignment,
        constraintMismatchReasons: r.constraintMismatchReasons,
        preferenceAlignment: r.preferenceAlignment,
        preferenceMismatchReasons: r.preferenceMismatchReasons,
        sisOfferingName: r.sisOfferingName,
        term: r.term,
      }));
      setSearchResults(results);

      addMessage({
        type: 'search',
        prompt: `Results for "${query}"`,
        response: results.map(convertToCourseCard),
      });

      return results;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Search failed';
      setSearchError(errorMessage);
      setSearchResults([]);
      throw err;
    } finally {
      setSearchLoading(false);
    }
  }, [addMessage]);

  /** GET /api/user/profile — existing profile for edit; returns null when none (404). */
  const getUserProfile = useCallback(async (): Promise<UserProfile | null> => {
    setProfileLoading(true);
    setProfileError(null);

    try {
      const response = await fetch(apiUrl('/api/user/profile'), {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (response.status === 404) {
        setUserProfile(null);
        return null;
      }

      if (!response.ok) {
        let message = `HTTP error! status: ${response.status}`;
        try {
          const body = await response.json();
          if (body?.detail) message = body.detail;
          else if (body?.error) message = body.error;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }

      const data = (await response.json()) as UserProfile;
      setUserProfile(data);
      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load profile';
      setProfileError(errorMessage);
      setUserProfile(null);
      throw err;
    } finally {
      setProfileLoading(false);
    }
  }, []);

  /** GET /api/program-list — undergrad program catalog for onboarding (public). */
  const getProgramList = useCallback(async (): Promise<ProgramListResponse> => {
    return fetchApi<ProgramListResponse>("/api/program-list");
  }, []);

  /** GET /api/user/memories — list saved memories (onboarding + chat + manual). */
  const getUserMemories = useCallback(async (): Promise<MemoryItem[]> => {
    setMemoriesLoading(true);
    setMemoriesError(null);
    try {
      const data = await fetchApi<{ memories: MemoryItem[] }>("/api/user/memories");
      const list = data.memories ?? [];
      setUserMemories(list);
      return list;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load memories";
      setMemoriesError(errorMessage);
      setUserMemories(null);
      throw err;
    } finally {
      setMemoriesLoading(false);
    }
  }, []);

  /** DELETE /api/user/memories/:id */
  const deleteUserMemory = useCallback(async (id: string): Promise<void> => {
    setMemoryDeleteId(id);
    setMemoriesError(null);
    try {
      const response = await fetch(apiUrl(`/api/user/memories/${encodeURIComponent(id)}`), {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        let message = `HTTP error! status: ${response.status}`;
        try {
          const body = (await response.json()) as {
            error?: unknown;
            detail?: unknown;
            message?: unknown;
          };
          const raw = body?.error ?? body?.detail ?? body?.message;
          if (raw) {
            message = typeof raw === "string" ? raw : JSON.stringify(raw);
          }
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      setUserMemories((prev) =>
        prev ? prev.filter((m) => m.id !== id) : prev,
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to delete memory";
      setMemoriesError(errorMessage);
      throw err;
    } finally {
      setMemoryDeleteId(null);
    }
  }, []);

  const addCourseHistoryMemory = useCallback(
    async (courseCode: string): Promise<{ id: string; courseCode: string }> => {
      const normalized = courseCode.trim().toUpperCase();
      if (!normalized) {
        throw new Error("courseCode is required");
      }
      const data = await fetchApi<{ id: string; courseCode: string }>("/api/user/memories/course-history", {
        method: "POST",
        body: JSON.stringify({ courseCode: normalized }),
      });
      return data;
    },
    [],
  );

  const clearConversationMemories = useCallback(async (): Promise<{ deleted: number }> => {
    setMemoriesError(null);
    const data = await fetchApi<{ deleted: number }>("/api/user/memories/clear-conversations", {
      method: "POST",
      body: "{}",
    });
    setUserMemories((prev) =>
      prev ? prev.filter((m) => m.source !== "chat" && m.source !== "manual") : prev,
    );
    return data;
  }, []);

  const addManualMemory = useCallback(
    async (text: string, memoryType: ManualMemoryType = "preference"): Promise<MemoryItem> => {
      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error("Memory text is required");
      }
      setMemoriesError(null);
      const item = await fetchApi<MemoryItem>("/api/user/memories/manual", {
        method: "POST",
        body: JSON.stringify({ text: trimmed, memoryType }),
      });
      setUserMemories((prev) => (prev ? [item, ...prev] : [item]));
      return item;
    },
    [],
  );

  /** DELETE /api/user — requires `{ confirm: true }`; returns 204 with no JSON body. */
  const deleteUserAccount = useCallback(async (): Promise<void> => {
    setAccountDeleteLoading(true);
    setMemoriesError(null);
    setProfileError(null);
    try {
      const response = await fetch(apiUrl("/api/user"), {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!response.ok) {
        let message = `HTTP error! status: ${response.status}`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      setUserProfile(null);
      setUserMemories(null);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to delete account";
      setMemoriesError(errorMessage);
      throw err;
    } finally {
      setAccountDeleteLoading(false);
    }
  }, []);

  /** PUT /api/user/profile — submit onboarding. */
  const submitUserProfile = useCallback(async (body: UserProfilePayload): Promise<UserProfile> => {
    setProfileSubmitLoading(true);
    setProfileSubmitError(null);

    try {
      const data = await fetchApi<UserProfile>('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setUserProfile(data);
      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save profile';
      setProfileSubmitError(errorMessage);
      throw err;
    } finally {
      setProfileSubmitLoading(false);
    }
  }, []);

  // Get course summary (backend: GET /api/courses/:id/eval-summary)
  const getCourseSummary = useCallback(async (courseId: string): Promise<CourseSummary | null> => {
    setSummaryLoading(true);
    setSummaryError(null);

    try {
      const data = await fetchApi<{
        courseId?: string;
        summaryText?: string | null;
        message?: string;
        hasData?: boolean;
        sourceData?: Array<{
          term: string | null;
          instructor: string | null;
          metricName: string;
          metricLabel: string;
          metricValue: number;
          respondentCount: number | null;
        }>;
        sourceDataMeta?: {
          totalDataPoints: number;
          returnedDataPoints: number;
          truncated: boolean;
        };
      }>(
        `/api/courses/${encodeURIComponent(courseId)}/eval-summary`
      );

      const derivedHasData =
        typeof data.hasData === "boolean"
          ? data.hasData
          : Array.isArray(data.sourceData)
            ? data.sourceData.length > 0
            : data.sourceDataMeta != null
              ? data.sourceDataMeta.returnedDataPoints > 0
              : Boolean(data.summaryText);

      const summary: CourseSummary = {
        courseId: data.courseId ?? courseId,
        summary: data.summaryText ?? data.message ?? null,
        hasData: derivedHasData,
        sourceData: data.sourceData ?? [],
        sourceDataMeta: data.sourceDataMeta ?? {
          totalDataPoints: 0,
          returnedDataPoints: 0,
          truncated: false,
        },
      };
      setCourseSummary(summary);
      return summary;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch course summary';
      setSummaryError(errorMessage);
      setCourseSummary(null);
      throw err;
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // Get SIS course details (full details on expand)
  const getSisCourseDetails = useCallback(async (courseId: string): Promise<SisCourseDetailsResponse | null> => {
    setSisDetailsLoading(true);
    setSisDetailsError(null);

    try {
      const data = await fetchApi<SisCourseDetailsResponse>(
        `/api/courses/${courseId}/details`
      );

      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch course details';
      setSisDetailsError(errorMessage);
      throw err;
    } finally {
      setSisDetailsLoading(false);
    }
  }, []);

  // Search SIS courses by course number / code prefix
  const searchSisCourses = useCallback(
    async (query: string, limit = 8): Promise<SisCourseSuggestion[]> => {
      const normalized = query.trim();
      if (!normalized) return [];
      const data = await fetchApi<{
        courses?: Array<{ offeringName?: string; title?: string }>;
        error?: string;
      }>(`/api/courses/sis-search-raw?query=${encodeURIComponent(normalized)}&limit=${limit}`);

      const suggestions = (data.courses ?? [])
        .map((course) => ({
          code: course.offeringName ?? "",
          title: course.title ?? "",
        }))
        .filter((course) => course.code !== "")
        .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));

      if ((data.error && suggestions.length === 0)) {
        throw new Error(data.error);
      }

      return suggestions;
    },
    [],
  );

  // Send chat message - NOT IMPLEMENTED YET
  const sendChatMessage = useCallback(async (message: string): Promise<any> => {
    setChatLoading(true);
    setChatError(null);

    try {
      // Simulate a brief delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Add placeholder message to history
      addMessage({
        type: 'conversation',
        prompt: message,
        response: [{
          id: 'placeholder',
          courseCode: '',
          courseTitle: 'AI Chat Feature',
          instructor: '',
          description: 'This will be implemented later',
          credits: undefined,
          workload: undefined,
          difficulty: undefined,
        }],
      });
      
      return { 
        success: true, 
        message: 'This will be implemented later' 
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setChatError(errorMessage);
      throw err;
    } finally {
      setChatLoading(false);
    }
  }, [addMessage]);

  // Clear all errors
  const clearErrors = useCallback(() => {
    setSearchError(null);
    setSummaryError(null);
    setSisDetailsError(null);
    setChatError(null);
    setProfileError(null);
    setProfileSubmitError(null);
    setMemoriesError(null);
  }, []);

  return {
    searchCourses,
    searchResults,
    searchLoading,
    searchError,

    getCourseSummary,
    courseSummary,
    summaryLoading,
    summaryError,

    getSisCourseDetails,
    sisDetailsLoading,
    sisDetailsError,
    searchSisCourses,

    sendChatMessage,
    chatLoading,
    chatError,

    getUserProfile,
    userProfile,
    profileLoading,
    profileError,

    submitUserProfile,
    profileSubmitLoading,
    profileSubmitError,

    getProgramList,

    getUserMemories,
    userMemories,
    memoriesLoading,
    memoriesError,
    deleteUserMemory,
    memoryDeleteId,
    addCourseHistoryMemory,
    clearConversationMemories,
    addManualMemory,

    deleteUserAccount,
    accountDeleteLoading,

    clearErrors,
  };
};
