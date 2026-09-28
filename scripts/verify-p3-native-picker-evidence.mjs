import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path=process.argv[2]??process.env.OPENCONTAINER_P3_NATIVE_PICKER_RECEIPT;
if(!path){
  console.error('usage: node scripts/verify-p3-native-picker-evidence.mjs <receipt.json>');
  process.exit(2);
}

const receipt=JSON.parse(await readFile(resolve(path),'utf8'));
const failures=[];
const expect=(condition,message)=>{if(!condition)failures.push(message);};

expect(receipt?.schema==='opencontainer.p3-native-picker-permission-browser.v1.0','schema mismatch');
expect(receipt?.status==='PASS','receipt status must be PASS');
expect(receipt?.sourceGate==='OPENCONTAINER-PRODUCTION-GATES-v0.9.json:P3-18','source gate must be P3-18');
expect(receipt?.evidenceKind==='INTERACTIVE_NATIVE_BROWSER','evidence kind must be INTERACTIVE_NATIVE_BROWSER');
expect(receipt?.operatorAssisted===true,'operatorAssisted must be true');
expect(receipt?.productionClosed===false,'receipt must not claim production closure');

expect(receipt?.environment?.secureContext===true,'native picker court must run in a secure context');
expect(receipt?.environment?.showDirectoryPickerAvailable===true,'showDirectoryPicker must be available');
expect(typeof receipt?.environment?.userAgent==='string'&&/Chrome\//.test(receipt.environment.userAgent),'declared court requires Chrome user agent');

expect(receipt?.privacy?.directoryNameRedacted===true,'directory name must be redacted');
expect(receipt?.privacy?.directoryPathRecorded===false,'directory path must not be recorded');
expect(receipt?.privacy?.fileContentsRecorded===false,'file contents must not be recorded');

expect(receipt?.nativePicker?.acquiredThroughShowDirectoryPicker===true,'handle must originate from showDirectoryPicker');
expect(receipt?.nativePicker?.handleKind==='directory','native picker handle must be directory');
expect(receipt?.nativePicker?.mode==='readwrite','native picker court must use readwrite mode');
expect(receipt?.nativePicker?.directoryNameRedacted===true,'native picker directory name must remain redacted');

expect(receipt?.initial?.permissionReadwrite==='granted','initial native readwrite permission must be granted');
expect(typeof receipt?.initial?.markerRevision==='string'&&receipt.initial.markerRevision.length===64,'initial marker revision must be SHA-256');
expect(Number.isInteger(receipt?.initial?.localRecoverySequence)&&receipt.initial.localRecoverySequence>=1,'local recovery sequence missing');
expect(Number.isInteger(receipt?.initial?.localRecoveryGeneration)&&receipt.initial.localRecoveryGeneration>=0,'local recovery generation missing');

expect(receipt?.externalEditConflict?.status==='PASS','external edit conflict proof must pass');
expect(receipt?.externalEditConflict?.code==='OC_STALE_GENERATION','external edit must fail stale');
expect(receipt?.externalEditConflict?.state==='external-change-detected','external edit state must be external-change-detected');
expect(receipt?.externalEditConflict?.silentOverwritePrevented===true,'external overwrite must be prevented');
expect(receipt?.externalEditConflict?.externalBytesPreserved===true,'externally edited bytes must remain intact');
expect(Array.isArray(receipt?.externalEditConflict?.actions)&&receipt.externalEditConflict.actions.includes('compare'),'conflict receipt must expose compare');
expect(Array.isArray(receipt?.externalEditConflict?.actions)&&receipt.externalEditConflict.actions.includes('merge'),'conflict receipt must expose merge');

expect(receipt?.permissionRevocation?.status==='PASS','native permission revocation proof must pass');
expect(
  ['browser-site-settings-revoke','browser-permission-ui-revoke'].includes(receipt?.permissionRevocation?.revocationMethod),
  'revocation method must be an explicit browser UI revoke'
);
expect(
  ['denied','prompt'].includes(receipt?.permissionRevocation?.permissionReadwrite),
  'readwrite permission must transition away from granted'
);
expect(receipt?.permissionRevocation?.permissionTransitionObserved===true,'native permission transition was not observed');
expect(receipt?.permissionRevocation?.privilegedWriteBlocked===true,'privileged write must be blocked after revocation');
expect(receipt?.permissionRevocation?.writeCode==='OC_INVALID_STATE','revoked write must fail OC_INVALID_STATE');
expect(receipt?.permissionRevocation?.requestPermissionCalledDuringVerification===false,'verification must not re-request permission');
expect(receipt?.permissionRevocation?.localCanonicalRecoverySurvived===true,'local canonical recovery must survive external permission loss');
expect(
  receipt?.permissionRevocation?.localRecoverySequence===receipt?.initial?.localRecoverySequence,
  'local recovery sequence changed during native permission court'
);

expect(receipt?.invariants?.modeStayedLinkedFolder===true,'source mode must stay linked-folder');
expect(receipt?.invariants?.noSilentModeChange===true,'silent source-mode transition detected');
expect(receipt?.invariants?.externalConflictCheckedBeforeOverwrite===true,'external conflict precondition missing');
expect(receipt?.invariants?.nativePermissionTransitionExercised===true,'native permission transition invariant missing');
expect(receipt?.invariants?.localCanonicalUnaffectedByPermissionLoss===true,'local canonical state did not survive permission loss');

const summary=Object.freeze({
  schema:'opencontainer.p3-native-picker-permission-verification.v1.0',
  status:failures.length?'FAIL':'PASS',
  sourceGate:'P3-18',
  receiptSchema:receipt?.schema??null,
  browserUserAgent:receipt?.environment?.userAgent??null,
  permissionBefore:receipt?.initial?.permissionReadwrite??null,
  permissionAfter:receipt?.permissionRevocation?.permissionReadwrite??null,
  revocationMethod:receipt?.permissionRevocation?.revocationMethod??null,
  conflictCode:receipt?.externalEditConflict?.code??null,
  writeAfterRevokeCode:receipt?.permissionRevocation?.writeCode??null,
  localCanonicalRecoverySurvived:receipt?.permissionRevocation?.localCanonicalRecoverySurvived??null,
  failures:Object.freeze(failures)
});
console.log(JSON.stringify(summary,null,2));
if(failures.length)process.exitCode=1;
