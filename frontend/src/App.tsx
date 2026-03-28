import { useStore } from "@nanostores/react";
import { useAtomValue } from "jotai";
import { useRef } from "react";
import TextArea from "@/components/TextArea";
import Header from "@/components/Header";
import HistoryView from "@/components/HistoryView";
import Onboard from "@/components/Onboard";
import Sidebar from "@/components/Sidebar";
import { useApi } from "@/hooks/useApi";
import { $router } from "@/lib/router";
import { historyAtom } from "@/store/atoms";

function HomePage() {
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
      console.error("Search failed:", err);
    }
  };

  const handleRetry = () => {
    if (lastQueryRef.current) handleSearch(lastQueryRef.current);
  };

  return (
    <>
      <div className="app-main-layout">
        <main className="app-main-content">
          <div className="app-main-scroll">
            <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col space-y-4">
              {history.length === 0 && !searchLoading && !searchError ? (
                <div className="flex flex-1 items-center justify-center py-8">
                  <div className="max-w-md text-center space-y-3">
                    <h2 className="text-2xl font-semibold tracking-tight">
                      Welcome to Atlas
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Use the box below to search for specific courses by name or
                      code, or describe what you're looking for and let the AI
                      recommend options. Your recent questions and results will
                      appear here as a history.
                    </p>
                  </div>
                </div>
              ) : (
                <HistoryView
                  loading={searchLoading}
                  error={searchError}
                  onRetry={handleRetry}
                />
              )}
            </div>
          </div>

          <div className="shrink-0">
            <TextArea onSearch={handleSearch} loading={searchLoading} />
          </div>
        </main>

        <div className="app-sidebar-shell">
          <Sidebar />
        </div>
      </div>
    </>
  );
}

export default function App() {
  const page = useStore($router);

  return (
    <div className="app-root">
      <Header
        title={
          page?.route === "onboard"
            ? "Atlas: Preference Survey"
            : "Atlas: Your 24/7 Course Advisor"
        }
      />

      {page?.route === "onboard" ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <Onboard />
        </div>
      ) : (
        <HomePage />
      )}
    </div>
  );
}
