const policy=document.permissionsPolicy??document.featurePolicy??null;
const features=['camera','microphone','geolocation','display-capture','usb','serial','hid','payment'];
const disabled={};
for(const feature of features){
  let allowed=null;
  try{allowed=policy?.allowsFeature?policy.allowsFeature(feature):null;}catch{}
  disabled[feature]=allowed===null?null:allowed===false;
}
parent.postMessage({type:'opencontainer:p1-permissions-frame',disabled,api:policy?'available':'absent'},location.origin);
