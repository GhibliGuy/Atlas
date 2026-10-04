(() => {
  // The public, shared build (index.html sets window.BXC_PUBLIC=true before this file loads, see atlas-public/)
  // is the exact same code as the private one running inside the collector app - just with nowhere to write to
  // and no live game connection to ask for one. It fetches one static data/snapshot.json instead of ever opening
  // a live bridge, and every control that adds/edits/imports/exports anything is skipped entirely rather than
  // shown-then-disabled, so there is no code path in this mode that could reach a live collector even if one
  // happened to be running on the same machine.
  const PUBLIC_MODE=!!globalThis.BXC_PUBLIC;
  // The editing tools (moving people and entrances, adding resources and zones): always in the app's own copy, and on
  // the website only when the collector app opened it and handed it its editing link (window.bxcEdit, a few named
  // actions and nothing else). A visitor's browser never has that, so they never see the tools.
  const EDIT=!PUBLIC_MODE||!!(globalThis.bxcEdit&&typeof globalThis.bxcEdit.send==='function');
  globalThis.bxcCanEdit=EDIT;   // (the quest pages' "Edit steps & notes" button)
  const SITE_EDIT_CMDS=new Set(['save-page-edit','set-npc-spot','set-zone-entrance','clear-zone-entrance','set-zone-exit','set-zone-name','set-zone-parent','clear-zone-parent','create-manual-zone','link-manual-zone','delete-zone','create-manual-resource','delete-manual-resource','remove-drop-row','set-place']);
  // Addresses. Inside the app every page is #/<kind>/<id> (it loads from a file). On the website the same pages have
  // clean paths instead, /Atlas/<kind>/<id> (BXC_PATHS: set by the page's head, see atlas-public/build.js): the
  // #/... form stays the one used inside the code and its links, and is turned into a path only at the address bar.
  const PATH_MODE=!!(PUBLIC_MODE&&globalThis.BXC_PATHS&&/^https?:$/.test(location.protocol));
  const ROUTE_ROOT=PATH_MODE?globalThis.BXC_PATHS.root:'';
  function routeNow(){
    if(!PATH_MODE)return location.hash||'';
    let p=location.pathname;p=p.startsWith(ROUTE_ROOT)?p.slice(ROUTE_ROOT.length):p.replace(/^\//,'');
    p=p.replace(/(^|\/)index\.html$/,'').replace(/\.html$/,'').replace(/\/$/,'');
    return p?'#/'+p+(location.search||''):(location.hash||'');
  }
  // Lite start (the website, the normal way in): the map's own slim data, the base file, the pictures and search
  // lists; pages and map panels come from files drawn at publish, the section lists, guides and calculators from
  // data/lists.json and cave layouts from data/zones.json, each the first time it is needed. The whole database is
  // only a fallback (a file missing). ?lite=0 turns it off in this browser (remembered), ?lite=1 back on. The app's
  // publish draws the pages from the whole database: it opens the site from this computer (127.0.0.1), always full.
  // (and never while editing: the saved pages and panels are drawn without the editing buttons, so the app's own
  // editing view of the website draws everything itself from the whole database, like the local copy)
  const LITE=PUBLIC_MODE&&!globalThis.bxcEdit&&location.hostname!=='127.0.0.1'&&(()=>{try{const v=new URLSearchParams(location.search).get('lite');if(v==='1'||v==='0')localStorage.setItem('bxcLite',v);return localStorage.getItem('bxcLite')!=='0'}catch{return true}})();
  const routeUrl=h=>PATH_MODE&&/^#\//.test(h)?ROUTE_ROOT+h.slice(2):h;
  function isFull(){return !!snapshot&&!snapshot.bxcLite}   // the whole database is in (always, inside the app)
  globalThis.bxcRouteNow=routeNow;globalThis.bxcRouteUrl=routeUrl;
  const ATLAS='binxonia-atlas', BRIDGE='binxonia-research-collector-bridge';
  const LAST_SEEN_KEY='binxoniaAtlasCollectorLastSeenV2';
  const ROAMING_NPC_TYPES=new Set(['human']);
  let trainerLayer=null;
  let questGiverLayer=null,giverCache={key:null,list:[]};   // quest-givers on the map (see questGiverList); up here so the first map draw can use them
  let gameAreaLayer=null, zoneLayer=null, selfLayer=null, resourceRoot=null, legendControl=null;
  // Named-boss respawn countdowns (background.js tracks these in memory from kill events - see get-boss-timers /
  // noteBossKill). Polled rather than pushed since a kill is a rare event, not worth a dedicated live channel;
  // the countdown text itself ticks every second locally, independent of that poll.
  let bossTimerLayer=null, bossTimerPanelEl=null;
  const bossTimerMarkers=new Map();   // name -> L.Marker
  async function syncBossTimers(){
    try{
      const r=await bridgeRequest('get-boss-timers',{});
      if(r&&r.ok){state.bossTimers=new Map((r.timers||[]).map(t=>[t.name,t]));drawBossTimers();}
    }catch{}
  }
  // A boss holed up in a cave room has no spot on the outdoor map at all, so its countdown note names the
  // room's zone and its marker (see entranceForZone below) sits at that cave's entrance instead.
  function bossZoneNote(t){
    const z=t.position?.z;
    if(!z)return '';
    const name=state.zones?.get(z)?.name;
    return name?` (in ${name})`:' (inside a cave)';
  }
  function bossCountdownText(t){
    const ms=t.respawnAt-Date.now();
    if(ms<=0)return `${t.name} — should be back`+bossZoneNote(t);
    const s=Math.ceil(ms/1000);
    return `${t.name} — back in ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`+bossZoneNote(t);
  }
  // Walks up from a room's zone to whichever ancestor actually has a captured outdoor entrance point (a
  // sub-room's own entry is often only recorded on its parent dungeon zone - see deriveZones/zoneEntrances).
  // where you walk into a zone from outside: the game's dungeon marker when one matches, else a recorded entrance
  // "z" or "z:i" (the i-th place under zone number z) and where its way in is
  function zonePlaceId(id){const [a,b]=String(id).split(':');return [Number(a),Number(b)||0]}
  function placeEntrancePoint(z,i){if(i){const ae=(state.areaEntrances||[]).find(a=>a.z===z&&a.area===i);return ae?{x:ae.x,y:ae.y}:null}return zoneEntrancePoint(z)}
  function zoneEntrancePoint(z){const poi=dungeonPoiForZone(z);if(poi)return {x:poi.x,y:poi.y};const e=entranceForZone(z);return e?{x:num(e.x),y:num(e.y)}:null}
  function entranceForZone(z){
    let cur=z,guard=0;
    while(cur!=null&&guard++<50){
      const ent=state.zoneEntrances?.get(cur);
      if(ent&&num(ent.x)!==null&&num(ent.y)!==null)return ent;
      cur=state.zoneParent?.get(cur);
    }
    return null;
  }
  // The game's own "Dungeon" POIs (D.pois, see the official world map) are named the same as the zones a
  // player actually walks into, and now have accurate positions - a better anchor for a boss timer than an
  // entrance point, when one matches, since it's the dungeon's real map location rather than wherever the
  // player happened to first walk in from.
  const normZoneName=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  function dungeonPoiForZone(z){
    const zoneName=normZoneName(state.zones?.get(z)?.name);
    if(!zoneName)return null;
    let best=null,bestLen=0;
    for(const p of D.pois||[]){
      if(p.category!=='dungeon')continue;
      const pn=normZoneName(p.name);
      if(!pn||!(zoneName===pn||zoneName.includes(pn)||pn.includes(zoneName)))continue;
      if(pn.length>bestLen){best=p;bestLen=pn.length;}
    }
    return best;
  }
  function drawBossTimers(){
    if(typeof L==='undefined'||typeof map==='undefined'||typeof latlng!=='function')return;
    if(!legendState.master.bossTimers){
      if(bossTimerLayer)bossTimerLayer.clearLayers();
      bossTimerMarkers.clear();
      drawBossTimerPanel([]);
      return;
    }
    if(!bossTimerLayer){bossTimerLayer=L.layerGroup().addTo(map);}
    const timers=[...(state.bossTimers||new Map()).values()];
    const seen=new Set();
    for(const t of timers){
      if(!t.position||num(t.position.x)===null||num(t.position.y)===null)continue;
      let pos=t.position;
      if(pos.z){
        const poi=dungeonPoiForZone(pos.z);
        const ent=poi?{x:poi.x,y:poi.y}:entranceForZone(pos.z);
        if(!ent)continue;   // no known way outside from here yet - nothing sensible to place on the world map
        pos=ent;
      }
      seen.add(t.name);
      const ll=latlng(pos,true);
      let m=bossTimerMarkers.get(t.name);
      if(!m){
        m=L.circleMarker(ll,{radius:7,weight:2,color:'#ffd54a',fillColor:'#7a1f1f',fillOpacity:1});
        m.bindTooltip(bossCountdownText(t),{permanent:true,direction:'top',className:'bxc-boss-timer-tip'});
        m.addTo(bossTimerLayer);
        bossTimerMarkers.set(t.name,m);
      } else { m.setLatLng(ll);m.setTooltipContent(bossCountdownText(t)); }
    }
    for(const [name,m] of bossTimerMarkers) if(!seen.has(name)){bossTimerLayer.removeLayer(m);bossTimerMarkers.delete(name);}
    drawBossTimerPanel(timers);
  }
  // A small always-visible list alongside the map, since a marker you have to spot (or that's off the visible
  // area) isn't much of a countdown - this is the same info, just guaranteed readable at a glance.
  function drawBossTimerPanel(timers){
    const mapEl=document.getElementById('map');
    if(!mapEl)return;
    if(!timers.length){if(bossTimerPanelEl){bossTimerPanelEl.remove();bossTimerPanelEl=null;}return;}
    if(!bossTimerPanelEl){
      bossTimerPanelEl=document.createElement('div');
      bossTimerPanelEl.id='bxcBossTimerPanel';
      bossTimerPanelEl.style.cssText='position:absolute;top:10px;right:10px;z-index:1000;background:rgba(13,11,9,.88);border:1px solid #4a3a22;border-radius:8px;padding:8px 10px;font:12px/1.5 Arial,sans-serif;color:#efd39a;max-width:220px;pointer-events:none';
      mapEl.appendChild(bossTimerPanelEl);
    }
    const sorted=timers.slice().sort((a,b)=>a.respawnAt-b.respawnAt);
    bossTimerPanelEl.innerHTML=`<div style="font-weight:600;margin-bottom:4px;color:#f0d29a">Boss respawns</div>`+
      sorted.map(t=>`<div data-boss="${esc(t.name)}">${esc(bossCountdownText(t))}</div>`).join('');
  }
  function tickBossTimers(){
    if(!bossTimerPanelEl)return;
    for(const t of state.bossTimers?.values()||[]){
      const row=bossTimerPanelEl.querySelector(`[data-boss="${CSS.escape(t.name)}"]`);
      if(row)row.textContent=bossCountdownText(t);
      const m=bossTimerMarkers.get(t.name);
      if(m)m.setTooltipContent(bossCountdownText(t));
    }
  }
  setInterval(tickBossTimers,1000);
  if(!PUBLIC_MODE)setInterval(syncBossTimers,15000);   // no live boss-kill feed to poll for in the shared build
  let catalogFamily=new Map(); // monster typeId -> family, rebuilt on each map draw
  let catalogWeak=new Map(); // monster typeId -> its weakTo string, rebuilt alongside catalogFamily
  let catalogResist=new Map(); // monster typeId -> its resists string, rebuilt alongside catalogFamily
  let zoneOverlayDrag=null, zoneOverlayPan=null, suppressNextOverlayClick=false, lastRenderedZoneOverlayZ=null;
  let requestCounter=0, snapshot=null, rawSnapshot=null, syncing=false, lastSnapshotStats=null;   // rawSnapshot: as the collector sent it; snapshot: places split (splitPlaces)
  const pending=new Map();
  const selectedResourceLayer=(typeof map!=='undefined'&&typeof L!=='undefined')?L.layerGroup().addTo(map):null;
  const state={
    monster:new Map(), gather:new Map(), gems:[], gemByType:new Map(), xp:{}, drops:[], dropAgg:new Map(), assets:[], assetIndex:new Map(),
    liveMarkersByType:new Map(), unknownItems:[], unknownMessages:[], worldTypes:[],
    zones:new Map(), zoneEntrances:new Map(), zoneContents:new Map(), zoneInternalExits:new Map(), zoneParent:new Map(), openZone:null, objectSkillByType:new Map(),
    resourceCatalog:new Map(), resourceMarkersByType:new Map(), resourceLayerByKey:new Map(), resourceLayerVisible:new Map(), selectedResourceType:null, selves:[], items:new Map(),
    visitBaseline:null, visitStartedAt:Date.now(), lastSyncAt:null, addZoneArmed:false, addSubLevelArmed:false, zoneSvgBounds:new Map(), moveEntranceArmed:false, moveEntranceForZone:null,
    news:[], newsLoaded:false, newsLoading:false, newsError:null, zoneDetailZoom:new Map(), setEntranceForChildZ:null, markExitArmed:false,
    bossTimers:new Map()
  };
  const staticCatalogBase=new Map();
  const staticIdsByType=new Map();
  const knownCatalogIds=new Set();
  for(const m of D.catalog||[]){
    staticCatalogBase.set(m.typeId,{count:Number(m.count||0),min:m.obsMinLevel,max:m.obsMaxLevel});
    knownCatalogIds.add(m.typeId);
  }
  for(const m of D.markers||[]){
    if(!staticIdsByType.has(m.typeId))staticIdsByType.set(m.typeId,new Set());
    if(m.id)staticIdsByType.get(m.typeId).add(String(m.id));
  }

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
  function fmt(v,d=0){const n=num(v);return n===null?'—':n.toLocaleString(undefined,{maximumFractionDigits:d})}
  function when(v){const n=num(v);return n===null?'—':new Date(n).toLocaleString()}
  function slug(v){return String(v||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
  function sameSession(a,b){return !a?.sessionId||!b?.sessionId||a.sessionId===b.sessionId}
  // The closest row in time (within windowMs) to target. Rows are looked up in a copy sorted by time (binary search,
  // then outward) - scanning the whole list for each of ~17k gathers was ~280M steps and 3.6 s on every page change.
  // The sorted copy is kept per list and redone when the list grows (live rows are appended).
  const byTimeCache=new WeakMap();
  function sortedByTime(arr){
    let c=byTimeCache.get(arr);
    if(!c||c.n!==arr.length){const rows=arr.filter(x=>num(x.time)!==null).sort((a,b)=>num(a.time)-num(b.time));c={n:arr.length,rows,times:rows.map(x=>num(x.time))};byTimeCache.set(arr,c)}
    return c;
  }
  function nearest(arr,target,pred,windowMs=2500){
    const tt=num(target?.time);if(tt===null||!arr||!arr.length)return null;
    const {rows,times}=sortedByTime(arr);
    let lo=0,hi=times.length;while(lo<hi){const m=(lo+hi)>>1;if(times[m]<tt)lo=m+1;else hi=m}
    let best=null,bestD=Infinity;
    for(let i=lo;i<times.length;i++){const d=times[i]-tt;if(d>windowMs||d>=bestD)break;const x=rows[i];if(pred&&!pred(x)||!sameSession(x,target))continue;best=x;bestD=d;break}
    for(let i=lo-1;i>=0;i--){const d=tt-times[i];if(d>windowMs||d>=bestD)break;const x=rows[i];if(pred&&!pred(x)||!sameSession(x,target))continue;best=x;bestD=d;break}
    return best;
  }
  // Skill readings grouped by skill and sorted by time, built once per snapshot array: latestSkillNear is called once
  // per gem (thousands), and scanning every reading each time was quadratic (gems x 20k readings).
  const skillIdxCache=new WeakMap();
  function skillIndex(){
    const arr=snapshot?.skillObservations||[];let c=skillIdxCache.get(arr);
    if(!c||c.n!==arr.length){
      const by=new Map();
      for(const x of arr){const t=num(x.time);if(t===null)continue;const k=String(x.skill||'').toLowerCase();let e=by.get(k);if(!e)by.set(k,e=[]);e.push(x)}
      for(const [k,rows] of by){rows.sort((a,b)=>num(a.time)-num(b.time));by.set(k,{rows,times:rows.map(x=>num(x.time))})}
      c={n:arr.length,by};skillIdxCache.set(arr,c);
    }
    return c.by;
  }
  function latestSkillNear(skill,time,sessionId,windowMs=10000){
    const e=skillIndex().get(String(skill||'').toLowerCase());if(!e)return null;
    const tt=num(time)||0,{rows,times}=e;
    let lo=0,hi=times.length;while(lo<hi){const m=(lo+hi)>>1;if(times[m]<tt)lo=m+1;else hi=m}
    let best=null,bestD=Infinity;
    for(let i=lo;i<times.length&&times[i]-tt<=windowMs;i++){const x=rows[i];if(sessionId&&x.sessionId&&sessionId!==x.sessionId)continue;const d=times[i]-tt;if(d<bestD){best=x;bestD=d}break}
    for(let i=lo-1;i>=0&&tt-times[i]<=windowMs;i--){const x=rows[i];if(sessionId&&x.sessionId&&sessionId!==x.sessionId)continue;const d=tt-times[i];if(d<bestD){best=x;bestD=d}break}
    return best;
  }

  // A place sharing its zone number with others (splitPlaces) is edited on its own: the collector keeps its name,
  // entrance, way out and parent under a spot inside it (set-place); adopt moves a zone-wide edit that belongs to
  // this place onto it first. A parent that is such a place is saved with its spot.
  const ZONE_EDITS={'set-zone-name':x=>({name:x.name}),'clear-zone-name-override':()=>({name:''}),'set-zone-entrance':x=>({entrance:{x:x.x,y:x.y}}),'clear-zone-entrance':()=>({entrance:null}),
    'set-zone-exit':x=>({exit:{x:x.x,y:x.y}}),'clear-zone-exit':()=>({exit:null}),'set-zone-parent':x=>({parent:parentRef(x.parentZ)}),'clear-zone-parent':()=>({parent:{z:null}})};
  const parentRef=pz=>{const p=placeOfId.get(Number(pz));return p?{z:p.z,at:p.at}:{z:Number(pz)}};
  function bridgeRequest(cmd,extra={}){
    if(!ZONE_EDITS[cmd])return bridgeSend(cmd,extra);
    const pl=placeOfId.get(Number(extra.z));
    if(!pl){const p=extra.parentZ!=null?placeOfId.get(Number(extra.parentZ)):null;return bridgeSend(cmd,p?{...extra,parentZ:p.z,parentAt:p.at}:extra)}
    return bridgeSend('set-place',{z:pl.z,at:pl.at,...(pl.legacy?{adopt:true}:{}),...ZONE_EDITS[cmd](extra)});
  }
  function bridgeSend(cmd,extra={}){
    // The public build never has a collector to ask - fail fast instead of a silent 3s timeout on every call.
    if(PUBLIC_MODE){
      // the website, opened by the app: an edit goes to your collector (and out with the next publish)
      if(EDIT&&SITE_EDIT_CMDS.has(cmd))return globalThis.bxcEdit.send(cmd,JSON.parse(JSON.stringify(extra||{})));
      return Promise.reject(new Error('Not available in the shared Atlas'));
    }
    if(typeof chrome!=='undefined' && chrome.runtime && chrome.runtime.id)return chrome.runtime.sendMessage({cmd,...extra});
    return new Promise((resolve,reject)=>{
      const requestId=`atlas-${Date.now()}-${++requestCounter}`;
      pending.set(requestId,{resolve,reject,t:setTimeout(()=>{pending.delete(requestId);reject(new Error('Collector extension did not respond. Enable Allow access to file URLs, then reload this page.'));},3000)});
      window.postMessage({source:ATLAS,requestId,cmd,...extra},'*');
    });
  }
  addEventListener('message',e=>{
    if(e.source!==window||!e.data||e.data.source!==BRIDGE)return;
    if(e.data.kind==='push'){applyDelta(e.data);return;}
    if(!e.data.requestId)return;
    const p=pending.get(e.data.requestId);if(!p)return;clearTimeout(p.t);pending.delete(e.data.requestId);
    e.data.ok?p.resolve(e.data.data):p.reject(new Error(e.data.error||'Collector error'));
  });
  let livePort=null;
  function connectLivePort(){
    if(PUBLIC_MODE)return;
    if(!(typeof chrome!=='undefined' && chrome.runtime && chrome.runtime.id))return;
    try{
      livePort=chrome.runtime.connect({name:'binxonia-collector-bridge-v132'});
      livePort.postMessage({kind:'hello',role:'viewer'});
      livePort.onMessage.addListener(msg=>{if(msg&&msg.kind==='push')applyDelta(msg)});
      livePort.onDisconnect.addListener(()=>{livePort=null;setTimeout(connectLivePort,2000)});
    }catch(_){}
  }
  connectLivePort();

  function addControls(){
    const bar=document.getElementById('bar');if(!bar||document.getElementById('collectorSync')||document.getElementById('collectorStatus'))return;
    // The shared build gets none of this: no button here can reach a live collector to begin with, but the
    // point is that the code that could never runs, not that the buttons are hidden after being built.
    if(PUBLIC_MODE){
      const cs=document.createElement('span');cs.id='collectorStatus';cs.className='collector-status';
      const status=document.getElementById('status');bar.insertBefore(cs,status);
      if(!EDIT)return;
    }
    const sync=document.createElement('button');sync.id='collectorSync';sync.textContent='Sync now';sync.title='Pull the latest persistent collector database into this page';
    const exp=document.createElement('button');exp.id='collectorExport';exp.textContent='Export data';
    const imp=document.createElement('button');imp.id='collectorImport';imp.textContent='Import data';imp.title='Merge a previously exported/backed-up JSON into the collector database';
    const mark=document.createElement('button');mark.id='collectorMarkSeen';mark.textContent='Mark seen';mark.title='Reset the new-since-last-visit counters';
    const addZone=document.createElement('button');addZone.id='collectorAddZone';addZone.textContent='Add zone';addZone.title='Click, then click a spot on the map to manually place a named zone/entrance marker there';
    const addRes=document.createElement('button');addRes.id='collectorAddResource';addRes.textContent='Add resource';addRes.title='Pick a skill and a resource, then click the map to place it there by hand';
    const status=document.getElementById('status');
    if(PUBLIC_MODE){const cs0=document.getElementById('collectorStatus');bar.insertBefore(addZone,cs0||status);bar.insertBefore(addRes,cs0||status)}   // (the website: just the two placing tools)
    else{const cs=document.createElement('span');cs.id='collectorStatus';cs.className='collector-status';cs.textContent='Collector: checking…';
      bar.insertBefore(sync,status);bar.insertBefore(exp,status);bar.insertBefore(imp,status);bar.insertBefore(mark,status);bar.insertBefore(addZone,status);bar.insertBefore(addRes,status);bar.insertBefore(cs,status)}
    addRes.onclick=()=>{if(state.addResourceArmed){cancelResourcePlacement();return}openAddResourceDialog()};
    sync.title='Back up the collector data (if it changed since the last backup), then pull the latest into this page';sync.onclick=syncAndBackup;exp.onclick=()=>bridgeRequest('open-export').catch(err=>setCollectorStatus('Collector: '+err.message));
    imp.onclick=()=>bridgeRequest('open-import').catch(err=>setCollectorStatus('Collector: '+err.message));
    mark.onclick=()=>{if(snapshot){state.visitBaseline={...(snapshot.stats||{})};saveSeen();updateStatus();augmentCurrentTab();}};
    addZone.onclick=()=>{
      cancelResourcePlacement(false);
      state.addZoneArmed=!state.addZoneArmed;
      state.moveEntranceArmed=false;state.moveEntranceForZone=null;
      addZone.textContent=state.addZoneArmed?'Click the map…':'Add zone';
      addZone.style.background=state.addZoneArmed?'#7a5c30':'';
      updatePlacementCursor(state.addZoneArmed);
    };
    if(typeof map!=='undefined'){
      map.on('mousemove',e=>{
        if(!state.addZoneArmed&&!state.moveEntranceArmed&&!state.addResourceArmed)return;
        if(!placementPreviewMarker){
          placementPreviewMarker=L.marker(e.latlng,{interactive:false,icon:L.divIcon({className:'bxc-placement-crosshair',html:'<div style="width:28px;height:28px;position:relative;pointer-events:none"><div style="position:absolute;top:50%;left:0;right:0;height:1px;background:#ff5a5a"></div><div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#ff5a5a"></div><div style="position:absolute;top:50%;left:50%;width:9px;height:9px;border:1.5px solid #ff5a5a;border-radius:50%;transform:translate(-50%,-50%);background:rgba(255,90,90,.18)"></div></div>',iconSize:[28,28],iconAnchor:[14,14]})}).addTo(map);
        }else{
          placementPreviewMarker.setLatLng(e.latlng);
        }
      });
      map.on('click',e=>{
        if(state.editorSpotPick){const fn=state.editorSpotPick;state.editorSpotPick=null;updatePlacementCursor(false);mapPlacementBanner(null);fn(unprojectLatLng(e.latlng));return}   // a spot for the page editor
        if(state.addResourceArmed){placeManualResource(e.latlng);return}
        if(state.moveNpcArmed){const name=state.moveNpcArmed;state.moveNpcArmed=null;updatePlacementCursor(false);mapPlacementBanner(null);
          const pos=unprojectLatLng(e.latlng);bridgeRequest('set-npc-spot',{name,x:pos.x,y:pos.y}).then(syncNow).then(()=>setCollectorStatus(`Collector: moved ${name}`)).catch(err=>setCollectorStatus('Collector: '+err.message));return}
        if(state.moveEntranceArmed){
          const z=state.moveEntranceForZone;
          state.moveEntranceArmed=false;state.moveEntranceForZone=null;
          updatePlacementCursor(false);mapPlacementBanner(null);
          const pos=unprojectLatLng(e.latlng);
          bridgeRequest('set-zone-entrance',{z,x:pos.x,y:pos.y}).then(syncNow).then(()=>{lastRenderedZoneOverlayZ=null;openZoneOverlay(z)}).catch(err=>setCollectorStatus('Collector: '+err.message));
          return;
        }
        if(!state.addZoneArmed)return;
        state.addZoneArmed=false;addZone.textContent='Add zone';addZone.style.background='';
        updatePlacementCursor(false);
        const pos=unprojectLatLng(e.latlng);
        // A zone is already marked right here (detected or added earlier): update it rather than duplicate it.
        const near=nearestZoneEntrance(pos,ZONE_DUPLICATE_UNITS);
        if(near){
          const update=window.confirm(`"${near.name}" already has its entrance about ${near.dist.toFixed(1)} tiles from where you clicked.\n\nPress OK to rename it and move its entrance here instead of adding a duplicate.\nPress Cancel to add nothing.`);
          if(!update)return;
          askName('Name for this zone / entrance',near.name).then(newName=>{
            if(!newName||!newName.trim())return;
            return bridgeRequest('set-zone-name',{z:near.z,name:newName.trim()}).then(()=>bridgeRequest('set-zone-entrance',{z:near.z,x:pos.x,y:pos.y})).then(syncNow);
          }).catch(err=>setCollectorStatus('Collector: '+err.message));
          return;
        }
        zoneTargetDialog('Add zone / entrance',zoneCandidates()).then(choice=>{
          if(!choice)return;
          if(choice.z!=null){
            // An already-recorded zone: put its entrance marker here so it opens with its real layout.
            return bridgeRequest('set-zone-entrance',{z:choice.z,x:pos.x,y:pos.y}).then(syncNow)
              .then(()=>setCollectorStatus(`Collector: "${state.zones.get(choice.z)?.name||('Zone '+choice.z)}" entrance placed here`));
          }
          return bridgeRequest('create-manual-zone',{name:choice.name,x:pos.x,y:pos.y}).then(r=>{
            const note=r&&r.mergedInto?`Collector: "${r.mergedInto.name}" was already detected here, so your name and position were applied to it (no duplicate added)`:null;
            return syncNow().then(()=>{if(note)setCollectorStatus(note)}); // after the sync, which would otherwise overwrite the message
          });
        }).catch(err=>setCollectorStatus('Collector: '+err.message));
      });
    }
  }
  let placementPreviewMarker=null;
  function updatePlacementCursor(active){
    if(typeof map==='undefined')return;
    const el=map.getContainer();
    if(el)el.style.cursor=active?'crosshair':'';
    if(!active&&placementPreviewMarker){map.removeLayer(placementPreviewMarker);placementPreviewMarker=null;}
  }
  function startMoveEntrance(z){
    if(z==null)return;
    cancelResourcePlacement(false);
    state.addZoneArmed=false;
    const addZoneBtn=document.getElementById('collectorAddZone');
    if(addZoneBtn){addZoneBtn.textContent='Add zone';addZoneBtn.style.background='';}
    const meta=state.zones.get(z);
    setCollectorStatus(`Collector: click the map to place the entrance for "${meta?.name||('Zone '+z)}"`);
    const cur=state.zoneEntrances?.get(z);if(cur&&typeof map!=='undefined')map.setView(latlng({x:cur.x,y:cur.y},true),Math.max(map.getZoom(),0));
    mapPlacementBanner(`Click the map where the way into <b>${esc(meta?.name||('Zone '+z))}</b> is.`,()=>{state.moveEntranceArmed=false;state.moveEntranceForZone=null;updatePlacementCursor(false);openZoneOverlay(z)});
    setTimeout(()=>{
      state.moveEntranceForZone=z;
      state.moveEntranceArmed=true;
      updatePlacementCursor(true);
    },0);
  }
  function setCollectorStatus(t){const el=document.getElementById('collectorStatus');if(!el)return;
    // on the website (opened by the app, editing): an edit's message also says when the website catches up
    if(PUBLIC_MODE&&EDIT&&/^Collector: (?!checking|syncing)/.test(String(t))&&!/^Collector: .*(error|failed|not )/i.test(String(t))){t=String(t).replace(/^Collector: /,'');t=t.charAt(0).toUpperCase()+t.slice(1)+' — saved in your collector; the website shows it after the next publish, in a few minutes'}
    el.textContent=t}
  // A bar on the map while a click there is awaited (the layout panel is out of the way), with Cancel and Esc.
  let placementBannerEl=null,placementBannerCancel=null;
  function mapPlacementBanner(html,onCancel){
    const mapEl=document.getElementById('map');
    if(!html){if(placementBannerEl)placementBannerEl.remove();placementBannerEl=null;placementBannerCancel=null;return}
    if(!mapEl)return;
    if(!placementBannerEl){placementBannerEl=document.createElement('div');placementBannerEl.className='zn-mode zn-mode-map';if(typeof L!=='undefined'&&L.DomEvent)L.DomEvent.disableClickPropagation(placementBannerEl)}
    placementBannerCancel=onCancel||null;
    placementBannerEl.innerHTML=`<span>${html}</span><button type="button">Cancel</button>`;
    placementBannerEl.querySelector('button').onclick=()=>{const c=placementBannerCancel;mapPlacementBanner(null);if(c)c()};
    mapEl.appendChild(placementBannerEl);
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&placementBannerEl&&state.moveEntranceArmed){const c=placementBannerCancel;mapPlacementBanner(null);if(c)c()}});
  function loadBaseline(){
    try{const x=JSON.parse(localStorage.getItem(LAST_SEEN_KEY)||'null');if(x&&x.stats)state.visitBaseline=x.stats;}catch{}
  }
  function saveSeen(){
    if(!snapshot)return;try{localStorage.setItem(LAST_SEEN_KEY,JSON.stringify({time:Date.now(),stats:snapshot.stats||{}}));}catch{}
  }
  addEventListener('pagehide',saveSeen);

  function deriveResourceSkills(){
    const map=new Map();
    const yieldByObjectId=new Map();
    const bySlug=new Map((typeof GATHERABLES!=='undefined'?GATHERABLES:[]).map(g=>[slug(g.item),g.skill]));
    const worldObjById=new Map((snapshot?.worldObjects||[]).map(o=>[o.id,o]));
    for(const g of snapshot?.gathers||[]){
      if(g.success!==true||!g.objectId||!g.itemTypeId)continue;
      const skill=bySlug.get(slug(g.itemTypeId));if(!skill)continue;
      const obj=worldObjById.get(g.objectId);if(!obj)continue;
      if(!map.has(obj.typeId))map.set(obj.typeId,skill);
      const counts=yieldByObjectId.get(g.objectId)||new Map();
      counts.set(g.itemTypeId,(counts.get(g.itemTypeId)||0)+1);
      yieldByObjectId.set(g.objectId,counts);
    }
    state.objectSkillByType=map;
    const primaryYield=new Map();
    for(const [id,counts] of yieldByObjectId){
      let best=null,bestN=0;
      for(const [item,n] of counts){ if(n>bestN){best=item;bestN=n;} }
      if(best)primaryYield.set(id,best);
    }
    // Without gather history (the public Atlas leaves it out as personal activity, and you may not have worked every
    // spot) the game's own rules say which objects are resources: every rock, tree and plant with its skill and item
    // (family-rules.js), and each fishing spot names its own fish. Your own gathers, above, still win.
    const ruleGather=globalThis.BXC_FAMILY_RULES?.gatherables||{};
    for(const [typeId,g] of Object.entries(ruleGather))if(!map.has(typeId))map.set(typeId,g[0]);
    if(!map.has('fishing-spot'))map.set('fishing-spot','fishing');
    for(const o of snapshot?.worldObjects||[]){
      if(primaryYield.has(o.id))continue;
      const y=o.typeId==='fishing-spot'?o.data?.fishTypes?.[0]:ruleGather[o.typeId]?.[1];
      if(y)primaryYield.set(o.id,y);
    }
    state.resourceYieldByObjectId=primaryYield;
  }
  function resourceKeyFor(o){
    const item=state.resourceYieldByObjectId?.get(o.id);
    return item?`${o.typeId}::${item}`:o.typeId;
  }
  function resourceLabel(o){
    const item=state.resourceYieldByObjectId?.get(o.id);
    const base=prettyId(o.name||o.typeId);
    return item?`${base} (${prettyId(item)})`:base;
  }
  function resourceIconUrl(o){
    if(typeof objectIconUrl!=='function')return null;
    const item=state.resourceYieldByObjectId?.get(o.id);
    if(item){ const u=objectIconUrl(item,prettyId(item)); if(u)return u; }
    return objectIconUrl(o.typeId,o.name);
  }
  // one icon per picture, shared by every marker that shows it (an icon builds each marker's element from the same
  // options), instead of a new icon object for each of thousands of resources on every redraw
  const resourceIconCache=new Map();
  function resourceMapIcon(o){
    if(typeof L==='undefined')return null;
    const url=resourceIconUrl(o);
    if(!url)return null;
    if(resourceIconCache.has(url))return resourceIconCache.get(url);
    if(resourceIconCache.size>500)resourceIconCache.clear();
    const icon=L.divIcon({
      className:'bxc-resource-icon',
      html:`<div style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:rgba(20,15,10,.55);border-radius:50%;box-shadow:0 0 3px rgba(0,0,0,.8)"><img src="${url}" style="width:18px;height:18px;object-fit:contain"></div>`,
      iconSize:[22,22],
      iconAnchor:[11,11]
    });
    resourceIconCache.set(url,icon);return icon;
  }
  function resourceMarkerStyle(typeId){
    const skill=state.objectSkillByType?.get(typeId);
    if(skill==='fishing')return {color:'#0d2f3a',fillColor:'#4fc3f7'};
    if(skill==='herblore')return {color:'#123a12',fillColor:'#7ed957'};
    return {color:'#24112e',fillColor:'#d37aff'};
  }
  function resourceCategoryLabel(skill){return skill?prettyId(skill):'Resource'}
  function typedResourceIcon(typeId,yieldItem,name){
    if(typeof L==='undefined'||typeof objectIconUrl!=='function')return null;
    const url=(yieldItem&&objectIconUrl(yieldItem,prettyId(yieldItem)))||objectIconUrl(typeId,name);
    if(!url)return null;
    return L.divIcon({
      className:'bxc-resource-icon',
      html:`<div style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:rgba(20,15,10,.55);border-radius:50%;box-shadow:0 0 3px rgba(0,0,0,.8)"><img src="${url}" style="width:18px;height:18px;object-fit:contain"></div>`,
      iconSize:[22,22],
      iconAnchor:[11,11]
    });
  }
  function typedResourceLabel(typeId,yieldItem,name){
    const base=prettyId(name||typeId);
    return yieldItem?`${base} (${prettyId(yieldItem)})`:base;
  }
  function deriveResourceCatalog(){
    const map=new Map();
    for(const o of snapshot?.worldObjects||[]){
      if(!o.position||num(o.position.x)===null||num(o.position.y)===null)continue;
      const skill=state.objectSkillByType?.get(o.typeId);
      if(!skill)continue;
      const yieldItem=state.resourceYieldByObjectId?.get(o.id)||null;
      const key=resourceKeyFor(o);
      const r=map.get(key)||{key,typeId:o.typeId,yieldItem,name:o.name||o.typeId,skill,count:0,lastSeen:0};
      r.count++;r.lastSeen=Math.max(r.lastSeen,num(o.lastSeen)||0);
      map.set(key,r);
    }
    deriveManualResources(map);
    state.resourceCatalog=map;
  }

  // ---- Resources placed by hand -------------------------------------------------------------
  // A manual entry is hidden as soon as the collector has recorded a real resource of the same
  // skill (and the same item, when that is known) within MANUAL_MATCH_UNITS of it, so a resource
  // is never shown twice. Manual entries that are still on their own share their catalog entry (and
  // so the legend toggle and guide card) with the collector's resource of the same item when there
  // is one, or get a catalog entry of their own.
  const MANUAL_MATCH_UNITS=3;
  function deriveManualResources(catalog){
    const real=[];
    for(const o of snapshot?.worldObjects||[]){
      if(!o.position||num(o.position.x)===null||num(o.position.y)===null||o.position.z)continue;
      const skill=state.objectSkillByType?.get(o.typeId);
      if(!skill)continue;
      real.push({id:o.id,skill,yieldSlug:slug(state.resourceYieldByObjectId?.get(o.id)||''),x:o.position.x,y:o.position.y});
    }
    const list=[];
    for(const m of snapshot?.manualResources||[]){
      const x=num(m.x),y=num(m.y);
      if(x===null||y===null||!m.skill)continue;
      const itemSlug=m.itemTypeId||slug(m.item);
      const match=real.find(o=>o.skill===m.skill&&(!o.yieldSlug||o.yieldSlug===itemSlug)&&Math.hypot(o.x-x,o.y-y)<=MANUAL_MATCH_UNITS);
      const entry={...m,x,y,itemSlug,key:null,matchedObjectId:match?match.id:null,hidden:!!match};
      if(!match){
        let key=null;
        for(const r of catalog.values())if(r.skill===m.skill&&r.yieldItem&&slug(r.yieldItem)===itemSlug){key=r.key;break}
        if(!key){
          key='manual::'+itemSlug;
          if(!catalog.has(key))catalog.set(key,{key,typeId:itemSlug,yieldItem:null,name:m.item,skill:m.skill,count:0,lastSeen:0,manualOnly:true,manualCount:0});
        }
        const r=catalog.get(key);
        r.manualCount=(r.manualCount||0)+1;
        if(r.manualOnly)r.lastSeen=Math.max(r.lastSeen,num(m.createdAt)||0);
        entry.key=key;
      }
      list.push(entry);
    }
    state.manualResources=list;
  }
  function manualMarkerStyle(skill){
    if(skill==='fishing')return {color:'#0d2f3a',fillColor:'#4fc3f7'};
    if(skill==='herblore')return {color:'#123a12',fillColor:'#7ed957'};
    return {color:'#24112e',fillColor:'#d37aff'};
  }
  function tooltipManualResource(m){
    return `<b>${esc(m.item)}</b> <span style="opacity:.75">${esc(prettyId(m.skill))}</span><br>Added manually · World: ${esc(fmt(m.x,1))}, ${esc(fmt(m.y,1))}${CLICK_HINT}<br><span style="opacity:.7">Right-click to remove</span>`;
  }
  function removeManualResource(m){
    if(!window.confirm(`Remove the ${m.item} you added at ${fmt(m.x,1)}, ${fmt(m.y,1)}?`))return;
    bridgeRequest('delete-manual-resource',{id:m.id}).then(syncNow).catch(err=>setCollectorStatus('Collector: '+err.message));
  }
  // What is already recorded at this spot for this resource (collector-observed or manual), if anything.
  function recordedResourceNear(choice,pos){
    const itemSlug=slug(choice.item);
    for(const m of state.manualResources||[]){
      if(!m.hidden&&m.skill===choice.skill&&m.itemSlug===itemSlug&&Math.hypot(m.x-pos.x,m.y-pos.y)<=MANUAL_MATCH_UNITS)return `A manually added ${m.item}`;
    }
    for(const o of snapshot?.worldObjects||[]){
      if(!o.position||o.position.z||num(o.position.x)===null||num(o.position.y)===null)continue;
      if(state.objectSkillByType?.get(o.typeId)!==choice.skill)continue;
      const y=slug(state.resourceYieldByObjectId?.get(o.id)||'');
      if(y&&y!==itemSlug)continue;
      if(Math.hypot(o.position.x-pos.x,o.position.y-pos.y)<=MANUAL_MATCH_UNITS)return `${resourceLabel(o)} (already gathered from and recorded)`;
    }
    return null;
  }

  // ---- "Add resource": pick a skill, then a resource, then click the map ---------------------
  function resourceSkillOptions(){
    const skills=[...new Set((typeof GATHERABLES!=='undefined'?GATHERABLES:[]).map(g=>g.skill))];
    for(const r of state.resourceCatalog.values())if(r.skill&&!skills.includes(r.skill))skills.push(r.skill);
    return skills.sort((a,b)=>prettyId(a).localeCompare(prettyId(b)));
  }
  function resourceItemOptions(skill){
    const seen=new Map();
    for(const g of typeof GATHERABLES!=='undefined'?GATHERABLES:[])if(g.skill===skill)seen.set(slug(g.item),{item:g.item,level:g.level});
    for(const r of state.resourceCatalog.values())if(r.skill===skill&&r.yieldItem&&!seen.has(slug(r.yieldItem)))seen.set(slug(r.yieldItem),{item:prettyId(r.yieldItem),level:null});
    return [...seen.values()].sort((a,b)=>(a.level==null?999:a.level)-(b.level==null?999:b.level)||a.item.localeCompare(b.item));
  }
  function addResourceDialogStyle(){
    if(document.getElementById('bxc-modal-style'))return;
    const st=document.createElement('style');st.id='bxc-modal-style';
    st.textContent=`
.bxc-modal-backdrop{position:fixed;inset:0;z-index:10050;background:rgba(6,12,9,.62);display:flex;align-items:center;justify-content:center;font:14px 'Segoe UI',Arial,sans-serif}
.bxc-modal{width:min(380px,92vw);background:linear-gradient(160deg,#182b22,#111e19);color:#e8eade;border:1px solid #5d6042;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.6);padding:16px 18px}
.bxc-modal h2{margin:0 0 6px;font:small-caps 22px Georgia,serif;color:#efd39a;letter-spacing:.5px}
.bxc-modal label{display:block;margin:10px 0 0;font-size:12px;color:#b6c7ba}
.bxc-modal select{display:block;width:100%;margin-top:4px;padding:8px 10px;background:#101f16;color:#e8eade;border:1px solid #4c6046;border-radius:7px;font:14px 'Segoe UI',Arial,sans-serif}
.bxc-modal select:focus-visible,.bxc-modal button:focus-visible{outline:2px solid #d9b878;outline-offset:2px}
.bxc-modal-note{font-size:12px;color:#b0c0b3;line-height:1.5;margin:12px 0 4px}
.bxc-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.bxc-modal-actions button{padding:8px 14px;background:#1d3027;color:#e8eade;border:1px solid #496051;border-radius:7px;cursor:pointer;font:inherit}
.bxc-modal-actions button.primary{background:#34422c;border-color:#756b43;color:#ffe0a0}
.bxc-modal-actions button:hover{border-color:#d9b878}
.bxc-modal input[type=text]{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:8px 10px;background:#101f16;color:#e8eade;border:1px solid #4c6046;border-radius:7px;font:14px 'Segoe UI',Arial,sans-serif}
.bxc-modal input[type=text]:focus-visible{outline:2px solid #d9b878;outline-offset:2px}
.bxc-seg{display:flex;gap:16px;margin:8px 0 0}
.bxc-seg label{margin:0;font-size:13px;color:#e8eade;cursor:pointer}
.manualres-remove{margin-left:6px;padding:1px 8px;font-size:11px}
`;
    document.head.appendChild(st);
  }
  function openAddResourceDialog(){
    if(document.getElementById('bxcResDialog'))return;
    addResourceDialogStyle();
    const skills=resourceSkillOptions();
    const wrap=document.createElement('div');wrap.id='bxcResDialog';wrap.className='bxc-modal-backdrop';
    wrap.innerHTML=`<div class="bxc-modal" role="dialog" aria-modal="true" aria-labelledby="bxcResTitle"><h2 id="bxcResTitle">Add resource</h2><label>Skill<select id="bxcResSkill">${skills.map(s=>`<option value="${esc(s)}">${esc(prettyId(s))}</option>`).join('')}</select></label><label>Resource (type to search)<input id="bxcResItem" type="text" list="bxcResList" autocomplete="off" spellcheck="false"></label><datalist id="bxcResList"></datalist><p class="bxc-modal-note">Press <b>Place on map</b>, then click the spot where this resource is. If the collector later records a real one there, it replaces your marker automatically, so a resource is never shown twice.</p><div class="bxc-modal-actions"><button type="button" id="bxcResGo" class="primary">Place on map</button><button type="button" id="bxcResCancel">Cancel</button></div></div>`;
    document.body.appendChild(wrap);
    const skillEl=wrap.querySelector('#bxcResSkill'),itemEl=wrap.querySelector('#bxcResItem');
    const listEl=wrap.querySelector('#bxcResList');
    const fill=()=>{listEl.innerHTML=resourceItemOptions(skillEl.value).map(o=>`<option value="${esc(o.item)}">${o.level!=null?`Lv ${o.level}`:''}</option>`).join('');itemEl.value=''};
    fill();skillEl.addEventListener('change',fill);
    const onKey=e=>{if(e.key==='Escape'){e.stopPropagation();close()}};
    const close=()=>{document.removeEventListener('keydown',onKey,true);wrap.remove()};
    document.addEventListener('keydown',onKey,true);
    wrap.addEventListener('mousedown',e=>{if(e.target===wrap)close()});
    wrap.querySelector('#bxcResCancel').onclick=close;
    wrap.querySelector('#bxcResGo').onclick=()=>{
      const typed=itemEl.value.trim().toLowerCase();
      const match=resourceItemOptions(skillEl.value).find(o=>o.item.toLowerCase()===typed);
      if(!match){itemEl.focus();itemEl.style.borderColor='#c0563f';return}
      const choice={skill:skillEl.value,item:match.item};
      close();beginResourcePlacement(choice);
    };
    skillEl.focus();
  }
  function beginResourcePlacement(choice){
    state.addZoneArmed=false;state.moveEntranceArmed=false;state.moveEntranceForZone=null;
    const zb=document.getElementById('collectorAddZone');if(zb){zb.textContent='Add zone';zb.style.background=''}
    state.addResourceArmed=true;state.addResourceChoice=choice;
    const btn=document.getElementById('collectorAddResource');if(btn){btn.textContent='Click the map…';btn.style.background='#7a5c30'}
    setCollectorStatus(`Collector: click the map to place ${choice.item} (press Esc to cancel)`);
    updatePlacementCursor(true);
    document.addEventListener('keydown',placementEsc,true);
  }
  function placementEsc(e){if(e.key==='Escape'&&state.addResourceArmed)cancelResourcePlacement()}
  function cancelResourcePlacement(announce=true){
    document.removeEventListener('keydown',placementEsc,true);
    if(!state.addResourceArmed)return;
    state.addResourceArmed=false;state.addResourceChoice=null;
    const btn=document.getElementById('collectorAddResource');if(btn){btn.textContent='Add resource';btn.style.background=''}
    updatePlacementCursor(false);
    if(announce)setCollectorStatus('Collector: resource placement cancelled');
  }
  function placeManualResource(ll){
    const choice=state.addResourceChoice;
    cancelResourcePlacement(false);
    if(!choice)return;
    const pos=unprojectLatLng(ll);
    const already=recordedResourceNear(choice,pos);
    if(already){setCollectorStatus(`Collector: ${already} is already here — nothing added`);return}
    bridgeRequest('create-manual-resource',{skill:choice.skill,item:choice.item,x:pos.x,y:pos.y}).then(r=>{
      const note=r&&r.duplicate?`Collector: ${choice.item} is already marked here — nothing added`:`Collector: added ${choice.item}`;
      return syncNow().then(()=>setCollectorStatus(note)); // after the sync, which would otherwise overwrite the message
    }).catch(err=>setCollectorStatus('Collector: '+err.message));
  }
  // The distance within which "Add zone" treats an existing zone entrance as the same place
  // (kept equal to the collector's own merge distance in background.js).
  const ZONE_DUPLICATE_UNITS=5;
  function nearestZoneEntrance(pos,maxDist){
    let best=null;
    for(const [z,ent] of state.zoneEntrances||[]){
      const d=Math.hypot(ent.x-pos.x,ent.y-pos.y);
      if(d>maxDist||(best&&d>=best.dist))continue;
      best={z,dist:d,name:state.zones.get(z)?.name||('Zone '+z)};
    }
    return best;
  }
  const SELF_STALE_MS=5*60*1000;
  function deriveSelf(){
    const rows=snapshot?.selfState||[];
    const now=Date.now();
    state.selves=rows.filter(r=>r.position&&num(r.time)!==null&&now-num(r.time)<=SELF_STALE_MS);
  }
  function resourceImg(r){
    if(typeof itemImg!=='function')return '';
    if(r.yieldItem)return itemImg({id:r.yieldItem,typeId:r.yieldItem,item:prettyId(r.yieldItem),skill:r.skill});
    return itemImg({id:r.typeId,typeId:r.typeId,item:r.name||prettyId(r.typeId),skill:r.skill});
  }
  function resourceDisplayName(r){
    const base=prettyId(r.name);
    return r.yieldItem?`${base} (${prettyId(r.yieldItem)})`:base;
  }
  function manualLocationsHtml(r){
    const list=(state.manualResources||[]).filter(m=>!m.hidden&&m.key===r.key);
    if(!list.length)return '';
    return `<div class="s">${list.map(m=>`Added by you at ${esc(fmt(m.x,1))}, ${esc(fmt(m.y,1))}${!EDIT?'':` <button type="button" class="manualres-remove" data-id="${esc(m.id)}" title="Remove this manually added location">Remove</button>`}`).join('<br>')}</div>`;
  }
  function resourcesHtml(search=''){
    const s=String(search||'').toLowerCase().trim();
    const rows=[...state.resourceCatalog.values()].filter(r=>!s||JSON.stringify(r).toLowerCase().includes(s)).sort((a,b)=>b.lastSeen-a.lastSeen);
    return `<div class="collector-panel"><div class="collector-title">Observed resources</div><div class="statline"><span>${fmt(rows.length)} gatherable resource types observed</span></div><div class="muted">Only objects you have actually gathered from successfully at least once show up here, so the collector knows for certain they are resources — and, when possible, exactly what they yield (e.g. "Fishing Spot (Trout)"). Click one to highlight every location it has been observed, the same way monsters work in the Bestiary.</div></div>` +
    (rows.length?rows.map(r=>`<div class="card resourcecard" data-r="${esc(r.key)}"><img class="thumb itemthumb" src="${resourceImg(r)}" alt="${esc(resourceDisplayName(r))}"><div class="name"><a class="page-link" href="${pageHref('resource',r.key)}">${esc(resourceDisplayName(r))}</a> <span class="muted">${resourceCategoryLabel(r.skill)}</span></div><div class="s">${fmt(r.count+(r.manualCount||0))} known location${r.count+(r.manualCount||0)===1?'':'s'}${r.manualCount?` (${fmt(r.manualCount)} added manually)`:''}${r.lastSeen?` · ${r.manualOnly?'added':'last seen'} ${when(r.lastSeen)}`:''}</div>${(t=>t?`<div class="s">${t}</div>`:'')(gemDropText(r.skill,r.yieldItem||r.name||r.typeId))}${(y=>y?`<div class="s"><span class="resource-yield-link" data-item="${esc(y)}" title="Show in Items tab" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><img class="thumb itemthumb" src="${esc(itemImgFor(y))}" alt="" style="width:22px;height:22px;flex:none;border-radius:5px"><span>${esc(prettyId(y))}</span></span></div>`:'')(r.yieldItem||null)}${manualLocationsHtml(r)}</div>`).join('')
    :'<div class="note">No gatherable resources confirmed yet. They appear here as data for them comes in.</div>');
  }
  function deriveItems(){
    const items=new Map();
    const ensure=id=>{
      if(!items.has(id))items.set(id,{itemTypeId:id,craft:null,craftCount:0,gatherSkill:null,gatherSuccesses:0,monsterSources:new Map(),resourceSources:new Map(),lastSeen:0});
      return items.get(id);
    };
    for(const t of snapshot?.inventoryTypes||[]){
      if(!t.typeId)continue;
      const r=ensure(t.typeId);
      r.lastSeen=Math.max(r.lastSeen,num(t.lastSeen)||0);
    }
    const recipeByItemId=new Map((typeof RECIPES!=='undefined'?RECIPES:[]).map(rc=>[slugId(rc.id||rc.item),rc]));
    const gatherSkillByItemId=new Map((typeof GATHERABLES!=='undefined'?GATHERABLES:[]).map(g=>[slugId(g.item),g.skill]));
    for(const c of snapshot?.crafts||[]){
      if(!c.itemTypeId)continue;
      const r=ensure(c.itemTypeId);
      r.craftCount++;
      r.lastSeen=Math.max(r.lastSeen,num(c.time)||0);
    }
    for(const [id,g] of state.gather||[]){
      if(!g.successes)continue;
      const r=ensure(g.itemTypeId||id);
      r.gatherSuccesses+=g.successes;
      r.lastSeen=Math.max(r.lastSeen,g.lastSeen||0);
    }
    for(const d of state.dropAgg?.values?.()||[]){
      const r=ensure(d.itemTypeId);
      r.lastSeen=Math.max(r.lastSeen,d.lastSeen||0);
      if(d.monsterTypeId){
        const key=d.sourceType;
        const m=r.monsterSources.get(key)||{typeId:d.monsterTypeId,name:d.monsterName||d.monsterTypeId,elite:d.elite,sourceType:key,events:0};
        m.events+=d.events;r.monsterSources.set(key,m);
      }else if(d.resourceTypeId){
        const m=r.resourceSources.get(d.resourceTypeId)||{name:d.resourceTypeId,events:0};
        m.events+=d.events;r.resourceSources.set(d.resourceTypeId,m);
      }
    }
    const totals=dropTotalsBySource([...state.dropAgg.values()].filter(d=>d.monsterTypeId));
    for(const [id,r] of items){
      for(const m of r.monsterSources.values())m.sourceEvents=totals.get(m.sourceType)||0;
      const rec=recipeByItemId.get(slugId(id));
      if(rec)r.craft={skill:rec.skill,level:rec.level};
      const gs=gatherSkillByItemId.get(slugId(id));
      if(gs)r.gatherSkill=gs;
    }
    state.items=items;
  }
  function itemImgFor(id){
    return typeof itemImg==='function'?itemImg({id,typeId:id,item:prettyId(id)}):'';
  }
  function itemSourcesText(r){
    const parts=[];
    if(r.craft)parts.push(`Crafted (${prettyId(r.craft.skill)}${r.craft.level!=null?' Lv '+r.craft.level:''})${r.craftCount?' · '+fmt(r.craftCount)+' made':''}`);
    if(r.gatherSkill)parts.push(`Gathered (${prettyId(r.gatherSkill)})${r.gatherSuccesses?' · '+fmt(r.gatherSuccesses)+' gathered':''}`);
    if(r.monsterSources.size){
      const top=[...r.monsterSources.values()].sort((a,b)=>b.events-a.events);
      parts.push(`Monster drop: ${top.slice(0,5).map(m=>prettyId(m.name)).join(', ')}${top.length>5?` +${top.length-5} more`:''}`);
    }
    if(r.resourceSources.size){
      const top=[...r.resourceSources.values()].sort((a,b)=>b.events-a.events);
      parts.push(`Resource drop: ${top.slice(0,5).map(m=>prettyId(m.name)).join(', ')}${top.length>5?` +${top.length-5} more`:''}`);
    }
    return parts.length?parts.join(' · '):'Source not yet observed';
  }
  // User-confirmed community report, 2026-09-19: Blizzy and Namius (TAP).
  // The quoted report does not distinguish per-item odds from a shared accessory roll.
  function accessoryDropRules(){return '<div class="collector-panel"><div class="collector-title">Cape & amulet drops</div><div>Drop from monsters <b>level 25 or higher (25+)</b>. Normal monsters: <b>1 in 2,500 (0.04%)</b>. Elites: <b>1 in 1,250 (0.08%)</b> — double the chance.</div><div class="muted">Community information confirmed by the user · Blizzy / Namius (TAP), September 19, 2026. The report does not specify whether these odds apply to each item separately or to a shared cape/amulet roll.</div></div>';}
  function itemMatchesSearch(r,search){
    const normalize=v=>String(v||'').toLowerCase().replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
    const terms=normalize(search).split(' ').filter(Boolean);
    const text=normalize([r.itemTypeId,r.craft?.skill,r.gatherSkill,...[...r.monsterSources.values()].map(m=>[m.typeId,m.name,m.elite?'elite':'normal'].join(' ')),...[...r.resourceSources.values()].map(m=>m.name)].join(' '));
    return terms.every(t=>text.includes(t));
  }
  function itemMonsterRates(r){
    const sources=[...r.monsterSources.values()].sort((a,b)=>b.events-a.events);
    if(!sources.length)return '<div class="s muted">No monster drops recorded for this item.</div>';
    const chips=sources.map(m=>{
      const pct=m.sourceEvents?(100*m.events/m.sourceEvents).toFixed(1)+'%':'\u2014';
      const tip=prettyId(m.name)+' - '+(m.elite?'Elite':'Normal')+', '+pct+' of recorded drops ('+fmt(m.events)+' / '+fmt(m.sourceEvents)+' events)';
      return '<div class="entity-chip monsterlink'+(m.elite?' elite':'')+'" data-monster="'+esc(m.typeId)+'" title="'+esc(tip)+'"><img class="thumb monsterthumb" src="'+esc(monsterImg({typeId:m.typeId,name:m.name}))+'" alt=""><span class="entity-chip-label">'+esc(prettyId(m.name))+'</span><span class="entity-chip-stat">'+esc(pct)+'</span></div>';
    });
    return '<div style="margin-top:10px"><b>Recorded monster drops</b>'+chipRowHtml(chips)+'<div class="s muted" style="margin-top:6px">Share of logged loot events from this monster, not a per-kill chance.</div></div>';
  }
  function itemsHtml(search=''){
    const s=String(search||'').toLowerCase().trim();
    const rows=[...(state.items?.values()||[])].filter(r=>itemMatchesSearch(r,s)).sort((a,b)=>b.lastSeen-a.lastSeen);
    return accessoryDropRules()+`<div class="collector-panel"><div class="collector-title">Observed items</div><div class="statline"><span>${fmt(rows.length)} item types observed</span></div><div class="muted">Every item type your collector has seen, with where it's known to come from so far — crafted, gathered from a resource node, or dropped by a monster. This fills in automatically as you craft, gather, and fight; an item you've only received once (e.g. a quest or vendor reward) may show no known source yet.</div></div>` +
    (rows.length?rows.map(r=>`<div class="card" data-item="${esc(r.itemTypeId)}"><img class="thumb itemthumb" src="${itemImgFor(r.itemTypeId)}" alt="${esc(prettyId(r.itemTypeId))}"><div class="name"><a class="page-link" href="${pageHref('item',r.itemTypeId)}">${esc(prettyId(r.itemTypeId))}</a>${questItem(r.itemTypeId)?` <span class="quest-badge" title="Asked for by ${esc(questItem(r.itemTypeId).quests.join(' / '))}">Quest item</span>`:''}</div><div class="s">${esc(itemSourcesText(r))}</div>${itemMonsterRates(r)}<div class="s muted">Last seen ${when(r.lastSeen)}</div>${(r.monsterSources.size||[...(state.resourceCatalog?.values()||[])].some(x=>x.yieldItem===r.itemTypeId))?`<button type="button" class="show-on-map" data-map-kind="item" data-map-id="${esc(r.itemTypeId)}">Show on map</button>`:''}</div>`).join('')
    :'<div class="note">'+(s?'No items match your search.':'No items captured yet.')+'</div>');
  }
  function cloneResourceMarker(src){
    let cm;
    if(src instanceof L.CircleMarker){
      const o=src.options||{};
      cm=L.circleMarker(src.getLatLng(),{radius:7,weight:2,color:o.color||'#24112e',fillColor:o.fillColor||'#d37aff',fillOpacity:1,opacity:1});
    }else{
      cm=L.marker(src.getLatLng(),{icon:src.options?.icon});
    }
    const tt=src.getTooltip?.();if(tt)cm.bindTooltip(tt.getContent(),{sticky:true});
    return cm;
  }
  function showResourceSelection(typeId,fit=true){
    if(!selectedResourceLayer)return false;
    state.selectedResourceType=typeId;
    selectedResourceLayer.clearLayers();
    const src=state.resourceMarkersByType.get(typeId)||[];
    if(!src.length)return false;
    const shown=src.map(m=>{
      const cm=cloneResourceMarker(m);
      cm.addTo(selectedResourceLayer);
      cm.on('click',ev=>{if(armedPassthrough(ev))return;goToCard('resources','r',typeId)});
      return cm;
    });
    const b=L.latLngBounds(shown.map(x=>x.getLatLng()));
    if(fit)map.fitBounds(b.pad(.35),{maxZoom:-1});
    return true;
  }
  function focusResource(typeId){showResourceSelection(typeId,true)}
  function deriveGatherStats(){
    const map=new Map();const exp=(snapshot?.exp||[]).filter(x=>x.sourceKind==='gather'||x.source?.kind==='gather');
    for(const g of snapshot?.gathers||[]){
      const id=String(g.itemTypeId||'unknown');
      if(!map.has(id))map.set(id,{itemTypeId:id,total:0,successes:0,failures:0,xpPairs:[],objects:new Set(),lastSeen:0});
      const r=map.get(id);r.total++;r.lastSeen=Math.max(r.lastSeen,num(g.time)||0);if(g.objectId)r.objects.add(String(g.objectId));
      if(g.success===true){r.successes++;const e=nearest(exp,g,null,2500);if(e&&num(e.amount)!==null)r.xpPairs.push(num(e.amount));}else if(g.success===false)r.failures++;
    }
    for(const r of map.values()){
      const counts=new Map();for(const x of r.xpPairs)counts.set(x,(counts.get(x)||0)+1);
      r.xpMode=[...counts].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??null;
      r.xpMin=r.xpPairs.length?Math.min(...r.xpPairs):null;r.xpMax=r.xpPairs.length?Math.max(...r.xpPairs):null;
      r.xpAvg=r.xpPairs.length?r.xpPairs.reduce((a,b)=>a+b,0)/r.xpPairs.length:null;r.objectCount=r.objects.size;
    }
    state.gather=map;
  }

  function deriveGems(){
    const gather=snapshot?.gathers||[];const byType=new Map();
    const gatherSkillByItem=new Map((GATHERABLES||[]).map(g=>[slug(g.item),g.skill]));
    const worldObjById=new Map((snapshot?.worldObjects||[]).map(o=>[o.id,o]));
    const gatherByObject=new Map();
    for(const g of gather){if(!g.objectId)continue;const list=gatherByObject.get(g.objectId)||[];list.push(g);gatherByObject.set(g.objectId,list);}
    for(const list of gatherByObject.values())list.sort((a,b)=>(num(a.time)||0)-(num(b.time)||0));
    const gemsAsc=[...(snapshot?.gems||[])].sort((a,b)=>(num(a.time)||0)-(num(b.time)||0));
    const lastGemTimeByObject=new Map();
    const recByGem=new Map();
    for(const gem of gemsAsc){
      const near=nearest(gather,gem,g=>g.success===true,2500);const item=near?.itemTypeId||null;const skill=item?gatherSkillByItem.get(slug(item))||null:null;
      const so=skill?latestSkillNear(skill,gem.time,gem.sessionId,12000):null;
      const obj=near?.objectId?worldObjById.get(near.objectId):null;
      let swingsToGem=null;
      if(near?.objectId){
        const list=gatherByObject.get(near.objectId)||[];
        const sinceTime=lastGemTimeByObject.get(near.objectId)??-Infinity;
        const nearTime=num(near.time)||0;
        swingsToGem=list.filter(g=>{const t=num(g.time)||0;return t>sinceTime&&t<=nearTime}).length;
        lastGemTimeByObject.set(near.objectId,nearTime);
      }
      recByGem.set(gem,{...gem,sourceItem:item,sourceSkill:skill,skillLevel:so?.level??null,skillExperience:so?.experience??null,gatherObjectId:near?.objectId||null,gatherObjectName:obj?resourceLabel(obj):null,gatherObjectPosition:obj?.position||null,swingsToGem,gatherTime:num(near?.time)});
    }
    const records=(snapshot?.gems||[]).map(g=>recByGem.get(g));
    for(const rec of records){const t=String(rec.typeId||'unknown');if(!byType.has(t))byType.set(t,[]);byType.get(t).push(rec);}
    state.gems=records;state.gemByType=byType;
  }

  function deriveXp(){
    const out={total:0,bySource:new Map(),byAmount:new Map(),recent:[]};
    for(const e of snapshot?.exp||[]){const amount=num(e.amount)||0;out.total+=amount;const k=e.sourceKind||e.source?.kind||'unknown';
      if(!out.bySource.has(k))out.bySource.set(k,{kind:k,events:0,total:0,min:null,max:null});const r=out.bySource.get(k);r.events++;r.total+=amount;r.min=r.min===null?amount:Math.min(r.min,amount);r.max=r.max===null?amount:Math.max(r.max,amount);
      const ak=String(amount);out.byAmount.set(ak,(out.byAmount.get(ak)||0)+1);
    }
    out.recent=(snapshot?.exp||[]).slice(0,25);state.xp=out;
  }


function deriveDrops(){
  const rows = Array.isArray(snapshot?.drops)?snapshot.drops:[];
  state.drops = rows;
  const agg = new Map();
  for(const d of rows){
    const elite = d.monsterElite===true;
    const sourceType = d.monsterTypeId ? `monster:${d.monsterTypeId}${elite?':elite':''}` : d.resourceTypeId ? `resource:${d.resourceTypeId}` : 'other:unknown';
    const key = `${sourceType}|${d.itemTypeId||'unknown'}`;
    if(!agg.has(key)) agg.set(key,{key,sourceType,itemTypeId:String(d.itemTypeId||'unknown'),monsterTypeId:d.monsterTypeId||null,resourceTypeId:d.resourceTypeId||null,monsterName:d.monsterName||null,elite,events:0,totalQty:0,minQty:null,maxQty:null,lastSeen:0,examples:[],enchants:{},qualities:{}});
    const r=agg.get(key); r.events++; const qty=Number(d.quantity||1)||1; r.totalQty += qty; r.minQty=r.minQty===null?qty:Math.min(r.minQty,qty); r.maxQty=r.maxQty===null?qty:Math.max(r.maxQty,qty); r.lastSeen=Math.max(r.lastSeen, num(d.time)||0); if(d.enchant)r.enchants[d.enchant]=(r.enchants[d.enchant]||0)+qty; if(d.quality)r.qualities[d.quality]=(r.qualities[d.quality]||0)+qty; if(r.examples.length<5) r.examples.push(d);
  }
  state.dropAgg = agg;
}
async function removeDropRow(row){
  if(!row)return;
  const label=(row.elite?'⭐ ':'')+(row.monsterName||row.monsterTypeId||row.resourceTypeId||'Unknown')+' → '+row.itemTypeId;
  if(!window.confirm(`Remove "${label}" (${row.events} record${row.events===1?'':'s'})? This can't be undone.`))return;
  try{
    await bridgeRequest('remove-drop-row',{itemTypeId:row.itemTypeId,monsterTypeId:row.monsterTypeId||null,resourceTypeId:row.resourceTypeId||null,elite:!!row.elite});
    await syncNow();
  }catch(err){setCollectorStatus('Collector: '+err.message);}
}
function deriveZones(){
  const zones=new Map();
  for(const z of snapshot?.zones||[]) zones.set(z.z, {...z});
  deriveDungeons(zones);   // groups rooms into dungeons and adds a zone for each room you only saw from a doorway
  const RECENT_ENTRANCE_SAMPLES=5;
  const averagePos=list=>{
    const recent=[...list].sort((a,b)=>(num(b.time)||0)-(num(a.time)||0)).slice(0,RECENT_ENTRANCE_SAMPLES);
    return {x:recent.reduce((a,t)=>a+t.atX,0)/recent.length,y:recent.reduce((a,t)=>a+t.atY,0)/recent.length};
  };
  const surfaceTransitionsByZone=new Map();
  const internalTransitionsByFromThenTo=new Map();
  for(const t of snapshot?.zoneTransitions||[]){
    if(t.toZ==null||t.atX==null||t.atY==null||(t.atX===0&&t.atY===0)||!zones.has(t.toZ))continue;   // 0,0 = no position was known
    if(t.fromZ==null||t.fromZ===0){
      if(!surfaceTransitionsByZone.has(t.toZ))surfaceTransitionsByZone.set(t.toZ,[]);
      surfaceTransitionsByZone.get(t.toZ).push(t);
    }else if(zones.has(t.fromZ)){
      if(!internalTransitionsByFromThenTo.has(t.fromZ))internalTransitionsByFromThenTo.set(t.fromZ,new Map());
      const byTo=internalTransitionsByFromThenTo.get(t.fromZ);
      if(!byTo.has(t.toZ))byTo.set(t.toZ,[]);
      byTo.get(t.toZ).push(t);
    }
  }
  // A login inside a zone (the first zone of a session, nothing before it) looks like a step in from outdoors but is
  // wherever you logged out - deep inside a mine, say. Those are left out. A zone with nothing else (entered by
  // walking in after being in another zone: the game never says you went outdoors, so the "from" is the last zone you
  // were in) takes the spot you arrive at most often - a doorway repeats, logins scatter.
  const allTrans=snapshot?.zoneTransitions||[];
  const zName=z=>String(zones.get(z)?.name||'').toLowerCase().trim();
  // a zone you renamed is a place of its own: never a room of a place with another name (the Plymouth Wharf bank and
  // fishing trainer next door had looked like one place from walking between them)
  // inside another room only when both share a name (rooms of one dungeon) and it was a real door between them
  const officialDungeon=z=>(D.pois||[]).some(p=>p.category==='dungeon'&&String(p.name).toLowerCase().trim()===zName(z));
  const insideOf=(fromZ,t)=>!!zName(fromZ)&&zName(fromZ)===zName(t.toZ)&&(officialDungeon(fromZ)||isDoorBetween(t));
  const firstOfSession=new Map();
  for(const t of allTrans){if(t.sessionId==null)continue;const f=firstOfSession.get(t.sessionId);if(!f||(num(t.time)||0)<(num(f.time)||0))firstOfSession.set(t.sessionId,t)}
  const isLogin=t=>t.fromZ==null&&firstOfSession.get(t.sessionId)===t;
  const commonSpot=list=>{
    const cells=new Map();
    for(const t of list){const k=Math.round(t.atX/4)+'|'+Math.round(t.atY/4);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(t)}
    const newest=l=>Math.max(...l.map(t=>num(t.time)||0));
    return averagePos([...cells.values()].sort((a,b)=>b.length-a.length||newest(b)-newest(a))[0]);
  };
  const entrances=new Map();
  for(const [z,list] of surfaceTransitionsByZone){
    const clean=list.filter(t=>!isLogin(t));
    const walkIns=clean.length?[]:allTrans.filter(t=>t.toZ===z&&t.fromZ!=null&&t.fromZ!==0&&t.atX!=null&&t.atY!=null&&(internalTransitionsByFromThenTo.get(t.fromZ)?.get(z)||[]).filter(u=>insideOf(t.fromZ,u)).length<2);
    // Two or more walk-ins arriving within 30 tiles of each other are a real doorway: they win over logins, which pile
    // up wherever you usually log out (inside the Titanium Mine, that outvoted the cave mouth). A single one may be a
    // teleport, so it only counts alongside the logins.
    const door=walkIns.filter(t=>!(t.atX===0&&t.atY===0)).map(t=>walkIns.filter(u=>Math.hypot(u.atX-t.atX,u.atY-t.atY)<=30)).sort((a,b)=>b.length-a.length)[0];
    const {x,y}=clean.length?averagePos(clean):door&&door.length>=2?averagePos(door):commonSpot([...list,...walkIns]);
    const lastSeen=list.reduce((m,t)=>Math.max(m,num(t.time)||0),0);
    entrances.set(z,{x,y,samples:list.length,lastSeen});
  }
  // Where you come back out of a place is its door on the outside map (the collector saves that from 2026-09-29, as
  // outX/outY): better than where you arrive inside, which only roughly lines up with the map. Only exits near the
  // estimate count, since one zone number can be several places. Manual placements still win (below).
  const outByZone=new Map();
  for(const t of allTrans){if(t.toZ!==0||num(t.outX)===null||num(t.outY)===null||!zones.has(t.fromZ))continue;(outByZone.get(t.fromZ)||outByZone.set(t.fromZ,[]).get(t.fromZ)).push({atX:t.outX,atY:t.outY,time:t.time})}
  for(const [z,list] of outByZone){
    const e=entrances.get(z),near=e?list.filter(p=>Math.hypot(p.atX-e.x,p.atY-e.y)<=25):list;
    if(!near.length)continue;
    const {x,y}=commonSpot(near);
    entrances.set(z,{...(e||{samples:0,lastSeen:0}),x,y,fromExits:near.length});
  }
  const internalExits=new Map();
  const parentCandidateByZone=new Map();
  for(const [fromZ,byTo] of internalTransitionsByFromThenTo){
    const exits=[];
    for(const [toZ,list] of byTo){
      const lastSeen=list.reduce((m,t)=>Math.max(m,num(t.time)||0),0);
      const bestSoFar=parentCandidateByZone.get(toZ);
      const inside=list.filter(t=>insideOf(fromZ,t)).length;
      if(inside&&(!bestSoFar||inside>bestSoFar.samples))parentCandidateByZone.set(toZ,{z:fromZ,samples:inside});
      // Where the way out sits in THIS zone: a transition's atX/atY is where you arrived, i.e. in the other zone's
      // space. Coming back the other way lands you right beside this door, in this zone's own space - so that is used
      // when there is one; otherwise the arrival, but only if it actually lies inside this zone (true of rooms that
      // share one map, like a dungeon's). A teleport or warp out (Titanium Mine -> Plymouth Wharf) has neither - it
      // is no door here, and placing it at the far-away arrival stretched the whole layout into a squiggle.
      const back=(internalTransitionsByFromThenTo.get(toZ)?.get(fromZ)||[]).filter(t=>inAnyArea(fromZ,{x:t.atX,y:t.atY}));
      const ahead=averagePos(list);
      const raw=back.length?averagePos(back):inAnyArea(fromZ,ahead)?ahead:null;
      const pos=raw&&snapExit(fromZ,raw);
      if(pos)exits.push({toZ,x:pos.x,y:pos.y,samples:list.length,lastSeen});
    }
    internalExits.set(fromZ,exits);
  }
  // A way between two places recorded in one direction only (down Midland Mine's pit into Agauton Mine, never back up
  // its ladder): on the far side it is the door, ladder or pit right where you arrive; on this side, the one door,
  // ladder or pit that no arrival from anywhere else sits beside. Needs two crossings, and a real object on each side.
  const portalsByZ=new Map();for(const o of snapshot?.worldObjects||[]){const z=o.position?.z;if(z==null||!PORTAL_OBJ_RE.test(o.typeId||'')||isGroundItem(o))continue;(portalsByZ.get(z)||portalsByZ.set(z,[]).get(z)).push(o)}
  const portalsIn=z=>portalsByZ.get(z)||[];
  // (never a door people walk in by from outdoors: arriving there after a teleport home or an unseen walk across town is no passage)
  const walkInDoor=(z,o)=>allTrans.some(t=>t.toZ===z&&(t.fromZ===0||(t.fromZ==null&&!isLogin(t)))&&t.atX!=null&&t.atY!=null&&Math.hypot(t.atX-o.position.x,t.atY-o.position.y)<=4);
  for(const [fromZ,byTo] of internalTransitionsByFromThenTo)for(const [toZ,list] of byTo){
    if(list.length<2||internalTransitionsByFromThenTo.get(toZ)?.has(fromZ))continue;
    const lastSeen=list.reduce((m,t)=>Math.max(m,num(t.time)||0),0);
    const there=internalExits.get(toZ)||[];let farSide=there.some(ex=>ex.toZ===fromZ);
    if(!farSide){
      const door=portalsIn(toZ).filter(o=>!walkInDoor(toZ,o)).map(o=>({o,d:Math.min(...list.map(t=>Math.hypot(t.atX-o.position.x,t.atY-o.position.y)))})).filter(x=>x.d<=6).sort((a,b)=>a.d-b.d)[0];
      if(door){there.push({toZ:fromZ,x:door.o.position.x,y:door.o.position.y,samples:list.length,lastSeen,oneWay:true});internalExits.set(toZ,there);farSide=true}
    }
    if(!farSide)continue;   // no door where you came out: a warp, not a passage
    const here=internalExits.get(fromZ)||[];
    if(!here.some(ex=>ex.toZ===toZ)){
      const arrivals=allTrans.filter(t=>t.toZ===fromZ&&t.fromZ!==toZ&&t.atX!=null&&t.atY!=null);
      const free=portalsIn(fromZ).filter(o=>!walkInDoor(fromZ,o)).filter(o=>!arrivals.some(t=>Math.hypot(t.atX-o.position.x,t.atY-o.position.y)<=6)&&!here.some(ex=>Math.hypot(ex.x-o.position.x,ex.y-o.position.y)<=2));
      if(free.length===1){here.push({toZ,x:free[0].position.x,y:free[0].position.y,samples:list.length,lastSeen,oneWay:true});internalExits.set(fromZ,here)}
    }
  }
  // Which door is which, room by room (checked against every dungeon on 2026-09-30):
  // 1) Rooms of one dungeon share one map, so a door and the door it leads to stand one each side of the wall: a
  //    plain door and a dark doorway (or a ladder, hatch or pit) 2-3 tiles apart. Two plain doors that close are
  //    stacked levels of a mine (Rustpick), not a pair.
  // 2) You arrive right beside the door that leads back: arrivals from one room that keep landing on a still-free
  //    door settle it (unless arrivals from elsewhere land there too - then it is the room's spawn spot).
  // 3) Facing doors set further apart (Moonfang's Lair: up to 12 tiles), only ways walked twice or more.
  // Each door is one way only, and the door you come in by from outdoors is never taken.
  {
    const setExit=(z,toZ,o,samples,lastSeen,how)=>{const list=internalExits.get(z)||[];const ex=list.find(e=>e.toZ===toZ);if(ex){if(ex.faced)return false;ex.x=o.position.x;ex.y=o.position.y;ex.faced=true;ex.how=how}else list.push({toZ,x:o.position.x,y:o.position.y,samples,lastSeen,faced:true,how});internalExits.set(z,list);return true};
    const isFaced=(z,toZ)=>!!(internalExits.get(z)||[]).find(e=>e.toZ===toZ&&e.faced);
    const pairSeen=new Map();
    for(const [a,byTo] of internalTransitionsByFromThenTo)for(const [b,list] of byTo){if(a===b)continue;const k=a<b?a+'|'+b:b+'|'+a,p=pairSeen.get(k)||{n:0,lastSeen:0};p.n+=list.length;p.lastSeen=Math.max(p.lastSeen,...list.map(t=>num(t.time)||0));pairSeen.set(k,p)}
    const outdoorDoor=new Set();
    // doors you walk in by from outdoors (a login, with no zone before it, lands anywhere and does not count)
    for(const t of allTrans){if(!(t.fromZ===0||(t.fromZ==null&&!isLogin(t)))||t.atX==null||t.atY==null||!t.toZ)continue;
      for(const o of portalsIn(t.toZ))if(Math.hypot(o.position.x-t.atX,o.position.y-t.atY)<=4)outdoorDoor.add(o)}
    const used=new Set(),done=new Set();
    const free=o=>!used.has(o)&&!outdoorDoor.has(o);
    const pairUp=list=>{for(const c of list.sort((p,q)=>p.d-q.d)){
      if(done.has(c.k)||(used.has(c.pa)&&!onIt(c.a,c.b,c.pa))||(used.has(c.pb)&&!onIt(c.b,c.a,c.pb))||(isFaced(c.a,c.b)&&isFaced(c.b,c.a)))continue;
      const p=pairSeen.get(c.k);setExit(c.a,c.b,c.pa,p.n,p.lastSeen,'facing');setExit(c.b,c.a,c.pb,p.n,p.lastSeen,'facing');used.add(c.pa);used.add(c.pb);done.add(c.k);
    }};
    // a side already settled offers only its own door; an unsettled side, its free doors
    const onIt=(z,toZ,o)=>!!(internalExits.get(z)||[]).find(e=>e.toZ===toZ&&e.faced&&e.x===o.position.x&&e.y===o.position.y);
    const doorsFor=(z,toZ)=>{const ex=(internalExits.get(z)||[]).find(e=>e.toZ===toZ&&e.faced);return ex?portalsIn(z).filter(o=>o.position.x===ex.x&&o.position.y===ex.y):portalsIn(z).filter(free)};
    // Rooms stacked on the same spot of the map (Rustpick Mine, Moonfang's Lair, Trollbarrow: levels you climb
    // between) put doors near each other by chance, so facing only counts between rooms that sit side by side.
    const boxAt=(z,o)=>zoneAreas(z)[placeIndexAt(z,o.position)]||null;
    const stacked=(a,pa,b,pb)=>{const A=boxAt(a,pa),B=boxAt(b,pb);if(!A||!B)return false;const w=Math.min(A.maxX,B.maxX)-Math.max(A.minX,B.minX),h=Math.min(A.maxY,B.maxY)-Math.max(A.minY,B.minY);if(w<=0||h<=0)return false;return w*h>0.25*Math.min((A.maxX-A.minX)*(A.maxY-A.minY),(B.maxX-B.minX)*(B.maxY-B.minY))};
    const facing=(maxD,minN,ok)=>{const out=[];for(const [k,p] of pairSeen){if(done.has(k)||p.n<minN)continue;const [a,b]=k.split('|').map(Number);for(const pa of doorsFor(a,b))for(const pb of doorsFor(b,a)){const d=Math.hypot(pa.position.x-pb.position.x,pa.position.y-pb.position.y);if(d<=maxD&&ok(pa,pb)&&!stacked(a,pa,b,pb))out.push({a,b,pa,pb,d,k})}}return out};
    pairUp(facing(3.5,1,(pa,pb)=>pa.typeId!==pb.typeId));
    const claims=[];
    for(const [a,byTo] of internalTransitionsByFromThenTo)for(const [b,list] of byTo){
      if(a===b||isFaced(b,a))continue;const pts=list.filter(t=>t.atX!=null&&t.atY!=null);if(!pts.length)continue;
      const p=commonSpot(pts);let best=null;for(const o of portalsIn(b)){const d=Math.hypot(o.position.x-p.x,o.position.y-p.y);if(d<=5&&(!best||d<best.d))best={o,d}}
      if(best)claims.push({z:b,toZ:a,o:best.o,n:pts.length,lastSeen:pts.reduce((m,t)=>Math.max(m,num(t.time)||0),0)});
    }
    const claimedBy=new Map();for(const c of claims)(claimedBy.get(c.o)||claimedBy.set(c.o,[]).get(c.o)).push(c);
    for(const [o,cs] of claimedBy){if(cs.length!==1||!free(o))continue;const c=cs[0];if(setExit(c.z,c.toZ,o,c.n,c.lastSeen,'arrival'))used.add(o)}
    pairUp(facing(12,2,()=>true));
    // A way still off any door goes to the nearest free door in its room (10 tiles at most, nearest first).
    const offs=[];
    for(const [z,list] of internalExits)for(const ex of list){
      if(ex.faced||portalsIn(z).some(o=>Math.hypot(o.position.x-ex.x,o.position.y-ex.y)<=1))continue;
      for(const o of portalsIn(z).filter(free)){const d=Math.hypot(o.position.x-ex.x,o.position.y-ex.y);if(d<=10)offs.push({ex,o,d})}
    }
    const moved=new Set();
    for(const c of offs.sort((p,q)=>p.d-q.d)){if(moved.has(c.ex)||used.has(c.o))continue;c.ex.x=c.o.position.x;c.ex.y=c.o.position.y;moved.add(c.ex);used.add(c.o)}
    // A room whose every door is spoken for has no room for a stray way off the doors crossed once (Ogre Cove's
    // "door" to a room it has no door to).
    for(const [z,list] of internalExits){
      const ports=portalsIn(z);if(!ports.length||ports.some(o=>!used.has(o)&&!outdoorDoor.has(o)&&!list.some(ex=>Math.hypot(o.position.x-ex.x,o.position.y-ex.y)<=1)))continue;
      const keep=list.filter(ex=>(ex.samples||0)>1||ports.some(o=>Math.hypot(o.position.x-ex.x,o.position.y-ex.y)<=1)||(internalExits.get(ex.toZ)||[]).some(e=>e.toZ===z));
      if(keep.length!==list.length)internalExits.set(z,keep);
    }
    // A way into a different place (another cave or building, not a room of this one) has to be a real passage:
    // crossed at least twice that way, on a door that is not the one you walk in by from outdoors. Otherwise it is a
    // walk outdoors the collector did not see (Sunken Trove "to" Plymouth Wharf's bank) or a teleport. Facing doors
    // and the one-way links above (Midland Mine's pit) count as passages.
    const placeOf=z=>zones.get(z)?.name||String(z);
    for(const [z,list] of internalExits){
      const keep=list.filter(ex=>{
        if(placeOf(ex.toZ)===placeOf(z)||ex.how==='facing'||ex.oneWay)return true;
        const n=internalTransitionsByFromThenTo.get(z)?.get(ex.toZ)?.length||0,o=portalsIn(z).find(o=>Math.hypot(o.position.x-ex.x,o.position.y-ex.y)<=1);
        return n>=2&&!!o&&!outdoorDoor.has(o);
      });
      if(keep.length!==list.length)internalExits.set(z,keep);
    }
    // One door, one way: a door claimed by facing another keeps only that way. Otherwise, when several ways land on
    // one door, one walked three times as often as the rest keeps it; the rest are warps, logins or deaths on the way
    // (Binxonia Bank's door "leading" to a dozen places).
    for(const [z,list] of internalExits){
      const onDoor=ex=>portalsIn(z).find(o=>Math.hypot(o.position.x-ex.x,o.position.y-ex.y)<=1);
      const byDoor=new Map();for(const ex of list){const o=onDoor(ex);if(o)(byDoor.get(o)||byDoor.set(o,[]).get(o)).push(ex)}
      const drop=new Set();
      for(const group of byDoor.values()){
        if(group.length<2)continue;
        const faced=group.filter(e=>e.faced);
        if(faced.length){for(const e of group)if(!e.faced)drop.add(e);continue}
        const top=Math.max(...group.map(e=>e.samples||0));
        for(const e of group)if((e.samples||0)*3<=top)drop.add(e);
      }
      if(drop.size)internalExits.set(z,list.filter(e=>!drop.has(e)));
    }
  }
  // A dungeon's list of doors between its rooms keeps only the ways the check above kept (one crossing after a
  // teleport or a death is not a door).
  for(const g of state.dungeons?.values()||[])g.doors=g.doors.filter(d=>(internalExits.get(d.a)||[]).some(e=>e.toZ===d.b)||(internalExits.get(d.b)||[]).some(e=>e.toZ===d.a));
  const MIN_PARENT_SAMPLES=2;
  const parentByZone=new Map([...parentCandidateByZone].filter(([,v])=>v.samples>=MIN_PARENT_SAMPLES).map(([toZ,v])=>[toZ,v.z]));
  for(const [z,meta] of zones){
    if(meta.parentOverride===undefined)continue;
    if(meta.parentOverride.z==null)parentByZone.delete(z);
    else parentByZone.set(z,meta.parentOverride.z);
  }
  for(const [z,p] of [...parentByZone]){
    if(parentByZone.get(p)!==z)continue;
    const zManual=zones.get(z)?.parentOverride?.z===p;
    const pManual=zones.get(p)?.parentOverride?.z===z;
    if(pManual&&!zManual)parentByZone.delete(z);
    else parentByZone.delete(p);
  }
  for(const [z,meta] of zones){
    if(!meta.entranceOverride||!Number.isFinite(meta.entranceOverride.x)||!Number.isFinite(meta.entranceOverride.y))continue;
    if(parentByZone.has(z))continue;
    const prev=entrances.get(z);
    entrances.set(z,{x:meta.entranceOverride.x,y:meta.entranceOverride.y,samples:prev?.samples||0,lastSeen:prev?.lastSeen||meta.lastSeen||0,manual:true});
  }
  for(const z of parentByZone.keys())entrances.delete(z);
  // A dungeon you walked into from a named place (a wharf, a town) rather than straight from the outdoors has no
  // "surface" entry above. Its entrance is where you stood when you first stepped from outside into any of its rooms.
  for(const g of state.dungeons?.values()||[]){
    const members=new Set(g.rooms.map(r=>r.z));
    if(g.rooms.some(r=>entrances.has(r.z)||parentByZone.has(r.z)))continue;
    for(const room of g.rooms){
      const list=(snapshot?.zoneTransitions||[]).filter(t=>t.toZ===room.z&&t.fromZ!=null&&t.fromZ!==0&&!members.has(t.fromZ)&&t.atX!=null&&t.atY!=null);
      if(!list.length)continue;
      const {x,y}=averagePos(list);
      entrances.set(room.z,{x,y,samples:list.length,lastSeen:list.reduce((m,t)=>Math.max(m,num(t.time)||0),0)});
      break;
    }
  }
  // Every place gets one marker. A place is a zone, or a dungeon: all rooms sharing a name. One still without an
  // entrance - reached only by walking in after another zone (Agauton Mine, Willow Downs), or a dungeon whose every
  // room reads as inside another of its rooms from walking back and forth (Rustpick Mine, Moonfang's Lair) - takes,
  // in order: the spot you placed by hand, a clean step in from outdoors, two or more walk-ins that agree, then any
  // arrival at all. Skipped only when it really is a room of a different place.
  {
    const groups=new Map();
    // a place = one dungeon (connected rooms sharing a name) or one building on its own - not every zone with that name
    for(const z of zones.keys()){const n=state.dungeonOfZone?.get(z)??('z'+z);if(!groups.has(n))groups.set(n,[]);groups.get(n).push(z)}
    for(const members of groups.values()){
      if(members.some(z=>entrances.has(z)))continue;
      const set=new Set(members);
      if(members.some(z=>parentByZone.has(z)&&!set.has(parentByZone.get(z))))continue;
      const manual=members.map(z=>zones.get(z)).find(m=>m&&m.entranceOverride&&Number.isFinite(m.entranceOverride.x)&&Number.isFinite(m.entranceOverride.y));
      if(manual){entrances.set(manual.z,{x:manual.entranceOverride.x,y:manual.entranceOverride.y,samples:0,lastSeen:manual.lastSeen||0,manual:true});continue}
      const into=allTrans.filter(t=>set.has(t.toZ)&&!set.has(t.fromZ)&&t.atX!=null&&t.atY!=null&&!(t.atX===0&&t.atY===0));
      if(!into.length)continue;
      const clean=into.filter(t=>(t.fromZ==null||t.fromZ===0)&&!isLogin(t));
      const walk=into.filter(t=>t.fromZ!=null&&t.fromZ!==0);
      const door=walk.map(t=>walk.filter(u=>Math.hypot(u.atX-t.atX,u.atY-t.atY)<=30)).sort((a,b)=>b.length-a.length)[0];
      const chosen=clean.length?clean:door&&door.length>=2?door:into;
      const {x,y}=chosen===into?commonSpot(into):averagePos(chosen);
      entrances.set(chosen[0].toZ,{x,y,samples:chosen.length,lastSeen:chosen.reduce((m,t)=>Math.max(m,num(t.time)||0),0)});
    }
  }
  // One entrance per place: the rooms of one dungeon (state.dungeonOfZone) can each collect their own - logins inside
  // different rooms gave Sunken Trove two markers. Keep the best: the spot you placed by hand, else the one with the
  // most visits, else the most recent.
  {
    const best=new Map(),score=e=>(e.manual?1e9:0)+(e.samples||0);
    for(const [z,e] of entrances){
      const k=state.dungeonOfZone?.get(z);if(k==null)continue;
      const b=best.get(k);
      if(!b||score(e)>score(b.e)||(score(e)===score(b.e)&&(e.lastSeen||0)>(b.e.lastSeen||0))){if(b)entrances.delete(b.z);best.set(k,{z,e})}
      else entrances.delete(z);
    }
  }
  state.areaEntrances=[];   // (one place per zone now - see splitPlaces)
  // The way back outdoors from each place: the door, ladder or hole you are seen walking in by (a login does not
  // count); in an entrance room with none seen, the free door, ladder or hole nearest its entrance.
  const surfaceExits=new Map();
  {
    const walkIns=allTrans.filter(t=>(t.fromZ===0||(t.fromZ==null&&!isLogin(t)))&&t.toZ&&t.atX!=null&&t.atY!=null&&!(t.atX===0&&t.atY===0));
    for(const z of zones.keys()){
      if(!z)continue;const ports=portalsIn(z);if(!ports.length)continue;
      const linked=o=>(internalExits.get(z)||[]).some(ex=>Math.hypot(ex.x-o.position.x,ex.y-o.position.y)<=1);
      const areas=zoneAreas(z),out=[];
      for(let i=0;i<Math.max(1,areas.length);i++){
        const here=ports.filter(o=>areas.length<2||placeIndexAt(z,o.position)===i).filter(o=>!linked(o));if(!here.length)continue;
        const e=i===0?entrances.get(z):state.areaEntrances.find(ae=>ae.z===z&&ae.area===i);
        const seen=here.map(o=>({o,n:walkIns.filter(t=>t.toZ===z&&Math.hypot(t.atX-o.position.x,t.atY-o.position.y)<=5).length})).filter(x=>x.n>=(e?1:2)).sort((p,q)=>q.n-p.n)[0];
        let pick=seen?.o;
        if(!pick&&e){
          pick=here.map(o=>({o,d:Math.hypot(o.position.x-e.x,o.position.y-e.y)})).filter(x=>x.d<=15).sort((p,q)=>p.d-q.d)[0]?.o;
        }
        if(pick)out.push({toZ:0,fromZ:z,x:pick.position.x,y:pick.position.y,area:i,surface:true,samples:seen?.n||0,lastSeen:0});
      }
      if(out.length)surfaceExits.set(z,out);
    }
  }
  state.zoneSurfaceExits=surfaceExits;
  // In a dungeon, "back" means toward the way in: each room's parent is the room before it on the shortest walk from
  // the entrance room (the one with the way outside), not a guess from where people arrived - that had Ogre Cove's
  // entrance room leading "back" deeper in. A parent you set by hand still wins.
  for(const g of state.dungeons?.values()||[]){
    const members=new Set(g.rooms.map(r=>r.z)),start=g.rooms.find(r=>surfaceExits.has(r.z))||g.rooms.find(r=>entrances.has(r.z));
    if(!start)continue;
    const byHand=z=>zones.get(z)?.parentOverride!==undefined;
    if(!byHand(start.z))parentByZone.delete(start.z);
    const seen=new Set([start.z]),queue=[start.z];
    while(queue.length){const a=queue.shift();for(const ex of internalExits.get(a)||[]){if(!members.has(ex.toZ)||seen.has(ex.toZ))continue;seen.add(ex.toZ);if(!byHand(ex.toZ))parentByZone.set(ex.toZ,a);queue.push(ex.toZ)}}
  }
  const contents=new Map();
  const ensure=z=>{if(!contents.has(z))contents.set(z,{monsters:new Map(),objects:new Map()});return contents.get(z)};
  for(const o of snapshot?.npcObservations||[]){
    const z=o.position?.z; if(z==null||!zones.has(z))continue;
    const m=ensure(z).monsters; const id=String(o.typeId||o.name||'unknown');
    const r=m.get(id)||{count:0,lastSeen:0,name:o.name||id}; r.count++; r.lastSeen=Math.max(r.lastSeen,num(o.time)||0); m.set(id,r);
  }
  for(const o of snapshot?.worldObjects||[]){
    const z=o.position?.z; if(z==null||!zones.has(z))continue;
    const skill=state.objectSkillByType?.get(o.typeId);
    if(!skill)continue;
    const m=ensure(z).objects; const key=resourceKeyFor(o);
    const yieldItem=state.resourceYieldByObjectId?.get(o.id)||null;
    const r=m.get(key)||{count:0,lastSeen:0,name:o.name||o.typeId,yieldItem}; r.count++; r.lastSeen=Math.max(r.lastSeen,num(o.lastSeen)||0); m.set(key,r);
  }
  state.zones=zones; state.zoneEntrances=entrances; state.zoneContents=contents;
  // A dungeon nobody has been seen walking through yet (Imp Tree: its rooms are known from their floors and the game's
  // marker): its doors from what stands in its rooms - a door and a dark doorway (or ladder, hatch, pit) facing each
  // other across two rooms link them - and the door, ladder or hole left over nearest the dungeon's marker is the way out.
  for(const g of state.dungeons?.values()||[]){
    const rooms=g.rooms,members=new Set(rooms.map(r=>r.z));
    if(rooms.length<2||rooms.some(r=>(internalExits.get(r.z)||[]).some(ex=>members.has(ex.toZ))))continue;
    const usedP=new Set(),cands=[];
    for(let x=0;x<rooms.length;x++)for(let y=x+1;y<rooms.length;y++)for(const pa of portalsIn(rooms[x].z))for(const pb of portalsIn(rooms[y].z)){const d=Math.hypot(pa.position.x-pb.position.x,pa.position.y-pb.position.y);if(d<=3.5&&pa.typeId!==pb.typeId)cands.push({x,y,pa,pb,d})}
    const addExit=(r,to,o)=>{const l=internalExits.get(r.z)||[];if(!l.some(e=>e.x===o.position.x&&e.y===o.position.y))l.push({toZ:to.z,x:o.position.x,y:o.position.y,samples:0,lastSeen:0,faced:true,how:'facing'});internalExits.set(r.z,l)};
    for(const c of cands.sort((a,b)=>a.d-b.d)){
      if(usedP.has(c.pa)||usedP.has(c.pb))continue;usedP.add(c.pa);usedP.add(c.pb);
      const A=rooms[c.x],B=rooms[c.y];addExit(A,B,c.pa);addExit(B,A,c.pb);
      if(!g.doors.some(d=>(d.a===A.z&&d.b===B.z)||(d.a===B.z&&d.b===A.z)))g.doors.push({a:Math.min(A.z,B.z),b:Math.max(A.z,B.z),x:(c.pa.position.x+c.pb.position.x)/2,y:(c.pa.position.y+c.pb.position.y)/2,samples:0,lastSeen:0});
    }
    const poi=(D.pois||[]).find(p=>p.category==='dungeon'&&String(p.name).toLowerCase().trim()===String(g.name).toLowerCase().trim());
    if(!poi||rooms.some(r=>surfaceExits.has(r.z)))continue;
    const out=rooms.flatMap(r=>portalsIn(r.z).filter(o=>!usedP.has(o)).map(o=>({r,o,d:Math.hypot(o.position.x-poi.x,o.position.y-poi.y)}))).sort((a,b)=>a.d-b.d)[0];
    if(out&&out.d<=30)surfaceExits.set(out.r.z,[{toZ:0,fromZ:out.r.z,x:out.o.position.x,y:out.o.position.y,area:0,surface:true,samples:0,lastSeen:0}]);
    // ...and the walk from that room inward sets each room's way back
    const start=out&&out.d<=30?out.r.z:null;if(start==null)continue;
    const seen=new Set([start]),queue=[start];
    while(queue.length){const a=queue.shift();for(const ex of internalExits.get(a)||[]){if(!members.has(ex.toZ)||seen.has(ex.toZ))continue;seen.add(ex.toZ);if(zones.get(ex.toZ)?.parentOverride===undefined)parentByZone.set(ex.toZ,a);queue.push(ex.toZ)}}
  }
  state.zoneInternalExits=internalExits; state.zoneParent=parentByZone;
}
// ---- Dungeons and their rooms ----------------------------------------------------------------------------------
// A dungeon is a set of zones, one per room, that share a name and one coordinate space (the rooms tile a single
// map). The game only names a zone once you walk in, but the floors of the rooms next to the one you are in are
// streamed to you first, so a room you have only glimpsed has terrain and no zone record. Such a room is added to
// the dungeon it touches (its floor bounds meet those of a room you entered) as a "not entered" room. Doors are
// the crossings the collector already logs between two rooms.
const ROOM_TOUCH_GAP=3;
// A real door between two rooms: you arrive at (within 12 tiles of) the floor of the room you left - a dungeon's rooms
// share one map. Walking out of one building and into another shows up as the same "from -> to", but arrives far from
// the first building's floor. A room with no floor recorded yet gets the benefit of the doubt.
function isDoorBetween(t){
  if(t.fromZ==null||t.toZ==null||t.atX==null||t.atY==null||(t.atX===0&&t.atY===0))return false;
  const b=terrainBoundsForZone(t.fromZ);if(!b)return true;
  return t.atX>=b.minX-12&&t.atX<=b.maxX+12&&t.atY>=b.minY-12&&t.atY<=b.maxY+12;
}
function deriveDungeons(zones){
  const dungeons=new Map(),of=new Map();
  const byName=new Map();
  for(const [z,m] of zones){
    if(z===0||m.manual)continue;   // a hand-placed marker is not a room
    const n=String(m.name||'').trim().toLowerCase();
    if(!n)continue;
    if(!byName.has(n))byName.set(n,[]);
    byName.get(n).push(z);
  }
  const boundsCache=new Map();
  const bnd=z=>{if(!boundsCache.has(z))boundsCache.set(z,terrainBoundsForZone(z));return boundsCache.get(z)};
  const touches=(a,b)=>{const A=bnd(a),B=bnd(b);return !!A&&!!B&&A.minX<=B.maxX+ROOM_TOUCH_GAP&&B.minX<=A.maxX+ROOM_TOUCH_GAP&&A.minY<=B.maxY+ROOM_TOUCH_GAP&&B.minY<=A.maxY+ROOM_TOUCH_GAP};
  // rooms with floors but no zone record, and which named place each one belongs to (the one it touches most)
  const terrainOnly=new Set();
  for(const r of snapshot?.terrain||[])if(r.z<0&&!zones.has(r.z))terrainOnly.add(r.z);
  // A glimpsed room joins the place it touches most; rooms chain, so one that only touches another glimpsed room
  // joins on a later pass.
  const ownerOf=new Map(),grown=new Map([...byName].map(([n,zs])=>[n,[...zs]])),pending=new Set(terrainOnly);
  for(let pass=0,changed=true;changed&&pass<25;pass++){
    changed=false;
    for(const z of [...pending]){
      let best=null,bestN=0;
      for(const [n,ms] of grown){const c=ms.filter(r=>touches(z,r)).length;if(c>bestN){best=n;bestN=c}}
      if(best){grown.get(best).push(z);ownerOf.set(z,best);pending.delete(z);changed=true}
    }
  }
  const transitions=snapshot?.zoneTransitions||[];
  // One dungeon = rooms with the same name that are really connected: a door you went through (you arrive at the
  // edge of the room you left - rooms of a dungeon share their map) or floors that touch. Same-named buildings you
  // walked between outdoors (the three "Binxonia" houses) are separate places, not rooms of one.
  const groups=[];
  for(const [n,zs] of byName){
    const all=[...zs,...[...ownerOf].filter(([,o])=>o===n).map(([z])=>z)];
    const link=new Map(all.map(z=>[z,new Set()]));
    for(const t of transitions)if(link.has(t.fromZ)&&link.has(t.toZ)&&t.fromZ!==t.toZ&&isDoorBetween(t)){link.get(t.fromZ).add(t.toZ);link.get(t.toZ).add(t.fromZ)}
    for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)if(touches(all[i],all[j])){link.get(all[i]).add(all[j]);link.get(all[j]).add(all[i])}
    // a dungeon on the official map keeps all its rooms together even when they sit apart (Sun King's Tomb)
    if((D.pois||[]).some(p=>p.category==='dungeon'&&String(p.name).toLowerCase().trim()===n))for(let i=1;i<all.length;i++){link.get(all[0]).add(all[i]);link.get(all[i]).add(all[0])}
    const seen=new Set();let k=0;
    for(const z of all){
      if(seen.has(z))continue;
      const comp=[],st=[z];seen.add(z);
      while(st.length){const c=st.pop();comp.push(c);for(const w of link.get(c))if(!seen.has(w)){seen.add(w);st.push(w)}}
      groups.push([n,comp.filter(x=>zs.includes(x)),comp.filter(x=>!zs.includes(x)),k++]);
    }
  }
  for(const [n,zs,extra,k] of groups){
    if(!zs.length||zs.length+extra.length<2)continue;
    const members=[...zs,...extra];
    const key='d:'+n+(k?':'+k:'');
    const firstSeen=z=>{const m=zones.get(z);return m&&!m.synthetic?(num(m.firstSeen)||num(m.lastSeen)||0):Infinity};
    members.sort((a,b)=>{const fa=firstSeen(a),fb=firstSeen(b);if(fa===fb)return b-a;return fa<fb?-1:1});
    const displayName=zones.get(zs[0])?.name||n;
    const visits=new Map();
    for(const t of transitions)if(t.toZ!=null&&members.includes(t.toZ))visits.set(t.toZ,(visits.get(t.toZ)||0)+1);
    const rooms=members.map((z,i)=>({z,label:'Room '+(i+1),entered:!extra.includes(z),visits:visits.get(z)||0}));
    // synthetic zone records so the rest of the Atlas (cards, layouts, contents) treats an unentered room like any other
    for(const z of extra){
      let last=0;for(const r of snapshot?.terrain||[])if(r.z===z)last=Math.max(last,num(r.lastSeen)||0);
      zones.set(z,{z,name:displayName,pvpMode:null,firstSeen:null,lastSeen:last,synthetic:true});
    }
    const doorMap=new Map();
    for(const t of transitions){
      if(t.fromZ==null||t.toZ==null||t.fromZ===t.toZ||t.atX==null||t.atY==null)continue;
      if(!members.includes(t.fromZ)||!members.includes(t.toZ))continue;
      const a=Math.min(t.fromZ,t.toZ),b=Math.max(t.fromZ,t.toZ),k=a+'|'+b;
      if(!doorMap.has(k))doorMap.set(k,{a,b,list:[]});
      doorMap.get(k).list.push(t);
    }
    const doors=[...doorMap.values()].map(d=>{
      const recent=[...d.list].sort((p,q)=>(num(q.time)||0)-(num(p.time)||0)).slice(0,5);
      return {a:d.a,b:d.b,samples:d.list.length,x:recent.reduce((s,t)=>s+t.atX,0)/recent.length,y:recent.reduce((s,t)=>s+t.atY,0)/recent.length,lastSeen:d.list.reduce((m,t)=>Math.max(m,num(t.time)||0),0)};
    });
    dungeons.set(key,{key,name:displayName,rooms,doors});
    for(const z of members)of.set(z,key);
  }
  state.dungeons=dungeons;state.dungeonOfZone=of;
}
function roomLabelFor(z){
  const key=state.dungeonOfZone?.get(z);if(key==null)return null;
  const g=state.dungeons.get(key);const r=g&&g.rooms.find(x=>x.z===z);
  return r?r.label:null;
}
// a dungeon room is a whole zone, or one area of a zone (a dungeon recorded under other places' numbers)
function roomHas(r,p){return r.area==null||!p||inArea(zoneAreas(r.z)[r.area],p)}
function roomContents(r){
  if(r.area==null)return state.zoneContents?.get(r.z)||{monsters:new Map(),objects:new Map()};
  const monsters=new Map(),objects=new Map();
  for(const o of snapshot?.npcObservations||[])if(o.position?.z===r.z&&roomHas(r,o.position))monsters.set(String(o.typeId||o.name),1);
  for(const o of snapshot?.worldObjects||[])if(o.position?.z===r.z&&roomHas(r,o.position)&&state.objectSkillByType?.get(o.typeId))objects.set(o.typeId,1);
  return {monsters,objects};
}
const roomAttrs=(r,attr)=>`${attr}="${r.z}"${r.area!=null?` data-room-area="${r.area}"`:''}`;
// Who is in a place (whole zones, or areas of one): the level range of its monsters, and - when it has none, a
// building - the people in it. idx is built once per page (observations and NPCs by zone).
function placeLifeIndex(){
  const obs=new Map(),people=new Map(),friendly=new Set();
  for(const n of snapshot?.npcs||[]){if(n.faction==='friendly'){friendly.add(String(n.id));const z=n.position?.z;if(z!=null&&n.name)(people.get(z)||people.set(z,[]).get(z)).push(n)}}
  for(const o of snapshot?.npcObservations||[]){const z=o.position?.z;if(z==null||friendly.has(String(o.id)))continue;(obs.get(z)||obs.set(z,[]).get(z)).push(o)}
  return {obs,people};
}
function placeLife(idx,rooms){
  let lo=Infinity,hi=-Infinity;const names=new Set();
  for(const r of rooms){
    for(const o of idx.obs.get(r.z)||[]){if(!roomHas(r,o.position))continue;const lv=num(o.level);if(lv!=null){lo=Math.min(lo,lv);hi=Math.max(hi,lv)}}
    for(const n of idx.people.get(r.z)||[])if(roomHas(r,n.position))names.add(n.name);
  }
  if(Number.isFinite(lo))return 'Monsters Lv '+(lo===hi?lo:lo+'–'+hi);
  const p=[...names].sort();return p.length?p.slice(0,3).map(esc).join(', ')+(p.length>3?' and '+(p.length-3)+' more':''):'';
}
function dungeonCardHtml(g,idx){
  const entered=g.rooms.filter(r=>r.entered).length;
  const last=g.rooms.reduce((m,r)=>Math.max(m,num(state.zones.get(r.z)?.lastSeen)||0),0);
  const mon=new Set(),res=new Set();
  for(const r of g.rooms){const c=roomContents(r);if(c){for(const k of c.monsters.keys())mon.add(k);for(const k of c.objects.keys())res.add(k)}}
  const meta=[fmt(g.rooms.length)+' room'+(g.rooms.length===1?'':'s'),placeLife(idx||placeLifeIndex(),g.rooms),res.size?fmt(res.size)+' resource'+(res.size===1?'':'s'):''].filter(Boolean).join(' · ');
  // the card itself goes to the dungeon on the map: the game's marker, else its entrance room
  const poi=(D.pois||[]).find(p=>p.category==='dungeon'&&String(p.name).toLowerCase()===String(g.name).toLowerCase());
  const entRoom=g.rooms.find(r=>state.zoneEntrances?.has(r.z))||g.rooms[0];
  const mapAt=poi?`data-card-map="place" data-card-map-id="${esc(poi.name)}"`:`data-card-map="zone" data-card-map-id="${entRoom.z}"`;
  return `<div class="card zn-card dungeoncard" ${mapAt} title="Show it on the map"><div class="zn-kicker">Dungeon</div><div class="zn-name">${esc(g.name)}</div>${g.rooms[0]?zoneQuestNote(g.rooms[0].z):''}<div class="zn-meta">${meta}${PUBLIC_MODE?'':' · last seen '+when(last)}</div>`
   +`<div class="zn-rooms">${g.rooms.map(r=>`<button type="button" class="roomlink-btn zn-room" ${roomAttrs(r,'data-zone')} title="${esc(r.label)}${r.entered?'':' - only seen from a doorway so far'}">${esc(r.label.replace(/^Room /,''))}${r.entered?'':'?'}</button>`).join('')}</div>`
   +`<div class="zn-actions"><button type="button" class="dungeonview-btn zn-open" data-dungeon="${esc(g.key)}">Dungeon map</button></div></div>`;
}
const DUNGEON_ZOOM_MIN=2,DUNGEON_ZOOM_MAX=60,DUNGEON_FIT_WIDTH=820;
// The map starts sized to fit the panel's width (so the whole dungeon is in view); zoom is relative to that.
function dungeonFitZoom(g){
  let minX=Infinity,maxX=-Infinity;
  for(const r of g.rooms){const b=terrainBoundsForZone(r.z);if(b){minX=Math.min(minX,b.minX);maxX=Math.max(maxX,b.maxX)}}
  for(const d of g.doors){minX=Math.min(minX,d.x);maxX=Math.max(maxX,d.x)}
  if(!Number.isFinite(minX))return 10;
  return Math.min(16,Math.max(DUNGEON_ZOOM_MIN,DUNGEON_FIT_WIDTH/((maxX-minX)+4)));
}
function dungeonZoomFor(g){return state.dungeonZoom?.get(g.key)||dungeonFitZoom(g)}
const ROOM_COLORS=['#e0a35a','#7fd0ff','#9be3a6','#f0b877','#c8a2ff','#ff9db1','#f2e08a','#8fd6c8'];
function dungeonSvg(g){
  const zoom=dungeonZoomFor(g);
  const members=new Set(g.rooms.map(r=>r.z));
  const bounds=new Map();
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  const grow=(x,y)=>{if(x==null||y==null)return;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)};
  const inRoom=(z,p)=>g.rooms.some(r=>r.z===z&&roomHas(r,p));
  for(const r of g.rooms){const b=r.area!=null?zoneAreas(r.z)[r.area]:terrainBoundsForZone(r.z);if(b){bounds.set(r,b);grow(b.minX,b.minY);grow(b.maxX,b.maxY)}}
  for(const d of g.doors)grow(d.x,d.y);
  const objsByZ=new Map();
  for(const o of snapshot?.worldObjects||[]){const z=o.position?.z;if(members.has(z)&&num(o.position.x)!==null&&num(o.position.y)!==null){if(!objsByZ.has(z))objsByZ.set(z,[]);objsByZ.get(z).push(o)}}
  if(!Number.isFinite(minX))return '<div class="note">No floor layout has been captured for these rooms yet - walk through them and it fills in.</div>';
  const pad=2,w=(maxX-minX)+pad*2,h=(maxY-minY)+pad*2;
  const tx=x=>x-minX+pad,ty=y=>y-minY+pad;
  const runsByZ=new Map();
  for(const r of snapshot?.terrain||[])if(members.has(r.z)){if(!runsByZ.has(r.z))runsByZ.set(r.z,[]);runsByZ.get(r.z).push(r)}
  let body='';
  // rooms you only glimpsed are drawn first, so the rooms you entered are never covered by them
  g.rooms.map((room,i)=>({room,i})).sort((p,q)=>(p.room.entered===q.room.entered?p.i-q.i:p.room.entered?1:-1)).forEach(({room,i})=>{
    const col=ROOM_COLORS[i%ROOM_COLORS.length],b=bounds.get(room);
    const runs=(runsByZ.get(room.z)||[]).filter(r=>roomHas(room,{x:r.xStart,y:r.y}));
    const tiles=runs.map(r=>`<rect x="${tx(r.xStart)}" y="${ty(r.y)}" width="${r.length}" height="1" fill="${zoneTileColor(r.typeId)}"/>`).join('');
    const walls=wallSegments((objsByZ.get(room.z)||[]).filter(o=>/^wall-/.test(o.typeId)&&roomHas(room,o.position))).map(s=>`<line x1="${tx(s.x1)}" y1="${ty(s.y1)}" x2="${tx(s.x2)}" y2="${ty(s.y2)}" stroke="#15110d" stroke-width="0.7" stroke-linecap="square"/><line x1="${tx(s.x1)}" y1="${ty(s.y1)}" x2="${tx(s.x2)}" y2="${ty(s.y2)}" stroke="${WALL_COLORS[String(s.o.typeId).split('-')[1]]||WALL_COLORS.stone}" stroke-width="0.45" stroke-linecap="square"/>`).join('');
    body+=`<g class="dungeon-room" ${roomAttrs(room,'data-room-zone')} style="cursor:pointer" opacity="${room.entered?1:.5}"><title>${escXml(room.label)} (zone ${room.z})${room.entered?'':' - seen from a doorway, not entered'}</title>${tiles}${walls}`;
    if(b)body+=`<rect x="${tx(b.minX)}" y="${ty(b.minY)}" width="${b.maxX-b.minX}" height="${b.maxY-b.minY}" fill="none" stroke="${col}" stroke-width="0.25"${room.entered?'':' stroke-dasharray="1 .7"'}/><text x="${tx(b.minX)+.5}" y="${ty(b.minY)+1.7}" font-size="1.6" font-weight="700" fill="${col}" stroke="#0d0a07" stroke-width="0.25" paint-order="stroke">${escXml(room.label)}</text>`;
    body+='</g>';
  });
  const doorSvg=g.doors.map(d=>{
    const la=d.la||roomLabelFor(d.a)||('Zone '+d.a),lb=d.lb||roomLabelFor(d.b)||('Zone '+d.b);
    return `<g><circle cx="${tx(d.x)}" cy="${ty(d.y)}" r="0.9" fill="#7fd0ff" stroke="#08202e" stroke-width="0.2"><title>${escXml(la+' ⇄ '+lb+' - door near ('+Math.round(d.x)+', '+Math.round(d.y)+'), crossed '+d.samples+' time'+(d.samples===1?'':'s'))}</title></circle></g>`;
  }).join('');
  const seen=new Set(),dots=[];
  for(const o of snapshot?.npcObservations||[]){
    const z=o.position?.z;if(!members.has(z)||!inRoom(z,o.position)||o.id==null||seen.has(o.id))continue;
    seen.add(o.id);if(dots.length<400)dots.push(`<circle cx="${tx(o.position.x)}" cy="${ty(o.position.y)}" r="0.35" fill="#e2574c" stroke="#2a0b08" stroke-width="0.08"><title>${escXml(o.name||prettyId(o.typeId))} (${escXml(roomLabelFor(z)||'')})</title></circle>`);
  }
  const selfs=(state.selves||[]).filter(s=>members.has(s.position?.z)&&inRoom(s.position.z,s.position)).map(s=>`<circle cx="${tx(s.position.x)}" cy="${ty(s.position.y)}" r="0.8" fill="#ffd45e" stroke="#3a2a06" stroke-width="0.2"><title>${escXml(s.name||'You')} (${escXml(roomLabelFor(s.position.z)||'')})</title></circle>`).join('');
  return `<div id="dungeonViewport" style="overflow:auto;max-height:640px;border:1px solid #4b3b2a;border-radius:6px;background:#0b0907"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${Math.round(w*zoom)}" height="${Math.round(h*zoom)}" style="display:block">${body}${doorSvg}${dots.join('')}${selfs}</svg></div>`;
}
function dungeonOverlayContent(g){
  const zoom=dungeonZoomFor(g);
  const entered=g.rooms.filter(r=>r.entered).length;
  const roomRows=g.rooms.map(r=>{
    const c=roomContents(r);
    const doors=g.doors.filter(d=>d.a===r.z||d.b===r.z).map(d=>{const o=d.a===r.z?d.b:d.a;return esc(roomLabelFor(o)||('Zone '+o))}).join(', ');
    return `<tr><td><b>${esc(r.label)}</b>${r.entered?'':' <span class="muted">(seen from a doorway)</span>'}</td><td>${fmt(c.monsters.size)}</td><td>${fmt(c.objects.size)}</td><td>${doors||'<span class="muted">—</span>'}</td><td><button type="button" class="zn-open" ${roomAttrs(r,'data-room-zone')}>Open</button></td></tr>`;
  }).join('');
  const doorRows=g.doors.sort((p,q)=>q.samples-p.samples).map(d=>`<li>${esc(roomLabelFor(d.a)||('Zone '+d.a))} ⇄ ${esc(roomLabelFor(d.b)||('Zone '+d.b))} <span class="muted">- door near (${Math.round(d.x)}, ${Math.round(d.y)}), crossed ${fmt(d.samples)} time${d.samples===1?'':'s'}</span></li>`).join('');
  return `<div id="zoneOverlayDragHandle" class="zn-ov-head" title="Drag to move this panel"><div><div class="zn-kicker">Dungeon map</div><div class="zn-ov-title">${esc(g.name)}</div></div><button type="button" id="zoneOverlayClose" class="zn-ov-close" title="Close">×</button></div>`
   +`<div class="zn-meta">${fmt(g.rooms.length)} room${g.rooms.length===1?'':'s'}${g.doors.length?' · '+fmt(g.doors.length)+' door'+(g.doors.length===1?'':'s')+' between them':''}${entered<g.rooms.length?' · '+fmt(g.rooms.length-entered)+' only seen from a doorway':''}</div>`
   +`<div class="zn-zoom"><button type="button" id="dungeonZoomOut" title="Zoom out">−</button><span>${Math.round(zoom*100/dungeonFitZoom(g))}%</span><button type="button" id="dungeonZoomIn" title="Zoom in">+</button><span class="zn-legend">Click a room to open it. <i class="zn-dot" style="background:#7fd0ff"></i>doors between rooms <i class="zn-dot" style="background:#e2574c"></i>monsters · dashed rooms were only seen from a doorway.</span></div>`
   +dungeonSvg(g)
   +`<h3 class="zn-h3">Rooms</h3><div class="g-scroll"><table class="g-table"><thead><tr><th>Room</th><th>Monster types</th><th>Resources</th><th>Doors to</th><th></th></tr></thead><tbody>${roomRows}</tbody></table></div>`
   +`<p class="g-note">Rooms are numbered in the order they were first entered; rooms only seen from a doorway come last.</p>`;
}
function openDungeonOverlay(key){
  const g=state.dungeons?.get(key);if(!g)return;
  state.openZone=null;state.openDungeon=key;lastRenderedZoneOverlayZ=null;
  const el=ensureZoneOverlay();if(!el)return;
  const prev=el.querySelector('#dungeonViewport');const scroll=prev&&state.openDungeon===key?{left:prev.scrollLeft,top:prev.scrollTop}:null;
  el.style.display='block';
  el.innerHTML=dungeonOverlayContent(g);
  const vp=el.querySelector('#dungeonViewport');
  if(vp&&scroll){vp.scrollLeft=scroll.left;vp.scrollTop=scroll.top}
}
function setDungeonZoom(key,val){
  if(!state.dungeonZoom)state.dungeonZoom=new Map();
  state.dungeonZoom.set(key,Math.min(DUNGEON_ZOOM_MAX,Math.max(DUNGEON_ZOOM_MIN,val)));
  openDungeonOverlay(key);
}
function roomBannerHtml(z){
  const key=state.dungeonOfZone?.get(z);if(key==null)return '';
  const g=state.dungeons.get(key);if(!g)return '';
  const label=roomLabelFor(z);
  const doors=g.doors.filter(d=>d.a===z||d.b===z).map(d=>{const o=d.a===z?d.b:d.a;return `<a href="#" data-room-zone="${o}">${esc(roomLabelFor(o)||('Zone '+o))}</a>`}).join(', ');
  return `<div class="muted" style="margin:-4px 0 6px">${esc(label)} of <a href="#" data-dungeon="${esc(key)}">${esc(g.name)}</a> (${fmt(g.rooms.length)} rooms) - <a href="#" data-dungeon="${esc(key)}">view the whole dungeon map</a>${doors?'<br>Doors to: '+doors:''}</div>`;
}
function zoneSummaryRow(z){
  const meta=state.zones.get(z)||{};
  let c=state.zoneContents.get(z)||{monsters:new Map(),objects:new Map()};
  return {z,name:meta.name||('Zone '+z),pvpMode:meta.pvpMode||null,lastSeen:meta.lastSeen||0,entrance:state.zoneEntrances.get(z)||null,parentZ:state.zoneParent?.get(z)??null,monsterCount:c.monsters.size,objectCount:c.objects.size};
}
// The game's own floor colours (base fill of each ground type, read from the game's stylesheet), so
// an interior looks like it does in game. Unknown ground types fall back to a stable made-up colour.
const GAME_GROUND_COLORS={dirt:'#8b7a49',cave:'#4a4848',house:'#c8b898',wood:'#9e6a36',cobblestone:'#74786d',cobble:'#8a8278',sand:'#d4b86a',grass:'#5a8a3c',limestone:'#b2b3a3',brick:'#8e826d',slate:'#424f52',marble:'#b3b9ac',gravel:'#8e907c',forest:'#59583c',mud:'#887052',snow:'#dce7e7','wood-weathered':'#626a62','wood-walnut':'#46382e'};
// Different mines record different underlying ground types (Titanium Mine's floor is "cave", Iron Mine's is
// "sand", etc.) which otherwise each keep their own colour from GAME_GROUND_COLORS above - reading as a mine
// floor that randomly changes colour room to room rather than one consistent material. These all read the
// same in Atlas now: the same dark rock-floor grey regardless of which exact ground type the room recorded.
const MINE_GROUND_KEYS=new Set(['cave','dirt','sand','gravel','slate','limestone','mud']);
const MINE_FLOOR_COLOR='#4a4848';
const WALL_SEGMENT_LEN=3;   // a wall piece covers 3 tiles, starting at its position
const WALL_COLORS={stone:'#77777b',wood:'#7a5230',brick:'#8a4b3a',castle:'#5a5a63'};
function zoneTileColor(typeId){
  const g=GAME_GROUND_COLORS[String(typeId||'').replace(/^ground-/,'')];
  if(g)return g;
  const h=hueFor(typeId||'floor');return `hsl(${h},35%,${/wall|rock|stone|support/i.test(typeId||'')?20:30}%)`;
}
function structureColor(typeId){
  if(/door|gate|portcullis/i.test(typeId))return '#8a5a30';
  if(/bank|vault|counter|coin|strongbox|deposit/i.test(typeId))return '#c9a15a';
  if(/bed|table|chair|shelf|bench|barrel|crate|chest|rug|fireplace|stove|bookcase/i.test(typeId))return '#9a7d52';
  return '#8b7a58';
}
// Walls are 3-tile pieces laid end to end: one runs along +x if another wall sits 3 tiles to its
// left or right, along +y if one sits 3 tiles above or below (a corner piece does both).
function wallSegments(walls){
  const at=new Set(walls.map(o=>Math.round(o.position.x*10)+','+Math.round(o.position.y*10)));
  const has=(x,y)=>at.has(Math.round(x*10)+','+Math.round(y*10));
  const L=WALL_SEGMENT_LEN,segs=[];
  for(const o of walls){
    const {x,y}=o.position;const h=has(x+L,y)||has(x-L,y),v=has(x,y+L)||has(x,y-L);
    if(h||!v)segs.push({o,x1:x,y1:y,x2:x+L,y2:y});
    if(v)segs.push({o,x1:x,y1:y,x2:x,y2:y+L});
  }
  return segs;
}
// Every zone's floor bounds in one pass over the ~200k floor rows, kept until the rows change (asking per zone
// rescanned all of them each time - most of a second per Atlas open).
let terrainBoundsOf=null,terrainBoundsRows=null;
function terrainBoundsForZone(z){
  const rows=snapshot?.terrain||[];
  if(terrainBoundsRows!==rows||!terrainBoundsOf){
    terrainBoundsOf=new Map();terrainBoundsRows=rows;
    for(const r of rows){
      let b=terrainBoundsOf.get(r.z);if(!b)terrainBoundsOf.set(r.z,b={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity});
      if(r.xStart<b.minX)b.minX=r.xStart;if(r.xStart+r.length>b.maxX)b.maxX=r.xStart+r.length;
      if(r.y<b.minY)b.minY=r.y;if(r.y+1>b.maxY)b.maxY=r.y+1;
    }
  }
  const b=terrainBoundsOf.get(z);
  return b&&Number.isFinite(b.minX)?{...b}:null;
}
// A zone number isn't always one place: the game reuses some for separate buildings and caves (zone -45 is both a
// cave near (50,120) and a spot at (1033,-40); -1, -6 and -10 likewise). A zone's floor is grouped into areas -
// patches within AREA_GAP tiles of each other - so each place is drawn on its own, at its own scale, instead of all
// of them squeezed into one frame. Areas are ordered by how often you've arrived in them, then by size.
const AREA_GAP=24, AREA_MARGIN=8;
const zoneAreasCache=new Map();let zoneAreasSnap=null;
function zoneAreas(z){
  if(zoneAreasSnap!==snapshot){zoneAreasCache.clear();zoneAreasSnap=snapshot;}
  if(zoneAreasCache.has(z))return zoneAreasCache.get(z);
  const areas=floorAreas((snapshot?.terrain||[]).filter(r=>r.z===z));
  for(const t of snapshot?.zoneTransitions||[])if(t.toZ===z&&t.atX!=null&&t.atY!=null)for(const a of areas)if(inArea(a,{x:t.atX,y:t.atY}))a.arrivals++;
  areas.sort((a,b)=>b.arrivals-a.arrivals||b.tiles-a.tiles);
  zoneAreasCache.set(z,areas);
  return areas;
}
// a zone's floor runs grouped into separate patches (within AREA_GAP tiles of each other)
function floorAreas(runs){
  const n=runs.length,par=[...Array(n).keys()],find=i=>{while(par[i]!==i){par[i]=par[par[i]];i=par[i];}return i;};
  const order=[...Array(n).keys()].sort((a,b)=>runs[a].y-runs[b].y);
  for(let a=0;a<n;a++){const i=order[a],ri=runs[i];for(let b=a+1;b<n;b++){const k=order[b],rk=runs[k];if(rk.y-ri.y>AREA_GAP)break;if(rk.xStart<=ri.xStart+ri.length+AREA_GAP&&ri.xStart<=rk.xStart+rk.length+AREA_GAP)par[find(k)]=find(i);}}
  const byRoot=new Map();
  runs.forEach((r,i)=>{const k=find(i);let a=byRoot.get(k);if(!a){a={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,tiles:0,runs:[],arrivals:0};byRoot.set(k,a);}
    a.runs.push(r);a.tiles+=num(r.length)||0;a.minX=Math.min(a.minX,r.xStart);a.maxX=Math.max(a.maxX,r.xStart+r.length);a.minY=Math.min(a.minY,r.y);a.maxY=Math.max(a.maxY,r.y+1);});
  return [...byRoot.values()];
}
const boxDist=(a,p)=>Math.hypot(Math.max(a.minX-p.x,0,p.x-a.maxX),Math.max(a.minY-p.y,0,p.y-a.maxY));

// ---- Places that share a zone number --------------------------------------------------------------------------
// The game reuses some zone numbers for unrelated places: -45 is a Rustpick Mine room and the Witch's Hut, -10 the
// Binxonia Bank, an Underleaf building and a West Tomb floor, the Imp Tree's rooms sit under the Church's and the
// Tailor's. A place is its zone number AND where its floor is. Right after the data loads, every zone number whose
// floor falls into separate places is split into one zone per place, and everything recorded there - floor, objects,
// people, arrivals and departures - goes with the place it happened in. The rest of the Atlas only ever sees whole
// places, so nothing one of them shows (name, entrance, doors, contents, dungeon) can leak into another.
// The place visited most keeps the real number; the others get a number of their own (PLACE_ID_BASE + |z|*1000 + a
// slot from where the place is, the sign of z kept), the same on every load. Each is named from the game: the name it
// gave on arriving there (a town's or region's name, for an unnamed building, gets what the building holds:
// "Midland Forest building"), the game's dungeon marker standing on it, or the name you gave that place.
// Your edits to a place are stored under a spot inside it (the collector's set-place); a zone-wide edit saved before
// this (the Witch's Hut's name and entrance on -45) belongs to the place its entrance lies at, and moves onto that
// place the next time you edit it.
const PLACE_ID_BASE=1e9;
let placeSplit=new Map();          // real z -> [{id, box, at, owner, legacy}]
const placeOfId=new Map();         // place id -> {z, at, owner, legacy}   (every place of a split zone number)
const realZoneOf=z=>placeOfId.get(z)?.z??z;
// the place of zone number z a point is in, or nearest to (z itself when z is not split, or without a point)
function placeIdAt(z,p){
  const list=placeSplit.get(z);if(!list||!p||p.x==null||p.y==null||(p.x===0&&p.y===0))return z;
  let best=list[0],bd=Infinity;for(const q of list){const d=boxDist(q.box,p);if(d<bd){bd=d;best=q}}
  return best.id;
}
function splitPlaces(raw){
  placeSplit=new Map();placeOfId.clear();
  const out={...(raw||{})};
  const byZ=new Map();for(const r of out.terrain||[])if(r.z)(byZ.get(r.z)||byZ.set(r.z,[]).get(r.z)).push(r);
  const arrivals=new Map();for(const t of out.zoneTransitions||[])if(t.toZ&&t.atX!=null&&t.atY!=null&&!(t.atX===0&&t.atY===0))(arrivals.get(t.toZ)||arrivals.set(t.toZ,[]).get(t.toZ)).push(t);
  const recOf=new Map((out.zones||[]).map(r=>[r.z,r]));
  const runPlace=new Map();
  for(const [z,runs] of byZ){
    const areas=floorAreas(runs);if(areas.length<2)continue;
    for(const a of areas){a.arr=(arrivals.get(z)||[]).filter(t=>inArea(a,{x:t.atX,y:t.atY}));a.arrivals=a.arr.length}
    areas.sort((a,b)=>b.arrivals-a.arrivals||b.tiles-a.tiles||a.minY-b.minY||a.minX-b.minX);
    // a zone-wide edit belongs to the place its entrance was put at (when that is not the main place)
    const eo=recOf.get(z)?.entranceOverride;let legacy=0;
    if(eo&&Number.isFinite(eo.x)&&Number.isFinite(eo.y)&&boxDist(areas[0],eo)>60){const i=areas.findIndex((a,k)=>k>0&&boxDist(a,eo)<=15);if(i>0)legacy=i}
    const slots=new Set(),sign=z<0?-1:1;
    const list=areas.map((a,i)=>{
      let id=z;
      if(i>0){const cx=Math.round((a.minX+a.maxX)/64),cy=Math.round((a.minY+a.maxY)/64);let k=1+Math.abs(((cx*73856093)^(cy*19349663))|0)%997;while(slots.has(k))k=k%997+1;slots.add(k);id=sign*(PLACE_ID_BASE+Math.abs(z)*1000+k)}
      return {id,box:a,at:{x:Math.round((a.minX+a.maxX)/2),y:Math.round((a.minY+a.maxY)/2)},owner:i===0,legacy:i===legacy};
    });
    placeSplit.set(z,list);
    for(const p of list){placeOfId.set(p.id,{z,at:p.at,owner:p.owner,legacy:p.legacy});for(const r of p.box.runs)runPlace.set(r,p.id)}
  }
  if(!placeSplit.size)return out;
  out.terrain=out.terrain.map(r=>{const id=runPlace.get(r);return id!=null&&id!==r.z?{...r,z:id}:r});
  for(const k of ['worldObjects','npcs','npcObservations'])if(Array.isArray(out[k]))out[k]=out[k].map(placeRow);
  if(Array.isArray(out.zoneTransitions))out.zoneTransitions=placeTransitions(out.zoneTransitions,[]);
  if(Array.isArray(out.zones))out.zones=placeZones(out);
  return out;
}
// something seen at a spot (an object, a person) goes to the place it stood in
function placeRow(o){const p=o&&o.position;if(!p||!placeSplit.has(p.z))return o;const id=placeIdAt(p.z,p);return id===p.z?o:{...o,position:{...p,z:id}}}
// An arrival goes to the place you arrived in; a departure comes from the place your previous arrival (same session)
// put you in, or else the one nearest where you came out. known: transitions already placed (newest first) to
// continue from - a live update's rows follow the ones already on the page.
function placeTransitions(rows,known){
  if(!placeSplit.size)return rows;
  const last=new Map();
  for(const t of known){if(t.sessionId==null)continue;const l=last.get(t.sessionId);if(!l||(num(t.time)||0)>(num(l.time)||0))last.set(t.sessionId,t)}
  const placed=new Map();
  for(const t of [...rows].sort((a,b)=>(num(a.time)||0)-(num(b.time)||0))){
    const at={x:t.atX,y:t.atY};let toZ=t.toZ,fromZ=t.fromZ;
    if(placeSplit.has(t.toZ))toZ=placeIdAt(t.toZ,at);
    if(placeSplit.has(t.fromZ)){const prev=t.sessionId!=null?last.get(t.sessionId):null;fromZ=prev&&realZoneOf(prev.toZ)===t.fromZ?prev.toZ:placeIdAt(t.fromZ,at)}
    const r=toZ!==t.toZ||fromZ!==t.fromZ?{...t,toZ,fromZ}:t;placed.set(t,r);
    if(t.sessionId!=null)last.set(t.sessionId,r);
  }
  return rows.map(t=>placed.get(t)||t);
}
const PLACE_KINDS=[[/bank-counter|deposit-boxes/,'Bank'],[/shop-counter|goods-shelf/,'Shop'],[/tailor-bench|sewing-table|loom/,'Tailor'],[/anvil|forge|smelter/,'Smithy'],[/lectern|hall-bench/,'Hall'],[/-rock$/,'Mine'],[/imp-nest/,'Imp nest'],[/bed$|cradle/,'House']];
// one zone record per place, named and carrying its own edits
function placeZones(snap){
  const regions=new Set((snap.regions||[]).filter(r=>!r.z&&r.name).map(r=>String(r.name).trim().toLowerCase()));
  const lower=v=>String(v||'').trim().toLowerCase();
  const named=new Set((snap.zones||[]).filter(r=>!placeSplit.has(r.z)).map(r=>lower(r.name)));
  const typesIn=new Map();for(const o of snap.worldObjects||[]){const z=o.position?.z;if(z!=null&&placeOfId.has(z)&&!isGroundItem(o))(typesIn.get(z)||typesIn.set(z,new Set()).get(z)).add(o.typeId||'')}
  const resolveParent=r=>{const po=r.parentOverride;return po&&po.z!=null&&po.at&&placeSplit.has(po.z)?{...r,parentOverride:{z:placeIdAt(po.z,po.at)}}:r};
  const out=[];
  for(const rec of snap.zones||[]){
    const list=placeSplit.get(rec.z);
    if(!list){out.push(resolveParent(rec));continue}
    const recs=list.map(p=>{
      const a=p.box,names=new Map();for(const t of a.arr)if(t.zoneName)names.set(t.zoneName,(names.get(t.zoneName)||0)+1);
      const game=[...names].sort((x,y)=>y[1]-x[1])[0]?.[0]||null;
      const dg=(D.pois||[]).filter(q=>q.category==='dungeon'&&boxDist(a,q)<=12&&!named.has(lower(q.name))).sort((q,w)=>boxDist(a,q)-boxDist(a,w))[0];
      const kind=PLACE_KINDS.find(([re])=>[...(typesIn.get(p.id)||[])].some(t=>re.test(t)))?.[1]||null;
      const r={...rec,z:p.id,name:dg?dg.name:game&&regions.has(lower(game))?game+' '+(kind||'building'):game,nameOverride:false,entranceOverride:null,exitOverride:null,place:{z:rec.z,at:p.at},kind};
      delete r.parentOverride;delete r.placeOverrides;
      if(p.legacy){if(rec.nameOverride){r.name=rec.name;r.nameOverride=true}for(const f of ['entranceOverride','exitOverride','parentOverride'])if(rec[f]!==undefined)r[f]=rec[f]}
      const ov=(rec.placeOverrides||[]).find(o=>inArea(a,o));
      if(ov){if(ov.name){r.name=ov.name;r.nameOverride=true}if(ov.entrance)r.entranceOverride=ov.entrance;if(ov.exit)r.exitOverride=ov.exit;if(ov.parent)r.parentOverride=ov.parent}
      return r;
    });
    // a place the game never named (nobody arrived there yet, no marker): after the main place and what it holds
    const main=recs[0].name||rec.name||('Zone '+rec.z);
    recs.forEach((r,i)=>{if(!r.name)r.name=i===0?main:r.kind?main+': '+r.kind:main+' (place '+(i+1)+')';delete r.kind;out.push(resolveParent(r))});
  }
  return out;
}
// Items lying on the ground (loot, things you dropped) are world objects too, but they're not part of a room - only
// they carry a stack quantity - so zone layouts leave them out.
// Where you arrive through a door is a step or two inside the room, not the door itself - drawing it there left doors
// floating in the middle of the floor. An exit is snapped onto the actual door/ladder/cave-mouth object when one is
// within reach, otherwise onto the nearest tile at the edge of the floor (the wall it's in).
const PORTAL_OBJ_RE=/^(?!.*(cookfire|fire-pit|nest)).*(door|ladder|stair|entrance|exit|portal|(^|-)(hatch|trapdoor)($|-)|gate|tunnel|(^|-)(pit|hole)($|-))/i;
const floorEdgeCache=new Map();let floorEdgeSnap=null;
function floorEdges(z){
  if(floorEdgeSnap!==snapshot){floorEdgeCache.clear();floorEdgeSnap=snapshot;}
  if(floorEdgeCache.has(z))return floorEdgeCache.get(z);
  const tiles=new Set(),edges=[];
  for(const r of snapshot?.terrain||[])if(r.z===z)for(let i=0;i<r.length;i++)tiles.add((r.xStart+i)+','+r.y);
  for(const k of tiles){const [x,y]=k.split(',').map(Number);if(!tiles.has((x+1)+','+y)||!tiles.has((x-1)+','+y)||!tiles.has(x+','+(y+1))||!tiles.has(x+','+(y-1)))edges.push({x,y});}
  floorEdgeCache.set(z,edges);return edges;
}
function snapExit(z,p){
  let best=null,bd=6;
  for(const o of snapshot?.worldObjects||[]){
    if(o.position?.z!==z||!PORTAL_OBJ_RE.test(o.typeId||'')||isGroundItem(o))continue;
    const d=Math.hypot(o.position.x-p.x,o.position.y-p.y);if(d<bd){bd=d;best={x:o.position.x,y:o.position.y};}
  }
  if(best)return best;
  bd=10;
  for(const e of floorEdges(z)){const d=Math.hypot(e.x-p.x,e.y-p.y);if(d<bd){bd=d;best=e;}}
  return best||p;
}
function isGroundItem(o){return !!(o&&o.data&&o.data.quantity!=null)}
function inArea(a,p,m=AREA_MARGIN){return !!(a&&p&&p.x!=null&&p.y!=null&&p.x>=a.minX-m&&p.x<=a.maxX+m&&p.y>=a.minY-m&&p.y<=a.maxY+m)}
function inAnyArea(z,p){const as=zoneAreas(z);return !as.length||as.some(a=>inArea(a,p))}
function zoneAreaIndex(z){const n=zoneAreas(z).length;const i=state.zoneArea?.get(z)||0;return n?Math.min(i,n-1):0}
function objectIconUrl(typeId,name){
  if(typeof assetUrlFor!=='function')return null;
  return assetUrlFor(typeId,name||prettyId(typeId),'item')||assetUrlFor(typeId,name||prettyId(typeId),'resource')||assetUrlFor(typeId,name||prettyId(typeId),'object')||null;
}
function npcIconUrl(typeId,name){
  if(typeof assetUrlFor!=='function')return null;
  return namedNpcImgUrl(typeId,name)||assetUrlFor(typeId,name||prettyId(typeId),'monster')||null;
}
// What was seen in a zone, from the place (area) being shown: one zone number can be several separate buildings,
// and a scorpion outside a far-off building isn't in this bank. Named NPCs get a row of their own (not "all humans").
function zoneRowsHere(z){
  const areas=zoneAreas(z),area=areas.length>1?areas[zoneAreaIndex(z)]:null,here=p=>!area||inArea(area,p);
  const typeName=new Map((D.catalog||[]).map(m=>[m.typeId,slugId(m.name)]));
  const mons=new Map(),objs=new Map();
  for(const o of snapshot?.npcObservations||[]){
    if(o.position?.z!==z||!here(o.position))continue;
    const t=String(o.typeId||o.name||'unknown'),n=String(o.name||'').trim(),ns=slugId(n);
    const named=!!ns&&ns!==slugId(t)&&ns!==typeName.get(t),id=named?'npc:'+ns:t;
    const r=mons.get(id)||{id,typeId:t,npc:named?ns:null,count:0,lastSeen:0,name:named?n:(o.name||t)};r.count++;r.lastSeen=Math.max(r.lastSeen,num(o.time)||0);mons.set(id,r);
  }
  for(const o of snapshot?.worldObjects||[]){
    if(o.position?.z!==z||!here(o.position)||!state.objectSkillByType?.get(o.typeId))continue;
    const key=resourceKeyFor(o),yieldItem=state.resourceYieldByObjectId?.get(o.id)||null;
    const r=objs.get(key)||{id:key,count:0,lastSeen:0,name:o.name||o.typeId,yieldItem};r.count++;r.lastSeen=Math.max(r.lastSeen,num(o.lastSeen)||0);objs.set(key,r);
  }
  const by=(a,b)=>b.count-a.count;
  return {monsterRows:[...mons.values()].sort(by),objectRows:[...objs.values()].sort(by)};
}
const ZONE_ZOOM_MIN=0.5, ZONE_ZOOM_MAX=10, ZONE_ZOOM_STEP=1.25, ZONE_VIEWPORT_HEIGHT=640, ZONE_DEFAULT_ZOOM=2;
function getZoneZoom(z){return state.zoneDetailZoom?.get(z)||ZONE_DEFAULT_ZOOM}
function setZoneZoom(z,val){
  if(!state.zoneDetailZoom)state.zoneDetailZoom=new Map();
  const clamped=Math.min(ZONE_ZOOM_MAX,Math.max(ZONE_ZOOM_MIN,val));
  state.zoneDetailZoom.set(z,clamped);
  return clamped;
}
function exitObjectNear(ex,objs){
  let best=null,bestD=Infinity;
  for(const o of objs){
    const p=o.position;if(!p)continue;
    const d=Math.hypot(p.x-ex.x,p.y-ex.y);
    if(d<=2&&d<bestD){best=o;bestD=d;}
  }
  return best;
}
function exitKind(ex,near){
  const t=String(near?.typeId||'').toLowerCase();
  if(/ladder/.test(t))return 'ladder';
  if(/(^|-)(pit|hole)($|-)/.test(t))return 'hole';
  if(/hatch|trapdoor/.test(t))return 'hatch';
  if(/door|gate/.test(t))return 'door';
  if(/cave|entrance|tunnel|cavern|stair/.test(t))return 'cave';
  return ex.toZ===0?'cave':'door';
}
// Where each way in or out leads, written under it on the layout (the same words as its hover text): green for the
// way outside, yellow for the way back, plain for anywhere else.
function exitLabel(ex,cx,cy){
  const from=state.openZone,dg=state.dungeonOfZone,sameDg=!ex.surface&&from!=null&&dg?.has(from)&&dg.get(from)===dg.get(ex.toZ);
  const text=ex.surface?'Way outside':(ex.isParentExit?'Back to ':'To ')+(sameDg?roomLabelFor(ex.toZ):placeName(ex.toZ));
  const cls=ex.surface?' zexit-out':ex.isParentExit?' zexit-back':'';
  return '<text class="zexit-lbl'+cls+'" x="'+cx+'" y="'+(cy+1.75)+'" text-anchor="middle" font-size="0.5">'+escXml(text)+'</text>';
}
function exitMarkup(ex,objs,cx,cy,shadow){
  const from=state.openZone,dg=state.dungeonOfZone,sameDg=!ex.surface&&from!=null&&dg?.has(from)&&dg.get(from)===dg.get(ex.toZ);
  const targetName=ex.surface?'outside':sameDg?roomLabelFor(ex.toZ):placeName(ex.toZ);
  const near=exitObjectNear(ex,objs);
  const kind=exitKind(ex,near);
  const label=kind==='ladder'?'Ladder':kind==='hole'?'Hole':kind==='hatch'?'Hatch':kind==='cave'?'Cave entrance':'Door';
  const verb=ex.isParentExit?'leads back to':ex.surface?'leads back':'leads to';
  const title=`<title>${escXml(label+' — '+verb+' '+targetName+(ex.surface?' — click to see where it comes out on the map':' — click to open'))}</title>`;
  const url=near?objectIconUrl(near.typeId,near.name):null;
  // yellow ring: back the way you came; green ring: the way out to the surface
  const ring=ex.isParentExit||ex.surface?`<circle cx="${cx}" cy="${cy}" r="1.15" fill="none" stroke="${ex.surface?'#5fd38a':'#ffd54a'}" stroke-width="0.14" ${shadow}/>`:'';
  const attrs=ex.surface?`${shadow} class="zone-exit-dot zone-exit-out show-on-map" data-map-kind="${ex.place?'place':'zone'}" data-map-id="${escXml(ex.place||String(ex.fromZ))}" style="cursor:pointer"`:`${shadow} class="zone-exit-dot" data-exit-to="${ex.toZ}" style="cursor:pointer"`;
  if(url)return `${ring}<image href="${url}" x="${cx-.9}" y="${cy-.9}" width="1.8" height="1.8" preserveAspectRatio="xMidYMid meet" ${attrs}>${title}</image>`;
  if(kind==='ladder'){
    return `${ring}<g transform="translate(${cx},${cy})" ${attrs}><line x1="-0.5" y1="-0.9" x2="-0.5" y2="0.9" stroke="#c9a15a" stroke-width="0.16"/><line x1="0.5" y1="-0.9" x2="0.5" y2="0.9" stroke="#c9a15a" stroke-width="0.16"/><line x1="-0.5" y1="-0.55" x2="0.5" y2="-0.55" stroke="#c9a15a" stroke-width="0.14"/><line x1="-0.5" y1="-0.05" x2="0.5" y2="-0.05" stroke="#c9a15a" stroke-width="0.14"/><line x1="-0.5" y1="0.45" x2="0.5" y2="0.45" stroke="#c9a15a" stroke-width="0.14"/>${title}</g>`;
  }
  if(kind==='hatch'){
    return `${ring}<g transform="translate(${cx},${cy})" ${attrs}><path d="M 0 -0.6 L 1 0 L 0 0.6 L -1 0 Z" fill="#8a5a30" stroke="#2c1c0f" stroke-width="0.12"/><path d="M -0.5 -0.3 L 0.5 0.3 M 0 -0.6 L 0 0.6" stroke="#2c1c0f" stroke-width="0.08"/><circle cx="0.35" cy="-0.05" r="0.09" fill="#f0d18a"/>${title}</g>`;
  }
  if(kind==='hole'){
    return `${ring}<g transform="translate(${cx},${cy})" ${attrs}><ellipse rx="0.95" ry="0.55" fill="#0b0806" stroke="#6b4e28" stroke-width="0.14"/>${title}</g>`;
  }
  if(kind==='cave'){
    return `${ring}<g transform="translate(${cx},${cy})" ${attrs}><path d="M -0.9 0.9 L -0.9 -0.15 A 0.9 0.9 0 0 1 0.9 -0.15 L 0.9 0.9 Z" fill="#241b12" stroke="#6b4e28" stroke-width="0.14"/>${title}</g>`;
  }
  return `${ring}<g transform="translate(${cx},${cy})" ${attrs}><rect x="-0.55" y="-0.9" width="1.1" height="1.8" rx="0.12" fill="#8a5a30" stroke="#2c1c0f" stroke-width="0.12"/><circle cx="0.28" cy="0" r="0.11" fill="#f0d18a"/>${title}</g>`;
}
function zoneDetailSvg(z){
  const zoom=getZoneZoom(z);
  // One area of the zone at a time (see zoneAreas): its floor, and only what lies within it. A zone with no floor
  // recorded yet has no areas, and shows everything as before.
  const areas=zoneAreas(z),area=areas[zoneAreaIndex(z)]||null;
  const here=p=>!area||inArea(area,p);
  const runs=area?area.runs:(snapshot?.terrain||[]).filter(r=>r.z===z);
  const allObjsHere=(snapshot?.worldObjects||[]).filter(o=>o.position?.z===z&&here(o.position)&&!isGroundItem(o));
  const objs=allObjsHere.filter(o=>state.objectSkillByType?.get(o.typeId));
  const npcsHereAll=(snapshot?.npcObservations||[]).filter(o=>o.position?.z===z&&here(o.position));
  const npcFirstById=new Map();
  for(const o of npcsHereAll){
    const id=o.id!=null?String(o.id):Symbol();
    const existing=npcFirstById.get(id);
    if(!existing||(num(o.time)||0)<(num(existing.time)||0))npcFirstById.set(id,o);
  }
  const npcsHere=[...npcFirstById.values()];
  const ownParentZ=state.zoneParent?.get(z);
  const autoExits=(state.zoneInternalExits?.get(z)||[]).filter(ex=>ex.toZ!==ownParentZ);
  const manualExits=[...state.zones.values()].filter(m=>state.zoneParent?.get(m.z)===z&&m.z!==ownParentZ&&m.entranceOverride&&Number.isFinite(m.entranceOverride.x)&&Number.isFinite(m.entranceOverride.y)&&!autoExits.some(ex=>ex.toZ===m.z)).map(m=>({toZ:m.z,x:m.entranceOverride.x,y:m.entranceOverride.y,samples:0,lastSeen:m.lastSeen||0}));
  const parentExit=(()=>{
    if(ownParentZ==null)return null;
    const meta=state.zones.get(z);
    if(meta?.exitOverride&&Number.isFinite(meta.exitOverride.x)&&Number.isFinite(meta.exitOverride.y))return {toZ:ownParentZ,x:meta.exitOverride.x,y:meta.exitOverride.y,samples:0,lastSeen:0,isParentExit:true};
    const auto=(state.zoneInternalExits?.get(z)||[]).find(ex=>ex.toZ===ownParentZ);
    return auto?{...auto,isParentExit:true}:null;
  })();
  const exits=[...autoExits,...manualExits,...(parentExit?[parentExit]:[]),...(state.zoneSurfaceExits?.get(z)||[])].filter(ex=>here(ex));
  const selvesHere=(state.selves||[]).filter(s=>s.position?.z===z&&here(s.position));
  // Everything else the collector has seen in here that is not a gatherable: walls, doors, counters, furniture.
  const structs=allObjsHere.filter(o=>!state.objectSkillByType?.get(o.typeId)&&o.position&&num(o.position.x)!==null&&num(o.position.y)!==null);
  const wallSegs=wallSegments(structs.filter(o=>/^wall-/.test(o.typeId)));
  const propObjs=structs.filter(o=>!/^wall-/.test(o.typeId)&&!(/door/.test(o.typeId)&&exits.some(ex=>Math.hypot(ex.x-o.position.x,ex.y-o.position.y)<=2.5)));

  // Isometric projection, matching the game's own view and the Map panel's drawInside() in minimap.js: one tile
  // step in x goes down-right, one in y goes down-left. The old rendering here was a flat top-down grid, which
  // looked nothing like the room actually does in-game - this makes Atlas's own room view match it.
  const hw=1,hh=0.5,wallH=hh*2.2;
  const isoX=(x,y)=>(x-y)*hw, isoY=(x,y)=>(x+y)*hh;

  let b=area?{minX:area.minX,maxX:area.maxX,minY:area.minY,maxY:area.maxY}:terrainBoundsForZone(z);
  const structPts=[...propObjs.map(o=>o.position),...wallSegs.flatMap(s=>[{x:s.x1,y:s.y1},{x:s.x2,y:s.y2}])];
  if(!b){
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const o of [...objs,...npcsHere,...selvesHere,...exits,...structPts]){const p=o.position||o;if(p.x==null||p.y==null)continue;minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y)}
    b=Number.isFinite(minX)?{minX,maxX,minY,maxY}:{minX:0,maxX:10,minY:0,maxY:10};
  } else {
    for(const p of [...selvesHere.map(s=>s.position),...exits,...structPts]){b.minX=Math.min(b.minX,p.x);b.maxX=Math.max(b.maxX,p.x);b.minY=Math.min(b.minY,p.y);b.maxY=Math.max(b.maxY,p.y);}
  }
  // Project every corner the room can actually draw to (floor diamond edges, walls raised by wallH) for the real
  // isometric bounding box - the room's own x/y extent alone isn't it, since the diagonal projection and the
  // raised walls both push the drawn shape well past a plain min/max of the world coordinates.
  let pMinX=Infinity,pMaxX=-Infinity,pMinY=Infinity,pMaxY=-Infinity;
  for(const [cx,cy] of [[b.minX,b.minY],[b.maxX,b.minY],[b.minX,b.maxY],[b.maxX,b.maxY]]){
    const sx=isoX(cx,cy),sy=isoY(cx,cy);
    pMinX=Math.min(pMinX,sx-hw);pMaxX=Math.max(pMaxX,sx+hw);
    pMinY=Math.min(pMinY,sy-wallH-hh);pMaxY=Math.max(pMaxY,sy+hh);
  }
  const pad=2,offX=-pMinX+pad,offY=-pMinY+pad;
  const px=(x,y)=>isoX(x,y)+offX, py=(x,y)=>isoY(x,y)+offY;
  const w=(pMaxX-pMinX)+pad*2, h=(pMaxY-pMinY)+pad*2;

  let centroid=null;
  if(runs.length){
    let sx=0,sy=0,totalLen=0;
    for(const r of runs){const midX=r.xStart+r.length/2;sx+=px(midX,r.y+0.5)*r.length;sy+=py(midX,r.y+0.5)*r.length;totalLen+=r.length;}
    if(totalLen)centroid={x:sx/totalLen,y:sy/totalLen};
  }
  if(!centroid){
    const pts=[...objs.map(o=>o.position),...npcsHere.map(o=>o.position)].filter(p=>p&&p.x!=null&&p.y!=null);
    if(pts.length){
      const ax=pts.reduce((s,p)=>s+p.x,0)/pts.length,ay=pts.reduce((s,p)=>s+p.y,0)/pts.length;
      centroid={x:px(ax,ay),y:py(ax,ay)};
    }else centroid={x:w/2,y:h/2};
  }
  if(!state.zoneSvgBounds)state.zoneSvgBounds=new Map();
  state.zoneSvgBounds.set(z,{hw,hh,offX,offY,centroid});

  const tilePatterns=new Map();
  const tileFill=(typeId)=>{
    const key=slug(typeId||'floor');
    const groundKey=String(typeId||'').replace(/^ground-/,'');
    if(MINE_GROUND_KEYS.has(groundKey))return MINE_FLOOR_COLOR;
    if(GAME_GROUND_COLORS[groundKey])return zoneTileColor(typeId);   // the game's exact colour beats anything else
    if(!tilePatterns.has(key))tilePatterns.set(key,{typeId,url:objectIconUrl(typeId,prettyId(typeId))});
    return tilePatterns.get(key).url?`url(#tile-${key})`:zoneTileColor(typeId);
  };
  const diamondPath=(cx,cy,up=0)=>`M${cx} ${cy-hh-up} L${cx+hw} ${cy-up} L${cx} ${cy+hh-up} L${cx-hw} ${cy-up} Z`;
  // Floor as one diamond per tile - a run can no longer be a single rect once it's drawn diagonally.
  const tiles=[];
  for(const r of runs) for(let i=0;i<r.length;i++){
    const tx0=r.xStart+i,cx=px(tx0,r.y),cy=py(tx0,r.y);
    // A thin border on every one of a room's individual floor diamonds is barely visible zoomed in, on its own -
    // but a large room can have thousands of them, each sharing an edge with its neighbour, and the overlapping
    // strokes compound into visible grainy noise across what is otherwise one uniform floor colour. Much lighter
    // fixes that without losing the tile grid definition entirely when zoomed in close.
    tiles.push(`<path d="${diamondPath(cx,cy)}" fill="${tileFill(r.typeId)}" stroke="rgba(0,0,0,.12)" stroke-width="0.02"><title>${escXml(prettyId(r.typeId))}</title></path>`);
  }
  const shadowDef=`<filter id="bxcShadow-${z}" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="0.12" stdDeviation="0.15" flood-color="#000" flood-opacity="0.65"/></filter>`;
  const defs=shadowDef+[...tilePatterns.values()].filter(p=>p.url).map(p=>`<pattern id="tile-${slug(p.typeId)}" width="1" height="1" patternUnits="userSpaceOnUse"><image href="${p.url}" width="1" height="1" preserveAspectRatio="xMidYMid slice"/></pattern>`).join('');
  const shadow=`filter="url(#bxcShadow-${z})"`;
  // Walls as raised panels along each merged segment (wallSegments already resolves the game's own 3-tile wall
  // props into runs) rather than minimap.js's per-tile cubes with face-culling - these objects aren't one-per-tile
  // here, so a simple raised ribbon between each segment's own endpoints is the shape that actually matches the data.
  const wallSvg=wallSegs.map(s=>{
    const c=WALL_COLORS[String(s.o.typeId).split('-')[1]]||WALL_COLORS.stone,t=`<title>${escXml(prettyId(s.o.typeId))}</title>`;
    const x1=px(s.x1,s.y1),y1=py(s.x1,s.y1),x2=px(s.x2,s.y2),y2=py(s.x2,s.y2);
    return `<g><path d="M${x1} ${y1} L${x2} ${y2} L${x2} ${y2-wallH} L${x1} ${y1-wallH} Z" fill="#443829" stroke="#15110d" stroke-width="0.05"/><path d="M${x1} ${y1-wallH} L${x2} ${y2-wallH}" stroke="${c}" stroke-width="0.35" stroke-linecap="round">${t}</path></g>`;
  }).join('');

  // Props, resources, monsters, exits and self, all depth-sorted together (nearer = higher x+y = drawn later/on
  // top) - the same unified pass drawInside() uses, so a resource stays in front of a wall it is actually in front
  // of instead of every kind just layering in whatever order it happened to be collected in.
  const items=[];
  for(const o of propObjs) items.push({x:o.position.x,y:o.position.y,kind:'prop',o});
  for(const o of objs) items.push({x:o.position.x,y:o.position.y,kind:'res',o});
  for(const o of npcsHere.slice(0,600)) items.push({x:o.position.x,y:o.position.y,kind:'npc',o});
  for(const ex of exits) items.push({x:ex.x,y:ex.y,kind:'exit',ex});
  for(const s of selvesHere) items.push({x:s.position.x,y:s.position.y,kind:'self',s});
  items.sort((a,b)=>(a.x+a.y)-(b.x+b.y));
  const itemSvg=items.map(it=>{
    const cx=px(it.x,it.y),cy=py(it.x,it.y);
    if(it.kind==='prop'){
      const o=it.o,label=escXml(prettyId(o.typeId)),url=objectIconUrl(o.typeId,prettyId(o.typeId));
      // Only drawn with its real captured art - a lettered placeholder box looked like clutter, not the room.
      return url?`<image href="${url}" x="${cx-.9}" y="${cy-.9}" width="1.8" height="1.8" preserveAspectRatio="xMidYMid meet" ${shadow}><title>${label}</title></image>`:'';
    }
    if(it.kind==='res'){
      const o=it.o,url=resourceIconUrl(o);
      if(url)return `<image href="${url}" x="${cx-.9}" y="${cy-.9}" width="1.8" height="1.8" preserveAspectRatio="xMidYMid meet" ${shadow}><title>${escXml(resourceLabel(o))}</title></image>`;
      const style=resourceMarkerStyle(o.typeId);
      return `<circle cx="${cx}" cy="${cy}" r="0.8" fill="${style.fillColor}" stroke="${style.color}" stroke-width="0.15" ${shadow}><title>${escXml(resourceLabel(o))}</title></circle>`;
    }
    if(it.kind==='npc'){
      // each one named, with its level, above it; click it (or its row below) for what it drops
      const o=it.o,url=npcIconUrl(o.typeId,o.name),nm=o.name||prettyId(o.typeId),lv=o.level!=null?o.level:null;
      const body=url?`<image href="${url}" x="${cx-1.1}" y="${cy-1.1}" width="2.2" height="2.2" preserveAspectRatio="xMidYMid meet" ${shadow}/>`:`<circle cx="${cx}" cy="${cy}" r="0.9" fill="#ff5a5a" stroke="#3a0a0a" stroke-width="0.15" ${shadow}/>`;
      const lbl=`<text class="zmon-lbl" x="${cx}" y="${cy-1.3}" text-anchor="middle" font-size="0.5">${escXml(nm)}${lv!=null?' · Lv '+lv:''}</text>`;
      return `<g class="zmon" data-zmon-type="${escXml(o.typeId||'')}" data-zmon-name="${escXml(nm)}" data-lv="${lv??''}">${body}${lbl}</g>`;
    }
    if(it.kind==='exit')return exitMarkup(it.ex,allObjsHere,cx,cy,shadow)+exitLabel(it.ex,cx,cy);
    return `<circle cx="${cx}" cy="${cy}" r="1.1" fill="#ffd54a" stroke="#3a2c05" stroke-width="0.2" ${shadow}><title>${escXml(it.s.name||'You')}</title></circle>`;
  }).join('');

  const svg=`<svg viewBox="0 0 ${w} ${h}" width="${Math.round(zoom*100)}%" height="${Math.round(zoom*ZONE_VIEWPORT_HEIGHT)}" style="background:#0d0b09;display:block">${defs?`<defs>${defs}</defs>`:''}${tiles.join('')}${wallSvg}${itemSvg}</svg>`;
  return `<div id="zoneDetailViewport" style="width:100%;height:${ZONE_VIEWPORT_HEIGHT}px;overflow:auto;border:1px solid #4a3a22;border-radius:8px;background:#0d0b09;cursor:grab">${svg}</div>`;
}

function zonesHtml(search=''){
  const s=String(search||'').toLowerCase().trim();
  const tilesByZ=new Map(),objsByZ=new Map();
  for(const r of snapshot?.terrain||[])tilesByZ.set(r.z,(tilesByZ.get(r.z)||0)+(num(r.length)||0));
  for(const o of snapshot?.worldObjects||[]){const oz=o.position?.z;if(oz&&!isGroundItem(o))objsByZ.set(oz,(objsByZ.get(oz)||0)+1)}
  const life=placeLifeIndex();
  const dungeonCards=[...(state.dungeons?.values()||[])].filter(g=>!s||JSON.stringify(g).toLowerCase().includes(s)||g.rooms.some(r=>JSON.stringify(zoneSummaryRow(r.z)).toLowerCase().includes(s))).map(g=>dungeonCardHtml(g,life));
  // a dungeon's rooms are on its dungeon's card
  const rows=[...state.zones.keys()].filter(z=>z!==0&&!state.dungeonOfZone?.has(z)).map(zoneSummaryRow).filter(r=>!s||JSON.stringify(r).toLowerCase().includes(s)).sort((a,b)=>b.lastSeen-a.lastSeen);
  const zoneCard=r=>{
    const parentName=r.parentZ!=null?(state.zones.get(r.parentZ)?.name||('Zone '+r.parentZ)):null;
    const statusLine=parentName?`Inside ${esc(parentName)}`:(r.entrance?.manual?'Manually placed entrance':r.entrance?`Entrance located from ${fmt(r.entrance.samples)} visit${r.entrance.samples===1?'':'s'}`:'Entrance location not yet observed');
    const writeButtons=!EDIT?'':`<button type="button" class="zoneedit-btn" data-zone="${r.z}">Edit</button>`;
    const own=[{z:r.z,area:null}];
    const meta=[r.pvpMode&&r.pvpMode!=='none'?esc(prettyId(r.pvpMode)):'',placeLife(life,own),r.objectCount?fmt(r.objectCount)+' resource'+(r.objectCount===1?'':'s'):''].filter(Boolean).join(' · ');
    const hasLayout=tilesByZ.get(r.z)||objsByZ.get(r.z);
    const floorOf=/ \(another floor\)$/.test(r.name)?r.name.replace(/ \(another floor\)$/,''):null;
    return `<div class="card zn-card zonecard" data-card-map="zone" data-card-map-id="${r.z}" title="Show it on the map"><div class="zn-kicker">${floorOf?'A floor of '+esc(floorOf):parentName?'Inside '+esc(parentName):'Cave, mine or building'}</div><div class="zn-name">${esc(floorOf||r.name)}</div>`
      +zoneQuestNote(r.z)
      +(meta?`<div class="zn-meta">${meta}</div>`:'')
      +(PUBLIC_MODE?'':`<div class="zn-meta">${statusLine} · last seen ${when(r.lastSeen)}</div>`)
      +`<div class="zn-actions"><button type="button" class="zoneview-btn zn-open" data-zone="${r.z}">${hasLayout?'Layout':'No layout yet'}</button>${writeButtons}</div></div>`;
  };
  const total=rows.length+dungeonCards.length;
  return `<p class="zn-summary">${fmt(total)} place${total===1?'':'s'}${dungeonCards.length?` · ${fmt(dungeonCards.length)} dungeon${dungeonCards.length===1?'':'s'}`:''}. Open one to see its layout, doors and what lives there.</p>`
    +(dungeonCards.length?`<h2 class="zn-h">Dungeons</h2><div class="zn-list">${dungeonCards.join('')}</div>`:'')
    +(rows.length?`<h2 class="zn-h">Caves, mines & buildings</h2><div class="zn-list">${rows.map(zoneCard).join('')}</div>`:'')
    +(total?'':'<div class="note">No caves, dungeons or buildings recorded yet. They appear here as data for them comes in.</div>');
}
function zoneHasLayout(z){
  const inZ=a=>(a||[]).some(o=>(o.z!==undefined?o.z:o.position?.z)===z);
  return inZ(snapshot?.terrain)||inZ(snapshot?.worldObjects)||inZ(snapshot?.npcObservations);
}
// a place's name (one place per zone - see splitPlaces; i is kept for callers that still pass a floor area)
function placeName(z,i){return state.zones?.get(z)?.name||('Zone '+z)}
// the place of zone z a point is in (or nearest to): where a door from another zone comes out
globalThis.bxcPlaceAt=(z,x,y)=>{const id=placeIdAt(Number(z),{x:Number(x),y:Number(y)});return state.zones?.has(id)?placeName(id):null};
// every place (zone, area) going by a name - for an official marker's "Open the layout"
function placesNamed(name){const out=[];for(const z of state.zones?.keys()||[]){if(!z)continue;const n=Math.max(1,zoneAreas(z).length);for(let i=0;i<n;i++)if(placeName(z,i)===name)out.push({z,i})}return out}
function placeIndexAt(z,p){const as=zoneAreas(z);if(as.length<2||!p)return 0;let best=0,bd=Infinity;as.forEach((a,i)=>{const d=Math.hypot(Math.max(a.minX-p.x,0,p.x-a.maxX),Math.max(a.minY-p.y,0,p.y-a.maxY));if(d<bd){bd=d;best=i}});return best}
// "You need the quest ... to get in" (Agauton Mine and the like: see QUEST_UNLOCKS in atlas-guides.js)
// a place whose way in lies in a quest-gated area (Ogre Cove on Ogre Isle): that quest too (bxcQuestRegionAt)
function zoneRegionQuest(z){if(typeof globalThis.bxcQuestRegionAt!=='function')return null;const pts=[],e=state.zoneEntrances?.get(z);if(e)pts.push(e);
  const k=state.dungeonOfZone?.get(z),g=k!=null?state.dungeons?.get(k):null;
  if(g){for(const r of g.rooms){const re=state.zoneEntrances?.get(r.z);if(re)pts.push(re)}const poi=(D.pois||[]).find(p=>p.category==='dungeon'&&String(p.name).toLowerCase()===String(g.name).toLowerCase());if(poi)pts.push({x:+poi.x,y:+poi.y})}
  for(const p of pts){const q=globalThis.bxcQuestRegionAt(p.x,p.y);if(q){const qq=(snapshot?.quests||[]).find(x=>x.questId===q.questId);return {name:qq?.name||q.questName,href:'#/guide/quest-'+String(q.questId).toLowerCase().replace(/[^a-z0-9]+/g,'-'),giver:qq?.giverName||null,place:q.place}}}return null}
function zoneQuestNote(z){const qs=[...(globalThis.bxcZoneQuests?globalThis.bxcZoneQuests(z):[])],rq=zoneRegionQuest(z);if(rq&&!qs.some(q=>q.name===rq.name))qs.push(rq);if(!qs.length)return '';
  return `<div class="zone-quest-note">Locked until you finish ${qs.map(q=>`<a href="${q.href}">${esc(q.name)}</a>${q.giver?' ('+esc(q.giver)+')':''}`).join(' and ')}.</div>`}
// The app's own tools for a place (hidden on the public Atlas), in one menu: each says what it does, only the ones
// that apply are offered, and deleting sits apart at the bottom.
function zoneEditMenuHtml(z,r,parentName){
  const meta=state.zones.get(z)||{},item=(id,label,hint,cls='')=>`<button type="button" id="${id}" class="zn-edit-item${cls}" role="menuitem"><b>${label}</b><span>${hint}</span></button>`;
  return `<div class="zn-edit"><button type="button" id="zoneOverlayEditBtn" class="zn-edit-btn" aria-haspopup="menu" aria-expanded="${state.zoneEditOpen?'true':'false'}">Edit ▾</button><div class="zn-edit-menu" role="menu"${state.zoneEditOpen?'':' hidden'}>`
    +item('zoneOverlayRename','Rename…','Change the name shown everywhere')
    +item('zoneOverlayMoveEntrance','Move the entrance','Then click the map where the way in is')
    +(meta.entranceOverride&&!meta.manual?item('zoneOverlayResetEntrance','Use the recorded entrance','Undo a moved entrance: back to where players walk in'):'')
    +item('zoneOverlayAddSub','Add a door to a new area','Then click the layout where the door is')
    +(parentName?item('zoneOverlayMarkExit','Mark the way back','Then click the layout where the door to '+esc(parentName)+' is'):'')
    +item('zoneOverlayAssociate','Put it inside another place…','For a floor or room you reach from inside another place')
    +(parentName?item('zoneOverlayDisassociate','Take it out of '+esc(parentName),'It becomes a place of its own again'):'')
    +(meta.manual?item('zoneOverlayLink','Link to a recorded place…','This marker has nothing inside yet: attach it to a place already recorded'):'')
    // (not a place sharing its zone number with others: the collector would delete all of them)
    +(placeOfId.has(z)?'':'<hr>'+item('zoneOverlayDelete','Delete this place…','Removes it and everything recorded inside',' zn-danger'))
    +'</div></div>';
}
// While a tool waits for a click on the layout: say exactly what to click, with a way out.
function zoneModeBarHtml(z,parentName){
  const child=state.setEntranceForChildZ;
  const msg=state.addSubLevelArmed?'Click the layout where the door to the new area is.'
    :state.markExitArmed?'Click the layout where the way back'+(parentName?' to <b>'+esc(parentName)+'</b>':'')+' is.'
    :child!=null?'Click the layout where the way into <b>'+esc(state.zones.get(child)?.name||('Zone '+child))+'</b> is.':'';
  return msg?`<div class="zn-mode"><span>${msg}</span><button type="button" id="zoneOverlayCancelMode">Cancel</button></div>`:'';
}
// A monster in the room layout and its row in "Monsters seen here" (or a person and their row) go together: picking
// either highlights both, brings the other into view, and opens what it drops (people: a link to their page).
function zmonSelect(el,ev){
  const root=zoneOverlayEl;if(!root)return;
  root.querySelectorAll('.zmon-on').forEach(x=>x.classList.remove('zmon-on'));root.querySelector('.zmon-pop')?.remove();
  if(!el)return;
  const nm=el.dataset.zmonName,ty=el.dataset.zmonType;
  const person=nm&&root.querySelector(`tr[data-zmon-name="${CSS.escape(nm)}"]`);
  const key=person||(el.tagName==='TR'&&nm&&!ty)?{a:'data-zmon-name',v:nm}:{a:'data-zmon-type',v:ty};
  const all=[...root.querySelectorAll(`[${key.a}="${CSS.escape(key.v)}"]`)],sprites=all.filter(x=>x.classList.contains('zmon')),row=all.find(x=>x.tagName==='TR');
  all.forEach(x=>x.classList.add('zmon-on'));
  if(el.tagName==='TR'){const vp=root.querySelector('#zoneDetailViewport'),sp=sprites[0];if(vp&&sp){const a=vp.getBoundingClientRect(),b=sp.getBoundingClientRect();vp.scrollLeft+=b.left-a.left-a.width/2+b.width/2;vp.scrollTop+=b.top-a.top-a.height/2+b.height/2}}
  else row?.scrollIntoView({block:'nearest'});
  const lvs=[...new Set(sprites.map(x=>x.dataset.lv).filter(Boolean).map(Number))].sort((a,b)=>a-b);
  const name=(sprites[0]?.dataset.zmonName)||(row?.innerText||'').trim().split('\n')[0]||prettyId(key.v);
  const isPerson=key.a==='data-zmon-name';
  const drops=!isPerson&&typeof globalThis.bxcMonsterDrops==='function'?globalThis.bxcMonsterDrops(key.v):'';
  const pop=document.createElement('div');pop.className='zmon-pop';
  pop.innerHTML=`<div class="zmon-pop-head"><b>${esc(name)}</b>${lvs.length?`<span class="muted"> · Lv ${lvs[0]}${lvs.length>1?'–'+lvs[lvs.length-1]:''}</span>`:''}<button type="button" class="zmon-pop-x" aria-label="Close">×</button></div>`
    +(isPerson?`<p><a href="#/npc/${encodeURIComponent(String(name).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""))}">Open their page</a></p>`:(drops||'<p class="muted">No drops recorded yet.</p>')+`<p><span class="monsterlink" data-monster="${esc(key.v)}" style="cursor:pointer;text-decoration:underline">Open in the Bestiary</span></p>`);
  root.appendChild(pop);
  const r=root.getBoundingClientRect(),at=(ev&&ev.clientX!=null)?{x:ev.clientX,y:ev.clientY}:(()=>{const b=(sprites[0]||el).getBoundingClientRect();return {x:b.right,y:b.top}})();
  pop.style.left=Math.max(8,Math.min(r.width-pop.offsetWidth-8,at.x-r.left+12))+'px';pop.style.top=Math.max(root.scrollTop+8,Math.min(root.scrollTop+root.clientHeight-pop.offsetHeight-8,at.y-r.top+root.scrollTop+12))+'px';   // inside the part of the panel you can see
}
function zoneOverlayContent(z){
  const r=zoneSummaryRow(z);
  const {monsterRows:allRows,objectRows}=zoneRowsHere(z);
  // friendly people (a vendor, a banker) are not monsters
  const friendlyNames=new Set((snapshot?.npcs||[]).filter(n=>n.faction==='friendly'&&n.name).map(n=>n.name));
  const peopleRows=allRows.filter(m=>friendlyNames.has(m.name)),monsterRows=allRows.filter(m=>!friendlyNames.has(m.name));
  const parentName=r.parentZ!=null?(state.zones.get(r.parentZ)?.name||('Zone '+r.parentZ)):null;
  const hereArea=zoneAreas(z).length>1?zoneAreas(z)[zoneAreaIndex(z)]:null;
  const autoChildExits=(state.zoneInternalExits?.get(z)||[]).filter(ex=>ex.toZ!==r.parentZ&&(!hereArea||inArea(hereArea,ex)));
  const manualChildZones=[...state.zones.values()].filter(m=>state.zoneParent?.get(m.z)===z&&m.z!==r.parentZ&&!autoChildExits.some(ex=>ex.toZ===m.z));
  const sameDungeon=tz=>state.dungeonOfZone?.has(z)&&state.dungeonOfZone.get(z)===state.dungeonOfZone.get(tz);
  const childExitNames=[...new Set([...autoChildExits.filter(ex=>!sameDungeon(ex.toZ)).map(ex=>placeName(ex.toZ,placeIndexAt(ex.toZ,ex))),   // rooms of the same dungeon are already under Doors to
...manualChildZones.map(m=>m.name||('Zone '+m.z))])];
  return `<div id="zoneOverlayDragHandle" class="zn-ov-head" title="Drag to move this panel">
  <div>${(()=>{const nm=placeName(z,zoneAreaIndex(z)),dgKey=state.dungeonOfZone?.get(z),floor=/ \(another floor\)$/.test(nm)?nm.replace(/ \(another floor\)$/,''):null;
    const kick=dgKey!=null?'Dungeon room':floor?'A floor of '+esc(floor):parentName?'Inside '+esc(parentName):'Cave, mine or building';
    const title=dgKey!=null?nm+' · '+(roomLabelFor(z)||''):floor||nm;
    return `<div class="zn-kicker">${kick}</div><div class="zn-ov-title">${esc(title)}</div>`})()}</div>
  <div class="zn-ov-tools">${!EDIT?'':zoneEditMenuHtml(z,r,parentName)}<button type="button" id="zoneOverlayClose" class="zn-ov-close" title="Close">×</button></div>
  </div>
  ${roomBannerHtml(z)}
  ${zoneQuestNote(z)}
  ${parentName&&!(state.dungeonOfZone?.has(z)&&state.dungeonOfZone.get(z)===state.dungeonOfZone.get(r.parentZ))?`<div class="muted" style="margin:-4px 0 6px">Inside <a href="#" id="zoneOverlayParentLink" data-parent-zone="${r.parentZ}">${esc(parentName)}</a> — click to go back</div>`:''}
  ${childExitNames.length?`<div class="muted" style="margin:-4px 0 6px">Leads to: ${childExitNames.map(esc).join(', ')} — click its door on the layout to go there</div>`:''}
  ${!EDIT?'':zoneModeBarHtml(z,parentName)}
  <div class="zn-meta">${[r.pvpMode&&r.pvpMode!=='none'?esc(prettyId(r.pvpMode)):'',monsterRows.length?fmt(monsterRows.length)+' monster type'+(monsterRows.length===1?'':'s'):'',peopleRows.length?fmt(peopleRows.length)+(peopleRows.length===1?' person':' people'):'',objectRows.length?fmt(objectRows.length)+' resource'+(objectRows.length===1?'':'s'):'',!monsterRows.length&&!peopleRows.length&&!objectRows.length?'Nothing seen inside yet':''].filter(Boolean).join(' · ')}</div>
  <div class="zn-zoom"><button type="button" id="zoneDetailZoomOut" title="Zoom out">−</button><button type="button" id="zoneDetailZoomReset" title="Reset zoom">${Math.round(getZoneZoom(z)*100)}%</button><button type="button" id="zoneDetailZoomIn" title="Zoom in">+</button><span class="zn-legend">Scroll over the layout to zoom, drag to pan. <i class="zn-dot" style="background:#5fd38a"></i>way outside <i class="zn-dot" style="background:#ffd54a"></i>way back</span></div>
  ${zoneHasLayout(z)?'':`<div class="note" style="margin:0 0 8px"><b>Nothing recorded inside this one yet.</b> ${r.entrance?.manual||state.zones.get(z)?.manual?'You placed this entrance by hand, so it has no layout of its own. Walk inside with the collector running and it fills in automatically. If this place is already recorded under another zone, use <b>Edit ▾ → Link to a recorded place</b> to attach this entrance to it (nothing recorded is deleted).':'The layout will appear as data for it comes in.'}</div>`}
  ${zoneDetailSvg(z)}
  <div class="g-note">Floors use the game's own colours. Walls are drawn from the wall pieces recorded so far, and counters, doors and furniture with their captured art. Items lying on the ground aren't shown. Anything not recorded yet is missing. Red = monsters, gold = you; only confirmed-gatherable resources are shown as resources.</div>
  ${peopleRows.length?`<details open class="zn-details"><summary>People here (${peopleRows.length})</summary><table class="g-table"><tbody>${peopleRows.map(m=>`<tr data-zmon-name="${esc(m.name||'')}"><td><span class="monsterlink" data-monster="${esc(m.typeId||m.id)}"${m.npc?` data-npc="${esc(m.npc)}"`:''} title="Open their page" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><img class="thumb monsterthumb" src="${esc(monsterImg({typeId:m.typeId||m.id,name:m.name}))}" alt="" style="width:22px;height:22px;flex:none;border-radius:5px"><span>${esc(m.name)}</span></span></td></tr>`).join('')}</tbody></table></details>`:''}
  <details open class="zn-details${monsterRows.length?'':' zn-hide'}"><summary>Monsters seen here (${monsterRows.length})</summary><table class="g-table"><thead><tr><th>Monster</th><th>Observations</th><th>Last seen</th></tr></thead><tbody>${monsterRows.map(m=>`<tr data-zmon-type="${esc(m.typeId||m.id)}"><td><span class="monsterlink" data-monster="${esc(m.typeId||m.id)}"${m.npc?` data-npc="${esc(m.npc)}"`:''} title="${m.npc?'Open their page':'Show in Bestiary'}" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><img class="thumb monsterthumb" src="${esc(monsterImg({typeId:m.typeId||m.id,name:m.name}))}" alt="" style="width:22px;height:22px;flex:none;border-radius:5px"><span>${esc(prettyId(m.name||m.id))}</span></span></td><td>${fmt(m.count)}</td><td>${when(m.lastSeen)}</td></tr>`).join('')||'<tr><td colspan="3">None observed yet.</td></tr>'}</tbody></table></details>
  <details open class="zn-details${objectRows.length?'':' zn-hide'}"><summary>Resources seen here (${objectRows.length})</summary><table class="g-table"><thead><tr><th>Resource</th><th>Distinct seen</th><th>Last seen</th></tr></thead><tbody>${objectRows.map(o=>`<tr><td>${o.yieldItem?`<span class="dropicon-link" data-item="${esc(o.yieldItem)}" title="Show in Items tab" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><img class="thumb itemthumb" src="${esc(itemImgFor(o.yieldItem))}" alt="" style="width:22px;height:22px;flex:none;border-radius:5px"><span>${esc(prettyId(o.name))} (${esc(prettyId(o.yieldItem))})</span></span>`:esc(prettyId(o.name))}</td><td>${fmt(o.count)}</td><td>${when(o.lastSeen)}</td></tr>`).join('')||'<tr><td colspan="3">None observed yet.</td></tr>'}</tbody></table></details>`;
}
let zoneOverlayEl=null;
// The layout panel sits on the map; on a page (Banker, a cave's resource) the map is hidden, so it floats over the
// page instead - otherwise a "Layout" button there opened a panel of zero size.
function placeZoneOverlay(el){
  const mapEl=document.getElementById('map'),onMap=!!(mapEl&&mapEl.offsetWidth&&mapEl.offsetHeight);
  const host=onMap?mapEl:document.body;if(el.parentElement!==host)host.appendChild(el);
  el.style.position=onMap?'absolute':'fixed';el.style.maxHeight=onMap?'calc(100% - 24px)':'calc(100vh - 24px)';
  return el;
}
function ensureZoneOverlay(){
  if(zoneOverlayEl)return placeZoneOverlay(zoneOverlayEl);
  const mapEl=document.getElementById('map');
  if(!mapEl)return null;
  zoneOverlayEl=document.createElement('div');
  zoneOverlayEl.id='zoneOverlay';
  zoneOverlayEl.style.cssText='position:absolute;top:12px;right:12px;width:min(900px,94%);max-width:98%;height:auto;max-height:calc(100% - 24px);min-width:340px;min-height:240px;overflow:auto;resize:both;z-index:4000;display:none';
  mapEl.appendChild(zoneOverlayEl);placeZoneOverlay(zoneOverlayEl);
  if(typeof L!=='undefined'&&L.DomEvent){L.DomEvent.disableClickPropagation(zoneOverlayEl);if(L.DomEvent.disableScrollPropagation)L.DomEvent.disableScrollPropagation(zoneOverlayEl);}
  zoneOverlayEl.addEventListener('click',e=>{
    if(suppressNextOverlayClick){suppressNextOverlayClick=false;return;}
    if(e.target.closest('#zoneOverlayClose')){closeZoneOverlay();return;}
    if(e.target.closest('.zmon-pop-x')){zmonSelect(null);return;}
    { const zm=!e.target.closest('.zmon-pop')&&e.target.closest('.zmon,tr[data-zmon-type],tr[data-zmon-name]');if(zm){zmonSelect(zm,e);return;} }
    const monsterRow=e.target.closest('.monsterlink');
    if(monsterRow&&monsterRow.dataset.npc){closeZoneOverlay();goRoute('#/npc/'+encodeURIComponent(monsterRow.dataset.npc));return;}
    if(monsterRow){goToMonsterCard(monsterRow.dataset.monster);return;}
    const iconLink=e.target.closest('.dropicon-link');
    if(iconLink){goToItemCard(iconLink.dataset.item);return;}
    const roomBtn=e.target.closest('[data-room-zone]');
    if(roomBtn){e.preventDefault();const rz=Number(roomBtn.dataset.roomZone);if(roomBtn.dataset.roomArea!=null){if(!state.zoneArea)state.zoneArea=new Map();state.zoneArea.set(rz,+roomBtn.dataset.roomArea);lastRenderedZoneOverlayZ=null}openZoneOverlay(rz);return;}
    const dungeonBtn=e.target.closest('[data-dungeon]');
    if(dungeonBtn){e.preventDefault();openDungeonOverlay(dungeonBtn.dataset.dungeon);return;}
    if(e.target.closest('#dungeonZoomIn')){const k=state.openDungeon;if(k&&state.dungeons.get(k))setDungeonZoom(k,dungeonZoomFor(state.dungeons.get(k))*1.25);return;}
    if(e.target.closest('#dungeonZoomOut')){const k=state.openDungeon;if(k&&state.dungeons.get(k))setDungeonZoom(k,dungeonZoomFor(state.dungeons.get(k))/1.25);return;}
    const parentLink=e.target.closest('#zoneOverlayParentLink');
    if(parentLink){state.zoneArea?.set(Number(parentLink.dataset.parentZone),0);openZoneOverlay(Number(parentLink.dataset.parentZone));return;}
    if(e.target.closest('#zoneOverlayEditBtn')){state.zoneEditOpen=!state.zoneEditOpen;const m=zoneOverlayEl?.querySelector('.zn-edit-menu');if(m)m.hidden=!state.zoneEditOpen;e.target.closest('#zoneOverlayEditBtn').setAttribute('aria-expanded',String(state.zoneEditOpen));return;}
    if(e.target.closest('.zn-edit-item'))state.zoneEditOpen=false;
    if(e.target.closest('#zoneOverlayCancelMode')){stopZoneTools();return;}
    if(e.target.closest('#zoneOverlayRename')){redrawZoneOverlay();renameZone(state.openZone);return;}
    if(e.target.closest('#zoneOverlayMoveEntrance')){const z=state.openZone;closeZoneOverlay();startMoveEntrance(z);return;}
    if(e.target.closest('#zoneOverlayResetEntrance')){const z=state.openZone;state.zoneEditOpen=false;bridgeRequest('clear-zone-entrance',{z}).then(syncNow).then(()=>{lastRenderedZoneOverlayZ=null;openZoneOverlay(z)}).catch(err=>setCollectorStatus('Collector: '+err.message));return;}
    if(e.target.closest('#zoneOverlayLink')){redrawZoneOverlay();linkManualZone(state.openZone);return;}
    if(e.target.closest('#zoneOverlayDelete')){redrawZoneOverlay();deleteZone(state.openZone);return;}
    if(e.target.closest('#zoneOverlayAssociate')){redrawZoneOverlay();associateZoneParent(state.openZone);return;}
    if(e.target.closest('#zoneOverlayDisassociate')){redrawZoneOverlay();disassociateZoneParent(state.openZone);return;}
    const areaBtn=e.target.closest('.zonearea-btn');
    if(areaBtn){const z=state.openZone;if(z!=null){if(!state.zoneArea)state.zoneArea=new Map();state.zoneArea.set(z,+areaBtn.dataset.area);lastRenderedZoneOverlayZ=null;openZoneOverlay(z);}return;}
    if(e.target.closest('#zoneDetailZoomIn')){const z=state.openZone;if(z!=null)applyZoneZoom(z,getZoneZoom(z)*ZONE_ZOOM_STEP);return;}
    if(e.target.closest('#zoneDetailZoomOut')){const z=state.openZone;if(z!=null)applyZoneZoom(z,getZoneZoom(z)/ZONE_ZOOM_STEP);return;}
    if(e.target.closest('#zoneDetailZoomReset')){const z=state.openZone;if(z!=null)resetZoneView(z);return;}
    if(e.target.closest('#zoneOverlayAddSub')){
      state.markExitArmed=false;state.setEntranceForChildZ=null;state.addSubLevelArmed=true;
      redrawZoneOverlay();setSubLevelPlacementCursor(true);
      return;
    }
    if(e.target.closest('#zoneOverlayMarkExit')){
      state.addSubLevelArmed=false;state.setEntranceForChildZ=null;state.markExitArmed=true;
      redrawZoneOverlay();setSubLevelPlacementCursor(true);
      return;
    }
    const svgEl=e.target.closest('svg');
    if(state.addSubLevelArmed&&svgEl&&state.openZone!=null){
      const parentZ=state.openZone;
      const pos=svgPointToGameCoords(svgEl,parentZ,e.clientX,e.clientY);
      state.addSubLevelArmed=false;
      setSubLevelPlacementCursor(false);redrawZoneOverlay();
      if(pos)addSubLevelAt(parentZ,pos);
      return;
    }
    if(state.setEntranceForChildZ!=null&&svgEl&&state.openZone!=null){
      const parentZ=state.openZone;
      const childZ=state.setEntranceForChildZ;
      const pos=svgPointToGameCoords(svgEl,parentZ,e.clientX,e.clientY);
      state.setEntranceForChildZ=null;
      setSubLevelPlacementCursor(false);redrawZoneOverlay();
      if(pos){
        bridgeRequest('set-zone-entrance',{z:childZ,x:pos.x,y:pos.y}).then(syncNow).catch(err=>setCollectorStatus('Collector: '+err.message));
      }
      return;
    }
    if(state.markExitArmed&&svgEl&&state.openZone!=null){
      const z=state.openZone;
      const pos=svgPointToGameCoords(svgEl,z,e.clientX,e.clientY);
      state.markExitArmed=false;
      setSubLevelPlacementCursor(false);redrawZoneOverlay();
      if(pos){
        bridgeRequest('set-zone-exit',{z,x:pos.x,y:pos.y}).then(syncNow).catch(err=>setCollectorStatus('Collector: '+err.message));
      }
      return;
    }
    const exitDot=e.target.closest('[data-exit-to]');
    if(exitDot){const tz=Number(exitDot.dataset.exitTo);if(!state.zoneArea)state.zoneArea=new Map();state.zoneArea.set(tz,+exitDot.dataset.exitArea||0);lastRenderedZoneOverlayZ=null;openZoneOverlay(tz);return;}
  });
  zoneOverlayEl.addEventListener('wheel',e=>{
    const vp=e.target.closest('#zoneDetailViewport');
    if(!vp||state.openZone==null)return;
    e.preventDefault();
    const z=state.openZone;
    const rect=vp.getBoundingClientRect();
    const focal={x:e.clientX-rect.left,y:e.clientY-rect.top};
    applyZoneZoom(z,getZoneZoom(z)*(e.deltaY<0?ZONE_ZOOM_STEP:1/ZONE_ZOOM_STEP),focal);
  },{passive:false});
  zoneOverlayEl.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('#zoneOverlayDragHandle');
    const vp=e.target.closest('#zoneDetailViewport');
    if(handle&&!e.target.closest('button')){
      const parentRect=(zoneOverlayEl.offsetParent||document.body).getBoundingClientRect();
      const rect=zoneOverlayEl.getBoundingClientRect();
      const startLeft=rect.left-parentRect.left,startTop=rect.top-parentRect.top;
      zoneOverlayDrag={pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,startLeft,startTop,captured:false};
      zoneOverlayEl.style.left=startLeft+'px';
      zoneOverlayEl.style.top=startTop+'px';
      zoneOverlayEl.style.right='auto';
      return;
    }
    if(vp){
      zoneOverlayPan={pointerId:e.pointerId,vp,startX:e.clientX,startY:e.clientY,scrollLeft:vp.scrollLeft,scrollTop:vp.scrollTop,moved:false};
    }
  });
  zoneOverlayEl.addEventListener('pointermove',e=>{
    if(zoneOverlayDrag&&zoneOverlayDrag.pointerId===e.pointerId){
      if(!zoneOverlayDrag.captured){zoneOverlayDrag.captured=true;try{zoneOverlayEl.setPointerCapture(e.pointerId);}catch{}}
      e.preventDefault();
      const dx=e.clientX-zoneOverlayDrag.startX,dy=e.clientY-zoneOverlayDrag.startY;
      zoneOverlayEl.style.left=(zoneOverlayDrag.startLeft+dx)+'px';
      zoneOverlayEl.style.top=(zoneOverlayDrag.startTop+dy)+'px';
      return;
    }
    if(zoneOverlayPan&&zoneOverlayPan.pointerId===e.pointerId){
      const dx=e.clientX-zoneOverlayPan.startX,dy=e.clientY-zoneOverlayPan.startY;
      if(Math.abs(dx)>3||Math.abs(dy)>3){
        if(!zoneOverlayPan.moved){try{zoneOverlayPan.vp.setPointerCapture(e.pointerId);}catch{}}
        zoneOverlayPan.moved=true;
        zoneOverlayPan.vp.style.cursor='grabbing';
        e.preventDefault();
      }
      if(zoneOverlayPan.moved){
        zoneOverlayPan.vp.scrollLeft=zoneOverlayPan.scrollLeft-dx;
        zoneOverlayPan.vp.scrollTop=zoneOverlayPan.scrollTop-dy;
      }
    }
  });
  const endOverlayDrags=e=>{
    if(zoneOverlayDrag&&zoneOverlayDrag.pointerId===e.pointerId)zoneOverlayDrag=null;
    if(zoneOverlayPan&&zoneOverlayPan.pointerId===e.pointerId){
      zoneOverlayPan.vp.style.cursor='grab';
      if(zoneOverlayPan.moved)suppressNextOverlayClick=true;
      zoneOverlayPan=null;
    }
  };
  zoneOverlayEl.addEventListener('pointerup',endOverlayDrags);
  zoneOverlayEl.addEventListener('pointercancel',endOverlayDrags);
  return zoneOverlayEl;
}
function closeZoneOverlay(){
  if(state.openZone!=null)state.zoneArea?.delete(state.openZone);
  state.openZone=null;state.openDungeon=null;
  state.addSubLevelArmed=false;
  state.setEntranceForChildZ=null;
  state.markExitArmed=false;
  lastRenderedZoneOverlayZ=null;
  if(zoneOverlayEl){zoneOverlayEl.style.display='none';zoneOverlayEl.innerHTML='';}
}
function svgPointToGameCoords(svgEl,z,clientX,clientY){
  const bounds=state.zoneSvgBounds?.get(z);
  if(!bounds||typeof svgEl.createSVGPoint!=='function')return null;
  const pt=svgEl.createSVGPoint();pt.x=clientX;pt.y=clientY;
  const ctm=svgEl.getScreenCTM();if(!ctm)return null;
  const p=pt.matrixTransform(ctm.inverse());
  // Inverse of the isometric projection in zoneDetailSvg: sx=(x-y)*hw+offX, sy=(x+y)*hh+offY.
  const sx=p.x-bounds.offX,sy=p.y-bounds.offY;
  const u=sx/bounds.hw,v=sy/bounds.hh;   // u=x-y, v=x+y
  return {x:(u+v)/2,y:(v-u)/2};
}
async function renameZone(z){
  if(z==null)return;
  const meta=state.zones.get(z);
  const name=await askName('Rename zone',meta?.name||'');
  if(name==null||!name.trim())return;
  try{await bridgeRequest('set-zone-name',{z,name:name.trim()});await syncNow();}
  catch(err){setCollectorStatus('Collector: '+err.message);}
}
// Hand-placed marker -> zone already recorded: the recorded zone takes the marker's entrance, the empty marker goes.
async function linkManualZone(z){
  if(z==null)return;
  const choice=await zoneTargetDialog('Link marker to existing zone',zoneCandidates(z),{existingOnly:true});
  if(!choice||choice.z==null)return;
  try{
    const res=await bridgeRequest('link-manual-zone',{manualZ:z,realZ:choice.z});
    if(res&&res.ok===false){window.alert(res.error||'Could not link.');return;}
    if(state.openZone===z)closeZoneOverlay();
    await syncNow();
    setCollectorStatus(`Collector: linked to "${state.zones.get(choice.z)?.name||('Zone '+choice.z)}"`);
  }catch(err){setCollectorStatus('Collector: '+err.message);}
}
async function deleteZone(z){
  if(z==null||placeOfId.has(z))return;   // one of several places under a zone number: deleting would take them all
  const meta=state.zones.get(z);
  const label=meta?.name||('Zone '+z);
  if(!window.confirm(`Delete "${label}"? This removes its entrance marker and everything recorded inside it (monsters, resources, terrain). This can't be undone.`))return;
  try{
    await bridgeRequest('delete-zone',{z});
    if(state.openZone===z)closeZoneOverlay();
    await syncNow();
  }catch(err){setCollectorStatus('Collector: '+err.message);}
}
// Every zone that can be picked, each with a label that is unique (dungeon rooms share a name).
function zoneCandidates(excludeZ){
  // A dungeon is one entry (its first room, where you walk in); hand-placed markers are not offered.
  const list=[...state.zones.values()].filter(m=>m.z!==0&&m.z!==excludeZ&&!m.manual&&!(state.dungeonOfZone?.has(m.z)&&state.dungeons.get(state.dungeonOfZone.get(m.z)).rooms[0].z!==m.z));
  const count=new Map();
  for(const m of list){const n=(m.name||('Zone '+m.z)).toLowerCase();count.set(n,(count.get(n)||0)+1)}
  return list.map(m=>{
    const name=m.name||('Zone '+m.z);
    const g=state.dungeonOfZone?.has(m.z)?state.dungeons.get(state.dungeonOfZone.get(m.z)):null;
    const base=g?`${name} (dungeon, ${g.rooms.length} rooms)`:name;
    return {z:m.z,name,label:count.get(name.toLowerCase())>1?`${base} #${m.z}`:base};
  }).sort((a,b)=>a.label.localeCompare(b.label));
}
// "New or existing?" dialog used whenever something zone-like is added. Resolves to
// {z} for an existing zone, {name} for a new one, or null when cancelled.
// A name box in the page itself. The app (Electron) does not support the browser's own prompt() - it returns nothing
// at once without showing anything - so Rename used to do nothing at all.
function askName(title,value){
  return new Promise(resolve=>{
    addResourceDialogStyle();
    const wrap=document.createElement('div');wrap.className='bxc-modal-backdrop';
    wrap.innerHTML=`<div class="bxc-modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>
      <label><span>Name</span><input id="bxcNameInput" type="text" autocomplete="off" spellcheck="false"></label>
      <div class="bxc-modal-actions"><button type="button" id="bxcNameOk" class="primary">Save</button><button type="button" id="bxcNameCancel">Cancel</button></div></div>`;
    document.body.appendChild(wrap);
    const input=wrap.querySelector('#bxcNameInput');input.value=value||'';input.focus();input.select();
    const done=v=>{document.removeEventListener('keydown',onKey,true);wrap.remove();resolve(v)};
    const submit=()=>{const v=input.value.trim();if(v)done(v)};
    const onKey=e=>{if(e.key==='Escape'){e.stopPropagation();done(null)}else if(e.key==='Enter'&&document.activeElement===input){e.preventDefault();submit()}};
    document.addEventListener('keydown',onKey,true);
    wrap.querySelector('#bxcNameOk').addEventListener('click',submit);
    wrap.querySelector('#bxcNameCancel').addEventListener('click',()=>done(null));
    wrap.addEventListener('mousedown',e=>{if(e.target===wrap)done(null)});
  });
}
function zoneTargetDialog(title,candidates,opts={}){
  return new Promise(resolve=>{
    addResourceDialogStyle();
    const wrap=document.createElement('div');wrap.className='bxc-modal-backdrop';
    const listId='bxcZoneList-'+Date.now();
    const canExisting=candidates.length>0;
    wrap.innerHTML=`<div class="bxc-modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2>
      <div class="bxc-seg"><label><input type="radio" name="bxcZMode" value="new" checked> New zone</label><label><input type="radio" name="bxcZMode" value="existing"${canExisting?'':' disabled'}> Existing zone</label></div>
      <label><span id="bxcZLabel">Name for the new zone</span><input id="bxcZInput" type="text" list="${listId}" autocomplete="off" spellcheck="false"></label>
      <datalist id="${listId}"></datalist>
      <p class="bxc-modal-note" id="bxcZNote"></p>
      <div class="bxc-modal-actions"><button type="button" id="bxcZOk" class="primary">OK</button><button type="button" id="bxcZCancel">Cancel</button></div></div>`;
    document.body.appendChild(wrap);
    const input=wrap.querySelector('#bxcZInput'),list=wrap.querySelector('datalist'),note=wrap.querySelector('#bxcZNote'),label=wrap.querySelector('#bxcZLabel');
    const mode=()=>wrap.querySelector('input[name=bxcZMode]:checked').value;
    const sync=()=>{
      const existing=mode()==='existing';
      list.innerHTML=existing?candidates.map(c=>`<option value="${esc(c.label)}">`).join(''):'';
      label.textContent=existing?'Type to search your recorded zones':'Name for the new zone';
      input.placeholder=existing?'Start typing a zone name…':'e.g. Ogre Cove';
      note.textContent=existing?'The marker is linked to that zone, so opening it shows everything recorded inside.':'';
      input.value='';input.focus();
    };
    wrap.querySelectorAll('input[name=bxcZMode]').forEach(r=>r.addEventListener('change',sync));
    const done=v=>{document.removeEventListener('keydown',onKey,true);wrap.remove();resolve(v)};
    const submit=()=>{
      const typed=input.value.trim();
      if(!typed)return;
      if(mode()==='new'){done({name:typed});return}
      const lc=typed.toLowerCase();
      const hits=candidates.filter(c=>c.label.toLowerCase()===lc);
      let pool=hits.length?hits:candidates.filter(c=>c.name.toLowerCase()===lc);
      if(!pool.length)pool=candidates.filter(c=>c.label.toLowerCase().includes(lc));
      if(pool.length===1){done({z:pool[0].z});return}
      note.textContent=pool.length>1?'Several rooms share that name — pick one from the suggestions.':`No recorded zone matches "${typed}". Pick one from the suggestions.`;
    };
    const onKey=e=>{
      if(e.key==='Escape'){e.stopPropagation();done(null)}
      else if(e.key==='Enter'&&wrap.contains(document.activeElement)&&document.activeElement.tagName!=='BUTTON'){e.preventDefault();submit()}
    };
    document.addEventListener('keydown',onKey,true);
    wrap.addEventListener('mousedown',e=>{if(e.target===wrap)done(null)});
    wrap.querySelector('#bxcZCancel').onclick=()=>done(null);
    wrap.querySelector('#bxcZOk').onclick=submit;
    if(opts.existingOnly){
      wrap.querySelector('.bxc-seg').style.display='none';
      wrap.querySelector('input[value=existing]').checked=true;
    }
    sync();
  });
}
function pickZoneDialog(promptTitle,candidates){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9000;display:flex;align-items:center;justify-content:center';
    const listId='zonePickerList-'+Date.now();
    const options=candidates.map(m=>`<option value="${esc(m.name||('Zone '+m.z))}">`).join('');
    overlay.innerHTML=`<div style="background:#15120d;border:1px solid #7a5c30;border-radius:10px;padding:18px;min-width:320px;max-width:90vw;color:#eee;box-shadow:0 12px 32px rgba(0,0,0,.55)">
      <div style="margin-bottom:10px;font-weight:600">${esc(promptTitle)}</div>
      <input id="zonePickerInput" type="text" list="${listId}" placeholder="Type or pick a zone…" autocomplete="off" style="width:100%;padding:7px 8px;margin-bottom:14px;background:#0d0b09;color:#eee;border:1px solid #4a3a22;border-radius:6px;box-sizing:border-box;font-size:14px">
      <datalist id="${listId}">${options}</datalist>
      <div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" id="zonePickerCancel">Cancel</button><button type="button" id="zonePickerOk">OK</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const input=overlay.querySelector('#zonePickerInput');
    input.focus();
    const cleanup=result=>{overlay.remove();resolve(result);};
    const resolveInput=()=>{
      const typed=input.value.trim();
      if(!typed){cleanup(null);return;}
      const match=candidates.find(m=>(m.name||('Zone '+m.z)).toLowerCase()===typed.toLowerCase());
      if(!match){window.alert(`No zone named "${typed}" found.`);return;}
      cleanup(match.z);
    };
    overlay.querySelector('#zonePickerCancel').addEventListener('click',()=>cleanup(null));
    overlay.querySelector('#zonePickerOk').addEventListener('click',resolveInput);
    input.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();resolveInput();}
      else if(e.key==='Escape'){cleanup(null);}
    });
    overlay.addEventListener('mousedown',e=>{if(e.target===overlay)cleanup(null);});
  });
}
async function associateZoneParent(z){
  if(z==null)return;
  const meta=state.zones.get(z);
  const candidates=[...state.zones.values()].filter(m=>m.z!==z&&m.z!==0);
  if(!candidates.length){window.alert('No other zones known yet to associate with.');return;}
  const picked=await pickZoneDialog(`Which zone should "${meta?.name||('Zone '+z)}" be a sub-level of?`,candidates);
  if(picked==null)return;
  try{
    const res=await bridgeRequest('set-zone-parent',{z,parentZ:picked});
    if(res&&res.ok===false){window.alert(res.error||'Could not set parent.');return;}
    await syncNow();
    state.setEntranceForChildZ=z;
    openZoneOverlay(picked);
    setSubLevelPlacementCursor(true);
  }
  catch(err){setCollectorStatus('Collector: '+err.message);}
}
async function addSubLevelAt(parentZ,pos){
  const choice=await zoneTargetDialog('Add sub-level / door',zoneCandidates(parentZ));
  if(!choice)return;
  if(choice.z!=null){
    try{
      const res=await bridgeRequest('set-zone-parent',{z:choice.z,parentZ});
      if(res&&res.ok===false){window.alert(res.error||'Could not set parent.');return;}
      await bridgeRequest('set-zone-entrance',{z:choice.z,x:pos.x,y:pos.y});
      await syncNow();
    }catch(err){setCollectorStatus('Collector: '+err.message);}
    return;
  }
  try{
    const res=await bridgeRequest('create-manual-zone',{name:choice.name,x:pos.x,y:pos.y});
    if(res?.z!=null)await bridgeRequest('set-zone-parent',{z:res.z,parentZ});
    await syncNow();
  }catch(err){setCollectorStatus('Collector: '+err.message);}
}
async function disassociateZoneParent(z){
  if(z==null)return;
  try{await bridgeRequest('clear-zone-parent',{z});await syncNow();}
  catch(err){setCollectorStatus('Collector: '+err.message);}
}
function setSubLevelPlacementCursor(active){
  const vp=document.getElementById('zoneDetailViewport');
  if(vp)vp.style.cursor=active?'crosshair':'grab';
}
function centerZoneViewport(vp,z){
  const svg=vp.querySelector('svg');
  const bounds=z!=null?state.zoneSvgBounds?.get(z):null;
  if(svg&&bounds?.centroid&&typeof svg.createSVGPoint==='function'){
    const ctm=svg.getScreenCTM();
    if(ctm){
      const pt=svg.createSVGPoint();pt.x=bounds.centroid.x;pt.y=bounds.centroid.y;
      const screenPt=pt.matrixTransform(ctm);
      const vpRect=vp.getBoundingClientRect();
      const curX=screenPt.x-vpRect.left,curY=screenPt.y-vpRect.top;
      vp.scrollLeft=Math.max(0,vp.scrollLeft+curX-vp.clientWidth/2);
      vp.scrollTop=Math.max(0,vp.scrollTop+curY-vp.clientHeight/2);
      return;
    }
  }
  vp.scrollLeft=Math.max(0,(vp.scrollWidth-vp.clientWidth)/2);
  vp.scrollTop=Math.max(0,(vp.scrollHeight-vp.clientHeight)/2);
}
// redraw the open layout panel (keeps its scroll), e.g. to show or hide the tool bar
function redrawZoneOverlay(){if(state.openZone!=null){lastRenderedZoneOverlayZ=state.openZone;openZoneOverlay(state.openZone)}}
function stopZoneTools(){state.addSubLevelArmed=false;state.markExitArmed=false;state.setEntranceForChildZ=null;setSubLevelPlacementCursor(false);redrawZoneOverlay()}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(state.addSubLevelArmed||state.markExitArmed||state.setEntranceForChildZ!=null))stopZoneTools()});
// Your own position moving shouldn't rebuild the open room layout under the mouse: at most every 3 s, and not while
// the pointer is over it or a monster's popup is open (the project's rule: never rebuild what you're using).
function refreshZoneOverlaySoon(){
  const el=zoneOverlayEl;if(state.openZone==null)return;
  if(el&&(el.matches(':hover')||el.querySelector('.zmon-pop')))return;
  const now=Date.now();if(now-(state.zoneOverlayAt||0)<3000)return;state.zoneOverlayAt=now;
  openZoneOverlay(state.openZone);
}
function openZoneOverlay(z){
  if(!state.zones.has(z))return;
  if(state.openZone!==z)state.addSubLevelArmed=false;
  const sameZone=lastRenderedZoneOverlayZ===z;
  state.openZone=z;state.openDungeon=null;
  const el=ensureZoneOverlay();
  if(!el)return;
  const prevVp=sameZone?el.querySelector('#zoneDetailViewport'):null;
  const vpScroll=prevVp?{left:prevVp.scrollLeft,top:prevVp.scrollTop}:null;
  const outerScroll=sameZone?el.scrollTop:0;
  el.style.display='block';
  el.innerHTML=zoneOverlayContent(z);
  const vp=el.querySelector('#zoneDetailViewport');
  if(vp){
    if(vpScroll){vp.scrollLeft=vpScroll.left;vp.scrollTop=vpScroll.top;}
    else centerZoneViewport(vp,z);
    if(state.addSubLevelArmed||state.setEntranceForChildZ!=null||state.markExitArmed)vp.style.cursor='crosshair';
  }
  el.scrollTop=outerScroll;
  lastRenderedZoneOverlayZ=z;
}
function applyZoneZoom(z,newZoomRaw,focal){
  const el=zoneOverlayEl;
  const vp=el?el.querySelector('#zoneDetailViewport'):null;
  const oldZoom=getZoneZoom(z);
  const newZoom=setZoneZoom(z,newZoomRaw);
  const ratio=newZoom/oldZoom;
  let scaled=null;
  if(vp){
    const fx=focal?focal.x:vp.clientWidth/2;
    const fy=focal?focal.y:vp.clientHeight/2;
    const contentX=vp.scrollLeft+fx,contentY=vp.scrollTop+fy;
    scaled={left:Math.max(0,contentX*ratio-fx),top:Math.max(0,contentY*ratio-fy)};
  }
  openZoneOverlay(z);
  if(scaled&&el){const vp2=el.querySelector('#zoneDetailViewport');if(vp2){vp2.scrollLeft=scaled.left;vp2.scrollTop=scaled.top;}}
}
function resetZoneView(z){
  setZoneZoom(z,ZONE_DEFAULT_ZOOM);
  openZoneOverlay(z);
  const el=zoneOverlayEl;
  const vp=el?el.querySelector('#zoneDetailViewport'):null;
  if(vp)centerZoneViewport(vp,z);
}
function deriveAssets(){
  const assets = Array.isArray(snapshot?.assets)?snapshot.assets:[];
  state.assets = assets;
  // The lookup indexes only depend on each asset's url and heavy content, both covered by sig, so
  // when nothing changed since the last sync the (fairly costly) rebuild is skipped.
  const assetSigKey = assets.every(a=>a.sig) ? assets.map(a=>a.url+'|'+a.sig).join('\n') : null;
  if(assetSigKey!==null && assetSigKey===state.assetSigKey && state.assetIndex && state.exactAssetIndex) return;
  const idx = new Map();
  const exact = new Map();
  const add=(token,a)=>{ token=slug(token); if(!token) return; if(!idx.has(token)) idx.set(token,[]); idx.get(token).push(a); };
  for(const a of assets){
    if(a.entityKind && a.entityId && (a.dataUrl||a.file)) exact.set(`${a.entityKind}:${slug(a.entityId)}`, a);
    const base = String(a.basename||a.url||'').split('/').pop();
    add(base.replace(/\.[^.]+$/,''), a); add(a.slug, a);
    for(const part of String(base).replace(/\.[^.]+$/,'').split(/[^a-z0-9]+/i)) add(part,a);
    const text = String(a.text||'');
    if(text && text.length<500000 && /"frames"\s*:/i.test(text)){
      try {
        const j = JSON.parse(text);
        const frames = j.frames || {};
        for(const k of Object.keys(frames).slice(0,4000)) add(k.replace(/\.[^.]+$/,''), {...a, atlasFrame:k, atlasMeta:j.meta||null});
      } catch {}
    }
  }
  state.assetIndex = idx; state.exactAssetIndex = exact; state.assetSigKey = assetSigKey;
}
function assetCandidatesFor(id,name){
  const toks = [id, name, String(id||'').replace(/-/g,''), String(name||'').replace(/\s+/g,'-')].map(slug).filter(Boolean);
  const out=[]; const seen=new Set();
  for(const t of toks){ for(const a of state.assetIndex.get(t)||[]){ const k=(a.url||'')+'|'+(a.atlasFrame||''); if(!seen.has(k)){seen.add(k); out.push(a);} } }
  return out;
}
function usableImageUrl(a){
  if(!a||a.atlasFrame)return null; // A frame needs cropping; its JSON/sprite sheet is not an icon.
  if(typeof a.dataUrl==='string'&&/^data:image\//i.test(a.dataUrl))return a.dataUrl;
  // on the website a picture is a file of its own (data/img/<hash>.<ext>), downloaded only when it is shown
  if(typeof a.file==='string'&&/^data\/img\/[\w.-]+$/.test(a.file))return a.file;
  const url=String(a.url||'');
  if(/^https?:/i.test(url)&&/\.(png|jpe?g|gif|webp|svg|avif)(?:[?#]|$)/i.test(url))return url;
  return null;
}
function assetUrlFor(id,name,hint=''){
  const exact=state.exactAssetIndex?.get(hint+':'+slug(id));const exactUrl=usableImageUrl(exact);if(exactUrl)return exactUrl;
  const candidates=assetCandidatesFor(id,name).filter(a=>usableImageUrl(a));
  candidates.sort((a,b)=>Number(!!(b.dataUrl||b.file))-Number(!!(a.dataUrl||a.file)));
  return usableImageUrl(candidates[0]);
}
// a real game picture only (exact asset, never a guess or a drawn placeholder) - null when the game's art is not recorded
// Every enchant pulse runs on one clock taken from the time of day: an enchanted picture starts its 2.6 s pulse at the
// point the clock is at, so a redraw, a refresh or a reload carries on where it was, and all pulses stay in step.
// Only the page area and the Home page are watched (not the map).
(function pulseClock(){
  const P=2600,SEL='.wp-pic[class*="e-glow-"] img,.splash-ico-wrap[class*="e-glow-"] img';
  const sync=root=>{if(!root||!root.querySelectorAll)return;const els=[...root.querySelectorAll(SEL)];if(root.matches&&root.matches(SEL))els.push(root);
    const d=-(Date.now()%P)+'ms';for(const e of els)e.style.animationDelay=d};
  const watch=el=>{if(!el||el.dataset.pulseClock)return;el.dataset.pulseClock='1';sync(el);
    new MutationObserver(ms=>{for(const m of ms){if(m.type==='attributes'){const box=m.target.closest&&m.target.closest('.wp-pic,.splash-ico-wrap');if(box)sync(box)}else m.addedNodes.forEach(n=>{if(n.nodeType===1)sync(n)})}})
      .observe(el,{childList:true,subtree:true,attributes:true,attributeFilter:['class']})};
  const start=()=>{watch(document.getElementById('content'));const sp=document.getElementById('atlasSplash');if(sp)watch(sp);
    new MutationObserver(()=>{const s=document.getElementById('atlasSplash');if(s)watch(s)}).observe(document.body,{childList:true})};
  if(document.body)start();else document.addEventListener('DOMContentLoaded',start);
})();
globalThis.bxcAssetImg=(id,hint)=>{try{return usableImageUrl(state.exactAssetIndex?.get(hint+':'+slug(id)))||null}catch(_){return null}};
const baseMonsterImg = (typeof monsterImg==='function') ? monsterImg : null;
const baseItemImg = (typeof itemImg==='function') ? itemImg : null;
// Image errors do not bubble, so capture them for dynamically rendered cards as well.
content?.addEventListener('error',event=>{
  const img=event.target;if(img?.tagName!=='IMG'||!img.classList.contains('itemthumb')||img.dataset.collectorFallback)return;
  img.dataset.collectorFallback='1';
  if(baseItemImg){img.src=baseItemImg({id:img.alt||'item',item:img.alt||'Item',skill:'Artwork unavailable'});img.title='Game artwork unavailable; showing a placeholder.';}
},true);

// a named NPC (Banker, Binxonia Guard) has its own picture in its own gear: "monster:npc-<slug of its name>"
function namedNpcImgUrl(typeId,name){const n=slugId(name);return n&&n!==slugId(typeId)?usableImageUrl(state.exactAssetIndex?.get('monster:npc-'+n))||null:null}
if(baseMonsterImg) monsterImg = m => namedNpcImgUrl(m.typeId,m.name) || assetUrlFor(m.typeId,m.name,'monster') || baseMonsterImg(m);
if(baseItemImg) itemImg = r => assetUrlFor(r.id||r.typeId||r.item,r.item||r.name,'item') || assetUrlFor(r.id||r.typeId||r.item,r.item||r.name,'resource') || baseItemImg(r);
// e.g. ' (titan x2, sage x1)' for an item some of whose drops carried enchants
function enchantNote(r){const e=Object.entries(r&&r.enchants||{}).sort((a,b)=>b[1]-a[1]);return e.length?' <span class="muted">('+e.map(([k,n])=>esc(k)+' ×'+n).join(', ')+')</span>':''}
// A row of entity chips (a monster's drop list, an item's source-monster list) - kept to one row, with anything
// past the first CAP hidden (a plain `hidden` attribute right on each extra chip, not wrapped in a container) so
// that clicking "+N more" reveals them as direct flex children of the same row - they join the existing grid on
// however many more rows of CAP columns it takes, instead of a <details> disclosure stacking them one per line.
// The extra chips keep the chip-row-extra marker so the click handler (see the delegated listener near the other
// tab click handlers) can tell them apart from the always-shown ones and toggle them back into hiding again -
// the button never removes itself, it just flips between "+N more" and "Show less".
function chipRowHtml(chips,cap=4){
  if(!chips.length)return '<div class="chip-row"></div>';
  if(chips.length<=cap)return '<div class="chip-row">'+chips.join('')+'</div>';
  const mark=html=>html.replace('<div class="entity-chip','<div hidden class="entity-chip chip-row-extra');
  const shown=chips.slice(0,cap).join('');
  const rest=chips.slice(cap).map(mark).join('');
  return '<div class="chip-row">'+shown+'<button type="button" class="chip-row-more-btn" data-label="+'+(chips.length-cap)+' more">+'+(chips.length-cap)+' more</button>'+rest+'</div>';
}
// Armor and weapons roll a quality tier (ordinary/fine/superior/etc. - see background.js's qualityName) and can
// come out enchanted; potions, materials and everything else can't, so there is nothing to show for them. Same
// keyword heuristic atlas-core.js's itemImg icon generator already uses to tell equipment apart from other items.
function isEquipmentName(name){return /sword|dagger|mace|spear|bow|crossbow|staff|armor|torso|head|legs|feet|arms|shield/i.test(String(name||''))}
// A short "quality" line for a drop-rate row: the non-ordinary quality tiers as a share of that item's own
// recorded drops (ordinary itself is the assumed default and not worth calling out), plus how often it came
// enchanted at all - both from the same drops data the drop-rate percentage above already uses.
function qualityNote(r){
  if(!isEquipmentName(prettyId(r.itemTypeId)))return '';
  const nonOrdinary=Object.entries(r.qualities||{}).filter(([k])=>!/^ordinary$/i.test(k)).sort((a,b)=>b[1]-a[1]);
  const enchantTotal=Object.values(r.enchants||{}).reduce((a,b)=>a+b,0);
  const parts=[];
  // with only a few of the item seen, a share says too much (one Excellent sword read as "100% Excellent"): show counts
  // until there are 10, then the share
  const few=r.totalQty<10,share=n=>few?n+' of '+r.totalQty:Math.round(100*n/r.totalQty)+'%';
  for(const [k,n] of nonOrdinary.slice(0,2))parts.push(few?prettyId(k)+': '+share(n):share(n)+' '+prettyId(k));
  if(enchantTotal)parts.push(few?'Enchanted: '+share(enchantTotal):share(enchantTotal)+' enchanted');
  return parts.length?'<span class="entity-chip-quality">'+parts.map(esc).join(' · ')+'</span>':'';
}
function dropRowsForMonster(typeId){ return [...state.dropAgg.values()].filter(x=>x.monsterTypeId===typeId).sort((a,b)=>b.events-a.events||b.totalQty-a.totalQty); }
function dropTotalsBySource(rows){
  const totals=new Map();
  for(const r of rows) totals.set(r.sourceType, (totals.get(r.sourceType)||0)+r.events);
  return totals;
}
// Small item icon for a Drops table row. Uses the captured game art when there is any (same lookup
// as the Items tab), otherwise the placeholder; the shared itemthumb error handler covers bad images.
function dropIconHtml(itemTypeId){
  return `<img class="thumb itemthumb dropicon-link" data-item="${esc(itemTypeId)}" title="Show in Items tab" src="${esc(itemImgFor(itemTypeId))}" alt="${esc(prettyId(itemTypeId))}" style="width:26px;height:26px;vertical-align:middle;margin-right:7px;border-radius:5px;cursor:pointer">`;
}
function dropsHtml(search=''){
  const s=String(search||'').toLowerCase().trim();
  // Monster drops come from the "drops" store, paired up from real npc.loot.take + inventory
  // events (see background.js) - that pairing is what the source/item/qty/share stats below need.
  const monsterRows=[...state.dropAgg.values()].filter(r=>r.monsterTypeId&&(!s||JSON.stringify(r).toLowerCase().includes(s))).sort((a,b)=>String(a.monsterTypeId).localeCompare(String(b.monsterTypeId))||b.events-a.events);
  const monsterTotals=dropTotalsBySource(monsterRows);
  const renderSet=(arr,label,getSource,totals)=>`<details class="collector-panel" open><summary class="collector-title">${label} (${arr.length})</summary><table class="research-table"><thead><tr><th>Source</th><th>Item</th><th>Events</th><th>Total qty</th><th>Qty range</th><th>Share of source drops</th><th>95% interval</th><th>Last seen</th><th></th></tr></thead><tbody>${arr.map(r=>{const total=totals.get(r.sourceType)||0,share=total?r.events/total:0,ci=typeof wilson95==='function'?wilson95(r.events,total):[0,0];const range=r.minQty===r.maxQty?fmt(r.minQty):`${fmt(r.minQty)}–${fmt(r.maxQty)}`;const sourceLabel=(r.elite?'⭐ ':'')+getSource(r);const sourceCell=r.monsterTypeId?`<span class="monsterlink" data-monster="${esc(r.monsterTypeId)}" title="Show in Bestiary" style="display:inline-flex;align-items:center;gap:7px;cursor:pointer"><img class="thumb monsterthumb" src="${esc(monsterImg({typeId:r.monsterTypeId,name:r.monsterName}))}" alt="" style="width:26px;height:26px;flex:none;border-radius:5px"><span>${esc(sourceLabel)}</span></span>`:esc(sourceLabel);return `<tr><td>${sourceCell}</td><td>${dropIconHtml(r.itemTypeId)}${esc(r.itemTypeId)}${enchantNote(r)}</td><td>${fmt(r.events)}</td><td>${fmt(r.totalQty)}</td><td>${range}</td><td>${total?(share*100).toFixed(1)+'%':'—'}</td><td>${total?(ci[0]*100).toFixed(1)+'–'+(ci[1]*100).toFixed(1)+'%':'—'}</td><td>${esc(when(r.lastSeen))}</td><td>${PUBLIC_MODE?'':`<button type="button" class="dropremove-btn" data-item="${esc(r.itemTypeId)}" data-monster="${esc(r.monsterTypeId||'')}" data-resource="${esc(r.resourceTypeId||'')}" data-elite="${r.elite?'1':'0'}" title="Delete every drop record behind this row">Remove</button>`}</td></tr>`}).join('')||'<tr><td colspan="9">No matching observed drops.</td></tr>'}</tbody></table></details>`;
  // Gathering (mining/fishing/woodcutting/etc.) is a completely separate mechanic from monster
  // loot - it already has its own reliable, direct source (gather.result messages carry the
  // resource's itemTypeId straight up, no inventory-diff guessing needed), computed in
  // deriveGatherStats(). Building this table from that instead of the generic "drops" store is
  // what keeps it from ever being contaminated by anything monster- or loot-related.
  const gatherRows=[...state.gather.values()].filter(r=>!s||JSON.stringify(r).toLowerCase().includes(s)).sort((a,b)=>b.total-a.total);
  const gatherSet=`<details class="collector-panel" open><summary class="collector-title">Gathered resources (${gatherRows.length})</summary><table class="research-table"><thead><tr><th>Resource</th><th>Attempts</th><th>Successes</th><th>Failures</th><th>Success rate</th><th>95% interval</th><th>Typical XP</th><th>Last seen</th></tr></thead><tbody>${gatherRows.map(r=>{const ci=typeof wilson95==='function'?wilson95(r.successes,r.total):[0,0];const rate=r.total?r.successes/r.total:0;return `<tr><td>${dropIconHtml(r.itemTypeId)}${esc(prettyId(r.itemTypeId))}</td><td>${fmt(r.total)}</td><td>${fmt(r.successes)}</td><td>${fmt(r.failures)}</td><td>${r.total?(rate*100).toFixed(1)+'%':'—'}</td><td>${r.total?(ci[0]*100).toFixed(1)+'–'+(ci[1]*100).toFixed(1)+'%':'—'}</td><td>${r.xpMode!=null?fmt(r.xpMode):'—'}</td><td>${esc(when(r.lastSeen))}</td></tr>`}).join('')||'<tr><td colspan="8">No gathering activity observed yet.</td></tr>'}</tbody></table></details>`;
  return accessoryDropRules()+`<div class="collector-panel"><div class="collector-title">Observed drops & yields</div><div class="statline"><span>${fmt(monsterRows.reduce((n,r)=>n+r.events,0))} monster drop events</span><span>${fmt(monsterRows.length)} monster-item pairs</span><span>${fmt(gatherRows.length)} resources gathered</span></div><div class="muted">Monster drops are observed outcomes from real kill-and-loot events, not authoritative drop rates. <b>Share of source drops</b> is each item's percentage of that monster's observed drop events — it can't account for kills that produced no logged drop at all, so read it as "of the drops we actually saw from this monster, how often was it this item," not a true per-kill chance. <b>Qty range</b> is the lowest and highest quantity actually observed in a single drop of that item (useful for stackable drops like coins) — it grows as more drops are observed. Gathered resources is a separate, unrelated mechanic tracked straight from gather attempts, so it can't mix with monster loot.</div></div>` + renderSet(monsterRows,'Monster drops',r=>r.monsterName||r.monsterTypeId||'Unknown', monsterTotals) + gatherSet;
}
function assetsHtml(search=''){
  const s=String(search||'').toLowerCase().trim();
  // Map tiles have their own self-hosted copy (tiles/, see the Map tab) - never list them here even if an old
  // snapshot still carries some captured before the harvester learned to skip them.
  const isTile=a=>/\/api\/maps?\/\d+\/tiles\//i.test(String(a.url||''));
  const all=(state.assets||[]).filter(a=>!isTile(a));
  const rows=all.filter(a=>!s||JSON.stringify([a.url,a.basename,a.kind,a.slug,a.atlasFrame]).toLowerCase().includes(s)).sort((a,b)=>String(a.kind).localeCompare(String(b.kind))||String(a.basename).localeCompare(String(b.basename))).slice(0,600);
  const notCaptured=all.filter(a=>!a.dataUrl&&!a.file&&!a.text&&!String(a.url).startsWith('render:')).length;
  return `<div class="collector-panel"><div class="collector-title">Visual asset catalog</div><div class="statline"><span>${fmt(all.length)} captured assets</span><span>${fmt(all.filter(a=>String(a.kind).includes('image')).length)} images</span><span>${fmt(all.filter(a=>a.text).length)} text/json assets</span></div><div class="muted">The collector stores a local copy of every public image and atlas/json asset your browser loads from Binxonia - never a live link back to binxonia.com. When an obvious match exists, those local copies are used as real monster/item/resource thumbnails.${notCaptured?` A background sweep keeps retrying the ${fmt(notCaptured)} not shown below yet (a fetch failed, or the file was too large at the time) roughly once a day until a local copy is captured.`:''}</div><div class="muted">Map tiles are stored separately: the whole world map pyramid is downloaded once and self-hosted alongside Atlas (see the Map tab) rather than loaded live from binxonia.com.</div></div><div class="collector-panel">${rows.map(a=>{
    const img=(a.dataUrl||a.file)?`<img class="thumb itemthumb" src="${esc(a.dataUrl||a.file)}" alt="${esc(a.basename||a.url)}" onerror="this.style.display='none'">`:`<div class="thumb itemthumb" title="Not captured locally yet - never shown as a live link" style="display:flex;align-items:center;justify-content:center;font-size:10px;color:#8a988c">Pending</div>`;
    // Never print the source URL: once captured, this is a local copy only, and even a pending one is never
    // shown as a link, so there is no reason to display where it originally came from either.
    const origin=(a.dataUrl||a.file||a.text)?'Locally hosted':'Pending local capture';
    return `<div class="itempreview">${img}<div><div><b>${esc(a.basename||a.url)}</b></div><div class="subresult">${esc(a.kind)} • ${esc(a.slug||'')} • ${fmt(a.size)} bytes</div><div class="muted">${origin}</div></div></div>`;
  }).join('')||'<div class="muted">No assets captured yet. Reload the game tab and let the collector observe the loaded public resources.</div>'}</div>`;
}

const NEWS_SEEN_KEY='binxoniaAtlasNewsLastSeenUrl';
function parseNewsHtml(html){
  const doc=new DOMParser().parseFromString(html,'text/html');
  return [...doc.querySelectorAll('main article')].map(a=>{
    const link=a.querySelector('h2 a');
    const dateEl=a.querySelector('p.faint');
    const excerptEl=a.querySelector('p.muted');
    const href=link?.getAttribute('href')||'';
    const [datePart,authorPart]=(dateEl?.textContent||'').split('·').map(s=>s.trim());
    return {
      title:link?.textContent.trim()||'Untitled',
      url:href?(href.startsWith('http')?href:`https://binxonia.com${href}`):null,
      date:datePart||'',
      author:(authorPart||'').replace(/^by\s+/i,''),
      excerpt:excerptEl?.textContent.trim()||''
    };
  });
}
async function loadNews(force=false){
  if(state.newsLoading)return;
  if(state.newsLoaded&&!force){if(tab==='news')content.innerHTML=newsHtml();return;}
  state.newsLoading=true;
  if(tab==='news')content.innerHTML='<div class="note">Loading news from binxonia.com…</div>';
  try{
    const res=await bridgeRequest('fetch-news');
    if(!res?.ok)throw new Error(res?.error||'Could not fetch news');
    state.news=parseNewsHtml(res.html);
    state.newsLoaded=true;
    state.newsError=null;
  }catch(err){
    state.newsError=err.message;
  }
  state.newsLoading=false;
  if(tab==='news')content.innerHTML=newsHtml();
}
function markNewsSeen(){
  if(state.news.length&&state.news[0].url)try{localStorage.setItem(NEWS_SEEN_KEY,state.news[0].url);}catch{}
  if(tab==='news')content.innerHTML=newsHtml();
}
function newsHtml(){
  if(state.newsError)return `<div class="collector-panel"><div class="collector-title">Binxonia News</div><div class="note">Couldn't load news: ${esc(state.newsError)}<br><button type="button" id="newsRetry">Retry</button></div></div>`;
  if(!state.newsLoaded)return `<div class="note">Loading news from binxonia.com…</div>`;
  let lastSeenUrl=null;try{lastSeenUrl=localStorage.getItem(NEWS_SEEN_KEY);}catch{}
  const lastSeenIdx=lastSeenUrl?state.news.findIndex(p=>p.url===lastSeenUrl):-1;
  const newCount=lastSeenUrl?(lastSeenIdx===-1?state.news.length:lastSeenIdx):0;
  return `<div class="collector-panel"><div class="collector-title">Binxonia News</div><div class="statline"><span>${fmt(state.news.length)} posts loaded</span>${newCount?`<span class="good">${fmt(newCount)} new since your last visit</span>`:''}</div><div class="muted">Pulled straight from <a href="https://binxonia.com/news/" target="_blank" rel="noopener">binxonia.com/news</a>. The collector doesn't try to auto-interpret these — if a post mentions something that affects crafting, gathering, drops, or a recipe already built into the collector, point it out and it can be updated deliberately.</div><button type="button" id="newsRefresh">Refresh</button>${newCount?` <button type="button" id="newsMarkSeen">Mark all as read</button>`:''}</div>` +
  (state.news.length?state.news.map((p,i)=>`<div class="card"${i<newCount?' style="border-color:#7a5c30"':''}><div class="name">${i<newCount?'<span class="pill">New</span> ':''}${esc(p.title)}</div><div class="s muted">${esc(p.date)}${p.author?' · by '+esc(p.author):''}</div><div class="s">${esc(p.excerpt)}</div>${p.url?`<a href="${esc(p.url)}" target="_blank" rel="noopener">Read on binxonia.com →</a>`:''}</div>`).join('')
  :'<div class="note">No posts found — binxonia.com/news may have changed its layout.</div>');
}

  function deriveResearch(){
    const known=new Set([...(D.gems||[]).map(x=>x.typeId),...(RECIPES||[]).map(x=>x.id),...(GATHERABLES||[]).map(x=>slug(x.item))]);
    state.unknownItems=(snapshot?.inventoryTypes||[]).filter(x=>!known.has(x.typeId)).sort((a,b)=>(b.lastSeen||0)-(a.lastSeen||0));
    const knownProtocol=/^(?:_collector\.|world\.|npc\.|inventory\.|skills?\.|gather\.|gem\.|exp\.|character\.|combat\.|loot\.|ground\.|death\.|chat\.|bank\.|craft\.|equipment\.|quest\.|player\.|party\.|guild\.|friend\.|trade\.|shop\.|vendor\.|map\.|warp\.|error\.|system\.)/i;
    state.unknownMessages=(snapshot?.messageTypes||[]).filter(x=>!knownProtocol.test(String(x.type||''))).sort((a,b)=>(b.count||0)-(a.count||0));
    const wm=new Map();for(const o of snapshot?.worldObjects||[]){const id=String(o.typeId||'unknown');if(!wm.has(id))wm.set(id,{typeId:id,count:0,lastSeen:0,examples:[]});const r=wm.get(id);r.count++;r.lastSeen=Math.max(r.lastSeen,o.lastSeen||0);if(r.examples.length<3)r.examples.push(o)}
    state.worldTypes=[...wm.values()].sort((a,b)=>b.count-a.count||a.typeId.localeCompare(b.typeId));
  }

  function deriveMonsters(){
    const groups=new Map();
    const all=[...(snapshot?.npcObservations||[]),...(snapshot?.npcs||[])];
    for(const n of all){if(!n?.typeId)continue;const t=String(n.typeId);if(!groups.has(t))groups.set(t,{typeId:t,ids:new Set(),eliteIds:new Set(),levels:[],locations:[],origins:[],lastSeen:0,name:n.name||t,npcClass:n.npcClass||null});const r=groups.get(t);if(n.id)r.ids.add(String(n.id));if(n.id&&n.elite)r.eliteIds.add(String(n.id));if(num(n.level)!==null)r.levels.push(num(n.level));const p=n.position;if(p&&num(p.x)!==null&&num(p.y)!==null&&r.locations.length<300)r.locations.push({x:num(p.x),y:num(p.y),z:num(p.z),time:n.time||n.lastSeen||0});const op=n.originPosition;if(op&&num(op.x)!==null&&num(op.y)!==null&&r.origins.length<100)r.origins.push({x:num(op.x),y:num(op.y),z:num(op.z),time:n.time||n.lastSeen||0});r.lastSeen=Math.max(r.lastSeen,n.time||n.lastSeen||0);if(n.name)r.name=n.name;if(n.npcClass)r.npcClass=n.npcClass}
    for(const [t,r] of groups){
      const ids=new Set([...(staticIdsByType.get(t)||[]),...r.ids]);const base=staticCatalogBase.get(t)||{count:0,min:null,max:null};const levels=[...r.levels];if(num(base.min)!==null)levels.push(num(base.min));if(num(base.max)!==null)levels.push(num(base.max));r.liveCount=r.ids.size;r.combinedCount=ids.size||base.count||0;r.minLevel=levels.length?Math.min(...levels):null;r.maxLevel=levels.length?Math.max(...levels):null;
      r.eliteObserved=r.eliteIds.size;r.eliteRate=r.ids.size?r.eliteIds.size/r.ids.size:null;
    }
    state.monster=groups;
    for(const m of D.catalog||[]){const r=groups.get(m.typeId);const base=staticCatalogBase.get(m.typeId)||{};m.count=r?r.combinedCount:(base.count||0);m.obsMinLevel=r?.minLevel??base.min??m.obsMinLevel;m.obsMaxLevel=r?.maxLevel??base.max??m.obsMaxLevel;m.collectorCount=r?.liveCount||0;m.collectorLastSeen=r?.lastSeen||null;m.eliteObserved=r?.eliteObserved||0;m.eliteRate=r?.eliteRate??null;}
    for(const [t,r] of groups){
      if(knownCatalogIds.has(t))continue;knownCatalogIds.add(t);D.catalog.push({typeId:t,name:r.name||prettyId(t),baseLevel:r.minLevel||'—',family:r.npcClass||'unclassified',archetype:'collector-only',attackType:'unknown',resists:'',weakTo:'',maxHp:null,attackDamage:null,xp:null,attackStyle:'unknown',castSchool:null,attackRange:null,cooldownMs:null,aggroRange:null,scale:null,locomotion:null,wanderRange:null,lootTableId:null,humanoidRig:false,classCapable:false,dropsGems:false,passive:false,mechanics:'Captured live by the research collector; no matching static client definition was in the bundled database.',count:r.combinedCount,obsMinLevel:r.minLevel,obsMaxLevel:r.maxLevel,collectorOnly:true,collectorCount:r.liveCount,collectorLastSeen:r.lastSeen,eliteObserved:r.eliteObserved||0,eliteRate:r.eliteRate??null});
    }
  }

  function tooltipObject(o){const p=o.position||{};return `<b>${esc(resourceLabel(o))}</b><br>${esc(o.typeId||'')}<br>World: ${esc(p.x)}, ${esc(p.y)}${p.z!=null?', '+esc(p.z):''}<br>Status: ${esc(o.status||'—')}${CLICK_HINT}`}
  // ---- Map legend ---------------------------------------------------------------------------
  // One panel on the map replaces the old scattered layer boxes. Everything is shown by default
  // except live monster positions and the official POIs. Choices are remembered between visits.
  // Bumped to V2 so the new 'monsters' default (off) actually takes effect for anyone who already had a saved
  // legend - a stored preference otherwise wins over a new default (see the merge below), which would silently
  // keep the very thing this change turns off.
  const LEGEND_KEY='binxoniaAtlasMapShowV4';   // V4: by default only places and entrances; what you pick brings up its own icons
  const legendState=(()=>{
    // No 'monsters' toggle any more: individual sighting/origin markers never render at all now (see
    // applyLegendVisibility) - with a large enough history that was thousands of persistent map markers at
    // once, which is what made panning the map so slow. drawRegionStats' 'regionLabels' icon above is the
    // replacement - one icon per game-defined area instead of one marker per sighting.
    const d={master:{self:true,areas:false,resources:false,entrances:true,pois:true,trainers:true,questGivers:true,regionLabels:false,bossTimers:true},hiddenResources:new Set(),collapsed:false,open:{}};
    try{
      const s=JSON.parse(localStorage.getItem(LEGEND_KEY)||'null');
      if(s){
        Object.assign(d.master,s.master||{});
        for(const r of s.hiddenResources||[])d.hiddenResources.add(r);
        d.collapsed=!!s.collapsed;d.open=s.open&&typeof s.open==='object'?s.open:{};
      }
    }catch{}
    return d;
  })();
  // the Resources menu starts closed each visit, and closes when you click anywhere else
  legendState.open.res=false;
  document.addEventListener('click',e=>{if(legendState.open.res&&!e.target.closest('.bxc-chip-more')){legendState.open.res=false;const d=document.querySelector('.bxc-chip-more');if(d)d.open=false}});
  function saveLegend(){
    try{localStorage.setItem(LEGEND_KEY,JSON.stringify({master:legendState.master,hiddenResources:[...legendState.hiddenResources],collapsed:legendState.collapsed,open:legendState.open}))}catch{}
  }
  const CLICK_HINT='<br><span style="opacity:.7">Click to open in the field guide</span>';
  const famLayers=new Map();   // family -> {stat, orig, live}: layer groups so a whole family can be shown or hidden
  const famStats=new Map();    // family -> {stat, orig, live}: marker counts shown in the legend
  function famGroups(fam){let g=famLayers.get(fam);if(!g){g={stat:L.layerGroup(),orig:L.layerGroup()};famLayers.set(fam,g)}return g}
  function famStat(fam){let s=famStats.get(fam);if(!s){s={stat:0,orig:0};famStats.set(fam,s)}return s}
  const familyColor=fam=>`hsl(${hueFor(fam)},62%,56%)`;
  function familyOf(typeId){return catalogFamily.get(typeId)||'unclassified'}

  // Monster markers use the monster's own captured artwork. There can be a couple of thousand of
  // them, so each monster's picture is registered once as a CSS rule and every marker for that
  // monster just points at the rule, instead of carrying its own copy of the image data.
  const monsterIconRules=new Map();   // typeId -> {url, cls}
  const monsterIconCache=new Map();   // class|family|elite -> L.DivIcon
  let monsterIconSheet=null, monsterIconSeq=0;
  function monsterIconClass(typeId,name){
    const url=npcIconUrl(typeId,name);
    if(!url)return null;
    let e=monsterIconRules.get(typeId);
    if(!e||e.url!==url){ // new artwork (or refreshed art) gets a fresh rule
      if(!monsterIconSheet){const st=document.createElement('style');st.id='bxc-monster-icons';document.head.appendChild(st);monsterIconSheet=st.sheet}
      const cls='bxc-mi-'+(++monsterIconSeq);
      try{monsterIconSheet.insertRule(`.${cls}{background-image:url("${String(url).replace(/"/g,'%22')}")}`,monsterIconSheet.cssRules.length)}catch{return null}
      e={url,cls};monsterIconRules.set(typeId,e);
    }
    return e.cls;
  }
  // The icon is the monster's artwork inside a ring in its family colour (matching the legend);
  // returns null when no artwork has been captured for it yet, and the caller falls back to a dot.
  function monsterLocIcon(typeId,name,fam,elite){
    const cls=monsterIconClass(typeId,name);
    if(!cls)return null;
    const key=cls+'|'+fam+'|'+(elite?1:0);
    let icon=monsterIconCache.get(key);
    if(!icon){
      icon=L.divIcon({className:'bxc-mi-wrap',html:`<div class="bxc-mi ${cls}${elite?' elite':''}" style="border-color:${familyColor(fam)}">${elite?'<b>⭐</b>':''}</div>`,iconSize:[26,26],iconAnchor:[13,13]});
      monsterIconCache.set(key,icon);
    }
    return icon;
  }

  const monsterAreaIconCache=new Map();
  function monsterAreaIcon(typeId,name,fam,elite,count){
    const cls=monsterIconClass(typeId,name);
    if(!cls)return null;
    const key=cls+'|'+fam+'|'+(elite?1:0)+'|'+count;
    let icon=monsterAreaIconCache.get(key);
    if(!icon){
      icon=L.divIcon({className:'bxc-mi-wrap',html:`<div class="bxc-mi ${cls}${elite?' elite':''}" style="border-color:${familyColor(fam)}">${elite?'<b>⭐</b>':''}${count>1?'<i class="bxc-mi-n">'+count+'</i>':''}</div>`,iconSize:[26,26],iconAnchor:[13,13]});
      monsterAreaIconCache.set(key,icon);
    }
    return icon;
  }

  // The baked-in "Observed NPCs" markers from the static database are grouped by family, so they
  // follow the same family toggles as the captured positions. They are rebuilt whenever the set of
  // captured artwork changes, so a dot upgrades to the monster's icon once its art arrives.
  const staticSources=[];
  let staticFamiliesReady=false, staticBuiltSig=null;
  function initStaticMonsterFamilies(){
    if(typeof monsterLayer==='undefined')return;
    const sig=String(state.assetSigKey||'');
    if(staticFamiliesReady&&sig===staticBuiltSig)return;
    if(!staticFamiliesReady){
      staticFamiliesReady=true;
      const layers=monsterLayer.getLayers();monsterLayer.clearLayers();
      layers.forEach((cm,i)=>{
        const m=D.markers[i];
        if(!m){monsterLayer.addLayer(cm);return}
        const tt=cm.getTooltip();
        staticSources.push({m,tip:tt?String(tt.getContent()):''});
      });
    }
    staticBuiltSig=sig;
    for(const g of famLayers.values())g.stat.clearLayers();
    for(const s of famStats.values())s.stat=0;
    for(const {m,tip} of staticSources){
      const fam=m.family||catalogFamily.get(m.typeId)||'unclassified';
      const ll=latlng(m,true),icon=monsterLocIcon(m.typeId,m.name,fam,false);
      const cm=icon?L.marker(ll,{icon}):L.circleMarker(ll,{radius:4,weight:1,color:'#140b05',fillColor:familyColor(fam),fillOpacity:1});
      cm.bindTooltip(tip+CLICK_HINT,{sticky:true});
      cm.on('click',ev=>{if(armedPassthrough(ev))return;goToMonsterCard(m.typeId)});
      famGroups(fam).stat.addLayer(cm);famStat(fam).stat++;
    }
  }

  // A "map rework" invalidates old monster sightings within one specific outdoor region without touching
  // anything recorded outside it, or after the rework - same list as background.js's REGION_REWORKS (for
  // get-monster-areas, what the in-game Map panel reads); duplicated here since Atlas builds its own overworld
  // monster clusters straight from snapshot.npcs/regions rather than going through that command. Nothing is
  // deleted - an old sighting inside a reworked region just stops counting toward where the map says a monster
  // kind tends to be.
  const REGION_REWORKS=[
    { region:'Wastelands', cutoff: Date.UTC(2026,8,25,16,0,0) },   // "The Wastelands Fill In", Sep 25 2026
  ];
  function pointInPolygon(x,y,poly){
    let inside=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const xi=poly[i].x,yi=poly[i].y,xj=poly[j].x,yj=poly[j].y;
      if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;
    }
    return inside;
  }
  function staleReworkPoint(x,y,time){
    if(!REGION_REWORKS.length)return false;
    const t=Number(time)||0;
    for(const rework of REGION_REWORKS){
      for(const r of snapshot?.regions||[]){
        if(r.name!==rework.region||!Array.isArray(r.polygons))continue;
        for(const poly of r.polygons)if(Array.isArray(poly)&&poly.length>=3&&t<rework.cutoff&&pointInPolygon(x,y,poly))return true;
      }
    }
    return false;
  }
  const SEEN_LINK=25;   // sightings closer than this (tiles) count as one area
  // Region outlines (game areas) live in their own map pane underneath everything else, so cave and building
  // entrances, resources and monsters always sit above them and stay clickable even when an outline covers them.
  const AREA_PANE='bxcAreas';
  function ensureAreaPane(){
    if(!map.getPane(AREA_PANE)){const p=map.createPane(AREA_PANE);p.style.zIndex=350}
    return AREA_PANE;
  }
  // Grid-binned union-find: points land in eps-sized cells, and only ADJACENT OCCUPIED CELLS get merged (not
  // every pair of points within eps of each other) - cost scales with point count and cell count, never with how
  // many points happen to land in one cell. The original version compared every point against every other point
  // sharing (or neighbouring) its cell, which stayed fine while sightings were spread thin but went quadratic the
  // moment a lot of them piled into one area - exactly what the reworked Wastelands did (thousands of sightings
  // in a small span), and it froze the page hard enough that even dragging the map stopped responding.
  function clusterPoints(pts,eps){
    const cellMap=new Map();
    for(let i=0;i<pts.length;i++){
      const key=Math.floor(pts[i].x/eps)+','+Math.floor(pts[i].y/eps);
      (cellMap.get(key)||cellMap.set(key,[]).get(key)).push(i);
    }
    const keys=[...cellMap.keys()];
    const parent=new Map(keys.map(k=>[k,k]));
    const find=k=>{while(parent.get(k)!==k){parent.set(k,parent.get(parent.get(k)));k=parent.get(k);}return k;};
    for(const key of keys){
      const [cx,cy]=key.split(',').map(Number);
      for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){
        const nk=(cx+dx)+','+(cy+dy);
        if(cellMap.has(nk)){const ra=find(key),rb=find(nk);if(ra!==rb)parent.set(ra,rb);}
      }
    }
    const groups=new Map();
    for(const key of keys){
      const root=find(key),arr=groups.get(root)||groups.set(root,[]).get(root);
      for(const i of cellMap.get(key))arr.push(pts[i]);
    }
    return [...groups.values()];
  }
  function regionLevelRange(cluster){
    const levels=(cluster||[]).map(p=>p.level).filter(Number.isFinite);
    if(!levels.length)return null;
    const lo=Math.min(...levels),hi=Math.max(...levels);
    return lo===hi?String(lo):`${lo}–${hi}`;
  }
  // One label per real area, using the game's OWN named regions (the same polygons drawGameAreas draws) rather
  // than a self-invented radius-based clustering - the map makers already drew "WL: Vultures" etc, so there's no
  // need to guess area boundaries from point density. Each region is labelled with whichever monster kind is
  // actually most common among the sightings that landed inside its polygon(s).
  const REGION_STATS_MIN=10;
  let regionStatsLayer=null;
  function drawRegionStats(){
    if(typeof L==='undefined'||typeof map==='undefined'||typeof latlng!=='function')return;
    if(!regionStatsLayer)regionStatsLayer=L.layerGroup();
    regionStatsLayer.clearLayers();
    if(!legendState.master.regionLabels){if(map.hasLayer(regionStatsLayer))map.removeLayer(regionStatsLayer);return;}
    const pts=[];
    for(const n of snapshot?.npcs||[]){
      const p=n.position;
      if(!p||p.z||num(p.x)===null||num(p.y)===null)continue;
      if(staleReworkPoint(p.x,p.y,n.lastSeen))continue;
      pts.push({x:p.x,y:p.y,typeId:n.typeId,name:n.name,level:Number.isFinite(n.level)?n.level:null,elite:!!n.elite});
    }
    const regs=(snapshot?.regions||[]).filter(r=>!r.z&&Array.isArray(r.polygons)&&r.polygons.some(p=>Array.isArray(p)&&p.length>=3));
    // A game-defined area is often huge, and can easily hold more than one real hotspot - two separated
    // packs of the same species can even sit at different levels within the same named zone. So each
    // region gets sub-clustered spatially (not just averaged into one blob): SUBCLUSTER_LINK is the max gap
    // within one hotspot, chosen smaller than the old whole-region approach since these hotspots need to
    // stay distinguishable inside a single large polygon. REGION_STATS_MIN (10) is the same "is this actually
    // a concentration, not just a few stragglers" floor used everywhere else this session, applied per hotspot
    // rather than per whole region - a zone with two 15-sighting packs now gets two labels instead of one blob
    // of 30. The cross-candidate declutter pass below (DECLUTTER_LINK) still keeps any two hotspots that end
    // up close together - whether from the same region or from adjacent ones - from getting separate labels.
    const SUBCLUSTER_LINK=45;
    const candidates=[];
    for(const r of regs){
      const rings=r.polygons.filter(p=>Array.isArray(p)&&p.length>=3&&p.every(q=>num(q.x)!==null&&num(q.y)!==null));
      if(!rings.length)continue;
      // A cheap bounding-box check before the real point-in-polygon test, so scanning every sighting against
      // every region (there can be dozens of each) stays fast even with a very large sighting history.
      const boxes=rings.map(ring=>({ring,minX:Math.min(...ring.map(q=>q.x)),maxX:Math.max(...ring.map(q=>q.x)),minY:Math.min(...ring.map(q=>q.y)),maxY:Math.max(...ring.map(q=>q.y))}));
      const inside=pts.filter(p=>boxes.some(b=>p.x>=b.minX&&p.x<=b.maxX&&p.y>=b.minY&&p.y<=b.maxY&&pointInPolygon(p.x,p.y,b.ring)));
      if(inside.length<REGION_STATS_MIN)continue;
      for(const hotspot of clusterPoints(inside,SUBCLUSTER_LINK)){
        if(hotspot.length<REGION_STATS_MIN)continue;
        const counts=new Map();
        for(const p of hotspot)counts.set(p.typeId,(counts.get(p.typeId)||0)+1);
        let bestType=null,bestN=0;
        for(const [k,n] of counts)if(n>bestN){bestN=n;bestType=k;}
        const sameType=hotspot.filter(p=>p.typeId===bestType);
        const cx=hotspot.reduce((s,p)=>s+p.x,0)/hotspot.length,cy=hotspot.reduce((s,p)=>s+p.y,0)/hotspot.length;
        candidates.push({x:cx,y:cy,region:r,inside:hotspot,sameType,bestType,bestN,counts});
      }
    }
    // Game regions can nest (a specific sub-area like "OI: 37-42" sitting inside a bigger "Ogre Isle"), so their
    // labels often land almost on top of each other. Cluster the candidate label positions themselves and keep
    // only the most-confident one (highest count of its dominant monster) per local spot, same grid-merge
    // clusterPoints used elsewhere for cheap proximity grouping.
    const DECLUTTER_LINK=60;
    for(const group of clusterPoints(candidates,DECLUTTER_LINK)){
      const winner=group.reduce((a,b)=>b.bestN>a.bestN?b:a);
      const {region:r,inside,sameType,bestType,bestN,counts}=winner;
      const label=sameType.find(p=>p.name)?.name||prettyId(bestType);
      const lvl=regionLevelRange(sameType),weak=catalogWeak.get(bestType),resist=catalogResist.get(bestType);
      const eliteSeen=sameType.some(p=>p.elite);
      // A real monster icon (the same art used elsewhere on the map) rather than an invisible anchor, so this
      // reads at a glance as "this is the monster you'll find here" instead of just a floating label.
      const fam=familyOf(bestType);
      const areaIcon=monsterAreaIcon(bestType,label,fam,eliteSeen,bestN);
      const anchor=areaIcon?L.marker(latlng({x:winner.x,y:winner.y},true),{icon:areaIcon}):L.circleMarker(latlng({x:winner.x,y:winner.y},true),{radius:7,weight:2,color:'#0d1a10',fillColor:familyColor(fam),fillOpacity:1});
      const extra=[weak?`Weak: ${esc(weak)}`:'',resist?`Resists: ${esc(resist)}`:''].filter(Boolean).join(' · ');
      // Name + level always visible, permanent - that's the one thing worth reading at a glance while deciding
      // whether a zone is worth fighting in. Weak/resist and the region name/seen-count are more supplementary,
      // so they still only appear on hover rather than making every label a wall of text.
      const briefHtml=`<div class="bxc-region-label"><b>${esc(label)}</b>${lvl?` <span class="bxc-region-label-lvl">Lv ${esc(lvl)}</span>`:''}</div>`;
      const fullHtml=`<div class="bxc-region-label"><b>${esc(label)}</b>${lvl?` <span class="bxc-region-label-lvl">Lv ${esc(lvl)}</span>`:''}${extra?`<div class="bxc-region-label-sub">${extra}</div>`:''}<div class="bxc-region-label-area">${esc(r.name||'this area')} · ${inside.length} seen</div></div>`;
      anchor.bindTooltip(briefHtml,{permanent:true,direction:'top',offset:[0,-2],className:'bxc-region-label-tip'});
      anchor.on('mouseover',()=>anchor.setTooltipContent(fullHtml));
      anchor.on('mouseout',()=>anchor.setTooltipContent(briefHtml));
      // the other monsters in this spot, busiest first, for the map panel's "Also in this area"
      const others=[...counts].sort((a,b)=>b[1]-a[1]).map(x=>x[0]).filter(t=>t!==bestType);
      anchor.on('click',ev=>{if(armedPassthrough(ev))return;goToMonsterCard(bestType,{others})});
      anchor.addTo(regionStatsLayer);
    }
    if(!map.hasLayer(regionStatsLayer))regionStatsLayer.addTo(map);
  }
  // While placing a zone, entrance or resource, a click on a marker or region belongs to the map underneath.
  function armedPassthrough(ev){
    if(!(state.addZoneArmed||state.moveEntranceArmed||state.addResourceArmed))return false;
    map.fire('click',{latlng:ev.originalEvent?map.mouseEventToLatLng(ev.originalEvent):ev.latlng,originalEvent:ev.originalEvent});
    return true;
  }
  // The game's own named map regions (towns, biomes, and the monster-spawn areas the map makers
  // labelled such as "WL: Vultures"), as captured from the game. Drawn under the markers, off by
  // default in the legend; hovering shows the name, PvP mode and what scatters there.
  const AREA_STYLE_BASE={weight:1.5,dashArray:'5 5',opacity:1,fillOpacity:.05};   // outline solid; the faint fill only tints the ground under it
  const AREA_STYLE_SELECTED={weight:3,dashArray:null,opacity:1,fillOpacity:.22};
  let selectedAreaPoly=null;
  function drawGameAreas(){
    if(!gameAreaLayer)gameAreaLayer=L.layerGroup();
    gameAreaLayer.clearLayers();
    selectedAreaPoly=null;
    const area=ring=>{let a=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++)a+=(ring[j].x+ring[i].x)*(ring[j].y-ring[i].y);return Math.abs(a/2)};
    let regs=(snapshot?.regions||[]).filter(r=>!r.z&&Array.isArray(r.polygons)&&r.polygons.length);
    // The game resends every named region on each world load, keyed by its own id - a rework that reissues a
    // region under a new id (rather than updating the old one) leaves the old, now-stale id sitting in the
    // database forever, its polygon overlapping the new one under the same name. That's what made some areas
    // unclickable (two polygons stacked on the same spot, fighting each other for the click). One name, one
    // area: keep only the most-recently-seen id per name.
    const byName=new Map();
    for(const r of regs){
      const key=String(r.name||r.id).toLowerCase().trim();
      const prev=byName.get(key);
      if(!prev||(r.lastSeen||0)>(prev.lastSeen||0))byName.set(key,r);
    }
    regs=[...byName.values()];
    regs.sort((a,b)=>Math.max(...b.polygons.map(area))-Math.max(...a.polygons.map(area)));   // big first, so small areas stay hoverable on top
    for(const r of regs){
      const rings=r.polygons.filter(p=>Array.isArray(p)&&p.length>=3&&p.every(q=>num(q.x)!==null&&num(q.y)!==null));
      if(!rings.length)continue;
      const color=`hsl(${hueFor(r.name||r.id)},55%,62%)`;
      const scat=(r.scatterConfig||[]).map(s=>prettyId(s.typeId)).filter(Boolean);
      const poly=L.polygon(rings.map(p=>p.map(q=>latlng(q,true))),{...AREA_STYLE_BASE,color,fillColor:color,bubblingMouseEvents:false,className:'bxc-area',pane:ensureAreaPane()});
      poly.bindTooltip(`<b>${esc(r.name||'Unnamed area')}</b>${r.pvpMode&&r.pvpMode!=='none'?'<br>PvP: '+esc(r.pvpMode):''}${scat.length?'<br>Scatter: '+esc(scat.join(', ')):''}<br><span style="opacity:.7">Game-defined area</span>`,{sticky:true});
      // Trace the region's own polygon rather than relying on the browser's default focus rectangle (a plain
      // bounding box, not the actual shape) - clicking traces/highlights the real outline instead.
      poly.on('click',ev=>{
        if(armedPassthrough(ev))return;
        if(selectedAreaPoly&&selectedAreaPoly!==poly)selectedAreaPoly.setStyle(AREA_STYLE_BASE);
        if(selectedAreaPoly===poly){poly.setStyle(AREA_STYLE_BASE);selectedAreaPoly=null;}
        else{poly.setStyle(AREA_STYLE_SELECTED);poly.bringToFront();selectedAreaPoly=poly;}
      });
      poly.addTo(gameAreaLayer);
    }
  }
  // Makes the map match the legend: master switches add/remove whole layers, and the per-family
  // and per-resource choices add/remove the groups inside them.
  function applyLegendVisibility(){
    if(typeof map==='undefined')return;
    const setOn=(layer,on)=>{if(!layer)return;if(on){if(!map.hasLayer(layer))layer.addTo(map)}else if(map.hasLayer(layer))map.removeLayer(layer)};
    const setIn=(parent,child,on)=>{if(!parent||!child)return;if(on){if(!parent.hasLayer(child))parent.addLayer(child)}else if(parent.hasLayer(child))parent.removeLayer(child)};
    if(!resourceRoot)resourceRoot=L.layerGroup();
    setOn(selfLayer,legendState.master.self);
    // monsterLayer (every individual sighting/origin marker) is never attached to the map at all any more - a
    // large history made this thousands of persistent DOM markers, which is what made panning so slow (see
    // drawRegionStats' per-area icons above, and the boss-timer layer, for where monster info actually lives
    // now). The marker objects still get built (state.liveMarkersByType etc. still work for other features,
    // e.g. jumping to a monster from the field guide), they just never render on their own. Per-tick "Live
    // monster positions" was retired outright (not just hidden) for the same reason - drawRegionStats already
    // covers "what's here", so it was one more thousands-of-markers layer with no upside.
    setOn(resourceRoot,legendState.master.resources);
    setOn(zoneLayer,legendState.master.entrances);
    setOn(typeof poiLayer!=='undefined'?poiLayer:null,legendState.master.pois);
    for(const [key,lg] of state.resourceLayerByKey)setIn(resourceRoot,lg,!legendState.hiddenResources.has(key));
    setOn(gameAreaLayer,legendState.master.areas);
    setOn(trainerLayer,legendState.master.trainers);
    setOn(questGiverLayer,legendState.master.questGivers);
  }

  function getResourceLayer(key){
    let lg=state.resourceLayerByKey.get(key);
    if(!lg){
      lg=L.layerGroup();
      if(!resourceRoot)resourceRoot=L.layerGroup();
      if(!legendState.hiddenResources.has(key))resourceRoot.addLayer(lg);
      state.resourceLayerByKey.set(key,lg);
    }
    return lg;
  }
  function resourceSwatch(r){
    try{return resourceMarkerStyle(r.typeId||String(r.key).split('::')[0]).fillColor||'#7fd1ae'}catch{return '#7fd1ae'}
  }
  // What the map shows, as one row of on/off chips beside the zoom buttons (this replaced the old legend panel: you
  // find where something is by clicking it or with "Show on map", so the map only needs switches, not a key).
  // Resources has a small menu for each gathering skill. You and Bosses exist only in the app.
  function resourceTier(r){
    const id=String(r.yieldItem||'').toLowerCase();if(!id||typeof GATHERABLES==='undefined')return null;
    const g=GATHERABLES.find(x=>String(x.item).toLowerCase().replace(/[^a-z0-9]+/g,'-')===id);if(!g)return null;
    return g.level>=45?4:g.level>=30?3:g.level>=15?2:1;
  }
  function legendHtml(){
    const bySkill=new Map();
    for(const r of state.resourceCatalog.values()){const sk=r.skill||'other';if(!bySkill.has(sk))bySkill.set(sk,[]);bySkill.get(sk).push(r)}
    const skills=[...bySkill.keys()].sort((a,b)=>resourceCategoryLabel(a).localeCompare(resourceCategoryLabel(b)));
    const hiddenRes=legendState.hiddenResources;
    const skillRows=skills.map(sk=>{const items=bySkill.get(sk),on=items.filter(r=>!hiddenRes.has(r.key)).length,all=on===items.length;
      return `<label class="bxc-chip-opt"><input type="checkbox" data-res-skill="${esc(sk)}"${all?' checked':''}${on&&!all?' data-mixed="1"':''}> ${esc(resourceCategoryLabel(sk))}</label>`}).join('');
    // tiers across every skill: T1 from level 1, T2 from 15, T3 from 30, T4 from 45
    const byTier=new Map();for(const r of state.resourceCatalog.values()){const t=resourceTier(r);if(t)(byTier.get(t)||byTier.set(t,[]).get(t)).push(r)}
    const tierRows=[...byTier.keys()].sort((a,b)=>a-b).map(t=>{const items=byTier.get(t),on=items.filter(r=>!hiddenRes.has(r.key)).length,all=on===items.length;
      return `<label class="bxc-chip-opt bxc-chip-tier" title="Tier ${t}: level ${[1,15,30,45][t-1]}+"><input type="checkbox" data-res-tier="${t}"${all?' checked':''}${on&&!all?' data-mixed="1"':''}> T${t}</label>`}).join('');
    const chip=(key,label,color,title)=>`<label class="bxc-chip${legendState.master[key]?' on':''}" title="${esc(title)}"><input type="checkbox" data-master="${key}"${legendState.master[key]?' checked':''}><span class="bxc-sw" style="background:${color}"></span>${label}</label>`;
    return `<div class="bxc-show" role="group" aria-label="Show on the map">
      ${chip('regionLabels','Monsters','#f0a33b','The monster most seen in each area')}
      <span class="bxc-chip-group">${chip('resources','Resources','#7fd1ae','Rocks, trees, fishing spots and plants')}${skillRows?`<details class="bxc-chip-more" data-id="res"${legendState.open.res?' open':''}><summary title="Pick which resources" aria-label="Pick which resources"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3.5l3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></summary><div class="bxc-chip-menu"><div class="bxc-chip-menu-h">Skill</div>${skillRows}${tierRows?`<div class="bxc-chip-menu-h">Tier</div><div class="bxc-chip-tiers">${tierRows}</div>`:''}</div></details>`:''}</span>
      ${chip('pois','Places','#ffffff','Towns, dungeons and areas from the official map')}
      ${chip('entrances','Entrances','#3ad1ff','Cave, dungeon and building entrances (click one for its layout)')}
      ${chip('trainers','Trainers','#e6c34a','Skill trainers: where they stand, or the door of the building they are in')}
      ${chip('questGivers','Quests','#ffd24a','Quest-givers: people with a quest to give (click one for their quests)')}
      ${PUBLIC_MODE?'':chip('bossTimers','Bosses','#b8453a','Boss respawn timers')}
      ${PUBLIC_MODE?'':chip('self','You','#ffd54a','Your position')}
      ${chip('areas','Areas','#9db4d8','The game’s own named areas, outlined')}
    </div>`;
  }
  function addLegendStyle(){
    if(document.getElementById('bxc-legend-style'))return;
    const st=document.createElement('style');st.id='bxc-legend-style';
    st.textContent=`
.bxc-showbar.leaflet-control{clear:none;width:auto;max-width:calc(100vw - 90px);overflow:visible;background:rgba(28,23,16,.94);border:1px solid #4a3d28;border-radius:8px;padding:5px 6px;box-shadow:0 4px 16px rgba(0,0,0,.45)}
.bxc-show{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.bxc-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border:1px solid #4a3d28;border-radius:999px;cursor:pointer;color:#9c8f76;font:12px/1.3 'Segoe UI',Arial,sans-serif;user-select:none;white-space:nowrap}
.bxc-chip input{position:absolute;opacity:0;width:1px;height:1px}
.bxc-chip.on{color:#ecdfc0;border-color:#8a6430;background:rgba(196,144,63,.14)}
.bxc-chip:not(.on) .bxc-sw{opacity:.35}
.bxc-chip:focus-within{outline:2px solid #c4903f;outline-offset:1px}
.bxc-chip-group{display:inline-flex;align-items:center;position:relative}
.bxc-chip-more>summary{list-style:none;cursor:pointer;padding:3px 6px;color:#c4903f;font-size:12px}
.bxc-chip-more>summary::-webkit-details-marker{display:none}
.bxc-legend .bxc-chip-more{margin:0;padding:0;border:0}
.bxc-legend .bxc-chip-more>summary{text-transform:none;letter-spacing:0;display:block}
.bxc-legend .bxc-chip-more>summary::before{content:none}
.bxc-chip-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:5;min-width:150px;padding:6px 10px;background:#1c1710;border:1px solid #4a3d28;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.5)}
.bxc-chip-opt{display:flex;align-items:center;gap:6px;padding:3px 0;color:#ecdfc0;font:12px 'Segoe UI',Arial,sans-serif;cursor:pointer;white-space:nowrap}
.bxc-chip-opt input{accent-color:#c4903f;margin:0}
.bxc-chip-menu-h{margin:6px 0 2px;font:italic 11px Georgia,serif;color:#9c8f76}.bxc-chip-menu-h:first-child{margin-top:0}
.bxc-chip-tiers{display:flex;gap:10px}
.bxc-legend{width:238px;overflow:auto;background:rgba(18,35,27,.96);color:#e8eade;border:1px solid #5d6042;border-radius:10px;box-shadow:0 6px 22px rgba(0,0,0,.5);font:12px/1.4 'Segoe UI',Arial,sans-serif;cursor:auto}
.bxc-legend *{box-sizing:border-box}
.bxc-lg-head{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:linear-gradient(110deg,#20382b,#101d18 75%);border-bottom:1px solid #34483f;position:sticky;top:0;z-index:2}
.bxc-lg-title{font:small-caps 15px Georgia,serif;letter-spacing:.5px;color:#efd39a}
.bxc-lg-toggle{padding:1px 8px;background:#1d3027;color:#e8eade;border:1px solid #496051;border-radius:6px;cursor:pointer;font:12px 'Segoe UI',Arial,sans-serif}
.bxc-lg-toggle:hover{border-color:#d9b878;background:#2e4739}
.bxc-lg-body{padding:6px 10px 10px}
.bxc-lg-row{display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;min-width:0}
.bxc-legend input[type=checkbox]{accent-color:#d9b878;margin:0;flex:none}
.bxc-sw{width:10px;height:10px;border-radius:50%;flex:none;border:1px solid rgba(0,0,0,.55)}
.bxc-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bxc-legend .n{margin-left:auto;color:#8fa596;font-size:11px}
.bxc-legend details{margin:1px 0 5px 16px;padding-left:8px;border-left:1px solid #34483f}
.bxc-legend summary{cursor:pointer;color:#b9a77e;font-size:11px;letter-spacing:.6px;text-transform:uppercase;padding:2px 0;display:flex;align-items:center;gap:6px;list-style:none}
.bxc-legend summary::-webkit-details-marker{display:none}
.bxc-legend summary::before{content:'▸';width:10px;flex:none;color:#d9b878}
.bxc-legend details[open]>summary::before{content:'▾'}
.bxc-legend details details{margin-left:6px}
.bxc-lg-tools{display:flex;gap:6px;padding:3px 0}
.bxc-lg-tools button{padding:1px 8px;background:#1d3027;color:#e8eade;border:1px solid #496051;border-radius:6px;cursor:pointer;font:11px 'Segoe UI',Arial,sans-serif}
.bxc-lg-tools button:hover{border-color:#d9b878}
.bxc-lg-key{display:flex;align-items:center;gap:6px;margin-top:8px;padding-top:6px;border-top:1px solid #34483f;color:#b0c0b3}
.bxc-muted{color:#8fa596;font-size:11px;margin-top:6px;line-height:1.4}
.bxc-legend:focus-within{outline:none}
.bxc-mi-wrap{background:none;border:0}
.bxc-mi{position:relative;width:26px;height:26px;box-sizing:border-box;padding:1px;border:2px solid #78d86d;border-radius:50%;background-color:rgba(24,12,10,.62);background-size:contain;background-repeat:no-repeat;background-position:center;background-origin:content-box;box-shadow:0 0 3px rgba(0,0,0,.8)}
.bxc-mi.elite{box-shadow:0 0 0 2px #ffd54a,0 0 3px rgba(0,0,0,.8)}
.bxc-mi-n{position:absolute;bottom:-7px;right:-9px;min-width:15px;padding:0 3px;box-sizing:border-box;border-radius:8px;background:#1c1712;border:1px solid #b69c65;color:#f3e8d0;font:700 10px/13px Arial,sans-serif;text-align:center;font-style:normal}
.bxc-mi b{position:absolute;top:-9px;right:-8px;font:12px/1 sans-serif;filter:drop-shadow(0 0 2px #000)}
.bxc-region-label-tip,.bxc-boss-timer-tip{background:rgba(13,11,9,.88);color:#efd39a;border:1px solid #4a3a22;border-radius:5px;padding:3px 6px;font:10px/1.35 'Segoe UI',Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.5);white-space:nowrap;pointer-events:none}
.bxc-region-label-tip::before,.bxc-boss-timer-tip::before{border-top-color:#4a3a22!important}
.bxc-region-label-tip b{color:#f0d29a;font-weight:600;font-size:10.5px}
.bxc-region-label-lvl{opacity:.75;font-weight:400}
.bxc-region-label-sub{opacity:.8}
.bxc-region-label-area{opacity:.55;font-size:9px;margin-top:1px}
.bxc-boss-timer-tip{color:#ffb0a8;border-color:#5a2a24}
/* Clicking a game area used to show the browser's default focus rectangle (a plain bounding box, not the
   actual polygon shape) - the real click feedback is the traced-outline style set in drawGameAreas instead. */
.bxc-area:focus{outline:none}
`;
    document.head.appendChild(st);
  }
  function buildLegendControl(){
    const Legend=L.Control.extend({
      options:{position:'topleft'},
      onAdd(m){
        addLegendStyle();
        const c=L.DomUtil.create('div','leaflet-control bxc-legend bxc-showbar');
        L.DomEvent.disableClickPropagation(c);
        if(L.DomEvent.disableScrollPropagation)L.DomEvent.disableScrollPropagation(c);
        this._c=c;this._map=m;this._html='';
        m.on('resize',()=>this._fit());
        c.addEventListener('change',e=>{
          const t=e.target,d=t.dataset||{};
          if(d.master!==undefined){legendState.master[d.master]=t.checked}
          else if(d.resKey!==undefined){t.checked?legendState.hiddenResources.delete(d.resKey):legendState.hiddenResources.add(d.resKey)}
          else if(d.resTier!==undefined){for(const r of state.resourceCatalog.values())if(String(resourceTier(r))===d.resTier)t.checked?legendState.hiddenResources.delete(r.key):legendState.hiddenResources.add(r.key)}
          else if(d.resSkill!==undefined){for(const r of state.resourceCatalog.values())if((r.skill||'other')===d.resSkill)t.checked?legendState.hiddenResources.delete(r.key):legendState.hiddenResources.add(r.key)}
          else return;
          saveLegend();
          applyLegendVisibility();
          drawRegionStats();
          drawBossTimers();
          this.refresh();
        });
        c.addEventListener('click',e=>{
          if(e.target.closest('[data-collapse]')){legendState.collapsed=!legendState.collapsed;saveLegend();this.refresh()}
        });
        // 'toggle' does not bubble, so listen in the capture phase to remember which sections are open.
        c.addEventListener('toggle',e=>{const d=e.target;if(d&&d.tagName==='DETAILS'&&d.dataset.id&&legendState.open[d.dataset.id]!==d.open){legendState.open[d.dataset.id]=d.open;saveLegend()}},true);
        this.refresh();
        return c;
      },
      // Rebuilds the panel only when its content actually changed, keeping scroll position and
      // keyboard focus, so the periodic map refresh never disturbs someone who is using it.
      refresh(){
        const c=this._c;if(!c)return;
        const html=legendHtml();if(html===this._html)return;
        this._html=html;
        const top=c.scrollTop,a=document.activeElement;
        const focusSel=a&&c.contains(a)?['data-master','data-fam','data-res-key','data-res-skill'].map(n=>a.hasAttribute(n)?`[${n}="${(window.CSS&&CSS.escape)?CSS.escape(a.getAttribute(n)):a.getAttribute(n)}"]`:null).find(Boolean):null;
        c.innerHTML=html;
        c.querySelectorAll('input[data-mixed]').forEach(i=>{i.indeterminate=true});
        c.scrollTop=top;
        if(focusSel){try{c.querySelector(focusSel)?.focus({preventScroll:true})}catch{}}
        this._fit();
      },
      _fit(){}
    });
    return new Legend();
  }
  function drawSelfMarker(){
    if(typeof L==='undefined'||typeof map==='undefined'||typeof latlng!=='function')return;
    if(selfLayer)selfLayer.clearLayers();else{selfLayer=L.layerGroup();if(legendState.master.self)selfLayer.addTo(map)}
    for(const self of state.selves||[]){
      const p=self.position;
      if(!p||num(p.x)===null||num(p.y)===null)continue;
      if(p.z)continue;
      const marker=L.circleMarker(latlng(p,true),{radius:8,weight:2,color:'#3a2c05',fillColor:'#ffd54a',fillOpacity:1});
      const hp=self.stats?.hitpoints,maxHp=self.maxStats?.hitpoints;
      marker.bindTooltip(`<b>${self.name?esc(self.name):'You'}</b>${self.level!=null?' · Lv '+esc(self.level):''}${hp!=null?'<br>HP '+esc(hp)+(maxHp!=null?'/'+esc(maxHp):''):''}`,{direction:'top'});
      marker.addTo(selfLayer);
    }
  }
  function drawMap(){
    if(typeof L==='undefined'||typeof map==='undefined'||typeof latlng!=='function')return;
    console.time('drawMap:total');
    addLegendStyle();
    catalogFamily=new Map((D.catalog||[]).map(m=>[m.typeId,m.family||'unclassified']));
    catalogWeak=new Map((D.catalog||[]).map(m=>[m.typeId,m.weakTo||'']));
    catalogResist=new Map((D.catalog||[]).map(m=>[m.typeId,m.resists||'']));
    console.time('drawMap:initStaticMonsterFamilies');
    initStaticMonsterFamilies();
    console.timeEnd('drawMap:initStaticMonsterFamilies');
    for(const g of famLayers.values())g.orig.clearLayers();
    for(const s of famStats.values())s.orig=0;
    for(const lg of state.resourceLayerByKey.values())lg.clearLayers();
    if(zoneLayer)zoneLayer.clearLayers();else zoneLayer=L.layerGroup();
    drawSelfMarker();
    state.liveMarkersByType=new Map();
    // A monster with no baked-in location and no captured spawn origin (harpies, anything newer than
    // the static data) has no known spawn point, so its sightings are gathered per monster type and
    // drawn below as areas (one icon + outline per cluster) instead of one marker per sighting.
    const hasSpawnLoc=new Set(staticSources.map(s=>s.m.typeId));
    for(const n of snapshot?.npcs||[])if(n.originPosition&&num(n.originPosition.x)!==null&&num(n.originPosition.y)!==null&&!staleReworkPoint(n.originPosition.x,n.originPosition.y,n.lastSeen))hasSpawnLoc.add(n.typeId);
    const sightings=new Map();   // typeId -> {name,elite,pts}
    const pointsByType=new Map(),seenPt=new Set();   // typeId -> [{x,y}] for the World map panel's circles
    console.time('drawMap:npcLoop');
    for(const n of snapshot?.npcs||[]){
      if(!n.position||num(n.position.x)===null||num(n.position.y)===null)continue;
      const roams=ROAMING_NPC_TYPES.has(String(n.typeId||'').toLowerCase());
      const fam=familyOf(n.typeId),famFill=familyColor(fam);
      const stale=staleReworkPoint(n.position.x,n.position.y,n.lastSeen);
      {
        const o=n.originPosition,oOk=o&&num(o.x)!==null&&num(o.y)!==null&&!o.z&&!staleReworkPoint(o.x,o.y,n.lastSeen);
        const pt=oOk?o:(!n.position.z&&!stale?n.position:null);
        if(pt){const k=n.typeId+'|'+Math.round(pt.x/10)+'|'+Math.round(pt.y/10);if(!seenPt.has(k)){seenPt.add(k);(pointsByType.get(n.typeId)||pointsByType.set(n.typeId,[]).get(n.typeId)).push({x:pt.x,y:pt.y})}}
      }
      let marker=null;
      if(!roams&&!hasSpawnLoc.has(n.typeId)&&!n.position.z&&!stale){
        const s=sightings.get(n.typeId)||sightings.set(n.typeId,{name:n.name,elite:false,pts:[]}).get(n.typeId);
        s.pts.push({x:n.position.x,y:n.position.y,level:Number.isFinite(n.level)?n.level:null});
        if(n.elite)s.elite=true;
      }
      if(n.originPosition&&num(n.originPosition.x)!==null&&num(n.originPosition.y)!==null&&!staleReworkPoint(n.originPosition.x,n.originPosition.y,n.lastSeen)){
        const locIcon=monsterLocIcon(n.typeId,n.name,fam,!!n.elite);
        const originMarker=locIcon?L.marker(latlng(n.originPosition,true),{icon:locIcon}):L.circleMarker(latlng(n.originPosition,true),n.elite?{radius:roams?7:5,weight:2,color:'#ffd54a',fillColor:famFill,fillOpacity:1}:{radius:roams?6:4,weight:1,color:'#0d1a10',fillColor:famFill,fillOpacity:1});
        originMarker.bindTooltip(`<b>${esc(n.name||n.typeId)}</b>${n.elite?'<br><b style="color:#ffd54a">⭐ Elite seen</b>':''}<br>${roams?'Roams — shown at its fixed reference position instead of a live-tracked dot':'Captured originPosition'}<br>${esc(n.originPosition.x)}, ${esc(n.originPosition.y)}${CLICK_HINT}`,{sticky:true});
        originMarker.addTo(famGroups(fam).orig);famStat(fam).orig++;
        originMarker.on('click',ev=>{if(armedPassthrough(ev))return;goToMonsterCard(n.typeId)});
        if(roams)marker=originMarker;
      }
      if(marker){
        if(!state.liveMarkersByType.has(n.typeId))state.liveMarkersByType.set(n.typeId,[]);
        state.liveMarkersByType.get(n.typeId).push(marker);
      }
    }
    console.timeEnd('drawMap:npcLoop');
    state.monsterPointsByType=pointsByType;
    // One icon per cluster of sightings, at the middle of where the monster has been seen (the median,
    // so one that wandered off does not pull it), with a count badge.
    console.time('drawMap:sightingsClusters');
    const median=a=>{const s=[...a].sort((x,y)=>x-y),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};
    for(const [typeId,s] of sightings){
      const fam=familyOf(typeId);
      for(const c of clusterPoints(s.pts,SEEN_LINK)){
        const mid={x:median(c.map(p=>p.x)),y:median(c.map(p=>p.y))};
        const ic=monsterAreaIcon(typeId,s.name,fam,s.elite,c.length);
        const am=ic?L.marker(latlng(mid,true),{icon:ic}):L.circleMarker(latlng(mid,true),{radius:5,weight:1,color:'#0d1a10',fillColor:familyColor(fam),fillOpacity:1});
        am.bindTooltip(`<b>${esc(s.name||typeId)}</b> · seen ${c.length} time${c.length===1?'':'s'}<br>Somewhere in the outlined area (exact spawn points not captured)${CLICK_HINT}`,{sticky:true});
        am.addTo(famGroups(fam).orig);famStat(fam).orig++;
        am.on('click',ev=>{if(armedPassthrough(ev))return;goToMonsterCard(typeId)});
      }
    }
    console.timeEnd('drawMap:sightingsClusters');
    console.time('drawMap:worldObjects');
    state.resourceMarkersByType=new Map();
    for(const o of snapshot?.worldObjects||[]){
      if(!o.position||num(o.position.x)===null||num(o.position.y)===null)continue;
      const skill=state.objectSkillByType?.get(o.typeId);
      if(!skill)continue;
      if(o.position.z)continue;
      const key=resourceKeyFor(o);
      const layer=getResourceLayer(key);
      const icon=resourceMapIcon(o);
      // on the trunk / rock itself: the game's own gather anchor for this kind (family-rules.js), not its footprint corner
      const ga=globalThis.BXC_FAMILY_RULES?.gatherables?.[o.typeId],tn=.22,at=ga?{x:o.position.x+ga[2]-.5-tn,y:o.position.y+ga[3]-.5+tn}:o.position;
      let cm;
      if(icon){
        cm=L.marker(latlng(at,true),{icon});
      }else{
        const style=resourceMarkerStyle(o.typeId);
        cm=L.circleMarker(latlng(at,true),{radius:4,weight:1,color:style.color,fillColor:style.fillColor,fillOpacity:1});
      }
      cm.bindTooltip(tooltipObject(o),{sticky:true});cm.addTo(layer);
      cm.on('click',ev=>{if(armedPassthrough(ev))return;goToCard('resources','r',key)});
      if(!state.resourceMarkersByType.has(key))state.resourceMarkersByType.set(key,[]);
      state.resourceMarkersByType.get(key).push(cm);
    }
    console.timeEnd('drawMap:worldObjects');
    console.time('drawMap:manualResources');
    // Resources placed by hand (only the ones the collector has not recorded for itself yet).
    for(const m of state.manualResources||[]){
      if(m.hidden||!m.key)continue;
      const pos=latlng({x:m.x,y:m.y},true);
      const icon=typedResourceIcon(m.itemSlug,m.itemSlug,m.item);
      let cm;
      if(icon)cm=L.marker(pos,{icon});
      else{const st=manualMarkerStyle(m.skill);cm=L.circleMarker(pos,{radius:5,weight:2,color:st.color,fillColor:st.fillColor,fillOpacity:1})}
      cm.bindTooltip(tooltipManualResource(m),{sticky:true});
      cm.on('click',ev=>{if(armedPassthrough(ev))return;goToCard('resources','r',m.key)});
      if(EDIT)cm.on('contextmenu',ev=>{if(ev.originalEvent)L.DomEvent.preventDefault(ev.originalEvent);removeManualResource(m)});
      cm.addTo(getResourceLayer(m.key));
      if(!state.resourceMarkersByType.has(m.key))state.resourceMarkersByType.set(m.key,[]);
      state.resourceMarkersByType.get(m.key).push(cm);
    }
    console.timeEnd('drawMap:manualResources');
    console.time('drawMap:zoneEntrances');
    // Restore every Official POI marker first, then hide only the ones this pass actually matches to a zone we
    // have entrance data for - so a POI whose match no longer holds (data changed) does not stay hidden forever.
    if(typeof poiMarkersByName!=='undefined')for(const cm of poiMarkersByName.values())if(!poiLayer.hasLayer(cm))cm.addTo(poiLayer);
    for(const ae of state.areaEntrances||[]){
      const meta=state.zones.get(ae.z);if(!meta)continue;
      const m=L.circleMarker(latlng({x:ae.x,y:ae.y},true),{radius:7,weight:2,color:'#1a1208',fillColor:'#3ad1ff',fillOpacity:1});
      m.bindTooltip(`${esc(placeName(ae.z,ae.area))} entrance — click to view layout`,{direction:'top'});
      m.on('click',()=>{if(!state.zoneArea)state.zoneArea=new Map();state.zoneArea.set(ae.z,ae.area);lastRenderedZoneOverlayZ=null;openZoneOverlay(ae.z)});
      m.addTo(zoneLayer);
    }
    // one marker per official place: Sunken Trove was recorded as two dungeons that both sit on its official spot
    const poiDrawn=new Set();
    for(const [z,ent] of state.zoneEntrances||[]){
      const meta=state.zones.get(z);if(!meta)continue;
      const poi=dungeonPoiForZone(z);
      if(poi){if(poiDrawn.has(poi.name))continue;poiDrawn.add(poi.name);}
      if(poi&&typeof poiMarkersByName!=='undefined'){const poiMarker=poiMarkersByName.get(poi.name);if(poiMarker)poiLayer.removeLayer(poiMarker);}
      const pos=latlng(poi?{x:poi.x,y:poi.y}:{x:ent.x,y:ent.y},true);
      const objMap=state.zoneContents.get(z)?.objects;
      const sorted=objMap&&objMap.size?[...objMap.entries()].sort((a,b)=>b[1].count-a[1].count):[];
      const top=sorted[0]||null;
      let marker;
      if(top){
        const typeId=top[0].includes('::')?top[0].split('::')[0]:top[0];
        const icon=typedResourceIcon(typeId,top[1].yieldItem,top[1].name);
        marker=icon?L.marker(pos,{icon}):L.circleMarker(pos,{radius:7,weight:2,color:'#1a1208',fillColor:'#3ad1ff',fillOpacity:1});
        const label=typedResourceLabel(typeId,top[1].yieldItem,top[1].name);
        const extra=sorted.length>1?` (+${sorted.length-1} more resource type${sorted.length>2?'s':''})`:'';
        marker.bindTooltip(`${esc(meta.name||('Zone '+z))} entrance — has ${esc(label)}${extra}<br>Click to view layout`,{direction:'top'});
      }else{
        marker=L.circleMarker(pos,{radius:7,weight:2,color:'#1a1208',fillColor:'#3ad1ff',fillOpacity:1});
        marker.bindTooltip(`${esc(meta.name||('Zone '+z))} entrance — click to view layout`,{direction:'top'});
      }
      marker.on('click',()=>{state.zoneArea?.set(z,0);lastRenderedZoneOverlayZ=null;openZoneOverlay(z)});   // the zone's own place
      marker.addTo(zoneLayer);
      for(const [key,info] of sorted){
        const typeId=key.includes('::')?key.split('::')[0]:key;
        const ref=L.circleMarker(pos,{radius:6});
        ref.bindTooltip(`${esc(typedResourceLabel(typeId,info.yieldItem,info.name))} — inside ${esc(meta.name||('Zone '+z))}`,{sticky:true});
        if(!state.resourceMarkersByType.has(key))state.resourceMarkersByType.set(key,[]);
        state.resourceMarkersByType.get(key).push(ref);
      }
    }
    console.timeEnd('drawMap:zoneEntrances');
    console.time('drawMap:drawRegionStats');
    drawRegionStats();
    console.timeEnd('drawMap:drawRegionStats');
    try{drawTrainers()}catch(err){console.debug('[atlas] trainers',err)}
    try{drawQuestGivers()}catch(err){console.debug('[atlas] quest-givers',err)}
    console.time('drawMap:drawGameAreas');
    drawGameAreas();
    console.timeEnd('drawMap:drawGameAreas');
    applyLegendVisibility();
    if(!legendControl){legendControl=buildLegendControl();legendControl.addTo(map)}else legendControl.refresh();
    if(typeof selectedMonsterType!=='undefined'&&selectedMonsterType&&typeof showMonsterSelection==='function')showMonsterSelection(selectedMonsterType,state.liveMarkersByType.get(selectedMonsterType)||[],false)
    if(state.selectedResourceType)showResourceSelection(state.selectedResourceType,false)
    if(state.openZone!=null&&zoneOverlayEl&&zoneOverlayEl.style.display!=='none')openZoneOverlay(state.openZone)
    console.timeEnd('drawMap:total');
  }

  // Kills come from the game's own kill reports (exp.gain with source {kind:'kill', enemyName}); the
  // corpses you actually looted come from the loot records. Together they say what a monster gives you.
  function deriveKills(){
    const kills=new Map();   // lower-case monster name -> {name,kills,xp,last}
    for(const e of snapshot?.exp||[]){
      if((e.sourceKind||e.source?.kind)!=='kill')continue;
      const nm=String(e.source?.enemyName||'').trim();if(!nm)continue;
      const k=nm.toLowerCase();let r=kills.get(k);if(!r)kills.set(k,r={name:nm,kills:0,xp:0,last:0});
      r.kills++;r.xp+=num(e.amount)||0;r.last=Math.max(r.last,num(e.time)||0);
    }
    const looted=new Map();  // monster typeId -> {corpses:Set, items:Map(itemTypeId -> Set of corpses)}
    for(const d of snapshot?.drops||[]){
      if(d.source!=='loot'||!d.npcId||!d.monsterTypeId||!d.itemTypeId)continue;
      let m=looted.get(d.monsterTypeId);if(!m)looted.set(d.monsterTypeId,m={corpses:new Set(),items:new Map()});
      m.corpses.add(d.npcId);
      let s=m.items.get(d.itemTypeId);if(!s)m.items.set(d.itemTypeId,s=new Set());s.add(d.npcId);
    }
    state.kills=kills;state.looted=looted;
  }
  const monsterNameCache=new Map();
  function monsterNameFor(typeId){
    if(monsterNameCache.has(typeId))return monsterNameCache.get(typeId);
    const nm=state.monster.get(typeId)?.name||(D.catalog||[]).find(m=>m.typeId===typeId)?.name||null;
    if(nm)monsterNameCache.set(typeId,nm);
    return nm;
  }
  function killStatsFor(typeId){const n=monsterNameFor(typeId);return n?state.kills?.get(String(n).toLowerCase())||null:null}
  function killsLineHtml(typeId){
    const ks=killStatsFor(typeId),lt=state.looted?.get(typeId);
    if(!ks)return lt?`<div class="muted">No kills of this monster reported yet; ${fmt(lt.corpses.size)} looted corpse${lt.corpses.size===1?'':'s'} recorded.</div>`:'';
    return `<div>You have killed it <b>${fmt(ks.kills)}</b> time${ks.kills===1?'':'s'} · ${fmt(ks.xp)} XP earned (about ${fmt(Math.round(ks.xp/ks.kills))} per kill) · last kill ${esc(when(ks.last))}${lt?` · looted <b>${fmt(lt.corpses.size)}</b> of those corpses`:''}</div>`;
  }
  // Table for the Drops tab: everything you have killed, and how much of it you looted.
  function killsPanelHtml(){
    const rows=[...(state.kills||new Map()).values()].sort((a,b)=>b.kills-a.kills);
    if(!rows.length)return '';
    const byName=new Map();
    for(const [typeId,l] of state.looted||[]){const n=monsterNameFor(typeId);if(n)byName.set(String(n).toLowerCase(),(byName.get(String(n).toLowerCase())||0)+l.corpses.size)}
    return `<div class="collector-panel"><div class="collector-title">What you have killed</div><div class="muted" style="margin-bottom:6px">From the game's own kill reports. "Looted" counts the corpses whose loot the collector recorded; drop percentages elsewhere are of those.</div><table class="research-table"><thead><tr><th>Monster</th><th>Kills</th><th>XP earned</th><th>Looted</th><th>Last kill</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${fmt(r.kills)}</td><td>${fmt(r.xp)}</td><td>${fmt(byName.get(r.name.toLowerCase())||0)}</td><td>${esc(when(r.last))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  // ---- Quest items ------------------------------------------------------------------------------------------
  // snapshot.questItems (from the collector): items the game's quests ask you to collect, with the quests. They are
  // tagged "Quest item" wherever they appear; their drop rates stay as recorded (many are ordinary drops too).
  let questCache={src:null,map:new Map()};
  function questItem(itemTypeId){
    const src=snapshot?.questItems;
    if(questCache.src!==src){questCache={src,map:new Map((Array.isArray(src)?src:[]).filter(q=>q&&q.itemTypeId).map(q=>[q.itemTypeId,q]))}}
    return questCache.map.get(itemTypeId)||null;
  }
  globalThis.bxcMonsterDrops=t=>monsterDropsHtml(t);
  function monsterDropsHtml(typeId){
    const rows=dropRowsForMonster(typeId);
    const killsLine=killsLineHtml(typeId),lt=state.looted?.get(typeId);
    if(!rows.length)return '<div class="collector-extra collector-monster-drops"><b>Observed drops</b>'+killsLine+'<div class="muted">No drops recorded for this monster yet.</div></div>';
    const groups=[false,true].map(elite=>{
      const items=rows.filter(r=>r.elite===elite);if(!items.length)return '';
      const chips=items.map(r=>{
        const range=r.minQty===r.maxQty?fmt(r.minQty):fmt(r.minQty)+'\u2013'+fmt(r.maxQty);
        const enchantPlain=Object.entries(r.enchants||{}).sort((a,b)=>b[1]-a[1]).map(([k,n])=>k+' x'+n).join(', ');
        const tip=prettyId(r.itemTypeId)+(enchantPlain?' ('+enchantPlain+')':'')+' - '+(lt&&lt.corpses.size?'in '+Math.round(100*(lt.items.get(r.itemTypeId)?.size||0)/lt.corpses.size)+'% of '+fmt(lt.corpses.size)+' looted corpses, ':'')+fmt(r.events)+' recorded drop'+(r.events===1?'':'s')+', '+fmt(r.totalQty)+' total, '+range+' per drop';
        const lootedN=lt&&lt.corpses.size?(lt.items.get(r.itemTypeId)?.size||0):null;
        let statText=lootedN!==null?Math.round(100*lootedN/lt.corpses.size)+'% \u00b7 '+fmt(lootedN)+'/'+fmt(lt.corpses.size):fmt(r.events)+' drop'+(r.events===1?'':'s');
        const qr=questItem(r.itemTypeId);   // tagged, rate unchanged
        return '<div class="entity-chip dropicon-link'+(elite?' elite':'')+(qr?' quest':'')+'" data-item="'+esc(r.itemTypeId)+'" title="'+esc(tip+(qr?' - Quest item: '+qr.quests.join(' / '):''))+'"><img class="thumb itemthumb" src="'+esc(itemImgFor(r.itemTypeId))+'" alt="">'+(qr?'<span class="quest-tag" title="Quest item">Q</span>':'')+'<span class="entity-chip-label">'+esc(prettyId(r.itemTypeId))+'</span><span class="entity-chip-stat">'+esc(statText)+'</span>'+qualityNote(r)+'</div>';
      });
      return '<div style="margin-top:8px"><b>'+(elite?'\u2b50 Elite loot':'Normal loot')+'</b>'+chipRowHtml(chips)+'</div>';
    }).join('');
    return '<div class="collector-extra collector-monster-drops"><b>Observed drops</b>'+killsLine+groups+'<div class="muted" style="margin-top:8px">Percentages are of the corpses whose loot the collector recorded, so kills you did not loot are not counted.</div></div>';
  }
  // ---- Gem find chance per gather, confirmed by the developer ----------------------------------
  // Chance depends on the resource's tier (T1-T4 = the skill's four resources in level order): 0.5%, 0.6%, 0.75%, 1%.
  // Fishing finds Pearl or Topaz; lumberjack finds Iolite or Amber; mining finds the other gems. Herblore finds none.
  const GEM_TIER_PCT=[0.5,0.6,0.75,1];
  const GEM_POOLS={fishing:['pearl','topaz'],lumberjack:['iolite','amber'],mining:['diamond','emerald','ruby','sapphire','onyx']};
  function gemDrop(skill,item){
    const pool=GEM_POOLS[skill];if(!pool)return null;
    const tiers=(typeof GATHERABLES!=='undefined'?GATHERABLES:[]).filter(g=>g.skill===skill).sort((a,b)=>a.level-b.level);
    const i=tiers.findIndex(g=>slug(g.item)===slug(item));
    if(i<0||i>=GEM_TIER_PCT.length)return null;
    return {tier:i+1,pct:GEM_TIER_PCT[i],gems:pool.map(prettyId)};
  }
  function gemDropText(skill,item){
    const d=gemDrop(skill,item);
    return d?`Gem find chance: <b>${d.pct}%</b> per gather (T${d.tier}) — ${esc(d.gems.join(', '))}`:'';
  }
  window.bxcGemLine=g=>{const t=gemDropText(g.skill,g.item);return t?`<div class="subresult">${t}</div>`:''};
  function gemOddsTable(){
    const rows=Object.entries(GEM_POOLS).map(([skill,gems])=>{
      const tiers=(typeof GATHERABLES!=='undefined'?GATHERABLES:[]).filter(g=>g.skill===skill).sort((a,b)=>a.level-b.level);
      return `<tr><td>${esc(prettyId(skill))}</td><td>${esc(gems.map(prettyId).join(', '))}</td><td>${tiers.map((g,i)=>`T${i+1} ${esc(g.item)} ${GEM_TIER_PCT[i]}%`).join(' · ')}</td></tr>`;
    }).join('');
    return `<div class="collector-panel"><div class="collector-title">Where gems come from</div><div class="muted">Chance of a gem on each successful gather, by resource tier (confirmed by the developer). Herblore does not give gems.</div><table class="research-table"><thead><tr><th>Skill</th><th>Gems</th><th>Chance per gather</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  // ---- Gem luck: gathers since the last gem, and how many to expect per gem ---------------------
  // Each successful gather has the tier's chance (0.5-1%) of a gem. Expected successful gathers per gem = 1/chance;
  // expected swings (clicks) also allow for the misses, using the success rate observed for that resource.
  // Only the tracked character's own gathers and gems (each game window is its own session).
  function trackedSessions(){const p=selectedProfile();if(!p)return null;const s=new Set((snapshot?.selfState||[]).filter(r=>r.playerId===p.playerId).map(r=>r.sessionId));return s.size?s:null}
  function gemLuck(){
    const rows=[];
    const sess=trackedSessions();
    const gathers=(snapshot?.gathers||[]).filter(g=>num(g.time)!==null&&(!sess||sess.has(g.sessionId)));
    for(const skill of Object.keys(GEM_POOLS)){
      const mine=gathers.filter(g=>(GATHERABLES||[]).some(x=>x.skill===skill&&slug(x.item)===slug(g.itemTypeId)));
      if(!mine.length&&!state.gems.some(g=>g.sourceSkill===skill&&(!sess||sess.has(g.sessionId))))continue;
      const gems=state.gems.filter(g=>g.sourceSkill===skill&&(!sess||sess.has(g.sessionId))).sort((a,b)=>(num(a.gatherTime)??num(a.time)??0)-(num(b.gatherTime)??num(b.time)??0));
      const last=gems.length?(num(gems[gems.length-1].gatherTime)??num(gems[gems.length-1].time)):null;
      const since=mine.filter(g=>last===null||num(g.time)>last);
      const succ=since.filter(g=>g.success===true);
      let expected=0,logNone=0;
      for(const g of succ){const d=gemDrop(skill,g.itemTypeId);if(d){expected+=d.pct/100;logNone+=Math.log(1-d.pct/100)}}
      const allSucc=mine.filter(g=>g.success===true);
      let allExpected=0;for(const g of allSucc){const d=gemDrop(skill,g.itemTypeId);if(d)allExpected+=d.pct/100}
      rows.push({skill,gems:gems.length,lastAt:last,since:since.length,sinceOk:succ.length,expected,pNone:Math.exp(logNone),total:mine.length,totalOk:allSucc.length,allExpected});
    }
    return rows;
  }
  function gemLuckPanel(){
    const rows=gemLuck(),sess=trackedSessions(),prof=selectedProfile(),rates=new Map();
    for(const g of snapshot?.gathers||[]){if(sess&&!sess.has(g.sessionId))continue;const k=slug(g.itemTypeId);const r=rates.get(k)||{successes:0,total:0};r.total++;if(g.success===true)r.successes++;rates.set(k,r)}
    const perGem=(GATHERABLES||[]).filter(g=>GEM_POOLS[g.skill]).sort((a,b)=>a.skill.localeCompare(b.skill)||a.level-b.level).map(g=>{
      const d=gemDrop(g.skill,g.item);if(!d)return '';
      const st=rates.get(slug(g.item));const rate=st&&st.total>=10?st.successes/st.total:null;
      const okPer=100/d.pct,swings=rate?okPer/rate:null;
      return `<tr><td>${esc(prettyId(g.skill))}</td><td>${esc(g.item)} (T${d.tier})</td><td>${d.pct}%</td><td>${fmt(Math.round(okPer))}</td><td>${swings?fmt(Math.round(swings)):'—'}</td><td>${rate!==null?fmt(rate*100,0)+'%':'—'}</td></tr>`;
    }).join('');
    const stat=rows.map(r=>{
      const streak=r.pNone<0.5?` · chance of a dry streak this long: <b>${fmt(r.pNone*100,r.pNone<0.1?1:0)}%</b>${r.pNone<0.05?' (unlucky)':''}`:'';
      return `<div class="research-row"><b>${esc(prettyId(r.skill))}</b>: <b>${fmt(r.sinceOk)}</b> successful gathers${r.since!==r.sinceOk?` (${fmt(r.since)} swings)`:''} since ${r.lastAt?`your last gem (${esc(when(r.lastAt))})`:'the collector started recording'} · expected so far about ${fmt(r.expected,1)} gem${r.expected===1?'':'s'}${streak}<div class="muted">All time: ${fmt(r.gems)} gem${r.gems===1?'':'s'} from ${fmt(r.totalOk)} successful gathers (${fmt(r.allExpected,1)} expected)</div></div>`;
    }).join('');
    return `<div class="collector-panel"><div class="collector-title">Gem luck${prof?` <span class="pill">${esc(prof.name||'character')}</span>`:''}</div>${stat||'<div class="muted">No gathers recorded yet.</div>'}<div class="muted" style="margin-top:8px">How many to expect per gem (the chance is per successful gather; swings also count the misses, using your observed success rate once there are 10+ attempts):</div><table class="research-table"><thead><tr><th>Skill</th><th>Resource</th><th>Chance</th><th>Successful gathers per gem</th><th>Swings per gem</th><th>Your success rate</th></tr></thead><tbody>${perGem}</tbody></table><div class="muted">Averages only: a 0.5% chance means one gem per 200 gathers on average, but any single stretch can run far shorter or longer.</div></div>`;
  }
  function gemPanel(){
    if(!state.gems.length)return gemLuckPanel()+gemOddsTable()+`<div class="collector-panel"><b>Live gem database</b><div class="muted">No gem.find events captured by this extension yet.</div></div>`;
    const rows=[...state.gemByType.entries()].sort((a,b)=>b[1].length-a[1].length).map(([t,a])=>{
      const car=a.map(x=>num(x.carat)).filter(x=>x!==null);const sources=[...new Set(a.map(x=>x.sourceItem).filter(Boolean))];
      const swingVals=a.map(x=>x.swingsToGem).filter(x=>x!=null);
      const avgSwings=swingVals.length?swingVals.reduce((s,v)=>s+v,0)/swingVals.length:null;
      return `<tr><td>${esc(prettyId(t.replace(/^gem-/,'')))}</td><td>${a.length}</td><td>${car.length?`${fmt(Math.min(...car),2)}–${fmt(Math.max(...car),2)}`:'—'}</td><td>${esc(sources.join(', ')||'unpaired')}</td><td>${avgSwings!=null?fmt(avgSwings,1):'—'}</td></tr>`;
    }).join('');
    const recent=state.gems.slice(0,10).map(g=>`<div class="research-row"><b>${esc(prettyId((g.typeId||'').replace(/^gem-/,'')))}</b> ${g.carat!=null?esc(g.carat)+'c':''} · ${g.dropped===false?'inventory':'dropped/unknown'}${g.sourceItem?` · from ${esc(prettyId(g.sourceItem))}`:''}${g.skillLevel!=null?` · ${esc(prettyId(g.sourceSkill))} Lv ${esc(g.skillLevel)}`:''}${g.gatherObjectName?` · node: ${esc(g.gatherObjectName)}${g.gatherObjectPosition?` (${fmt(g.gatherObjectPosition.x,1)}, ${fmt(g.gatherObjectPosition.y,1)})`:''}`:''}${g.swingsToGem!=null?` · <b class="good">${fmt(g.swingsToGem)} swing${g.swingsToGem===1?'':'s'}</b>`:''}<span>${esc(when(g.time))}</span></div>`).join('');
    return gemLuckPanel()+gemOddsTable()+`<div class="collector-panel"><div class="collector-title">Live gem database <span class="pill">${state.gems.length} finds</span></div><table class="research-table"><thead><tr><th>Gem</th><th>Finds</th><th>Carats</th><th>Paired source</th><th>Avg swings</th></tr></thead><tbody>${rows}</tbody></table><details><summary>Recent finds</summary>${recent}</details></div>`;
  }

  function xpPanel(){
    const src=[...state.xp.bySource?.values?.()||[]].sort((a,b)=>b.events-a.events);if(!src.length)return `<div class="collector-panel"><b>Live XP observations</b><div class="muted">No XP events captured yet.</div></div>`;
    return `<div class="collector-panel"><div class="collector-title">Live XP observations <span class="pill">${fmt(snapshot?.stats?.exp||0)} events</span></div><table class="research-table"><thead><tr><th>Source</th><th>Events</th><th>Total XP</th><th>Observed range</th></tr></thead><tbody>${src.map(r=>`<tr><td>${esc(prettyId(r.kind))}</td><td>${fmt(r.events)}</td><td>${fmt(r.total)}</td><td>${fmt(r.min)}–${fmt(r.max)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function gatheringPanel(){
    if(!snapshot)return '';
    const skillEl=document.getElementById('gSkill'),itemEl=document.getElementById('gItem');if(!skillEl||!itemEl)return '';
    const gs=(GATHERABLES||[]).filter(g=>g.skill===skillEl.value),g=gs[+itemEl.value||0];if(!g)return '';
    const id=slug(g.item),r=state.gather.get(id);
    if(!r)return `<div id="collectorGatherPanel" class="collector-panel"><b>Live observations for ${esc(g.item)}</b><div class="muted">No matching gather.result events captured yet.</div></div>`;    let observedActions='';
    const lv=Math.max(1,Math.min(100,+document.getElementById('gLevel')?.value||1)),target=Math.max(lv,Math.min(100,+document.getElementById('gTarget')?.value||lv)),into=Math.max(0,+document.getElementById('gInto')?.value||0);
    const cur=xpAt('Trade',lv)+into,targetXp=xpAt('Trade',target),need=Math.max(0,targetXp-cur);if(r.xpMode>0)observedActions=`<div class="good"><b>${Math.ceil(need/r.xpMode).toLocaleString()}</b> successful gathers using the most common observed ${r.xpMode} XP award.</div>`;
    return `<div id="collectorGatherPanel" class="collector-panel"><div class="collector-title">Live observations for ${esc(g.item)}</div><div class="statline"><span>${fmt(r.total)} attempts</span><span>${fmt(r.successes)} successes</span><span>${fmt(r.failures)} failures</span><span>${fmt(r.objectCount)} object IDs</span></div>${r.xpPairs.length?`<div class="subresult">Paired gather XP: mode <b>${fmt(r.xpMode)}</b>, average ${fmt(r.xpAvg,1)}, range ${fmt(r.xpMin)}–${fmt(r.xpMax)} from ${fmt(r.xpPairs.length)} paired events.</div>`:`<div class="muted">No gather.result ↔ exp.gain pair has been captured within 2.5 seconds yet.</div>`}${observedActions}<div class="muted">Last observed: ${esc(when(r.lastSeen))}</div></div>`;
  }

  function researchHtml(search=''){
    const s=String(search||'').toLowerCase().trim();const filt=x=>!s||JSON.stringify(x).toLowerCase().includes(s);
    const worlds=state.worldTypes.filter(filt).slice(0,250),items=state.unknownItems.filter(filt).slice(0,250),msgs=state.unknownMessages.filter(filt).slice(0,250);
    const skillRows=(snapshot?.skills||[]).filter(filt).sort((a,b)=>String(a.skill).localeCompare(String(b.skill))).map(x=>`<tr><td>${esc(prettyId(x.skill))}</td><td>${fmt(x.level)}</td><td>${fmt(x.experience)}</td><td>${esc(when(x.lastSeen))}</td></tr>`).join('');
    return `<div class="collector-panel"><div class="collector-title">Research / uncategorized data</div><div class="statline"><span>${fmt(snapshot?.stats?.worldObjects||0)} world objects</span><span>${fmt(snapshot?.stats?.inventoryTypes||0)} item types</span><span>${fmt(snapshot?.stats?.messageTypes||0)} message types</span><span>${fmt(snapshot?.stats?.skillObservations||0)} skill observations</span><span>${fmt(snapshot?.stats?.drops||0)} drop records</span><span>${fmt(snapshot?.stats?.assets||0)} assets</span></div><div class="muted">These are normal client-visible observations retained so we can classify new mechanics without losing the raw identifiers.</div></div>
    <details class="collector-panel" open><summary class="collector-title">World object types (${worlds.length})</summary><table class="research-table"><thead><tr><th>Type ID</th><th>Objects</th><th>Last seen</th><th>Example position</th></tr></thead><tbody>${worlds.map(r=>{const p=r.examples[0]?.position||{};return `<tr><td>${esc(r.typeId)}</td><td>${fmt(r.count)}</td><td>${esc(when(r.lastSeen))}</td><td>${fmt(p.x,1)}, ${fmt(p.y,1)}${p.z!=null?', '+fmt(p.z):''}</td></tr>`}).join('')||'<tr><td colspan="4">No matching world objects.</td></tr>'}</tbody></table></details>
    <details class="collector-panel" open><summary class="collector-title">New / unclassified inventory IDs (${items.length})</summary><table class="research-table"><thead><tr><th>Type ID</th><th>Max qty seen</th><th>Attributes</th><th>Last seen</th></tr></thead><tbody>${items.map(x=>`<tr><td>${esc(x.typeId)}</td><td>${fmt(x.maxQuantitySeen)}</td><td><code>${esc(JSON.stringify((x.attrExamples||[]).slice(0,2)))}</code></td><td>${esc(when(x.lastSeen))}</td></tr>`).join('')||'<tr><td colspan="4">No unclassified inventory IDs.</td></tr>'}</tbody></table></details>
    <details class="collector-panel"><summary class="collector-title">Protocol types needing classification (${msgs.length})</summary><table class="research-table"><thead><tr><th>Message type</th><th>Count</th><th>First seen</th><th>Last seen</th></tr></thead><tbody>${msgs.map(x=>`<tr><td>${esc(x.type)}</td><td>${fmt(x.count)}</td><td>${esc(when(x.firstSeen))}</td><td>${esc(when(x.lastSeen))}</td></tr>`).join('')||'<tr><td colspan="4">No unclassified protocol types.</td></tr>'}</tbody></table></details>
    <details class="collector-panel"><summary class="collector-title">Latest skill state</summary><table class="research-table"><thead><tr><th>Skill</th><th>Level</th><th>XP</th><th>Last seen</th></tr></thead><tbody>${skillRows||'<tr><td colspan="4">No skills captured.</td></tr>'}</tbody></table></details>`;
  }

  function deltaText(){
    if(!snapshot)return '';const base=state.visitBaseline||snapshot.stats||{};const keys=[['npcObservations','NPC obs'],['worldObjects','objects'],['gathers','gathers'],['gems','gems'],['exp','XP']];const parts=[];for(const [k,label] of keys){const d=Math.max(0,Number(snapshot.stats?.[k]||0)-Number(base?.[k]||0));if(d)parts.push(`+${d.toLocaleString()} ${label}`)}return parts.length?parts.join(' · '):'no new records this visit';
  }
  function connectionPanel(){return `<div class="collector-panel"><div class="collector-title">Collector connection</div><div class="statline"><span>${fmt(snapshot?.stats?.npcs||0)} NPC IDs</span><span>${fmt(snapshot?.stats?.npcObservations||0)} NPC observations</span><span>${fmt(snapshot?.stats?.gathers||0)} gathers</span><span>${fmt(snapshot?.stats?.gems||0)} gems</span><span>${fmt(snapshot?.stats?.drops||0)} drops</span><span>${fmt(snapshot?.stats?.assets||0)} assets</span><span>${fmt(snapshot?.stats?.exp||0)} XP events</span></div><div class="good">${esc(deltaText())}</div><div class="muted">Last synced ${esc(state.lastSyncAt?new Date(state.lastSyncAt).toLocaleTimeString():'—')}. The persistent source of truth is the extension's IndexedDB; this page re-merges it every sync.</div></div>`}

  // Each Bestiary card's drops are worked out as the card comes near the screen (all 117 at once took ~300 ms per
  // visit); a card already on screen, or a short list, fills straight away.
  let monsterDropsObserver=null;
  function augmentMonsters(){
    const fill=e=>{e.querySelectorAll('.collector-extra').forEach(x=>x.remove());const html=monsterDropsHtml(e.dataset.t);if(html)e.insertAdjacentHTML('beforeend',html)};
    const cards=[...document.querySelectorAll('.card[data-t]')];
    if(monsterDropsObserver)monsterDropsObserver.disconnect();
    if(cards.length<=4||typeof IntersectionObserver==='undefined'){cards.forEach(fill);return}
    monsterDropsObserver=new IntersectionObserver(entries=>{for(const en of entries)if(en.isIntersecting){monsterDropsObserver.unobserve(en.target);fill(en.target)}},{rootMargin:'800px 0px'});
    cards.forEach(c=>monsterDropsObserver.observe(c));
  }
  function augmentGems(){window.renderGemStock()}
  // ---- XP per hour and time to level --------------------------------------------------------------
  // For the character picked above: XP gained over the chosen window (character XP from the game's exp.gain
  // reports, skill XP from the rises between skill snapshots), divided by the time spent playing in that
  // window. A pause of more than 5 minutes counts as a break, not as play, so stepping away does not drag the
  // rate down, and the rate settles back to your pace as soon as you carry on. The time to level assumes you
  // keep splitting your time the way you did in the window.
  const XPR_BREAK=5*60e3, XPR_GAP_SKIP=15*60e3, XPR_WIN_KEY='bxcXpRateWindow', XPR_GOAL_KEY='bxcXpRateGoal';
  const XPR_WINDOWS=[[15,'Last 15 minutes'],[30,'Last 30 minutes'],[60,'Last hour'],[180,'Last 3 hours'],[720,'Last 12 hours']];
  let xprWindow=60,xprGoal='';
  try{xprWindow=Number(localStorage.getItem(XPR_WIN_KEY))||60;xprGoal=localStorage.getItem(XPR_GOAL_KEY)||''}catch{}
  function xprDuration(ms){
    if(!(ms>0)||!Number.isFinite(ms))return '—';
    const m=Math.max(1,Math.round(ms/60e3));
    if(m<60)return m+'m';
    const h=Math.floor(m/60);if(h<48)return h+'h '+(m%60)+'m';
    const d=Math.floor(h/24);return d+'d '+(h%24)+'h';
  }
  function xprCurve(kind){return kind==='character'?(globalThis.BXC_CHARACTER_XP||[]):kind==='combat'?COMBAT_XP:TRADE_XP}
  function xprData(){
    const p=selectedProfile();if(!p||!snapshot)return null;
    const pid=p.playerId,now=Date.now(),from=now-xprWindow*60e3;
    const sessions=new Set((snapshot.selfState||[]).filter(r=>r.playerId===pid).map(r=>r.sessionId));
    const acts=[],tracks=new Map();
    const track=(id,kind,name)=>{let t=tracks.get(id);if(!t)tracks.set(id,t={id,kind,name,gain:0});return t};
    for(const e of snapshot.exp||[]){
      const t=num(e.time),a=num(e.amount);if(t===null||!(a>0)||!sessions.has(e.sessionId))continue;
      acts.push(t);if(t>=from)track('character','character','Character').gain+=a;
    }
    const obs=new Map();
    for(const o of snapshot.skillObservations||[]){
      if(!(o.playerId?o.playerId===pid:sessions.has(o.sessionId)))continue;
      const k=normalizedSkillId(o.skill);if(!obs.has(k))obs.set(k,[]);obs.get(k).push(o);
    }
    for(const [k,list] of obs){
      list.sort((a,b)=>(num(a.time)||0)-(num(b.time)||0));
      for(let i=1;i<list.length;i++){
        const t=num(list[i].time),dt=t-(num(list[i-1].time)||0),d=(num(list[i].experience)||0)-(num(list[i-1].experience)||0);
        if(!(d>0)||dt>XPR_GAP_SKIP)continue;   // a rise across a long gap was not earned in time we saw
        acts.push(t);if(t>=from)track(k,list[i].kind==='combat'?'combat':'trade',prettyId(list[i].skill)).gain+=d;
      }
    }
    // time played inside the window: the gaps between gains, each capped at the break length
    acts.sort((a,b)=>a-b);let played=0,prev=null;
    for(const t of acts){if(prev!==null&&t>=from)played+=Math.min(t-Math.max(prev,from),XPR_BREAK);prev=t}
    if(prev!==null&&prev>=from)played+=Math.min(now-prev,XPR_BREAK);
    const goal=Math.floor(Number(xprGoal))||null;
    // the character's total: from its profile, or else the newest XP report that carried one
    let charNow={level:p.level,experience:p.experience};
    if(num(charNow.experience)===null){const e=(snapshot.exp||[]).filter(x=>sessions.has(x.sessionId)&&num(x.experience)!==null).sort((a,b)=>(num(b.time)||0)-(num(a.time)||0))[0];if(e)charNow={level:num(e.level)??p.level,experience:num(e.experience)}}
    const rows=[...tracks.values()].filter(t=>t.gain>0).map(t=>{
      const curve=xprCurve(t.kind),s=t.kind==='character'?charNow:liveSkill(t.id);
      const level=num(s?.level),total=num(s?.experience),rate=played>=60e3?t.gain/(played/3600e3):null;
      const left=lv=>level===null||total===null||lv>curve.length||lv<=level?null:Math.max(0,curve[lv-1]-total);
      const next=left((level||0)+1),toGoal=goal?left(goal):null;
      return {...t,level,rate,next,nextTime:next!==null&&rate?next/rate*3600e3:null,toGoal,goalTime:toGoal!==null&&rate?toGoal/rate*3600e3:null};
    }).sort((a,b)=>(a.kind==='character'?-1:0)-(b.kind==='character'?-1:0)||b.gain-a.gain);
    return {p,rows,played,goal};
  }
  function xprBody(){
    const d=xprData();
    if(!d)return '<div class="muted">No character captured yet.</div>';
    if(!d.rows.length)return `<div class="muted">No XP gained by ${esc(d.p.name||'this character')} in this window yet. Rates appear as soon as you fight, gather or craft.</div>`;
    const early=d.played<60e3;
    return `<div class="statline"><span>Time played in window: <b>${xprDuration(d.played)}</b></span><span>Breaks over 5 minutes are not counted</span></div>
    ${early?'<div class="muted">Collecting — rates show after a minute of play.</div>':''}
    <div style="overflow-x:auto"><table class="research-table" style="white-space:nowrap"><thead><tr><th>Skill</th><th>Lv</th><th>Gained</th><th>XP/hr</th><th>XP left</th><th>Next level in</th>${d.goal?`<th>Lv ${d.goal} in</th>`:''}</tr></thead><tbody>${d.rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${fmt(r.level)}</td><td>${fmt(r.gain)}</td><td><b>${r.rate===null?'—':fmt(r.rate)}</b></td><td>${r.next===null?(r.level!==null&&r.level>=xprCurve(r.kind).length?'max':'—'):fmt(r.next)}</td><td><b class="good">${xprDuration(r.nextTime)}</b></td>${d.goal?`<td>${r.toGoal===null?'—':xprDuration(r.goalTime)}</td>`:''}</tr>`).join('')}</tbody></table></div>
    <div class="muted">Times assume you keep splitting your play between these the way you did in this window.</div>`;
  }
  function renderXpRate(){
    if(tab!=='xp')return;
    if(PUBLIC_MODE)return;   // your own XP/hr and character info have no place on the shared build
    let box=document.getElementById('bxcXpRate');
    if(!box){
      box=document.createElement('div');box.id='bxcXpRate';box.className='collector-panel';
      box.innerHTML=`<div class="collector-title">XP per hour & time to level</div><div class="calcgrid" style="margin-bottom:6px"><div><label>Measured over</label><select id="bxcXpRateWin">${XPR_WINDOWS.map(([m,l])=>`<option value="${m}" ${m===xprWindow?'selected':''}>${l}</option>`).join('')}</select></div><div><label>Goal level (optional)</label><input id="bxcXpRateGoal" type="number" min="2" max="200" placeholder="e.g. 30" value="${esc(xprGoal)}"></div></div><div id="bxcXpRateBody"></div>`;
      const anchor=document.getElementById('collectorCharacterPanel');
      if(anchor)anchor.before(box);else content.prepend(box);
    }
    document.getElementById('bxcXpRateBody').innerHTML=xprBody();
  }
  content?.addEventListener('change',e=>{
    if(e.target.id==='bxcXpRateWin'){xprWindow=Number(e.target.value)||60;try{localStorage.setItem(XPR_WIN_KEY,String(xprWindow))}catch{}renderXpRate()}
    else if(e.target.id==='collectorCharacter')setTimeout(renderXpRate,0);
  });
  content?.addEventListener('input',e=>{if(e.target.id==='bxcXpRateGoal'){xprGoal=e.target.value;try{localStorage.setItem(XPR_GOAL_KEY,xprGoal)}catch{}renderXpRate()}});
  // keeps "time played" and the rates current between gains
  setInterval(()=>{if(tab==='xp'&&!document.hidden&&snapshot)renderXpRate()},30e3);
  function augmentXp(){if(PUBLIC_MODE)return;const old=document.getElementById('collectorXpPanelWrap');if(old)old.remove();const d=document.createElement('div');d.id='collectorXpPanelWrap';d.innerHTML=xpPanel();content.prepend(d);augmentCharacter();renderXpRate()}
  function normalizedSkillId(v){return slug(String(v||''));}
  let selectedCharacterId=null;
  function characterProfiles(){return (snapshot?.selfState||[]).filter(r=>r.playerId).sort((a,b)=>Math.max(b.time||0,b.skillsSeenAt||0)-Math.max(a.time||0,a.skillsSeenAt||0));}
  function selectedProfile(){const profiles=characterProfiles();if(!profiles.some(p=>p.playerId===selectedCharacterId))selectedCharacterId=profiles[0]?.playerId||null;return profiles.find(p=>p.playerId===selectedCharacterId)||null;}
  globalThis.bxcCharGear=()=>{const p=typeof selectedProfile==='function'?selectedProfile():null;return p&&p.equipment||null};
  globalThis.bxcCharClass=()=>{const p=typeof selectedProfile==='function'?selectedProfile():null,c=String(p&&p.characterClass||'').toLowerCase();return ['warrior','archer','mage'].includes(c)?c:null};
  globalThis.bxcCharPools=()=>{const p=typeof selectedProfile==='function'?selectedProfile():null;return p&&p.maxStats||null};   // max hitpoints, mana, stamina
  globalThis.bxcCharBaseStats=()=>{const p=typeof selectedProfile==='function'?selectedProfile():null;return p&&p.attributes||null};   // your own points, without gear
  globalThis.bxcCharStats=()=>{const p=typeof selectedProfile==='function'?selectedProfile():null;return p&&(p.effectiveAttributes||p.attributes)||null};
  globalThis.bxcSkillLevel=id=>{try{const s=liveSkill(id);return s&&Number.isFinite(+s.level)?+s.level:null}catch(_){return null}};
  function liveSkill(id){
    id=normalizedSkillId(id);const profile=selectedProfile();if(!profile)return null;
    if(id==='character')return Number.isFinite(+profile.level)?{skill:'character',level:+profile.level,experience:+profile.experience||0,lastSeen:profile.levelSeenAt||profile.time}:null;
    return characterProfiles().filter(p=>p.playerId===profile.playerId).flatMap(p=>[...Object.values(p.tradeSkills||{}),...Object.values(p.combatSkills||{})]).filter(s=>normalizedSkillId(s.skill)===id).sort((a,b)=>(b.lastSeen||0)-(a.lastSeen||0))[0]||null;
  }
  function augmentCharacter(){
    if(PUBLIC_MODE)return;   // your character's name/level/stats have no place on the shared build
    let panel=document.getElementById('collectorCharacterPanel');if(!panel){panel=document.createElement('div');panel.id='collectorCharacterPanel';panel.className='collector-panel';content.prepend(panel);}
    const profiles=characterProfiles(),p=selectedProfile(),unique=[...new Map(profiles.slice().reverse().map(r=>[r.playerId,r])).values()];
    // Just the picker: which of your characters the planners fill their levels in from. The stats, attributes and
    // skill tables that used to sit here were raw collector data, not something anyone needs to read on these pages.
    panel.classList.add('charpick');
    if(!p){panel.innerHTML='<span class="muted">No character captured yet - log into the game with the collector running.</span>';return;}
    // a record without a name (the screenshot showed a bare id) borrows the name from any other record of that character
    const nameOf=id=>profiles.find(x=>x.playerId===id&&x.name)?.name;
    const label=r=>esc(nameOf(r.playerId)||('Character '+String(r.playerId).slice(0,6)))+(Number.isFinite(r.level)?' · Lv '+r.level:'');
    const html='<label>Using levels from <select id="collectorCharacter">'+unique.map(r=>'<option value="'+esc(r.playerId)+'" '+(r.playerId===p.playerId?'selected':'')+'>'+label(r)+'</option>').join('')+'</select></label>';
    // Do not replace a selector while the user is interacting with it.
    if(document.activeElement?.id!=='collectorCharacter'&&panel.dataset.html!==html){panel.innerHTML=html;panel.dataset.html=html;}
  }

  // ---- Game windows: which character is in which window, and which one the Atlas follows ----------
  // Every open game tab reports the character it runs. "Track" makes that character the one the Atlas's personal
  // figures relate to (gem luck, the character and skill tables); with nothing tracked it follows the most recently active one.
  const FOLLOW_KEY='bxcFollowChar';
  try{selectedCharacterId=localStorage.getItem(FOLLOW_KEY)||null}catch{}
  let gameWindows=[],windowsAt=0;
  function loadWindows(force){
    if(!force&&Date.now()-windowsAt<4000)return;
    windowsAt=Date.now();
    bridgeRequest('get-windows').then(r=>{gameWindows=Array.isArray(r?.windows)?r.windows:[];refreshWindowsPanel()}).catch(()=>{});
  }
  function windowsPanelHtml(){
    const p=selectedProfile();
    const rows=gameWindows.map(w=>{
      const mine=!!w.playerId&&!!p&&p.playerId===w.playerId;
      return `<div class="research-row" style="${mine?'border-left:3px solid #d9b878;padding-left:8px':''}"><b>Window ${esc(w.windowNo)}</b>${w.tabIndex?` · tab ${esc(w.tabIndex+1)}`:''} · ${w.name?`<b>${esc(w.name)}</b>${w.level!=null?` (Lv ${esc(w.level)})`:''}`:'<span class="muted">character not detected yet (log in, or reload this game tab)</span>'} ${mine?'<span class="pill">tracking</span>':''}<div class="muted">${esc(w.title||'')}${w.active?' · the tab showing in its window':''}</div><button type="button" data-follow="${esc(w.playerId||'')}" ${w.playerId?'':'disabled'}>${mine?'Tracking':'Track this character'}</button> <button type="button" data-focus="${esc(w.tabId)}">Show this window</button></div>`;
    }).join('');
    // One closed line by default - it's app housekeeping, not what anyone opens a planner page to read.
    const tracking=p?.name?esc(p.name):'the most recently active character';
    return `<details><summary class="collector-title" style="margin:0">Game windows <span class="muted" style="font-weight:400">· filling in ${tracking}'s levels</span></summary>${rows||'<div class="muted">No game window found. Open the game with the collector loaded, then reload that tab so it can tell the collector which character it is.</div>'}<div class="muted">The Atlas's personal figures (gem luck, skills) follow the tracked character.${localStorage.getItem(FOLLOW_KEY)?' <button type="button" data-follow="">Follow the most recently active</button>':' Right now: most recently active.'}</div></details>`;
  }
  function refreshWindowsPanel(){
    const panel=document.getElementById('collectorWindowsPanel');if(!panel)return;
    panel.innerHTML=windowsPanelHtml();
  }
  function augmentWindows(){
    if(PUBLIC_MODE)return;   // there are no game windows on the shared site
    let panel=document.getElementById('collectorWindowsPanel');
    if(!panel){panel=document.createElement('div');panel.id='collectorWindowsPanel';panel.className='collector-panel';content.prepend(panel);}
    content.prepend(panel);
    panel.innerHTML=windowsPanelHtml();
    loadWindows(false);
  }
  content?.addEventListener('click',e=>{
    const f=e.target.closest?.('[data-follow]'),s=e.target.closest?.('[data-focus]');
    if(f){
      selectedCharacterId=f.dataset.follow||null;
      try{if(selectedCharacterId)localStorage.setItem(FOLLOW_KEY,selectedCharacterId);else localStorage.removeItem(FOLLOW_KEY)}catch{}
      refreshWindowsPanel();
      if(tab==='gems')augmentGems();else if(tab==='calc')augmentCharacter();
      return;
    }
    if(s)bridgeRequest('focus-game-tab',{tabId:Number(s.dataset.focus)}).catch(err=>setCollectorStatus('Collector: '+err.message));
  });
  function xpIntoCurrentLevel(skill, kind){
    const lv=Math.max(1,Number(skill?.level)||1),total=Math.max(0,Number(skill?.experience)||0);
    const CH=globalThis.BXC_CHARACTER_XP||[];
    const base=kind==='Character'?(CH[Math.min(CH.length,lv)-1]||0):kind==='Combat'?(COMBAT_XP[Math.min(COMBAT_XP.length,lv)-1]||0):(TRADE_XP[Math.min(TRADE_XP.length,lv)-1]||0);
    return Math.max(0,total-base);
  }
  function setAutoNote(id, skill, kind){
    const el=document.getElementById(id); if(!el)return;
    if(PUBLIC_MODE){el.textContent='';return;}   // the shared site has no collector - you just type your level
    if(!skill){el.textContent='Collector has not captured this skill yet; reload/play the game and it will fill automatically.';el.className='muted';return;}
    const own=el.dataset.ownLevel==='1';
    el.innerHTML=`Collector: ${esc(prettyId(skill.skill))} Lv ${skill.level} · ${Number(skill.experience||0).toLocaleString()} total XP${own?` · <a href="#" class="collector-use-level">use it (you typed your own level)</a>`:''}`;
    el.className='good';
  }
  function autoFillSkillStarts(force=false){
    if(!snapshot)return;
    try{if(typeof globalThis.bxcCombatSync==='function')globalThis.bxcCombatSync()}catch(_){}   // the combat calculator follows your gear
    const specs=[
      {select:'cSkill',level:'cLevel',into:'cInto',note:'cAutoState',kind:'Trade'},
      {select:'enSkill',level:'enLevel',into:null,note:'enAutoState',kind:'Trade'},   // Quality & enchanting: level only
      {select:'cmbSkill',level:'cmbLevel',into:'cmbInto',note:'cmbAutoState',kind:'Combat'},
      {select:'gSkill',level:'gLevel',into:'gInto',note:'gAutoState',kind:'Trade'},
      {fixed:'character',level:'cmbChar',into:null,note:null,kind:'Character'}   // the combat calculator's character level (hit chance)
    ];
    for(const sp of specs){
      const sel=sp.fixed?null:document.getElementById(sp.select),level=document.getElementById(sp.level),into=sp.into?document.getElementById(sp.into):null; if((!sp.fixed&&!sel)||!level||(sp.into&&!into))continue;
      const id=sp.fixed||normalizedSkillId(sel.value),skill=liveSkill(id); if(id==='character')sp.kind='Character';
      // A level you type yourself stays: the collector no longer puts yours back on every XP gain (and "XP into it" starts
      // at 0, since the collector's XP belongs to its own level). Another skill, another character or the note's "use it"
      // hands it back to the collector.
      const noteEl=sp.note?document.getElementById(sp.note):null;
      if(!level.dataset.ownWatch){level.dataset.ownWatch='1';level.addEventListener('input',e=>{if(!e.isTrusted)return;level.dataset.ownLevel='1';level.dataset.ownFor=level.dataset.collectorSkill||'';if(into){into.value='0';into.dispatchEvent(new Event('input',{bubbles:true}))}if(noteEl){noteEl.dataset.ownLevel='1';setAutoNote(sp.note,liveSkill(sp.fixed||normalizedSkillId(sel.value)),sp.kind)}});
        if(noteEl)noteEl.addEventListener('click',e=>{if(!e.target.closest('.collector-use-level'))return;e.preventDefault();delete level.dataset.ownLevel;delete noteEl.dataset.ownLevel;autoFillSkillStarts(true)})}
      if(force||level.dataset.ownFor!==id){delete level.dataset.ownLevel;if(noteEl)delete noteEl.dataset.ownLevel}
      if(sp.note)setAutoNote(sp.note,skill,sp.kind); if(!skill)continue;
      if(level.dataset.ownLevel==='1'){level.dataset.collectorSkill=id;continue}
      // a page that only takes the level (no "XP into it" box) refreshes when the level changes, not on every XP gain
      const marker=`${selectedCharacterId}:${id}:${skill.level}${sp.into?':'+skill.experience:''}`;
      if(force || level.dataset.collectorSkill!==id || level.dataset.collectorMarker!==marker){
        level.value=String(skill.level||1); if(into)into.value=String(xpIntoCurrentLevel(skill,sp.kind));
        level.dataset.collectorSkill=id; level.dataset.collectorMarker=marker; if(into){into.dataset.collectorSkill=id; into.dataset.collectorMarker=marker;}
        level.dispatchEvent(new Event('input',{bubbles:true})); if(into)into.dispatchEvent(new Event('input',{bubbles:true}));
      }
    }
  }
  // Planner pages keep to the planner: just the character picker (whose levels fill in) - no character/skills tables
  // or game-windows list (they were clutter above every calculator).
  function augmentCalc(){augmentCharacter();autoFillSkillStarts(false);const old=document.getElementById('collectorGatherPanel');if(old)old.remove();const gatherBox=[...content.querySelectorAll('.calcbox')].find(x=>x.querySelector('#gResult'));if(gatherBox)gatherBox.insertAdjacentHTML('beforeend',gatheringPanel());if(typeof window.renderCraftQualityObserved==='function')window.renderCraftQualityObserved(snapshot)}
  function augmentNotes(){const old=document.getElementById('collectorNotesPanel');if(old)old.remove();const d=document.createElement('div');d.id='collectorNotesPanel';d.innerHTML=connectionPanel();content.prepend(d)}
  // Every gem the collector has watched you pick up, by kind and carat. These are finds, not your current pockets:
  // it never sees what you spend, sell or hand to the witch, so this is the most you could be holding, not the least.
  // how many gems of a kind and carat the collector has recorded ("*" = any kind): the witch calculator starts from it.
  // These are finds (it never sees what you spend), so it is the most you could be holding.
  if(!PUBLIC_MODE)globalThis.bxcGemCount=(kind,carat)=>(snapshot?.gems||[]).filter(g=>+g.carat===+carat&&(kind==='*'||g.typeId==='gem-'+kind)).length;
  window.renderGemStock=function(){if(snapshot&&globalThis.bxcGemMineRefresh)globalThis.bxcGemMineRefresh()};   // only the count (unless typed) and answers
  function augmentCurrentTab(){
    if(!snapshot)return;
    if(pageNow&&tab===PAGE_TAB[pageNow.kind])return;   // a monster/item/resource page is open (see Pages and links)
    if(tab==='monsters')augmentMonsters();else if(tab==='gems')augmentGems();else if(tab==='drops')content.innerHTML=killsPanelHtml()+dropsHtml(q.value);else if(tab==='assets')content.innerHTML=assetsHtml(q.value);else if(tab==='xp')augmentXp();else if(tab==='calc')augmentCalc();else if(tab==='research')content.innerHTML=researchHtml(q.value);else if(tab==='notes')augmentNotes();
    else if(tab==='zones')content.innerHTML=zonesHtml(q.value);
    else if(tab==='resources'){content.innerHTML=resourcesHtml(q.value);document.querySelectorAll('.card[data-r]').forEach(e=>e.onclick=ev=>{if(ev.target.closest('.manualres-remove'))return;const yieldLink=ev.target.closest('.resource-yield-link');if(yieldLink){goToItemCard(yieldLink.dataset.item);return;}focusResource(e.dataset.r)});}
    else if(tab==='items')content.innerHTML=itemsHtml(q.value);
    else if(tab==='gemcombine')window.renderGemStock();
    else if(tab==='news')loadNews();
  }

  function updateStatus(){
    if(!snapshot)return;
    if(PUBLIC_MODE){setCollectorStatus(`Updated ${snapshot.generatedAt?new Date(snapshot.generatedAt).toLocaleString():'—'}`);return;}
    const saved=state.lastSyncAt?new Date(state.lastSyncAt).toLocaleTimeString():'—';setCollectorStatus(`Updated ${saved}`);   // just when (the counts were clutter)
  }
  // Cheap fingerprints of a snapshot: array sizes and newest rows, plus the small stores that change in place.
  // They let a refresh that brought nothing new skip the heavy work, and let the map keep its markers,
  // open popups and selection when only the guide side changed.
  function snapSig(s,withStats){
    const p=[];
    for(const k of Object.keys(s||{}).sort()){
      const v=s[k];
      if(Array.isArray(v)){const f=v[0];p.push(k+':'+v.length+':'+(f&&(f.time??f.key??f.id??f.lastSeen)))}
    }
    p.push(JSON.stringify(s?.zones||[]),JSON.stringify(s?.selfState||[]),JSON.stringify(s?.manualResources||[]));
    p.push('quests:'+(s?.questItems||[]).map(q=>q.itemTypeId+'='+(q.quests||[]).length).join(','));   // new quest items alone are worth a refresh
    if(withStats)p.push(JSON.stringify(s?.stats||{}));
    return p.join('|');
  }
  let lastMapSig='',lastFullSig='';
  function keepSidebarView(fn){
    const side=document.getElementById('side'),top=side?side.scrollTop:0,ctop=content?content.scrollTop:0;
    const ae=document.activeElement,keep=ae&&content&&content.contains(ae)&&ae.dataset&&ae.dataset.t?ae.dataset.t:null;
    const outlined=[...(content?.querySelectorAll('.card')||[])].filter(c=>c.style.outline).map(c=>c.dataset.t).filter(Boolean);
    fn();
    if(side)side.scrollTop=top;
    if(content)content.scrollTop=ctop;
    if(keep){const c=content.querySelector(`.card[data-t="${CSS.escape(keep)}"]`);if(c){c.tabIndex=-1;c.focus({preventScroll:true})}}
    for(const t of outlined){const c=content.querySelector(`.card[data-t="${CSS.escape(t)}"]`);if(c)c.style.outline='2px solid #e6bf69'}
  }
  // opts.layoutOnly: only the layout stores changed (world objects, zones, regions, hand-added spots - syncLayout, every
  // few seconds while you walk), so only what's built from them is redone, and a reference page you're reading is not
  // rebuilt under you: it gets the "New data - refresh" link instead (the project's rule for live updates).
  function applySnapshot(s,opts={}){
    rawSnapshot=s||{};snapshot=splitPlaces(rawSnapshot);window.BINXONIA_COLLECTOR_SNAPSHOT=snapshot;if(!state.visitBaseline)state.visitBaseline={...(loadStoredBaseline()||snapshot.stats||{})};
    console.time('applySnapshot:derive');
    if(opts.layoutOnly){deriveResourceSkills();deriveResourceCatalog();deriveItems();deriveZones();deriveSelf();deriveResearch()}
    else{deriveResourceSkills();deriveResourceCatalog();deriveGatherStats();deriveGems();deriveXp();deriveKills();deriveDrops();deriveItems();deriveZones();deriveSelf();deriveAssets();deriveResearch();deriveMonsters()}
    console.timeEnd('applySnapshot:derive');
    const mapSig=snapSig(snapshot,false);
    if(mapSig!==lastMapSig||!legendControl){
      lastMapSig=mapSig;
      // redrawing rebuilds every marker, which closes a popup you had open on one; put it back afterwards
      const pop=typeof map!=='undefined'?map._popup:null,popState=pop&&map.hasLayer(pop)?{ll:pop.getLatLng(),html:pop.getContent()}:null;
      drawMap();
      if(popState&&typeof L!=='undefined'&&!(map._popup&&map.hasLayer(map._popup)))L.popup().setLatLng(popState.ll).setContent(popState.html).openOn(map);
    }
    lastFullSig=snapSig(rawSnapshot,true);
    setTimeout(openFromHash,0);state.lastSyncAt=Date.now();lastSnapshotStats={...(snapshot.stats||{})};updateStatus();
    if(opts.layoutOnly&&!LIVE_TABS.has(tab)){showStaleLink();return}
    keepSidebarView(()=>{if(tab!=='calc'&&tab!=='gemcombine'){render();augmentCurrentTab()}else augmentCurrentTab()});
  }
  // The website's lite start: a partial snapshot (monsters and outdoor resources as the map draws them, from
  // data/map.json, plus the base file) and the caves' entrances and contents as the publish worked them out. Only
  // what the map needs is derived; the whole database replaces it when something needs it (bxcEnsureFull).
  function applyLite(base,m){
    const types=m.npcTypes||[];
    const npcs=(m.npcs||[]).map((r,i)=>{const [ti,id,level,elite,ls,px,py,pz,ox,oy,oz,cls]=r,t=types[ti]||[];
      const n={id:id||('lite-'+i),typeId:t[0],name:t[1],level,elite:!!elite,lastSeen:ls*1000,position:{x:px,y:py,z:pz},originPosition:ox!=null?{x:ox,y:oy,z:oz||0}:null};if(cls)n.npcClass=cls;return n});
    const worldObjects=(m.objects||[]).map((r,i)=>{const [typeId,name,x,y,status,fish,z,ls,fs]=r,o={id:'lite-o'+i,typeId,name,position:{x,y,z:z||0},status};if(ls)o.lastSeen=ls*1000;if(fs)o.firstSeen=fs*1000;if(fish)o.data={fishTypes:fish};return o});
    rawSnapshot={...base,npcs,worldObjects,npcObservations:[],drops:[],terrain:[],zoneTransitions:[],bxcLite:true,bxcHomeCounts:m.home||null};
    snapshot=rawSnapshot;window.BINXONIA_COLLECTOR_SNAPSHOT=snapshot;
    deriveResourceSkills();deriveResourceCatalog();deriveAssets();
    state.zones=new Map((m.zones||[]).map(z=>[z.z,z]));state.zoneEntrances=new Map(m.entrances||[]);
    state.zoneContents=new Map((m.contents||[]).map(([z,objs])=>[z,{objects:new Map(objs),monsters:new Map()}]));
    litePeople={givers:m.givers||null,trainers:m.trainers||null};
    state.areaEntrances=[];if(!state.dungeons)state.dungeons=new Map();if(!state.dungeonOfZone)state.dungeonOfZone=new Map();
    drawMap();lastMapSig=null;   // the whole database, if it comes, draws it again
    setTimeout(openFromHash,0);updateStatus();
    keepSidebarView(()=>{if(!LITE_LIST_TABS.has(tab)){render();augmentCurrentTab()}});
  }
  // the people the map marks, as the publish placed them (from every sighting, which the lite start does not load)
  let litePeople=null;
  if(PUBLIC_MODE){const qgBase=questGiverList,trBase=trainerList;
    questGiverList=function(){return !isFull()&&litePeople&&litePeople.givers?litePeople.givers:qgBase()};
    trainerList=function(){return !isFull()&&litePeople&&litePeople.trainers?litePeople.trainers:trBase()}}
  // sections listing everything (and the cave layouts): they need the whole database
  const LITE_LIST_TABS=new Set(['monsters','items','resources','zones','gems','calc','drops','xp','research','assets']);
  const LITE_FILE_LISTS=new Set(['monsters','items','resources','gems','calc']);   // these come from data/lists.json; the rest (app-only) need everything
  const liteListWaits=()=>{if(!PUBLIC_MODE||isFull()||!LITE_LIST_TABS.has(tab))return false;try{if(tab==='zones'&&zonesIn)return false;if(LITE_FILE_LISTS.has(tab)&&listsIn)return false;return !(pageNow&&tab===PAGE_TAB[pageNow.kind])}catch{return true}};   // (set further down: PAGE_TAB, zonesIn)   // (PAGE_TAB is set further down)
  if(PUBLIC_MODE){const augBase=augmentCurrentTab;augmentCurrentTab=function(){if(liteListWaits())return;return augBase.apply(this,arguments)}}
  if(PUBLIC_MODE&&typeof render==='function'){const liteBase=render;render=function(){
    if(liteListWaits()){content.innerHTML='<p class="muted">Loading…</p>';(tab==='zones'?ensureZones():LITE_FILE_LISTS.has(tab)?ensureLists():globalThis.bxcEnsureFull?.()).then(()=>{render();augmentCurrentTab()});return}   // the Zones list needs only the caves' data
    return liteBase.apply(this,arguments)}}
  // The caves' and buildings' own data (data/zones.json, a few dozen KB), the first time a layout is opened: merged
  // into the lite snapshot (a new snapshot object, so the layouts' caches start fresh) with what the publish worked
  // out from it. Without that file (an older publish) the whole database is loaded instead.
  let zonesLoad=null,zonesIn=false;
  function ensureZones(){
    if(isFull()||zonesIn)return Promise.resolve();
    return zonesLoad||(zonesLoad=fetch('data/zones.json').then(r=>{if(!r.ok)throw new Error('no zones file');return r.json()}).then(d=>{
      if(isFull())return;
      const outdoors=a=>(a||[]).filter(r=>!(r&&r.position&&r.position.z));   // the lite rows inside caves are replaced by the full ones
      rawSnapshot=snapshot={...snapshot,terrain:d.terrain||[],worldObjects:[...outdoors(snapshot.worldObjects),...(d.worldObjects||[])],npcs:[...outdoors(snapshot.npcs),...(d.npcs||[])],npcObservations:d.npcObservations||[],zoneTransitions:d.zoneTransitions||[]};
      window.BINXONIA_COLLECTOR_SNAPSHOT=snapshot;
      deriveResourceSkills();deriveResourceCatalog();
      const st=d.state||{},toMap=a=>new Map(a||[]);
      state.dungeons=toMap(st.dungeons);state.dungeonOfZone=toMap(st.dungeonOfZone);state.zoneParent=toMap(st.zoneParent);
      state.zoneInternalExits=toMap(st.zoneInternalExits);state.zoneSurfaceExits=toMap(st.zoneSurfaceExits);
      state.zoneContents=new Map((st.zoneContents||[]).map(([z,c])=>[z,{monsters:toMap(c.monsters),objects:toMap(c.objects)}]));
      zonesIn=true;
    }).catch(err=>{zonesLoad=null;console.warn('[atlas] cave data',err);return globalThis.bxcEnsureFull?.()}));
  }
  // The section lists' own file (data/lists.json), the first time Bestiary, Items, Resources or Gems opens; the
  // caves' file comes along (the lists say which caves things are in). Without it, the whole database instead.
  let listsLoad=null,listsIn=false;
  function ensureLists(){
    if(isFull()||listsIn)return Promise.resolve();
    return listsLoad||(listsLoad=Promise.all([fetch('data/lists.json').then(r=>{if(!r.ok)throw new Error('no lists file');return r.text()}),ensureZones()]).then(([text])=>{
      if(isFull())return;
      const d=JSON.parse(text,listReviver);
      if(Array.isArray(d.catalog)&&Array.isArray(D.catalog)){D.catalog.length=0;D.catalog.push(...d.catalog)}   // in place: other code holds this list
      state.monster=d.monsterNames instanceof Map?d.monsterNames:new Map(d.monsterNames||[]);
      for(const k of ['dropAgg','looted','kills','items','gems','gemByType'])if(d[k]!==undefined)state[k]=d[k];
      rawSnapshot=snapshot={...snapshot,gems:d.raw?.gems||[],inventoryTypes:d.raw?.inventoryTypes||[]};window.BINXONIA_COLLECTOR_SNAPSHOT=snapshot;
      listsIn=true;
    }).catch(err=>{listsLoad=null;console.warn('[atlas] lists data',err);return globalThis.bxcEnsureFull?.()}));
  }
  if(PUBLIC_MODE){
    const zoneBase=openZoneOverlay,dungeonBase=openDungeonOverlay;
    openZoneOverlay=function(...a){if(!isFull()&&!zonesIn){ensureZones().then(()=>openZoneOverlay(...a));return}return zoneBase.apply(this,a)};
    openDungeonOverlay=function(...a){if(!isFull()&&!zonesIn){ensureZones().then(()=>openDungeonOverlay(...a));return}return dungeonBase.apply(this,a)};
  }
  function loadStoredBaseline(){try{return JSON.parse(localStorage.getItem(LAST_SEEN_KEY)||'null')?.stats||null}catch{return null}}

  // Heavy asset fields (image data URLs, atlas JSON text) rarely change, so they are kept here and
  // only re-fetched when the collector reports a different fingerprint (sig) for that asset.
  const assetStore=new Map();
  function knownAssetSigs(){const known={};for(const [url,h] of assetStore)known[url]=h.sig;return known}
  // Re-attaches stored heavy fields to assets the collector sent as cached, and records the rest.
  // Returns false when a cached asset has nothing stored to re-attach (caller then does a full sync).
  function rehydrateAssets(s){
    if(!s||!Array.isArray(s.assets))return true;
    let complete=true;const urls=new Set();
    s.assets=s.assets.map(a=>{
      urls.add(a.url);
      if(a.cached){
        const h=assetStore.get(a.url),{cached,...rest}=a;
        if(!h||h.sig!==a.sig){complete=false;return rest}
        return {...rest,dataUrl:h.dataUrl,text:h.text};
      }
      if(a.url&&a.sig)assetStore.set(a.url,{sig:a.sig,dataUrl:a.dataUrl,text:a.text});
      return a;
    });
    for(const url of [...assetStore.keys()])if(!urls.has(url))assetStore.delete(url);
    return complete;
  }
  // Sync now: the collector saves a backup first (skipped when nothing changed since the last one), then this page catches up.
  let syncBusy=false;
  async function syncAndBackup(){
    if(syncBusy)return;syncBusy=true;
    let note='';
    try{
      setCollectorStatus('Collector: backing up…');
      const r=await bridgeRequest('sync-backup');
      note=r&&r.saved?'backup saved':r&&r.unchanged?'no changes since the last backup':r&&r.busy?'a backup is already running':r&&r.ok===false?'backup failed ('+(r.error||'unknown')+')':'';
    }catch(err){note='backup failed ('+(err&&err.message||err)+')'}
    await syncNow();
    const el=document.getElementById('collectorStatus');if(el&&note)el.textContent+=' · '+note;
    syncBusy=false;
  }
  // quiet: a background refresh - when it brings nothing new, the page is left exactly as it is.
  // What this page holds, as the collector stamped it: stores it reports unchanged are not sent again (s.same) and
  // this page keeps its own copy of them. Only offered while this page really has a snapshot to keep them from.
  let heldStamps=null;
  function haveStamps(){return snapshot&&heldStamps?heldStamps:undefined}
  function takeSame(s){
    if(!s)return s;
    for(const k of s.same||[])if(rawSnapshot&&k in rawSnapshot)s[k]=rawSnapshot[k];
    if(s.snapStamps){const v={...(heldStamps&&heldStamps.boot===s.snapStamps.boot?heldStamps.v:{}),...s.snapStamps.v};heldStamps={boot:s.snapStamps.boot,v}}
    delete s.same;delete s.snapStamps;return s;
  }
  // (on the website, after an edit: it is saved in your collector and goes out with the next publish)
  if(PUBLIC_MODE&&EDIT)globalThis.bxcSiteEditSaved=()=>{setCollectorStatus('Saved in your collector \u2014 the website shows it after the next publish, in a few minutes (reload then)');return Promise.resolve()};
  async function syncNow(quiet){if(PUBLIC_MODE){return EDIT&&globalThis.bxcSiteEditSaved?globalThis.bxcSiteEditSaved():undefined}if(syncing)return;syncing=true;if(quiet!==true)setCollectorStatus('Collector: syncing…');try{
    let s=takeSame(await bridgeRequest('get-snapshot',{knownAssets:knownAssetSigs(),have:haveStamps()}));
    if(!rehydrateAssets(s)){assetStore.clear();heldStamps=null;s=takeSame(await bridgeRequest('get-snapshot'));rehydrateAssets(s)}
    if(quiet===true&&snapshot&&snapSig(s,true)===lastFullSig){state.lastSyncAt=Date.now();updateStatus();return}
    applySnapshot(s);
    fullOnlyAt=fullOnlySig(s.stats);
    checkLoaded();
  }catch(err){setCollectorStatus('Collector: not connected');console.warn(err)}finally{syncing=false}}
  // New gathers, drops, kills, XP and the map all reach this page the moment they happen, through its live connection.
  // Reloading the whole database - forty-odd megabytes, and most of a second of the same thread that records the game -
  // is only needed for the few things that are never sent live: monsters met for the first time, new items, new
  // pictures. So it is looked at rarely, and only actually done when one of those has changed.
  const FULL_ONLY=['npcs','skills','inventoryTypes','messageTypes','assets'];
  let fullOnlyAt=null;
  function fullOnlySig(stats){const c=stats||{};return FULL_ONLY.map(k=>c[k]||0).join('|')}
  // If the collector's database did not load properly, this page would show an almost empty world with no word of
  // why. Say so plainly instead: the research is not gone, and opening the app again brings it back.
  async function checkLoaded(){
    try{
      const st=await bridgeRequest('get-stats');let el=document.getElementById('bxcLoadWarn');
      if(st&&st.possibleDataLoss){
        if(!el){el=document.createElement('div');el.id='bxcLoadWarn';el.setAttribute('role','alert');
          el.style.cssText='margin:6px 12px 0;padding:8px 12px;border:1px solid #c4574b;border-radius:7px;background:rgba(196,87,75,.15);color:#f1c9c3;font-size:13px';
          el.textContent="Your research didn't load — close the app and open it again. Recording is paused until then, and your backups are untouched. If it keeps happening, Options → Import… with the newest backup in Saved Data brings everything back.";
          const bar=document.getElementById('bar');if(bar)bar.after(el)}
      }else if(el)el.remove();
    }catch(_){}
  }
  async function fullSyncIfNeeded(){
    if(document.hidden||syncing)return;
    try{const st=await bridgeRequest('get-stats');if(fullOnlyAt!==null&&fullOnlySig(st&&st.stats)===fullOnlyAt)return}catch(_){}
    syncNow(true);
  }

  // Exploring makes the map data grow every few seconds; only the map's own stores are fetched for that (a
  // fraction of a full sync), merged into what the page already has. If the collector answers with a full
  // snapshot anyway (an older collector), that is used as it is.
  // 'terrain' is deliberately left out of this frequent list: it is the room tile/wall data behind every
  // zone overlay, and unlike the others it never shrinks or gets superseded - it only ever grows as more of
  // the game gets explored. A session that had been running for a while had it well past a hundred thousand
  // rows, and refetching (and re-scanning, in several derive*() passes) the *entire* table on this 8-second
  // timer, forever, is exactly what made the page get steadily laggier the longer it stayed open - a second,
  // separate cause from the DELTA_KEYS growth fixed above. Existing zone overlays don't need split-second
  // terrain freshness, so it now only refreshes on the initial load and the periodic full resync (see
  // fullSyncIfNeeded) instead of every 8 seconds.
  const LAYOUT_STORES=['worldObjects','zones','regions','manualResources','zoneTransitions'];
  async function syncLayout(){
    if(syncing||!snapshot)return syncNow();
    syncing=true;let again=false;
    try{
      const s=takeSame(await bridgeRequest('get-snapshot',{only:LAYOUT_STORES,have:haveStamps()}));
      if(s&&s.partial){const {partial,keys,...rest}=s;applySnapshot(Object.assign({},rawSnapshot,rest),{layoutOnly:true})}
      else if(s){if(rehydrateAssets(s))applySnapshot(s);else again=true}
    }catch(err){setCollectorStatus('Collector: not connected');console.warn(err)}finally{syncing=false}
    if(again)syncNow();
  }
  const DELTA_KEYS=['crafts','enchantments','drops','gathers','gems','exp','skillObservations','npcObservations','zoneTransitions'];
  const LAYOUT_STAT_KEYS=['worldObjects','zones','regions','manualResources'], LAYOUT_SYNC_MS=8000;
  let layoutSyncTimer=null;
  function scheduleLayoutSync(){
    if(layoutSyncTimer)return;
    layoutSyncTimer=setTimeout(()=>{layoutSyncTimer=null;syncLayout()},LAYOUT_SYNC_MS);
  }
  // Coming back to the Atlas tab after exploring in the game tab catches up straight away. Nothing to catch up
  // on in the shared build - there's no live collector to re-sync with.
  document.addEventListener('visibilitychange',()=>{if(!PUBLIC_MODE&&!document.hidden&&snapshot)syncNow(true)});
  // Same caps background.js itself uses when it builds a bounded snapshot from the database (get-snapshot) - a
  // live push's own rows kept piling onto the front of these arrays with nothing ever trimmed off the back, so
  // every one of these lists (and every derive*() that scans one, on every single push) grew for as long as
  // Atlas stayed open. Cheap for the first few minutes, but a session left running for a while had these well
  // past what the database itself ever hands back on a full sync, and the page got steadily laggier the longer
  // it sat - not from any one push being expensive, but from every push being a little more expensive than the
  // last, forever.
  const DELTA_KEY_LIMITS={skillObservations:20000,gathers:20000,gems:5000,exp:40000,drops:40000,enchantments:5000,crafts:20000,zoneTransitions:5000,npcObservations:20000};
  function applyDelta(push){
    if(!snapshot)return;
    let changed=false;
    let zoneTransitionsChanged=false;
    const delta=push?.delta||{};
    for(const k of DELTA_KEYS){
      const rows=delta[k];
      if(Array.isArray(rows)&&rows.length){
        // new rows go to the place they happened in (splitPlaces), and are kept as sent for the next full split
        const cap=DELTA_KEY_LIMITS[k],add=(list,r)=>{const m=[...r,...(list||[])];return cap&&m.length>cap?m.slice(0,cap):m};
        const placed=k==='zoneTransitions'?placeTransitions(rows,snapshot[k]||[]):k==='npcObservations'?rows.map(placeRow):rows;
        if(rawSnapshot&&rawSnapshot!==snapshot)rawSnapshot[k]=add(rawSnapshot[k],rows);
        snapshot[k]=add(snapshot[k],placed);
        changed=true;if(k==='zoneTransitions')zoneTransitionsChanged=true;
      }
    }
    if(push?.stats){
      // Floor tiles, walls, objects, zones and regions are not part of the live delta, so when their
      // counts move (you walked somewhere new) a full refresh is scheduled shortly, at most every few seconds.
      const grew=LAYOUT_STAT_KEYS.some(k=>(push.stats[k]||0)!==(snapshot.stats?.[k]||0));
      snapshot.stats=push.stats;changed=true;
      if(grew)scheduleLayoutSync();
    }
    let selfChanged=false;
    if(Array.isArray(push?.selfState)){snapshot.selfState=push.selfState;selfChanged=true;changed=true}
    if(selfChanged){deriveSelf();drawSelfMarker();if(state.openZone!=null)refreshZoneOverlaySoon();
      try{if(typeof globalThis.bxcCombatSync==='function')globalThis.bxcCombatSync()}catch(_){}}   // gear or stats changed: the combat calculator follows
    if(!changed)return;
    liveZoneTransitions=liveZoneTransitions||zoneTransitionsChanged;
    if(zoneTransitionsChanged)zonesStaleLive=true;
    scheduleLiveRefresh();
  }
  // The data above is merged at once, but re-deriving everything (nine passes over tens of thousands of rows) and
  // rebuilding the open tab happened on EVERY live update - about twice a second while playing, which kept the page
  // 100% busy (a big tab like Items is tens of thousands of elements) and made dragging the map stutter, unlike the
  // shared copy on GitHub that gets no live updates. Now it runs at most every LIVE_REFRESH_MS, and never while the
  // map is being dragged or zoomed - it catches up as soon as you let go.
  const LIVE_REFRESH_MS=4000;
  let liveRefreshTimer=null,liveRefreshAt=0,liveZoneTransitions=false,mapMoving=false;
  if(typeof map!=='undefined'){map.on('movestart zoomstart',()=>{mapMoving=true});map.on('moveend zoomend',()=>{mapMoving=false;if(liveRefreshTimer===null&&liveRefreshAt===-1)scheduleLiveRefresh()})}
  function scheduleLiveRefresh(){
    if(liveRefreshTimer!==null)return;
    const wait=Math.max(0,LIVE_REFRESH_MS-(Date.now()-liveRefreshAt));
    liveRefreshTimer=setTimeout(runLiveRefresh,wait);
  }
  function runLiveRefresh(){
    liveRefreshTimer=null;
    if(mapMoving){liveRefreshAt=-1;return;}   // picked up again on moveend
    liveRefreshAt=Date.now();
    state.lastSyncAt=Date.now();lastSnapshotStats={...(snapshot.stats||{})};updateStatus();
    // Only the XP and Gems tabs show things that change minute to minute (your XP rate, your gem luck); they keep
    // updating live. The reference tabs (Bestiary, Items, Resources, Zones, Crafting) change a few times an hour, so
    // they are not rebuilt behind you: a "New data" link appears instead, and switching tabs brings them up to date.
    // The Zones tab also updates when you move between zones. The derive*() passes run only when something shows them.
    const zt=liveZoneTransitions;liveZoneTransitions=false;
    if(!(LIVE_TABS.has(tab)||(tab==='zones'&&zt))){liveStale=true;showStaleLink();return;}
    deriveLive();
    if(tab!=='calc')setTimeout(augmentCurrentTab,0);else augmentCalcWhenIdle();
  }
  let zonesStaleLive=false;   // a live update brought new zone crossings (see deriveLive)
  const LIVE_TABS=new Set(['xp','gems']);
  let liveStale=false;
  function deriveLive(){
    deriveResourceSkills();deriveResourceCatalog();deriveGatherStats();deriveGems();deriveXp();deriveKills();deriveDrops();deriveItems();
    // Zones (cave and building layouts from ~190k floor tiles) took over a second and only change with a new door
    // crossing; full refreshes redo them anyway (applySnapshot). So live catch-ups redo them only after a crossing.
    if(zonesStaleLive){deriveZones();zonesStaleLive=false}
    liveStale=false;hideStaleLink();
  }
  function showStaleLink(){
    let b=document.getElementById('collectorStale');
    if(!b){
      const cs=document.getElementById('collectorStatus');if(!cs)return;
      b=document.createElement('button');b.id='collectorStale';b.type='button';b.className='collector-stale';
      b.textContent='New data — refresh';b.title='New gathers, drops or sightings have come in since this list was drawn';
      b.onclick=()=>{deriveLive();keepSidebarView(()=>{render();augmentCurrentTab()})};
      cs.after(b);
    }
    b.hidden=false;
  }
  function hideStaleLink(){const b=document.getElementById('collectorStale');if(b)b.hidden=true}
  // Switching tabs (or anything else that redraws the sidebar) first catches up on data that came in meanwhile.
  if(!PUBLIC_MODE&&typeof render==='function'){const baseRender=render;render=function(){if(liveStale)deriveLive();return baseRender.apply(this,arguments)}}
  // While you play, a live update lands every half second or so. Rebuilding a planner page on each one shifted the
  // page under an open dropdown, and the type-to-search boxes close on any scroll/shift - so every list closed before
  // you could pick from it. While a dropdown, box or field is in use the rebuild waits, and runs once you're done.
  let calcAugmentPending=false;
  const planInUse=()=>{const a=document.activeElement;return !!(a&&a!==document.body&&content?.contains(a)&&a.closest('.bxc-combo,select,input,textarea'))||!!document.querySelector('#bxc-combo-list[style*="display: block"]');};
  function augmentCalcWhenIdle(){if(planInUse()){calcAugmentPending=true;return;}calcAugmentPending=false;augmentCalc();}
  document.addEventListener('focusout',()=>{if(!calcAugmentPending)return;setTimeout(()=>{if(tab==='calc'&&calcAugmentPending&&!planInUse())augmentCalcWhenIdle();},120);},true);

  window.BINXONIA_COLLECTOR_API={get snapshot(){return snapshot},get state(){return state},monsterStats:typeId=>state.monster.get(typeId)||null,markersForType:typeId=>state.liveMarkersByType.get(typeId)||[],gatherStats:itemTypeId=>state.gather.get(itemTypeId)||state.gather.get(slug(itemTypeId))||null,sync:syncNow,researchHtml};

  const coreFocus=typeof focus==='function'?focus:null;
  if(coreFocus){
    focus=function(type){
      const liveMarks=state.liveMarkersByType.get(type)||[];
      if(typeof showMonsterSelection==='function')return showMonsterSelection(type,liveMarks,true);
      return coreFocus(type);
    };
  }

  let liteSearch=null;   // the website's saved search list (data/search.json), used until the whole database is in
  function globalSearchEntries(){
    if(PUBLIC_MODE&&!isFull()&&liteSearch)return liteSearch;
    return [
      ...(D.catalog||[]).map(m=>({kind:'Monster',tab:'monsters',id:m.typeId,name:m.name,detail:'Level '+m.baseLevel+' · '+(m.family||''),image:()=>monsterImg(m),attr:'t'})),
      ...[...namedNpcs().values()].map(e=>({kind:e.typeId==='human'?'Person':'Named',tab:'monsters',page:'npc',id:e.slug,name:e.name,detail:prettyId(e.typeId)+(npcRole(e.name)?' · '+npcRole(e.name):''),image:()=>npcImg(e),attr:'npc'})),
      ...[...(state.items?.values()||[])].map(r=>({kind:'Item',tab:'items',id:r.itemTypeId,name:prettyId(r.itemTypeId),detail:itemSourcesText(r),image:()=>itemImgFor(r.itemTypeId),attr:'item',record:r})),
      ...[...(state.resourceCatalog?.values()||[])].map(r=>({kind:'Resource',tab:'resources',id:r.key,name:resourceDisplayName(r),detail:prettyId(r.skill||''),image:()=>resourceImg(r),attr:'r'})),
      // a cave of several rooms is one result (its first room), not one per room
      ...(()=>{const by=new Map();for(const r of state.zones?.values()||[]){const n=r.name||'Zone '+r.z,g=by.get(n);if(g)g.n++;else by.set(n,{r,n:1})}return [...by.values()].map(({r,n})=>({kind:'Zone',tab:'zones',id:String(r.z),name:r.name||'Zone '+r.z,detail:n>1?n+' rooms':'Its layout',attr:'zone'}))})(),
      // guides, quests, places on the map and the menu's sections: each has a page (a link) of its own too
      ...((globalThis.bxcGuides&&globalThis.bxcGuides.list)||[]).map(g=>({kind:'Guide',page:'guide',id:g.slug,name:g.title,detail:[g.group,g.blurb].filter(Boolean).join(' · ')})),
      ...(snapshot?.quests||[]).filter(x=>x&&x.name&&x.questId&&!String(x.questId).startsWith('__')).map(x=>({kind:'Quest',page:'guide',id:'quest-'+npcSlug(x.questId),name:x.name,detail:[x.recommendedLevel?'Level '+x.recommendedLevel:'',x.giverName?'from '+x.giverName:''].filter(Boolean).join(' · ')})),
      ...(D.pois||[]).filter(p=>p&&p.name).map(p=>({kind:'Place',href:'#/map/place/'+encodeURIComponent(p.name),name:p.name,detail:prettyId(p.category||'')+' on the world map'})),
      ...[...document.querySelectorAll('.tab:not(.bxc-menu-btn)')].filter(b=>!b.dataset.gpage&&b.textContent.trim()).map(b=>({kind:'Section',href:'#/'+tabKey(b),name:b.textContent.trim(),detail:'A section of the Atlas'}))
    ].map(e=>(e.href||(e.href=e.page?pageHref(e.page,e.id):e.tab==='zones'?'#/zone/'+e.id:({monsters:'#/monster/',items:'#/item/',resources:'#/resource/'}[e.tab]||'#/')+encodeURIComponent(e.id)),e));
  }
  function globalSearchMatches(entries,query){
    // A search naming damage types ("slash", "resist crush", "ogre stab") lists only the monsters weak to / resisting them.
    const pq=typeof parseWeakQuery==='function'?parseWeakQuery(query):null;
    if(pq&&(pq.weak.length||pq.resist.length)){
      const byType=new Map((D.catalog||[]).map(m=>[m.typeId,m]));
      entries=entries.filter(e=>e.kind==='Monster'&&byType.has(e.id)&&pq.matches(byType.get(e.id)));
      query=pq.text;
      if(!query)return entries;
    }
    // lower case, dashes as spaces, other punctuation dropped ("moonfangs" finds Moonfang's Lair)
    const norm=s=>String(s||'').toLowerCase().replace(/[-_/]+/g,' ').replace(/[^a-z0-9 ]+/g,'').replace(/\s+/g,' ').trim(),needle=norm(query),terms=needle.split(' ').filter(Boolean);
    if(!terms.length)return [];
    // the name itself: exactly it, starts with it, a word in it starts with it, it's inside it; else only the details
    const rank=n=>n===needle?0:n.startsWith(needle)?1:(' '+n).includes(' '+needle)?2:n.includes(needle)?3:terms.every(t=>(' '+n).includes(' '+t))?4:terms.every(t=>n.includes(t))?5:6;
    const KIND_ORDER=['Quest','Guide','Monster','Named','Person','Item','Resource','Place','Zone','Section'];
    return entries.map(e=>{const n=norm(e.name);return {e,n,r:rank(n),k:KIND_ORDER.indexOf(e.kind)}})
      .filter(x=>x.r<6||terms.every(t=>norm(x.e.name+' '+x.e.id+' '+x.e.kind+' '+x.e.detail).includes(t)))
      .sort((a,b)=>a.r-b.r||a.k-b.k||a.n.length-b.n.length||a.n.localeCompare(b.n)).map(x=>x.e);
  }
  function installGlobalSearch(){
    if(!q)return;
    q.placeholder='Search guides, quests, monsters, items, places…';q.setAttribute('aria-label','Search across the atlas');q.setAttribute('aria-controls','atlasGlobalResults');q.setAttribute('aria-expanded','false');
    const panel=document.createElement('div');panel.id='atlasGlobalResults';panel.hidden=true;panel.setAttribute('aria-label','Search results');
    panel.style.cssText='position:fixed;z-index:10000;max-height:60vh;overflow:auto;background:var(--panel);color:var(--ink);border:1px solid var(--accent-soft);border-radius:10px;padding:10px;box-shadow:0 10px 35px #0009;box-sizing:border-box';document.body.append(panel);
    let results=[],timer;
    function close(){clearTimeout(timer);panel.hidden=true;q.setAttribute('aria-expanded','false')}
    function position(){const r=q.getBoundingClientRect();panel.style.left=Math.max(8,Math.min(r.left,innerWidth-340))+'px';panel.style.top=(r.bottom+6)+'px';panel.style.width=Math.min(Math.max(r.width,340),innerWidth-16)+'px';}
    function openResult(entry){
      close();q.value='';if(onlyObserved)onlyObserved.checked=false;
      if(entry.lite){goRoute(entry.href);return}
      if(entry.kind==='Place'||entry.kind==='Section'){goRoute(entry.href);return}
      if(entry.page){openPage(entry.page,entry.id);return}
      // monsters, items and resources have pages of their own; zones open their layout
      const kind={monsters:'monster',items:'item',resources:'resource'}[entry.tab];
      if(kind){openPage(kind,entry.id);return}
      if(entry.tab==='zones'){setRoute('#/zone/'+entry.id);openTabKey('zones');setTimeout(()=>openZoneOverlay(Number(entry.id)),30);return}
      const button=[...document.querySelectorAll('.tab')].find(b=>b.dataset.tab===entry.tab);if(!button)return;button.click();
      setTimeout(()=>{augmentCurrentTab();const card=[...content.querySelectorAll('.card')].find(c=>String(c.dataset[entry.attr])===String(entry.id));if(card){card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({behavior:'smooth',block:'center'});card.style.outline='2px solid #e6bf69';setTimeout(()=>card.style.outline='',2500)}if(entry.tab==='zones')openZoneOverlay(Number(entry.id));},30);
    }
    function update(){
      if(!q.value.trim()){close();return;}
      results=globalSearchMatches(globalSearchEntries(),q.value);position();panel.hidden=false;q.setAttribute('aria-expanded','true');
      panel.innerHTML='<div class="muted" role="status">'+results.length+' matches across the atlas'+(results.length>40?' · showing first 40; keep typing to narrow':'')+'</div>'+results.slice(0,40).map((e,i)=>'<a href="'+esc(e.href)+'" data-result="'+i+'" style="display:block;width:100%;box-sizing:border-box;text-align:left;text-decoration:none;background:var(--panel2);color:inherit;border:1px solid var(--edge);border-radius:7px;padding:10px;margin-top:7px;cursor:pointer">'+(e.image?'<img src="'+esc(e.image())+'" alt="" style="width:42px;height:42px;object-fit:contain;float:left;margin-right:10px">':'')+'<b>'+esc(e.name)+'</b><div class="muted">'+esc(e.kind)+'</div><div style="clear:both;font-size:12px;padding-top:4px">'+esc(e.detail)+'</div></a>').join('');
    }
    q.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(update,100)});q.addEventListener('focus',update);
    q.addEventListener('keydown',e=>{if(e.key==='Escape'){close();return}if(!panel.hidden&&e.key==='Enter'&&results.length){e.preventDefault();openResult(results[0])}if(!panel.hidden&&e.key==='ArrowDown'){e.preventDefault();panel.querySelector('a[data-result]')?.focus()}});
    panel.addEventListener('click',e=>{const b=e.target.closest('[data-result]');if(!b)return;if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();openResult(results[Number(b.dataset.result)])});
    panel.addEventListener('keydown',e=>{const buttons=[...panel.querySelectorAll('a[data-result]')],i=buttons.indexOf(document.activeElement);if(e.key==='Escape'){close();q.focus();close()}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[Math.max(0,Math.min(buttons.length-1,i+(e.key==='ArrowDown'?1:-1)))]?.focus()}});
    document.addEventListener('pointerdown',e=>{if(e.target!==q&&!panel.contains(e.target))close()});window.addEventListener('resize',position);
  }

  // Switches to a tab and scrolls to / highlights the card whose data-<attr> equals id. The search
  // box and the "only observed" filter are cleared first so they can't hide the target. The tab
  // click schedules its own re-render, so the lookup waits a beat (and retries) rather than
  // grabbing a card that is about to be replaced.
  const goToItemCard=id=>openPage('item',id);
  const goToMonsterCard=(typeId,ctx)=>tab==='map'?goToCard('monsters','t',typeId,ctx):openPage('monster',typeId);
  // ---- World map page ----------------------------------------------------------------------------------------
  // The map has a page of its own (tab 'map'). There, clicking a monster, resource or place opens this side panel
  // showing only that one thing, instead of jumping to its guide list. The Bestiary, Items and Gems pages have no
  // map any more; their cards offer "Show on map", which comes here. The panel is built only when something is
  // clicked (never on live updates), so it costs nothing while you play.
  let mapPanelEl=null,mapPanelNow=null;
  const onMapPage=()=>tab==='map';
  function mapPanel(){
    if(mapPanelEl)return mapPanelEl;
    const main=document.getElementById('main');if(!main)return null;
    mapPanelEl=document.createElement('aside');mapPanelEl.id='mapPanel';mapPanelEl.hidden=true;mapPanelEl.setAttribute('aria-label','Selected on the map');
    mapPanelEl.innerHTML='<button type="button" class="map-panel-close" aria-label="Close">×</button><div class="map-panel-body"></div>';
    main.append(mapPanelEl);
    const hint=document.createElement('p');hint.id='mapHint';hint.textContent='Click anything on the map to see what it is.';main.append(hint);
    mapPanelEl.querySelector('.map-panel-close').addEventListener('click',()=>closeMapPanel(true));
    mapPanelEl.addEventListener('keydown',e=>{if(e.key==='Escape')closeMapPanel(true)});
    mapPanelEl.addEventListener('click',e=>{
      const pick=e.target.closest('[data-panel-kind]');
      if(pick){e.preventDefault();openMapPanel(pick.dataset.panelKind,pick.dataset.panelId,{fit:true});return}
      const full=e.target.closest('[data-panel-open]');
      if(full){e.preventDefault();const [t,a,id]=full.dataset.panelOpen.split('|');closeMapPanel(false);goToCardInList(t,a,id);return}
      const itemLink=e.target.closest('.dropicon-link,.resource-yield-link');
      if(itemLink&&itemLink.dataset.item){e.preventDefault();openMapPanel('item',itemLink.dataset.item,{fit:true});return}
      const monsterRow=e.target.closest('.monsterlink');
      if(monsterRow&&monsterRow.dataset.monster){e.preventDefault();openMapPanel('monster',monsterRow.dataset.monster,{fit:true});return}
      const moreBtn=e.target.closest('.chip-row-more-btn');
      if(moreBtn){const extras=[...(moreBtn.closest('.chip-row')?.querySelectorAll('.chip-row-extra')||[])];const collapsed=extras.some(c=>c.hasAttribute('hidden'));extras.forEach(c=>c.toggleAttribute('hidden',!collapsed));moreBtn.textContent=collapsed?'Show less':'+'+extras.length+' more'}
    });
    return mapPanelEl;
  }
  // One card out of a whole list's HTML (resourcesHtml / itemsHtml), so the panel shows exactly what the guide
  // shows for it. Built only on a click.
  function cardFromList(html,selector){
    const t=document.createElement('template');t.innerHTML=html;
    const card=t.content.querySelector(selector);
    if(!card)return '';
    card.querySelectorAll('.show-on-map').forEach(b=>b.remove());
    return card.outerHTML;
  }
  const panelLink=(kind,id,label,sub)=>`<button type="button" class="map-panel-pick" data-panel-kind="${esc(kind)}" data-panel-id="${esc(id)}">${esc(label)}${sub?` <span class="muted">${esc(sub)}</span>`:''}</button>`;
  const panelOpen=(tabName,attr,id)=>`<a class="map-panel-open" href="${pageHref({monsters:'monster',items:'item',resources:'resource'}[tabName],id)}">Open the full page →</a>`;
  // Every known position of a monster type: the built-in spawn list plus what has been seen (see drawMap).
  function monsterPoints(type){
    const pts=[...(state.monsterPointsByType?.get(type)||[])];
    for(const m of D.markers||[])if(m.typeId===type&&num(m.x)!==null&&num(m.y)!==null)pts.push({x:m.x,y:m.y});
    return pts;
  }
  function monsterTypesNear(p,tiles){
    const best=new Map(),add=(t,x,y)=>{const d=Math.hypot(x-p.x,y-p.y);if(d<=tiles&&(!best.has(t)||d<best.get(t)))best.set(t,d)};
    for(const [t,list] of state.monsterPointsByType||[])for(const q of list)add(t,q.x,q.y);
    for(const m of D.markers||[])if(num(m.x)!==null)add(m.typeId,m.x,m.y);
    return [...best].sort((a,b)=>a[1]-b[1]).map(x=>x[0]);
  }
  let panelSelLayer=null,panelSelRenderer=null;
  function circlePoints(pts,fit){
    if(!panelSelLayer){
      // their own pane above the markers
      if(!map.getPane('bxcSel')){const p=map.createPane('bxcSel');p.style.zIndex=650;p.style.pointerEvents='none'}
      panelSelRenderer=L.svg({pane:'bxcSel'});panelSelLayer=L.layerGroup().addTo(map);
    }
    panelSelLayer.clearLayers();

    // one circle per 10-tile square at most, so a monster seen thousands of times stays a light layer
    const seen=new Set();pts=pts.filter(q=>{const k=Math.round(q.x/10)+'|'+Math.round(q.y/10);if(seen.has(k))return false;seen.add(k);return true});
    for(const q of pts){L.circleMarker(latlng(q,true),{radius:10,weight:2.5,color:'#ffe08a',fill:false,interactive:false,pane:'bxcSel',renderer:panelSelRenderer}).addTo(panelSelLayer);L.circleMarker(latlng(q,true),{radius:3,weight:0,fillColor:'#ffe08a',fillOpacity:1,interactive:false,pane:'bxcSel',renderer:panelSelRenderer}).addTo(panelSelLayer)}
    if(fit&&pts.length)map.fitBounds(L.latLngBounds(pts.map(q=>latlng(q,true))).pad(.35),{maxZoom:-1});
  }
  // resources whose map markers sit within `tiles` of a world point
  function markersNear(markersByType,pt,tiles){
    const c=latlng(pt,true),r=tiles*(T.scale||5),out=[];
    for(const [type,list] of markersByType||[]){
      let best=Infinity;for(const m of list||[]){const ll=m.getLatLng?.();if(!ll)continue;const d=Math.hypot(ll.lat-c.lat,ll.lng-c.lng);if(d<best)best=d}
      if(best<=r)out.push({type,d:best});
    }
    return out.sort((a,b)=>a.d-b.d).map(x=>x.type);
  }
  function monsterLevelOf(type){const m=(D.catalog||[]).find(x=>x.typeId===type);return m?m.baseLevel:null}
  function panelHtml(kind,id,ctx){
    if(kind==='monster'){
      const m=(D.catalog||[]).find(x=>x.typeId===id);
      const others=(ctx.others||[]).filter(t=>t!==id);
      return `<p class="map-panel-kind">Monster</p>`+
        (m&&typeof monsterCardHtml==='function'?monsterCardHtml(m,{noMapButton:true}):`<div class="card" data-t="${esc(id)}"><div class="name">${esc(monsterNameFor(id))}</div></div>`)+
        (typeof monsterDropsHtml==='function'?monsterDropsHtml(id):'')+
        (others.length?`<h4 class="map-panel-h">Also in this area</h4><div class="map-panel-picks">${others.slice(0,8).map(t=>panelLink('monster',t,monsterNameFor(t),monsterLevelOf(t)!=null?'Lv '+monsterLevelOf(t):'')).join('')}</div>`:'')+
        panelOpen('monsters','t',id,'Open in the Bestiary');
    }
    if(kind==='resource'){
      const card=cardFromList(resourcesHtml(''),`.card[data-r="${CSS.escape(id)}"]`);
      return `<p class="map-panel-kind">Resource</p>`+(card||`<div class="card"><div class="name">${esc(prettyId(id))}</div></div>`)+panelOpen('resources','r',id,'Open in Resources');
    }
    if(kind==='item'){
      const card=cardFromList(itemsHtml(''),`.card[data-item="${CSS.escape(id)}"]`);
      return `<p class="map-panel-kind">Item · where it comes from (circled)</p>`+(card||`<div class="card"><div class="name">${esc(prettyId(id))}</div></div>`)+panelOpen('items','item',id,'Open in Items');
    }
    if(kind==='npc'){
      const e=namedNpcs().get(id);if(!e)return '<p class="muted">Not met yet.</p>';
      const lv=[...e.levels.keys()].sort((a,b)=>a-b);
      return `<p class="map-panel-kind">Named ${esc(prettyId(e.typeId))}</p><div class="card"><div class="name">${esc(e.name)}</div><div class="s muted">${lv.length?'Level '+(lv.length>1?lv[0]+'–'+lv[lv.length-1]:lv[0])+' · ':''}seen ${fmt(e.seen)}×</div></div><a class="map-panel-open" href="${pageHref('npc',id)}">Open the full page →</a>${!EDIT?'':`<div class="npc-edit"><button type="button" class="npc-move" data-name="${esc(e.name)}">Move on the map</button>${npcSpotOf(e.name)?`<button type="button" class="npc-reset" data-name="${esc(e.name)}">Use the recorded spot</button>`:''}</div>`}`;
    }
    if(kind==='zone'){
      const [z,ai]=zonePlaceId(id),nm=placeName(z,ai),pt=placeEntrancePoint(z,ai);
      return `<p class="map-panel-kind">Cave, mine or building</p><div class="card"><div class="name">${esc(nm)}</div><div class="s muted">${pt?'The way in is circled on the map.':'Its entrance has not been recorded yet.'}</div>${!ai&&typeof zoneQuestNote==='function'?zoneQuestNote(z):''}<button type="button" class="open-zone" data-zone="${z}" data-area="${ai}">Open the layout</button></div>`;
    }
    if(kind==='spot'){   // one spot outdoors, "x|y|label" (a quest step's place)
      const [x,y,...l]=id.split('|'),p={x:+x,y:+y};if(!isFinite(p.x)||!isFinite(p.y))return '<p class="muted">Unknown spot.</p>';
      return `<p class="map-panel-kind">Spot</p>${questRegionNote([p],'It is')}<div class="card"><div class="name">${esc(l.join('|')||'This spot')}</div><div class="s muted">World ${Math.round(p.x)}, ${Math.round(p.y)} · circled on the map</div></div>`;
    }
    if(kind==='place'){
      const p=(D.pois||[]).find(x=>x.name===id);if(!p)return '<p class="muted">Unknown place.</p>';
      const mons=monsterTypesNear(p,70).filter(t=>!ROAMING_NPC_TYPES.has(t));
      const res=markersNear(state.resourceMarkersByType,p,70);
      const inside=placesNamed(p.name);
      return `<p class="map-panel-kind">Place · ${esc(prettyId(p.category||''))}</p>${questRegionNote([{x:+p.x,y:+p.y}],'It is')}<div class="card"><div class="name">${esc(p.name)}</div><div class="s muted">World ${esc(p.x)}, ${esc(p.y)}</div>${inside.map((q,n)=>`<button type="button" class="open-zone" data-zone="${q.z}" data-area="${q.i}">${inside.length>1?'Room '+(n+1)+' layout':'Open the layout'}</button>`).join(' ')}</div>`+
        (mons.length?`<h4 class="map-panel-h">Monsters around it</h4><div class="map-panel-picks">${mons.slice(0,10).map(t=>panelLink('monster',t,monsterNameFor(t),monsterLevelOf(t)!=null?'Lv '+monsterLevelOf(t):'')).join('')}</div>`:'<p class="muted">No monsters seen right around it yet.</p>')+
        (res.length?`<h4 class="map-panel-h">Resources around it</h4><div class="map-panel-picks">${res.slice(0,8).map(k=>panelLink('resource',k,resourceDisplayName(state.resourceCatalog?.get(k)||{key:k,name:k}))).join('')}</div>`:'');
    }
    return '';
  }
  // Circle the thing on the map. fit moves the map to it (from "Show on map" and panel links); a click on the map
  // itself leaves the map where it is.
  // Picking something shows its own icons on the map, even with that layer switched off: a monster's areas (one
  // icon per area, with how often it was seen there), every spot of a resource, or every source of an item. With fit
  // (from a page, a link or the panel) the map goes to the best one: the busiest area of a monster, the densest patch
  // of a resource, and for an item the resource it is gathered from, else the monster most likely to drop it.
  // Returns {text} describing that best spot, for the top of the panel.
  let panelIconLayer=null;
  function selectionLayers(){
    if(!map.getPane('bxcSelIcons')){const p=map.createPane('bxcSelIcons');p.style.zIndex=660}
    if(!panelIconLayer)panelIconLayer=L.layerGroup().addTo(map);
    circlePoints([],false);   // makes the ring layer and clears it
    panelIconLayer.clearLayers();
  }
  const clusterCenter=c=>({x:c.reduce((a,p)=>a+p.x,0)/c.length,y:c.reduce((a,p)=>a+p.y,0)/c.length});
  function monsterAreas(type){return clusterPoints(monsterPoints(type),45).map(c=>({...clusterCenter(c),n:c.length,pts:c})).sort((a,b)=>b.n-a.n)}
  function resourceSpots(key){return (state.resourceMarkersByType.get(key)||[]).map(m=>({m,...unprojectLatLng(m.getLatLng())}))}
  function drawMonsterAreas(type,areas){
    const name=monsterNameFor(type),fam=familyOf(type),rings=[];
    for(const a of areas){
      const icon=monsterAreaIcon(type,name,fam,false,a.n);
      const mk=icon?L.marker(latlng(a,true),{icon,pane:'bxcSelIcons',interactive:false}):L.circleMarker(latlng(a,true),{radius:7,weight:2,color:'#0d1a10',fillColor:familyColor(fam),fillOpacity:1,pane:'bxcSel',renderer:panelSelRenderer,interactive:false});
      mk.addTo(panelIconLayer);rings.push(a);
    }
    return rings;
  }
  function drawResourceSpots(spots){
    for(const sp of spots){
      const src=sp.m,o=src.options||{};
      const mk=o.icon?L.marker(src.getLatLng(),{icon:o.icon,pane:'bxcSelIcons',interactive:false}):L.circleMarker(src.getLatLng(),{radius:6,weight:1.5,color:o.color||'#0b1410',fillColor:o.fillColor||'#7fd1ae',fillOpacity:1,pane:'bxcSel',renderer:panelSelRenderer,interactive:false});
      mk.addTo(panelIconLayer);
    }
    return spots;
  }
  function flyToCluster(pts){
    if(!pts.length)return;
    // the busiest 40-tile square inside it (a big area can span half the map), so you land where it actually is
    const cells=new Map();for(const q of pts){const k=Math.floor(q.x/40)+','+Math.floor(q.y/40);(cells.get(k)||cells.set(k,[]).get(k)).push(q)}
    const core=[...cells.values()].sort((x,y)=>y.length-x.length)[0]||pts;
    const b=L.latLngBounds(core.map(q=>latlng(q,true)));
    // A fly (flyToBounds) was cancelled on its first frame by the map's own keep-inside-the-edges pan (maxBounds), so
    // "Show on map" stayed where it was. A plain zoom-and-move is not; and if anything still stops it, it lands there
    // without animating. A hidden window cannot animate at all, so it always jumps.
    const jump=()=>map.fitBounds(b.pad(.6),{maxZoom:0,animate:false});
    if(document.hidden){jump();return}
    const want=Math.min(0,map.getBoundsZoom(b.pad(.6)));
    map.fitBounds(b.pad(.6),{maxZoom:0,animate:true});
    // not there, or not zoomed in (a zoom animation that never finished): jump
    setTimeout(()=>{if(!map.getBounds().contains(b.getCenter())||Math.abs(map.getZoom()-want)>.25)jump()},650);
  }
  const nearText=pt=>{const a=placesFor([pt])[0];return a&&a.poi?'near '+a.poi.name:'around '+Math.round(pt.x)+', '+Math.round(pt.y)};
  // Caves, mines, dungeons and buildings that hold something, by their outdoor entrance: most ore is only found
  // inside. kind 'resource' matches a resource key, 'item' what a resource gives, 'monster' a monster type.
  // Rooms of one dungeon share an entrance and are added together; z is the room with the most, for its layout.
  function cavesFor(kind,id){
    const byEntrance=new Map();
    for(const [z,c] of state.zoneContents||[]){
      let n=0;
      if(kind==='monster')n=c.monsters.get(id)?.count||0;
      else for(const [key,info] of c.objects){const item=String(key).split('::')[1];if(kind==='resource'?key===id:(item===id||info.yieldItem===id))n+=info.count||0}
      if(!n)continue;
      const poi=dungeonPoiForZone(z),ent=entranceForZone(z),pt=poi?{x:poi.x,y:poi.y}:ent?{x:ent.x,y:ent.y}:null;
      if(!pt)continue;
      const k=Math.round(pt.x)+','+Math.round(pt.y);
      let e=byEntrance.get(k);if(!e)byEntrance.set(k,e={name:poi?.name||state.zones.get(z)?.name||('Zone '+z),count:0,pt,rooms:[]});
      e.count+=n;e.rooms.push([z,n]);
    }
    const out=[...byEntrance.values()];
    for(const e of out)e.z=e.rooms.sort((a,b)=>b[1]-a[1])[0][0];
    // most first; on a tie, the mine named after the ore (Binxonia Iron Mine for iron ore)
    const word=String(id).split('::')[0].split('-')[0].toLowerCase(),named=c=>c.name.toLowerCase().includes(word)?1:0;
    return out.sort((a,b)=>b.count-a.count||named(b)-named(a));
  }
  globalThis.bxcCavesFor=(kind,id)=>cavesFor(kind,id);   // for the guides ("Most in")
  function drawCaves(caves,unit){
    for(const c of caves){
      const icon=L.divIcon({className:'bxc-cave-wrap',html:`<div class="bxc-cave" title="${esc(c.name)}: ${fmt(c.count)} ${unit} inside. Click for the layout.">${esc(c.name)} <b>${fmt(c.count)}</b></div>`,iconSize:null,iconAnchor:[0,10]});
      L.marker(latlng(c.pt,true),{icon,pane:'bxcSelIcons'}).on('click',()=>openZoneOverlay(c.z)).addTo(panelIconLayer);
    }
    return caves.map(c=>c.pt);
  }
  function selectOnMap(kind,id,fit,quality,level){
    clearMonsterSelection();if(typeof selectedResourceLayer!=='undefined'&&selectedResourceLayer)selectedResourceLayer.clearLayers();
    selectionLayers();
    const focus=on=>map.getContainer().classList.toggle('bxc-focus',on);
    const goCave=c=>{if(fit)map.setView(latlng(c.pt,true),Math.max(map.getZoom(),-.5))};
    const caveText=(c,unit)=>({text:`Most inside ${c.name} · ${fmt(c.count)} ${unit}`,zone:c.z,zoneName:c.name});
    if(kind==='monster'){
      const lvPts=level!=null?(monsterLevelsSeen(id).find(l=>l.level===level)?.pts||[]):null;
      const areas=lvPts?clusterPoints(lvPts,45).map(c=>({...clusterCenter(c),n:c.length,pts:c})).sort((a,b)=>b.n-a.n):monsterAreas(id),caves=lvPts?[]:cavesFor('monster',id);
      if(!areas.length&&!caves.length){focus(false);return null}
      circlePoints([...drawMonsterAreas(id,areas),...drawCaves(caves,'sightings')],false);focus(true);
      // out in the open first; a monster only ever seen indoors is sent to its dungeon
      if(!areas.length){goCave(caves[0]);return caveText(caves[0],'sightings')}
      if(fit)flyToCluster(areas[0].pts);
      return {text:`${level!=null?'Level '+level+' · ':''}Most seen ${nearText(areas[0])} · ${fmt(areas[0].n)} spot${areas[0].n===1?'':'s'}${areas.length>1?` · ${areas.length} areas in all`:''}${caves.length?` · also inside ${caves.length} dungeon${caves.length===1?'':'s'}`:''}`,zone:caves[0]?.z,zoneName:caves[0]?.name};
    }
    if(kind==='resource'){
      const spots=resourceSpots(id),caves=cavesFor('resource',id);
      if(!spots.length&&!caves.length){focus(false);return null}
      drawResourceSpots(spots);circlePoints([...spots,...drawCaves(caves,'inside')],false);focus(true);
      const open=clusterPoints(spots,40).sort((a,b)=>b.length-a.length)[0]||[];
      // wherever there are the most: a cave or mine usually beats the few out in the open
      if(caves.length&&caves[0].count>=open.length){goCave(caves[0]);return caveText(caves[0],'of them')}
      if(fit)flyToCluster(open);
      return {text:`Most of them ${nearText(clusterCenter(open))} · ${fmt(open.length)} of ${fmt(spots.length)} spots`};
    }
    if(kind==='item'){
      const r=state.items?.get(id);
      // one quality picked (from the item page): only the monsters that dropped it at that quality; gathered things have none
      const qTypes=quality?new Set(qualitySources(id).mons.filter(e=>e.q[quality]).map(e=>e.type)):null;
      const res=quality?[]:[...(state.resourceCatalog?.values()||[])].filter(x=>x.yieldItem===id&&(state.resourceMarkersByType.get(x.key)||[]).length);
      const caves=quality?[]:cavesFor('item',id);
      // monsters by how much of their recorded loot is this item (elite and normal kills together)
      const mons=new Map();
      for(const m of r?r.monsterSources.values():[]){const e=mons.get(m.typeId)||{type:m.typeId,events:0,total:0};e.events+=m.events||0;e.total+=m.sourceEvents||0;mons.set(m.typeId,e)}
      const ranked=[...mons.values()].filter(e=>!qTypes||qTypes.has(e.type)).map(e=>({...e,rate:e.total?e.events/e.total:0,areas:monsterAreas(e.type)})).filter(e=>e.areas.length).sort((a,b)=>b.rate-a.rate);
      const ringPts=[];
      for(const k of res)ringPts.push(...drawResourceSpots(resourceSpots(k.key)));
      ringPts.push(...drawCaves(caves,'inside'));
      for(const e of ranked)ringPts.push(...drawMonsterAreas(e.type,e.areas));
      if(!ringPts.length){focus(false);return null}
      circlePoints(ringPts,false);focus(true);
      if(res.length||caves.length){
        const top=res.map(x=>({x,spots:resourceSpots(x.key)})).sort((a,b)=>b.spots.length-a.spots.length)[0];
        const open=top?clusterPoints(top.spots,40).sort((a,b)=>b.length-a.length)[0]||[]:[];
        if(caves.length&&caves[0].count>=open.length){goCave(caves[0]);return {...caveText(caves[0],'to gather'),text:`Best: gather it inside ${caves[0].name} · ${fmt(caves[0].count)} spots`}}
        if(fit)flyToCluster(open);
        return {text:`Best: gather it from ${resourceDisplayName(top.x)} ${nearText(clusterCenter(open))}`};
      }
      const e=ranked[0];if(fit)flyToCluster(e.areas[0].pts);
      return {text:`${quality?prettyId(quality)+' drops · ':''}Best: ${monsterNameFor(e.type)}${e.rate?` (${(e.rate*100).toFixed(e.rate<.1?1:0)}% of its recorded loot)`:''} ${nearText(e.areas[0])}`};
    }
    if(kind==='npc'){
      const e=namedNpcs().get(id);if(!e){focus(false);return null}
      const caves=npcPlaces(e).filter(p=>p.pt).map(p=>({name:p.name,count:p.n,pt:p.pt,z:p.z}));
      if(!e.pts.length&&!caves.length){focus(false);return null}
      circlePoints([...e.pts,...drawCaves(caves,'sightings')],false);focus(true);
      if(caves.length&&caves[0].count>=e.pts.length){goCave(caves[0]);return caveText(caves[0],'sightings')}
      if(fit)flyToCluster(e.pts);
      return {text:`Seen ${nearText(e.pts[0])}`};
    }
    if(kind==='zone'){
      const [z,ai]=zonePlaceId(id),pt=placeEntrancePoint(z,ai);if(!pt){focus(false);return null}
      circlePoints([pt],false);focus(true);if(fit)flyToCluster([pt]);   // the move that the map's edge rule cannot cancel
      return {text:'Entrance to '+placeName(z,ai)+' '+nearText(pt)};
    }
    if(kind==='spot'){
      const [x,y]=id.split('|').map(Number);if(!isFinite(x)||!isFinite(y))return null;
      circlePoints([{x:x-.5,y:y-.5}],false);focus(true);if(fit)map.setView(latlng({x,y},false),Math.max(map.getZoom(),0));
      return null;
    }
    if(kind==='place'){
      const p=(D.pois||[]).find(x=>x.name===id);
      if(p){circlePoints([{x:p.x-.5,y:p.y-.5}],false);focus(true);if(fit)map.setView(latlng(p,false),Math.max(map.getZoom(),0))}
      return null;
    }
    return null;
  }
  function openMapPanel(kind,id,ctx={}){
    const el=mapPanel();if(!el||!id)return;
    // in the app, catch up on data held back while the map page was open (the panel shows drops and sources)
    if(liveStale)deriveLive();
    mapPanelNow={kind,id};
    if(state.openZone!=null&&typeof closeZoneOverlay==='function')closeZoneOverlay();   // a new pick replaces an open cave layout
    if(!ctx.fromRoute)setRoute('#/map/'+kind+'/'+encodeURIComponent(id)+(ctx.quality?'?q='+encodeURIComponent(ctx.quality):ctx.level!=null&&ctx.level!==''?'?lv='+ctx.level:''));
    const body=el.querySelector('.map-panel-body');
    if(PUBLIC_MODE&&!isFull()&&PANEL_DOC_KINDS.has(kind)){
      body.innerHTML='<p class="muted">Loading…</p>';const want=mapPanelNow;
      loadPanelDoc(kind,id).then(d=>{if(mapPanelNow===want&&!isFull())body.innerHTML=d?d.html:'<p class="muted">Nothing recorded here yet.</p>'});
      if(kind==='item'){el.hidden=false;document.getElementById('main').classList.add('map-panel-open');globalThis.bxcEnsureFull?.().then(()=>{if(mapPanelNow===want)openMapPanel(kind,id,{...ctx,fromRoute:true})});return}
    }else body.innerHTML=panelHtml(kind,String(id),ctx);
    el.hidden=false;el.scrollTop=0;document.getElementById('main').classList.add('map-panel-open');
    const best=selectOnMap(kind,String(id),!!ctx.fit,ctx.quality||null,ctx.level!=null&&ctx.level!==''?Number(ctx.level):null);
    if(best&&best.text)el.querySelector('.map-panel-body').insertAdjacentHTML('afterbegin',`<p class="map-panel-best">${esc(best.text)}${best.zone!=null?`<button type="button" class="open-zone" data-zone="${esc(best.zone)}">Open the ${esc(best.zoneName||'cave')} layout</button>`:''}</p>`);
  }
  const PANEL_DOC_KINDS=new Set(['monster','resource','item','npc','zone','place']);
  const panelDocCache=new Map();
  function loadPanelDoc(kind,id){const u='data/panels/'+kind+'/'+pageFileId(id)+'.json';if(!panelDocCache.has(u))panelDocCache.set(u,fetch(u).then(r=>r.ok?r.json():null).catch(()=>null));return panelDocCache.get(u)}
  function closeMapPanel(clearSelection){
    if(!mapPanelEl)return;
    if(clearSelection&&tab==='map')setRoute('#/map');
    mapPanelEl.hidden=true;mapPanelNow=null;document.getElementById('main').classList.remove('map-panel-open');
    if(clearSelection){clearMonsterSelection();if(typeof selectedResourceLayer!=='undefined'&&selectedResourceLayer)selectedResourceLayer.clearLayers()}
    if(panelSelLayer)panelSelLayer.clearLayers();   // the circles belong to the map page only
    if(panelIconLayer)panelIconLayer.clearLayers();
    if(typeof map!=='undefined')map.getContainer().classList.remove('bxc-focus');
  }
  // "Show on map" on a Bestiary or Items card: switch to the map page, then circle it and open its panel.
  function showOnMap(kind,id,quality,level){
    const btn=document.querySelector('.tab[data-tab="map"]');if(!btn)return;
    if(!btn.classList.contains('on')){pageNow=null;clickTab(btn)}
    setTimeout(()=>{map.invalidateSize({pan:false});openMapPanel(kind,id,{fit:true,quality,level})},60);
  }
  document.addEventListener('click',e=>{const z=e.target.closest('.open-zone');if(!z)return;e.preventDefault();{if(!state.zoneArea)state.zoneArea=new Map();state.zoneArea.set(Number(z.dataset.zone),+z.dataset.area||0);lastRenderedZoneOverlayZ=null}openZoneOverlay(Number(z.dataset.zone))});
  document.addEventListener('click',e=>{const b=e.target.closest('.show-on-map');if(!b)return;e.preventDefault();e.stopPropagation();showOnMap(b.dataset.mapKind,b.dataset.mapId,b.dataset.mapQuality||null,b.dataset.mapLevel||null)},true);
  // a Zones & caves card: the card goes to the place on the map, its buttons do their own thing
  document.addEventListener('click',e=>{const c=e.target.closest('[data-card-map]');if(!c||e.target.closest('button,a'))return;e.preventDefault();showOnMap(c.dataset.cardMap,c.dataset.cardMapId)});
  // Leaving the map page hides the panel (the selection stays for the pages that still show the map).
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.tab!=='map')closeMapPanel(false)}));
  // Official places: a click opens the panel on the map page (they used to open a small popup, kept elsewhere).
  if(typeof poiMarkersByName!=='undefined')for(const [name,cm] of poiMarkersByName){
    const pop=cm.getPopup?.(),content=pop?pop.getContent():null;cm.unbindPopup();
    // a dungeon with rooms recorded (Imp Tree) opens its dungeon map as well
    cm.on('click',ev=>{if(armedPassthrough(ev))return;const dg=[...(state.dungeons?.values()||[])].find(g=>String(g.name).toLowerCase()===String(name).toLowerCase());if(dg)openDungeonOverlay(dg.key);if(onMapPage())openMapPanel('place',name,{});else if(content)L.popup().setLatLng(cm.getLatLng()).setContent(content).openOn(map)});
  }
  mapPanel();
  // ---- Pages and links ------------------------------------------------------------------------------------------
  // Every monster, item and resource has a page of its own: #/monster/<id>, #/item/<id>, #/resource/<key>. Zones open
  // at #/zone/<z>, every section at #/<section> (e.g. #/monsters), the map at #/map and #/map/<kind>/<id>. The
  // browser's Back and Forward step through them and any of them can be shared as a link. A page is drawn only when
  // it is opened (or "New data - refresh" is clicked), never behind you on a live update. Older links from the
  // in-game target card (#monster=<id>&t=...) still open the monster.
  const PAGE_TAB={monster:'monsters',npc:'monsters',item:'items',resource:'resources',guide:'guides'};
  const PAGE_SECTION={monster:['monsters','Bestiary'],npc:['monsters','Bestiary'],item:['items','Items'],resource:['resources','Resources'],guide:['guides','Guides']};
  var pageNow=null,lastRoute=routeNow(),routing=false;   // var: read by augmentCurrentTab, which can run first
  const tabKey=b=>b.dataset.calc?'calc-'+b.dataset.calc:b.dataset.ggroup?'guides-'+b.dataset.ggroup:b.dataset.gpage?'guide-'+b.dataset.gpage:b.dataset.tab;
  const tabButton=key=>[...document.querySelectorAll('.tab')].find(b=>tabKey(b)===key);
  const pageHref=(kind,id)=>'#/'+kind+'/'+encodeURIComponent(id);
  // How many Atlas steps lie behind this one (kept in each history entry), so Back knows whether there is an Atlas
  // page to go back to or whether it should show the home page instead of leaving the Atlas.
  let navDepth=0;
  try{const s=history.state;if(s&&Number.isFinite(s.bxcDepth))navDepth=s.bxcDepth;else history.replaceState({...(s||{}),bxcDepth:0},'')}catch(_){}
  function syncNavDepth(){try{const s=history.state;if(s&&Number.isFinite(s.bxcDepth))navDepth=s.bxcDepth;else{navDepth++;history.replaceState({...(s||{}),bxcDepth:navDepth},'')}}catch(_){}
    document.dispatchEvent(new Event('bxc-nav'))}
  globalThis.bxcNavDepth=()=>navDepth;
  let restoringRoute=false;   // while a Back/Forward step is being shown, a page it settles on replaces that step
  function setRoute(h){const now=routeNow();if(h===lastRoute&&now===h)return;lastRoute=h;if(now!==h&&restoringRoute){try{history.replaceState({bxcDepth:navDepth},'',routeUrl(h))}catch(_){}return}if(now!==h){try{history.pushState({bxcDepth:navDepth+1},'',routeUrl(h));navDepth++;document.dispatchEvent(new Event('bxc-nav'))}catch{if(!PATH_MODE)location.hash=h}}}
  // going to a page from code (a clicked row, a map marker): a new history step, then the page
  function goRoute(h){
    if(!PATH_MODE){location.hash=h;return}
    if(h!==routeNow()){try{history.pushState({bxcDepth:navDepth+1},'',routeUrl(h));navDepth++;document.dispatchEvent(new Event('bxc-nav'))}catch(_){location.href=routeUrl(h);return}}
    openFromHash();document.dispatchEvent(new Event('bxc-route'));
  }
  globalThis.bxcGo=goRoute;
  // on the website the browser tab names the page that is open (its heading, else the section)
  let titleT=0;
  function syncTitle(){if(!PUBLIC_MODE)return;clearTimeout(titleT);titleT=setTimeout(()=>{const h=document.querySelector('#content h1')||document.getElementById('sectionTitle'),t=(h&&h.textContent.trim())||(document.querySelector('.tab.on:not(.bxc-menu-btn)')?.textContent.trim()||'');document.title=(t&&t!=='Binxonia Atlas'?t+' - ':'')+'Binxonia Atlas'},120)}
  document.addEventListener('bxc-route',syncTitle);document.addEventListener('bxc-nav',syncTitle);
  function clickTab(b){routing=true;try{b.click()}finally{routing=false}}
  // a section clicked in the menu becomes a history step too
  document.addEventListener('click',e=>{const b=e.target.closest('.tab:not(.bxc-menu-btn)');if(!b||routing)return;   // not the menu buttons themselves
    if(b.dataset.gpage){e.stopPropagation();e.preventDefault();openPage('guide',b.dataset.gpage);return}   // a guide listed in a menu
    pageNow=null;setRoute('#/'+tabKey(b))},true);
  function openTabKey(key){const b=tabButton(key);if(!b)return false;pageNow=null;clickTab(b);return true}
  function openPage(kind,id,opts={}){
    const b=tabButton(PAGE_TAB[kind]);if(!b||!id)return;
    const same=pageNow&&pageNow.kind===kind&&pageNow.id===String(id),top=content.scrollTop;
    pageNow={kind,id:String(id),q:opts.q||null,lv:opts.lv!=null&&opts.lv!==''?Number(opts.lv):null};
    if(!opts.fromRoute)setRoute(pageHref(kind,id)+(opts.q?'?q='+encodeURIComponent(opts.q):pageNow.lv!=null?'?lv='+pageNow.lv:''));
    if(!b.classList.contains('on'))clickTab(b);else render();
    pageHeading();content.scrollTop=same?top:0;   // picking a quality keeps your place
  }
  function pageHeading(){
    if(!pageNow)return;
    const [key,label]=PAGE_SECTION[pageNow.kind],t=document.getElementById('sectionTrail'),h=document.getElementById('sectionTitle'),d=document.getElementById('sectionDescription');
    if(t)t.innerHTML=pageTrail(pageNow,key,label);
    if(h)h.textContent=pageTitle(pageNow.kind,pageNow.id);
    if(d)d.textContent='';
  }
  // the breadcrumb: Atlas / <section>; a quest's page goes Atlas / Guides / Quests / <its group>, the group linking to
  // its heading on the Quests page
  function pageTrail(p,key,label){
    const qg=p&&p.kind==='guide'&&/^quest-/.test(p.id)&&globalThis.bxcGuides?.questGroup?globalThis.bxcGuides.questGroup(p.id):null;
    if(qg)return `Atlas / <a href="#/guides">Guides</a> / <a href="#/guides-quests">Quests</a> / <a href="${qg.page?'#/guide/'+esc(qg.page):'#/guides-quests?g='+esc(qg.key)}">${esc(qg.title)}</a>`;
    // the quest group pages and All quests: under Quests too
    if(p&&p.kind==='guide'&&/^quests(-|$)/.test(p.id))return `Atlas / <a href="#/guides">Guides</a> / <a href="#/guides-quests">Quests</a>`;
    return `Atlas / <a href="#/${key}">${esc(label)}</a>`;
  }
  function pageTitle(kind,id){
    if(kind==='monster')return (D.catalog||[]).find(x=>x.typeId===id)?.name||monsterNameFor(id);
    if(kind==='resource'){const r=state.resourceCatalog?.get(id);return r?resourceDisplayName(r):prettyId(id)}
    if(kind==='guide')return globalThis.bxcGuides?.title(id)||prettyId(id);
    if(kind==='npc')return namedNpcs().get(id)?.name||prettyId(id);
    return prettyId(id);
  }
  // The page replaces its section's list while it is open (every other path to render() still works as before).
  if(typeof render==='function'){
    const baseRender=render;
    render=function(){if(pageNow&&tab===PAGE_TAB[pageNow.kind]){renderPage();return}return baseRender.apply(this,arguments)};
    // the search box and "Observed only" were bound to the first render() - send them through this one
    if(q)q.oninput=()=>render();if(onlyObserved)onlyObserved.onchange=()=>render();
  }
  // the drawn-ahead page for what is open (the publish draws every page: see bxcExportPages), or null
  const pageDocCache=new Map();
  function pageDocPath(p){const v=p.kind==='monster'&&p.lv!=null?'~lv'+p.lv:p.kind==='item'&&p.q?'~q'+pageFileId(p.q):'';return 'data/pages/'+p.kind+'/'+pageFileId(p.id)+v+'.json'}
  function loadPageDoc(p){const u=pageDocPath(p);if(!pageDocCache.has(u))pageDocCache.set(u,fetch(u).then(r=>r.ok?r.json():null).catch(()=>null));return pageDocCache.get(u)}
  const hasPageDoc=p=>PUBLIC_MODE&&(['monster','npc','item','resource'].includes(p.kind)||(p.kind==='guide'&&/^quest-/.test(p.id)));
  function renderPage(){
    if(!isFull()&&pageNow&&hasPageDoc(pageNow)){
      const want=pageNow;content.innerHTML='<p class="muted">Loading…</p>';
      loadPageDoc(want).then(doc=>{if(isFull()||pageNow!==want)return;   // the data came first, or another page was opened
        if(!doc){content.innerHTML='<p class="muted">Loading the Atlas data…</p>';return}
        content.innerHTML=doc.html;const h=document.getElementById('sectionTitle');if(h)h.textContent=doc.title;
        {const t=document.getElementById('sectionTrail'),[k,lb]=PAGE_SECTION[want.kind]||['guides','Guides'];if(t)t.innerHTML=pageTrail(want,k,lb)}document.dispatchEvent(new Event('bxc-route'))});
      return;
    }
    // a guide reads the same facts as the lists (gem finds, monster counts, outfits): on the website's lite start
    // it waits for their file (it is small) so it reads exactly as with the whole database
    if(PUBLIC_MODE&&!isFull()&&pageNow&&pageNow.kind==='guide'&&!listsIn){const want=pageNow;content.innerHTML='<p class="muted">Loading…</p>';ensureLists().then(()=>{if(pageNow===want)renderPage()});return}
    // in the app, fold in data that arrived since the last refresh first (links skip the Refresh button)
    if(liveStale)deriveLive();
    const {kind,id}=pageNow;
    if(kind==='item')setTimeout(autoMarket,0);
    content.innerHTML=(kind==='monster'?monsterPageHtml(id):kind==='npc'?npcPageHtml(id):kind==='item'?itemPageHtml(id):kind==='guide'?(globalThis.bxcGuides?.pageHtml(id)||''):resourcePageHtml(id));applyPageEdits(content,kind,id);pgShowBtn();
    pageHeading();
    if(kind==='guide'&&id==='gems'){globalThis.bxcGemWitchPlan?.();globalThis.bxcGemMineRefresh?.()}
    if(kind==='resource')showResourceSelection(id,true);   // the map is beside the Resources section
  }
  // "near <place>" groups for a set of world points: each point goes to the nearest official place within 250 tiles
  function placesFor(pts){
    const g=new Map();
    for(const p of pts){
      let best=null,bd=250;for(const poi of D.pois||[]){const d=Math.hypot(poi.x-p.x,poi.y-p.y);if(d<bd){bd=d;best=poi}}
      const k=best?best.name:'~'+Math.round(p.x/150)+','+Math.round(p.y/150);
      const e=g.get(k)||g.set(k,{poi:best,n:0,x:0,y:0}).get(k);e.n++;e.x+=p.x;e.y+=p.y;
    }
    return [...g.values()].map(e=>({...e,x:e.x/e.n,y:e.y/e.n})).sort((a,b)=>b.n-a.n);
  }
  const placeLine=a=>a.poi?`near <a href="#/map/place/${encodeURIComponent(a.poi.name)}">${esc(a.poi.name)}</a>`:`in the wilds around ${Math.round(a.x)}, ${Math.round(a.y)}`;
  const infoRow=(k,v)=>v===null||v===undefined||v===''?'':`<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const mapBtn=(kind,id,label)=>`<button type="button" class="show-on-map" data-map-kind="${esc(kind)}" data-map-id="${esc(id)}">${esc(label||'Show on map')}</button>`;
  // "Guides" line on a page: the guides for the skills or topics given (skill names or guide slugs), once each
  function guideLinks(keys){
    const G=globalThis.bxcGuides;if(!G)return '';
    const slugs=[...new Set(keys.filter(Boolean).map(k=>G.has(k)?k:G.forSkill(k)).filter(Boolean))];
    return slugs.length?`<p class="wp-guides"><b>Guides:</b> ${slugs.map(s=>G.link(s)).join(' · ')}</p>`:'';
  }
  // ---- Item quality (gear pages) ----------------------------------------------------------------------------
  // Crafted and dropped gear rolls a quality that scales its own stats. A gear page gets: a picker (All or one tier,
  // kept in the address as ?q=), a table of what each tier gives for this exact item - worked out with the game's own
  // formulas (copied from its rules file, checked against the official guide: a full iron plate set protects 15%,
  // titanium 54%) - and where each quality has actually come from (crafting odds, monster drops, your crafts).
  const Q_TIERS=typeof QUALITY_TIERS!=='undefined'?QUALITY_TIERS:['inferior','crude','shoddy','ordinary','good','excellent','superior','flawless'];
  const Q_MULT=typeof QUALITY_MULT!=='undefined'?QUALITY_MULT:{};
  const G_MATERIAL={basic:[0,'metal'],iron:[1,'metal'],silver:[2,'metal'],gold:[3,'metal'],thak:[3,'metal'],bloomguard:[3,'metal'],titanium:[4,'metal'],virikh:[4,'metal'],pine:[1,'wood'],oak:[2,'wood'],'black-walnut':[3,'wood'],shagbark:[4,'wood'],imp:[1,'knick'],snakeskin:[2,'knick'],ogrewax:[3,'knick'],dragonscale:[4,'knick'],deerhide:[1,'pelt'],bearhide:[2,'pelt'],werewolfpelt:[3,'pelt'],bloomweave:[3,'knick'],bloomleather:[3,'pelt'],dunehide:[3,'pelt'],wraithweave:[3,'knick'],dragonhide:[4,'pelt'],leather:[1,'leather']};
  const G_ARMOR={metal:[[0,0],[.9,.3],[1.7,.6],[2.72,1],[5.8,1.25]],knick:[[0,0],[.44,1],[.81,2],[1.25,4],[1.94,5]],pelt:[[0,0],[.52,.44],[.95,.95],[1.49,1.76],[2.58,2.46]],leather:[[0,0],[.35,.35],[0,0],[0,0],[0,0]]};
  const G_ARMOR_SPECIAL={thak:[3.2,1.05],dunehide:[1.67,1.87],wraithweave:[1.36,4.2]};
  const G_SLOT={feet:1,arms:1,head:1.5,legs:2,torso:3},G_SLOT_SUM=8.5;
  const G_SHIELD_METAL=[.5,1.95,3.9,6.6,10.5],G_SHIELD_SOFT=[.5,.8,1.1,1.4,1.7];
  const G_TIER_BONUS=Array.isArray(globalThis.BXC_GAME_DATA?.combat?.materialBonus)?globalThis.BXC_GAME_DATA.combat.materialBonus:[0,1/4.5,3/4.5,6/4.5,16/4.5],G_TOOL_BONUS=[0,0,.03,.07,.12];
  // weapon kinds: damage roll, x1.15 for melee (bows and crossbows x1)
  const G_WEAPON={sword:['Short sword',1,8,1.15],longsword:['Long sword',2,10,1.15],scimitar:['Scimitar',2,6,1.15],rapier:['Rapier',3,7,1.15],dagger:['Dagger',2,4,1.15],kryss:['Kryss',2,5,1.15],mace:['Mace',2,13,1.15],warmace:['War mace',3,16,1.15],spear:['Spear',1,12,1.15],battlespear:['Battle spear',2,16,1.15],bow:['Short bow',1,8,1],longbow:['Long bow',2,12,1],crossbow:['Crossbow',4,16,1]};
  const G_TOOLS=new Set(['pickaxe','axe','fishing-rod','shears','carving-tool','sewing-kit','leatherworking-awl','herbalist-sickle','scribing-quill','frying-pan','smithing-hammer']);
  const r1=v=>Math.round(v*10)/10;
  function gearOf(id){
    id=String(id||'');
    const mat=Object.keys(G_MATERIAL).filter(m=>id.startsWith(m+'-')).sort((a,b)=>b.length-a.length)[0];
    if(!mat){if(G_TOOLS.has(id)&&G_MATERIAL.iron)return {type:'tool',mat:'iron',tier:G_MATERIAL.iron[0],kind:'metal'};if(id==='wand')return {type:'staff',mat:'basic',tier:0,kind:'wood'};return null}
    const rest=id.slice(mat.length+1),[tier,kind]=G_MATERIAL[mat];
    if(G_SLOT[rest]&&(G_ARMOR[kind]||G_ARMOR_SPECIAL[mat]))return {type:'armor',mat,tier,kind,slot:rest};
    if(rest==='shield')return {type:'shield',mat,tier,kind};
    if(G_WEAPON[rest])return {type:'weapon',mat,tier,kind,w:G_WEAPON[rest],name:rest};
    if(rest==='staff')return {type:'staff',mat,tier,kind};
    if(G_TOOLS.has(rest)&&kind==='metal')return {type:'tool',mat,tier,kind};
    return null;
  }
  // what one quality tier gives for this item
  globalThis.bxcGearStats=(id,t)=>{const g=gearOf(id);return g?{...gearStats(g,t),type:g.type}:null};
  // A weapon enchant is three gems; its carats (whole numbers, up to 3 a metal tier) add, per carat, 2/9 of the weapon's
  // average roll: to every hit for Destruction, as elemental damage for Flame/Freezing/Storm/Corrosion, and Seeking
  // adds 2% chance to hit a carat (the game's own formula, as on the character sheet).
  const W_ENCH=[['','No enchant'],['destruction','of Destruction'],['burn','of the Flame'],['freeze','of Freezing'],['shock','of the Storm'],['corrode','of Corrosion'],['seeking','of Seeking']];
  const T_ENCH=[['','No enchant'],['artisan','Artisan']],T_PER_CARAT=.05;
  const S_ENCH=[['','No enchant'],['staff-fire','of Fire'],['staff-ice','of Frost'],['staff-shock','of Lightning'],['staff-acid','of Acid']],S_SCHOOL={'staff-fire':'fire','staff-ice':'ice','staff-shock':'shock','staff-acid':'acid'};
  const A_ENCH=[['','No enchant'],['titan','of the Titan'],['camel','of the Camel'],['weasel','of the Weasel'],['leopard','of the Leopard'],['sage','of the Sage'],['mage','of the Mage']];
  const A_ATTR={titan:'STR',camel:'END',weasel:'DEX',leopard:'SPD',sage:'INT',mage:'MAG'},A_PER_CARAT=5;
  const isArmorish=g=>!!g&&(g.type==='armor'||g.type==='shield');
  const enchList=g=>g&&g.type==='staff'?S_ENCH:g&&g.type==='tool'?T_ENCH:isArmorish(g)?A_ENCH:g&&g.type==='weapon'&&!/bow/.test(g.name||'')?W_ENCH.filter(e=>e[0]!=='seeking'):W_ENCH;
  const enchKey=g=>g&&g.type==='staff'?'bxcStaffEnch':g&&g.type==='tool'?'bxcToolEnch':g&&g.type==='shield'?'bxcShieldEnch':g&&g.type==='armor'?'bxcArmorEnch':'bxcWeaponEnch';
  // shields take no enchant in the game (even though the rules file would allow an armor one), so none is offered
  const hasEnchant=g=>!!g&&(g.type==='weapon'||g.type==='tool'||g.type==='armor'||g.type==='staff');
  const W_SHORT={'staff-fire':'Fire','staff-ice':'Frost','staff-shock':'Lightning','staff-acid':'Acid',titan:'Titan',camel:'Camel',weasel:'Weasel',leopard:'Leopard',sage:'Sage',mage:'Mage',artisan:'Artisan',destruction:'Destruction',burn:'Flame',freeze:'Freezing',shock:'Storm',corrode:'Corrosion',seeking:'Seeking'};
  // what the enchant adds to a hit (the same at every quality: it is worked from the weapon's average roll)
  function wEnchAdd(g,en){if(g&&g.type==='tool'&&en&&en.ench==='artisan'&&en.c)return {txt:`+${Math.round(T_PER_CARAT*en.c*100)}% success`,dmg:0};
    if(g&&g.type==='staff'&&en&&S_SCHOOL[en.ench]&&en.c)return {txt:`+${en.c} ${S_SCHOOL[en.ench]} school`,dmg:0};
    if(isArmorish(g)&&en&&A_ATTR[en.ench]&&en.c)return {txt:`+${A_PER_CARAT*en.c} ${A_ATTR[en.ench]}`,dmg:0};
    if(!g||g.type!=='weapon'||!en||!en.ench||!en.c)return null;const [,a,b,mult]=g.w,v=(a+b)/2*en.c*W_PER_CARAT*mult;
    return en.ench==='seeking'?{txt:`+${2*en.c}% to hit`,dmg:0}:en.ench==='destruction'?{txt:`+${r1(v)} damage`,dmg:v}:{txt:`+${r1(v)} ${en.ench}`,dmg:v}}
  const W_PER_CARAT=globalThis.BXC_GAME_DATA?.combat?.enchantPerCarat||1/4.5;
  // weapons: three gems of up to 1 carat a metal tier; tools: one gem, same cap (iron 1 ... titanium 4)
  const wEnchCap=g=>g&&(g.type==='weapon'||g.type==='staff'||isArmorish(g))?3*Math.max(0,g.tier||0):g&&g.type==='tool'?Math.max(0,g.tier||0):0;
  const gemsIn=g=>g&&g.type==='tool'?1:3;
  function wEnchState(g){let v={};try{v=JSON.parse(localStorage.getItem(enchKey(g))||'{}')}catch(_){}
    const ench=enchList(g).some(e=>e[0]===v.ench)?v.ench:'',c=Math.max(0,Math.min(wEnchCap(g),Math.floor(+v.c||0)));return {ench:c?ench:'',c:ench?c:0}}
  function gearStats(g,tier,en){
    const m=1+(Q_MULT[tier]||0);
    if(g.type==='weapon'){const [,a,b,mult]=g.w,f=(1+G_TIER_BONUS[g.tier])*m*mult,avgRoll=(a+b)/2,c=en&&en.ench?en.c:0;
      const add=en&&en.ench==='destruction'?avgRoll*c*W_PER_CARAT*mult:0,elem=en&&['burn','freeze','shock','corrode'].includes(en.ench)?avgRoll*c*W_PER_CARAT*mult:0;
      const extra=elem?` + ${r1(elem)} ${en.ench}`:en&&en.ench==='seeking'&&c?` · +${2*c}% to hit`:'';
      return {main:`${r1(a*f+add)}–${r1(b*f+add)} damage${extra}`,avg:avgRoll*f+add+elem}}
    if(g.type==='armor'){
      const base=G_ARMOR_SPECIAL[g.mat]||(G_ARMOR[g.kind]||[])[g.tier]||[0,0];
      const piece=v=>r1(r1(v*5*G_SLOT[g.slot]/G_SLOT_SUM)*m);
      const set=v=>Math.min(.75,(v*5*m)/(v*5*m+25));
      return {main:`${piece(base[0])} armor · ${piece(base[1])} magic defense${en&&A_ATTR[en.ench]&&en.c?` · +${A_PER_CARAT*en.c} ${A_ATTR[en.ench]}`:''}`,set:`${Math.round(set(base[0])*100)}% blows · ${Math.round(set(base[1])*100)}% spells`};
    }
    if(g.type==='shield'){const t=g.kind==='metal'&&g.tier>0?G_SHIELD_METAL:G_SHIELD_SOFT;return {main:`${r1((g.mat==='thak'?7.5:t[g.tier])*m)} shield defense${en&&A_ATTR[en.ench]&&en.c?` · +${A_PER_CARAT*en.c} ${A_ATTR[en.ench]}`:''}`}}
    // the game adds 10% of the quality's value to the metal's bonus (it does not multiply it)
    if(g.type==='staff'){const steps=[0,1,4,7,12][g.tier]||0,sc=en&&S_SCHOOL[en.ench]&&en.c?en.c:0;
      return {main:`${steps?`+${steps} spell steps · `:'no spell steps · '}spells ×${r1(m*100)/100}${sc?` · +${sc} ${S_SCHOOL[en.ench]} school, +1 damage per 10 INT`:''}`,avg:steps*m}}
    if(g.type==='tool'){const b=(G_TOOL_BONUS[g.tier]||0)+.1*(Q_MULT[tier]||0)+(en&&en.ench==='artisan'?T_PER_CARAT*en.c:0);return {main:b?`${b>0?'+':''}${r1(b*100)}% success`:'+0% success',avg:b*100}}
    return {main:'—'};
  }
  // where each quality has come from: monster drops (by monster), your crafts
  function qualitySources(id){
    const mons=new Map(),crafted={};
    for(const d of state.dropAgg?.values?.()||[]){
      if(d.itemTypeId!==id||!d.monsterTypeId)continue;
      const e=mons.get(d.monsterTypeId)||{type:d.monsterTypeId,q:{},elite:false};
      let named=0;for(const [k,n] of Object.entries(d.qualities||{})){e.q[k]=(e.q[k]||0)+n;named+=n}
      // ordinary drops carry no quality label: they are the rest
      if(!(d.qualities||{}).ordinary&&(d.totalQty||0)>named)e.q.ordinary=(e.q.ordinary||0)+(d.totalQty-named);
      if(d.elite)e.elite=true;mons.set(d.monsterTypeId,e);
    }
    for(const c of snapshot?.crafts||[])if(c.itemTypeId===id&&c.quality)crafted[c.quality]=(crafted[c.quality]||0)+1;
    return {mons:[...mons.values()],crafted};
  }
  const qLabel=t=>t==='all'?'All':prettyId(t);
  function gearQualityHtml(id,pick){
    const g=gearOf(id);if(!g)return '';
    pick=Q_TIERS.includes(pick)?pick:'all';
    const src=qualitySources(id),seen=new Map();
    for(const e of src.mons)for(const [k,n] of Object.entries(e.q))seen.set(k,(seen.get(k)||0)+n);
    for(const [k,n] of Object.entries(src.crafted))seen.set(k,(seen.get(k)||0)+n);
    const hasEnch=hasEnchant(g),en=hasEnch?wEnchState(g):null,ordinary=gearStats(g,'ordinary'),ea=hasEnch?wEnchAdd(g,en):null;
    const picker=`<div class="q-picker" role="group" aria-label="Quality">${['all',...Q_TIERS].map(t=>`<a class="q-chip${t===pick?' on':''} q-${t}" href="${pageHref('item',id)}${t==='all'?'':'?q='+t}">${esc(qLabel(t))}${t!=='all'&&seen.get(t)?` <span>${fmt(seen.get(t))}</span>`:''}</a>`).join('')}</div>`;
    const rows=Q_TIERS.map(t=>{const s=gearStats(g,t),pctTxt=(Q_MULT[t]>0?'+':'')+Math.round((Q_MULT[t]||0)*100)+'%';
      return `<tr class="q-row${t===pick?' q-row-on':''}" data-href="${pageHref('item',id)}?q=${t}" title="Show it at ${esc(qLabel(t))}"><td><img class="q-mini ${typeof qualityGlow==='function'?qualityGlow(t):''}" src="${esc(itemImgFor(id))}" alt=""><span class="q-name q-${t}">${esc(qLabel(t))}</span></td><td>${pctTxt}</td><td>${esc(s.main)}</td>${g.type==='armor'?`<td>${esc(s.set)}</td>`:''}${g.type==='weapon'?`<td>${s.avg>ordinary.avg?'+':''}${r1(s.avg-ordinary.avg)} avg</td>`:''}${ea?`<td class="e-name e-${en.ench}">${esc(ea.txt)}</td><td>${esc(gearStats(g,t,en).main)}</td>`:''}<td class="muted">${seen.get(t)?fmt(seen.get(t))+' seen':''}</td></tr>`}).join('');
    const head=['Quality','Stats','This item',...(g.type==='armor'?['A full set of it protects']:[]),...(g.type==='weapon'?['vs Ordinary']:[]),...(ea?[`<span class="e-name e-${en.ench}">+ ${esc(W_SHORT[en.ench])} ${en.c}c</span>`,'With it']:[]),''];
    // crafting odds by how far above the recipe you are
    const recipe=(typeof RECIPES!=='undefined'?RECIPES:[]).find(x=>x.id===id);
    const oddsRows=recipe&&typeof CRAFT_QUALITY_TABLE!=='undefined'?CRAFT_QUALITY_TABLE.map(t=>[`${recipe.level+t.levelsOver} <span class="muted">(+${t.levelsOver})</span>`,...QUALITY_TIERS.map(k=>k==='flawless'&&!t[k]?'~0%':((t[k]||0)*100).toFixed(1)+'%')]):[];
    // monsters that dropped it, narrowed to the picked quality
    const mons=src.mons.map(e=>({...e,n:pick==='all'?Object.values(e.q).reduce((a,b)=>a+b,0):(e.q[pick]||0)})).filter(e=>e.n>0).sort((a,b)=>b.n-a.n);
    const monRows=mons.slice(0,12).map(e=>[`<a href="${pageHref('monster',e.type)}">${esc(monsterNameFor(e.type))}</a>${e.elite?' <span class="muted">(incl. elites)</span>':''}`,Q_TIERS.filter(t=>e.q[t]).map(t=>`<span class="q-name q-${t}">${esc(qLabel(t))}</span> ${fmt(e.q[t])}`).join(' · ')]);
    const craftedLine=Object.keys(src.crafted).length?`<p>Your own crafts came out: ${Q_TIERS.filter(t=>src.crafted[t]).map(t=>`<span class="q-name q-${t}">${esc(qLabel(t))}</span> ${fmt(src.crafted[t])}`).join(' · ')}.</p>`:'';
    const cap=wEnchCap(g);
    const enchPicker=hasEnch?wEnchChips(id,g,en):'';
    return `<h2>Quality</h2>${picker}${enchPicker}
      <p class="s muted">Quality scales this item’s own stats. ${g.type==='weapon'?'Damage below is the weapon alone, before your stats and enchantments.':g.type==='armor'?'Protection comes from the armor of all five pieces together, up to 75%.':''}</p>
      <div class="g-scroll" id="gearQTable"><table class="g-table q-table"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody id="gearQRows">${rows}</tbody></table></div>
      <h2>Getting ${pick==='all'?'each quality':esc(qLabel(pick))+' ones'}</h2>
      ${recipe?`<p><b>Crafting</b> (${esc(recipe.skill)} ${recipe.level}): the higher above ${recipe.level} you are, the better the odds, up to +30. <a href="#/calc-quality" data-qe="${esc(id)}">Plan it on Quality &amp; enchanting</a></p>
        <div class="g-scroll"><table class="g-table"><thead><tr><th>Your level</th>${QUALITY_TIERS.map(q=>`<th><span class="q-name q-${q}">${esc(prettyId(q))}</span></th>`).join('')}</tr></thead><tbody>${oddsRows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}
      ${craftedLine}
      <p><b>Monster drops</b>: ordinary monsters and chests give at most Excellent; elites give only Excellent, Superior or Flawless (official guide).</p>
      ${monRows.length?`<div class="g-scroll"><table class="g-table"><thead><tr><th>Dropped by</th><th>Qualities recorded</th></tr></thead><tbody>${monRows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</tbody></table></div>`:`<p class="muted">${pick==='all'?'No drops of it recorded yet.':'No '+esc(qLabel(pick))+' drops of it recorded yet.'}</p>`}
      ${mons.length?`<button type="button" class="show-on-map" data-map-kind="item" data-map-id="${esc(id)}"${pick!=='all'?` data-map-quality="${pick}"`:''}>Show ${pick==='all'?'where it drops':'where it drops '+esc(qLabel(pick))} on the map</button>`:''}`;
  }
  // ---- A gem's sizes, laid out like gear's qualities: 0.5c to 4c, each with its rarity (in the game's quality colours),
  // how often it has been found, how you get one, and what it does in a ring. ?q=2.5 picks a size.
  const RARITY_Q={common:'ordinary',uncommon:'good','semi-rare':'excellent',rare:'superior','very rare':'flawless'};
  const GEM_SIZES=[.5,1,1.5,2,2.5,3,3.5,4];
  const gemPick=q=>{const c=parseFloat(q);return GEM_SIZES.includes(c)?c:null};
  const gemRar=c=>globalThis.bxcGemRarity?globalThis.bxcGemRarity(c):'common';
  const gemGlow=c=>c!=null&&typeof qualityGlow==='function'?qualityGlow(RARITY_Q[gemRar(c)]):'';
  function gemCaratHtml(id,pickRaw){
    if(!/^gem-/.test(id))return '';
    const kind=id.replace(/^gem-/,''),pick=gemPick(pickRaw),all=(snapshot?.gems||[]).filter(g=>Number.isFinite(+g.carat));
    const mine=all.filter(g=>g.typeId===id),byC=new Map(),byCAll=new Map();
    for(const g of mine)byC.set(+g.carat,(byC.get(+g.carat)||0)+1);
    for(const g of all)byCAll.set(+g.carat,(byCAll.get(+g.carat)||0)+1);
    const s=typeof gemCombineSettings==='function'?gemCombineSettings():{per:3,step:.5,cap:2};
    const ring=(globalThis.BXC_GAME_DATA?.rings||[]).find(r=>r.gem===kind),ringAt=c=>{if(!ring||!ring.text)return null;if(Number.isInteger(c)&&ring.text[c])return ring.text[c];const t4=String(ring.text[4]||''),m=/(\d+(?:\.\d+)?)%/.exec(t4);return m?t4.replace(m[0],'≈'+(+(m[1]/4*c).toFixed(2))+'%'):null};
    const chip=c=>globalThis.bxcGemRarityChip?globalThis.bxcGemRarityChip(c):esc(gemRar(c));
    const pct=(n,t)=>t?(n/t*100).toFixed(n/t<.1?1:0)+'%':'—';
    const picker=`<div class="q-picker" role="group" aria-label="Carat"><a class="q-chip${pick==null?' on':''}" href="${pageHref('item',id)}">All</a>${GEM_SIZES.map(c=>`<a class="q-chip${c===pick?' on':''} q-${RARITY_Q[gemRar(c)]}" href="${pageHref('item',id)}?q=${c}">${c}c${byC.get(c)?` <span>${fmt(byC.get(c))}</span>`:''}</a>`).join('')}</div>`;
    const rows=GEM_SIZES.map(c=>`<tr class="q-row${c===pick?' q-row-on':''}" data-href="${pageHref('item',id)}?q=${c}" title="Show the ${c}c one"><td><img class="q-mini ${gemGlow(c)}" src="${esc(itemImgFor(id))}" alt="" style="transform:scale(${(.6+c*.1).toFixed(2)})"><span class="q-name q-${RARITY_Q[gemRar(c)]}">${c}c</span></td><td>${chip(c)}</td>
      <td>${byC.get(c)?fmt(byC.get(c)):'<span class="muted">0</span>'}${byC.get(c)?` <span class="muted">(${pct(byC.get(c),mine.length)})</span>`:''}</td><td>${pct(byCAll.get(c)||0,all.length)}</td>
      <td>${globalThis.bxcGemHow?globalThis.bxcGemHow(c):''}</td>${ring?`<td>${esc(ringAt(c)||'—')}</td>`:''}</tr>`).join('');
    const found=mine.filter(g=>!g.dropped).length,dropped=mine.length-found;
    return `<h2>Carats</h2>${picker}
      <p class="s muted">Gems come in half-carat steps from 0.5c to 4c. Up to ${s.cap}c can be made at the witch, so those count as common; bigger ones only come from finds, and a 4c gem is very rare.</p>
      <div class="g-scroll"><table class="g-table q-table"><thead><tr><th>Carat</th><th>Rarity</th><th>${esc(prettyId(kind))} found</th><th>Of all gems found</th><th>How you get one</th>${ring?`<th>In a ring (${esc(prettyId(ring.bonus))})</th>`:''}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="s muted">${mine.length?`${fmt(mine.length)} ${esc(prettyId(kind))} recorded: ${fmt(found)} while gathering${dropped?`, ${fmt(dropped)} from monsters`:''}.`:`No ${esc(prettyId(kind))} recorded yet.`} “Of all gems found” is out of ${fmt(all.length)} gems of every kind. <a href="#/gemcombine">Gem combiner</a></p>`;
  }
  // The enchant, picked like the quality: a row of enchant chips, then (with one picked) whole carats up to the
  // metal's cap, each coloured by how rare the biggest of its three gems is (6c = three 2c gems, common; 7c needs a 3c)
  globalThis.bxcGearInfo=id=>{const g=gearOf(id);if(!g)return null;return {type:g.type,flawless:true,glows:g.type==='weapon'||g.type==='staff',enchants:hasEnchant(g)&&wEnchCap(g)?enchList(g).map(e=>e[0]).filter(Boolean):[]}};
  function wEnchChips(id,g,en){
    const cap=wEnchCap(g);if(!cap)return `<p class="s muted">${g.type==='staff'?'A plain wand takes no enchant; a staff does.':`Basic ${g.type==='tool'?'tools':g.type==='armor'?'armor takes':g.type==='shield'?'shields':'weapons'}${g.type==='armor'?'':' take'} no enchant.`}</p>`;
    const short={'':'No enchant',...W_SHORT},n=gemsIn(g);
    const cur=en.ench||'',curC=en.c||0;
    const ench=`<div class="q-picker w-ench" data-gear="${esc(id)}" role="group" aria-label="Enchant">${enchList(g).map(([k])=>`<button type="button" class="q-chip${k===cur?' on':''}" data-wench="${k}">${esc(short[k])}</button>`).join('')}</div>`;
    const carats=cur?`<div class="q-picker w-carat" role="group" aria-label="Carats">${Array.from({length:cap},(_,i)=>i+1).map(c=>{const big=Math.ceil(c/n),r=gemRar(big);return `<button type="button" class="q-chip${c===curC?' on':''} q-${RARITY_Q[r]}" data-wcarat="${c}" title="${n>1?`${c} carats: three gems, the biggest ${big}c`:`a ${c}-carat gem`} (${r})">${c}c</button>`}).join('')}</div>`:'';
    return ench+carats+(cur?`<p class="s muted">${n>1?`Three gems${isArmorish(g)?' (iolite, the kind\'s own gem and any one)':''}, up to ${cap/3}c each on this ${g.type==='armor'?'armor':g.type==='shield'?'shield':'metal'}${isArmorish(g)?', +5 to the attribute a carat':''}. 2-carat gems are what the gem combiner makes, so 6c is the realistic top`:`One gem, up to ${cap}c on this metal, +5% success a carat. 2 carats is what the gem combiner makes, so 2c is the realistic top`}; the colours are how rare the gems are.</p>`:'');
  }
  function reWeaponEnch(patch){
    const box=document.querySelector('.w-ench');if(!box)return;const id=box.dataset.gear,g=gearOf(id);if(!g)return;
    let v={};try{v=JSON.parse(localStorage.getItem(enchKey(g))||'{}')}catch(_){}
    Object.assign(v,patch);if(v.ench&&!(+v.c>0))v.c=Math.min(2*gemsIn(g),wEnchCap(g));
    try{localStorage.setItem(enchKey(g),JSON.stringify(v))}catch(_){}
    const pick=pageNow&&pageNow.kind==='item'&&pageNow.id===id?pageNow.q:null,tmp=document.createElement('div');tmp.innerHTML=gearQualityHtml(id,pick);
    for(const sel of ['.w-ench','#gearQTable']){const n=tmp.querySelector(sel),o=document.querySelector(sel);if(n&&o)o.innerHTML=n.innerHTML}
    // the carat row and its note come and go with the enchant
    const oc=document.querySelector('.w-carat'),nc=tmp.querySelector('.w-carat'),on=box.nextElementSibling&&box.nextElementSibling.matches('.w-carat')?box.nextElementSibling.nextElementSibling:box.nextElementSibling;
    if(oc)oc.remove();if(on&&on.matches('p.s.muted')&&/Three gems|One gem/.test(on.textContent))on.remove();
    if(nc){box.after(nc);const np=tmp.querySelector('.w-carat+p');if(np)nc.after(np)}
    const dmg=document.getElementById('gearDmg');if(dmg)dmg.innerHTML=gearDamageCell(id,pick);
    const bd=document.getElementById('gearEnchBadge');if(bd)bd.innerHTML=gearEnchBadge(id);
    const pic=bd&&bd.closest('.wp-pic');if(pic){pic.className=pic.className.replace(/\s*e-glow-\w+/g,'');const en=wEnchState(g);if(en.ench&&en.c&&/^(weapon|staff)$/.test(g.type))pic.classList.add('e-glow-'+en.ench)}   // weapons and staffs only
  }
  // on the picture: the enchant and its carats, coloured by how rare its gems are
  function gearEnchBadge(id){const g=gearOf(id);if(!hasEnchant(g))return '';const en=wEnchState(g);if(!en.ench||!en.c)return '';
    const r=gemRar(Math.ceil(en.c/gemsIn(g)));
    return `<span class="tag-chip rar-${r.replace(/ /g,'-')}">${esc(W_SHORT[en.ench]||en.ench)} ${en.c}c</span>`}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-wench],[data-wcarat]');if(!b)return;
    if(b.dataset.wench!==undefined)reWeaponEnch({ench:b.dataset.wench});else reWeaponEnch({c:+b.dataset.wcarat})});
  // under the picture: the damage of the picked quality (ordinary when none is picked) with the enchant
  function gearDamageCell(id,pick){const g=gearOf(id);if(!hasEnchant(g))return '';const t=Q_TIERS.includes(pick)?pick:'ordinary',en=wEnchState(g),ea=wEnchAdd(g,en);
    return `${esc(gearStats(g,t).main)} <span class="muted">(${esc(qLabel(t))})</span>`+(ea?`<br><span class="e-name e-${en.ench}">${esc(ea.txt)}</span> <span class="muted">(${esc(W_SHORT[en.ench])} ${en.c}c)</span><br>= ${esc(gearStats(g,t,en).main)}`:'')}
  // the same numbers for the Quality & enchanting planner: an item's stats at a quality, and with an enchant (named as
  // the planner names it, "of Corrosion") at so many carats - what it adds and the total
  globalThis.bxcGearDamage=(id,q,enchName,c)=>{const g=gearOf(id);if(!g)return null;const t=Q_TIERS.includes(q)?q:'ordinary';
    const hit=hasEnchant(g)?enchList(g).find(([k,lb])=>k&&(lb===enchName||lb.replace(/^of (the )?/,'')===String(enchName||'').replace(/^of (the )?/,''))):null;
    const en=hit&&c>0?{ench:hit[0],c}:null,ea=en?wEnchAdd(g,en):null;
    return {base:gearStats(g,t).main,key:hit?hit[0]:null,add:ea?ea.txt:null,total:ea?gearStats(g,t,en).main:null,glow:en&&/^(weapon|staff)$/.test(g.type)?'e-glow-'+en.ench:''}};
  // "Plan it on Quality & enchanting" opens that page with this item picked
  document.addEventListener('click',e=>{const tr=e.target.closest('tr[data-href]');if(tr&&!e.target.closest('a,button'))goRoute(tr.dataset.href)});
  document.addEventListener('click',e=>{const a=e.target.closest('[data-qe]');if(a)window.bxcQEPreselect=a.dataset.qe},true);
  // ---- Monster levels ---------------------------------------------------------------------------------------
  // One monster type spawns at several levels. The game works its stats out from the level (rules file): HP =
  // round(round(12 + 2*(L-1)) * (L<=9 ? 1 : min(3.5, 1.025^(L-9)))), damage = (5.05 + 0.55*(L-1)) x the family's
  // archetype factor x a softening below level 8, XP = 50*L; elites x3 HP, x1.4 damage, x3 XP; bosses x3 HP.
  // The client only carries the "soft" archetype factor (1), so each monster's own factor is read back from its
  // known damage at its base level (werewolves come out at 1.9). Sightings by level come from what was recorded.
  const lvHp=L=>Math.round(Math.round(12+Math.max(0,L-1)*2)*(L<=9?1:Math.min(3.5,1.025**(L-9))));
  const lvSoften=L=>L>=8?1:L<=1?.3:.3+.7*(L-1)/7;
  const lvDmgBase=L=>(5.05+Math.max(0,L-1)*.55)*lvSoften(L);
  const lvXp=L=>Math.floor(50*Math.max(1,L));
  function monsterLevelStats(m,L){
    const GL=globalThis.BXC_GAME_DATA?.monsterLevels,base0=Number(m?.baseLevel)||L;
    if(GL&&GL.hp&&GL.hp[L-1]!=null&&L!==base0){const dm=(GL.damage&&GL.damage[m?.archetype||'soft'])||(GL.damage&&Object.values(GL.damage)[0]);
      return {hp:GL.hp[L-1],dmg:dm?dm[L-1]:null,xp:GL.xp[L-1]}}
    const base=Number(m?.baseLevel)||L;
    const factor=m&&Number(m.attackDamage)>0?Number(m.attackDamage)/lvDmgBase(base):1;
    const atBase=L===base;
    return {hp:atBase&&Number(m?.maxHp)>0?Number(m.maxHp):lvHp(L),dmg:atBase&&Number(m?.attackDamage)>0?Number(m.attackDamage):Math.round(lvDmgBase(L)*factor*10)/10,xp:atBase&&Number(m?.xp)>0?Number(m.xp):lvXp(L)};
  }
  // recorded sightings of this monster by level: count, and where (points on a 10-tile grid)
  function monsterLevelsSeen(type){
    const by=new Map(),seen=new Set();
    for(const o of snapshot?.npcObservations||[]){
      if(o.typeId!==type||!Number.isFinite(o.level))continue;
      const e=by.get(o.level)||{level:o.level,n:0,pts:[]};e.n++;
      const p=o.position;if(p&&!p.z&&Number.isFinite(p.x)){const k=o.level+'|'+Math.round(p.x/10)+'|'+Math.round(p.y/10);if(!seen.has(k)){seen.add(k);e.pts.push({x:p.x,y:p.y})}}
      by.set(o.level,e);
    }
    for(const n of snapshot?.npcs||[]){   // monsters met but not sighted again still count once
      if(n.typeId!==type||!Number.isFinite(n.level)||by.has(n.level))continue;
      by.set(n.level,{level:n.level,n:1,pts:n.position&&!n.position.z?[{x:n.position.x,y:n.position.y}]:[]});
    }
    return [...by.values()].sort((a,b)=>a.level-b.level);
  }
  function monsterLevelsHtml(id,pick){
    const m=(D.catalog||[]).find(x=>x.typeId===id);if(!m)return '';
    const levels=monsterLevelsSeen(id);
    const list=[...new Set([Number(m.baseLevel),...levels.map(l=>l.level)])].filter(Number.isFinite).sort((a,b)=>a-b);
    if(list.length<2)return '';   // only ever seen at one level: nothing to compare
    pick=list.includes(Number(pick))?Number(pick):null;
    const seenOf=L=>levels.find(l=>l.level===L);
    const picker=`<div class="q-picker" role="group" aria-label="Level"><a class="q-chip${pick==null?' on':''}" href="${pageHref('monster',id)}">All levels</a>${list.map(L=>`<a class="q-chip${L===pick?' on':''}" href="${pageHref('monster',id)}?lv=${L}">Lv ${L}${seenOf(L)?` <span>${fmt(seenOf(L).n)}</span>`:''}</a>`).join('')}</div>`;
    const rows=list.map(L=>{const s=monsterLevelStats(m,L),e={hp:s.hp*3,dmg:Math.round(s.dmg*14)/10,xp:s.xp*3},w=seenOf(L),where=w&&w.pts.length?placesFor(w.pts)[0]:null;
      return `<tr class="${L===pick?'q-row-on':''}" data-href="${pageHref('monster',id)}${L===pick?'':'?lv='+L}" title="${L===pick?'Show all levels':'Pick level '+L}"><td><b>${L}</b>${L===Number(m.baseLevel)?' <span class="muted">(base)</span>':''}</td><td>${fmt(s.hp)}</td><td>${s.dmg}</td><td>${fmt(s.xp)}</td><td class="muted">${fmt(e.hp)} · ${e.dmg} · ${fmt(e.xp)}</td><td>${w?fmt(w.n):'<span class="muted">—</span>'}</td><td>${where?placeLine(where):'<span class="muted">—</span>'}</td></tr>`}).join('');
    const w=pick!=null?seenOf(pick):null;
    return `<h2>Levels</h2>${picker}
      <p class="s muted">The same monster spawns at different levels, and its hitpoints, damage and XP follow its level (the game’s own formula). In the game a monster more than 5 levels above you shows its level as “???”.</p>
      <div class="g-scroll"><table class="g-table q-table"><thead><tr><th>Level</th><th>HP</th><th>Damage</th><th>XP</th><th>Elite (HP · dmg · XP)</th><th>Seen</th><th>Mostly</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${w&&w.pts.length?`<button type="button" class="show-on-map" data-map-kind="monster" data-map-id="${esc(id)}" data-map-level="${pick}">Show level ${pick} on the map</button>`:''}`;
  }
  // ---- Named NPCs ---------------------------------------------------------------------------------------------
  // People (trainers, vendors, quest-givers - all of the game's "human" type) and named specials of a monster type
  // (Goblin King, Skeleton King) are recorded under their type, so they had no page of their own. Each distinct name
  // that differs from its type's name gets one: #/npc/<slug of the name>.
  const npcSlug=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  let npcCache={npcs:null,obs:null,map:new Map()};
  function namedNpcs(){
    const npcs=snapshot?.npcs,obs=snapshot?.npcObservations;
    if(npcCache.npcs===npcs&&npcCache.obs===obs)return npcCache.map;
    const typeName=new Map((D.catalog||[]).map(m=>[m.typeId,String(m.name||'').toLowerCase()]));
    const map=new Map();
    const add=(n,isObs)=>{
      const name=String(n.name||'').trim();if(!name||!n.typeId)return;
      const plain=typeName.get(n.typeId)||String(n.typeId).replace(/-/g,' ');
      if(name.toLowerCase()===plain||name.toLowerCase()===String(n.typeId).replace(/-/g,' '))return;
      const k=npcSlug(name);let e=map.get(k);if(!e)map.set(k,e={slug:k,name,typeId:n.typeId,levels:new Map(),cls:new Set(),zones:new Map(),pts:[],seen:0,maxHp:null});
      e.seen++;if(Number.isFinite(n.level))e.levels.set(n.level,(e.levels.get(n.level)||0)+1);if(n.npcClass)e.cls.add(n.npcClass);
      if(!isObs&&Number.isFinite(n.maxHitpoints))e.maxHp=Math.max(e.maxHp||0,n.maxHitpoints);
      const p=n.position;if(p&&Number.isFinite(p.x)){if(p.z)e.zones.set(p.z,(e.zones.get(p.z)||0)+1);else if(e.pts.length<400)e.pts.push({x:p.x,y:p.y})}
    };
    for(const n of npcs||[])add(n,false);
    for(const o of obs||[])add(o,true);
    npcCache={npcs,obs,map};return map;
  }
  // a named NPC's own picture (drawn in their outfit by the collector), else their type's
  const npcImg=e=>usableImageUrl(state.exactAssetIndex?.get('monster:npc-'+e.slug))||monsterImg({typeId:e.typeId,name:e.name});
  const npcsOfType=type=>[...namedNpcs().values()].filter(e=>e.typeId===type).sort((a,b)=>b.seen-a.seen);
  // an NPC's rooms, by the outdoor entrance you would walk in through
  function npcPlaces(e){
    const out=[];
    for(const [z,n] of e.zones){const poi=dungeonPoiForZone(z),ent=entranceForZone(z);out.push({z,n,name:state.zones?.get(z)?.name||poi?.name||('Zone '+z),pt:poi?{x:poi.x,y:poi.y}:ent?{x:ent.x,y:ent.y}:null})}
    return out.sort((a,b)=>b.n-a.n);
  }
  function npcRole(name){
    const n=name.toLowerCase();
    return /trainer|master\b|squiremaster|guildmaster|stablemaster/.test(n)?'trainer':/vendor|clerk|banker|merchant|shop|tailor|smith/.test(n)?'townsperson who trades':/guard|soldier|archer|watch/.test(n)?'guard':'';
  }
  function npcPageHtml(slug){
    const e=namedNpcs().get(slug);if(!e)return '<p class="muted">Not met yet.</p>';
    const m=(D.catalog||[]).find(x=>x.typeId===e.typeId),typeLabel=m?.name||prettyId(e.typeId);
    const lv=[...e.levels.keys()].sort((a,b)=>a-b),role=npcRole(e.name);
    const places=npcPlaces(e),outdoors=e.pts.length?placesFor(e.pts):[];
    const drops=[...state.dropAgg?.values?.()||[]].filter(d=>String(d.monsterName||'').toLowerCase()===e.name.toLowerCase());
    const stats=lv.length&&m?monsterLevelStats(m,lv[lv.length-1]):null;
    return `<article class="wp"><div class="wp-main">
      <p class="wp-lede">${esc(e.name)} is ${role?'a '+esc(role)+' — ':''}a named <a href="${pageHref('monster',e.typeId)}">${esc(typeLabel)}</a>${lv.length?` seen at level ${lv.length>1?lv[0]+'–'+lv[lv.length-1]:lv[0]}`:''}${e.cls.size?' ('+[...e.cls].map(esc).join(', ')+')':''}.</p>
      ${(()=>{const eq=npcGear(slug);if(!eq)return '';const o=outfitFor(eq);return `<h2>Wearing</h2><p>${o?`The <a href="#/guide/outfits">${esc(o.name)}</a> outfit${eq.mainHand||eq.offHand?', and':''}`:''}</p><div class="gear-line">${gearLine(eq)}</div>`})()}
      ${(()=>{const g=questGiverList().find(x=>x.slug===slug);if(!g)return '';return `<h2>Quests</h2>${g.quests.length?`<ul class="wp-list">${g.quests.map(q=>`<li><a href="${questHref(q)}">${esc(q.name)}</a> <span class="muted">· level ${q.recommendedLevel||'?'}</span></li>`).join('')}</ul>`:'<p class="muted">'+esc(e.name)+' has quests to give; none has been recorded yet.</p>'}`})()}
      <h2>Where to find ${esc(e.name)}</h2>
      ${places.length?`<ul class="wp-list">${places.map(p=>`<li>Inside <b>${esc(p.name)}</b> <span class="muted">· seen ${fmt(p.n)}×</span> <button type="button" class="open-zone" data-zone="${esc(p.z)}">Layout</button></li>`).join('')}</ul>`:''}
      ${outdoors.length?`<ul class="wp-list">${outdoors.slice(0,5).map(a=>`<li>${placeLine(a)}</li>`).join('')}</ul>`:''}
      ${!places.length&&!outdoors.length?'<p class="muted">No position recorded yet.</p>':''}
      ${places.length||outdoors.length?`<button type="button" class="show-on-map" data-map-kind="npc" data-map-id="${esc(slug)}">Show on map</button>`:''}
      ${drops.length?`<h2>Drops</h2><div class="collector-extra">${chipRowHtml(drops.sort((a,b)=>b.events-a.events).map(d=>'<div class="entity-chip dropicon-link" data-item="'+esc(d.itemTypeId)+'"><img class="thumb itemthumb" src="'+esc(itemImgFor(d.itemTypeId))+'" alt=""><span class="entity-chip-label">'+esc(prettyId(d.itemTypeId))+'</span><span class="entity-chip-stat">'+fmt(d.events)+' drop'+(d.events===1?'':'s')+'</span></div>'))}</div>`:e.typeId!=='human'?`<h2>Drops</h2><p class="muted">No drops recorded for ${esc(e.name)} yet.</p>`:''}
      ${npcsOfType(e.typeId).length>1?`<h2>Other named ${esc(typeLabel)}s</h2><p>${npcsOfType(e.typeId).filter(x=>x.slug!==slug).slice(0,30).map(x=>`<a href="${pageHref('npc',x.slug)}">${esc(x.name)}</a>`).join(' · ')}</p>`:''}
    </div><aside class="wp-infobox"><div class="wp-pic"><img src="${esc(npcImg(e))}" alt=""></div><h3>${esc(e.name)}</h3><table>
      ${infoRow('Kind',`<a href="${pageHref('monster',e.typeId)}">${esc(typeLabel)}</a>`)}${role?infoRow('Role',esc(role)):''}
      ${lv.length?infoRow('Level',lv.length>1?lv[0]+'–'+lv[lv.length-1]:String(lv[0])):''}${e.cls.size?infoRow('Class',[...e.cls].map(esc).join(', ')):''}
      ${e.maxHp?infoRow('Hitpoints',fmt(e.maxHp)):stats?infoRow('Hitpoints',fmt(stats.hp)):''}${infoRow('Seen',fmt(e.seen)+' times')}
    </table></aside></article>`;
  }
  // ---- Outfits: the game's catalog as drawn by the collector (assets "monster:outfit-<id>", each carrying its outfit),
  // and the gear each named NPC was seen wearing (their own picture's asset carries it). An NPC "wears" an outfit when
  // every piece of the outfit's body matches.
  const OUTFIT_SLOTS=['head','torso','arms','legs','feet'];
  function outfitsList(){
    const out=[];
    for(const a of snapshot?.assets||[]){const o=a?.variant?.outfit;if(a.entityKind==='monster'&&String(a.entityId||'').startsWith('outfit-')&&o)out.push({...o,img:usableImageUrl(a)})}
    return out.sort((x,y)=>String(x.group).localeCompare(String(y.group))||String(x.name).localeCompare(String(y.name)));
  }
  const npcGear=slug=>state.exactAssetIndex?.get('monster:npc-'+slug)?.variant?.equipment||null;
  function outfitFor(eq){
    if(!eq)return null;
    return outfitsList().find(o=>OUTFIT_SLOTS.every(s=>(o.body?.[s]||null)===(eq[s]||null)))||null;
  }
  function gearLine(eq){
    const parts=[...OUTFIT_SLOTS,'mainHand','offHand'].filter(s=>eq&&eq[s]).map(s=>`<span class="gear-piece"><i>${esc(s==='mainHand'?'main hand':s==='offHand'?'off hand':s)}</i> ${esc(prettyId(eq[s]))}</span>`);
    return parts.join('');
  }
  globalThis.bxcOutfits=()=>{
    const list=outfitsList(),worn=new Map();
    for(const e of namedNpcs().values()){const o=outfitFor(npcGear(e.slug));if(o){(worn.get(o.id)||worn.set(o.id,[]).get(o.id)).push({slug:e.slug,name:e.name,href:pageHref('npc',e.slug)})}}
    // monsters whose sent gear is an outfit
    for(const m of D.catalog||[])for(const l of monsterLooks(m.typeId)){const o=outfitFor(l.equipment);if(o){const w=worn.get(o.id)||worn.set(o.id,[]).get(o.id);if(!w.some(x=>x.href===pageHref('monster',m.typeId)))w.push({name:m.name,href:pageHref('monster',m.typeId)})}}
    return {list,worn};
  };
  // ---- Monster looks: each look the collector drew ("monster:look-<...>", carrying {typeId, npcClass, castSchool,
  // band, from, to, armor, equipment}) - archers and mages change armor with level, classes change weapons.
  let looksCache={assets:null,map:new Map()};
  function monsterLooks(type){
    const assets=snapshot?.assets;
    if(looksCache.assets!==assets){const map=new Map();for(const a of assets||[]){const l=a?.variant?.look;if(a.entityKind==='monster'&&l&&l.typeId&&String(a.entityId||'').startsWith('look-')){(map.get(l.typeId)||map.set(l.typeId,[]).get(l.typeId)).push({...l,img:usableImageUrl(a)})}}looksCache={assets,map}}
    return (looksCache.map.get(type)||[]).slice().sort((a,b)=>String(a.npcClass||'').localeCompare(String(b.npcClass||''))||String(a.castSchool||'').localeCompare(String(b.castSchool||''))||(a.from||0)-(b.from||0));
  }
  const lookHas=(l,L)=>L!=null&&l.from!=null&&L>=l.from&&(l.to==null||L<=l.to);
  function lookLabel(l){return (l.npcClass?prettyId(l.npcClass)+(l.castSchool?' ('+prettyId(l.castSchool)+')':''):'Plain')}
  function looksHtml(type,pick){
    const list=monsterLooks(type).filter(l=>l.img);if(!list.length)return '';
    // one plain look and nothing else says nothing the picture doesn't
    if(list.length===1&&!list[0].band&&!list[0].equipment&&!list[0].npcClass)return '';
    return `<h2>Appearance</h2><p class="s muted">How the game draws it. Archers and mages wear better armor as their level goes up.</p><div class="look-grid">${list.map(l=>{
      const range=l.band?(l.to!=null?`Level ${l.from}–${l.to}`:`Level ${l.from}+`):'Any level';
      const eq=l.equipment?gearLine(l.equipment):'',o=l.equipment?outfitFor(l.equipment):null;
      return `<div class="look-card${lookHas(l,pick)?' on':''}"><img src="${esc(l.img)}" alt=""><div><b>${esc(lookLabel(l))}</b><div class="g-note">${esc(range)}${l.armor?' · '+esc(prettyId(l.armor))+' armor':''}</div>${o?`<div class="g-note">The <a href="#/guide/outfits">${esc(o.name)}</a> outfit</div>`:''}${eq?`<div class="gear-line">${eq}</div>`:''}</div></div>`}).join('')}</div>`;
  }
  // the picture for a picked level: the look of that level band, if drawn
  function lookImgFor(type,L){const l=monsterLooks(type).find(x=>x.img&&lookHas(x,L));return l?l.img:null}
  // ---- Trainers: named NPCs with "Trainer" in their name (Mining Trainer, Fishing Trainer...), the skill each
  // teaches (from the name, matched to a skill guide) and where to find them: outdoors at the spot they stand, indoors
  // at the entrance of their building - the right building when one zone number is several (see zoneAreas).
  const TRAINER_RE=/\btrainer\b/i;
  let trainerCache={key:null,list:[]};
  function trainerList(){
    const key=[snapshot?.npcs,snapshot?.npcObservations,state.zoneEntrances,state.areaEntrances,globalThis.bxcGuides];
    if(trainerCache.key&&key.every((k,i)=>k===trainerCache.key[i]))return trainerCache.list;
    const list=[],byName=new Map();
    for(const e of namedNpcs().values()){
      if(!TRAINER_RE.test(e.name))continue;
      const skillName=e.name.replace(TRAINER_RE,'').replace(/\s+/g,' ').trim();
      const guide=skillName&&globalThis.bxcGuides?.forSkill?globalThis.bxcGuides.forSkill(skillName):null;
      const t={slug:e.slug,name:e.name,skill:skillName||null,guide,e};
      byName.set(e.name,t);list.push(t);
    }
    placePeople(list,byName);
    list.sort((a,b)=>String(a.skill||a.name).localeCompare(String(b.skill||b.name)));
    trainerCache={key,list};return list;
  }
  // Where named people are: indoors at the entrance of their building (the right building when one zone number is
  // several, see zoneAreas), outdoors at the middle of where they stand. list: [{name,e (a namedNpcs entry),...}].
  // a person's spot placed by hand (collector set-npc-spot, kept with the hand-placed markers)
  const npcSpotOf=name=>(snapshot?.manualResources||[]).find(m=>m&&m.kind==='npc-spot'&&String(m.name).trim()===String(name).trim()&&Number.isFinite(+m.x)&&Number.isFinite(+m.y))||null;
  function placePeople(list,byName){
    for(const t of list){t.spots=[];t.inside=new Map()}
    if(byName.size)for(const arr of [snapshot?.npcs,snapshot?.npcObservations])for(const o of arr||[]){
      const p=o.position;if(!p||!p.z||!Number.isFinite(p.x))continue;
      const t=byName.get(String(o.name||'').trim());if(!t)continue;
      const as=zoneAreas(p.z);let ai=0;if(as.length>1){ai=as.findIndex(a=>inArea(a,p));if(ai<0)ai=0}
      const k=p.z+'|'+ai;t.inside.set(k,(t.inside.get(k)||0)+1);
    }
    for(const t of list){
      for(const [k,n] of t.inside){
        const [z,ai]=k.split('|').map(Number);
        const main=state.zoneEntrances?.get(z),ae=(state.areaEntrances||[]).find(x=>x.z===z&&x.area===ai);
        const poi=dungeonPoiForZone(z),ent=ae||(main&&(main.area==null||main.area===ai)?main:null)||entranceForZone(z);
        const pt=poi?{x:poi.x,y:poi.y}:ent?{x:ent.x,y:ent.y}:null;
        t.spots.push({indoors:true,z,area:ai,n,pt,name:state.zones?.get(z)?.name||('Zone '+z)});
      }
      const pts=t.e.pts;
      if(pts.length){const xs=pts.map(p=>p.x).sort((a,b)=>a-b),ys=pts.map(p=>p.y).sort((a,b)=>a-b),h=xs.length>>1;t.spots.push({indoors:false,n:pts.length,pt:{x:xs[h],y:ys[h]}})}
      const own=npcSpotOf(t.name);if(own)t.spots=[{indoors:false,n:Infinity,pt:{x:own.x,y:own.y},manual:true}];   // placed by hand: all their markers go there
      t.spots.sort((a,b)=>b.n-a.n);
      delete t.e;delete t.inside;
    }
  }
  // ---- Quest-givers: people the game marks as quest-givers (action "quest-giver"), people who ever had a quest
  // marker over their head (recorded in the quests store's "__givers" record), and whoever handed out a recorded quest.
  function questGiverList(){
    const key=[snapshot?.npcs,snapshot?.npcObservations,snapshot?.quests,state.zoneEntrances,state.areaEntrances];
    if(giverCache.key&&key.every((k,i)=>k===giverCache.key[i]))return giverCache.list;
    const quests=(snapshot?.quests||[]).filter(q=>q&&q.name),marked=((snapshot?.quests||[]).find(q=>q&&q.questId==='__givers')||{}).givers||{};
    const names=new Set();
    for(const n of snapshot?.npcs||[]){if(!n||!n.name)continue;if(n.action==='quest-giver'||marked[n.id])names.add(String(n.name).trim())}
    for(const q of quests)if(q.giverName)names.add(String(q.giverName).trim());
    const list=[],byName=new Map(),all=namedNpcs();
    for(const name of names){const e=all.get(npcSlug(name));if(!e)continue;
      const t={slug:e.slug,name:e.name,e,quests:quests.filter(q=>String(q.giverName||'').trim()===e.name).sort((a,b)=>(a.recommendedLevel||0)-(b.recommendedLevel||0))};byName.set(e.name,t);list.push(t)}
    placePeople(list,byName);
    list.sort((a,b)=>a.name.localeCompare(b.name));
    giverCache={key,list};return list;
  }
  const questHref=q=>'#/guide/quest-'+npcSlug(q.questId||q.name);
  // Areas you can only reach once a quest is done, by the game's own named regions. Ogre Isle: finishing The Ogre Traitor
  // earns "the crossing" (Gerald Seabroden's last words in that quest), so the whole island and everything on it waits.
  const QUEST_REGIONS=[{questId:'plymouth-the-ogre-traitor',questName:'The Ogre Traitor',place:'Ogre Isle',re:/^ogre isle( beach)?$/i}];
  const questRegionPolys=q=>(snapshot?.regions||[]).filter(r=>!r.z&&q.re.test(String(r.name||'').trim())).flatMap(r=>(r.polygons||[]).filter(p=>Array.isArray(p)&&p.length>=3));
  function questRegionAt(x,y){if(x==null||y==null)return null;for(const q of QUEST_REGIONS)if(questRegionPolys(q).some(p=>pointInPolygon(x,y,p)))return q;return null}
  // a page's note when (nearly) every spot of something lies in such an area
  function questRegionNote(pts,what){const inR=pts.map(p=>questRegionAt(p.x,p.y));if(!pts.length)return '';const q=inR.find(Boolean);if(!q||inR.filter(x=>x===q).length<pts.length*.9)return '';
    const quest=(snapshot?.quests||[]).find(x=>x.questId===q.questId)||{questId:q.questId,name:q.questName};
    return `<p class="q-alert-banner gg-alert" role="note"><svg class="q-alert-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20z" fill="currentColor"/><path d="M12 10v5M12 17.6v.4" stroke="#1b1300" stroke-width="2.2" stroke-linecap="round"/></svg><span>${esc(what)} on <b>${esc(q.place)}</b>, which you can only reach after finishing <a href="${questHref(quest)}">${esc(quest.name||q.questName)}</a>${quest.giverName?' ('+esc(quest.giverName)+')':''}.</span></p>`}
  globalThis.bxcQuestRegionAt=(x,y)=>{const q=questRegionAt(+x,+y);return q?{place:q.place,questId:q.questId,questName:q.questName}:null};
  document.addEventListener('click',e=>{
    const mv=e.target.closest&&e.target.closest('.npc-move'),rs=e.target.closest&&e.target.closest('.npc-reset');if(!mv&&!rs)return;e.preventDefault();
    const name=(mv||rs).dataset.name;
    if(rs){bridgeRequest('set-npc-spot',{name,clear:true}).then(syncNow).then(()=>setCollectorStatus(`Collector: ${name} is back at the recorded spot`)).catch(err=>setCollectorStatus('Collector: '+err.message));return}
    state.moveNpcArmed=name;updatePlacementCursor(true);
    mapPlacementBanner(`Click the map where <b>${esc(name)}</b> stands.`,()=>{state.moveNpcArmed=null;updatePlacementCursor(false)})});
  function drawQuestGivers(){
    if(!questGiverLayer)questGiverLayer=L.layerGroup();else questGiverLayer.clearLayers();
    // a lock over each quest-gated area: its name and the quest, at the middle of its largest outline
    for(const q of QUEST_REGIONS){const polys=questRegionPolys(q);if(!polys.length)continue;
      const big=polys.reduce((a,b)=>b.length>a.length?b:a),c={x:big.reduce((t,p)=>t+p.x,0)/big.length,y:big.reduce((t,p)=>t+p.y,0)/big.length};
      const quest=(snapshot?.quests||[]).find(x=>x.questId===q.questId)||{questId:q.questId,name:q.questName};
      const icon=L.divIcon({className:'bxc-questlock',html:`<span>🔒 ${esc(q.place)}<small>needs ${esc(quest.name||q.questName)}</small></span>`,iconSize:null,iconAnchor:[0,0]});
      const m=L.marker(latlng(c,true),{icon,zIndexOffset:400,keyboard:false});
      m.bindTooltip(`<b>${esc(q.place)}</b><br>Reached only after finishing ${esc(quest.name||q.questName)}${quest.giverName?' ('+esc(quest.giverName)+')':''}`,{direction:'top'});
      m.on('click',ev=>{if(armedPassthrough(ev))return;goRoute(questHref(quest))});
      m.addTo(questGiverLayer)}
    // one marker per person and spot (a person placed by hand has just the one)
    for(const t of questGiverList())for(const s of t.spots){if(!s.pt)continue;{
        const icon=L.divIcon({className:'bxc-questgiver',html:`<span>!</span>${t.quests.length>1?`<b class="qg-n">${t.quests.length}</b>`:''}`,iconSize:[22,22],iconAnchor:[11,11]});
        const m=L.marker(latlng(s.pt,true),{icon,zIndexOffset:520});
        m.bindTooltip(`<b>${esc(t.name)}</b>${t.quests.length?'<br>'+t.quests.map(q=>esc(q.name)).join('<br>'):'<br><span style="opacity:.8">Has quests (none recorded yet)</span>'}<br>${esc(trainerWhere(s))}`,{direction:'top'});
        m.on('click',ev=>{if(armedPassthrough(ev))return;
          if(s.indoors){if(!state.zoneArea)state.zoneArea=new Map();state.zoneArea.set(s.z,s.area);lastRenderedZoneOverlayZ=null}
          if(onMapPage())openMapPanel('npc',t.slug,{});else goRoute(pageHref('npc',t.slug))});
        m.addTo(questGiverLayer);
      }
    }
  }
  // for the Quests guide: every quest-giver, where they are and what they give
  globalThis.bxcQuestGivers=()=>questGiverList().map(t=>({slug:t.slug,name:t.name,href:pageHref('npc',t.slug),onMap:t.spots.some(x=>x.pt),where:t.spots.map(trainerWhere),quests:t.quests.map(q=>({name:q.name,href:questHref(q),level:q.recommendedLevel}))}));
  const trainerWhere=s=>s.indoors?`inside ${s.name}${s.pt?' ('+nearText(s.pt)+')':''}`:`outdoors ${s.pt?nearText(s.pt):''}`;
  const trainerImg=t=>namedNpcImgUrl('human',t.name)||monsterImg({typeId:'human',name:t.name});
  function drawTrainers(){
    if(!trainerLayer)trainerLayer=L.layerGroup();else trainerLayer.clearLayers();
    for(const t of trainerList()){
      const img=trainerImg(t);
      for(const s of t.spots){
        if(!s.pt)continue;
        const icon=L.divIcon({className:'bxc-trainer',html:`<img src="${esc(img)}" alt="">`,iconSize:[30,30],iconAnchor:[15,15]});
        const m=L.marker(latlng(s.pt,true),{icon,zIndexOffset:500});
        m.bindTooltip(`<b>${esc(t.name)}</b>${t.skill?' — teaches '+esc(t.skill):''}<br>${esc(trainerWhere(s))}`,{direction:'top'});
        m.on('click',ev=>{if(armedPassthrough(ev))return;
          if(s.indoors){if(!state.zoneArea)state.zoneArea=new Map();state.zoneArea.set(s.z,s.area);lastRenderedZoneOverlayZ=null}
          if(onMapPage())openMapPanel('npc',t.slug,{});else goRoute(pageHref('npc',t.slug))});
        m.addTo(trainerLayer);
      }
    }
  }
  // for the guides: every trainer, and (filtered there) the ones for one skill guide
  // a person's page by name (the Quests guide links its quest-givers): null when nobody by that name was recorded
  // one recorded person by id (several share a name: five Stablemasters), for a quest that names its giver's id
  globalThis.bxcNpcSpot=id=>{const n=(snapshot?.npcs||[]).find(x=>x&&x.id===id),p=n&&n.position;if(!p||!Number.isFinite(p.x))return null;return {x:p.x,y:p.y,z:p.z||0,near:p.z?null:nearText(p)}};
  globalThis.bxcNpcByName=name=>{const e=namedNpcs().get(npcSlug(name));return e?{slug:e.slug,href:pageHref('npc',e.slug),onMap:e.pts.length>0}:null};
  globalThis.bxcTrainers=()=>trainerList().map(t=>({...t,href:pageHref('npc',t.slug),img:trainerImg(t),where:t.spots.map(trainerWhere)}));
  // the named ones of a type, on the type's page
  function namedListHtml(type){
    const list=npcsOfType(type);if(!list.length)return '';
    return `<h2>Named ${type==='human'?'people':'ones'} <span class="muted" style="font-size:14px">(${list.length})</span></h2><div class="named-grid">${list.map(x=>{const lv=[...x.levels.keys()].sort((a,b)=>a-b);return `<a class="named-card" href="${pageHref('npc',x.slug)}"><img src="${esc(npcImg(x))}" alt=""><b>${esc(x.name)}</b><span>${lv.length?'Lv '+(lv.length>1?lv[0]+'–'+lv[lv.length-1]:lv[0]):''}${npcRole(x.name)?' · '+esc(npcRole(x.name)):''}</span></a>`}).join('')}</div>`;
  }
  // "Inside caves and mines" on a page: each with how many, and a button for its layout
  function caveList(caves){
    if(!caves.length)return '';
    return `<h2>Inside caves and mines</h2><ul class="wp-list">${caves.slice(0,8).map(c=>`<li><b>${esc(c.name)}</b> <span class="muted">· ${fmt(c.count)}</span> <button type="button" class="open-zone" data-zone="${esc(c.z)}">Layout</button></li>`).join('')}</ul>`;
  }
  function monsterPageHtml(id){
    const m=(D.catalog||[]).find(x=>x.typeId===id),name=m?.name||monsterNameFor(id);
    // a picked level (?lv=) sets the facts box too
    const pl=pageNow&&pageNow.kind==='monster'&&pageNow.id===id&&pageNow.lv!=null&&m?pageNow.lv:null,ls=pl!=null?monsterLevelStats(m,pl):null;
    const pts=monsterPoints(id),areas=placesFor(pts),lockNote=questRegionNote(pts,'It lives');
    const kin=m?(D.catalog||[]).filter(x=>x.family===m.family&&x.typeId!==id).sort((a,b)=>(a.baseLevel||0)-(b.baseLevel||0)):[];
    const lede=m?`A level ${esc(m.baseLevel)} ${esc(prettyId(m.family||'creature'))} that attacks with ${esc(m.attackType||'?')} (${esc(m.attackStyle||'melee')}).${m.passive?' It will not attack first.':''}`:'A creature the collector has seen.';
    return `<article class="wp"><div class="wp-main">${lockNote}<p class="wp-lede">${lede}</p>
      <h2>Fighting it</h2><div class="s">${tagChipsLine(m?.weakTo,m?.resists,m?.family)}</div>
      <p class="s muted">A weakness adds 30% damage and a resistance takes 30% off (the game's own rule).</p>
      ${m?.eliteObserved?`<p class="s good">⭐ Seen as an elite ${esc(m.eliteObserved)} times (${(m.eliteRate*100).toFixed(1)}% of sightings). Elites have 3× HP, hit 1.4× harder, give 3× XP and 2.5× loot.</p>`:''}
      ${m?.mechanics?`<p class="s">Special: ${m.mechanics}</p>`:''}
      ${monsterLevelsHtml(id,pageNow&&pageNow.kind==='monster'&&pageNow.id===id?pageNow.lv:null)}
      ${looksHtml(id,pl)}
      <h2>Drops</h2>${(typeof monsterDropsHtml==='function'&&monsterDropsHtml(id))||'<p class="muted">No drops recorded yet.</p>'}
      ${caveList(cavesFor('monster',id)).replace('Inside caves and mines','Inside dungeons and buildings')}
      <h2>Where to find it</h2>${areas.length?`<ul class="wp-list">${areas.slice(0,8).map(a=>`<li>${placeLine(a)} <span class="muted">· ${fmt(a.n)} spot${a.n===1?'':'s'}</span></li>`).join('')}</ul>${mapBtn('monster',id)}`:'<p class="muted">No sightings yet.</p>'}
      ${namedListHtml(id)}
      ${kin.length?`<h2>Related</h2><p>Other ${esc(prettyId(m.family))}: ${kin.map(k=>`<a href="${pageHref('monster',k.typeId)}">${esc(k.name)}</a> <span class="muted">(${esc(k.baseLevel)})</span>`).join(' · ')}</p>`:''}
      ${guideLinks(['combat','monster-families','monsters-by-level'])}
    </div><aside class="wp-infobox"><div class="wp-pic"><img src="${esc((pl!=null&&lookImgFor(id,pl))||monsterImg(m||{typeId:id,name}))}" alt="${esc(name)}"></div><h3>${esc(name)}</h3><table>
      ${m&&ls?infoRow('Level',`<b>${pl}</b> <span class="muted">(picked · base ${esc(m.baseLevel)})</span>`):m?infoRow('Level',esc(m.baseLevel)+(m.count?` <span class="muted">(seen ${esc(val(m.obsMinLevel))}–${esc(val(m.obsMaxLevel))})</span>`:'')):''}
      ${m?infoRow('Family',esc(prettyId(m.family))):''}${m?infoRow('Attacks',esc(m.attackType)+' · '+esc(m.attackStyle)):''}
      ${m?infoRow('Hitpoints',ls?fmt(ls.hp):esc(val(m.maxHp))):''}${m?infoRow('Damage',ls?ls.dmg:esc(val(m.attackDamage))):''}${m?infoRow('XP',ls?fmt(ls.xp):esc(val(m.xp))):''}
      ${m&&m.cooldownMs?infoRow('Attack speed',(m.cooldownMs/1000).toFixed(1)+' s'):''}${m?infoRow('Attack range',esc(val(m.attackRange))):''}
      ${m?infoRow('Aggressive',m.passive?'No':'Yes'+(m.aggroRange!=null?' ('+esc(m.aggroRange)+' tiles)':'')):''}
      ${m?infoRow('Drops gems',m.dropsGems?'Yes':'No'):''}${m&&Number(m.baseLevel)>=25?infoRow('Pendant / cape','Can drop'):''}
      ${m?infoRow('Seen',m.count?fmt(m.count)+' times':'Not yet'):''}
    </table></aside></article>`;
  }
  // ---- Market listings on an item page (the app only). The app reads the item's Exchange page with your Market
  // login (main.js marketListing) and hands back its public parts; nothing is bought, sold or changed from here.
  // Once opened, the listings load by themselves on the next item pages too (until the Atlas is closed).
  let marketAuto=false;
  const mkTable=(head,rows)=>rows.length?`<div class="g-scroll"><table class="g-table mk-table"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';
  async function loadMarket(box){
    const out=box.querySelector('.mk-out'),btn=box.querySelector('.mk-load'),slug=box.dataset.mkSlug,name=box.dataset.mkName;
    btn.disabled=true;btn.textContent='Reading the Exchange…';marketAuto=true;
    let v=null;try{v=await bridgeRequest('market-listing',{slug,name})}catch(err){v={ok:false,error:String(err&&err.message||err)}}
    if(!box.isConnected)return;
    btn.remove();
    if(!v||!v.ok){out.innerHTML=`<p class="muted">${v&&v.missing?'Not on the Exchange.':v&&v.login?'Log into binxonia.com in the Market tab first, then try again.':'The Exchange could not be read'+(v&&v.error?' ('+esc(v.error)+')':'')+'.'}</p>`;return}
    const s=v.summary||{},chip=(k,label=k)=>s[k]!=null?`<div class="mk-chip"><span>${esc(label)}</span><b>${esc(s[k])}</b></div>`:'';
    out.innerHTML=`<h2>On the Exchange</h2><div class="mk-chips">${chip('Lowest sell')}${chip('Highest buy')}${chip('Last price')}${chip('Sold in 24 hours','Sold (24 h)')}${chip('Vendors pay')}</div>
      <div class="mk-depth"><div><h3>Sell orders</h3>${mkTable(['Price each','Quantity','Orders'],v.sell||[])||'<p class="muted">Nobody is selling.</p>'}</div><div><h3>Buy orders</h3>${mkTable(['Price each','Quantity','Orders'],v.buy||[])||'<p class="muted">Nobody is buying.</p>'}</div></div>
      ${(v.trades||[]).length?`<h3>Recent trades</h3>${mkTable(v.tradeHead&&v.tradeHead.length?v.tradeHead:['Date','Quantity','Price each'],v.trades)}`:'<p class="muted">No trades yet.</p>'}
      <p><button type="button" class="mk-open">Open in the Market</button> <span class="g-note">Read just now from the Exchange with your Market login.</span></p>`;
  }
  document.addEventListener('click',e=>{
    const load=e.target.closest('.mk-load');if(load){loadMarket(load.closest('.mk-box'));return}
    const open=e.target.closest('.mk-open');if(open){const box=open.closest('.mk-box');bridgeRequest('market-open',{slug:box.dataset.mkSlug,name:box.dataset.mkName}).catch(()=>{})}
  });
  // after an item page is drawn: load the listings straight away once they have been asked for
  function autoMarket(){if(!marketAuto)return;const box=content?.querySelector('.mk-box');if(box&&box.querySelector('.mk-load'))loadMarket(box)}
  // Related items, on every item page: the same thing in other materials, what it is made from, what it goes into, and
  // for a tool the skill it is for. Item ids follow the game: "<material>-<thing>", iron tools without the material.
  const REL_MATS=['basic','iron','silver','gold','titanium','pine','oak','black-walnut','shagbark','thak','bloomguard','virikh','leather','dunehide','wraithweave','dragonhide'];
  const relBase=id=>{for(const m of REL_MATS)if(id.startsWith(m+'-'))return {base:id.slice(m.length+1),mat:m};return {base:id,mat:''}};
  function relatedHtml(id,recipe,usedIn){
    const all=new Set([...(typeof RECIPES!=='undefined'?RECIPES:[]).map(r=>r.id),...(state.items?[...state.items.keys()]:[])]);
    const {base}=relBase(id),sib=[...all].filter(x=>x!==id&&relBase(x).base===base&&(relBase(x).mat||x===base)).sort((a,b)=>REL_MATS.indexOf(relBase(a).mat)-REL_MATS.indexOf(relBase(b).mat));
    const from=(recipe&&recipe.ingredients||[]).map(i=>i.id),into=usedIn.map(x=>x.id);
    const toolFor=(globalThis.BXC_GAME_DATA?.tools?.skills||{})[base];
    const chip=x=>`<a class="rel-chip" href="${pageHref('item',x)}"><img class="q-mini" src="${esc(itemImgFor(x))}" alt="">${esc(prettyId(x))}</a>`;
    const groups=[[sib.length?'Other materials':'',sib],['Made from',from]].filter(([h,l])=>h&&l.length);
    if(!groups.length&&!toolFor)return '';
    return `<h2>Related</h2>${toolFor?`<p><b>A tool for</b> ${toolFor.map(sk=>esc(prettyId(sk))).join(', ')}${guideLinks(toolFor.map(prettyId))?'':''}. Better metal and quality raise its bonus: see the skill guide’s tool box.</p>`:''}${groups.map(([h,l])=>`<p class="rel-row"><b>${h}</b> ${[...new Set(l)].map(chip).join('')}</p>`).join('')}`;
  }
  // A spell scroll: the spell it teaches and where it drops - casters of its school (restoration: any caster), the
  // level picking the spell level 8+/18+/30+ (official guide, the game's rules, players' drop logs; magic guide)
  function scrollSpell(id){const m=/^scroll-(.+)$/.exec(id||'');return m?(globalThis.BXC_GAME_DATA?.spells||[]).find(x=>x.id===m[1])||null:null}
  function scrollDropText(sp){
    const lv={2:8,3:18,4:30}[sp.level],sc=prettyId(sp.school);
    if(!lv)return '';
    return sp.school==='restoration'?`Drops from any monster that casts spells, level ${lv}+.`:`Drops from monsters that cast ${sc} spells, level ${lv}+.`;
  }
  function scrollInfoHtml(id){
    const sp=scrollSpell(id);if(!sp)return '';
    const need=['','','5','15','25'][sp.level],sc=prettyId(sp.school);
    // quest rewards that hand out this scroll (the guide's "Unlocking schools and spells")
    const QUEST={'fire-blast':'the Fire school’s level-10 quest','ice-zap':'the Ice school’s level-10 quest','sparkbolt':'the Shock school’s level-10 quest','caustic-blast':'the Dark Witch’s Acid quest'}[sp.id];
    const drop=scrollDropText(sp);
    return `<p><b>Teaches</b> ${esc(sp.name)}, a level-${sp.level} ${esc(sc)} spell. Needs ${sp.intRequirement} Intellect${need?' and '+esc(sc)+' skill '+need:''} to learn and to cast.</p>`
      +(drop?`<p><b>${esc(drop)}</b></p><ul class="wp-list">
          <li>${sp.school==='restoration'?'Restoration scrolls come from any caster, whatever school it casts.':`A monster that casts spells drops scrolls of its own school, so look for ${esc(sc)} casters.`}</li>
          <li>The monster’s level picks the spell level: <b>8+</b> drops level-2 scrolls, <b>18+</b> level-3 and <b>30+</b> level-4.</li>
          ${QUEST?`<li>Also a reward choice from ${QUEST}.</li>`:''}</ul>`
        :`<p>Level-1 spells don’t drop from monsters: a mage starts with the first spell of their school, and the other schools’ first spells come with learning them (a level-10 quest, the Dark Witch or the Priest).</p>`);
  }
  function itemPageHtml(id){
    const r=state.items?.get(id),name=prettyId(id);
    const recipe=(typeof RECIPES!=='undefined'?RECIPES:[]).find(x=>x.id===id);
    const usedIn=(typeof RECIPES!=='undefined'?RECIPES:[]).filter(x=>(x.ingredients||[]).some(i=>i.id===id));
    const res=[...(state.resourceCatalog?.values()||[])].filter(x=>x.yieldItem===id);
    const hasSources=!!(r&&r.monsterSources.size)||res.length>0;
    const ing=rec=>(rec.ingredients||[]).map(i=>`${esc(i.quantity)}× <a href="${pageHref('item',i.id)}">${esc(prettyId(i.id))}</a>`).join(', ');
    return `<article class="wp"><div class="wp-main">
      ${(()=>{let t=r?itemSourcesText(r):'';const craft=recipe?`Crafted (${recipe.skill} Lv ${recipe.level})`:'';if(craft&&!/Crafted/.test(t))t=/not yet observed/i.test(t)||!t?craft:craft+' · '+t;if(scrollSpell(id)&&(!t||/not yet observed/i.test(t)))t=scrollDropText(scrollSpell(id))?'A spell scroll that drops from monsters.':'Not a monster drop.';return t?`<p class="wp-lede">${esc(t)}</p>`:'<p class="wp-lede muted">Not seen in the game yet.</p>'})()}
      ${PUBLIC_MODE?'':`<section class="mk-box" data-mk-slug="${esc(id)}" data-mk-name="${esc(name)}"><button type="button" class="mk-load">Market prices</button><div class="mk-out"></div></section>`}
      ${questItem(id)?`<p class="wp-quest"><b>Quest item.</b> Asked for by ${esc(questItem(id).quests.join(' / '))}.</p>`:''}
      <h2>How to get it</h2>
      ${scrollInfoHtml(id)}
      ${recipe?`<p><b>Crafted</b> with ${esc(recipe.skill)} at level ${esc(recipe.level)}${recipe.xp?` <span class="muted">(${esc(recipe.xp)} XP)</span>`:''} from ${ing(recipe)||'—'}.</p>`:''}
      ${res.length?`<p><b>Gathered</b> from ${res.map(x=>`<a href="${pageHref('resource',x.key)}">${esc(resourceDisplayName(x))}</a>`).join(', ')}.</p>`:(r&&r.gatherSkill?`<p><b>Gathered</b> with ${esc(prettyId(r.gatherSkill))}.</p>`:'')}
      ${caveList(cavesFor('item',id))}
      ${r?itemMonsterRates(r):''}
      ${hasSources||cavesFor('item',id).length?mapBtn('item',id,'Show where to get it on the map'):''}
      ${guideLinks([recipe&&recipe.skill,...res.map(x=>x.skill),r&&r.gatherSkill,...usedIn.map(x=>x.skill),/^gem-/.test(id)?'gems':null])}
      ${gearQualityHtml(id,pageNow&&pageNow.kind==='item'&&pageNow.id===id?pageNow.q:null)}
      ${gemCaratHtml(id,pageNow&&pageNow.kind==='item'&&pageNow.id===id?pageNow.q:null)}
      ${relatedHtml(id,recipe,usedIn)}
      ${usedIn.length?`<h2>Used to make</h2><ul class="wp-list">${usedIn.map(x=>`<li><a href="${pageHref('item',x.id)}">${esc(x.item)}</a> <span class="muted">· ${esc(x.skill)} ${esc(x.level)}</span></li>`).join('')}</ul>`:''}
    </div><aside class="wp-infobox"><div class="wp-pic ${gearOf(id)&&/^(weapon|staff)$/.test(gearOf(id).type)&&wEnchState(gearOf(id)).ench?'e-glow-'+wEnchState(gearOf(id)).ench+' ':''}${/^gem-/.test(id)?gemGlow(gemPick(pageNow&&pageNow.kind==='item'&&pageNow.id===id?pageNow.q:null)):typeof qualityGlow==='function'?qualityGlow(pageNow&&pageNow.kind==='item'&&pageNow.id===id?pageNow.q:null):''}"><img src="${esc(itemImgFor(id))}" alt="${esc(name)}">${hasEnchant(gearOf(id))?`<span id="gearEnchBadge" class="wp-badge">${gearEnchBadge(id)}</span>`:''}</div><h3>${esc(name)}${pageNow&&pageNow.kind==='item'&&pageNow.id===id&&pageNow.q&&pageNow.q!=='all'?(/^gem-/.test(id)?(gemPick(pageNow.q)!=null?` <span class="q-name q-${RARITY_Q[gemRar(gemPick(pageNow.q))]}">(${gemPick(pageNow.q)}c)</span>`:''):` <span class="q-name q-${esc(pageNow.q)}">(${esc(qLabel(pageNow.q))})</span>`):''}</h3><table>
      ${gearOf(id)&&gearOf(id).type==='shield'?(()=>{const g=gearOf(id),pq=pageNow&&pageNow.kind==='item'&&pageNow.id===id?pageNow.q:null,t=Q_TIERS.includes(pq)?pq:'ordinary';return `<tr><th>Defense</th><td>${esc(gearStats(g,t).main)} <span class="muted">(${esc(qLabel(t))})</span></td></tr>`})():''}
      ${hasEnchant(gearOf(id))?`<tr><th>${gearOf(id).type==='tool'?'Bonus':gearOf(id).type==='staff'?'Spells':isArmorish(gearOf(id))?'Stats':'Damage'}</th><td id="gearDmg">${gearDamageCell(id,pageNow&&pageNow.kind==='item'&&pageNow.id===id?pageNow.q:null)}</td></tr>`:''}
      ${recipe?infoRow('Made with',esc(recipe.skill)+' '+esc(recipe.level)):''}
      ${r?infoRow('Dropped by',r.monsterSources.size?fmt(new Set([...r.monsterSources.values()].map(m=>m.typeId)).size)+' monster'+(r.monsterSources.size===1?'':'s'):'—'):''}
      ${res.length?infoRow('Gathered from',res.length+' resource'+(res.length===1?'':'s')):''}
      ${usedIn.length?infoRow('Used in',usedIn.length+' recipe'+(usedIn.length===1?'':'s')):''}
      ${r&&r.lastSeen?infoRow('Last seen',esc(when(r.lastSeen))):''}
    </table></aside></article>`;
  }
  function resourcePageHtml(key){
    const r=state.resourceCatalog?.get(key);
    if(!r)return '<p class="muted">This resource has not been seen yet.</p>';
    const card=cardFromList(resourcesHtml(''),`.card[data-r="${CSS.escape(key)}"]`);
    const rpts=(state.resourceMarkersByType?.get(key)||[]).map(m=>{try{return unprojectLatLng(m.getLatLng())}catch{return null}}).filter(Boolean);
    return `<article class="wp"><div class="wp-main">${questRegionNote(rpts,'It grows')}
      <p class="wp-lede">A ${esc(prettyId(r.skill||'gathering'))} resource${r.yieldItem?` that gives <a href="${pageHref('item',r.yieldItem)}">${esc(prettyId(r.yieldItem))}</a>`:''}.</p>
      ${caveList(cavesFor('resource',key))}
      <h2>Details</h2>${card}
      ${mapBtn('resource',key)}
      ${guideLinks([r.skill])}
    </div><aside class="wp-infobox"><div class="wp-pic"><img src="${esc(resourceImg(r))}" alt=""></div><h3>${esc(resourceDisplayName(r))}</h3><table>
      ${infoRow('Skill',esc(prettyId(r.skill||'')))}${r.yieldItem?infoRow('Gives',`<a href="${pageHref('item',r.yieldItem)}">${esc(prettyId(r.yieldItem))}</a>`):''}
      ${infoRow('Spots seen',fmt(r.count+(r.manualCount||0)))}
    </table></aside></article>`;
  }
  // Reading the address: Back/Forward, a clicked link, or a link someone shared.
  function handleRoute(force){
    const h=routeNow();
    if(!force&&h===lastRoute)return;
    lastRoute=h;
    const old=/(?:^#|&)(monster|item)=([^&]+)/.exec(h);
    if(old){openPage(old[1],decodeURIComponent(old[2]),{fromRoute:true});return}
    const [hPath,hQuery]=h.split('?'),qp=new URLSearchParams(hQuery||'');
    const [a,b,c]=hPath.replace(/^#\/?/,'').split('/').map(x=>{try{return decodeURIComponent(x)}catch{return x}});
    if(!a){openTabKey('map');closeMapPanel(true);return}
    if(a==='map'){
      const mb=tabButton('map');if(mb&&!mb.classList.contains('on')){pageNow=null;clickTab(mb)}
      if(b&&c)setTimeout(()=>{map.invalidateSize({pan:false});openMapPanel(b,c,{fit:true,fromRoute:true,quality:qp.get('q'),level:qp.get('lv')})},60);else closeMapPanel(true);
      return;
    }
    if(PAGE_TAB[a]&&b){openPage(a,b,{fromRoute:true,q:qp.get('q'),lv:qp.get('lv')});return}
    if(a==='zone'&&b){openTabKey('zones');setTimeout(()=>openZoneOverlay(Number(b)),30);return}
    if(a==='xp'){openPage('guide','levels-and-xp');return}
    if(a==='gemcombine'){openTabKey('gems');setTimeout(()=>document.getElementById('g-witch')?.scrollIntoView({block:'start'}),60);return}   // the Gem combiner is now the witch section of the Gems page
    if(a==='guides'&&b&&openTabKey('guides-'+b))return;
    if(a==='guides-quests'&&qp.get('g')){openTabKey(a);const g=qp.get('g');setTimeout(()=>document.getElementById('qg-'+g)?.scrollIntoView({block:'start'}),80);return}
    if(a==='search'&&b){const box=document.getElementById('q');if(box){box.value=decodeURIComponent(b);box.dispatchEvent(new Event('input',{bubbles:true}));setTimeout(()=>box.focus(),50)}return}   // from the app's address bar   // the XP tables page is now the Levels and XP guide
    openTabKey(a);
  }
  window.addEventListener('popstate',()=>{syncNavDepth();restoringRoute=true;try{if(snapshot)handleRoute(false)}finally{restoringRoute=false}});
  // The page keeps re-laying itself out for a moment after the tab changes (tables get wrapped, monster
  // extras are added), which can leave a one-off scroll in the wrong place, so the card is brought back
  // into the middle a few times while that settles, unless you start scrolling yourself.
  let goToToken=0;
  function holdCardInView(card,token){
    let touched=false;const stop=()=>{touched=true};
    const evs=['wheel','touchstart','keydown','mousedown'];
    evs.forEach(e=>window.addEventListener(e,stop,{capture:true,once:true,passive:true}));
    for(const ms of [350,900,1800])setTimeout(()=>{if(token!==goToToken||touched||!card.isConnected)return;card.scrollIntoView({block:'center'})},ms);
    setTimeout(()=>evs.forEach(e=>window.removeEventListener(e,stop,true)),2000);
  }
  // On the World map page a marker click opens the side panel for just that thing; elsewhere it jumps to the card.
  function goToCard(tabName,attr,id,ctx){
    if(tab==='map'){const kind={monsters:'monster',resources:'resource',items:'item'}[tabName];if(kind){openMapPanel(kind,id,ctx||{});return}}
    goToCardInList(tabName,attr,id);
  }
  function goToCardInList(tabName,attr,id){
    if(q)q.value='';if(onlyObserved)onlyObserved.checked=false;
    const button=[...document.querySelectorAll('.tab')].find(b=>b.dataset.tab===tabName);if(!button)return;
    const token=++goToToken;
    button.click();
    let tries=0;
    const find=()=>{
      if(token!==goToToken)return;
      if(!tries)augmentCurrentTab();
      const card=[...content.querySelectorAll('.card')].find(c=>c.dataset[attr]===String(id));
      if(!card){
        if(++tries<10){setTimeout(find,50);return}
        // No card for it in the guide: filter the list by its name so it is at least easy to find.
        const nm=attr==='t'?monsterNameFor(String(id)):null;
        if(nm&&q){q.value=nm;q.dispatchEvent(new Event('input',{bubbles:true}))}
        return;
      }
      card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({behavior:'smooth',block:'center'});
      card.style.outline='2px solid #e6bf69';setTimeout(()=>card.style.outline='',2500);
      holdCardInView(card,token);
    };
    setTimeout(find,30);
  }

  // Monsters highlighted on the map after picking one in the guide are created by atlas-core.js;
  // wrap that so clicking them opens the guide card like every other map marker does.
  if(typeof showMonsterSelection==='function'){
    const baseShowMonsterSelection=showMonsterSelection;
    showMonsterSelection=function(type,extraMarkers,fit){
      const shown=baseShowMonsterSelection(type,extraMarkers,fit);
      selectedMonsterLayer.eachLayer(l=>l.on('click',ev=>{if(armedPassthrough(ev))return;goToMonsterCard(type)}));
      return shown;
    };
  }

  installGlobalSearch();
  addControls();loadBaseline();
  const tabsNav=document.querySelector('nav.tabs');if(tabsNav)tabsNav.addEventListener('click',e=>{if(e.target.closest('.tab'))setTimeout(augmentCurrentTab,0)});
  if(q)q.addEventListener('input',()=>setTimeout(augmentCurrentTab,0));if(onlyObserved)onlyObserved.addEventListener('change',()=>setTimeout(augmentCurrentTab,0));
  content?.addEventListener('click',e=>{
    if(tab!=='zones')return;
    const editBtn=e.target.closest('.zoneedit-btn');
    if(editBtn){state.zoneEditOpen=true;lastRenderedZoneOverlayZ=null;state.zoneArea?.set(Number(editBtn.dataset.zone),0);openZoneOverlay(Number(editBtn.dataset.zone));return;}
    const renameBtn=e.target.closest('.zonerename-btn');
    if(renameBtn){renameZone(Number(renameBtn.dataset.zone));return;}
    const linkBtn=e.target.closest('.zonelink-btn');
    if(linkBtn){linkManualZone(Number(linkBtn.dataset.zone));return;}
    const deleteBtn=e.target.closest('.zonedelete-btn');
    if(deleteBtn){deleteZone(Number(deleteBtn.dataset.zone));return;}
    const moveEntranceBtn=e.target.closest('.zonemoveentrance-btn');
    if(moveEntranceBtn){startMoveEntrance(Number(moveEntranceBtn.dataset.zone));return;}
    const associateBtn=e.target.closest('.zoneassociate-btn');
    if(associateBtn){associateZoneParent(Number(associateBtn.dataset.zone));return;}
    const disassociateBtn=e.target.closest('.zonedisassociate-btn');
    if(disassociateBtn){disassociateZoneParent(Number(disassociateBtn.dataset.zone));return;}
    const btn=e.target.closest('[data-zone]');
    // a card or button opens the place it names (the zone's own place unless it names another)
    if(btn){const bz=Number(btn.dataset.zone),ba=+btn.dataset.roomArea||0;if(!state.zoneArea)state.zoneArea=new Map();if((state.zoneArea.get(bz)||0)!==ba)lastRenderedZoneOverlayZ=null;state.zoneArea.set(bz,ba);
    openZoneOverlay(bz);return;}
    const dgn=e.target.closest('[data-dungeon]');
    if(dgn)openDungeonOverlay(dgn.dataset.dungeon);
  });
  content?.addEventListener('click',e=>{
    if(tab!=='news')return;
    if(e.target.closest('#newsRefresh')){loadNews(true);return;}
    if(e.target.closest('#newsRetry')){loadNews(true);return;}
    if(e.target.closest('#newsMarkSeen')){markNewsSeen();return;}
  });
  content?.addEventListener('click',e=>{
    if(tab!=='resources')return;
    const btn=e.target.closest('.manualres-remove');
    if(!btn)return;
    const m=(state.manualResources||[]).find(x=>x.id===btn.dataset.id);
    if(m)removeManualResource(m);
  });
  content?.addEventListener('click',e=>{
    if(tab!=='items')return;
    const monsterRow=e.target.closest('.monsterlink');
    if(monsterRow)goToMonsterCard(monsterRow.dataset.monster);
  });
  content?.addEventListener('click',e=>{
    if(tab!=='monsters')return;
    const iconLink=e.target.closest('.dropicon-link');
    if(iconLink)goToItemCard(iconLink.dataset.item);
  });
  // The "+N more" button on a chip row (a monster's drop list, an item's source-monster list) - not gated to one
  // tab since chipRowHtml() is used from both. Toggles the hidden chips in place rather than removing itself, so
  // there is always a way back to "Show less".
  content?.addEventListener('click',e=>{
    const moreBtn=e.target.closest('.chip-row-more-btn');
    if(!moreBtn)return;
    const extras=[...(moreBtn.closest('.chip-row')?.querySelectorAll('.chip-row-extra')||[])];
    const collapsed=extras.some(c=>c.hasAttribute('hidden'));
    extras.forEach(c=>collapsed?c.removeAttribute('hidden'):c.setAttribute('hidden',''));
    moreBtn.textContent=collapsed?'Show less':moreBtn.dataset.label;
  });
  content?.addEventListener('click',e=>{
    if(tab!=='drops')return;
    const iconLink=e.target.closest('.dropicon-link');
    if(iconLink){goToItemCard(iconLink.dataset.item);return;}
    const monsterRow=e.target.closest('.monsterlink');
    if(monsterRow){goToMonsterCard(monsterRow.dataset.monster);return;}
    const removeBtn=e.target.closest('.dropremove-btn');
    if(removeBtn)removeDropRow({itemTypeId:removeBtn.dataset.item,monsterTypeId:removeBtn.dataset.monster||null,resourceTypeId:removeBtn.dataset.resource||null,elite:removeBtn.dataset.elite==='1'});
  });
  content?.addEventListener('input',e=>{if(tab==='calc'&&['gLevel','gInto','gTarget','gCarat'].includes(e.target.id))setTimeout(augmentCalc,0)});
  content?.addEventListener('change',e=>{if(e.target.id==='collectorCharacter'){selectedCharacterId=e.target.value;try{localStorage.setItem(FOLLOW_KEY,selectedCharacterId)}catch{}augmentCharacter();if(tab==='calc')autoFillSkillStarts(true);return;}if(tab==='calc'&&['cSkill','cmbSkill','gSkill','enSkill'].includes(e.target.id))setTimeout(()=>{autoFillSkillStarts(true);augmentCalc()},0);else if(tab==='calc'&&['gItem','gToolMat','gQuality'].includes(e.target.id))setTimeout(augmentCalc,0)});
  // Opened from the in-game target card as atlas.html#monster=<typeId>&t=<time>: jump to that monster's
  // card, both on first load and when this tab is pointed at another monster later.
  let lastHashOpen=null;
  let routedOnce=false,routedEarly=false,touchedEarly=false;
  function openFromHash(){
    // Pages are drawn in place (nothing to scroll into view), so this works even while the window is hidden.
    // (on the website a page with a drawn-ahead file opens before the data is in: see renderPage)
    if(!snapshot){if(PUBLIC_MODE)handleRoute(false);return}
    // the first time the data is in: draw the address's page, unless it was already drawn before the data came and
    // the reader has started using it (then it is left alone - the tab's own live refresh fills in the rest)
    // the quest pages and lists are built from the data alone and have nothing to type into, so they are always
    // drawn again once it is in (they were showing "Nothing recorded yet" when drawn before it arrived)
    const here=routeNow(),dataPage=/^#\/(guide\/quests?|guide\/quest-|guides-quests|npc\/)/.test(here);
    if(!routedOnce){routedOnce=true;if(here&&(dataPage||!(routedEarly&&touchedEarly)))handleRoute(true);return}
    handleRoute(false);
  }
  // On a load or Reload panels, pages that do not need the collector's data (guides, calculators, lists) open at once
  // instead of showing the map until the data is in. Monster, item, NPC, resource, zone and map pages still wait.
  // after every Atlas script has loaded (the page layout and menus come later in the page), and only if the data has
  // not already opened it
  function routeEarly(){
    if(routedOnce)return;
    const h=routeNow(),a=h.replace(/^#\/?/,'').split(/[/?]/)[0];
    // (on the website monster, person, item and resource pages open at once from their drawn-ahead file)
    if(!a||/[=&]/.test(a)||['map','zone','search'].includes(a)||(!PUBLIC_MODE&&['monster','npc','item','resource'].includes(a)))return;
    try{handleRoute(true);routedEarly=true}catch(e){console.warn('[atlas] early route',e);lastRoute=null}
    const mark=()=>{touchedEarly=true};content?.addEventListener('input',mark,{once:true});content?.addEventListener('mousedown',mark,{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',routeEarly,{once:true});else setTimeout(routeEarly,0);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(openFromHash,150)});
  window.addEventListener('hashchange',()=>{
    // on the website an old #/... link (or one typed in) becomes its clean path in place
    if(PATH_MODE&&/^#\//.test(location.hash)){try{history.replaceState(history.state,'',routeUrl(location.hash))}catch(_){}}
    syncNavDepth();restoringRoute=true;try{openFromHash()}finally{restoringRoute=false}document.dispatchEvent(new Event('bxc-route'))});
  if(PATH_MODE){
    window.addEventListener('popstate',()=>{syncNavDepth();restoringRoute=true;try{openFromHash()}finally{restoringRoute=false}document.dispatchEvent(new Event('bxc-route'))});
    // links are written #/... ; a plain click opens the page in place, and a link shows (and copies, and opens in a
    // new tab as) its clean address from the moment the pointer or keyboard reaches it
    const toPath=a=>{const h=a.getAttribute('href');if(h&&/^#\//.test(h)){a.dataset.route=h;a.setAttribute('href',routeUrl(h))}};
    for(const ev of ['pointerover','focusin','contextmenu'])document.addEventListener(ev,e=>{const a=e.target.closest&&e.target.closest('a[href^="#/"]');if(a)toPath(a)},true);
    document.addEventListener('click',e=>{
      if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
      const a=e.target.closest&&e.target.closest('a[href]');if(!a||(a.target&&a.target!=='_self'))return;
      const raw=a.dataset.route||a.getAttribute('href');
      if(raw==='#'){e.preventDefault();return}   // a link that is really a button: never a trip to the home page
      if(/^#\//.test(raw)){e.preventDefault();goRoute(raw)}
    });
  }
  // ---- The page editor (quest steps and notes) ------------------------------------------------------------------
  // Only where editing works (the app's own copy, or the website inside the app). Steps and notes are plain text with
  // links ([[#/npc/x|Name]]), map buttons ([[map:npc:x|Name]]) and spots ([[spot:x,y|Label]]) put in by the toolbar;
  // saving sends them to the app (save-page-edit), which writes page-edits.js and publishes a minute later.
  let qeEl=null,qeState=null,qeFocus=null,qeCaret=null;   // qeCaret: the box and cursor you were last in
  // a step as the page shows it -> the editor's text: links, map buttons, spots and bold kept as their codes
  function qeTokens(el){let out='';for(const n of el.childNodes){
    if(n.nodeType===3){out+=n.nodeValue;continue}if(n.nodeType!==1)continue;
    const t=n.textContent.replace(/\s+/g,' ').trim(),clean=x=>String(x).replace(/[\[\]|]/g,'').trim();
    if(n.matches('a[href^="#/"]')){out+=`[[${n.getAttribute('href')}|${clean(t)}]]`;continue}
    if(n.matches('.show-on-map')&&n.dataset.mapKind){const k=n.dataset.mapKind,id=n.dataset.mapId||'',label=clean(t.replace(/^\u{1F4CD}\s*/u,''))||'Show on map';
      if(k==='spot'){const [x,y,l]=id.split('|');out+=`[[spot:${x},${y}|${clean(l||label)}]]`}else if(/^(npc|monster|item|resource|place|zone)$/.test(k))out+=`[[map:${k}:${id}|${label}]]`;else out+=t;continue}
    if(n.matches('.entity-chip[data-item]')){const l=n.querySelector('.entity-chip-label'),st=n.querySelector('.entity-chip-stat');out+=`[[#/item/${n.dataset.item}|${clean(l?l.textContent:t)}]]`+(st?' '+st.textContent.trim():'')+' ';continue}   // an item chip: a link
    if(n.matches('b,strong')){out+=`**${t}**`;continue}
    if(n.matches('br')){out+='\n';continue}
    out+=qeTokens(n)+(n.matches('div,td,th,p,li,dd,dt')?' ':'')}
    return out.replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').trim()}
  function qeEntries(){try{return globalSearchEntries()}catch{return []}}
  const qeMapTarget=href=>{let m=String(href||'').match(/^#\/(npc|monster|item|resource|zone)\/(.+)$/);if(m){try{return [m[1],decodeURIComponent(m[2])]}catch{return [m[1],m[2]]}}m=String(href||'').match(/^#\/map\/place\/(.+)$/);if(m){try{return ['place',decodeURIComponent(m[1])]}catch{return ['place',m[1]]}}return null};
  function qeInsert(text,into,at){if(!into&&qeCaret&&document.contains(qeCaret.ta)){into=qeCaret.ta;at=qeCaret.pos}const ta=into&&document.contains(into)?into:qeFocus&&document.contains(qeFocus)?qeFocus:qeEl?.querySelector('textarea');if(!ta)return;const a=at!=null?at:ta.selectionStart??ta.value.length,b=at!=null?at:ta.selectionEnd??a;ta.value=ta.value.slice(0,a)+text+ta.value.slice(b);ta.selectionStart=ta.selectionEnd=a+text.length;qeCaret={ta,pos:a+text.length};ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus()}
  function qeSync(){if(!qeEl||!qeState||qeState.mode)return;qeState.steps=[...qeEl.querySelectorAll('.qe-step textarea')].map(t=>t.value);qeState.notes=qeEl.querySelector('#qeNotes').value;const dn=qeEl.querySelector('#qeDone');qeState.done=dn?dn.checked:false}
  // ---- Edit page: any section of any page -----------------------------------------------------------------------
  // page-edits.js "<kind>:<id>" (a quest's page: "quest:<questId>", beside its steps) -> sections: {<section>: {top,
  // end, replace, hide}} and added: [{id, after, title, text}]. Laid over the drawn page (and the pages drawn ahead for
  // the website), so the page's own data keeps updating around your text. "_intro" is the part above the first heading.
  var pgEditing=false;   // var: the page can be drawn before this part runs
  function pgKey(kind,id){return kind==='guide'&&/^quest-/.test(id)?'quest:'+String(id).slice(6):kind+':'+id}
  function pgEntry(key){return ((globalThis.BXC_PAGE_EDITS||{}).pages||{})[key]||{}}
  function pgSlug(t){return String(t||'').toLowerCase().replace(/\(.*?\)/g,'').replace(/[0-9]+/g,'').replace(/[^a-z]+/g,'-').replace(/^-|-$/g,'')||'section'}
  function pgText(t){return '<div class="q-notes pg-text">'+(globalThis.bxcEditBlocks||globalThis.bxcEditText||esc)(t)+'</div>'}
  // a section as the editor's text: paragraphs, numbered and plain lists ("1. ", "- "), table rows as list lines
  function pgToText(nodes){const out=[],wrapOne=ch=>{const d=document.createElement('div');d.append(ch.cloneNode(true));return d};
    for(const n of nodes){if(n.nodeType===3){const t=n.nodeValue.trim();if(t)out.push(t);continue}if(n.nodeType!==1||n.matches('.pg-btn,.pg-add-row,script,style,canvas'))continue;
      if(n.matches('ol'))out.push([...n.children].filter(li=>li.tagName==='LI').map((li,i)=>(i+1)+'. '+qeTokens(li).replace(/\n+/g,' ')).join('\n'));
      else if(n.matches('ul'))out.push([...n.children].filter(li=>li.tagName==='LI').map(li=>'- '+qeTokens(li).replace(/\n+/g,' ')).join('\n'));
      else if(n.matches('table'))out.push([...n.querySelectorAll('tr')].map(tr=>'- '+[...tr.children].map(td=>qeTokens(td).replace(/\n+/g,' ')).filter(Boolean).join(' \u00b7 ')).filter(x=>x.length>2).join('\n'));
      else if(n.matches('.chip-row'))out.push([...n.querySelectorAll('.entity-chip')].map(ch=>'- '+qeTokens(wrapOne(ch)).trim()).join('\n'));
      else if(n.matches('h3,h4'))out.push('**'+n.textContent.trim()+'**');
      else if(n.matches('section,div')&&n.querySelector(':scope > p, :scope > ol, :scope > ul, :scope > table, :scope > div, :scope > h3'))out.push(pgToText([...n.childNodes]));
      else{const t=qeTokens(n);if(t)out.push(t)}}
    return out.filter(Boolean).join('\n\n')}
  // the page's own text for a section (drawn afresh, without your changes)
  function pgOriginal(kind,id,sec){
    let html='';try{html=kind==='monster'?monsterPageHtml(id):kind==='npc'?npcPageHtml(id):kind==='item'?itemPageHtml(id):kind==='guide'?(globalThis.bxcGuides?.pageHtml(id)||''):resourcePageHtml(id)}catch{}
    const box=document.createElement('div');box.innerHTML=html;const s=pgSections(box).list.find(x=>x.key===sec);if(!s)return {text:'',rich:false};
    const body=s.box?[...s.box.children].filter(n=>n!==s.h):s.nodes.slice(s.h?1:0);
    return {text:pgToText(body),rich:body.some(n=>n.matches&&(n.matches('table,img,canvas,.collector-extra')||!!n.querySelector('table,img,canvas')))}}
  function pgHeadText(h){const c=h.cloneNode(true);c.querySelectorAll('.pg-btn').forEach(b=>b.remove());return c.textContent.trim()}
  // the page's sections: each <h2> (alone, or heading a <section>) with what follows it, and the part above the first
  function pgSections(root){
    const main=root.querySelector('.wp-main')||root,list=[],intro={key:'_intro',title:'Top of the page',h:null,box:null,nodes:[]};let cur=intro;
    for(const n of [...main.children]){
      const h=n.tagName==='H2'?n:n.tagName==='SECTION'?n.querySelector(':scope > h2'):null;
      if(h){cur={key:pgSlug(h.textContent),title:h.textContent.trim(),h,box:n.tagName==='SECTION'?n:null,nodes:[n]};list.push(cur);continue}
      cur.nodes.push(n);
    }
    const seen={};for(const s of list){seen[s.key]=(seen[s.key]||0)+1;if(seen[s.key]>1)s.key+='-'+seen[s.key]}
    return {main,list:[intro,...list]};
  }
  function applyPageEdits(root,kind,id){
    const key=pgKey(kind,id),e=pgEntry(key),S=e.sections||{},added=Array.isArray(e.added)?e.added:[],ed=pgEditing&&EDIT;
    if(!ed&&!Object.keys(S).length&&!added.length)return;
    const {main,list}=pgSections(root);
    const frag=html=>{const t=document.createElement('template');t.innerHTML=html;return t.content};
    const btn=(attrs,label,cls='')=>'<button type="button" class="pg-btn '+cls+'" '+attrs+'>'+label+'</button>';
    for(const s of list){
      const x=S[s.key]||{},isIntro=!s.h;
      if(isIntro&&!s.nodes.length&&!x.top&&!x.end&&!x.replace&&!ed)continue;
      const body=s.box?[...s.box.children].filter(n=>n!==s.h):s.nodes.slice(isIntro?0:1);
      let last;   // what added sections and the "add a section" button go after
      if(x.hide){
        const ph=frag(ed?'<div class="pg-hidden">Hidden: <b>'+esc(s.title)+'</b> '+btn('data-pg="sec" data-sec="'+esc(s.key)+'" data-title="'+esc(s.title)+'"','\u270E Edit')+'</div>':'');
        const ref=s.nodes[0]||null;last=ph.lastChild;
        if(ref)ref.before(ph);else main.prepend(ph);
        s.nodes.forEach(n=>n.remove());if(!last)continue;
      }else{
        if(x.replace)body.forEach(n=>n.remove());
        const top=frag((x.replace?pgText(x.replace):'')+(x.top?pgText(x.top):'')),topLast=top.lastChild;
        if(s.h)s.h.after(top);else main.prepend(top);
        if(x.end){const endF=frag(pgText(x.end)),endN=endF.lastChild;if(s.box)s.box.append(endF);else{const after=(x.replace?null:body[body.length-1])||topLast||s.h;if(after)after.after(endF);else main.prepend(endF)}if(!s.box)last=endN}
        if(ed){const b=frag(btn('data-pg="sec" data-sec="'+esc(s.key)+'" data-title="'+esc(s.title)+'"',isIntro?'\u270E Edit the top of the page':'\u270E Edit section',isIntro?'pg-intro':''));
          if(s.h)s.h.append(b);else main.prepend(b)}
        last=s.box||last||(x.replace?null:body[body.length-1])||topLast||s.h||null;
      }
      // your own sections after this one, then (when editing) "+ Add a section here"
      let html='';
      for(const a of added.filter(a=>a.after===s.key))html+='<section class="pg-new" id="pg-'+esc(a.id)+'"><h2>'+esc(a.title||'Notes')+(ed?' '+btn('data-pg="added" data-id="'+esc(a.id)+'" data-title="'+esc(a.title||'')+'"','\u270E Edit section'):'')+'</h2>'+pgText(a.text||'')+'</section>';
      if(ed)html+='<p class="pg-add-row">'+btn('data-pg="add" data-after="'+esc(s.key)+'"','+ Add a section here','pg-add')+'</p>';
      if(html){const f=frag(html);if(last&&last.parentNode)last.after(f);else main.prepend(f)}
    }
    // sections whose place is gone: at the end
    const known=new Set(list.map(s=>s.key)),lost=added.filter(a=>!known.has(a.after));
    if(lost.length)main.append(frag(lost.map(a=>'<section class="pg-new" id="pg-'+esc(a.id)+'"><h2>'+esc(a.title||'Notes')+(ed?' '+btn('data-pg="added" data-id="'+esc(a.id)+'" data-title="'+esc(a.title||'')+'"','\u270E Edit section'):'')+'</h2>'+pgText(a.text||'')+'</section>').join('')));
    // a guide's "On this page" list follows: hidden ones out, your own in
    const toc=[...root.querySelectorAll('ol.g-toc')].find(o=>o.querySelector('[data-g-jump]'));
    if(toc){const href=toc.querySelector('a').getAttribute('href')||'';
      toc.innerHTML=[...main.querySelectorAll(':scope > section[id]')].map(s=>{const h=s.querySelector(':scope > h2');return h?'<li><a href="'+esc(href)+'" data-g-jump="'+esc(s.id)+'">'+esc(pgHeadText(h))+'</a></li>':''}).join('')}
  }
  // for the pages drawn ahead for the website
  function withPageEdits(html,kind,id){const e=pgEntry(pgKey(kind,id));if(!Object.keys(e.sections||{}).length&&!(e.added||[]).length)return html;const box=document.createElement('div');box.innerHTML=html;applyPageEdits(box,kind,id);return box.innerHTML}
  // the editor for one section (or one of your own)
  function openSectionEditor(o){
    const e=pgEntry(o.key),x=(e.sections||{})[o.sec]||{},a=o.addedId?(e.added||[]).find(y=>y.id===o.addedId):null,own=!!(a||o.after!=null);
    qeState={mode:own?'added':'section',key:o.key,sec:o.sec,addedId:o.addedId||null,after:o.after,steps:[],notes:''};
    if(!own){qeState.orig=pgOriginal(pageNow.kind,pageNow.id,o.sec);   // what the box starts with: your text if you changed it, else the page's
      qeState.start=[x.top,x.replace||qeState.orig.text,x.end].filter(t=>t&&String(t).trim()).join('\n\n')}
    if(qeEl)qeEl.remove();qeEl=document.createElement('div');qeEl.id='qEditor';qeEl.setAttribute('role','dialog');
    const head=own?(a?'Your section \u201c'+esc(a.title||'')+'\u201d':'A new section'):o.sec==='_intro'?'The top of the page':'Section \u201c'+esc(o.title||'')+'\u201d';
    qeEl.innerHTML='<div class="qe-head"><b>'+head+'</b><button type="button" data-qe="close" title="Close without saving">\u2715</button></div>'+
      '<div class="qe-tools"><button type="button" data-qe="link">Link\u2026</button><button type="button" data-qe="map">Show on map\u2026</button><button type="button" data-qe="spot">Spot on map</button><span class="muted">They go where the cursor is. **bold** for bold.</span></div>'+
      '<div id="qePick" hidden><input type="search"><div class="qe-res"></div></div>'+
      (own?'<h4>Heading</h4><input id="pgTitle" class="pg-title-in" maxlength="120" placeholder="Notes" value="'+esc(a?a.title||'':'')+'">'+
        '<h4>Text</h4><textarea id="pgText" rows="10" placeholder="Tips, where to find it, what it is good for\u2026">'+esc(a?a.text||'':'')+'</textarea>'
      :'<h4>Section text</h4><p class="muted">Change anything and the page shows your text here instead; leave it as it is and the page keeps its own (which updates with new data). A blank line starts a paragraph, lines starting \u201c1. \u201d or \u201c- \u201d make a list.'+(qeState.orig.rich?' <b>Tables and pictures here become plain text if you change it.</b>':'')+'</p>'+
        '<textarea id="pgSec" rows="14">'+esc(qeState.start)+'</textarea>'+
        '<label class="qe-done"><input type="checkbox" id="pgHide"'+(x.hide?' checked':'')+'> Hide this section</label>')+
      '<h4>Preview</h4><div id="qePreview" class="qe-preview"></div>'+
      '<div class="qe-foot"><button type="button" data-qe="save" class="qe-save">Save</button><button type="button" data-qe="close">Cancel</button>'+(a?'<button type="button" data-qe="pgdel">Delete this section</button>':'')+(own||!Object.keys(x).length?'':'<button type="button" data-qe="pgreset">Undo all my changes here</button>')+'<span id="qeMsg" class="muted"></span></div>';
    document.body.append(qeEl);qeWire();qePreview();
  }
  function pgPreview(){const f=s=>qeEl.querySelector(s),r=t=>t&&t.trim()?pgText(t):'';
    if(qeState.mode==='added'){f('#qePreview').innerHTML='<h2>'+esc(f('#pgTitle').value.trim()||'Notes')+'</h2>'+r(f('#pgText').value);return}
    const v=f('#pgSec').value,same=pgSame(v,qeState.orig.text);
    f('#qePreview').innerHTML=f('#pgHide').checked?'<p class="muted">Hidden on the page.</p>':same?'<p class="muted">(unchanged: the page\u2019s own text, kept up to date)</p>':r(v)}
  function pgSame(a,b){const n=t=>String(t||'').replace(/\s+/g,' ').trim();return n(a)===n(b)}
  // what to save: the page's whole set of section changes and own sections, with this one changed
  function pgCollect(how){const f=s=>qeEl.querySelector(s),st=qeState,e=pgEntry(st.key);
    const sections={...(e.sections||{})},added=(Array.isArray(e.added)?e.added:[]).map(y=>({...y}));
    if(st.mode==='section'){
      const txt=f('#pgSec').value.trim(),v=how==='reset'?{}:{replace:pgSame(txt,st.orig.text)?'':txt,hide:f('#pgHide').checked};
      for(const k of Object.keys(v))if(!v[k])delete v[k];
      if(Object.keys(v).length)sections[st.sec]=v;else delete sections[st.sec];
    }else{
      const title=f('#pgTitle').value.trim(),text=f('#pgText').value.trim(),i=added.findIndex(y=>y.id===st.addedId);
      if(how==='delete'||(!title&&!text)){if(i>=0)added.splice(i,1)}
      else if(i>=0)Object.assign(added[i],{title,text});
      else added.push({id:Date.now().toString(36),after:st.after,title,text});
    }
    return {sections,added};
  }
  function pgSave(b,how){const msg=qeEl.querySelector('#qeMsg'),key=qeState.key,entry=pgCollect(how);msg.textContent='Saving\u2026';b.disabled=true;
    bridgeSend('save-page-edit',{key,entry}).then(r=>{if(!r||r.ok!==true)throw new Error((r&&r.error)||'the app did not save it (it may need its latest update)');
      const E=globalThis.BXC_PAGE_EDITS||(globalThis.BXC_PAGE_EDITS={v:1,pages:{}});E.pages=E.pages||{};E.pages[key]={...(E.pages[key]||{}),...entry,updatedAt:Date.now()};
      qeEl.remove();qeEl=null;qeState=null;if(pageNow)renderPage();
      setCollectorStatus(PUBLIC_MODE?'Page saved \u2014 the website shows it after the next publish, in a few minutes':'Page saved \u2014 on the website after the next publish');
    }).catch(err=>{msg.textContent='Not saved: '+err.message;b.disabled=false})}
  // the "Edit page" switch in the top bar (only where editing works) and the section buttons it shows
  var pgBtn=EDIT?document.createElement('button'):null;
  function pgShowBtn(){if(!pgBtn)return;pgBtn.hidden=!pageNow;pgBtn.textContent=pgEditing?'Done editing':'Edit page';pgBtn.classList.toggle('on',pgEditing);document.body.classList.toggle('pg-editing',pgEditing&&!!pageNow)}
  if(pgBtn){pgBtn.id='pgEditToggle';pgBtn.type='button';pgBtn.title='Add your own text to any section of this page, replace or hide one, or add sections of your own';
    const fit=document.getElementById('fit');if(fit)fit.after(pgBtn);
    pgBtn.onclick=()=>{pgEditing=!pgEditing;pgShowBtn();if(pageNow)renderPage()};
    document.addEventListener('bxc-route',pgShowBtn);document.addEventListener('click',()=>setTimeout(pgShowBtn,0),true);pgShowBtn();
    document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('.pg-btn');if(!b||!pageNow)return;e.preventDefault();e.stopPropagation();
      const key=pgKey(pageNow.kind,pageNow.id),d=b.dataset;
      if(d.pg==='sec'&&key.startsWith('quest:')&&(d.sec==='steps'||d.sec==='notes')){openQuestEditor(key.slice(6));return}   // a quest's steps: its own editor
      if(d.pg==='sec')openSectionEditor({key,sec:d.sec,title:d.title});
      else if(d.pg==='added')openSectionEditor({key,addedId:d.id});
      else if(d.pg==='add')openSectionEditor({key,after:d.after});
    });
  }
  function qePreview(){if(!qeEl)return;if(qeState&&qeState.mode){pgPreview();return}qeSync();const r=globalThis.bxcEditText||(x=>esc(x));qeEl.querySelector('#qePreview').innerHTML=(qeState.steps.some(x=>x.trim())?'<ol class="q-steps">'+qeState.steps.filter(x=>x.trim()).map(x=>'<li>'+r(x)+'</li>').join('')+'</ol>':'')+(qeState.notes.trim()?'<div class="q-notes">'+r(qeState.notes)+'</div>':'')}
  function qeDrawSteps(){const box=qeEl.querySelector('#qeSteps');box.innerHTML=qeState.steps.map((t,i)=>`<div class="qe-step"><span class="qe-n">${i+1}.</span><textarea rows="2" placeholder="What to do">${esc(t)}</textarea><span class="qe-mv"><button type="button" data-qe="up" data-i="${i}" title="Move up">\u2191</button><button type="button" data-qe="down" data-i="${i}" title="Move down">\u2193</button><button type="button" data-qe="del" data-i="${i}" title="Remove this step">\u2715</button></span></div>`).join('');qePreview()}
  // the search for Link / Show on map: the Atlas's own search, at most 12 results
  function qePick(mode){const box=qeEl.querySelector('#qePick');box.hidden=false;box.dataset.mode=mode;const inp=box.querySelector('input');inp.value='';inp.placeholder=mode==='map'?'Find a person, monster, item, resource, place or cave to show on the map\u2026':'Find a page to link: a person, monster, item, quest, guide, place\u2026';box.querySelector('.qe-res').innerHTML='';inp.focus()}
  function qePickResults(){const box=qeEl.querySelector('#qePick'),mode=box.dataset.mode,qv=box.querySelector('input').value;let r=qv.trim()?globalSearchMatches(qeEntries(),qv):[];if(mode==='map')r=r.filter(e=>qeMapTarget(e.href));
    box.querySelector('.qe-res').innerHTML=r.slice(0,12).map((e,i)=>`<button type="button" class="qe-hit" data-i="${i}"><b>${esc(e.name)}</b> <span class="muted">${esc(e.kind)}</span></button>`).join('')||(qv.trim()?'<p class="muted">Nothing found.</p>':'');box._hits=r.slice(0,12)}
  function qeChoose(e){const box=qeEl.querySelector('#qePick'),mode=box.dataset.mode;box.hidden=true;if(!e)return;
    if(mode==='map'){const t=qeMapTarget(e.href);if(t)qeInsert(`[[map:${t[0]}:${t[1]}|${e.name}]]`)}else qeInsert(`[[${e.href}|${e.name}]]`)}
  // a spot: the map comes up, you click it, the editor comes back with the spot put in
  function qeSpot(){const into=qeCaret&&document.contains(qeCaret.ta)?qeCaret.ta:qeFocus,at=qeCaret&&qeCaret.ta===into?qeCaret.pos:into?into.selectionStart:null;   // where it goes: the box and place you were at
    const back=routeNow(),label=window.prompt('What is there? (the button\'s words)','')||'Here';if(!qeEl)return;qeSync();qeEl.hidden=true;
    goRoute('#/map');setTimeout(()=>{if(typeof map!=='undefined')map.invalidateSize({pan:false})},60);updatePlacementCursor(true);
    const done=()=>{state.editorSpotPick=null;updatePlacementCursor(false);mapPlacementBanner(null);goRoute(back);setTimeout(()=>{if(qeEl){qeEl.hidden=false}},120)};
    mapPlacementBanner(`Click the map where <b>${esc(label)}</b> is.`,done);
    state.editorSpotPick=pos=>{done();setTimeout(()=>qeInsert(`[[spot:${(Math.round(pos.x*10)/10)},${(Math.round(pos.y*10)/10)}|${label.replace(/[\[\]|]/g,'')}]]`,into,at),160)}}
  function openQuestEditor(questId){
    const q=(snapshot?.quests||[]).find(x=>x.questId===questId);if(!q)return;
    const cur=((globalThis.BXC_PAGE_EDITS||{}).pages||{})['quest:'+questId]||{};
    // what the page shows now, links and map buttons kept: the starting point for anything not written yet
    const shown=[...(content?.querySelectorAll('.q-steps > li')||[])].map(qeTokens).filter(Boolean);
    const first=String(cur.first||'').trim()?cur.first:(shown[0]||''),rest=Array.isArray(cur.steps)&&cur.steps.length?[...cur.steps]:shown.slice(1);
    qeState={questId,name:q.name,steps:[first,...rest],notes:cur.notes||'',done:!!cur.done};   // steps[0] is step 1
    if(qeEl)qeEl.remove();qeEl=document.createElement('div');qeEl.id='qEditor';qeEl.setAttribute('role','dialog');
    qeEl.innerHTML=`<div class="qe-head"><b>Edit \u201c${esc(q.name)}\u201d</b><button type="button" data-qe="close" title="Close without saving">\u2715</button></div>
      <div class="qe-tools"><button type="button" data-qe="link">Link\u2026</button><button type="button" data-qe="map">Show on map\u2026</button><button type="button" data-qe="spot">Spot on map</button><span class="muted">They go where the cursor is. **bold** for bold.</span></div>
      <div id="qePick" hidden><input type="search"><div class="qe-res"></div></div>
      <h4>Steps <span class="muted">(step 1 is taking the quest)</span></h4><div id="qeSteps"></div><button type="button" data-qe="add">+ Add a step</button>
      <h4>Notes</h4><textarea id="qeNotes" rows="4" placeholder="Tips, warnings, anything else">${esc(qeState.notes)}</textarea>
      <label class="qe-done"><input type="checkbox" id="qeDone"${qeState.done?' checked':''}> The steps are complete (takes off \u201cnot fully written yet\u201d)</label>
      <h4>Preview</h4><div id="qePreview" class="qe-preview"></div>
      <div class="qe-foot"><button type="button" data-qe="save" class="qe-save">Save</button><button type="button" data-qe="close">Cancel</button><span id="qeMsg" class="muted"></span></div>`;
    document.body.append(qeEl);qeDrawSteps();qeWire();
  }
  function qeWire(){
    qeEl.addEventListener('focusin',e=>{if(e.target.matches('textarea'))qeFocus=e.target});
    for(const ev of ['click','keyup','select','input'])qeEl.addEventListener(ev,e=>{if(e.target.matches&&e.target.matches('textarea')){qeFocus=e.target;qeCaret={ta:e.target,pos:e.target.selectionStart}}});
    qeEl.addEventListener('input',e=>{if(e.target.closest('#qePick'))qePickResults();else qePreview()});
    qeEl.addEventListener('keydown',e=>{if(e.key==='Escape'&&!qeEl.querySelector('#qePick').hidden){e.stopPropagation();qeEl.querySelector('#qePick').hidden=true}});
    qeEl.addEventListener('click',e=>{const hit=e.target.closest('.qe-hit');if(hit){qeChoose(qeEl.querySelector('#qePick')._hits[+hit.dataset.i]);return}
      const b=e.target.closest('[data-qe]');if(!b)return;const a=b.dataset.qe,i=+b.dataset.i;
      if(a==='close'){qeEl.remove();qeEl=null;qeState=null;return}
      if(a==='add'){qeSync();qeState.steps.push('');qeDrawSteps();qeEl.querySelectorAll('.qe-step textarea')[qeState.steps.length-1]?.focus();return}
      if(a==='up'||a==='down'||a==='del'){qeSync();const s=qeState.steps;if(a==='del')s.splice(i,1);else{const j=a==='up'?i-1:i+1;if(j<0||j>=s.length)return;[s[i],s[j]]=[s[j],s[i]]}if(!s.length)s.push('');qeDrawSteps();return}
      if(a==='link'||a==='map'){qePick(a);return}
      if(a==='spot'){qeSpot();return}
      if(qeState.mode&&(a==='save'||a==='pgdel'||a==='pgreset')){pgSave(b,a==='pgdel'?'delete':a==='pgreset'?'reset':'');return}
      if(a==='save'){qeSync();const msg=qeEl.querySelector('#qeMsg');msg.textContent='Saving\u2026';b.disabled=true;
        const [first,...rest]=qeState.steps.map(x=>x.trim());
        const key='quest:'+qeState.questId,entry={first:first||'',steps:rest.filter(Boolean),notes:qeState.notes.trim(),done:qeState.done};
        bridgeSend('save-page-edit',{key,entry}).then(r=>{if(!r||r.ok!==true)throw new Error((r&&r.error)||'the app did not save it (it may need its latest update)');
          const E=globalThis.BXC_PAGE_EDITS||(globalThis.BXC_PAGE_EDITS={v:1,pages:{}});E.pages=E.pages||{};E.pages[key]={...(E.pages[key]||{}),...entry,updatedAt:Date.now()};
          qeEl.remove();qeEl=null;qeState=null;if(pageNow)renderPage();
          setCollectorStatus(PUBLIC_MODE?'Page saved \u2014 the website shows it after the next publish, in a few minutes':'Page saved \u2014 on the website after the next publish');
        }).catch(err=>{msg.textContent='Not saved: '+err.message;b.disabled=false})}
    });
  }
  if(EDIT)document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('.q-edit-btn');if(!b)return;e.preventDefault();openQuestEditor(b.dataset.questId)});
  // ---- Pages for the website, drawn ahead of time ------------------------------------------------------------
  // The app's publish runs the website's Atlas over the full published data in a hidden window and calls this: it
  // draws every monster, person, item, resource and quest page (and each level / quality / carat a page can be
  // switched to) exactly as a visitor would see it, plus the search list, so the website can load just the page
  // that is opened instead of the whole database. Pages are drawn in small batches so the window stays responsive.
  // lookup tables (Map, Set) in saved JSON and back, exactly
  const listReplacer=(k,v)=>v instanceof Map?{__m:[...v]}:v instanceof Set?{__s:[...v]}:v;
  const listReviver=(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?(Array.isArray(v.__m)?new Map(v.__m):Array.isArray(v.__s)?new Set(v.__s):v):v;
  // a page's file name part: the id with its % escapes as ! ("a::b" -> "a!3A!3Ab"), the same here and when publishing
  function pageFileId(x){return encodeURIComponent(String(x)).replace(/%/g,'!')}
  globalThis.bxcExportPages=async function(){
    if(!snapshot)throw new Error('no data loaded');
    if(liveStale)deriveLive();
    const pages={},keep=pageNow,yieldNow=()=>new Promise(r=>setTimeout(r,0));let n=0;
    const draw=async(path,kind,id,fn,opts={})=>{
      pageNow={kind,id:String(id),q:opts.q||null,lv:opts.lv!=null?Number(opts.lv):null};
      try{const html=fn(id);if(html)pages[path]={title:pageTitle(kind,id),html:withPageEdits(html,kind,id)}}catch(e){console.warn('[export]',path,e)}
      if(++n%25===0)await yieldNow();
    };
    const enc=pageFileId;
    for(const m of D.catalog||[]){if(!m||!m.typeId)continue;
      await draw('monster/'+enc(m.typeId),'monster',m.typeId,monsterPageHtml);
      for(const l of monsterLevelsSeen(m.typeId))await draw('monster/'+enc(m.typeId)+'~lv'+l.level,'monster',m.typeId,monsterPageHtml,{lv:l.level});
    }
    for(const slug of namedNpcs().keys())await draw('npc/'+enc(slug),'npc',slug,npcPageHtml);
    const items=new Set([...(state.items?.keys()||[]),...(typeof RECIPES!=='undefined'?RECIPES:[]).map(r=>r.id)]);
    for(const id of items){if(!id)continue;
      await draw('item/'+enc(id),'item',id,itemPageHtml);
      const variants=gearOf(id)?Q_TIERS:/^gem-/.test(id)?[...new Set((snapshot.gems||[]).filter(g=>g.typeId===id&&Number.isFinite(+g.carat)).map(g=>String(+g.carat)))]:[];
      for(const q of variants)await draw('item/'+enc(id)+'~q'+enc(q),'item',id,itemPageHtml,{q});
    }
    for(const key of state.resourceCatalog?.keys()||[])await draw('resource/'+enc(key),'resource',key,resourcePageHtml);
    for(const qst of snapshot.quests||[]){if(!qst||!qst.name||!qst.questId||String(qst.questId).startsWith('__'))continue;
      const id='quest-'+npcSlug(qst.questId);await draw('guide/'+enc(id),'guide',id,x=>globalThis.bxcGuides?.pageHtml(x)||'');
    }
    // the side panel of everything the map can show (monster, resource, item, person, cave or building, place)
    const panels={};let pn=0;
    const panel=async(kind,id)=>{try{const html=panelHtml(kind,String(id),{});if(html)panels[kind+'/'+enc(id)]={html}}catch(e){console.warn('[export] panel',kind,id,e)}if(++pn%40===0)await yieldNow()};
    for(const m of D.catalog||[])if(m&&m.typeId)await panel('monster',m.typeId);
    for(const key of state.resourceCatalog?.keys()||[])await panel('resource',key);
    for(const id of items)if(id)await panel('item',id);
    for(const slug of namedNpcs().keys())await panel('npc',slug);
    for(const z of state.zoneEntrances?.keys()||[])await panel('zone',String(z));
    for(const p of D.pois||[])if(p&&p.name)await panel('place',p.name);
    pageNow=keep;
    // the map's own data, slimmed to what drawing it reads: monsters (kind, name, level, elite, last seen, where they
    // were and their spawn point; a named one's id and class too), resources (kind, name, place, status, fish),
    // and the caves' and buildings' names, entrances and the resources inside them (for their entrance icons)
    const typeIx=new Map(),npcTypes=[];
    const tIx=(t,n)=>{const k=t+'\u0000'+(n||'');if(!typeIx.has(k)){typeIx.set(k,npcTypes.length);npcTypes.push([t,n||null])}return typeIx.get(k)};
    const r1=v=>Number.isFinite(v)?Math.round(v*10)/10:null;
    const typeName=new Map((D.catalog||[]).map(m=>[m.typeId,String(m.name||'').toLowerCase()]));
    const npcs=[];
    for(const n of snapshot.npcs||[]){const p=n.position;if(!p||!Number.isFinite(p.x))continue;const o=n.originPosition;
      if(p.z&&!o)continue;   // only seen inside a cave or building, with no spawn point: the world map never shows it
      const nm=String(n.name||'').trim(),named=nm&&nm.toLowerCase()!==(typeName.get(n.typeId)||String(n.typeId).replace(/-/g,' '));
      npcs.push([tIx(n.typeId,n.name),named?n.id:0,Number.isFinite(n.level)?n.level:null,n.elite?1:0,Math.round((n.lastSeen||0)/1000),r1(p.x),r1(p.y),p.z||0,o?r1(o.x):null,o?r1(o.y):null,o?o.z||0:null,named&&n.npcClass?n.npcClass:0]);
    }
    const objects=[];
    for(const o of snapshot.worldObjects||[]){const p=o.position;if(!p||!Number.isFinite(p.x)||!state.objectSkillByType?.get(o.typeId))continue;   // (inside caves too: the resource list and legend count them)
      objects.push([o.typeId,o.name||null,p.x,p.y,o.status||null,o.data?.fishTypes?.length?o.data.fishTypes:0,p.z||0,Math.round((o.lastSeen||0)/1000),Math.round((o.firstSeen||0)/1000)]);   // (seen times: the resource list is sorted by them)
    }
    const zones=[...(state.zones?.values()||[])].map(z=>({z:z.z,name:z.name||null,pvpMode:z.pvpMode??null,synthetic:!!z.synthetic}));
    const entrances=[...(state.zoneEntrances||[])].map(([z,e])=>[z,{x:e.x,y:e.y}]);
    const contents=[...(state.zoneContents||[])].map(([z,c])=>[z,[...(c.objects||new Map())].map(([k,v])=>[k,{count:v.count,yieldItem:v.yieldItem||null,name:v.name||null}])]).filter(x=>x[1].length);
    const spot=x=>({pt:x.pt?{x:x.pt.x,y:x.pt.y}:null,indoors:!!x.indoors,z:x.z??0,area:x.area??0,n:x.n??0,name:x.name||null});
    const givers=questGiverList().map(t=>({slug:t.slug,name:t.name,quests:t.quests.map(q=>({questId:q.questId,name:q.name,recommendedLevel:q.recommendedLevel??null})),spots:t.spots.map(spot)}));
    const trainers=trainerList().map(t=>({slug:t.slug,name:t.name,skill:t.skill||null,guide:t.guide||null,spots:t.spots.map(spot)}));   // (guide: which guide lists them)
    // the home page's two counts that come from stores the lite start does not load (kinds of item, gems found)
    const home={items:new Set([...(typeof RECIPES!=='undefined'?RECIPES:[]).map(r=>r.id),...(snapshot.inventoryTypes||[]).map(x=>x.typeId||x.id)].filter(Boolean)).size,gems:(snapshot.gems||[]).length};
    const mapData={v:1,npcTypes,npcs,objects,zones,entrances,contents,givers,trainers,home};
    // every cave and building: its floor, objects, sightings and people, every crossing between places, and the rooms,
    // exits and contents worked out from them - what drawing a layout reads (loaded the first time one is opened)
    const inside=r=>r&&r.position&&r.position.z;
    const entries=mp=>[...(mp||new Map())].map(([k,v])=>[k,v]);
    const contentsAll=[...(state.zoneContents||[])].map(([z,c])=>[z,{monsters:entries(c.monsters),objects:entries(c.objects)}]);
    const zonesData={v:1,terrain:(snapshot.terrain||[]).filter(r=>r.z),worldObjects:(snapshot.worldObjects||[]).filter(inside).map(o=>{const d=o.data&&(o.data.quantity!=null||o.data.fishTypes)?{quantity:o.data.quantity,fishTypes:o.data.fishTypes}:undefined;return {id:o.id,typeId:o.typeId,name:o.name,position:o.position,status:o.status,firstSeen:o.firstSeen,lastSeen:o.lastSeen,data:d}}),
      npcObservations:(snapshot.npcObservations||[]).filter(inside),npcs:(snapshot.npcs||[]).filter(inside),zoneTransitions:snapshot.zoneTransitions||[],
      state:{dungeons:entries(state.dungeons),dungeonOfZone:entries(state.dungeonOfZone),zoneParent:entries(state.zoneParent),zoneInternalExits:entries(state.zoneInternalExits),zoneSurfaceExits:entries(state.zoneSurfaceExits),zoneContents:contentsAll}};
    // the search list: what the search box finds, with each result's address (and its picture when it has a file)
    const search=globalSearchEntries().map(e=>{let img=null;try{const u=e.image&&e.image();if(typeof u==='string'&&/^data\/img\//.test(u))img=u}catch{}return [e.kind,e.name,e.detail||'',e.href,img]});
    // the section lists (Bestiary, Items, Resources, Gems): the monster list with its counts and levels, every drop
    // and loot total, items with where they come from, gems, and the two small stores they also read
    const listsData=JSON.stringify({v:1,catalog:D.catalog||[],monsterNames:[...(state.monster||new Map())].map(([t,r])=>[t,{typeId:t,name:r.name}]),
      dropAgg:state.dropAgg,looted:state.looted,kills:state.kills,items:state.items,gems:state.gems,gemByType:state.gemByType,
      raw:{gems:snapshot.gems||[],inventoryTypes:snapshot.inventoryTypes||[]}},listReplacer);
    return {pages,panels,map:mapData,zones:zonesData,lists:listsData,search,builtAt:snapshot.generatedAt||null};
  };
  if(PUBLIC_MODE){
    // One fetch, once, ever - no live collector to re-sync with or poll. applySnapshot() itself already calls
    // openFromHash once the data's in, same as the live path below.
    setCollectorStatus('Loading…');
    // the snapshot lists its big stores as separate files (data/snap/<store>.json); they are fetched side by side.
    // A part may come as a table ({cols, rows}: one array per record, terrain does) - turned back into records here.
    const partRows=p=>Array.isArray(p)?p:p&&Array.isArray(p.cols)&&Array.isArray(p.rows)?p.rows.map(r=>{const o={};for(let i=0;i<p.cols.length;i++)o[p.cols[i]]=r[i];return o}):[];
    // the whole database: every store; once, shared by everything that asks for it
    let fullLoad=null;
    const loadFull=()=>fullLoad||(fullLoad=fetch('data/snapshot.json').then(r=>r.json()).then(async s=>{
      if(Array.isArray(s.parts))await Promise.all(s.parts.map(async k=>{const p=s[k]&&s[k].part;s[k]=p?partRows(await fetch('data/'+p).then(r=>r.json())):[]}));
      return s}).then(s=>{applySnapshot(s);globalThis.bxcDataReady=true}).catch(err=>{fullLoad=null;setCollectorStatus('Could not load data: '+err.message);throw err}));
    globalThis.bxcEnsureFull=()=>isFull()?Promise.resolve():loadFull();
    // lite: the base file, the pictures list, the map's slim data and the search list
    const loadLite=()=>Promise.all([fetch('data/snapshot.json').then(r=>r.json()),fetch('data/map.json').then(r=>{if(!r.ok)throw new Error('no map data yet');return r.json()}),fetch('data/search.json').then(r=>r.ok?r.json():[]).catch(()=>[])])
      .then(async([s,m,found])=>{
        s.assets=s.assets&&s.assets.part?partRows(await fetch('data/'+s.assets.part).then(r=>r.json())):Array.isArray(s.assets)?s.assets:[];
        liteSearch=(found||[]).map(([kind,name,detail,href,img])=>({kind,name,detail,href,lite:true,image:img?()=>img:null}));
        applyLite(s,m);
      }).catch(err=>{console.warn('[atlas] lite start failed - loading everything',err);return loadFull()});
    if(LITE)loadLite();else loadFull();
  }else{
    syncNow().then(openFromHash);setInterval(fullSyncIfNeeded,600000);
    syncBossTimers();
  }
})();
