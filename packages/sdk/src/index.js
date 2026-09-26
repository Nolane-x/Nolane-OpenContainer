import { ErrorCodes, assertOc } from '../../protocol/src/index.js';
import { DiagnosticJournal } from '../../diagnostics/src/index.js';
import { ResourceGovernor } from '../../resources/src/index.js';
import { MemoryVFS, OpfsCheckpointAuthority } from '../../vfs/src/index.js';
import { ProcessSupervisor } from '../../process/src/index.js';
import { OpfsPackageContentStore, PackageGraphAuthority } from '../../package-env/src/index.js';
import { NetworkAuthority } from '../../network/src/index.js';
import { PreviewAuthority } from '../../preview/src/index.js';
import { MemoryPersistenceAuthority } from '../../persistence/src/index.js';
import { OpenContainerKernel } from '../../kernel/src/index.js';
import { OpenContainerProductionProfile } from './profile.js';

export class OpenContainer {
  static get productionProfile(){return OpenContainerProductionProfile;}
  constructor(options={}){
    const diagnostics=new DiagnosticJournal(options.diagnostics);
    const resources=new ResourceGovernor(options.resources);
    const fs=new MemoryVFS();
    const process=new ProcessSupervisor({resources,diagnostics,outputLimitBytes:options.processOutputLimitBytes});
    const packages=new PackageGraphAuthority({fs});
    const net=new NetworkAuthority(options.network);
    const preview=new PreviewAuthority();
    const snapshots=new MemoryPersistenceAuthority({fs});
    const kernel=new OpenContainerKernel({diagnostics});
    Object.assign(this,{fs,process,packages,net,preview,snapshots,resources,diagnostics,workspacePersistence:null,packageContentStore:null});
    Object.defineProperty(this,'_kernel',{value:kernel,enumerable:false});
    Object.defineProperty(this,'_workspacePersistenceOptions',{value:options.workspacePersistence??null,enumerable:false});
    Object.defineProperty(this,'_packagePersistenceOptions',{value:options.packagePersistence??null,enumerable:false});
  }
  static async boot(options={}){const runtime=new OpenContainer(options);await runtime.boot();return runtime;}
  async boot(){
    if(this._workspacePersistenceOptions){
      const authority=await new OpfsCheckpointAuthority(this._workspacePersistenceOptions).open();
      await authority.restoreInto(this.fs);
      this.workspacePersistence=authority;
    }
    if(this._packagePersistenceOptions){
      const store=await new OpfsPackageContentStore(this._packagePersistenceOptions).open();
      this.packages.setContentStore(store);
      this.packageContentStore=store;
    }
    await this._kernel.boot();
    return this;
  }
  get state(){return this._kernel.state;}
  get health(){return this._kernel.health;}
  get productionProfile(){return OpenContainerProductionProfile;}
  mount(files){this._kernel.assertReady();return this.fs.mount(files);}
  registerCommand(name,handler){this._kernel.assertReady();return this.process.register(name,handler);}
  spawn(command,args=[],options={}){this._kernel.assertReady();return this.process.spawn(command,args,options);}
  listen(port,handler,{owner='runtime'}={}){this._kernel.assertReady();return this.preview.publish({port,owner,handler});}
  installPackageCommands(options={}){this._kernel.assertReady();return this.packages.bindCommands(this.process,options);}
  snapshot(label='snapshot'){this._kernel.assertReady();return this.snapshots.create(label);}
  restore(ref){
    this._kernel.assertReady();
    const id=typeof ref==='string'?ref:ref?.id;
    assertOc(typeof id==='string'&&id.length>0,ErrorCodes.INVALID_ARGUMENT,'Snapshot reference is required');
    return this.snapshots.restore(id);
  }
  export(ref=null){
    this._kernel.assertReady();
    const id=ref===null?null:typeof ref==='string'?ref:ref?.id;
    assertOc(ref===null||(typeof id==='string'&&id.length>0),ErrorCodes.INVALID_ARGUMENT,'Snapshot reference is invalid');
    return this.snapshots.exportStream(id);
  }
  async import(source){
    this._kernel.assertReady();
    return this.snapshots.importStream(source);
  }
  status(){
    return Object.freeze({
      state:this.state,
      health:this.health,
      generation:this.fs.generation,
      workspacePersistence:this.workspacePersistence?Object.freeze({sequence:this.workspacePersistence.current?.sequence??null,crossContextLocking:this.workspacePersistence.crossContextLocking}):null,
      packagePersistence:this.packageContentStore?Object.freeze({hydratedCount:this.packageContentStore.hydratedCount??0,crossContextLocking:this.packageContentStore.crossContextLocking}):null
    });
  }
  async persistWorkspace(){
    this._kernel.assertReady();
    assertOc(this.workspacePersistence,ErrorCodes.INVALID_STATE,'Workspace OPFS persistence is not configured');
    return this.workspacePersistence.checkpoint(this.fs);
  }
  async collectWorkspaceGarbage(options={}){
    this._kernel.assertReady();
    assertOc(this.workspacePersistence,ErrorCodes.INVALID_STATE,'Workspace OPFS persistence is not configured');
    return this.workspacePersistence.collectGarbage(options);
  }
  async teardown(){await this.terminate();}
  async terminate(){await this._kernel.terminate();}
}

export default OpenContainer;

export { OpenContainerProductionProfile } from './profile.js';
