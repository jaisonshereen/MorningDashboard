// Discover designated children by name; never expose Drive credentials or arbitrary files.
const b64=(v:Uint8Array)=>btoa(String.fromCharCode(...v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const enc=(v:any)=>b64(new TextEncoder().encode(JSON.stringify(v)));
async function token(env:any){
 const c=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON),now=Math.floor(Date.now()/1000);
 const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(c.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),x=>x.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const body=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:c.client_email,scope:'https://www.googleapis.com/auth/drive.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3500});
 const signature=b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(body))));
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:body+'.'+signature})});if(!r.ok)throw Error('OAuth failed');return (await r.json() as any).access_token;
}
const json=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});
export const onRequestGet=async ({env,request}:any)=>{
 try{
 const root=env.GOOGLE_DRIVE_FOLDER_ID;if(!/^[\w-]+$/.test(root||''))return json({error:'Drive configuration missing'},503);
 const t=await token(env),headers={Authorization:'Bearer '+t};
 async function child(parent:string,name:string){const q=new URLSearchParams({q:"'"+parent+"' in parents and name = '"+name+"' and trashed = false",fields:'files(id),nextPageToken',pageSize:'100'});const r=await fetch('https://www.googleapis.com/drive/v3/files?'+q,{headers});if(!r.ok)throw Error('Listing failed');const x=await r.json() as any;if(x.nextPageToken||x.files?.length!==1)throw Error('Missing or ambiguous file');return x.files[0].id}
 async function read(parent:string,name:string){const id=await child(parent,name);const r=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media',{headers});if(!r.ok)throw Error('Read failed');return r.json()}
 const folder=await child(root,'Daily Data');
 const image=new URL(request.url).searchParams.get('image');
 if(image!==null){const manifest:any=await read(folder,'media-manifest.json');const items=manifest.items||manifest.images||manifest.media||manifest.entries||[];if(!/^[\w-]+$/.test(image)||!items.some((x:any)=>x.fileId===image&&x.availability!==false))return json({error:'Not found'},404);
 const r=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(image)+'?alt=media',{headers});const type=r.headers.get('content-type')||'';if(!r.ok||!/^image\/(png|jpeg|webp|gif)(;|$)/i.test(type))return json({error:'Image unavailable'},502);return new Response(r.body,{headers:{'Content-Type':type,'Cache-Control':'private, no-store'}})}
 const names=['breaking-news','marquee','jira','agenda','media-manifest'];const result:any={};await Promise.all(names.map(async n=>{try{result[n]=await read(folder,n+'.json')}catch{result[n]=null}}));
 try{result.settings=await read(await child(root,'Configuration'),'settings.json')}catch{result.settings=null}
 return json(result);
 }catch{return json({error:'Dashboard source unavailable'},502)}
};