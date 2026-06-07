/**
 * Bug-report IPC bridge — handlers only (no UI yet).
 *
 * `BUG_REPORT_WRITE` stitches the user's description, build metadata, and
 * tails of the main + noise logs into a single markdown file. The renderer
 * will surface this as a one-click "Report a bug" affordance in a later task.
 *
 *   - BUG_REPORT_WRITE       → saves bug-report-<ISO>.md, returns its path
 *   - BUG_REPORT_OPEN_FOLDER → shell.openPath(bugReportsDir)
 *   - BUG_REPORT_GET_DIR     → absolute path of the bug-reports directory
 *   - BUG_REPORT_LIST        → recent bug-report file paths, newest first
 *
 * Sender-origin checked because the main BrowserWindow runs with
 * webSecurity:false (same posture as log-handlers.ts) — a tampered renderer
 * must not be able to write arbitrary markdown into the bug-reports dir or
 * pop the file explorer.
 *
 * The bugReportsDir is passed at register time rather than read from a
 * module-level getter so the handler stays trivially testable with a temp
 * dir; main.ts threads the value through from `computeLogPaths`.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { app, ipcMain, shell } from "electron";
import type { BugReportResult } from "../../../shared/ipc-channels";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { getCurrentLogPath } from "../../logging/logger";
import { getCurrentNoisePath } from "../../logging/noise-logger";
import { isAllowedSender } from "../sender-origin";

const MAIN_LOG_TAIL_LINES = 500;
const NOISE_LOG_TAIL_LINES = 200;
const LIST_MAX_RESULTS = 50;
const BUG_REPORT_FILE_PREFIX = "bug-report-";
const BUG_REPORT_FILE_EXT = ".md";

interface BugReportWritePayload {
  description: unknown;
  includeMainLog: unknown;
  includeNoiseLog: unknown;
}

function safeNoisePath(): string | null {
  try {
    return getCurrentNoisePath();
  } catch {
    return null;
  }
}

async function readTail(filePath: string, lines: number): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const all = raw.split("\n");
  const nonEmpty = all.filter((line) => line.length > 0);
  return nonEmpty.slice(-lines);
}

function isoStampForFilename(): string {
  // Match the logger's session-stamp convention so bug-reports sort
  // chronologically next to log files when both are zipped for a ticket.
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown): boolean {
  return value === true;
}

async function buildReportMarkdown(
  description: string,
  includeMainLog: boolean,
  includeNoiseLog: boolean
): Promise<string> {
  const timestamp = new Date().toISOString();
  const mainLogPath = (() => {
    try {
      return getCurrentLogPath();
    } catch {
      return "(not initialized)";
    }
  })();
  const noisePath = safeNoisePath();
  const noiseDisplay = noisePath ?? "not initialized";

  const header = [
    "# StreamFusion Bug Report",
    "",
    `- Timestamp: ${timestamp}`,
    `- App version: ${app.getVersion()}`,
    `- Platform: ${process.platform} ${process.arch}`,
    `- Electron: ${process.versions.electron ?? "unknown"}`,
    `- Node: ${process.versions.node ?? "unknown"}`,
    `- Log file: ${mainLogPath}`,
    `- Noise log: ${noiseDisplay}`,
    "",
    "## Description",
    "",
    description.length > 0 ? description : "(no description provided)",
  ].join("\n");

  const sections: string[] = [header];

  if (includeMainLog) {
    const tail = await readTail(mainLogPath, MAIN_LOG_TAIL_LINES);
    sections.push(
      "",
      `## Recent Main Log (last ${MAIN_LOG_TAIL_LINES} lines)`,
      "",
      "```",
      tail.length > 0 ? tail.join("\n") : "(main log file empty or unreadable)",
      "```"
    );
  }

  if (includeNoiseLog) {
    const noiseSection = [
      "",
      `## Recent Noise Log (last ${NOISE_LOG_TAIL_LINES} lines)`,
      "",
      "```",
    ];
    if (noisePath === null) {
      noiseSection.push("(noise logger not initialized)");
    } else {
      const tail = await readTail(noisePath, NOISE_LOG_TAIL_LINES);
      noiseSection.push(tail.length > 0 ? tail.join("\n") : "(noise log file empty or unreadable)");
    }
    noiseSection.push("```");
    sections.push(...noiseSection);
  }

  return `${sections.join("\n")}\n`;
}

export function registerBugReportHandlers(bugReportsDir: string): void {
  ipcMain.handle(
    IPC_CHANNELS.BUG_REPORT_WRITE,
    async (event, payload: BugReportWritePayload): Promise<BugReportResult> => {
      if (!isAllowedSender(event)) {
        return { ok: false, error: "sender not allowed" };
      }
      const description = asString(payload?.description);
      const includeMainLog = asBool(payload?.includeMainLog);
      const includeNoiseLog = asBool(payload?.includeNoiseLog);

      try {
        await fs.mkdir(bugReportsDir, { recursive: true });
        const fileName = `${BUG_REPORT_FILE_PREFIX}${isoStampForFilename()}${BUG_REPORT_FILE_EXT}`;
        const filePath = path.join(bugReportsDir, fileName);
        const body = await buildReportMarkdown(description, includeMainLog, includeNoiseLog);
        await fs.writeFile(filePath, body, "utf8");
        return { ok: true, filePath };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.BUG_REPORT_OPEN_FOLDER,
    async (): Promise<{ ok: boolean; error?: string }> => {
      try {
        // mkdir first so the user never sees an "ENOENT" the first time they
        // click "Open bug-reports folder" on a clean install.
        await fs.mkdir(bugReportsDir, { recursive: true });
        const result = await shell.openPath(bugReportsDir);
        if (result === "") return { ok: true };
        return { ok: false, error: result };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.BUG_REPORT_GET_DIR, (): string => {
    return bugReportsDir;
  });

  ipcMain.handle(IPC_CHANNELS.BUG_REPORT_LIST, async (): Promise<string[]> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(bugReportsDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const candidates: { absPath: string; mtimeMs: number }[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.startsWith(BUG_REPORT_FILE_PREFIX)) continue;
      if (path.extname(entry.name) !== BUG_REPORT_FILE_EXT) continue;

      const absPath = path.join(bugReportsDir, entry.name);
      try {
        const stat = await fs.stat(absPath);
        candidates.push({ absPath, mtimeMs: stat.mtimeMs });
      } catch {
        // Vanished between readdir and stat — skip.
      }
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates.slice(0, LIST_MAX_RESULTS).map((c) => c.absPath);
  });
}
