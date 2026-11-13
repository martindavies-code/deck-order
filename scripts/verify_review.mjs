import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const server = spawn('python3', ['-m','http.server','8768','--directory','client/dist']);
const browser = await chromium.launch({ executablePath:'/usr/bin/google-chrome', args:['--no-sandbox'] });
const tracks = [
 {id:'a',artist:'Fixture',title:'Opener',bpm:120,workingBpm:120,camelot:'8A',status:'supplied'},
 {id:'b',artist:'Fixture',title:'Peak',bpm:132,workingBpm:132,camelot:'1A',status:'supplied'},
 {id:'c',artist:'Fixture',title:'Closer',bpm:118,workingBpm:118,camelot:'6B',status:'supplied'}
];
try {
 for(const width of [1440,390,320]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=> {
   if(new URL(route.request().url()).hostname!=='127.0.0.1') return route.fulfill({status:503,body:'{}'});
   return route.continue({url:route.request().url().replace('/deck-order/assets/','/assets/')});
  });
  await context.addInitScript(tracks=>localStorage.setItem('deck_order_crate_history_anonymous',JSON.stringify([{id:'fixture',name:'Review fixture',timestamp:'2026-11-13T12:00:00Z',tracks,trackCount:3}])),tracks);
  await page.goto('http://127.0.0.1:8768/');
  await page.getByRole('button',{name:/Saved sets/}).click();
  await page.getByRole('button',{name:'Load set',exact:true}).click();
  await page.getByRole('button',{name:'Find bridges',exact:true}).click();
  await page.getByRole('heading',{name:'Find the missing link'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`/downloads/deck-review-suggestions-${width}.png`,fullPage:true});
  // A real edit invalidates all advice about the old gap indices.
  await page.getByRole('button',{name:'Redo order',exact:true}).click();
  await page.getByRole('button',{name:/Rebuild|Redo order|Confirm/i}).last().click();
  await page.getByRole('heading',{name:'Find the missing link'}).waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,passed:true,errors}));
  await context.close();
 }
} finally {await browser.close();server.kill();}
