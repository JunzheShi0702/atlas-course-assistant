import { useEffect, useState } from "react";
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import DualTextArea from './components/DualTextArea';

const App: React.FC = () => {
  const [backendStatus, setBackendStatus] = useState<string>("checking...");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setBackendStatus(data.message))
      .catch(() => setBackendStatus("cannot reach backend"));
  }, []);

  const handleSearch = (query: string): void => {
    console.log('Performing search for:', query);
    // Implement your search logic here
  };

  const handleSendMessage = (message: string): void => {
    console.log('Sending message:', message);
    // Implement your AI chat logic here
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
            <div className="app-main-inner">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Welcome</h2>
              <p className="text-gray-600 text-lg mb-8">
                Use the search bar below to find information or chat with our AI assistant.
              </p>
              <p>Hello, team! The starter project is running.</p>
              <p>
                Backend: <strong>{backendStatus}</strong>
              </p>
              <hr />
              <p style={{ color: "#888", fontSize: 14 }}>
                Frontend: React + TypeScript &nbsp;|&nbsp; Backend: Node.js/Express &nbsp;|&nbsp; DB: PostgreSQL + pgvector
              </p>
            </div>
          </div>

          {/* DualTextArea - Fixed at bottom with padding */}
          <div className="flex-shrink-0">
            <DualTextArea onSearch={handleSearch} onSendMessage={handleSendMessage} />
          </div>
        </main>

        {/* Right Column - Sidebar (1/3) - Full height with internal scroll */}
        <div className="app-sidebar-shell">
          <Sidebar />
        </div>
      </div>
    </div>
  );
};

export default App;