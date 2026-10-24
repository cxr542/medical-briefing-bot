// Operator-only, never invoked by deploy/CI. Passwords enter a hidden TTY prompt.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { hashPassword } from '../medical-briefing-bot/frontend/src/lib/customer-auth/core.mjs';
const target='kkcvglldsoxglfjqnsga';
if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Interactive operator TTY required');
if(process.env.CUSTOMER_AUTH_BOOTSTRAP_PROJECT!==target)throw new Error('Explicit confirmed project required');
// PGHOST/PGUSER/PGPASSWORD supplied securely by the operator. No DSN/password command argument.
if(!(process.env.PGHOST===`db.${target}.supabase.co`||(process.env.PGHOST?.endsWith('.pooler.supabase.com')&&process.env.PGUSER?.endsWith('.'+target)))||!process.env.PGPASSWORD)throw new Error('Target-bound PostgreSQL connection required');
const ask=createInterface({input:process.stdin,output:process.stdout});
const approval=await ask.question('All rollout gates PASS and auth migrations applied? Type BOOTSTRAP: ');ask.close();
if(approval!=='BOOTSTRAP')throw new Error('Bootstrap cancelled');
async function password(label){
  process.stdout.write(label+': ');
  const muted=new Writable({write(_chunk,_enc,done){done();}});
  const prompt=createInterface({input:process.stdin,output:muted,terminal:true});
  try{return await prompt.question('');}finally{prompt.close();process.stdout.write('\n');}
}
let admin=await password('Customer Admin password'),adminConfirm=await password('Confirm admin password');
let shared=await password('Shared password'),sharedConfirm=await password('Confirm shared password');
if(admin!==adminConfirm||shared!==sharedConfirm||admin===shared)throw new Error('Distinct matching passwords required');
const adminHash=await hashPassword(admin),sharedHash=await hashPassword(shared);
admin=adminConfirm=shared=sharedConfirm='';
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const sql=`BEGIN;
LOCK TABLE customer_auth.customer_admins,customer_auth.customer_credentials,customer_auth.customer_users IN EXCLUSIVE MODE;
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM customer_auth.customer_admins) OR EXISTS(SELECT 1 FROM customer_auth.customer_credentials) OR EXISTS(SELECT 1 FROM customer_auth.customer_users)
THEN RAISE EXCEPTION 'Bootstrap requires empty auth principals'; END IF;
END $$;
INSERT INTO customer_auth.customer_admins(login_id,password_hash) VALUES('admin',${quote(adminHash)});
INSERT INTO customer_auth.customer_credentials(kind,password_hash) VALUES('shared',${quote(sharedHash)});
INSERT INTO customer_auth.customer_users(employee_number) VALUES('1004');
COMMIT;`;
const result=spawnSync('psql',['-X','-q','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',env:{...process.env,PGSSLMODE:'verify-full',PGCONNECT_TIMEOUT:'10'},stdio:['pipe','pipe','pipe']});
// Suppress database errors: some PostgreSQL errors echo statements containing credential hashes.
if(result.status!==0)throw new Error('Bootstrap failed; inspect target state securely before retry');
process.stdout.write('Bootstrap committed. No credential values were printed.\n');
