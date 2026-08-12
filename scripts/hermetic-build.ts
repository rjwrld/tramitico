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
 * Two ways onto an isolated namespace, tried in order. `unshare -rn` needs
 * unprivileged user namespaces, which a runner's AppArmor policy may deny; the
 * sudo route works where that one doesn't, and hands the build back to the
 * invoking user so `.next` doesn't end up root-owned.
 */
const STRATEGIES = [
  {
    name: "unshare -rn (unprivileged user namespace)",
    argv: (command: string[]) => [
      "unshare",
      "-rn",
      "sh",
      "-c",
      'ip link set lo up && exec "$0" "$@"',
      ...command,
    ],
  },
  {
    name: "sudo unshare -n (privileged, build dropped back to the caller)",
    argv: (command: string[]) => [
      "sudo",
      "-n",
      "unshare",
      "-n",
      "sh",
      "-c",
      'ip link set lo up && exec sudo -n -E -u "$0" "$@"',
      process.env.USER ?? "runner",
      ...command,
    ],
  },
];

function run(
  argv: string[],
  options: { capture: boolean },
): Promise<{ code: number; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: options.capture ? ["inherit", "pipe", "pipe"] : "ignore",
    });
    let log = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on("data", (chunk: Buffer) => {
        log += chunk.toString();
        process.stderr.write(chunk);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, log }));
  });
}

/** A strategy is usable only if it can actually bring loopback up. */
async function usableStrategy() {
  for (const strategy of STRATEGIES) {
    const probe = await run(strategy.argv(["true"]), { capture: false }).catch(
      () => ({ code: 1, log: "" }),
    );
    if (probe.code === 0) return strategy;
  }
  return null;
}

async function main() {
  const strategy = await usableStrategy();
  if (!strategy) {
    process.stderr.write(
      banner(
        [
          "cannot sandbox the build — no working network namespace",
          "",
          "Neither `unshare -rn` nor `sudo unshare -n` could bring up an",
          "isolated namespace here. This gate is Linux-only by construction;",
          "on macOS run `pnpm build` and rely on src/app/fonts.test.ts.",
          "",
          "Failing rather than falling back: a gate that silently degrades to",
          "an ordinary build is a gate nobody notices has stopped working.",
        ].join("\n"),
      ),
    );
    process.exit(1);
  }

  process.stderr.write(`hermetic build: egress denied via ${strategy.name}\n`);
  const build = await run(strategy.argv(["pnpm", "build"]), { capture: true });
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
