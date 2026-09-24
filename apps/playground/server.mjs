import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||4173);
const server=createServer(async(request,response)=>{
  response.setHeader('Cross-Origin-Opener-Policy','same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  response.setHeader('Cross-Origin-Resource-Policy','same-origin');
  if(request.url==='/'||request.url==='/index.html'){
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.end(await readFile(join(here,'public/index.html')));
    return;
  }
  response.statusCode=404;response.end('Not found');
});
server.listen(port,'127.0.0.1',()=>console.log('OpenContainer playground: http://127.0.0.1:'+port));
