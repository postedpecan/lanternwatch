import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function homeDirectory(environment = process.env) {
  const configured = environment.USERPROFILE || environment.HOME;
  return path.resolve(configured || os.homedir());
}

export const DEFAULT_STORAGE_ROOT = path.join(homeDirectory(), ".lanternwatch");

export function lanternwatchConfigPath(environment = process.env) {
  return path.resolve(
    environment.LANTERNWATCH_CONFIG_PATH
      || path.join(homeDirectory(environment), ".lanternwatch", "config.json"),
  );
}

function readConfiguration(environment) {
  try {
    const configuration = JSON.parse(readFileSync(lanternwatchConfigPath(environment), "utf8"));
    return configuration && typeof configuration === "object" && !Array.isArray(configuration)
      ? configuration
      : {};
  } catch {
    return {};
  }
}

function configuredPath(value) {
  return typeof value === "string" && value.trim() ? path.resolve(value.trim()) : undefined;
}

export function lanternwatchRuntimePaths(environment = process.env) {
  const configuration = readConfiguration(environment);
  const environmentStorage = configuredPath(environment.LANTERNWATCH_STORAGE_ROOT);
  const environmentDatabase = configuredPath(environment.LANTERNWATCH_DB_PATH);
  const configuredDatabase = configuredPath(configuration.databasePath);
  const storageRoot = environmentStorage || configuredPath(configuration.storageRoot)
    || (environmentDatabase || configuredDatabase
      ? path.dirname(environmentDatabase || configuredDatabase)
      : path.join(homeDirectory(environment), ".lanternwatch"));
  return {
    storageRoot,
    databasePath: environmentDatabase
      || (environmentStorage ? path.join(environmentStorage, "guild.db") : undefined)
      || configuredDatabase
      || path.join(storageRoot, "guild.db"),
    vaultPath: configuredPath(environment.LANTERNWATCH_VAULT_PATH)
      || configuredPath(configuration.vaultPath)
      || "",
  };
}

export function lifecycleStoragePaths(storageRoot, databasePath, environment = process.env) {
  const configuredRoot = typeof storageRoot === "string" ? storageRoot.trim() : "";
  const configuredDatabase = typeof databasePath === "string" ? databasePath.trim() : "";
  const root = configuredRoot
    ? path.resolve(configuredRoot)
    : configuredDatabase
      ? path.dirname(path.resolve(configuredDatabase))
      : lanternwatchRuntimePaths(environment).storageRoot;
  return {
    root,
    stateDirectory: path.join(root, "sessions"),
    logDirectory: path.join(root, "logs"),
  };
}
