"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function sendMagicLink() {
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ email });
    setStatus(error ? "error" : "sent");
  }

  async function signInWithProvider(provider: "google" | "github") {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      // Must match config.toml's additional_redirect_urls EXACTLY — no query
      // params, or the auth server falls back to the bare site_url and the
      // code never gets exchanged.
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setStatus("error");
  }

  if (status === "sent") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Revise su correo: le enviamos un enlace para entrar. Puede cerrar esta
        página.
      </p>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void sendMagicLink();
        }}
        className="flex flex-col gap-3"
      >
        <Field>
          <FieldLabel htmlFor="signin-email">Correo electrónico</FieldLabel>
          <Input
            id="signin-email"
            type="email"
            required
            autoComplete="email"
            placeholder="nombre@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          disabled={status === "sending"}
        >
          {status === "sending" && <Spinner data-icon="inline-start" />}
          Enviar enlace
        </Button>
      </form>
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">o</span>
        <Separator className="flex-1" />
      </div>
      {/* Google above GitHub — decision 1, issue #84: the wider audience finds
          theirs first; devs reliably scan one row down. Outline + text satisfies
          Google's branding guidelines without a coloured button. */}
      <Button
        type="button"
        variant="outline"
        onClick={() => signInWithProvider("google")}
      >
        Continuar con Google
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => signInWithProvider("github")}
      >
        Continuar con GitHub
      </Button>
      {status === "error" && (
        <p className="text-sm text-destructive" role="alert">
          No se pudo iniciar sesión. Intente de nuevo.
        </p>
      )}
    </div>
  );
}
