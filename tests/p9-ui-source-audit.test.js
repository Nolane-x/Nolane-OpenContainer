import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync('apps/playground/public/index.html','utf8');
const css=readFileSync('apps/playground/public/index.css','utf8');
const ui=readFileSync('apps/playground/public/index.js','utf8');
const runner=readFileSync('scripts/p9-ui-rendered.mjs','utf8');
const workflow=readFileSync('.github/workflows/ci.yml','utf8');

test('P9 reference shell binds Preview Inspect and AI to real runtime authorities',()=>{
  assert.match(ui,/OpenContainer/);
  assert.match(ui,/new AiAuthority/);
  assert.match(ui,/ExternalWorkspaceSourceAuthority/);
  assert.match(ui,/createSandboxedPreviewFrame/);
  assert.match(ui,/runtime\.listen\(4173/);
  assert.match(ui,/runtime\.status\(\)/);
  assert.match(ui,/runtime\.diagnostics\.summary\(\)/);
  assert.match(ui,/workspacePersistence/);
  assert.match(html,/data-view="preview"/);
  assert.match(html,/data-view="inspect"/);
  assert.match(html,/data-view="ai"/);
});

test('P9 authority acknowledgements are emitted only after canonical operations complete',()=>{
  const save=ui.match(/async function saveSource\(\)[\s\S]*?return Object\.freeze\(\{generation,checkpoint\}\);/)?.[0]??'';
  assert.match(save,/tx\.commit\(\)/);
  assert.match(save,/await persistCanonical\('save'\)/);
  assert.ok(save.indexOf("await persistCanonical('save')")<save.indexOf("textContent='Saved"));
  const restore=ui.match(/async function restoreSource\(\)[\s\S]*?return Object\.freeze\(\{generation,checkpoint\}\);/)?.[0]??'';
  assert.match(restore,/runtime\.restore\(snapshot\)/);
  assert.match(restore,/await persistCanonical\('restore-source'\)/);
  assert.ok(restore.indexOf("await persistCanonical('restore-source')")<restore.indexOf("textContent='Restored"));
});

test('P9 destructive and irreversible actions remain secondary explicit and truthful',()=>{
  assert.match(html,/id="open-destructive" class="button-secondary"/);
  assert.match(html,/A recovery point will be created first/);
  assert.match(html,/id="confirm-destructive" class="button-danger"/);
  assert.match(html,/id="open-clear-diagnostics" class="button-secondary"/);
  assert.match(html,/It cannot be undone and does not change workspace files/);
  assert.match(html,/id="confirm-clear-diagnostics" class="button-danger"/);
  assert.match(ui,/runtime\.snapshot\('before-source-remove'\)/);
  assert.match(ui,/runtime\.diagnostics\.clear\(\)/);
});

test('P9 keyboard focus IME and responsive media contracts are retained',()=>{
  assert.match(html,/role="tablist"/);
  assert.equal((html.match(/role="tab"/g)??[]).length,3);
  assert.equal((html.match(/role="tabpanel"/g)??[]).length,3);
  assert.match(ui,/ArrowLeft/);
  assert.match(ui,/ArrowRight/);
  assert.match(ui,/compositionstart/);
  assert.match(ui,/compositionend/);
  assert.match(ui,/shellState\.composing/);
  assert.match(ui,/lastDialogOpener/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/@media\(forced-colors:active\)/);
  assert.match(css,/\[dir=rtl\]/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/@media\(max-width:420px\)/);
});

test('P9 linked-folder conflict state is rendered from external authority truth',()=>{
  assert.match(ui,/new ExternalWorkspaceSourceAuthority/);
  assert.match(ui,/await shellState\.linkedAuthority\.inspect\(\)/);
  assert.match(ui,/await shellState\.linkedAuthority\.readFile\(path\)/);
  assert.match(ui,/await shellState\.linkedAuthority\.writeFile\(path,data,\{expectedRevision\}\)/);
  assert.match(ui,/error\?\.details\?\.actions/);
  assert.match(ui,/external-change-detected/);
  assert.match(html,/Linked folder/);
});

test('P9 source shell does not pretend to close manual or missing-registry gates',()=>{
  // Promotion evidence must be provided by a separate court; source shell alone must never encode closure.
  for(const id of ['P9-03','P9-05','P9-11','P9-12'])assert.equal(ui.includes(id),false,id);
});


test('P9 rendered promotion scope excludes manual and missing-registry gates',()=>{
  const block=runner.match(/sourceGates:\[([\s\S]*?)\],\n    intentionallyOpenGates:/)?.[1]??'';
  for(const id of [
    'P9-01','P9-02','P9-04','P9-06','P9-07','P9-08','P9-09',
    'P9-10','P9-13','P9-14','P9-15','P9-16','P9-17','P9-18'
  ]) assert.ok(block.includes("'"+id+"'"),id);
  for(const id of ['P9-03','P9-05','P9-11','P9-12'])assert.equal(block.includes(id),false,id);
  assert.match(runner,/failureRegistry280Claimed:false/);
  assert.match(runner,/manualScreenReaderClaimed:false/);
  assert.match(runner,/humanComprehensionClaimed:false/);
  assert.match(runner,/weakDeviceLongSessionClaimed:false/);
  assert.match(workflow,/p9-ui-rendered:\n    needs: \[contract, codeql, p3-native-external-permission\]/);
});

test('P9 rendered court uses accessibility tree keyboard emulation and actual viewport screenshots',()=>{
  assert.match(runner,/Accessibility\.getFullAXTree/);
  assert.match(runner,/Input\.dispatchKeyEvent/);
  assert.match(runner,/Emulation\.setDeviceMetricsOverride/);
  assert.match(runner,/Emulation\.setEmulatedMedia/);
  assert.match(runner,/Emulation\.setPageScaleFactor/);
  assert.match(runner,/Page\.captureScreenshot/);
  assert.match(runner,/linkedConflictCourt/);
  assert.match(runner,/Page\.reload/);
});


test('P9 root import map is CSP-hashed without unsafe-inline',()=>{
  assert.match(html,/type="importmap"/);
  assert.match(html,/"es-module-lexer\/minimal\/js": "\/__deps__\/es-module-lexer-minimal\.js"/);
  assert.match(workflow,/p9-ui-rendered:/);
  const server=readFileSync('apps/playground/server.mjs','utf8');
  assert.match(server,/sha256-rkMvapmVZt\+MUBo5i8Nx4sVYZ0HtjK3on\/kn9IG2F10=/);
  const rootCsp=server.slice(server.indexOf("if (url.pathname === '/' || url.pathname === '/index.html')"),server.indexOf("if (url.pathname === '/browser-acceptance.html')"));
  assert.doesNotMatch(rootCsp,/unsafe-inline/);
});
