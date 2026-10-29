// Local-only HTTPS ingress for testing the real production build. Product HTTPS
// and secure-cookie requirements stay enabled. This proxy never binds publicly.
import {createServer} from 'node:https';
import {request as httpRequest} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,cpSync,existsSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
if(process.env.APP_ORIGIN!=='https://localhost:3000')throw new Error('Browser harness requires APP_ORIGIN=https://localhost:3000');
const supabase=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL??'');
if(!['localhost','127.0.0.1','[::1]'].includes(supabase.hostname))throw new Error('Browser harness requires local Supabase');
mkdirSync('.test-runtime',{recursive:true});
const cert='.test-runtime/cert.pem',key='.test-runtime/key.pem';
const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
if(result.status!==0)throw new Error('Could not create ephemeral local HTTPS certificate');
cpSync('.next/static','.next/standalone/.next/static',{recursive:true});
if(existsSync('public'))cpSync('public','.next/standalone/public',{recursive:true});
const child=spawn(process.execPath,['--no-experimental-require-module','.next/standalone/server.js'],{env:{...process.env,NODE_ENV:'production',PORT:'3001',HOSTNAME:'127.0.0.1',TRUSTED_CLIENT_IP_HEADER:'x-real-ip'},stdio:'inherit'});
const clientSalt=randomBytes(32);
const server=createServer({cert:readFileSync(cert),key:readFileSync(key)},(req,res)=>{
 const identity=typeof req.headers['x-ai-docs-test-client']==='string'?req.headers['x-ai-docs-test-client']:'default';
 const digest=createHash('sha256').update(clientSalt).update(identity).digest();
 const headers={...req.headers,host:'localhost:3000','x-forwarded-host':'localhost:3000','x-forwarded-proto':'https','x-real-ip':`10.${digest[0]}.${digest[1]}.${digest[2]}`};
 for(const name of ['x-ai-docs-test-client','forwarded','x-forwarded-for','x-vercel-forwarded-for','cf-connecting-ip'])delete headers[name];
 const upstream=httpRequest({hostname:'127.0.0.1',port:3001,path:req.url,method:req.method,headers},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});
 upstream.on('error',()=>{res.writeHead(503);res.end('Test server starting');});req.pipe(upstream);
});
server.listen(3000,'127.0.0.1');
let stopping=false;
function stop(){if(stopping)return;stopping=true;server.close();child.kill('SIGTERM');}
process.on('SIGINT',stop);process.on('SIGTERM',stop);child.on('exit',code=>{stop();process.exitCode=code??1;});
