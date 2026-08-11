"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";

export function UserMenu({ email }: { email: string }) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  // Deleting the auth user needs the service role, so the actual delete
  // happens server-side (issue #86) — this only calls it, then cleans up the
  // client the same way signOut does.
  async function deleteAccount() {
    setDeleting(true);
    try {
      const response = await fetch("/api/account/delete", { method: "POST" });
      if (!response.ok) throw new Error(String(response.status));
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
      router.refresh();
      toast.success("Su cuenta y su historial fueron eliminados.");
    } catch {
      setDeleting(false);
      setConfirmingDelete(false);
      toast.error("No se pudo eliminar la cuenta. Intente de nuevo.");
    }
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) setConfirmingDelete(false);
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Cuenta">
            <Avatar className="size-7">
              <AvatarFallback>{(email[0] ?? "?").toUpperCase()}</AvatarFallback>
            </Avatar>
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {/* GroupLabel requires a Group ancestor (Base UI MenuGroupContext). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="max-w-56 truncate">
            {email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>Cerrar sesión</DropdownMenuItem>
          {confirmingDelete ? (
            // Inline confirm, same pattern as the history-item delete
            // (history-sidebar.tsx): explicit-verb filled destructive
            // confirm per DESIGN §2 red discipline, never a browser
            // confirm(). Copy states plainly what happens; no apology
            // theater (DESIGN §9).
            <div className="flex flex-col gap-2 rounded-md border border-destructive/30 p-2">
              <p className="text-xs text-destructive">
                Esto elimina su cuenta y todo su historial. No se puede
                deshacer.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="xs"
                  disabled={deleting}
                  onClick={() => void deleteAccount()}
                >
                  Eliminar cuenta y todo el historial
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={deleting}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              closeOnClick={false}
              onClick={() => setConfirmingDelete(true)}
            >
              Eliminar cuenta
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
