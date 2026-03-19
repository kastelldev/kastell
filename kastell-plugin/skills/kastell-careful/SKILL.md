---
name: kastell-careful
description: Safety guard for destructive Kastell operations. Intercepts destroy and restore commands and requires explicit confirmation before proceeding.
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: prompt
          prompt: |
            A Bash command is about to run. Tool input: $ARGUMENTS

            Does this command invoke 'kastell destroy' or 'kastell restore'?
            Answer with JSON only:
            - If destructive: {"decision": "block", "reason": "Destructive operation detected. This will destroy or restore a server. Please confirm by running /kastell:careful again with explicit approval."}
            - If not destructive: {"decision": "allow"}
          timeout: 10
---

# Kastell Careful

## Purpose

Safety guard that intercepts `kastell destroy` and `kastell restore` commands. Requires explicit confirmation before any destructive operation proceeds.

## When to Use

Invoke `/kastell:careful` before a session that involves server destruction or restoration. The skill-scoped prompt hook activates and monitors all Bash commands until the skill session ends.

## Current State

**Changed files:**
!`git diff --name-only 2>/dev/null || echo "Not a git repo"`
**Uncommitted:**
!`git status --short 2>/dev/null || echo "Not a git repo"`

## How It Works

Three layers of protection work together:

**Layer 1: Plugin `hooks.json`** — Always active (plugin scope). Silently blocks `kastell destroy` and `kastell server-delete` via command hook (regex match, `exit 2`). No confirmation offered — hard block.

**Layer 2: This skill's prompt hook** — Active only during `/kastell:careful` session. Uses an LLM to detect `destroy` AND `restore` intent in any Bash command. Returns `{"decision": "block"}` with a reason message explaining the block. Covers `restore` which Layer 1 does NOT cover.

**Layer 3: `KASTELL_SAFE_MODE`** — Runtime guard embedded in CLI code itself (`isSafeMode()`). Last line of defense at the application layer.

The three layers are complementary: Layer 1 stops silent automation, Layer 2 provides in-session confirmation UX with semantic understanding, Layer 3 enforces safe mode at execution time.

## Scope

Only `kastell destroy` and `kastell restore` are intercepted. Other commands (including `kastell audit`, `kastell lock`, `kastell status`) pass through without delay.

## Confirmation Flow

When a destructive command is detected:

1. Hook blocks execution
2. Reason message shown to user explaining what was detected
3. User must explicitly confirm to proceed (re-invoke with approval)
