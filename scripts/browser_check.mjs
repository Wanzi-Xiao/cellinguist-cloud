import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import {readFileSync, mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const origin='https://workspace.example.test';
const login='https://login.example.test';
const api='https://api.example.test';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];
async function scenario({empty=false,connected=true}={}) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  let rows=[], tokenCalls=0;
  const page=await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const request=route.request(), url=new URL(request.url());
    if(url.origin===origin){
      if(url.pathname==='/config.js')return route.fulfill({contentType:'text/javascript',body:`window.CELLINGUIST_CONFIG=${JSON.stringify(connected?{apiUrl:api,cognitoDomain:login,clientId:'testclient123',redirectUri:origin+'/'}:{})};`});
      const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!['index.html','styles.css','app.mjs','auth.mjs','api.mjs'].includes(path))return route.fulfill({status:404,body:'Not found'});
      return route.fulfill({contentType:path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(`${root}/frontend/${path}`)});
    }
    if(url.origin===login){
      if(url.pathname==='/oauth2/token'){
        tokenCalls++;
        assert.ok(new URLSearchParams(request.postData()).get('code_verifier'));
        return route.fulfill({json:{access_token:'test-access-token',token_type:'Bearer',expires_in:3600}});
      }
      return route.fulfill({contentType:'text/html',body:'<title>Mock identity provider</title>Identity provider test boundary'});
    }
    if(url.origin===api){
      if(url.pathname!=='/health')assert.equal(request.headers().authorization,'Bearer test-access-token');
      if(url.pathname==='/health')return route.fulfill({json:{status:'ok'}});
      if(url.pathname==='/catalog')return route.fulfill({json:{version:'v1',entries:empty?[]:[{cellType:'test-cell',conditionId:'test-treatment'}]}});
      if(url.pathname==='/results')return route.fulfill({json:{precomputed:true,resultVersion:'v1',summary:{note:'UI contract test object only; no research result'},plotUrl:'https://plots.example.test/test.png'}});
      if(url.pathname==='/history'){
        if(request.method()==='POST'){
          const item={...request.postDataJSON(),createdAt:'2026-11-10T12:00:00Z',resultVersion:'v1'};
          assert.deepEqual(Object.keys(request.postDataJSON()).sort(),['cellType','conditionId']);rows.unshift(item);
          return route.fulfill({status:201,json:item});
        }
        return route.fulfill({json:{items:rows,limit:50}});
      }
    }
    if(url.origin==='https://plots.example.test')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
    throw new Error(`Unexpected request: ${url.origin}${url.pathname}`);
  });
  await page.goto(origin);
  await page.waitForFunction(()=>document.querySelector('#notice').hidden===false || document.querySelector('#auth-button').disabled===false);
  return {page,context,getTokenCalls:()=>tokenCalls};
}
async function signIn(page){
  await page.click('#auth-button');
  await page.waitForURL(`${login}/oauth2/authorize?**`);
  const state=new URL(page.url()).searchParams.get('state');
  await page.goto(`${origin}/?${new URLSearchParams({code:'test-code',state})}`);
  await page.waitForFunction(()=>!document.querySelector('#workspace').hasAttribute('aria-busy'));
  assert.equal(await page.locator('#auth-button').textContent(),'Sign out');
}
try{
  mkdirSync(`${root}/docs/previews`,{recursive:true});
  const preview=await scenario({connected:false});
  assert.equal(await preview.page.locator('#auth-button').isDisabled(),true);
  await preview.page.screenshot({path:`${root}/docs/previews/workspace-desktop.png`,fullPage:true});
  await preview.page.setViewportSize({width:390,height:844});
  assert.equal(await preview.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await preview.page.screenshot({path:`${root}/docs/previews/workspace-mobile.png`,fullPage:true});
  await preview.context.close();
  const live=await scenario();
  await signIn(live.page);
  assert.equal(new URL(live.page.url()).search,'');
  await live.page.selectOption('#cell-type','test-cell');
  await live.page.selectOption('#condition','test-treatment');
  await live.page.click('#view-button');
  await live.page.locator('#result-content').waitFor({state:'visible'});
  assert.match(await live.page.locator('#result-summary').textContent(),/UI contract test/);
  await live.page.click('#save-button');
  await live.page.waitForFunction(()=>document.querySelector('#history-count').textContent==='1');
  await live.page.click('#history-tab');
  assert.equal(await live.page.locator('#history-list li').count(),1);
  await live.page.click('#history-list button');
  await live.page.locator('#result-content').waitFor({state:'visible'});
  await live.page.reload();
  await live.page.waitForFunction(()=>document.querySelector('#history-count').textContent==='1');
  await live.page.click('#auth-button');
  await live.page.waitForURL(`${login}/logout?**`);
  await live.page.goto(origin);
  assert.equal(await live.page.locator('#session-label').textContent(),'Signed out');
  await live.context.close();
  const empty=await scenario({empty:true});
  await signIn(empty.page);
  assert.equal(await empty.page.locator('#catalog-count').textContent(),'0');
  assert.equal(await empty.page.locator('#view-button').isDisabled(),true);
  assert.match(await empty.page.locator('#empty-title').textContent(),/first result/);
  await empty.context.close();
  const invalid=await scenario();
  await invalid.page.goto(`${origin}/?code=test-code&state=untrusted`);
  await invalid.page.locator('#error').waitFor({state:'visible'});
  assert.equal(invalid.getTokenCalls(),0);
  assert.equal(new URL(invalid.page.url()).search,'');
  await invalid.context.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop/mobile empty preview, PKCE callback, query/result/save/history/revisit, session reload/logout, empty catalog, callback rejection. All AWS/identity requests intercepted; no data or AWS access.');
}finally{await browser.close();}
