import { Brain, CalendarDays, ClipboardList, Navigation } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navItems = [
  {
    id: "schedule" as const,
    label: "Schedule",
    path: "/schedules",
    icon: CalendarDays,
    isActive: (pathname: string) =>
      pathname === "/schedules" || pathname.startsWith("/schedules/"),
  },
  {
    id: "memory" as const,
    label: "Memory",
    path: "/memories",
    icon: Brain,
    isActive: (pathname: string) => pathname === "/memories",
  },
  {
    id: "survey" as const,
    label: "Survey",
    path: "/onboarding",
    icon: ClipboardList,
    isActive: (pathname: string) => pathname === "/onboarding",
  },
];

export default function HeaderNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label="Open site navigation"
        >
          <Navigation className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {navItems.map(({ id, label, path, icon: Icon, isActive }) => {
          const active = isActive(pathname);
          return (
            <DropdownMenuItem
              key={id}
              disabled={active}
              onClick={() => {
                if (!active) {
                  navigate(path, { state: { returnTo: pathname } });
                }
              }}
            >
              <Icon className="mr-2 h-4 w-4 shrink-0" />
              {label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
