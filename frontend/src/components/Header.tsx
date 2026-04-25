import { Sparkles } from "lucide-react";

import HeaderActions from "@/components/HeaderActions";

interface HeaderProps {
  title?: string;
}

export default function Header({
  title = "Atlas: Your 24/7 Course Advisor",
}: HeaderProps) {
  return (
    <header className="header-root">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="header-title">
              <span className="sm:hidden">Atlas</span>
              <span className="hidden sm:inline">{title}</span>
            </span>
            <span className="hidden sm:inline text-xs text-muted-foreground">
              Search + AI chat for course guidance
            </span>
          </div>
        </div>

        <HeaderActions />
      </div>
    </header>
  );
}