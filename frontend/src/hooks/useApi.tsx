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
}

export interface CourseSummary {
  courseId: string;
  summary: string | null;
}

export interface CourseMetrics {
  courseId: string;
  metrics: {
    credit?: number;
    workload?: number;
    difficulty?: number;
  } | null;
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

  getCourseMetrics: (courseId: string) => Promise<CourseMetrics | null>;
  courseMetrics: CourseMetrics | null;
  metricsLoading: boolean;
  metricsError: string | null;

  sendChatMessage: (message: string) => Promise<any>;
  chatLoading: boolean;
  chatError: string | null;

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

  // Course metrics state
  const [courseMetrics, setCourseMetrics] = useState<CourseMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  // Chat state
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Generic fetch wrapper
  const fetchApi = async <T,>(
    url: string,
    options?: RequestInit
  ): Promise<T> => {
    const response = await fetch(url, {
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
  });

  // Search courses — calls backend searchCourseDescriptions via POST /api/search
  const searchCourses = useCallback(async (query: string): Promise<SearchResult[]> => {
    setSearchLoading(true);
    setSearchError(null);

    try {
      const data = await fetchApi<{ results: Array<{
        courseId: string;
        code: string;
        title: string;
        shortDescription?: string;
      }> }>('/api/search', {
        method: 'POST',
        body: JSON.stringify({ query, limit: 5 }),
      });

      const raw = data.results ?? [];
      const results: SearchResult[] = raw.map((r) => ({
        id: r.courseId,
        title: r.title,
        code: r.code,
        description: r.shortDescription ?? '',
        instructor: 'TBD',
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

  // Get course summary
  const getCourseSummary = useCallback(async (courseId: string): Promise<CourseSummary | null> => {
    setSummaryLoading(true);
    setSummaryError(null);

    try {
      const data = await fetchApi<CourseSummary>(
        `/api/courses/${courseId}/summary`
      );

      setCourseSummary(data);
      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch course summary';
      setSummaryError(errorMessage);
      setCourseSummary(null);
      throw err;
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // Get course metrics
  const getCourseMetrics = useCallback(async (courseId: string): Promise<CourseMetrics | null> => {
    setMetricsLoading(true);
    setMetricsError(null);

    try {
      const data = await fetchApi<CourseMetrics>(
        `/api/courses/${courseId}/metrics`
      );

      setCourseMetrics(data);
      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch course metrics';
      setMetricsError(errorMessage);
      setCourseMetrics(null);
      throw err;
    } finally {
      setMetricsLoading(false);
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
    setMetricsError(null);
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

    getCourseMetrics,
    courseMetrics,
    metricsLoading,
    metricsError,

    sendChatMessage,
    chatLoading,
    chatError,

    clearErrors,
  };
};