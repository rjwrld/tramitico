import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * scripts/recrawl.sh (#405) hands production secrets to `pnpm ingest`. The
 * end-to-end tests run a copy of it in a throwaway checkout of a bare
 * "origin"; the others source it, which defines its functions and runs
 * nothing. Either way `pnpm` is a stub that records its argv and its whole
 * environment, and every value is a placeholder. macOS's /bin/bash is 3.2 —
 * what the script meets on a Mac without Homebrew's bash — so it runs there
 * too.
 */
const SCRIPT = path.join(__dirname, "recrawl.sh");
const SHELLS = [
  "bash",
  ...(process.platform === "darwin" ? ["/bin/bash"] : []),
];

// `pnpm install` rewrites the env file in the checkout it runs in, so the
// value the ingest receives shows whether the file was read before or after
// the install.
const STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
fs.appendFileSync(
  path.join(__dirname, "calls.jsonl"),
  JSON.stringify({ argv, env: process.env }) + "\\n",
);
if (argv[0] === "install" && fs.existsSync(".env.prod")) {
  const text = fs.readFileSync(".env.prod", "utf8");
  fs.writeFileSync(".env.prod", text.replace("=read-before-install", "=read-after-install"));
}
`;

// Placeholders only: nothing here is, or looks like, a real key.
const envFile = (sentinels: string[] = []) =>
  [
    "# the deploy wizard's capture, placeholders",
    "SUPABASE_DB_PASSWORD=fixture-db-password",
    "SUPABASE_URL=https://fixture.invalid",
    "SUPABASE_SERVICE_ROLE_KEY=fixture-service-role",
    "export VOYAGE_API_KEY=read-before-install",
    `ANTHROPIC_API_KEY=\`touch ${sentinels[0] ?? "unused"}\``,
    `SMTP_PASS=$(touch ${sentinels[1] ?? "unused"})`,
    `touch ${sentinels[2] ?? "unused"}`,
    "EMBEDDINGS_PROVIDER=stub",
    "",
  ].join("\n");
const DECOYS = [
  "SUPABASE_DB_PASSWORD",
  "ANTHROPIC_API_KEY",
  "SMTP_PASS",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VOYAGE_API_KEY",
];

type Call = { argv: string[]; env: Record<string, string> };

