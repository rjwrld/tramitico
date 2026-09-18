/**
 * One source of truth for the auth emails (#350).
 *
 * `supabase/config.toml` declares each `[auth.email.template.<name>]` with a
 * subject and a `content_path` under `supabase/templates/`; the local stack
 * reads them itself. The hosted project cannot — `supabase config push` is
 * forbidden there (it would upload the localhost `site_url`; see the warning
 * beside `[auth.email.smtp]`), and the #29 template was hand-pasted into the
 * dashboard, so the two copies could drift with nothing in the repo knowing
 * what production sent.
 *
 * This script closes that gap through the Management API's auth-config
 * endpoint, sending **only** the `mailer_subjects_*` and
 * `mailer_templates_*_content` keys the declared templates map to — never
 * `site_url`, never the redirect list, never anything the dashboard owns.
 *
 *   pnpm email:push           PATCH the declared templates to the project
 *   pnpm email:push --check   GET the project's templates and exit 1 on drift
 *
 * Both read `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` (a personal
 * access token, never committed) from the environment; the deploy wizard's
 * stage 9 captures them into `.env.prod`. `--check` is what the runbook says
 * to run when a magic link looks wrong: it answers "is production sending the
 * file in git?" without touching anything.
 *
 * The functions are pure (a `fetch` in, a result out) so the unit lane can pin
 * the payload shape without a token; `main` at the bottom is the only thing
 * that reads the environment.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The template names GoTrue knows, as `config.toml` spells them. The
 * Management API keys are derived: `mailer_subjects_<name>` and
 * `mailer_templates_<name>_content`. A section for any other name is a typo
 * and fails the load rather than becoming a silently-ignored key.
 */
export const TEMPLATE_NAMES = [
  "confirmation",
  "invite",
  "magic_link",
  "recovery",
  "email_change",
  "reauthentication",
] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export interface EmailTemplate {
  name: TemplateName;
  subject: string;
  /** As written in config.toml, relative to the repo root. */
  contentPath: string;
  /** The file's bytes, verbatim — what the project will send. */
  content: string;
}

/** The two keys one declared template becomes. */
export function templateKeys(name: TemplateName): {
  subject: `mailer_subjects_${TemplateName}`;
  content: `mailer_templates_${TemplateName}_content`;
} {
  return {
    subject: `mailer_subjects_${name}`,
    content: `mailer_templates_${name}_content`,
  };
}

const isTemplateName = (s: string): s is TemplateName =>
  (TEMPLATE_NAMES as readonly string[]).includes(s);

/**
 * Pull every active `[auth.email.template.<name>]` section out of a
 * config.toml. Deliberately not a TOML parser: the sections are flat
 * `key = "string"` pairs, and commented-out sections (`# [auth.email.template.
 * invite]`, as the CLI's scaffold leaves them) must not count.
 */
export function parseTemplateSections(
  toml: string,
): Array<{ name: TemplateName; subject: string; contentPath: string }> {
  const sections: Array<{
    name: TemplateName;
    subject?: string;
    contentPath?: string;
  }> = [];
  let current: (typeof sections)[number] | null = null;

  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const name = /^auth\.email\.template\.(\w+)$/.exec(header[1])?.[1];
      if (name === undefined) {
        current = null;
      } else if (!isTemplateName(name)) {
        throw new Error(
          `config.toml: [auth.email.template.${name}] is not a template GoTrue knows ` +
            `(${TEMPLATE_NAMES.join(", ")})`,
        );
      } else {
        current = { name };
        sections.push(current);
      }
      continue;
    }
    if (!current) continue;
    const pair = /^(\w+)\s*=\s*"([^"]*)"/.exec(line);
    if (!pair) continue;
    if (pair[1] === "subject") current.subject = pair[2];
    if (pair[1] === "content_path") current.contentPath = pair[2];
  }

  return sections.map((s) => {
    if (!s.subject || !s.contentPath) {
      throw new Error(
        `config.toml: [auth.email.template.${s.name}] needs both subject and content_path`,
      );
    }
    return { name: s.name, subject: s.subject, contentPath: s.contentPath };
  });
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..");

/** The declared templates with their files read, from the repo's config.toml. */
export function loadEmailTemplates(root: string = REPO_ROOT): EmailTemplate[] {
  const toml = readFileSync(path.join(root, "supabase/config.toml"), "utf8");
  return parseTemplateSections(toml).map((s) => ({
    ...s,
    content: readFileSync(path.resolve(root, s.contentPath), "utf8"),
  }));
}

