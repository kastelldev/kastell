# Slow Test Audit — 2026-05-18

## Top 13 slow tests (>1000ms)

| Duration | File | Test |
|---|---|---|
| 4817ms | cli-help-snapshots.test.ts | kastell plugin install --help matches snapshot |
| 4719ms | cli-help-snapshots.test.ts | kastell --help matches snapshot |
| 4669ms | cli-help-snapshots.test.ts | kastell plugin --help matches snapshot |
| 4667ms | cli-help-snapshots.test.ts | kastell fix --help matches snapshot |
| 4536ms | cli-help-snapshots.test.ts | kastell audit --help matches snapshot |
| 4378ms | cli-help-snapshots.test.ts | kastell secure --help matches snapshot |
| 4369ms | cli-help-snapshots.test.ts | kastell provision --help matches snapshot |
| 4349ms | cli-help-snapshots.test.ts | kastell lock --help matches snapshot |
| 4291ms | cli-help-snapshots.test.ts | kastell guard --help matches snapshot |
| 4288ms | cli-help-snapshots.test.ts | kastell init --help matches snapshot |
| 1441ms | mcpRpcClient.test.ts | boots MCP server and lists tools via RPC |
| 1019ms | core-status-restart.test.ts | restart succeeds + Coolify running |
| 1005ms | core-status-restart.test.ts | restart succeeds + health check fails |

## Patterns

- **Snapshot tests (12 tests, 4-5s each):** CLI help snapshots spawn `kastell --help` via
  `spawnSync` per test. Cold startup ~400ms x 12 = 4.8s overhead per test file.
- **MCP harness (1 test, 1441ms):** In-process MCP server boot. Expected for integration.
- **Status-restart (2 tests, ~1s each):** Real `setTimeout`/`setInterval` in health-check
  polling.

## Fix Recommendations (P140)

- [ ] CLI snapshot reuse: single spawn per describe block, not per test
- [ ] MCP harness reuse: module-level singleton, `beforeAll` boot / `afterAll` shutdown
- [ ] Fake timers for status-restart: `jest.useFakeTimers()` with `jest.runAllTimersAsync()`
