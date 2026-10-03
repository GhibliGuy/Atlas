// Splash / start page for the Atlas (public site and the app's own Atlas): a welcome screen with a search box and one
// tile per section, shown when the Atlas opens (not when a link points straight at a monster or item, e.g. from the
// in-game target card). It is only an overlay: the Atlas and its live collector data keep running underneath. "Home" in the masthead
// brings it back. Everything below it is the normal Atlas, already loaded - the splash only chooses where to start.
(function(){
  // In the app the page shares the game's GPU process, so the map backdrop doesn't keep drifting there (CSS .splash-app).
  const IN_APP=!window.BXC_PUBLIC;
  const SKIP_KEY='bxcSplashSkip';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const get=k=>{try{return localStorage.getItem(k)}catch{return null}};
  const put=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch{}};
  const count=a=>Array.isArray(a)?a.length:0;
  // [tab selector, title, one line, group, icon (a game item id)]
  const TILES=[
    ['[data-tab="guides"]','Guides','Skills, combat, gear and the world, filled from the game’s own data','Start here','guides'],
    ['map','World map',d=>count(d.pois)?count(d.pois)+' places, every creature and resource we have seen':'Every place, creature and resource we have seen','Start here','map'],
    ['[data-tab="monsters"]','Bestiary',d=>count(d.catalog)?count(d.catalog)+' creatures - levels, weaknesses, drops and where they roam':'Creatures, their weaknesses, drops and where they roam','Explore','monsters'],
    ['[data-tab="items"]','Items','What every item is, its qualities, enchants and where it comes from','Explore','items'],
    ['[data-tab="zones"]','Zones & caves','Dungeons, mines and buildings, mapped from the inside','Explore','zones'],
    ['[data-tab="resources"]','Resources','Ore, trees, fishing spots and herbs on the map','Gathering','resources'],
    ['[data-tab="gems"]','Gems','Where each gem comes from, what each carat does, and building bigger ones','Gathering','gems'],
    ['[data-calc="crafting"]','Crafting XP','Your training path, tools and upgrades for every trade','Calculators','crafting'],
    ['[data-calc="combat"]','Combat calculator','The best monster and gear for your level, and when to move on','Calculators','combat'],
    ['[data-calc="quality"]','Quality & enchanting','Can you make it, enchant it, and what quality to expect','Calculators','quality'],
    ['[data-tab="guide"]','Write a guide','Share what you know with other players','Community','guide']
  ];
  const GROUPS=['Start here','Explore','Gathering','Calculators','Community'];
  // Each tile's picture: one of these real game pictures, picked afresh every time the page opens. Only pictures the
  // Atlas has recorded from the game are used; with none available the tile simply has no picture (no placeholder).
  const TI=['sword','longsword','scimitar','rapier','dagger','kryss','mace','warmace','spear','battlespear','axe'].map(w=>'titanium-'+w);
  const TA=['head','torso','arms','legs','feet','shield'].map(p=>'titanium-'+p);
  const GEMS=['amber','diamond','emerald','iolite','onyx','pearl','ruby','sapphire','topaz'].map(g=>'gem-'+g);
  const ICONS={
    guides:{hint:'item',ids:()=>['sword','dagger','bow','crossbow','mace','spear'].map(k=>'tome-'+k).concat(['tome-weaponsmithing-titanium','tome-armorsmithing-titanium','tome-toolsmithing-titanium','tome-bowyer-shagbark','tome-tailoring-dragonscale','tome-leatherworking-dragonhide','bandit-tally-book'])},
    map:{hint:'item',ids:()=>['plymouth-tide-charts','warp-appleseed-farm','warp-binxonia-mage-tower','warp-mirewick','warp-plymouth-wharf','warp-underleaf','warp-wispmeyer']},
    monsters:{hint:'monster',ids:()=>['red-dragon','young-red-dragon','baby-red-dragon','sand-wyrm','sand-wyrmling']},
    items:{hint:'item',ids:()=>TI.concat(TA)},
    zones:{hint:'item',ids:()=>['key-buried-treasure-1','key-orc-champion']},
    resources:{hint:'item',ids:()=>['bass','catfish','salmon','trout']},
    gems:{hint:'item',ids:()=>GEMS},
    gemcombine:{hint:'item',ids:()=>GEMS},
    crafting:{hint:'item',ids:()=>[...new Set((typeof RECIPES!=='undefined'?RECIPES:[]).map(r=>r.id))].filter(id=>{const gi=typeof globalThis.bxcGearInfo==='function'?globalThis.bxcGearInfo(id):null;return gi&&gi.glows&&gi.enchants.length})},
    combat:{hint:'item',ids:()=>['iron','silver','gold','titanium'].flatMap(m=>['sword','longsword','scimitar','rapier'].map(w=>m+'-'+w))},
    quality:{hint:'item',ids:()=>TI.concat(TA)},
    guide:{hint:'item',ids:()=>['scribing-quill','silver-scribing-quill','gold-scribing-quill','titanium-scribing-quill']}
  };
  // the pictures shown last time, drawn straight away while the Atlas data is still loading
  const ICON_KEY='bxcSplashIcons';let iconCache={};try{iconCache=JSON.parse(localStorage.getItem(ICON_KEY)||'{}')||{}}catch(_){iconCache={}}
  function cachedIcons(){if(!el)return;for(const img of el.querySelectorAll('img[data-ico]')){const c=iconCache[img.dataset.ico];if(c&&c.url&&!img.src){img.src=c.url;img.dataset.id=c.id;img.title=String(c.id||'').replace(/-/g,' ');img.hidden=false;dress(img,DRESS.has(img.dataset.ico)?(c.look||gearLook(c.id)):null)}}}
  // a gear picture on the Home page is shown at its best: flawless, and (weapons and armor) with an enchant it can take
  // the tiles that show gear at its best (the rest - books, maps, keys, fish, gems, the quill - stay as they are)
  const DRESS=new Set(['items','crafting','combat','quality']);
  function gearLook(id){const gi=typeof globalThis.bxcGearInfo==='function'?globalThis.bxcGearInfo(id):null;if(!gi)return null;
    const Q=[['good',30],['excellent',30],['superior',25],['flawless',15]],tot=Q.reduce((a,x)=>a+x[1],0);let r=Math.random()*tot,q='good';for(const [k,w] of Q){if((r-=w)<0){q=k;break}}
    const e=gi.glows&&gi.enchants.length&&Math.random()<.95?gi.enchants[Math.floor(Math.random()*gi.enchants.length)]:'';return {q,e}}
  function dress(img,look){img.dataset.dressed="1";const wrap=img.parentElement;img.classList.remove('q-glow-good','q-glow-excellent','q-glow-superior','q-glow-flawless');if(wrap)wrap.className='splash-ico-wrap';
    if(!look)return;img.classList.add('q-glow-'+look.q);if(look.e&&wrap)wrap.classList.add('e-glow-'+look.e);
    img.title=(img.title||'')+(look.q?' · '+look.q:'')+(look.e?' · '+look.e:'')}
  // A tile keeps the picture (and its quality and enchant) it shows for as long as the page is open. Each opening
  // picks afresh when the data is there; when it is not yet (the app just started), the remembered pictures show,
  // and fresh picks are made quietly for the next opening instead of swapping them in front of you.
  const dataReady=()=>typeof globalThis.bxcAssetImg==='function'&&ICONS.combat.ids().some(id=>globalThis.bxcAssetImg(id,'item'));
  let pickedThisOpen=false,savedNext=false;
  function pick(ico,used){const spec=ICONS[ico];if(!spec)return null;
    const have=spec.ids().filter(id=>!used.has(id)&&globalThis.bxcAssetImg(id,spec.hint));if(!have.length)return null;
    const id=have[Math.floor(Math.random()*have.length)];used.add(id);return {id,url:globalThis.bxcAssetImg(id,spec.hint),look:DRESS.has(ico)?gearLook(id):null}}
  function show(img,p){img.dataset.id=p.id;img.src=p.url;img.title=p.id.replace(/-/g,' ');img.hidden=false;dress(img,p.look)}
  function saveCache(){try{const txt=JSON.stringify(iconCache);if(txt.length<900000)localStorage.setItem(ICON_KEY,txt)}catch(_){}}
  function fillIcons(reroll){
    if(!el||!dataReady())return;
    const imgs=[...el.querySelectorAll('img[data-ico]')];
    if(reroll&&!pickedThisOpen){   // an opening with the data there: fresh picks, shown straight away
      const used=new Set();for(const img of imgs){const p=pick(img.dataset.ico,used);if(p){show(img,p);iconCache[img.dataset.ico]=p}else if(!img.src)img.hidden=true}
      pickedThisOpen=true;saveCache();return}
    // the data arrived after the page opened: fill any empty tile, and make next time's picks without touching what shows
    const used=new Set(imgs.filter(i=>!i.hidden).map(i=>i.dataset.id));
    for(const img of imgs)if(img.hidden||!img.src){const p=pick(img.dataset.ico,used);if(p){show(img,p);iconCache[img.dataset.ico]=p}}
    if(!savedNext){const next=new Set();for(const img of imgs){const p=pick(img.dataset.ico,next);if(p)iconCache[img.dataset.ico]=p}savedNext=true;saveCache()}
  }
  // an item's picture (the game's own icon where the Atlas has it)
  const icon=id=>{try{return id&&typeof itemImg==='function'?itemImg({id,typeId:id,item:id.replace(/-/g,' ')}):''}catch{return ''}};
  // A creature of the day, the same for everyone on a given day: its picture, level, hit points and weaknesses
  function featured(){
    const real=m=>typeof globalThis.bxcAssetImg==='function'&&globalThis.bxcAssetImg(m.typeId,'monster');
    const cat=(typeof D!=='undefined'&&D.catalog||[]).filter(m=>m&&m.name&&m.baseLevel&&!m.passive&&m.family!=='human'&&m.maxHp&&real(m));
    if(!cat.length)return null;
    const day=Math.floor(Date.now()/864e5);return cat[(day*2654435761>>>0)%cat.length];
  }
  function featuredHtml(){
    const m=featured();if(!m)return '';
    const img=globalThis.bxcAssetImg(m.typeId,'monster')||'';
    const list=v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
    const chips=(l,cls,pre)=>l.map(x=>`<span class="tag-chip ${cls}">${pre} ${esc(x)}</span>`).join('');
    return `<section class="splash-feature" aria-label="Creature of the day"><div class="splash-feature-pic">${img?`<img src="${esc(img)}" alt="">`:''}</div>
      <div class="splash-feature-body"><p class="splash-kicker">Creature of the day</p><h2>${esc(m.name)}</h2>
      <p class="splash-feature-facts">Level <b>${esc(m.baseLevel)}</b> · <b>${Number(m.maxHp).toLocaleString()}</b> hit points${m.xp?` · <b>${Number(m.xp).toLocaleString()}</b> XP a kill`:''}${m.family?` · ${esc(String(m.family).replace(/-/g,' '))}`:''}</p>
      <p>${chips(list(m.weakTo),'weak','weak to')}${chips(list(m.resists),'resist','resists')}</p>
      <button type="button" class="splash-feature-go" data-monster="${esc(m.typeId)}">See where it lives</button></div></section>`;
  }
  // the numbers under the search box (what the Atlas knows right now)
  function statsHtml(){
    const d=typeof D!=='undefined'?D:{},S=globalThis.BINXONIA_COLLECTOR_SNAPSHOT||{};
    const items=new Set([...(typeof RECIPES!=='undefined'?RECIPES:[]).map(r=>r.id),...(S.inventoryTypes||[]).map(x=>x.typeId||x.id)].filter(Boolean)).size;
    const n=[[count(d.catalog),'creatures'],[items,'items'],[typeof RECIPES!=='undefined'?RECIPES.length:0,'recipes'],[count(d.pois),'places'],[count(S.gems),'gems found']].filter(x=>x[0]>0);
    return n.map(([v,l])=>`<div><b>${v.toLocaleString()}</b><span>${l}</span></div>`).join('');
  }
  // a first handful of guides for someone new
  const STARTER=[['getting-started','Getting started'],['levels-and-xp','Levels and XP'],['combat','Combat'],['mining','Mining'],['quality-and-enchanting','Quality & enchanting'],['travel','Travel']];
  let el=null,lastFocus=null;
  function tabFor(sel){return document.querySelector('.tab'+(sel==='map'?'[data-tab="map"]':sel))}
  function build(){
    el=document.createElement('div');el.id='atlasSplash';if(IN_APP)el.className='splash-app';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','splashTitle');
    let k=0;const fm=featured();
    const tile=t=>{
      return `<button type="button" class="splash-tile" data-i="${TILES.indexOf(t)}" style="--i:${k++}"><span class="splash-ico-wrap"><img class="splash-tile-ico" data-ico="${esc(t[4]||'')}" alt="" hidden></span><span class="splash-tile-words"><b>${esc(t[1])}</b><span class="splash-tile-text">${esc(typeof t[2]==='function'?t[2](typeof D!=='undefined'?D:{}):t[2])}</span></span></button>`};
    const tiles=GROUPS.map(g=>{const ts=TILES.filter(t=>t[3]===g&&tabFor(t[0]));return ts.length?`<section class="splash-group"><h2>${esc(g)}</h2><div class="splash-grid">${ts.map(tile).join('')}</div></section>`:''}).join('');
    const starters=STARTER.map(([slug,t])=>`<a class="q-chip" href="#/guide/${slug}">${esc(t)}</a>`).join('');
    const lead=`<span class="splash-new-lead"><b>New to Binxonia?</b><span class="splash-arrow" aria-hidden="true">➜</span></span>`;
    el.innerHTML=`<div class="splash-backdrop" aria-hidden="true"></div><div class="splash-inner">
      <header class="splash-head"><p class="splash-kicker">A field guide to the living world</p><h1 id="splashTitle">Binxonia Atlas</h1>
      <p class="splash-lede">Creatures, items, resources and places of Binxonia, mapped from what players have seen in the game.</p></header>
      <form class="splash-search" role="search"><input type="search" id="splashQ" aria-label="Search the atlas" placeholder="Search a monster, item, resource or zone..." autocomplete="off"><button type="submit">Search</button></form>
      <p class="splash-hint">Try <i>ogre</i>, <i>titanium</i>, <i>salmon</i>, or a weakness like <i>crush</i>.</p>
      <div class="splash-stats">${statsHtml()}</div>
      <div class="splash-new">${lead}${starters}</div>
      ${featuredHtml()}
      ${tiles}
      <footer class="splash-foot"><button type="button" class="splash-enter">Open the map</button><label><input type="checkbox" id="splashSkip"> Go straight to the map next time</label></footer>
    </div>`;
    document.body.append(el);cachedIcons();
    el.querySelector('#splashSkip').checked=get(SKIP_KEY)==='1';
    el.querySelector('#splashSkip').addEventListener('change',e=>put(SKIP_KEY,e.target.checked?'1':null));
    el.querySelector('.splash-search').addEventListener('submit',e=>{e.preventDefault();search(el.querySelector('#splashQ').value)});
    el.querySelector('.splash-enter').addEventListener('click',()=>go('map'));
    el.addEventListener('click',e=>{const b=e.target.closest('.splash-tile');if(b){go(TILES[+b.dataset.i][0]);return}
      const f=e.target.closest('.splash-feature-go');if(f){close();(globalThis.bxcGo||(h=>{location.hash=h}))('#/monster/'+encodeURIComponent(f.dataset.monster));return}
      if(e.target.closest('.splash-new a'))close()});
    el.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close()}});
  }
  // counts grow once the shared data has loaded (it adds creatures), so refresh them on open and a few times after load
  function refreshCounts(reroll){if(!el)return;fillIcons(reroll);const fe=el.querySelector('.splash-feature');if(!fe&&featured()){const h=featuredHtml(),t=document.createElement('div');t.innerHTML=h;const at=el.querySelector('.splash-group');if(at&&t.firstElementChild)at.before(t.firstElementChild)}const st=el.querySelector('.splash-stats');if(st)st.innerHTML=statsHtml();el.querySelectorAll('.splash-tile').forEach(b=>{const t=TILES[+b.dataset.i];if(typeof t[2]==='function')b.querySelector('.splash-tile-text').textContent=t[2](typeof D!=='undefined'?D:{})})}
  let openedFromPage=false;   // Home was clicked from a page: Back closes it again
  function open(fromPage){
    openedFromPage=fromPage===true;pickedThisOpen=false;savedNext=false;
    if(!el)build();
    refreshCounts(true);
    clearTimeout(leaveTimer);el.classList.remove('splash-leaving');
    lastFocus=document.activeElement;el.hidden=false;document.body.classList.add('splash-open');updateBack();
    setTimeout(()=>el.querySelector('#splashQ')?.focus({preventScroll:true}),0);
  }
  // Leaving fades the splash out (CSS .splash-leaving) before it is hidden; the Atlas underneath is already live.
  let leaveTimer=0;
  const calm=()=>{try{return matchMedia('(prefers-reduced-motion: reduce)').matches}catch{return false}};
  function close(){
    if(!el||el.hidden||el.classList.contains('splash-leaving'))return;
    el.classList.add('splash-leaving');
    leaveTimer=setTimeout(()=>{el.hidden=true;el.classList.remove('splash-leaving')},calm()?0:320);
    document.body.classList.remove('splash-open');openedFromPage=false;setTimeout(updateBack,0);
    // the map was laid out while hidden behind the splash
    if(typeof map!=='undefined'&&map.invalidateSize)setTimeout(()=>map.invalidateSize(),0);
    if(lastFocus&&lastFocus.focus&&document.contains(lastFocus))lastFocus.focus();
  }
  function go(sel){
    close();
    const tab=tabFor(sel);
    if(tab&&!tab.classList.contains('on'))tab.click();
    if(sel==='map'&&typeof fit!=='undefined'&&fit.click)fit.click();
  }
  function search(text){
    text=String(text||'').trim();
    close();
    if(typeof q==='undefined'||!q)return;
    q.value=text;q.focus();q.dispatchEvent(new Event('input'));
  }
  // "Home" in the masthead
  const bar=document.getElementById('bar');
  if(bar){
    const home=document.createElement('button');home.type='button';home.id='splashHome';home.textContent='Home';home.title='Back to the Atlas home page';
    home.addEventListener('click',()=>open(true));
    const title=bar.querySelector('b');if(title)title.after(home);else bar.prepend(home);
    const back=document.createElement('button');back.type='button';back.id='atlasBack';back.textContent='← Back';back.title='Back to the previous Atlas page (also the mouse back button or Alt+←)';
    back.addEventListener('click',goBack);home.before(back);
    // Dark / Light mode switch (remembered in this browser)
    const theme=document.createElement('button');theme.type='button';theme.id='themeToggle';
    const showTheme=()=>{const light=document.documentElement.dataset.theme==='light';theme.textContent=light?'☾':'☀';theme.title=light?'Switch to dark mode':'Switch to light mode';theme.setAttribute('aria-label',theme.title)};
    theme.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;put('bxcTheme',next);showTheme()});
    showTheme();home.after(theme);
  }
  // One Back for the whole Atlas: closes the home page if it was opened over a page, otherwise steps back through
  // the pages you opened here; with nothing behind you, it goes to the home page rather than out of the Atlas.
  const splashOpen=()=>!!(el&&!el.hidden&&!el.classList.contains('splash-leaving'));
  const depth=()=>typeof globalThis.bxcNavDepth==='function'?globalThis.bxcNavDepth():0;
  function goBack(){
    if(splashOpen()){if(openedFromPage)close();return}
    if(depth()>0)history.back();else open(false);
  }
  function updateBack(){const b=document.getElementById('atlasBack');if(b)b.disabled=splashOpen()?!openedFromPage:false}
  document.addEventListener('bxc-nav',updateBack);
  // the app has no browser back of its own: the mouse's back button and Alt+Left do the same as the button
  // (in a browser they already go back, so they are left alone there)
  if(!window.BXC_PUBLIC){
    addEventListener('mouseup',e=>{if(e.button===3){e.preventDefault();goBack()}});
    addEventListener('keydown',e=>{if(e.altKey&&e.key==='ArrowLeft'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();goBack()}});
  }
  const here=globalThis.bxcRouteNow?globalThis.bxcRouteNow():location.hash,deepLink=/[#&](monster|item)=/.test(here)||/^#\/./.test(here);
  if(!deepLink&&get(SKIP_KEY)!=='1')open();
  document.documentElement.classList.remove('splash-pending');   // set early in atlas.html so the Atlas does not flash first
  for(const ms of [800,2500,6000])setTimeout(()=>{if(el&&!el.hidden)refreshCounts()},ms);
  updateBack();
  window.bxcSplash={open,close,back:goBack};
})();
