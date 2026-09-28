import { OpenContainer } from '/packages/sdk/src/index.js';
import { ErrorCodes } from '/packages/protocol/src/index.js';

function assert(condition,message,details={}){
  if(condition)return;
  const error=new Error(message);
  error.details=details;
  throw error;
}

async function commandCourt(){
  const runtime=await OpenContainer.boot();
  try{
    runtime.packages.compile({
      name:'app',
      version:'1',
      lockfileVersion:3,
      packages:{
        '':{name:'app',version:'1',dependencies:{a:'1',rootTool:'1'}},
        'node_modules/a':{name:'a',version:'1'},
        'node_modules/root-tool':{name:'root-tool',version:'1',bin:{tool:'bin/tool.cjs'}},
        'node_modules/a/node_modules/nested-tool':{name:'nested-tool',version:'1',bin:{tool:'bin/tool.cjs'}}
      }
    });
    runtime.mount({'package.json':'{"name":"app","type":"commonjs"}'});
    runtime.packages.mountCatalog({
      packages:[
        {
          location:'node_modules/a',
          packageJson:{name:'a',version:'1',type:'commonjs'},
          files:{'index.js':'module.exports=1'}
        },
        {
          location:'node_modules/root-tool',
          packageJson:{name:'root-tool',version:'1',type:'commonjs'},
          files:{'bin/tool.cjs':'console.log("root:"+process.cwd())'}
        },
        {
          location:'node_modules/a/node_modules/nested-tool',
          packageJson:{name:'nested-tool',version:'1',type:'commonjs'},
          files:{'bin/tool.cjs':'console.log("nested:"+process.cwd())'}
        }
      ]
    });

    const root=runtime.packages.resolveBin('tool',{cwd:'/workspace'});
    const nested=runtime.packages.resolveBin('tool',{cwd:'/workspace/node_modules/a/src'});
    assert(root.package==='root-tool','root command candidate drifted',{root});
    assert(nested.package==='nested-tool','nested command candidate drifted',{nested});

    const linked=runtime.installPackageCommands({allowDynamicCode:true});
    assert(linked.commands.length===1,'contextual command index should register one command name',{commands:linked.commands});
    assert(linked.commands[0].contextual===true,'command registration lost contextual marker',{command:linked.commands[0]});
    assert(linked.commands[0].candidateCount===2,'command registration lost candidates',{command:linked.commands[0]});

    const rootChild=runtime.spawn('tool',[],{cwd:'/workspace'});
    assert(await rootChild.exit===0,'root contextual command failed');
    assert(rootChild.stdout.toString()==='root:/workspace\n','root contextual command selected wrong executable',{stdout:rootChild.stdout.toString()});

    const nestedChild=runtime.spawn('tool',[],{cwd:'/workspace/node_modules/a/src'});
    assert(await nestedChild.exit===0,'nested contextual command failed');
    assert(nestedChild.stdout.toString()==='nested:/workspace/node_modules/a/src\n','nested contextual command selected wrong executable',{stdout:nestedChild.stdout.toString()});

    linked.bridge.dispose();
    return Object.freeze({
      rootPackage:root.package,
      rootLocation:root.location,
      nestedPackage:nested.package,
      nestedLocation:nested.location,
      candidateCount:2,
      lastWriterWins:false
    });
  }finally{
    await runtime.terminate();
  }
}

async function ambiguityCourt(){
  const runtime=await OpenContainer.boot();
  try{
    runtime.packages.compile({
      lockfileVersion:3,
      packages:{
        'node_modules/a-tool':{name:'a-tool',version:'1',bin:{tool:'a.cjs'}},
        'node_modules/b-tool':{name:'b-tool',version:'1',bin:{tool:'b.cjs'}}
      }
    });
    runtime.mount({'package.json':'{"type":"commonjs"}'});
    runtime.packages.mountCatalog({
      packages:[
        {location:'node_modules/a-tool',packageJson:{name:'a-tool',type:'commonjs'},files:{'a.cjs':'module.exports=1'}},
        {location:'node_modules/b-tool',packageJson:{name:'b-tool',type:'commonjs'},files:{'b.cjs':'module.exports=1'}}
      ]
    });
    let failure=null;
    try{runtime.packages.resolveBin('tool',{cwd:'/workspace'});}
    catch(error){failure={code:error?.code??null,message:error?.message??String(error)};}
    assert(failure?.code===ErrorCodes.INVALID_PACKAGE_CONFIG,'same-scope .bin ambiguity did not fail closed',{failure});
    return Object.freeze({failure,failClosed:true});
  }finally{
    await runtime.terminate();
  }
}

