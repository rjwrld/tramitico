"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/client";

type LinkStatus = "idle" | "sending" | "sent" | "error";
type CodeStatus = "idle" | "verifying" | "error";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<LinkStatus>("idle");
  const [code, setCode] = useState("");
  const [codeStatus, setCodeStatus] = useState<CodeStatus>("idle");

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

  async function verifyCode() {
    if (code.length !== 6) return;
    setCodeStatus("verifying");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: "email",
      email,
      token: code,
    });
    if (error) {
      setCodeStatus("error");
      return;
    }
    router.push("/");
    router.refresh();
  }

  function resetToForm() {
    setStatus("idle");
    setCode("");
    setCodeStatus("idle");
  }

  // Confirmation state: the mail leg went out. The link is the primary path
  // (see /auth/confirm), but a user who opened it in an in-app browser (Gmail
  // / Outlook's embedded webview) lands in a different browser context than
  // the tab they're already in — the emailed code sidesteps that (issue #85).
  if (status === "sent") {
    return (
      <div className="flex w-full flex-col gap-4">
        <p className="text-sm text-muted-foreground" role="status">
          Revise su correo: le enviamos un enlace para entrar. Puede cerrar esta
          página.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void verifyCode();
          }}
          className="flex flex-col gap-3"
        >
          <Field>
            <FieldLabel htmlFor="signin-code">
              ¿Abrió el correo en otro navegador? Ingrese el código.
            </FieldLabel>
            <Input
              id="signin-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              placeholder="123456"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
            />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            disabled={codeStatus === "verifying" || code.length !== 6}
          >
            {codeStatus === "verifying" && <Spinner data-icon="inline-start" />}
            Confirmar código
          </Button>
          {codeStatus === "error" && (
            <p className="text-sm text-destructive" role="alert">
              El código no es válido o venció. Solicite un enlace nuevo e
              intente de nuevo.
            </p>
          )}
        </form>
        <Button
          type="button"
          variant="link"
          className="self-start px-0"
          onClick={resetToForm}
        >
          Solicitar un enlace nuevo
        </Button>
      </div>
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
