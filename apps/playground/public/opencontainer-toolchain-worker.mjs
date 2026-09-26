// Toolchain-only bootstrap.
// The response CSP for this entry point permits JavaScript dynamic code generation
// required by the promoted Vite 8 dependency optimizer. The imported guest runtime
// still installs the same capability membrane, publication scoping, timeout kill,
// and ResourceGovernor Worker lease boundaries as the strict profile.
import './opencontainer-guest-worker.mjs';
