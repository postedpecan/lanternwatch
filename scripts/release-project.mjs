import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BUMP_LEVELS = new Set(["patch", "minor", "major"]);
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function commandInvocation(name, args) {
  if (name !== "npm") return { command: name, args };
  const npmCli = process.env.npm_execpath
    || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) throw new Error("The npm CLI could not be located.");
  return { command: process.execPath, args: [npmCli, ...args] };
}

function execute(name, args, { cwd }) {
  const invocation = commandInvocation(name, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function checked(runCommand, name, args, options, failure) {
  const result = runCommand(name, args, options);
  if (result.status !== 0) throw new Error(failure);
  return result.stdout.trim();
}

export function parseReleaseArguments(args) {
  let bumpLevel;
  let dryRun = false;
  for (const argument of args) {
    if (argument === "--dry-run") {
      if (dryRun) throw new Error("--dry-run may only be supplied once");
      dryRun = true;
    } else if (BUMP_LEVELS.has(argument)) {
      if (bumpLevel) throw new Error("Choose exactly one SemVer bump level: patch, minor, or major.");
      bumpLevel = argument;
    } else {
      throw new Error("Usage: npm run release -- <patch|minor|major> [--dry-run]");
    }
  }
  if (!bumpLevel) throw new Error("Choose exactly one SemVer bump level: patch, minor, or major.");
  return { bumpLevel, dryRun };
}

export function nextStableVersion(version, bumpLevel) {
  const match = STABLE_SEMVER.exec(version);
  if (!match) throw new Error("package.json version must be a stable SemVer version (for example, 1.2.3).");
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bumpLevel === "major") return `${major + 1}.0.0`;
  if (bumpLevel === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function releaseFiles(cwd) {
  return ["package.json", ...(existsSync(path.join(cwd, "package-lock.json")) ? ["package-lock.json"] : [])];
}

export function releaseProject({ cwd = process.cwd(), args = process.argv.slice(2), runCommand = execute, logger = console.log } = {}) {
  const { bumpLevel, dryRun } = parseReleaseArguments(args);
  const packagePath = path.join(cwd, "package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch {
    throw new Error("Could not read package.json for the release version.");
  }
  const currentVersion = packageJson.version;
  const nextVersion = nextStableVersion(currentVersion, bumpLevel);
  const tag = `v${nextVersion}`;

  const origin = checked(runCommand, "git", ["remote", "get-url", "origin"], { cwd }, "Release requires an origin remote.");
  const branch = checked(runCommand, "git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd }, "Release requires an attached branch; checkout a branch first.");
  const status = checked(runCommand, "git", ["status", "--porcelain"], { cwd }, "Could not inspect the Git worktree.");
  if (status) throw new Error("Release requires a completely clean worktree.");
  checked(runCommand, "git", ["ls-remote", "origin"], { cwd }, "Release could not contact origin before making changes.");
  const tagExists = runCommand("git", ["show-ref", "--tags", "--verify", "--quiet", `refs/tags/${tag}`], { cwd });
  if (tagExists.status === 0) throw new Error(`Release tag ${tag} already exists.`);

  const plan = { bumpLevel, currentVersion, nextVersion, tag, branch, origin, dryRun };
  logger(`Release plan: ${currentVersion} -> ${nextVersion} (${bumpLevel})`);
  logger(`Tag: ${tag}`);
  logger(`Push target: origin ${branch} and ${tag}`);
  if (dryRun) {
    logger("Dry run: no files, commits, tags, or remotes were changed.");
    return plan;
  }

  const previousHead = checked(runCommand, "git", ["rev-parse", "HEAD"], { cwd }, "Release requires an existing Git commit.");
  checked(runCommand, "git", ["var", "GIT_AUTHOR_IDENT"], { cwd }, "Release requires a configured Git author identity.");
  checked(runCommand, "npm", ["version", bumpLevel, "--no-git-tag-version", "--ignore-scripts"], { cwd }, "npm could not update the package version.");
  const updatedVersion = JSON.parse(readFileSync(packagePath, "utf8")).version;
  if (updatedVersion !== nextVersion) throw new Error("npm produced an unexpected package version; no commit or push was attempted.");
  const files = releaseFiles(cwd);
  checked(runCommand, "git", ["add", "--", ...files], { cwd }, "Could not stage release version files.");
  const stagedVersionFiles = runCommand("git", ["diff", "--cached", "--quiet", "--exit-code"], { cwd });
  if (stagedVersionFiles.status !== 1) {
    throw new Error("Release version files did not change; no commit was created.");
  }
  checked(runCommand, "git", ["commit", "-m", `chore(release): ${tag}`], { cwd }, "Could not create the release commit.");
  checked(runCommand, "git", ["tag", "-a", tag, "-m", `Release ${tag}`], { cwd }, "Could not create the release tag.");
  const pushed = runCommand("git", ["push", "--atomic", "origin", `HEAD:refs/heads/${branch}`, `refs/tags/${tag}`], { cwd });
  if (pushed.status !== 0) {
    const deletedTag = runCommand("git", ["tag", "-d", tag], { cwd });
    const reset = runCommand("git", ["reset", "--mixed", previousHead], { cwd });
    if (deletedTag.status === 0 && reset.status === 0) {
      throw new Error("Could not push the release branch and tag to origin. The local release commit and tag were rolled back; version-file changes remain for review.");
    }
    throw new Error("Could not push the release branch and tag to origin. Automatic local rollback was incomplete; inspect the release commit and tag before retrying.");
  }
  logger(`Released ${tag} to origin/${branch}.`);
  return plan;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    releaseProject();
  } catch (error) {
    console.error(`Release stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
