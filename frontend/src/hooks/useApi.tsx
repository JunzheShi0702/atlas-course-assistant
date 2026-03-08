import { useState, useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { addMessageAtom, CourseCard } from '../store/atoms';

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
}

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

  sendChatMessage: (message: string) => Promise<any>;
  chatLoading: boolean;
  chatError: string | null;

  clearErrors: () => void;
}

// In production (e.g. Render): set VITE_API_URL to backend origin so API calls go directly (Rewrite often only forwards GET).
// In dev: leave unset so requests are relative and Vite proxy forwards /api to backend.
const API_BASE = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL ?? '').replace(/\/$/, '');

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

  // Generic fetch wrapper
  const fetchApi = async <T,>(
    url: string,
    options?: RequestInit
  ): Promise<T> => {
    const fullUrl = API_BASE ? `${API_BASE}${url}` : url;
    const response = await fetch(fullUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

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

    return response.json();
  };

  // Convert SearchResult to CourseCard
  const convertToCourseCard = (result: SearchResult): CourseCard => ({
    id: result.id,
    courseCode: result.code || 'N/A',
    courseTitle: result.title,
    instructor: result.instructor || 'TBD',
    description: result.description || 'No description available',
    credits: result.credits,
    workload: result.workload,
    difficulty: result.difficulty,
    matchReasoning: result.matchExplanation,
  });

  // Search courses — calls POST /api/agent (single entry point for search/summary/details)
  const searchCourses = useCallback(async (query: string): Promise<SearchResult[]> => {
    setSearchLoading(true);
    setSearchError(null);

    try {
      const data = await fetchApi<{ type: string; results?: Array<{
        courseId: string;
        code: string;
        title: string;
        shortDescription?: string;
        term?: string;
        rank?: number | null;
        relevanceScore?: number | null;
      }>; message?: string; error?: string }>(`/api/agent`, {
        method: 'POST',
        body: JSON.stringify({ message: query }),
      });

      if (data.type === 'error' && data.error) {
        throw new Error(data.error);
      }

      const raw = data.type === 'search' && data.results ? data.results : [];
      const results: SearchResult[] = raw.map((r) => ({
        id: r.courseId,
        title: r.title,
        code: r.code,
        description: r.shortDescription ?? '',
        matchExplanation: undefined,
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

  // Get course summary (backend: GET /api/courses/:id/eval-summary)
  const getCourseSummary = useCallback(async (courseId: string): Promise<CourseSummary | null> => {
    setSummaryLoading(true);
    setSummaryError(null);

    try {
      const data = await fetchApi<{ courseId: string; summaryText?: string | null; hasData?: boolean }>(
        `/api/courses/${courseId}/eval-summary`
      );

      const summary: CourseSummary = { courseId: data.courseId, summary: data.summaryText ?? null };
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

    sendChatMessage,
    chatLoading,
    chatError,

    clearErrors,
  };
};