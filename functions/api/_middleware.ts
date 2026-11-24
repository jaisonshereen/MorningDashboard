// Fail closed on every API route, including legacy endpoints.
const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
export const onRequest=async ({request,env,next}:any)=>{
 const deny=(status=403)=>new Response('Access required',{status,headers:{'Cache-Control':'no-store'}});
 try {
 const issuer=String(env.ACCESS_TEAM_DOMAIN||'').replace(/\/$/,'');
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)||!env.ACCESS_AUD) return deny(503);
 const parts=(request.headers.get('Cf-Access-Jwt-Assertion')||'').split('.');
 if(parts.length!==3)return deny();
 const [h,p,s]=parts;const header=JSON.parse(new TextDecoder().decode(decode(h))),claims=JSON.parse(new TextDecoder().decode(decode(p)));
 const now=Date.now()/1000;
 if(header.alg!=='RS256'||claims.iss!==issuer||![claims.aud].flat().includes(env.ACCESS_AUD)||typeof claims.exp!=='number'||claims.exp<=now||(claims.nbf!==undefined&&claims.nbf>now))return deny();
 const r=await fetch(issuer+'/cdn-cgi/access/certs');if(!r.ok)return deny();
 const {keys}=await r.json() as any;const jwk=keys.find((k:any)=>k.kid===header.kid);if(!jwk)return deny();
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(s),new TextEncoder().encode(h+'.'+p)))return deny();
 }catch{return deny()}
 const response=await next();const headers=new Headers(response.headers);headers.set('Cache-Control','private, no-store');headers.set('X-Content-Type-Options','nosniff');return new Response(response.body,{status:response.status,headers});
};