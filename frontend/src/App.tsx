import Header from "@/components/Header";
import Onboard from "@/components/Onboard";

export default function App() {
  return (
    <div className="app-root">
      <Header />
      <div className="flex-1 min-h-0 flex flex-col">
        <Onboard />
      </div>
    </div>
  );
}
