import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateP9HumanArtifact } from '../scripts/p9-human-acceptance.mjs';

const policy=JSON.parse(readFileSync('release/P9-HUMAN-ACCEPTANCE-POLICY.v1.0.json','utf8'));
const ledger=JSON.parse(readFileSync('docs/production/PRODUCTION-GATE-RECONCILIATION-v0.1.json','utf8'));
const flake=JSON.parse(readFileSync('release/CRITICAL-FLAKE-POLICY.v0.1.json','utf8'));
const workflow=readFileSync('.github/workflows/p9-human-acceptance-evidence.yml','utf8');

const sourceCommit='a'.repeat(40);
function screenReaderArtifact(){
  return {
    schema:'opencontainer.p9-human-acceptance.v1.0',
    evidenceType:'manual-screen-reader',
    sourceCommit,
    issuedAt:'2026-10-01T00:00:00Z',
    evaluator:{id:'sr-evaluator-01',human:true},
    environment:{
      screenReader:{name:'NVDA',version:'2026.1'},
      browser:{name:'Google Chrome',version:'153.0.8010.52'},
      os:{name:'Windows',version:'11'}
    },
    taskResults:[
      'startup-status-and-main-landmarks',
      'view-navigation-preview-inspect-ai',
      'modal-dialog-focus-and-dismissal',
      'editor-save-acknowledgement',
      'process-output-and-recovery',
      'linked-folder-permission-or-conflict-state'
    ].map(id=>({id,status:'PASS'})),
    conclusion:'PASS'
  };
}
function participant(id,{wrongScenario=null,criticalScenario=null}={}){
  const classes=[
    'primary-action',
    'failure-state',
    'recovery-guidance',
    'permission-or-conflict',
    'destructive-or-high-impact-action'
  ];
  return {
    id,
    human:true,
    scenarioResults:classes.map(scenarioClass=>({
      scenarioClass,
      correct:scenarioClass!==wrongScenario,
      criticalMisinterpretation:scenarioClass===criticalScenario
    }))
  };
}
function comprehensionArtifact(){
  return {
    schema:'opencontainer.p9-human-acceptance.v1.0',
    evidenceType:'human-comprehension',
    sourceCommit,
    issuedAt:'2026-10-01T00:00:00Z',
    evaluator:{id:'study-facilitator-01',human:true},
    participants:[
      participant('p-001'),
      participant('p-002'),
      participant('p-003'),
      participant('p-004'),
      participant('p-005')
    ],
    conclusion:'PASS'
  };
}

test('manual screen-reader evidence requires a human evaluator, exact AT environment and all preregistered tasks',()=>{
  const good=validateP9HumanArtifact(screenReaderArtifact(),{expectedType:'manual-screen-reader',expectedCommit:sourceCommit});
  assert.deepEqual(good.errors,[]);

  const missing=screenReaderArtifact();
  missing.taskResults=missing.taskResults.slice(0,-1);
  assert.ok(validateP9HumanArtifact(missing,{expectedType:'manual-screen-reader',expectedCommit:sourceCommit}).errors.some(x=>x.includes('task missing')));

  const machine=screenReaderArtifact();
  machine.evaluator.human=false;
  assert.ok(validateP9HumanArtifact(machine,{expectedType:'manual-screen-reader',expectedCommit:sourceCommit}).errors.some(x=>x.includes('evaluator must be human')));

  const noVersion=screenReaderArtifact();
  noVersion.environment.screenReader.version='';
  assert.ok(validateP9HumanArtifact(noVersion,{expectedType:'manual-screen-reader',expectedCommit:sourceCommit}).errors.some(x=>x.includes('screenReader version missing')));
});

test('human comprehension requires five humans, complete scenario coverage, >=80% accuracy and zero critical misinterpretation',()=>{
  const good=validateP9HumanArtifact(comprehensionArtifact(),{expectedType:'human-comprehension',expectedCommit:sourceCommit});
  assert.deepEqual(good.errors,[]);
  assert.equal(good.metrics.participants,5);
  assert.equal(good.metrics.accuracy,1);
  assert.equal(good.metrics.criticalMisinterpretations,0);

  const tooSmall=comprehensionArtifact();
  tooSmall.participants.pop();
  assert.ok(validateP9HumanArtifact(tooSmall,{expectedType:'human-comprehension',expectedCommit:sourceCommit}).errors.some(x=>x.includes('at least 5 participants')));

  const missing=comprehensionArtifact();
  missing.participants[0].scenarioResults.pop();
  assert.ok(validateP9HumanArtifact(missing,{expectedType:'human-comprehension',expectedCommit:sourceCommit}).errors.some(x=>x.includes('missing scenario')));
});

