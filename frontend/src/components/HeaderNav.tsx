import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";

const navItems = [
  {
    id: "schedule" as const,
    label: "Schedule",
    path: "/schedules",
    isActive: (pathname: string) =>
      pathname === "/schedules" || pathname.startsWith("/schedules/"),
  },
  {
    id: "memory" as const,
    label: "Memory",
    path: "/memories",
    isActive: (pathname: string) => pathname === "/memories",
  },
  {
    id: "preferences" as const,
    label: "Preferences",
    path: "/onboarding",
    isActive: (pathname: string) => pathname === "/onboarding",
  },
];

export default function HeaderNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav className="flex items-center gap-1">
      {navItems.map(({ id, label, path, isActive }) => {
        const active = isActive(pathname);
        return (
          <Button
            key={id}
            type="button"
            variant="ghost"
            size="sm"
            className={
              active
                ? "text-foreground font-medium"
                : "text-muted-foreground font-normal hover:text-foreground"
            }
            onClick={() => {
              if (!active) navigate(path, { state: { returnTo: pathname } });
            }}
          >
            {label}
          </Button>
        );
      })}
    </nav>
  );
}
