import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseReleaseArguments, releaseProject } from "./release-project.mjs";

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
}

function writeFixturePackage(directory) {
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "release-fixture", version: "1.0.0", private: true }, null, 2) + "\n");
  writeFileSync(path.join(directory, "package-lock.json"), JSON.stringify({
    name: "release-fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "release-fixture", version: "1.0.0" } },
  }, null, 2) + "\n");
}

function repository(t, { origin = true } = {}) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "lanternwatch-release-"));
  const directory = path.join(fixtureRoot, "worktree");
  mkdirSync(directory);
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  run("git", ["init", "--initial-branch", "main"], directory);
  run("git", ["config", "user.email", "release-test@example.invalid"], directory);
  run("git", ["config", "user.name", "Release Test"], directory);
  writeFixturePackage(directory);
  run("git", ["add", "package.json", "package-lock.json"], directory);
  run("git", ["commit", "-m", "initial"], directory);
  if (origin) {
    const remote = path.join(fixtureRoot, "remote.git");
    run("git", ["init", "--bare", remote], directory);
    run("git", ["remote", "add", "origin", remote], directory);
  }
  return directory;
}

test("a valid dry run reports the planned version, tag, and push target without changes", (t) => {
  const directory = repository(t);
  const output = [];
  const plan = releaseProject({ cwd: directory, args: ["patch", "--dry-run"], logger: (line) => output.push(line) });
  assert.deepEqual(plan, {
    bumpLevel: "patch", currentVersion: "1.0.0", nextVersion: "1.0.1", tag: "v1.0.1",
    branch: "main", origin: path.join(path.dirname(directory), "remote.git"), dryRun: true,
  });
  assert.equal(JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")).version, "1.0.0");
  assert.equal(run("git", ["status", "--porcelain"], directory), "");
  assert.match(output.join("\n"), /Push target: origin main and v1\.0\.1/);
});

test("a real release updates version, creates a commit and annotated tag, and pushes both to an isolated origin", (t) => {
  const directory = repository(t);
  const plan = releaseProject({ cwd: directory, args: ["patch"], logger: () => {} });
  assert.equal(plan.tag, "v1.0.1");
  assert.equal(JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")).version, "1.0.1");
  assert.equal(run("git", ["log", "-1", "--format=%s"], directory), "chore(release): v1.0.1");
  assert.equal(run("git", ["tag", "--list", "v1.0.1"], directory), "v1.0.1");
  const remote = path.join(path.dirname(directory), "remote.git");
  assert.notEqual(run("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"], directory), "");
  assert.notEqual(run("git", ["--git-dir", remote, "rev-parse", "refs/tags/v1.0.1"], directory), "");
});

test("release refuses dirty repositories, missing origins, and unreachable origins before mutation", (t) => {
  const dirty = repository(t);
  writeFileSync(path.join(dirty, "notes.txt"), "uncommitted\n");
  assert.throws(() => releaseProject({ cwd: dirty, args: ["patch", "--dry-run"], logger: () => {} }), /clean worktree/);
  const noOrigin = repository(t, { origin: false });
  assert.throws(() => releaseProject({ cwd: noOrigin, args: ["patch", "--dry-run"], logger: () => {} }), /origin remote/);
  const unreachable = repository(t, { origin: false });
  run("git", ["remote", "add", "origin", path.join(path.dirname(unreachable), "missing-origin.git")], unreachable);
  assert.throws(() => releaseProject({ cwd: unreachable, args: ["patch", "--dry-run"], logger: () => {} }), /could not contact origin/);
  assert.equal(JSON.parse(readFileSync(path.join(unreachable, "package.json"), "utf8")).version, "1.0.0");
  assert.equal(run("git", ["status", "--porcelain"], unreachable), "");
});

test("a rejected atomic push rolls back only the generated local commit and tag", (t) => {
  const directory = repository(t);
  const remote = path.join(path.dirname(directory), "remote.git");
  writeFileSync(path.join(remote, "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n");
  assert.throws(
    () => releaseProject({ cwd: directory, args: ["patch"], logger: () => {} }),
    /local release commit and tag were rolled back/,
  );
  assert.equal(run("git", ["log", "-1", "--format=%s"], directory), "initial");
  assert.equal(run("git", ["tag", "--list", "v1.0.1"], directory), "");
  assert.equal(JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")).version, "1.0.1");
  assert.match(run("git", ["status", "--porcelain"], directory), /package\.json/);
});

test("release accepts only one explicit SemVer bump level", () => {
  assert.deepEqual(parseReleaseArguments(["minor", "--dry-run"]), { bumpLevel: "minor", dryRun: true });
  for (const args of [[], ["1.0.1"], ["patch", "minor"], ["prerelease"]]) {
    assert.throws(() => parseReleaseArguments(args), /SemVer bump level|Usage/);
  }
});
