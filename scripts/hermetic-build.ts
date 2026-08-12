/**
 * Hermetic-build gate (issue #88). Runs `pnpm build` inside a network
 * namespace with no route off the machine, so a build-time fetch — a font
 * loader, an asset pipeline reaching a CDN, a plugin phoning home — fails on
 * the PR that introduces it rather than on a random future day when the remote
 * host blips.
 *
 * Loopback stays up on purpose: Turbopack spawns a local PostCSS worker over a
 * socket, and a profile that denies loopback too fails the build for an
 * unrelated reason (found the hard way in #83).
 *
 * `src/app/fonts.test.ts` guards the one known regression vector at the source
 * level and runs everywhere in milliseconds; this one is slower, Linux-only,
 * and truthful about vectors nobody has thought of yet. Both are worth having.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What a denied-egress failure looks like from inside the namespace. The first
 * group is what the syscall layer says when there is no route; `fetch failed`
 * is undici's opaque wrapper around the same thing. The last is the #83
 * misdirection itself — Turbopack reports a failed font download as a missing
 * internal module, which is exactly the message this gate exists to translate.
 */
const NETWORK_SIGNATURES: { name: string; pattern: RegExp }[] = [
  { name: "ENETUNREACH", pattern: /\bENETUNREACH\b/ },
  { name: "ENOTFOUND", pattern: /\bENOTFOUND\b/ },
  { name: "EAI_AGAIN", pattern: /\bEAI_AGAIN\b/ },
  { name: "ECONNREFUSED", pattern: /\bECONNREFUSED\b/ },
  { name: "ETIMEDOUT", pattern: /\bETIMEDOUT\b/ },
  { name: "getaddrinfo", pattern: /\bgetaddrinfo\b/ },
  { name: "fetch failed", pattern: /\bfetch failed\b/ },
  {
    name: "a Turbopack font-loader internal",
    pattern: /turbopack-next\/internal\/font/,
  },
];

/** The signatures present in a failed build's output, in the order listed. */
export function networkSignatures(log: string): string[] {
  return NETWORK_SIGNATURES.filter(({ pattern }) => pattern.test(log)).map(
    ({ name }) => name,
  );
}

const REPRO = "Reproduce on Linux with: pnpm build:hermetic";

/**
 * The diagnosis printed after a failed sandboxed build. A signature hit is a
 * confident verdict; no hit still says which sandbox the build ran under, so
 * nobody debugs a hermetic failure as an ordinary one.
 */
export function describeFailure(log: string): string {
  const hits = networkSignatures(log);
  const preamble =
    "This step ran `pnpm build` inside a network namespace with no route off " +
    "the machine (loopback stays up for Turbopack's PostCSS worker).";

  if (hits.length === 0) {
    return [
      "hermetic build failed — but not visibly on the network",
      "",
      preamble,
      "Nothing in the output names a network error, so the build may have",
      "failed for an ordinary reason. The full log is above.",
      "",
      REPRO,
    ].join("\n");
  }

  return [
    "hermetic build failed — the build tried to reach the network",
    "",
    preamble,
    `The build output matched: ${hits.join(", ")}`,
    "",
    "A build-time fetch makes every future build depend on someone else's",
    "uptime, and fails with a message that names a bundler internal rather",
    "than the network (see #83). Vendor the asset, or move the fetch to",
    "request time.",
    "",
    REPRO,
  ].join("\n");
}

function banner(message: string): string {
  const rule = "─".repeat(72);
  return `\n${rule}\n${message
    .split("\n")
    .map((line) => (line ? `  ${line}` : ""))
    .join("\n")}\n${rule}\n`;
}

/**
 * The build, without pnpm in the namespace. pnpm compares node_modules against
 * the lockfile before running any script and re-runs `pnpm install` when it
 * doesn't like what it sees — an install is a network operation, so it dies
 * inside the namespace and buries the build we came to test under a registry
 * error. Running the script's own command with node_modules/.bin on PATH skips
 * that entirely, and keeps package.json the single source of truth for what
 * "build" means.
 */
export function buildCommand(): string[] {
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  return ["sh", "-c", packageJson.scripts.build];
}

/** Env every route into the namespace has to restate; see each strategy. */
export function envArgs(): string[] {
  const bin = join(process.cwd(), "node_modules", ".bin");
  return [
    `HOME=${process.env.HOME ?? ""}`,
    `PATH=${bin}:${process.env.PATH ?? ""}`,
  ];
}

