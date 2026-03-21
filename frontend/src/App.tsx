import { useAtomValue } from "jotai";
import { useRef } from "react";
import TextArea from "@/components/TextArea";
import Header from "@/components/Header";
import HistoryView from "@/components/HistoryView";
import Sidebar from "@/components/Sidebar";
import { useApi } from "@/hooks/useApi";
import { historyAtom } from "@/store/atoms";

export default function App() {
  const {
    searchCourses,
    searchLoading,
    searchError,
  } = useApi();

  const history = useAtomValue(historyAtom);
  const lastQueryRef = useRef<string>("");

  const handleSearch = async (query: string): Promise<void> => {
    lastQueryRef.current = query;
    try {
      await searchCourses(query);
    } catch (err) {
      console.error('Search failed:', err);
    }
  };

  const handleRetry = () => {
    if (lastQueryRef.current) handleSearch(lastQueryRef.current);
  };

  return (
    <div className="app-root">
      {/* Header - Fixed Height */}
      <Header title="Atlas: Your 24/7 Course Advisor" />

      {/* Main Container - Split Layout - Takes remaining height */}
      <div className="app-main-layout">
        {/* Left Column - Main Content (2/3) */}
        <main className="app-main-content">
          {/* Content Area - Scrollable */}
          <div className="app-main-scroll">
            <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col space-y-4">
              {/* Main content: welcome, or history (also shown when loading/error on first query) */}
              {history.length === 0 && !searchLoading && !searchError ? (
                <div className="flex flex-1 items-center justify-center py-8">
                  <div className="max-w-md text-center space-y-3">
                    <h2 className="text-2xl font-semibold tracking-tight">Welcome to Atlas</h2>
                    <p className="text-sm text-muted-foreground">
                      Use the box below to search for specific courses by name or code, or describe what you’re
                      looking for and let the AI recommend options. Your recent questions and results will appear
                      here as a history.
                    </p>
                  </div>
                </div>
              ) : (
                <HistoryView loading={searchLoading} error={searchError} onRetry={handleRetry} />
              )}
            </div>
          </div>

          {/* TextArea - Fixed at bottom of left column */}
          <div className="flex-shrink-0">
            <TextArea onSearch={handleSearch} loading={searchLoading} />
          </div>
        </main>

        {/* Right Column - Sidebar (1/3) - Full height with internal scroll */}
        <div className="app-sidebar-shell">
          <Sidebar />
        </div>
      </div>
    </div>
  );
}