async function diagnosticsCourt(){
  const runtime=await OpenContainer.boot();
  const secret='p4-secret-'+('x'.repeat(40));
  try{
    runtime.packages.compile({
      name:'diag-app',
      version:'1.0.0',
      lockfileVersion:3,
      packages:{
        '':{name:'diag-app',version:'1.0.0',dependencies:{dep:'1.2.3'}},
        'node_modules/dep':{
          name:'dep',
          version:'1.2.3',
          integrity:'sha512-'+secret,
          resolved:'https://user:'+secret+'@registry.example.test/dep.tgz?token='+secret+'#private',
          hasInstallScript:true
        }
      }
    });
    const bundle=runtime.supportBundle();
    const serialized=JSON.stringify(bundle);
    const component=bundle.packages.components[0];
    assert(serialized.includes(secret)===false,'support bundle leaked package source credential/query secret');
    assert(component.source.kind==='https','package source kind drifted',{source:component.source});
    assert(component.source.url==='https://registry.example.test/dep.tgz','package source URL was not privacy sanitized',{source:component.source});
    assert(/^ocfp:[0-9a-f]{16}$/.test(component.source.fingerprint),'package source provenance fingerprint missing',{source:component.source});
    assert(component.hasInstallScript===true,'install-script metadata missing',{component});
    assert(bundle.packages.installScripts.policy==='deny-by-default','install-script diagnostics policy drifted',{installScripts:bundle.packages.installScripts});
    assert(bundle.packages.installScripts.packageCount===1,'install-script package count drifted',{installScripts:bundle.packages.installScripts});
    assert(bundle.packages.analysisScope==='package-provenance-metadata-only','package diagnostics scope drifted',{analysisScope:bundle.packages.analysisScope});
    assert(bundle.packages.scaAssessmentPerformed===false,'package diagnostics pretended to perform SCA',{scaAssessmentPerformed:bundle.packages.scaAssessmentPerformed});
    assert(bundle.packages.nativeAddonBoundary.policy==='deny-unless-exact-adapter','native-addon diagnostics boundary drifted',{nativeAddonBoundary:bundle.packages.nativeAddonBoundary});
    assert(bundle.packages.nativeAddonBoundary.detection==='resolver-exact-.node-target-only','native-addon diagnostics detection scope drifted',{nativeAddonBoundary:bundle.packages.nativeAddonBoundary});
    assert(/^layout:[0-9a-f]{16}$/.test(bundle.packages.layout.fingerprint),'package layout fingerprint missing from diagnostics',{layout:bundle.packages.layout});
    return Object.freeze({
      sourceKind:component.source.kind,
      sanitizedSourceUrl:component.source.url,
      sourceFingerprint:component.source.fingerprint,
      installScriptPolicy:bundle.packages.installScripts.policy,
      installScriptPackages:bundle.packages.installScripts.packageCount,
      analysisScope:bundle.packages.analysisScope,
      scaAssessmentPerformed:bundle.packages.scaAssessmentPerformed,
      nativeAddonPolicy:bundle.packages.nativeAddonBoundary.policy,
      nativeAddonDetection:bundle.packages.nativeAddonBoundary.detection,
      leakedSecret:false
    });
  }finally{
    await runtime.terminate();
  }
}

async function nativeAddonCourt(){
  const runtime=await OpenContainer.boot();
  try{
    runtime.mount({
      'package.json':'{"name":"addon-app","type":"commonjs"}',
      'entry.cjs':'module.exports=require("native-pkg")'
    });
    runtime.packages.mountCatalog({
      packages:[{
        location:'node_modules/native-pkg',
        packageJson:{name:'native-pkg',version:'1.0.0',type:'commonjs',main:'binding.node'},
        files:{
          'binding.node':'not-a-native-binary',
          'adapter.cjs':'module.exports={kind:"explicit-browser-adapter",value:42}'
        }
      }]
    });
    const addon='/workspace/node_modules/native-pkg/binding.node';
    const adapter='/workspace/node_modules/native-pkg/adapter.cjs';

    let genericAliasFailure=null;
    try{
      runtime.packages.resolve('native-pkg','/workspace/entry.cjs',{
        mode:'cjs',
        pathAliases:{[addon]:adapter}
      });
    }catch(error){
      genericAliasFailure={code:error?.code??null,message:error?.message??String(error)};
    }
    assert(genericAliasFailure?.code===ErrorCodes.NATIVE_ADDON_UNSUPPORTED,'generic path alias bypassed native-addon boundary',{genericAliasFailure});

    const resolved=runtime.packages.resolve('native-pkg','/workspace/entry.cjs',{
      mode:'cjs',
      nativeAddonAdapters:{[addon]:adapter}
    });
    assert(resolved.path===adapter,'explicit native-addon adapter selected wrong target',{resolved});
    assert(resolved.nativeAddonAdapter?.explicit===true,'explicit native-addon adapter receipt missing',{resolved});

    const loader=runtime.packages.createCommonJsLoader({
      allowDynamicCode:true,
      nativeAddonAdapters:{[addon]:adapter}
    });
    const value=loader.require('./entry.cjs','/workspace/bootstrap.cjs');
    assert(value?.kind==='explicit-browser-adapter'&&value?.value===42,'explicit native-addon adapter did not execute through CommonJS boundary',{value});

    return Object.freeze({
      genericAliasFailureCode:genericAliasFailure.code,
      adapterSource:resolved.nativeAddonAdapter.source,
      adapterTarget:resolved.nativeAddonAdapter.target,
      explicit:resolved.nativeAddonAdapter.explicit,
      value:value.value,
      hostNativeExecution:false
    });
  }finally{
    await runtime.terminate();
  }
}

async function run(){
  const [command,ambiguity,diagnostics,nativeAddon]=await Promise.all([
    commandCourt(),
    ambiguityCourt(),
    diagnosticsCourt(),
    nativeAddonCourt()
  ]);
  return Object.freeze({
    schema:'opencontainer.p4-command-diagnostics.v1.0',
    status:'PASS',
    browser:navigator.userAgent,
    crossOriginIsolated:globalThis.crossOriginIsolated,
    sourceGates:Object.freeze(['P4-14','P4-17','P4-18']),
    command,
    ambiguity,
    diagnostics,
    nativeAddon
  });
}

globalThis.__p4CommandDiagnosticsCourt=Object.freeze({run});
document.body.dataset.ready='true';
document.getElementById('result').textContent='ready';
