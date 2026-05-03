import { useState } from "react";
import { useAtomValue } from "jotai";
import { LogOut, Trash2, User } from "lucide-react";

import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";
import HeaderNav from "@/components/HeaderNav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { currentUserAtom } from "@/store/atoms";
import { useAuth } from "@/hooks/useAuth";
import { useApi } from "@/hooks/useApi";

export default function HeaderActions() {
  const currentUser = useAtomValue(currentUserAtom);
  const { login, logout } = useAuth();
  const { deleteUserAccount, accountDeleteLoading } = useApi();
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  const displayName =
    typeof currentUser === "object" && currentUser !== null
      ? (currentUser.name ?? currentUser.email)
      : null;

  const initials =
    typeof currentUser === "object" && currentUser !== null
      ? (currentUser.name ?? currentUser.email).slice(0, 2).toUpperCase()
      : null;

  const picture =
    typeof currentUser === "object" && currentUser !== null
      ? (currentUser.picture ?? null)
      : null;

  return (
    <>
      <div className="flex items-center gap-2">
      <HeaderNav />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="User menu">
            <Avatar className="h-8 w-8">
              {picture && <AvatarImage src={picture} alt={displayName ?? "User"} referrerPolicy="no-referrer" />}
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
          {displayName ? (
            <>
              <DropdownMenuItem onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                onClick={() => {
                  setDeleteAccountError(null);
                  setDeleteAccountOpen(true);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete account
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={login}>
              Sign in
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      </div>

      <DeleteAccountDialog
        open={deleteAccountOpen}
        loading={accountDeleteLoading}
        errorText={deleteAccountError}
        onCancel={() => {
          if (!accountDeleteLoading) {
            setDeleteAccountOpen(false);
            setDeleteAccountError(null);
          }
        }}
        onConfirm={async () => {
          setDeleteAccountError(null);
          try {
            await deleteUserAccount();
            window.location.assign("/");
          } catch {
            setDeleteAccountError("Could not delete account. Try again.");
          }
        }}
      />
    </>
  );
}
