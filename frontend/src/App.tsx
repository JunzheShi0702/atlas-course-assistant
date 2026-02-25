import { useEffect, useState } from "react";

function App() {
  const [backendStatus, setBackendStatus] = useState<string>("checking...");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setBackendStatus(data.message))
      .catch(() => setBackendStatus("cannot reach backend"));
  }, []);

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 600, margin: "80px auto", textAlign: "center" }}>
      <h1>Course Search</h1>
      <p>Hello, team! The starter project is running.</p>
      <p>
        Backend: <strong>{backendStatus}</strong>
      </p>
      <hr />
      <p style={{ color: "#888", fontSize: 14 }}>
        Frontend: React + TypeScript &nbsp;|&nbsp; Backend: Node.js/Express &nbsp;|&nbsp; DB: PostgreSQL + pgvector
      </p>
    </div>
  );
}

export default App;
