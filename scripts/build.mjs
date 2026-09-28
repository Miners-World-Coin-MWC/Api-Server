import {mkdir,cp,access} from 'node:fs/promises';import {constants} from 'node:fs';import {join} from 'node:path';
const root=process.cwd();const dist=join(root,'dist');await mkdir(dist,{recursive:true});
try{await access(join(root,'vendor','bitcoinJS-lib.js'),constants.F_OK)}catch{throw new Error('vendor/bitcoinJS-lib.js is missing. Run npm run fetch-bitcoinjs first.')} 
await cp(join(root,'public'),dist,{recursive:true});await cp(join(root,'vendor'),join(dist,'vendor'),{recursive:true});console.log('Prepared static wallet assets.');
