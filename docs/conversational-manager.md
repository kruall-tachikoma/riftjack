# Conversational manager

The connector owner may describe administration requests in the manager DM.
A separate, ephemeral Codex planning turn receives a redacted account inventory,
rooms shared by the owner and manager, command help and recent operation results.
It returns a bounded command plan. The connector parses every command, requires
exact bot IDs, requests confirmation and executes the approved commands through
existing handlers. It does not interpret model text as shell code. Other authorized
users retain the existing command interface and permissions.

The planner uses the configured Codex login and model. Shell, execution, apps,
configured MCP servers, web search and agent delegation are disabled for its thread;
the sandbox is read-only. Project instructions are excluded. No model call is
needed to process confirmation reactions. Original command confirmations (such as
workspace selection) still apply and may produce an additional confirmation.

## Rooms

The manager must already be joined, together with the owner, to an encrypted,
invite-only room whose history visibility is `joined`. Invite permission is
required by Matrix. Invitation is separate from enabling responses. The result
reports an invitation as pending rather than claiming the bot has joined.

Policies are keyed by bot ID and room ID and saved to `room-policies.json`:

- `audience`: `owner`, `users` with exact IDs, or `members`.
- `mode`: `off`, `mentions`, `threads`, or `all`.
- `threads` admits explicit mentions and replies in threads rooted at a bot message.
- `mentions` uses Matrix's structured mentions, not display-name substring matching.

Only local Codex and Claude bots are supported. Local bots cannot start each other
through these policies. Membership and privacy are checked again before replies.
Each bot/user/room/thread has its own session key. Existing conversation links are
not replaced or extended. Permissions here grant no access outside the room.
The manager lists at most 100 joined rooms; use an exact ID for other rooms.

## Recovery and limitations

`manager-history.json` records approved commands, in-flight step indexes and results.
An interruption or exception during execution leaves an uncertain step; an identical
proposal is blocked across all retained runs, including other conversations.
Reconciling such entries currently requires administrator inspection of actual state
and the history file; the planner cannot clear them. No automatic replay or rollback occurs.
Account creation must be proposed alone, so declining its additional confirmation
cannot accidentally continue a dependent multi-step plan.
Generated Matrix passwords are excluded from the operation history and model input.
Changes to room policy cancel active work in that room, including when the policy
is broadened; users can send a new request with the new policy.

The planner has been smoke-tested with a live Codex session and a synthetic read-only inventory.
Room grants and uncertain operation persistence have regression tests. End-to-end
Matrix invitations still require a trial in an explicitly selected room.
