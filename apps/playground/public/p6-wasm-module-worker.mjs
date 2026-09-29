self.onmessage=async(event)=>{
  const {id,module,memory}=event.data??{};
  try{
    if(!(module instanceof WebAssembly.Module))throw new TypeError('module is required');
    const instance=await WebAssembly.instantiate(module,{});
    const exports=Object.keys(instance.exports);
    const memoryBytes=memory instanceof WebAssembly.Memory?memory.buffer.byteLength:null;
    self.postMessage({id,ok:true,exports,memoryBytes});
  }catch(error){
    self.postMessage({id,ok:false,name:error?.name??'Error',message:error?.message??String(error)});
  }
};
