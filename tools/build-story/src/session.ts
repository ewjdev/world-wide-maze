/**
 * Reduce a Claude Code session transcript (JSONL) to a content-free extract: timestamps, word counts and agent
 * descriptions only. No prompt text, tool output or file content leaves this function.
 */
import type { SessionExtract } from './types.ts';

type Row = Record<string, unknown> & { type?: string; timestamp?: string };

const parseLines = (jsonl: string): Row[] =>
  jsonl
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row);

/** The text a person typed, or null for tool results, notifications and injected (meta) messages. */
export function ownerText(row: Row): string | null {
  if (row.type !== 'user' || row.isMeta || row.origin) return null;
  const content = (row.message as { content?: unknown } | undefined)?.content;
  let text: string;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const parts = content as { type?: string; text?: string }[];
    if (parts.some((p) => p.type === 'tool_result')) return null;
    text = parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join(' ');
  } else return null;
  if (/^\s*<(task-notification|local-command|system-reminder)/.test(text)) return null;
  // a slash command: only its arguments were typed
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text);
  if (/<command-name>/.test(text)) text = args?.[1] ?? '';
  return text.trim() || null;
}

export const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export interface AgentTranscript {
  id: string;
  meta: { description?: string; inheritedWorktreePath?: string; worktreePath?: string };
  jsonl: string;
}

export function extractSession(sessionId: string, main: string, agents: AgentTranscript[]): SessionExtract {
  const rows = parseLines(main);
  const ownerMessages: SessionExtract['ownerMessages'] = [];
  const turns: SessionExtract['turns'] = [];
  const notified = new Map<string, string>();
  const monitorEvents: SessionExtract['monitorEvents'] = [];
  let open: string | null = null;
  for (const r of rows) {
    const at = r.timestamp;
    if (!at) continue;
    const text = ownerText(r);
    if (text) ownerMessages.push({ at, words: wordCount(text) });
    if (r.type === 'queue-operation' && r.operation === 'dequeue' && !open) open = at;
    if (r.type === 'system' && r.subtype === 'stop_hook_summary' && open) {
      turns.push({ start: open, end: at });
      open = null;
    }
    // notifications arrive as their own message or attached to another one
    if (r.type === 'user' || r.type === 'attachment') {
      const body = JSON.stringify(r).replace(/\\"/g, '"');
      for (const n of body.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
        const id = /<task-id>([^<]+)<\/task-id>/.exec(n[1] ?? '')?.[1];
        const summary = /<summary>([^<]*)<\/summary>/.exec(n[1] ?? '')?.[1] ?? '';
        if (/^Monitor event/i.test(summary)) {
          if (!monitorEvents.some((e) => e.at === at)) monitorEvents.push({ at, summary });
        } else if (id && !notified.has(id)) notified.set(id, at);
      }
    }
  }
  // helpers run in (and record) their parent's worktree
  const byWorktree = new Map(
    agents.filter((a) => !a.meta.inheritedWorktreePath).map((a) => [a.meta.worktreePath, a.id]),
  );
  return {
    sessionId,
    ownerMessages,
    turns,
    agents: agents
      .map((a) => {
        const stamps = parseLines(a.jsonl)
          .map((r) => r.timestamp)
          .filter((t): t is string => typeof t === 'string')
          .sort();
        const parentId = a.meta.inheritedWorktreePath
          ? (byWorktree.get(a.meta.inheritedWorktreePath) ?? null)
          : null;
        return {
          id: a.id,
          description: a.meta.description ?? '',
          depth: parentId ? 2 : 1,
          parentId,
          start: stamps[0] ?? '',
          end: stamps[stamps.length - 1] ?? '',
          notifiedAt: notified.get(a.id) ?? null,
        };
      })
      .filter((a) => a.start)
      .sort((a, b) => a.start.localeCompare(b.start)),
    monitorEvents,
  };
}
