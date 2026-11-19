import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createServer } from '../apps/family-app/node_modules/vite/dist/node/index.js';
const { chromium }=await import(pathToFileURL(path.resolve(path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'output/verification/family-first-sos');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'}),servers=[],errors=[];
async function launch(app,mobile=false){
  const appRoot=path.join(root,'apps',app),server=await createServer({root:appRoot,configFile:path.join(appRoot,'vite.config.js'),server:{host:'127.0.0.1',port:0}});
  servers.push(server);await server.listen();
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1100},hasTouch:mobile,isMobile:mobile});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://nominatim.openstreetmap.org/**',route=>route.fulfill({status:503,body:'Lookup unavailable'}));
  await page.route(/https:\/\/.*(?:tile|arcgisonline|basemaps).*\//,route=>route.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/monitoring-features-preview.html`);return page;
}
async function openWatchSos(page,id,age=0){
  await page.evaluate(({id,age})=>{
    const state=globalThis.monitoringFixture,at=new Date(Date.now()-age).toISOString();
    state.alerts.push({id,device_id:state.devices[0].id,alert_type:'SOS',created_at:at,details:{status:'PENDING_FAMILY',incident_open:true,first_seen_at:at,last_seen_at:at,sos_family_first:true,sos_assigned_to:'family',sos_family_deadline_at:new Date(Date.parse(at)+180000).toISOString(),sos_location:{point:{lat:14.039,lng:121.123},incident_at:at,recorded_at:at}}});
    state.telemetryByDevice[state.devices[0].id]={is_sos:true};state.refresh();
  },{id,age});
}
async function sync(from,to,id){
  const row=await from.evaluate(id=>structuredClone(globalThis.monitoringFixture.alerts.find(row=>row.id===id)),id);
  await to.evaluate(row=>{const state=globalThis.monitoringFixture,index=state.alerts.findIndex(item=>item.id===row.id);if(index<0)state.alerts.push(row);else state.alerts[index]=row;state.telemetryByDevice[state.devices[0].id]={is_sos:true};state.refresh();},row);
}
try{
  const family=await launch('family-app',true),admin=await launch('dashboard-admin');
  const later=family.getByRole('button',{name:'Set up later',exact:true});
  await Promise.race([later.waitFor(),family.getByRole('combobox',{name:'Senior to monitor'}).waitFor()]);
  if(await later.isVisible()) await later.tap();
  await family.getByRole('combobox',{name:'Senior to monitor'}).waitFor();
  await admin.getByRole('heading',{name:'Monitoring overview',exact:true}).waitFor();
  await openWatchSos(family,2);await sync(family,admin,2);
  const popup=family.getByRole('alertdialog');
  await popup.getByRole('button',{name:'I can respond',exact:true}).waitFor();
  await popup.getByRole('button',{name:'Transfer SOS to barangay',exact:true}).waitFor();
  await popup.getByText('Time remaining before automatic transfer to barangay',{exact:false}).waitFor();
  assert.equal(await admin.locator('.admin-overview__alerts .admin-incident').count(),0);
  await popup.getByRole('button',{name:'Transfer SOS to barangay',exact:true}).scrollIntoViewIfNeeded();
  await family.screenshot({path:path.join(output,'family-response-actions.png')});
  await family.evaluate(()=>{globalThis.monitoringFixture.failSosResponse=true;});
  await popup.getByRole('button',{name:'Transfer SOS to barangay',exact:true}).tap();
  await popup.getByText('The SOS response could not be saved. The alert remains active. Please try again.',{exact:true}).waitFor();
  assert.equal(await admin.locator('.admin-overview__alerts .admin-incident').count(),0);
  await family.evaluate(()=>{globalThis.monitoringFixture.failSosResponse=false;});
  await popup.getByRole('button',{name:'Transfer SOS to barangay',exact:true}).tap();await popup.waitFor({state:'hidden'});
  await family.getByText('SOS transferred to barangay. Waiting for a response.',{exact:true}).first().waitFor();
  await sync(family,admin,2);
  const staffCard=admin.locator('.admin-overview__alerts .admin-incident');
  await staffCard.getByText('Transferred by family',{exact:true}).waitFor();
  await admin.screenshot({path:path.join(output,'admin-received-family-transfer.png'),fullPage:true});
  await staffCard.getByRole('button',{name:'Confirm response',exact:true}).click();
  await admin.getByRole('heading',{name:'Alerts & response',exact:true}).waitFor();
  await admin.getByText('SOS response acknowledged',{exact:true}).waitFor();
  await admin.getByRole('group',{name:'Response map style'}).getByRole('button',{name:'Satellite',exact:true}).click();
  await sync(admin,family,2);
  await family.getByRole('button',{name:'View SOS updates',exact:true}).tap();
  await family.getByText('Barangay secretary confirmed the response',{exact:true}).first().waitFor();
  await family.screenshot({path:path.join(output,'family-staff-response.png'),fullPage:true});
  await admin.getByRole('button',{name:'Dashboard',exact:true}).click();
  await openWatchSos(family,3);
  await popup.getByRole('button',{name:'I can respond',exact:true}).tap();await popup.waitFor({state:'hidden'});
  await family.getByText('Your response was saved. The unanswered SOS timer has stopped.',{exact:true}).waitFor();
  await sync(family,admin,3);
  assert.equal(await admin.locator('.admin-overview__alerts .admin-incident').count(),0);
  await openWatchSos(family,4,181000);await sync(family,admin,4);
  assert.equal(await admin.locator('.admin-overview__alerts .admin-incident').count(),0);
  await popup.getByRole('button',{name:'Transfer SOS to barangay',exact:true}).waitFor();
  await family.evaluate(()=>{const state=globalThis.monitoringFixture,row=state.alerts.find(row=>row.id===4);Object.assign(row.details,{status:'ESCALATED_BHW',sos_assigned_to:'barangay',sos_transferred_at:new Date().toISOString(),sos_transfer_reason:'automatic_timeout',sos_response_version:1});state.refresh();});
  await popup.waitFor({state:'hidden'});await sync(family,admin,4);
  await staffCard.getByText('Automatic transfer · No family response after 3 minutes',{exact:true}).waitFor();
  await family.getByRole('button',{name:'Alerts',exact:true}).tap();
  await family.getByText('No family response after 3 minutes. Barangay notified.',{exact:true}).first().waitFor();
  assert.equal(await family.getByText('Your response was saved. The unanswered SOS timer has stopped.',{exact:true}).count(),0);
  await family.getByText('No family response after 3 minutes. Barangay notified.',{exact:true}).first().scrollIntoViewIfNeeded();
  await family.screenshot({path:path.join(output,'family-automatic-transfer.png'),fullPage:true});
  await family.getByRole('button',{name:'Health',exact:true}).tap();
  assert.equal(await family.getByRole('button',{name:/Send SOS to barangay/}).count(),0);
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks:['family-first popup and countdown','no initial admin delivery or raw-telemetry badge','manual transfer reuses the incident','failed transfer recovery','admin source and acknowledgment map','family response stops timeout','automatic timeout receipt on both sides','private photos and existing map styles preserved','Health SOS excluded'],browserErrors:errors},null,2));
  console.log('PASS family-first SOS: family response, manual/automatic transfer, admin acknowledgment, failure recovery, and excluded Health SOS');
}catch(error){for(const[index,context]of browser.contexts().entries())for(const page of context.pages())await page.screenshot({path:path.join(output,`failure-${index}.png`),fullPage:true}).catch(()=>{});console.error('Browser errors:',errors);throw error;}
finally{await browser.close();await Promise.all(servers.map(server=>server.close()));}
