// scripts/introspect.config.ts — configuration module for the kernelee-introspect CLI.
//
// `npm run introspect` (= `tsx kernelee-introspect scripts/introspect.config.ts`)
// dynamically imports this and reads the default export as an IntrospectConfig.
// Thin code connecting the generic scan (kernelee-mcp-tools) to the layout of
// the real repository.
//
// projectWiring uses the same expression as main.tsx's bridge send
// (projectWiringGraph(mergeWiringCatalog(flowCatalog), boundSymbolIds, guardCatalog)),
// but injects memoryStorage() rather than the production window.localStorage into
// the makeKernel that yields boundSymbolIds/flowCatalog/guardCatalog — it
// assembles a hermetic, throwaway kernel that never touches real I/O just to
// read those.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { projectWiringGraph } from '@s-age/kernelee';
import type { IntrospectConfig } from '@s-age/kernelee-mcp-tools';
import { mergeWiringCatalog } from '../src/circuit/wiringCatalog';
import { makeKernel } from '../src/driver/wiring';
import { makeSettingsStore, memoryStorage } from '../src/infrastructure/settingsStore';
import { ASSEMBLED_WIRING_ISSUE_ALLOWLIST } from './wiringIssueAllowlist';
import { OFF_BUFFER_CONTROL_VALUE_ALLOWLIST } from './offBufferControlValueAllowlist';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default {
  repoRoot,
  tsConfigFilePath: resolve(repoRoot, 'tsconfig.json'),
  outputPath: resolve(repoRoot, '.claude/introspect/index.json'),
  catalogFile: resolve(repoRoot, 'src/circuit/wiringCatalog.ts'),
  catalogFunction: 'buildWiringCatalog',
  stateFiles: [resolve(repoRoot, 'src/contract/states.ts')],
  projectWiring: () => {
    const { boundSymbolIds, flowCatalog, guardCatalog } = makeKernel({ settingsStore: makeSettingsStore(memoryStorage()) });
    return projectWiringGraph(mergeWiringCatalog(flowCatalog), boundSymbolIds, guardCatalog);
  },
  // Detection (validateWiringGraph → unresolved) always runs. The ASSEMBLED-layer
  // allowlist is empty (RAW_WIRING_ISSUE_ALLOWLIST is exactly the 3
  // COMMAND_PROMOTED_UNLISTED entries — pause/strokeEnd/clearError — and
  // ASSEMBLED subtracts those same 3 from RAW, cancelling out to nothing), so
  // any unknown issue turns npm run introspect into a hard CI error
  // ("detection = tool side, judgment = app side"). If the promotion
  // regresses and pause/strokeEnd/clearError reappear as unresolved, they are
  // not in this (empty) allowlist, so it is an immediate hard error = the
  // 3→0 reversal tripwire stays armed.
  failOnWiringIssues: true,
  wiringIssueAllowlist: ASSEMBLED_WIRING_ISSUE_ALLOWLIST,
  // offBufferControlValue comes from the static scan, a separate gate from the
  // 3 wiring-graph kinds (WIRING_GRAPH_ISSUE_KINDS). Any new off-Buffer value
  // (regression or addition) is not in this list, so it becomes an immediate
  // hard error.
  failOnOffBufferControlValues: true,
  offBufferControlValueAllowlist: OFF_BUFFER_CONTROL_VALUE_ALLOWLIST,
} satisfies IntrospectConfig;
