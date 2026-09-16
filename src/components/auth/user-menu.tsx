"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
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
          <Button
            variant="ghost"
            size="icon"
            className="pointer-coarse:size-11"
            aria-label="Cuenta"
          >
            <Avatar className="size-7">
              <AvatarFallback>{(email[0] ?? "?").toUpperCase()}</AvatarFallback>
            </Avatar>
          </Button>
        }
      />
      {/* Explicit width: the popup otherwise sizes to its anchor — the 2rem
          avatar button, floored at min-w-32 — and the inline confirm below
          overflowed it sideways, so a focused button scrolled the prompt out
          of view (#29 acceptance pass). 16rem fits the truncated email label
          and the confirm's wrapped button row. */}
      <DropdownMenuContent align="end" className="w-64">
        {/* GroupLabel requires a Group ancestor (Base UI MenuGroupContext). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="max-w-56 truncate">
            {email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>Cerrar sesión</DropdownMenuItem>
          {confirmingDelete ? (
            // Shared inline confirm, same component as the history-item
            // delete (issue #110): explicit-verb tinted destructive confirm
            // per DESIGN §2 red discipline, never a browser confirm(). Copy
            // states plainly what happens; no apology theater (DESIGN §9).
            <ConfirmInline
              prompt="Esto elimina su cuenta y todo su historial. No se puede deshacer."
              confirmLabel="Eliminar cuenta y todo el historial"
              disabled={deleting}
              onConfirm={() => void deleteAccount()}
              onCancel={() => setConfirmingDelete(false)}
            />
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
