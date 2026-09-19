// Two guards for the auth emails (#350). The template contract: the file the
// hosted project sends must carry the two Go-template expressions the app
// depends on, and not the default's `{{ .ConfirmationURL }}`, whose route
// bypasses /auth/confirm. The push contract: the Management API call sends
// the mailer keys and nothing else — `site_url` or the redirect list in that
// body is exactly the #29 localhost overwrite the config-push ban exists for.
import { describe, expect, it } from "vitest";

import { renderTemplate, textRender } from "./preview-email-templates";
import {
  checkEmailTemplates,
  type EmailTemplate,
  type Fetcher,
  loadEmailTemplates,
  MANAGEMENT_API,
  parseTemplateSections,
  pushEmailTemplates,
  templatePayload,
} from "./push-email-templates";

/** The link src/app/auth/confirm/route.ts verifies, exactly as it must appear. */
const LINK =
  "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/";

const templates = loadEmailTemplates();

describe("the declared templates", () => {
  it("cover the magic link and the confirmation email", () => {
    expect(templates.map((t) => t.name).sort()).toEqual([
      "confirmation",
      "magic_link",
    ]);
  });

  it.each(templates.map((t) => [t.name, t]))(
    "%s carries the link and the code the app depends on",
    (_name, t) => {
      expect(t.content).toContain(LINK);
      expect(t.content).toContain("{{ .Token }}");
      expect(t.content).not.toContain("{{ .ConfirmationURL }}");
    },
  );

  it.each(templates.map((t) => [t.name, t]))(
    "%s is email-safe: no CSS custom properties, nothing fetched",
    (_name, t) => {
      // No `var(--x)` — email clients have no custom properties; DESIGN's
      // tokens appear as literal hex.
      expect(t.content).not.toMatch(/var\(--/);
      // No remote font, image or stylesheet: opening the mail fetches nothing.
      expect(t.content).not.toMatch(/<(img|link)\b/i);
      expect(t.content).not.toMatch(/@import|url\(/i);
      // Every visible string in Spanish, usted: no tú-register verbs.
      expect(textRender(t.content)).not.toMatch(/\b(haz|abre|ingresa|usa)\b/i);
    },
  );

  it("renders with sample values and leaves no variable behind", () => {
    for (const t of templates) {
      const html = renderTemplate(t.content);
      expect(html).not.toContain("{{");
      expect(html).toContain(
        "https://tramitico.com/auth/confirm?token_hash=pkce_",
      );
      const text = textRender(html);
      // Stripped of tags, the document still reads as the email in order:
      // link first, then the code as the second path.
      expect(text.indexOf("Iniciar sesión")).toBeLessThan(
        text.indexOf("482913"),
      );
      expect(text).not.toContain("<");
    }
  });
});

describe("parseTemplateSections", () => {
  it("reads active sections and skips commented-out ones", () => {
    const toml = `
[auth.email]
enable_signup = true

# [auth.email.template.invite]
# subject = "You have been invited"
# content_path = "./supabase/templates/invite.html"

[auth.email.template.magic_link]
subject = "Su enlace"
content_path = "./supabase/templates/magic_link.html"

[auth.sms]
enable_signup = false
`;
    expect(parseTemplateSections(toml)).toEqual([
      {
        name: "magic_link",
        subject: "Su enlace",
        contentPath: "./supabase/templates/magic_link.html",
      },
    ]);
  });

  it("rejects a template name GoTrue does not know", () => {
    expect(() =>
      parseTemplateSections(
        `[auth.email.template.magik_link]\nsubject = "x"\ncontent_path = "y"\n`,
      ),
    ).toThrow(/magik_link/);
  });

  it("rejects a section missing its subject or path", () => {
    expect(() =>
      parseTemplateSections(`[auth.email.template.recovery]\nsubject = "x"\n`),
    ).toThrow(/recovery/);
  });
});

const fixture: EmailTemplate[] = [
  {
    name: "magic_link",
    subject: "Su enlace",
    contentPath: "./supabase/templates/magic_link.html",
    content: "<p>{{ .Token }}</p>",
  },
  {
    name: "confirmation",
    subject: "Confirme",
    contentPath: "./supabase/templates/magic_link.html",
    content: "<p>{{ .Token }}</p>",
  },
];

describe("templatePayload", () => {
  it("is exactly the mailer subject and content keys", () => {
    expect(templatePayload(fixture)).toEqual({
      mailer_subjects_confirmation: "Confirme",
      mailer_subjects_magic_link: "Su enlace",
      mailer_templates_confirmation_content: "<p>{{ .Token }}</p>",
      mailer_templates_magic_link_content: "<p>{{ .Token }}</p>",
    });
  });
});

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function recorder(
  answer: { ok: boolean; status: number; body: string },
  calls: Call[],
): Fetcher {
  return async (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    return {
      ok: answer.ok,
      status: answer.status,
      text: async () => answer.body,
    };
  };
}

const project = { ref: "abcdefghijklmnopqrst", token: "sbp_test" };

describe("pushEmailTemplates", () => {
  it("PATCHes the auth config with the mailer keys only", async () => {
    const calls: Call[] = [];
    const result = await pushEmailTemplates(
      project,
      fixture,
      recorder({ ok: true, status: 200, body: "{}" }, calls),
    );

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(
      `${MANAGEMENT_API}/v1/projects/${project.ref}/config/auth`,
    );
    expect(call.headers.authorization).toBe("Bearer sbp_test");
    expect(call.headers["content-type"]).toBe("application/json");

    const body = JSON.parse(call.body ?? "{}") as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual([
      "mailer_subjects_confirmation",
      "mailer_subjects_magic_link",
      "mailer_templates_confirmation_content",
      "mailer_templates_magic_link_content",
    ]);
    // The #29 overwrite, in one assertion: none of the URL configuration.
    for (const forbidden of [
      "site_url",
      "uri_allow_list",
      "external_github_secret",
      "smtp_pass",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
    expect(result.keys).toEqual(Object.keys(body));
  });

  it("names the HTTP status when the API refuses", async () => {
    await expect(
      pushEmailTemplates(
        project,
        fixture,
        recorder(
          { ok: false, status: 401, body: '{"message":"Unauthorized"}' },
          [],
        ),
      ),
    ).rejects.toThrow(/HTTP 401.*Unauthorized/);
  });
});

describe("checkEmailTemplates", () => {
  it("GETs, never PATCHes, and reports the keys that differ", async () => {
    const calls: Call[] = [];
    const remote = {
      site_url: "https://tramitico.com",
      mailer_subjects_magic_link: "Su enlace",
      mailer_templates_magic_link_content: "<p>{{ .Token }}</p>",
      mailer_subjects_confirmation: "Confirm your signup",
      mailer_templates_confirmation_content: null,
    };
    const { drift } = await checkEmailTemplates(
      project,
      fixture,
      recorder({ ok: true, status: 200, body: JSON.stringify(remote) }, calls),
    );

    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    expect(calls[0].body).toBeUndefined();
    expect(drift).toEqual([
      {
        key: "mailer_subjects_confirmation",
        remote: "Confirm your signup",
        local: "Confirme",
      },
      {
        key: "mailer_templates_confirmation_content",
        remote: null,
        local: "<p>{{ .Token }}</p>",
      },
    ]);
  });

  it("reports no drift when the project holds git's copy", async () => {
    const { drift } = await checkEmailTemplates(
      project,
      fixture,
      recorder(
        {
          ok: true,
          status: 200,
          body: JSON.stringify(templatePayload(fixture)),
        },
        [],
      ),
    );
    expect(drift).toEqual([]);
  });
});
