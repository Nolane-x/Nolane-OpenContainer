import { DiagnosticJournal } from '../../diagnostics/src/index.js';
import { ResourceGovernor } from '../../resources/src/index.js';
import { MemoryVFS } from '../../vfs/src/index.js';
import { ProcessSupervisor } from '../../process/src/index.js';
import { PackageGraphAuthority } from '../../package-env/src/index.js';
import { NetworkAuthority } from '../../network/src/index.js';
import { PreviewAuthority } from '../../preview/src/index.js';
import { MemoryPersistenceAuthority } from '../../persistence/src/index.js';
import { OpenContainerKernel } from '../../kernel/src/index.js';

export class OpenContainer {
  constructor(options={}){
    const diagnostics=new DiagnosticJournal(options.diagnostics);
    const resources=new ResourceGovernor(options.resources);
    const fs=new MemoryVFS();
    const process=new ProcessSupervisor({resources,diagnostics,outputLimitBytes:options.processOutputLimitBytes});
    const packages=new PackageGraphAuthority();
    const net=new NetworkAuthority(options.network);
    const preview=new PreviewAuthority();
    const snapshots=new MemoryPersistenceAuthority({fs});
    const kernel=new OpenContainerKernel({diagnostics});
    Object.assign(this,{fs,process,packages,net,preview,snapshots,resources,diagnostics});
    Object.defineProperty(this,'_kernel',{value:kernel,enumerable:false});
  }
  static async boot(options={}){const runtime=new OpenContainer(options);await runtime.boot();return runtime;}
  async boot(){await this._kernel.boot();return this;}
  get state(){return this._kernel.state;}
  get health(){return this._kernel.health;}
  mount(files){this._kernel.assertReady();return this.fs.mount(files);}
  registerCommand(name,handler){this._kernel.assertReady();return this.process.register(name,handler);}
  spawn(command,args=[],options={}){this._kernel.assertReady();return this.process.spawn(command,args,options);}
  listen(port,handler,{owner='runtime'}={}){this._kernel.assertReady();return this.preview.publish({port,owner,handler});}
  async terminate(){await this._kernel.terminate();}
}

export default OpenContainer;
