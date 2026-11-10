// Explicit live integration check. Creates two temporary Cognito users and one
// temporary DynamoDB history probe, then removes only those created resources.
// No result artifacts, research data, email messages, or model operations.
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {mkdirSync, writeFileSync, unlinkSync} from 'node:fs';
import assert from 'node:assert/strict';

if (process.env.CELLINGUIST_LIVE_CHECK !== '1') throw new Error('Run explicitly with CELLINGUIST_LIVE_CHECK=1 after sourcing scripts/aws_env.sh.');
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const awsBin=`${root}/.tools/bin/aws`, tfBin=`${root}/.tools/bin/terraform`;
// CLI v2 may reread input JSON. Use a seekable anonymous Linux memory file,
// passed only to this child, rather than disk or secret-bearing command arguments.
const bridge = [
  'import os, subprocess, sys',
  'fd = os.memfd_create("cellinguist-cli-input")',
  'os.write(fd, sys.stdin.buffer.read())',
  'os.lseek(fd, 0, 0)',
  'args = [a.replace("@INPUT@", "file:///proc/self/fd/" + str(fd)) for a in sys.argv[1:]]',
  'raise SystemExit(subprocess.run(args, pass_fds=(fd,)).returncode)'
].join('\n');
function aws(service,operation,input){
  const result=execFileSync('/usr/bin/python3',['-c',bridge,awsBin,service,operation,'--cli-input-json','@INPUT@','--output','json','--no-cli-pager'],{input:JSON.stringify(input),encoding:'utf8',timeout:60000,stdio:['pipe','pipe','pipe']});
  return result.trim()?JSON.parse(result):{};
}
const outputs=JSON.parse(execFileSync(tfBin,['-chdir=infra','output','-json'],{cwd:root,encoding:'utf8'}));
const value=name=>outputs[name].value;
const url=value('frontend_url'), api=value('api_url');
const pools=aws('cognito-idp','list-user-pools',{MaxResults:60}).UserPools.filter(p=>p.Name==='cellinguist-dev');
assert.equal(pools.length,1,'Expected exactly the project user pool');
const pool=pools[0].Id;
const client=aws('cognito-idp','describe-user-pool-client',{UserPoolId:pool,ClientId:value('cognito_client_id')});
assert.equal(client.UserPoolClient.ClientName,'cellinguist-dev-web');
const table='cellinguist-dev-history';
const users=[], contexts=[], probes=[];
const cleanupPath=`${root}/.tools/live-smoke-cleanup.json`;
function saveCleanup(){writeFileSync(cleanupPath,JSON.stringify({pool,table,users:users.map(u=>u.username),probes},null,2),{mode:0o600});}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const browserErrors=[];
async function account(label){
  const email=`cellinguist-smoke-${label}-${randomUUID()}@example.invalid`;
  const password=`aA1!${randomBytes(24).toString('hex')}`;
  const response=aws('cognito-idp','admin-create-user',{UserPoolId:pool,Username:email,MessageAction:'SUPPRESS',UserAttributes:[{Name:'email',Value:email},{Name:'email_verified',Value:'true'}]});
  const username=response.User.Username;
  const sub=response.User.Attributes.find(a=>a.Name==='sub').Value;
  const user={username,sub,email,password};users.push(user);saveCleanup();
  aws('cognito-idp','admin-set-user-password',{UserPoolId:pool,Username:username,Password:password,Permanent:true});
  return user;
}
async function signIn(user){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);
  const page=await context.newPage();page.setDefaultTimeout(25000);
  page.on('pageerror',e=>browserErrors.push(e.message));
  await page.goto(url,{waitUntil:'networkidle'});
  await page.click('#auth-button');
  await page.waitForURL(/amazoncognito\.com\/login/);
  await page.locator('input[name="username"]:visible').fill(user.email);
  await page.locator('input[name="password"]:visible').fill(user.password);
  await page.locator('[name="signInSubmitButton"]:visible').click();
  await page.waitForURL(`${url}/`);
  await page.waitForFunction(()=>document.querySelector('#auth-button').textContent==='Sign out'&&!document.querySelector('#workspace').hasAttribute('aria-busy'),{},{timeout:45000});
  assert.equal(await page.locator('#catalog-count').textContent(),'0');
  assert.equal(await page.locator('#view-button').isDisabled(),true);
  assert.equal(await page.locator('#error').isVisible(),false);
  return page;
}
async function call(page,path,body){
  return page.evaluate(async ({api,path,body})=>{
    const {AuthSession}=await import('/auth.mjs');
    const token=new AuthSession(window.CELLINGUIST_CONFIG).token();
    const r=await fetch(`${api}${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status,body:await r.json()};
  },{api,path,body});
}
let failure;
try{
  const home=await fetch(url,{signal:AbortSignal.timeout(20000)});
  assert.equal(home.status,200);
  assert.match(home.headers.get('content-security-policy')||'',/script-src 'self'/);
  assert.equal(home.headers.get('x-frame-options'),'DENY');
  const health=await fetch(`${api}/health`,{signal:AbortSignal.timeout(20000)});assert.equal(health.status,200);
  const denied=await fetch(`${api}/history`,{signal:AbortSignal.timeout(20000)});assert.equal(denied.status,401);
  console.log('PASS: public health, protected-route rejection, CloudFront security headers.');
  const alice=await account('alice'),bob=await account('bob');
  const pageA=await signIn(alice),pageB=await signIn(bob);
  console.log('PASS: two isolated real Cognito PKCE logins and authenticated empty catalog.');
  const rejected=await call(pageA,'/history',{cellType:'not-in-catalog',conditionId:'not-in-catalog'});
  assert.equal(rejected.status,400);
  const probe={PK:{S:`USER#${alice.sub}`},SK:{S:`QUERY#${new Date().toISOString()}#integration-check`}};
  probes.push(probe);saveCleanup();
  aws('dynamodb','put-item',{TableName:table,Item:{...probe,cellType:{S:'integration-check-only'},conditionId:{S:'no-research-result'},createdAt:{S:new Date().toISOString()},resultVersion:{S:'v1'}}});
  const own=await call(pageA,'/history'),other=await call(pageB,'/history');
  assert.equal(own.status,200);assert.equal(own.body.items.length,1);assert.equal(own.body.items[0].cellType,'integration-check-only');
  assert.equal(other.status,200);assert.equal(other.body.items.length,0);
  await pageA.reload({waitUntil:'networkidle'});
  await pageA.waitForFunction(()=>document.querySelector('#history-count').textContent==='1');
  await pageA.click('#history-tab');assert.equal(await pageA.locator('#history-list li').count(),1);
  console.log('PASS: API user partition isolation and history persistence after page reload.');
  await pageA.click('#auth-button');
  await pageA.waitForURL(`${url}/`);
  await pageA.waitForFunction(()=>document.querySelector('#session-label').textContent==='Signed out');
  assert.equal(await pageA.evaluate(()=>sessionStorage.getItem('cellinguist.session.v1')),null);
  console.log('PASS: hosted logout and local session removal.');
  assert.deepEqual(browserErrors,[]);
  mkdirSync(`${root}/docs/previews`,{recursive:true});
  await pageB.screenshot({path:`${root}/docs/previews/aws-connected-empty-catalog.png`,fullPage:true});
}catch(err){
  failure=err;
  // Avoid printing input objects, passwords, token-bearing URLs, or subprocess command diagnostics.
  console.error(`Live check failed: ${err.name} — ${String(err.message).split('\n')[0]}`);
}finally{
  for(const context of contexts)await context.close();
  await browser.close();
  let clean=true;
  for(const key of probes){try{aws('dynamodb','delete-item',{TableName:table,Key:key});}catch{clean=false;console.error('History probe cleanup failed; inspect .tools/live-smoke-cleanup.json');}}
  for(const user of users){try{aws('cognito-idp','admin-delete-user',{UserPoolId:pool,Username:user.username});}catch{clean=false;console.error('Temporary user cleanup failed; inspect .tools/live-smoke-cleanup.json');}}
  if(clean){try{unlinkSync(cleanupPath);}catch{}console.log('Temporary test users and history probe removed.');}
  if(!clean)process.exitCode=1;
}
if(failure)process.exitCode=1;
