import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { hashPassword } from '../../src/lib/customer-auth/core.mjs';

export async function startUsageServer() {
  const db=new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  for(const name of ['20261013043423_customer_auth_foundation','20261013050900_customer_admin_management','20261029093624_customer_remember_login','20261030010818_customer_usage'])
    await db.exec(await readFile(new URL(`../../../../supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
  const password='synthetic-usage-password';
  const passwordHash=await hashPassword(password);
  await db.query("INSERT INTO customer_auth.customer_admins(login_id,password_hash) VALUES ('synthetic-admin',$1)",[passwordHash]);
  await db.query("INSERT INTO customer_auth.customer_credentials(kind,password_hash) VALUES ('shared',$1)",[passwordHash]);
  await db.exec("INSERT INTO customer_auth.customer_users(employee_number) SELECT 'test-'||lpad(n::text,3,'0') FROM generate_series(1,24) n;");
  let storeAvailable=true;
  const wire=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    res.setHeader('Content-Type','application/json');
    const fn=req.url.split('/').at(-1);
    if(!['customer_auth_rpc','customer_session_rpc','customer_admin_rpc','customer_usage_rpc'].includes(fn)){res.end('[]');return;}
    try {
      if(!storeAvailable)throw new Error('Synthetic unavailable store');
      const body=JSON.parse(Buffer.concat(chunks).toString());
      const result=await db.transaction(async tx=>{
        await tx.exec('SET LOCAL ROLE service_role');
        return tx.query(`SELECT public.${fn}($1,$2::jsonb) AS value`,[body.operation,JSON.stringify(body.payload)]);
      });
      res.end(JSON.stringify(result.rows[0].value));
    }catch(error){res.writeHead(500).end(JSON.stringify({code:error.code||'TEST',message:'Synthetic store failure'}));}
  });
  wire.listen(0,'127.0.0.1');await once(wire,'listening');
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'production',CUSTOMER_AUTH_FOUNDATION_ENABLED:'true',CUSTOMER_AUTH_RATE_LIMIT_SECRET:'synthetic-rate-secret-for-local-tests-only',NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${wire.address().port}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-server'}});
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Next readiness timeout')),30000);
    app.stdout.on('data',chunk=>{if(chunk.toString().includes('Ready in')){clearTimeout(timeout);resolve();}});
    app.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Next exited: ${code}`));});
  });
  const call=(path,body,cookie,method=body?'POST':'GET')=>fetch(origin+path,{method,headers:{Origin:`https://127.0.0.1:${port}`,'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const browserProxy=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const browserHeaders=new Headers();
    for(const [key,value] of Object.entries(req.headers))if(value&&key!=='connection')browserHeaders.set(key,Array.isArray(value)?value.join(','):value);
    if(browserHeaders.get('origin')===uiOrigin)browserHeaders.set('origin',origin.replace('http:','https:'));
    browserHeaders.delete('host');
    try {
      const upstream=await fetch(origin+req.url,{method:req.method,headers:browserHeaders,redirect:'manual',...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
      const responseHeaders=new Headers(upstream.headers);responseHeaders.delete('content-encoding');responseHeaders.delete('content-length');
      res.writeHead(upstream.status,Object.fromEntries(responseHeaders));res.end(Buffer.from(await upstream.arrayBuffer()));
    }catch{res.writeHead(502).end('Synthetic preview unavailable');}
  });
  browserProxy.listen(0,'127.0.0.1');await once(browserProxy,'listening');
  const uiOrigin=`http://localhost:${browserProxy.address().port}`;
  return {db,origin,uiOrigin,password,call,setStoreAvailable(value){storeAvailable=value;},async stop(){
    await new Promise(resolve=>browserProxy.close(resolve));app.kill();await once(app,'exit');await new Promise(resolve=>wire.close(resolve));await db.close();
  }};
}
