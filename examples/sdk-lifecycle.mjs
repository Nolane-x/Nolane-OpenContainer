import { OpenContainer } from '../packages/sdk/src/index.js';

const runtime=await OpenContainer.boot();
runtime.mount({
  'package.json':'{"name":"sdk-lifecycle-example"}',
  'src/index.js':'export const answer = 42;'
});

runtime.registerCommand('echo',({args,stdout})=>{
  stdout(args.join(' '));
  return 0;
});
const process=runtime.spawn('echo',['hello','opencontainer']);
const exitCode=await process.exit;

const previewReceipt=runtime.listen(3000,()=>new Response('preview-ok'),{owner:'sdk-example'});
const previewText=await (await runtime.preview.dispatch(3000,{},previewReceipt)).text();

const snapshot=runtime.snapshot('before-edit');
runtime.fs.beginTransaction().writeFile('src/index.js','export const answer = 99;').commit();
runtime.restore(snapshot);

const exported=runtime.export(snapshot);
const imported=await OpenContainer.boot();
await imported.import(exported);

const receipt={
  exitCode,
  stdout:process.stdout.toString(),
  previewText,
  restoredSource:runtime.fs.readFile('src/index.js'),
  importedSource:imported.fs.readFile('src/index.js'),
  status:runtime.status().state
};

await imported.teardown();
await runtime.teardown();

console.log(JSON.stringify(receipt));
