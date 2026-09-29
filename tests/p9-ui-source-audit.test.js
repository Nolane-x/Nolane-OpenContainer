import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync('apps/playground/public/index.html','utf8');
const css=readFileSync('apps/playground/public/index.css','utf8');
const ui=readFileSync('apps/playground/public/index.js','utf8');

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
