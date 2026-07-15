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

const defaults = {
  indexPath: resolve(repoRoot, '.claude/introspect/index.json'),
  repoRoot,
  refreshCommand: 'npm run introspect',
  refreshTimeoutSeconds: 300,
  // arch_monitor's data source: the rolling TraceState dump the devtools bridge
  // persists from the live session (bridge `--trace-out`, default). Overridable
  // via KERNEL_INTROSPECT_TRACE_PATH. Unset → arch_monitor reports it cleanly
  // and the other five tools are unaffected.
  tracePath: '/tmp/kernelee-trace.json',
};

await runKernelIntrospectMCPServer(configurationFromEnvironmentOverridingDefaults(defaults));