/**
 * The PATCH body: exactly the subject and content keys of the declared
 * templates, nothing else. Sorted so a diff of two payloads is readable.
 */
export function templatePayload(
  templates: EmailTemplate[],
): Record<string, string> {
  const entries = templates.flatMap((t) => {
    const keys = templateKeys(t.name);
    return [
      [keys.subject, t.subject],
      [keys.content, t.content],
    ] as const;
  });
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

/** The slice of `fetch` this needs — the global one, or a stand-in in tests. */
export type Fetcher = (
  url: string,
  init: {
    method: "GET" | "PATCH";
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ProjectAuth {
  ref: string;
  token: string;
}

export const MANAGEMENT_API = "https://api.supabase.com";

const authConfigUrl = (ref: string) =>
  `${MANAGEMENT_API}/v1/projects/${encodeURIComponent(ref)}/config/auth`;

async function failed(
  what: string,
  res: { status: number; text(): Promise<string> },
) {
  // The body of an auth-config error names a field, never a secret; the token
  // only ever travels in the request header, which is not echoed back.
  const body = (await res.text()).slice(0, 500);
  return new Error(`${what}: HTTP ${res.status}${body ? ` — ${body}` : ""}`);
}

/** PATCH the declared templates. Returns the keys that were sent. */
export async function pushEmailTemplates(
  project: ProjectAuth,
  templates: EmailTemplate[],
  fetcher: Fetcher = globalThis.fetch as unknown as Fetcher,
): Promise<{ keys: string[] }> {
  const payload = templatePayload(templates);
  const res = await fetcher(authConfigUrl(project.ref), {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${project.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await failed("pushing email templates", res);
  return { keys: Object.keys(payload) };
}

export interface TemplateDrift {
  key: string;
  /** What the project holds; `null` when the key is absent (Supabase default). */
  remote: string | null;
  local: string;
}

/**
 * GET the project's auth config and compare the template keys with the
 * repo's. Read-only: the answer to "is production sending what git holds?".
 */
export async function checkEmailTemplates(
  project: ProjectAuth,
  templates: EmailTemplate[],
  fetcher: Fetcher = globalThis.fetch as unknown as Fetcher,
): Promise<{ drift: TemplateDrift[] }> {
  const res = await fetcher(authConfigUrl(project.ref), {
    method: "GET",
    headers: { authorization: `Bearer ${project.token}` },
  });
  if (!res.ok) throw await failed("reading email templates", res);
  const remote = JSON.parse(await res.text()) as Record<string, unknown>;
  const drift: TemplateDrift[] = [];
  for (const [key, local] of Object.entries(templatePayload(templates))) {
    const value = remote[key];
    const current = typeof value === "string" ? value : null;
    if (current !== local) drift.push({ key, remote: current, local });
  }
  return { drift };
}

function projectFromEnv(): ProjectAuth {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) {
    throw new Error(
      "SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required " +
        "(the deploy wizard's stage 9 writes both to .env.prod: `set -a; source .env.prod`).",
    );
  }
  return { ref, token };
}

async function main(argv: string[]): Promise<void> {
  const check = argv.includes("--check");
  const templates = loadEmailTemplates();
  console.log(
    `${templates.length} template(s) declared in supabase/config.toml: ` +
      templates.map((t) => `${t.name} ← ${t.contentPath}`).join(", "),
  );
  const project = projectFromEnv();

  if (check) {
    const { drift } = await checkEmailTemplates(project, templates);
    if (drift.length === 0) {
      console.log(`project ${project.ref} sends exactly what git holds.`);
      return;
    }
    for (const d of drift) {
      console.error(
        `DRIFT ${d.key}: ${d.remote === null ? "not set on the project (Supabase default)" : `${d.remote.length} chars on the project vs ${d.local.length} in git`}`,
      );
    }
    console.error(
      `\nrun \`pnpm email:push\` to make the project send git's copy.`,
    );
    process.exit(1);
  }

  const { keys } = await pushEmailTemplates(project, templates);
  console.log(`pushed to project ${project.ref}:\n  ${keys.join("\n  ")}`);
}

if (process.argv[1]?.endsWith("push-email-templates.ts")) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
