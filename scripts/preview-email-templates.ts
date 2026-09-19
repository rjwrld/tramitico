/**
 * Render the auth email templates with sample values, so the design can be
 * reviewed without sending one (#350 req. 5).
 *
 *   pnpm email:preview          writes .email-preview/<name>.html, prints paths
 *   pnpm email:preview --text   prints what a client that strips HTML shows
 *
 * The other route is the local stack's Mailpit capture (`supabase status`
 * prints its URL): request a magic link from the app at 127.0.0.1:3000 and
 * open the inbox. That renders through GoTrue itself; this script renders the
 * same file with GoTrue's variables substituted, which is enough for the
 * design pass and needs no stack.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decodeHTML } from "entities";

import {
  loadEmailTemplates,
  REPO_ROOT,
  type EmailTemplate,
} from "./push-email-templates";

/** GoTrue's template variables, with values shaped like the real ones. */
export const SAMPLE_VALUES: Record<string, string> = {
  SiteURL: "https://tramitico.com",
  TokenHash: "pkce_muestra-no-es-un-token-real",
  Token: "482913",
  Email: "usted@ejemplo.cr",
  ConfirmationURL: "https://tramitico.com/auth/confirm?…",
  RedirectTo: "https://tramitico.com/",
};

/** Substitute `{{ .Name }}`; an unknown variable is left visible on purpose. */
export function renderTemplate(
  content: string,
  values: Record<string, string> = SAMPLE_VALUES,
): string {
  return content.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (match, name: string) =>
    name in values ? values[name] : match,
  );
}

/**
 * What a text-only client shows: the document order with tags gone. Style
 * blocks, comments and the hidden preheader are dropped, block boundaries
 * become line breaks, entities are decoded.
 */
export function textRender(html: string): string {
  const BREAK = "\u0000";
  return (
    decodeHTML(
      html
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(style|title)[\s\S]*?<\/\1>/gi, "")
        .replace(/<div[^>]*display:\s*none[\s\S]*?<\/div>/gi, "")
        .replace(/<\/(p|h[1-6]|tr|div|table)>/gi, BREAK)
        .replace(/<br\s*\/?>/gi, BREAK)
        .replace(/<[^>]+>/g, ""),
    )
      .split(BREAK)
      // Source line breaks are the formatter's, not the email's.
      .map((block) => block.replace(/\s+/g, " ").trim())
      .filter((block) => block !== "")
      .join("\n")
  );
}

export const PREVIEW_DIR = path.join(REPO_ROOT, ".email-preview");

function writePreviews(templates: EmailTemplate[]): string[] {
  mkdirSync(PREVIEW_DIR, { recursive: true });
  return templates.map((t) => {
    const file = path.join(PREVIEW_DIR, `${t.name}.html`);
    writeFileSync(file, renderTemplate(t.content));
    return file;
  });
}

function main(argv: string[]): void {
  const templates = loadEmailTemplates();
  if (argv.includes("--text")) {
    for (const t of templates) {
      console.log(`── ${t.name} · Subject: ${t.subject}\n`);
      console.log(textRender(renderTemplate(t.content)));
      console.log();
    }
    return;
  }
  for (const file of writePreviews(templates)) {
    console.log(path.relative(REPO_ROOT, file));
  }
  console.log(
    "\nopen one in a browser; toggle the OS appearance to review the dark render.",
  );
}

if (process.argv[1]?.endsWith("preview-email-templates.ts")) {
  main(process.argv.slice(2));
}
