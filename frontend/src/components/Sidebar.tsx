import { MobileSidebarFAB } from "./sidebar/MobileSidebarFAB";
import { ShortlistCard } from "./sidebar/ShortlistCard";
import { StatsCard } from "./sidebar/StatsCard";

export default function Sidebar() {
  return (
    <>
      {/* Desktop sidebar — visibility controlled by .app-sidebar-shell (hidden md:block) */}
      <aside className="sidebar-root">
        <div className="flex flex-col flex-1 gap-4 min-h-0">
          <ShortlistCard />
          <StatsCard />
        </div>
      </aside>

      {/* Mobile floating bubble — portalled to document.body to escape the hidden parent */}
      <MobileSidebarFAB />
    </>
  );
}
