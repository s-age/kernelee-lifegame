#!/usr/bin/env node
// scripts/introspect-mcp-server.mjs — thin launcher for the kernel-introspect
// MCP server.
//
// @s-age/kernelee-mcp-tools exports runKernelIntrospectMCPServer only as a
// library function (package.json exports["./server"]) and provides no
// reference executable binary. So the consumer side keeps this thin launcher,
// bakes in the defaults (indexPath / repoRoot / refreshCommand), and makes
// them overridable via configurationFromEnvironmentOverridingDefaults.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let mod;
try {
  mod = await import('@s-age/kernelee-mcp-tools/server');
} catch (error) {
  // node_modules/@s-age/kernelee-mcp-tools is a file: dependency symlink, and
  // npm install does not generate its own dist/ (dist/ is gitignored, with no
  // prepare/postinstall). When unbuilt, this would die with a bare
  // ERR_MODULE_NOT_FOUND, so print guidance and exit quietly.
  console.error(
    '[kernel-introspect] @s-age/kernelee-mcp-tools is not built. ' +
      'For the first run, execute (cd ../kernelee-mcp-tools && npm run build).\n' +
      String(error),
  );
  process.exit(1);
}

const { configurationFromEnvironmentOverridingDefaults, runKernelIntrospectMCPServer } = mod;

// arch_monitor's data source: the rolling TraceState dump the devtools bridge persists from the
// live session (bridge `--trace-out`, default). The default path is derived from the SAME shared
// rule the bridge CLI itself uses, imported from its dependency-zero "./trace-path" subpath (no
// ws/server load) so both sides land on the identical repoRoot-derived path without either
// hardcoding the string a second time. Overridable via KERNEL_INTROSPECT_TRACE_PATH.
let tracePath;
try {
  const { defaultTraceOutPath } = await import('@s-age/kernelee-devtools-bridge/trace-path');
  tracePath = defaultTraceOutPath(repoRoot);
} catch (error) {
  // devtools-bridge is not built. Unlike mcp-tools above, this is not fatal — only arch_monitor
  // is affected (it reports tracePath as unset), so the other five tools keep working.
  console.error(
    '[kernel-introspect] @s-age/kernelee-devtools-bridge is not built; ' +
      'arch_monitor will report tracePath as unset. ' +
      'To enable: (cd ../kernelee-devtools-bridge && npm run build).\n' +
      String(error),
  );
  tracePath = undefined;
}

const defaults = {
  indexPath: resolve(repoRoot, '.claude/introspect/index.json'),
  repoRoot,
  refreshCommand: 'npm run introspect',
  refreshTimeoutSeconds: 300,
  // Unset → arch_monitor reports it cleanly and the other five tools are unaffected.
  tracePath,
};

await runKernelIntrospectMCPServer(configurationFromEnvironmentOverridingDefaults(defaults));
