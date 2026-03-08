import { useState } from "react";
import { createPortal } from "react-dom";
import { useAtomValue } from "jotai";
import { Bookmark, X } from "lucide-react";

import { shortlistAtom } from "@/store/atoms";
import { ShortlistCard } from "./ShortlistCard";
import { StatsCard } from "./StatsCard";

export function MobileSidebarFAB() {
  const shortlist = useAtomValue(shortlistAtom);
  const [open, setOpen] = useState(false);

  return createPortal(
    <div className="md:hidden">
      {/* Full-screen panel */}
      {open && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-white">
          <div className="p-5 space-y-4 pb-28">
            <h2 className="text-base font-semibold">Shortlist & Stats</h2>
            <ShortlistCard scrollable={false} />
            <StatsCard />
          </div>
        </div>
      )}

      {/* FAB — floats above the search bar; icon toggles Bookmark ↔ X */}
      <div className="fixed z-50 bottom-40 right-5">
        <button
          className="relative flex items-center justify-center w-12 h-12 transition-all bg-white border rounded-full shadow-lg border-border hover:shadow-xl"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close shortlist" : "Open shortlist"}
        >
          {open ? (
            <X className="w-5 h-5 text-foreground" />
          ) : (
            <>
              <Bookmark className="w-5 h-5 text-primary" />
              {shortlist.length > 0 && (
                <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                  {shortlist.length}
                </span>
              )}
            </>
          )}
        </button>
      </div>
    </div>,
    document.body
  );
}
