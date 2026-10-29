/** Read-only checker. Node24: node --env-file=.env.local scripts/check-deployment.ts [--local]. */
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export function checkDeploymentEnvironment(env:Readonly<Record<string,string|undefined>>,local=false):string[]{
 const errors:string[]=[];
 const required=['APP_ORIGIN','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','CSRF_SECRET','RATE_LIMIT_SECRET','TRUSTED_CLIENT_IP_HEADER','DATABASE_URL'];
 for(const name of required)if(!env[name])errors.push(`Missing ${name}`);
 try{const app=new URL(env.APP_ORIGIN!);if(app.origin!==env.APP_ORIGIN||app.protocol!=='https:')errors.push('APP_ORIGIN must be a canonical HTTPS origin');if(local&&!['localhost','127.0.0.1','[::1]'].includes(app.hostname))errors.push('Local checker requires a loopback application');}catch{errors.push('Invalid APP_ORIGIN');}
 try{const db=new URL(env.NEXT_PUBLIC_SUPABASE_URL!);if(local?!['localhost','127.0.0.1','[::1]'].includes(db.hostname):db.protocol!=='https:')errors.push('Unsafe Supabase URL');}catch{errors.push('Invalid Supabase URL');}
 if(!['cf-connecting-ip','x-vercel-forwarded-for','x-real-ip'].includes(env.TRUSTED_CLIENT_IP_HEADER??''))errors.push('Unsupported trusted ingress header');
 for(const name of ['CSRF_SECRET','RATE_LIMIT_SECRET'])if(Buffer.byteLength(env[name]??'')<32)errors.push(`${name} must contain at least32bytes`);
 if(env.CSRF_SECRET&&env.CSRF_SECRET===env.RATE_LIMIT_SECRET)errors.push('Security secrets must be independent');
 if(env.SUPABASE_SERVICE_ROLE_KEY&&env.SUPABASE_SERVICE_ROLE_KEY===env.NEXT_PUBLIC_SUPABASE_ANON_KEY)errors.push('Service and public keys must differ');
 if(Object.keys(env).some(name=>/^NEXT_PUBLIC_.*(?:SERVICE_ROLE|CSRF_SECRET|RATE_LIMIT_SECRET)/.test(name)))errors.push('A server secret has a public environment name');
 if(local){try{const db=new URL(env.DATABASE_URL!);if(!['localhost','127.0.0.1','[::1]'].includes(db.hostname)||db.port!=='54322'||db.pathname!=='/postgres'||db.search||db.hash)errors.push('Local checker requires isolated local SQL database');}catch{errors.push('Invalid DATABASE_URL');}}
 return errors;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const errors=checkDeploymentEnvironment(process.env,process.argv.includes('--local'));
 if(errors.length){for(const error of errors)console.error(error);process.exitCode=1;}
 else{
  const result=spawnSync('psql',['-X','--no-password','--set','ON_ERROR_STOP=1','--dbname',process.env.DATABASE_URL!],{input:readFileSync('scripts/check-deployment.sql','utf8'),encoding:'utf8',env:{...process.env,PGCONNECT_TIMEOUT:'10',PGOPTIONS:'-c default_transaction_read_only=on'},timeout:30000});
  if(result.error||result.status!==0){console.error('Database readiness failed. Run the read-only SQL guard privately for details.');process.exitCode=1;}
  else{console.log('Environment and database protections verified.');console.log('External Auth redirects/Google/SMTP, ingress spoof protection, successful cron runs, exposed schemas and restored backup still require target verification. This command does not authorize deployment.');}
 }
}
