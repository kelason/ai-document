import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const values=['SUPABASE_SERVICE_ROLE_KEY','CSRF_SECRET','RATE_LIMIT_SECRET'].map(name=>process.env[name]).filter(Boolean);
if(values.length!==3)throw new Error('Bundle scan requires the three server-only test secrets');
let checked=0;
function scan(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())scan(path);else{const source=readFileSync(path,'utf8');if(values.some(secret=>source.includes(secret)))throw new Error('Server-only secret found in public build output');checked++;}}}
scan('.next/static');console.log(`Checked ${checked} public build files: no server-only secret values`);