let dir: string;
let bin: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "recrawl-test-"));
  bin = path.join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "pnpm"), STUB);
  chmodSync(path.join(bin, "pnpm"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** What the stub recorded, in order; [] when pnpm never ran. */
function calls(): Call[] {
  const log = path.join(bin, "calls.jsonl");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .trimEnd()
    .split("\n")
    .map((l) => {
      const call = JSON.parse(l) as Call;
      // CoreFoundation sets this in every process on macOS; not ours to pass.
      delete call.env.__CF_USER_TEXT_ENCODING;
      return call;
    });
}

function spawn(
  shell: string,
  args: string[],
  env: Record<string, string>,
  cwd: string,
) {
  // The env is the whole of it: nothing inherited, so no NODE_ENV either.
  return spawnSync(shell, args, {
    cwd,
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
}

/** Sources recrawl.sh in `shell`, then runs `snippet` with `set -e` off. */
const sourced = (shell: string, snippet: string, env: Record<string, string>) =>
  spawn(
    shell,
    ["-c", `source "$1"; set +e; ${snippet}`, "recrawl-test", SCRIPT],
    env,
    dir,
  );

describe.each(SHELLS)("recrawl.sh under %s", (shell) => {
  describe("env_file_value", () => {
    it("reads values without executing the file", () => {
      const ran = path.join(dir, "ran");
      const substituted = path.join(dir, "substituted");
      const file = path.join(dir, "env");
      writeFileSync(
        file,
        [
          "# comment",
          "PLAIN=https://fixture.invalid",
          "export EXPORTED=exported-value",
          '  INDENTED="indented value"',
          "SINGLE='single $HOME'",
          "TRAILING=plain # a trailing comment",
          'QUOTED_TRAILING="quoted" # comment',
          "HASH_INSIDE=a#b",
          "CRLF=crlf-value\r",
          "DUP=first",
          "DUP=second",
          "EMPTY=",
          `SUBSTITUTION=$(touch ${substituted})`,
          `touch ${ran}`,
          "#COMMENTED=commented",
          'UNTERMINATED="open',
          'TAIL="closed" trailing',
          "NO_NEWLINE=last",
        ].join("\n"),
      );
      const keys = [
        "PLAIN",
        "EXPORTED",
        "INDENTED",
        "SINGLE",
        "TRAILING",
        "QUOTED_TRAILING",
        "HASH_INSIDE",
        "CRLF",
        "DUP",
        "EMPTY",
        "SUBSTITUTION",
        "COMMENTED",
        "MISSING",
        "UNTERMINATED",
        "TAIL",
        "NO_NEWLINE",
      ];
      const out = sourced(
        shell,
        `for k in ${keys.join(" ")}; do v="$(env_file_value "$F" "$k" 2>/dev/null)"; printf '%s\\t%s\\t%s\\n' "$k" "$?" "$v"; done`,
        { PATH: process.env.PATH ?? "", F: file },
      );
      expect(out.stderr).toBe("");
      const got = Object.fromEntries(
        out.stdout
          .trimEnd()
          .split("\n")
          .map((l) => {
            const [k, rc, v] = l.split("\t");
            return [k, `${rc} ${v}`];
          }),
      );
      expect(got).toEqual({
        PLAIN: "0 https://fixture.invalid",
        EXPORTED: "0 exported-value",
        INDENTED: "0 indented value",
        SINGLE: "0 single $HOME",
        TRAILING: "0 plain",
        QUOTED_TRAILING: "0 quoted",
        HASH_INSIDE: "0 a#b",
        CRLF: "0 crlf-value",
        DUP: "0 second",
        EMPTY: "0 ",
        SUBSTITUTION: `0 $(touch ${substituted})`,
        COMMENTED: "1 ",
        MISSING: "1 ",
        UNTERMINATED: "2 ",
        TAIL: "2 ",
        NO_NEWLINE: "0 last",
      });
      expect(existsSync(ran)).toBe(false);
      expect(existsSync(substituted)).toBe(false);
    });

    it("names the key, never the value, when a line cannot be parsed", () => {
      const file = path.join(dir, "env");
      writeFileSync(file, 'VOYAGE_API_KEY="fixture-voyage\n');
      const out = sourced(shell, `env_file_value "$F" VOYAGE_API_KEY`, {
        PATH: process.env.PATH ?? "",
        F: file,
      });
      expect(out.status).toBe(2);
      expect(out.stderr).toContain("VOYAGE_API_KEY");
      expect(out.stderr).not.toContain("fixture-voyage");
    });
  });

  describe("scoped_ingest", () => {
    it("passes TMPDIR and PLAYWRIGHT_BROWSERS_PATH only when the caller has them", () => {
      const file = path.join(dir, "env");
      writeFileSync(file, envFile());
      const out = sourced(shell, `scoped_ingest "$F"`, {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: dir,
        F: file,
      });
      expect(out.status).toBe(0);
      const [call] = calls();
      expect(call.argv).toEqual(["ingest"]);
      expect(Object.keys(call.env).sort()).toEqual(
        [
          "EMBEDDINGS_PROVIDER",
          "HOME",
          "INGEST_NO_DOTENV",
          "PATH",
          "SUPABASE_SERVICE_ROLE_KEY",
          "SUPABASE_URL",
          "VOYAGE_API_KEY",
          "pnpm_config_verify_deps_before_run",
        ].sort(),
      );
    });

    it.each(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VOYAGE_API_KEY"])(
      "refuses to start without %s",
      (key) => {
        const file = path.join(dir, "env");
        writeFileSync(
          file,
          envFile()
            .split("\n")
            .map((l) => (l.includes(`${key}=`) ? `${key}=` : l))
            .join("\n"),
        );
        const out = sourced(shell, `scoped_ingest "$F"`, {
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          HOME: dir,
          F: file,
        });
        expect(out.status).not.toBe(0);
        expect(out.stderr).toContain(key);
        expect(out.stderr).not.toContain("fixture-");
        expect(calls()).toEqual([]);
      },
    );
  });

  describe("the run, end to end", () => {
    let seed: string;
    let work: string;
    // The owner's git config (signing, hooks) stays out of the fixture repos.
    const gitEnv = {
      HOME: "",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    };
    const git = (cwd: string, ...args: string[]) => {
      const r = spawn(
        "git",
        args,
        { ...gitEnv, HOME: dir, PATH: process.env.PATH ?? "" },
        cwd,
      );
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    };
    const sentinels = () =>
      ["backtick", "substitution", "bare-line"].map((s) => path.join(dir, s));
    // What `pnpm recrawl` would run, from a caller whose shell holds more
    // than the ingest should see.
    const recrawl = (...docKeys: string[]) =>
      spawn(
        shell,
        ["scripts/recrawl.sh", ...docKeys],
        {
          ...gitEnv,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          HOME: dir,
          TMPDIR: dir,
          PLAYWRIGHT_BROWSERS_PATH: path.join(dir, "browsers"),
          CALLER_ONLY: "from-the-caller",
          NODE_OPTIONS: "--no-deprecation",
          pnpm_config_verify_deps_before_run: "false",
        },
        work,
      );

    beforeEach(() => {
      // seed → bare origin → work, the main checkout; then origin moves one
      // commit ahead of work, so the run has something to pull.
      seed = path.join(dir, "seed");
      work = path.join(dir, "work");
      mkdirSync(path.join(seed, "scripts"), { recursive: true });
      mkdirSync(path.join(seed, "corpus"));
      copyFileSync(SCRIPT, path.join(seed, "scripts", "recrawl.sh"));
      writeFileSync(path.join(seed, "corpus", "manifest.json"), "{}\n");
      writeFileSync(path.join(seed, ".gitignore"), ".env*\n");
      git(seed, "init", "-q", "-b", "main");
      git(seed, "add", ".");
      git(seed, "commit", "-q", "-m", "fixture");
      git(dir, "clone", "-q", "--bare", seed, "origin.git");
      git(dir, "clone", "-q", "origin.git", work);
      git(seed, "remote", "add", "origin", path.join(dir, "origin.git"));
      writeFileSync(path.join(seed, "corpus", "manifest.json"), '{"v":2}\n');
      git(seed, "commit", "-q", "-am", "upstream");
      git(seed, "push", "-q", "origin", "main");
      writeFileSync(path.join(work, ".env.prod"), envFile(sentinels()));
    });

    it("pulls, installs, then hands pnpm ingest the three keys and nothing else", () => {
      const out = recrawl("ccss-faq", "ley-10363");
      // stderr carries git's «From …» fetch line, so it names the failure.
      expect(out.status, out.stderr).toBe(0);
      expect(
        readFileSync(path.join(work, "corpus", "manifest.json"), "utf8"),
      ).toBe('{"v":2}\n');

      const recorded = calls();
      expect(recorded.map((c) => c.argv)).toEqual([
        ["install", "--frozen-lockfile"],
        ["check:routing"],
        [
          "exec",
          "vitest",
          "run",
          "--project",
          "unit",
          "src/lib/ingestion/manifest-vigencia.test.ts",
        ],
        ["ingest", "ccss-faq", "ley-10363"],
      ]);
      // Nothing before the ingest ran with a key from the env file.
      for (const call of recorded.slice(0, -1)) {
        for (const key of DECOYS) expect(call.env).not.toHaveProperty(key);
      }
      expect(recorded.at(-1)?.env).toEqual({
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: dir,
        TMPDIR: dir,
        PLAYWRIGHT_BROWSERS_PATH: path.join(dir, "browsers"),
        SUPABASE_URL: "https://fixture.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role",
        // The install's rewrite: the file was read after it, not before.
        VOYAGE_API_KEY: "read-after-install",
        EMBEDDINGS_PROVIDER: "voyage",
        INGEST_NO_DOTENV: "1",
        pnpm_config_verify_deps_before_run: "error",
      });
      for (const s of sentinels()) expect(existsSync(s)).toBe(false);
    });

    it("refuses an untracked file", () => {
      writeFileSync(path.join(work, "corpus", "new.json"), "{}\n");
      const out = recrawl();
      expect(out.status).not.toBe(0);
      expect(out.stderr).toContain("?? corpus/new.json");
      expect(calls()).toEqual([]);
    });

    it("refuses a staged, uncommitted change", () => {
      writeFileSync(path.join(work, "corpus", "manifest.json"), "[]\n");
      git(work, "add", "corpus/manifest.json");
      const out = recrawl();
      expect(out.status).not.toBe(0);
      expect(out.stderr).toContain("M  corpus/manifest.json");
      expect(calls()).toEqual([]);
    });

    it("refuses a HEAD that differs from origin/main", () => {
      git(work, "pull", "-q", "--ff-only");
      writeFileSync(path.join(work, "corpus", "manifest.json"), "[]\n");
      git(work, "commit", "-q", "-am", "unpushed");
      const out = recrawl();
      expect(out.status).not.toBe(0);
      expect(out.stderr).toContain("is not origin/main");
      expect(calls()).toEqual([]);
    });
  });
});