function quote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * Two ways onto an isolated namespace, tried in order. `unshare -rn` needs
 * unprivileged user namespaces, which ubuntu-latest's AppArmor policy denies;
 * the sudo route works where that one doesn't, and hands the build back to the
 * invoking user so `.next` doesn't end up root-owned.
 */
export const STRATEGIES = [
  {
    name: "unshare -rn (unprivileged user namespace)",
    argv: (command: string[]) => [
      "unshare",
      "-rn",
      "sh",
      "-c",
      'ip link set lo up && exec "$0" "$@"',
      "env",
      ...envArgs(),
      ...command,
    ],
  },
  {
    name: "sudo unshare -n (privileged, build dropped back to the caller)",
    argv: (command: string[]) => {
      // The outer sudo resets HOME to root's and `-E` carries *that* inward,
      // while sudoers' secure_path wins over PATH — so both get restated on
      // the way back down.
      const inner = [
        "sudo",
        "-n",
        "-E",
        "-u",
        process.env.USER ?? "runner",
        "env",
        ...envArgs(),
        ...command,
      ]
        .map(quote)
        .join(" ");
      return [
        "sudo",
        "-n",
        "unshare",
        "-n",
        "sh",
        "-c",
        `ip link set lo up && exec ${inner}`,
      ];
    },
  },
];

/**
 * Always captures; `echo` decides whether it also streams through, so the
 * build stays watchable in real time while the probes stay quiet — without
 * throwing away what a failed probe said.
 */
function run(
  argv: string[],
  options: { echo: boolean },
): Promise<{ code: number; log: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: ["inherit", "pipe", "pipe"],
    });
    let log = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk: Buffer) => {
        log += chunk.toString();
        if (options.echo) process.stderr.write(chunk);
      });
    }
    // A missing binary (no `unshare` on macOS) is a probe result, not a crash.
    child.on("error", (error) => resolve({ code: 1, log: String(error) }));
    child.on("close", (code) => resolve({ code: code ?? 1, log }));
  });
}

type Strategy = (typeof STRATEGIES)[number];

/**
 * The first strategy that can actually bring loopback up, or — when none can —
 * what each one said when it couldn't. A broken sandbox is the failure mode
 * most likely to hit first, so its diagnosis has to name a cause too, not just
 * report that both attempts came back unhappy.
 */
async function usableStrategy(): Promise<
  { strategy: Strategy } | { refusals: string[] }
> {
  const refusals: string[] = [];
  for (const strategy of STRATEGIES) {
    const probe = await run(strategy.argv(["true"]), { echo: false });
    if (probe.code === 0) return { strategy };
    refusals.push(
      `${strategy.name} — exit ${probe.code}: ${probe.log.trim() || "(no output)"}`,
    );
  }
  return { refusals };
}

async function main() {
  const chosen = await usableStrategy();
  if ("refusals" in chosen) {
    process.stderr.write(
      banner(
        [
          "cannot sandbox the build — no working network namespace",
          "",
          "Neither route into an isolated namespace worked. What each said:",
          ...chosen.refusals.map((refusal) => `  · ${refusal}`),
          "",
          "This gate is Linux-only by construction; on macOS run `pnpm build`",
          "and rely on src/app/fonts.test.ts. On a runner, a refusal here is",
          "usually an AppArmor policy on unprivileged user namespaces or a",
          "sudoers entry that isn't passwordless.",
          "",
          "Failing rather than falling back: a gate that silently degrades to",
          "an ordinary build is a gate nobody notices has stopped working.",
        ].join("\n"),
      ),
    );
    process.exit(1);
  }

  const { strategy } = chosen;
  process.stderr.write(`hermetic build: egress denied via ${strategy.name}\n`);
  const build = await run(strategy.argv(buildCommand()), { echo: true });
  if (build.code !== 0) {
    process.stderr.write(banner(describeFailure(build.log)));
  }
  process.exit(build.code);
}

// Run only when invoked as a script; the test imports this module for the
// classifier. (A plain argv check rather than import.meta, so tsx can emit
// CommonJS for it without tripping over top-level await.)
if (process.argv[1]?.endsWith("hermetic-build.ts")) {
  void main();
}
