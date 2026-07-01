import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentEvent, HookProvider } from '../../../../../core/src/provider.js';

export function formatToolStatus(toolName: string, input?: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'view_file':
      return `Viewing ${base(inp.AbsolutePath)}`;
    case 'write_to_file':
      return `Writing ${base(inp.TargetFile)}`;
    case 'replace_file_content':
    case 'multi_replace_file_content':
      return `Editing ${base(inp.TargetFile)}`;
    case 'list_dir':
      return `Listing directory ${base(inp.DirectoryPath)}`;
    case 'grep_search':
      return `Searching for "${inp.Query ?? ''}"`;
    case 'run_command':
      return `Running: ${(inp.CommandLine as string) ?? ''}`;
    case 'search_web':
      return `Searching web: ${inp.query ?? ''}`;
    case 'read_url_content':
      return `Reading web content`;
    case 'invoke_subagent':
      return `Invoking subagents`;
    case 'ask_question':
      return `Asking a question`;
    case 'ask_permission':
      return `Asking permission`;
    default:
      return `Using ${toolName}`;
  }
}

function getSessionDirs(_workspacePath: string): string[] {
  // Antigravity sessions are stored at ~/.gemini/antigravity-cli/brain/<conversation-id>
  const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
  if (!fs.existsSync(brainDir)) return [];

  try {
    const subdirs = fs.readdirSync(brainDir);
    const sessionPaths = subdirs
      .map((d) => path.join(brainDir, d))
      .filter((p) => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      });

    // Sort by modified time, newest first
    sessionPaths.sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });

    return sessionPaths;
  } catch {
    return [];
  }
}

function buildLaunchCommand(
  sessionId: string,
  cwd: string,
  _opts?: { bypassPermissions?: boolean },
): { command: string; args: string[]; env?: Record<string, string> } {
  // Antigravity CLI is run via agy CLI tool or gemini cli
  return {
    command: 'agy',
    args: ['--session-id', sessionId],
    env: { ANTIGRAVITY_PROJECT_DIR: cwd },
  };
}

function getAllSessionRoots(): string[] {
  return [path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain')];
}

function parseTranscriptLine(line: string): AgentEvent | null {
  try {
    const record = JSON.parse(line);
    if (!record || typeof record !== 'object') return null;

    const type = record.type;
    const status = record.status;
    const stepIndex = record.step_index ?? 0;

    // 1. User input step: start of a new turn
    if (type === 'USER_INPUT') {
      return { kind: 'turnEnd', awaitingInput: false };
    }

    // 2. Planner response step: has tool calls
    if (type === 'PLANNER_RESPONSE') {
      const toolCalls = record.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        // Map the first tool call for simplicity
        const toolCall = toolCalls[0];
        const toolName = toolCall.name;
        const toolId = toolCall.id ?? `sim-tool-${stepIndex}-${toolName}`;
        const input = toolCall.arguments ?? {};

        if (toolName === 'ask_permission') {
          return { kind: 'permissionRequest' };
        }

        if (toolName === 'ask_question') {
          return { kind: 'turnEnd', awaitingInput: true };
        }

        if (toolName === 'invoke_subagent') {
          return {
            kind: 'subagentStart',
            parentToolId: 'main-task',
            toolId,
            toolName: 'Subagent',
            input,
          };
        }

        return {
          kind: 'toolStart',
          toolId,
          toolName,
          input,
        };
      }
    }

    // 3. Step finished status
    if (status === 'DONE' || status === 'ERROR') {
      return { kind: 'turnEnd', awaitingInput: false };
    }

    return null;
  } catch {
    return null;
  }
}

export const antigravityProvider: HookProvider = {
  kind: 'hook',
  id: 'antigravity',
  displayName: 'Antigravity Code',
  protocolVersion: 1,

  normalizeHookEvent() {
    return null; // Local JSONL parsing only
  },

  installHooks() {
    return Promise.resolve();
  },
  uninstallHooks() {
    return Promise.resolve();
  },
  areHooksInstalled() {
    return Promise.resolve(true);
  },

  formatToolStatus,
  permissionExemptTools: new Set([
    'list_dir',
    'list_permissions',
    'manage_task',
    'manage_subagents',
    'ask_question',
  ]),
  subagentToolNames: new Set(['invoke_subagent']),
  readingTools: new Set(['list_dir', 'view_file', 'grep_search', 'read_url_content', 'search_web']),
  terminalNamePrefix: 'Antigravity Code',

  getSessionDirs,
  getAllSessionRoots,
  sessionFilePattern: '.system_generated/logs/transcript.jsonl',
  parseTranscriptLine,
  buildLaunchCommand,
};
