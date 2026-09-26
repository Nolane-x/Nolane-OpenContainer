import { writeFileSync } from 'node:fs';
import { OpenContainerProductionProfile } from '../packages/sdk/src/profile.js';

const output=JSON.stringify(OpenContainerProductionProfile,null,2)+'\n';
const path=process.argv[2]??'docs/production/PRODUCTION-PROFILE.json';
writeFileSync(path,output);
console.log(path);
