import {spawn} from 'node:child_process';
/** SQL fixtures must never reach a production database. */
export function localSql(input:string):Promise<string> {
 const target=process.env.RATE_LIMIT_TEST_DATABASE_URL??'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
 const url=new URL(target);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.port!=='54322'||url.pathname!=='/postgres'||url.search||url.hash||!['postgres:','postgresql:'].includes(url.protocol)) throw new Error('SQL tests require isolated local Supabase on port 54322.');
 return new Promise((resolve,reject)=>{
  const child=spawn('psql',['-XAt','--no-password','-v','ON_ERROR_STOP=1','-d',target]);let output='',error='';
  child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{error+=data;});child.on('error',reject);
  child.on('close',code=>code===0?resolve(output.trim()):reject(new Error(error)));child.stdin.end(input);
 });
}
