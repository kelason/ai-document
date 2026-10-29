import 'server-only';
import {randomBytes} from 'node:crypto';
export function securityHeaders(){
 const nonce=randomBytes(24).toString('base64');const development=process.env.NODE_ENV!=='production';
 const database=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
 const websocket=new URL(database.origin);websocket.protocol=database.protocol==='https:'?'wss:':'ws:';
 const csp=["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development?" 'unsafe-eval'":''}`,
  // Editor markup and React positioning use sanitized inline style attributes.
  "style-src 'self' 'unsafe-inline'","img-src 'self' data:","font-src 'self'",`connect-src 'self' ${database.origin} ${websocket.origin}${development?' ws://localhost:*':''}`,
  "object-src 'none'","base-uri 'self'","form-action 'self'","frame-ancestors 'none'",...(!development?['upgrade-insecure-requests']:[])].join('; ');
 const headers:Record<string,string>={'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cache-Control':'private, no-store'};
 if(!development)headers['Strict-Transport-Security']='max-age=31536000; includeSubDomains';
 return {nonce,csp,headers};
}