test('human comprehension rejects direct identity fields, duplicate pseudonymous IDs and nonhuman participants',()=>{
  const identified=comprehensionArtifact();
  identified.participants[0].email='person@example.invalid';
  assert.ok(validateP9HumanArtifact(identified,{expectedType:'human-comprehension',expectedCommit:sourceCommit}).errors.some(x=>x.includes('forbidden direct-identity key email')));

  const duplicate=comprehensionArtifact();
  duplicate.participants[4].id=duplicate.participants[0].id;
  assert.ok(validateP9HumanArtifact(duplicate,{expectedType:'human-comprehension',expectedCommit:sourceCommit}).errors.some(x=>x.includes('participant ids must be unique')));

  const machine=comprehensionArtifact();
  machine.participants[2].human=false;
  assert.ok(validateP9HumanArtifact(machine,{expectedType:'human-comprehension',expectedCommit:sourceCommit}).errors.some(x=>x.includes('must be human')));
});

test('human comprehension fails below frozen accuracy or on one critical misinterpretation',()=>{
  const low=comprehensionArtifact();
  for(let i=0;i<2;i++){
    low.participants[i].scenarioResults=low.participants[i].scenarioResults.map(row=>({...row,correct:false}));
  }
  const lowResult=validateP9HumanArtifact(low,{expectedType:'human-comprehension',expectedCommit:sourceCommit});
  assert.ok(lowResult.metrics.accuracy<0.8);
  assert.ok(lowResult.errors.some(x=>x.includes('accuracy below 0.8')));

  const critical=comprehensionArtifact();
  critical.participants[0].scenarioResults[4].criticalMisinterpretation=true;
  const criticalResult=validateP9HumanArtifact(critical,{expectedType:'human-comprehension',expectedCommit:sourceCommit});
  assert.equal(criticalResult.metrics.criticalMisinterpretations,1);
  assert.ok(criticalResult.errors.some(x=>x.includes('critical misinterpretations must be zero')));
});

test('human acceptance artifact cannot drift evidence type or source commit',()=>{
  const artifact=screenReaderArtifact();
  assert.ok(validateP9HumanArtifact(artifact,{expectedType:'human-comprehension',expectedCommit:sourceCommit}).errors.some(x=>x.includes('evidence type drift')));
  assert.ok(validateP9HumanArtifact(artifact,{expectedType:'manual-screen-reader',expectedCommit:'b'.repeat(40)}).errors.some(x=>x.includes('source commit drift')));
});

test('P9 human evidence workflow is manual main-only, read-only, no-secret and shell-safe',()=>{
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(!workflow.includes('pull_request:'));
  assert.ok(!workflow.includes('push:'));
  assert.match(workflow,/permissions:\n\s+contents:\s+read/);
  assert.doesNotMatch(workflow,/\$\{\{\s*secrets\.|contents:\s*write|packages:\s*write|id-token:\s*write|npm publish/);
  assert.ok(workflow.includes("github.ref == 'refs/heads/main'"));
  assert.ok(workflow.includes('git cat-file -e "$OC_HUMAN_SOURCE_COMMIT^{commit}"'));
  assert.ok(workflow.includes('--type="$OC_HUMAN_EVIDENCE_TYPE"'));
  assert.ok(workflow.includes('--source-commit="$OC_HUMAN_SOURCE_COMMIT"'));
  assert.ok(workflow.includes('--url="$OC_HUMAN_ARTIFACT_URL"'));
  assert.ok(workflow.includes('--sha256="$OC_HUMAN_ARTIFACT_SHA256"'));
});

test('P9 human acceptance remains non-machine-closable and preserves weak-device blocker',()=>{
  assert.equal(policy.status,'PREREGISTERED_AWAITING_HUMAN_EVIDENCE');
  assert.equal(policy.gates['P9-05'].automaticLedgerClosure,false);
  assert.equal(policy.gates['P9-11'].automaticLedgerClosure,false);
  for(const id of ['P9-05','P9-11','P9-12']){
    const row=ledger.overrides.find(x=>x.id===id);
    assert.ok(!row||row.closure_met!==true,id+' must remain open');
  }
  assert.equal(ledger.overrides.filter(x=>x.closure_met===true).length,277);
  assert.equal(ledger.production_closed,false);
});

test('P9 human acceptance verifier is retained by the repeated critical campaign',()=>{
  assert.ok(flake.contract.testFiles.includes('tests/p9-human-acceptance.test.js'));
  assert.equal(flake.contract.testFiles.length,flake.contract.minimumTestFiles);
  assert.ok(flake.contract.testFiles.length>=114);
  assert.equal(flake.contract.iterations,5);
});
