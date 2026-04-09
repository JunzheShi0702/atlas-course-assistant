import { useAtomValue } from "jotai";
import { Brain, LogOut, Moon, Settings, Sun, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/contexts/ThemeContext";
import { currentUserAtom } from "@/store/atoms";
import { useAuth } from "@/hooks/useAuth";

/**
 * Iteration 2: hide Settings + dark/light toggle until appearance is production-ready.
 * Set to `true` to restore the gear menu and theme switcher.
 */
const SHOW_APPEARANCE_SETTINGS = false;

/** Settings gear + light/dark toggle (mounted only when SHOW_APPEARANCE_SETTINGS is true). */
function AppearanceSettingsDropdown() {
  const { theme, toggleTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Settings">
          <Settings />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={toggleTheme}>
          {theme === "dark" ? (
            <>
              <Sun className="mr-2 h-4 w-4" />
              Light mode
            </>
          ) : (
            <>
              <Moon className="mr-2 h-4 w-4" />
              Dark mode
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function HeaderActions() {
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const currentUser = useAtomValue(currentUserAtom);
  const { login, logout } = useAuth();

  const returnTo = (state as { returnTo?: string } | null)?.returnTo ?? "/";
  const onPreferenceRoute = pathname === "/onboarding";

  const goToPreferences = () => {
    navigate("/onboarding", { state: { returnTo: pathname } });
  };

  const goToMemories = () => {
    navigate("/memories", { state: { returnTo: pathname } });
  };

  const goBack = () => {
    navigate(returnTo);
  };

  const displayName =
    typeof currentUser === "object" && currentUser !== null
      ? (currentUser.name ?? currentUser.email)
      : null;

  const initials =
    typeof currentUser === "object" && currentUser !== null
      ? (currentUser.name ?? currentUser.email).slice(0, 2).toUpperCase()
      : null;

  return (
    <div className="flex items-center gap-2">
      {SHOW_APPEARANCE_SETTINGS ? <AppearanceSettingsDropdown /> : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="User menu">
            <Avatar className="h-8 w-8">
              <AvatarFallback>
                {initials ?? <User className="h-4 w-4" />}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {displayName ? (
            <>
              <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          ) : (
            <>
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          {onPreferenceRoute ? (
            <>
              <DropdownMenuItem onClick={goToMemories}>
                <Brain className="mr-2 h-4 w-4" />
                Saved memories
              </DropdownMenuItem>
              <DropdownMenuItem onClick={goBack}>
                Back to Home
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onClick={goToMemories}>
                <Brain className="mr-2 h-4 w-4" />
                Saved memories
              </DropdownMenuItem>
              <DropdownMenuItem onClick={goToPreferences}>
                Preferences
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          {displayName ? (
            <DropdownMenuItem onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={login}>
              Sign in
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
