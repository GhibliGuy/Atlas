// Guides: one page per topic and per skill (#/guides, #/guide/<slug>), written in our own words and filled from the
// game's own data wherever a number appears - the recipe list, gathering tiers and XP curves the Atlas already
// carries (atlas-core.js), the game's rules file (family-rules.js, and the weapon/material tables below, copied from
// it), and what players have recorded (resource spots, drops). Official facts come from binxonia.com/guide and are
// paraphrased, never copied. Pages are built only when opened. Public and in-app alike.
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const slug=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const pretty=id=>String(id||'').replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const n=v=>Number(v).toLocaleString('en-US');
  const pct=v=>(v*100).toFixed(v<.1?1:0)+'%';
  const enc=encodeURIComponent;
  const icon=id=>typeof itemImg==='function'?`<img class="g-ico" src="${esc(itemImg({id,typeId:id,item:pretty(id)}))}" alt="">`:'';
  const item=(id,label)=>`<a href="#/item/${enc(id)}">${icon(id)}${esc(label||pretty(id))}</a>`;
  const monster=(id,label)=>`<a href="#/monster/${enc(id)}">${esc(label||pretty(id))}</a>`;
  const guide=(s,label)=>`<a href="#/guide/${enc(s)}">${esc(label||(byslug.get(s)?.title)||pretty(s))}</a>`;
  const api=()=>globalThis.BINXONIA_COLLECTOR_API?.state||null;
  const tradeXp=l=>typeof xpAt==='function'?xpAt('Trade',l):(TRADE_XP[l-1]||0);
  const table=(head,rows,cls='')=>`<div class="g-scroll"><table class="g-table ${cls}"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const note=t=>`<p class="g-note">${t}</p>`;
  const sec=(id,title,body)=>body?`<section id="g-${id}"><h2>${esc(title)}</h2>${body}</section>`:'';

  // ---- game data copied from the game's rules file (play.binxonia.com/assets/game-rules-*.js), checked 2026-09-29
  // Weapon archetypes: damage roll, time between swings, reach; melee weapons carry a x1.15 damage multiplier.
  const WEAPONS=[
    ['Dagger','dagger',2,4,2400,1.5,1.15],['Kryss','dagger',2,5,2800,1.5,1.15],['Short sword','sword',1,8,3600,1.5,1.15],
    ['Scimitar','sword',2,6,3100,1.5,1.15],['Long sword','sword',2,10,4800,1.5,1.15],['Rapier','sword',3,7,4000,1.5,1.15],
    ['Mace','mace',2,13,6000,1.5,1.15],['War mace','mace',3,16,7600,1.5,1.15],['Spear','spear',1,12,5200,2.5,1.15],
    ['Battle spear','spear',2,16,7200,2.5,1.15],['Short bow','bow',1,8,3273,12,1],['Long bow','bow',2,12,5091,13,1],['Crossbow','crossbow',4,16,8000,14,1]
  ];
  {const GW=globalThis.BXC_GAME_DATA?.weapons;if(GW)for(const w of WEAPONS){const g=GW[slug(w[0])];if(g){w[2]=g.damageMin;w[3]=g.damageMax;w[4]=g.cooldownMs;w[5]=g.range;w[6]=g.damageMult}}}
  // weapon skills only a quest teaches (the game's quest reward: weaponSkills), linked wherever that skill comes up
  // (id: null = no one has recorded the quest yet, so it has no page to link)
  const WEAPON_QUEST={spear:{id:'warrior-spear-beyond-the-point',name:'Beyond the Point',from:'Guard Tobin Reed near Underleaf, warriors, level 10'},
    mace:{id:'warrior-mace-the-broken-hammers',name:'The Broken Hammers',from:'Hester Bell near Rustpick Mine, warriors, level 11'},
    crossbow:{id:null,name:'The Heavy Bow',from:'the Archery Vendor by the targets in Underleaf, any class, level 10'}};
  const weaponQuest=k=>{const w=WEAPON_QUEST[k];return !w?'':w.id?`<a href="#/guide/quest-${w.id}">${w.name}</a>`:w.name};
  const weaponQuestNote=k=>WEAPON_QUEST[k]?`<p class="g-note"><b>Needs a quest:</b> the ${k} skill is learned by finishing ${weaponQuest(k)} (${WEAPON_QUEST[k].from}). You can’t wield ${k}s until you have it.</p>`:'';
  // which damage type a weapon deals: maces crush; daggers, spears, crossbows and the rapier stab; the rest slash
  const dmgType=(name,skill)=>name==='Rapier'?'stab':skill==='mace'?'crush':['dagger','spear','crossbow'].includes(skill)?'stab':'slash';
  // material tiers: a weapon's roll is multiplied by 1 + bonus; wearing it needs a level and a stat
  const TIER_BONUS=Array.isArray(globalThis.BXC_GAME_DATA?.combat?.materialBonus)?globalThis.BXC_GAME_DATA.combat.materialBonus:[0,1/4.5,3/4.5,6/4.5,16/4.5],TIER_LEVEL=[0,5,15,25,40],TIER_STAT=[0,20,45,70,100];
  const TIERS=[['Iron','Pine'],['Silver','Oak'],['Gold, Thak*, Bloomguard','Black walnut'],['Titanium, Virikh','Shagbark']];
  const WEAK=1.3,RESIST=.7,CRIT_BASE=4,CRIT_PER_DEX=.1,CRIT_DAGGER=10,CRIT_CAP=50,CRIT_MULT=1.8;

  const G=[],byslug=new Map();
  function reg(g){G.push(g);byslug.set(g.slug,g)}
  const GROUPS=['Start here','Combat','Melee','Ranged','Magic','Gathering skills','Crafting skills','Gear, gems & enchanting','World','Quests'];

  // ---- shared pieces --------------------------------------------------------------------------------------------
  const gatherTiers=skill=>(typeof GATHERABLES!=='undefined'?GATHERABLES:[]).filter(g=>g.skill===skill).map(g=>({...g,id:slug(g.item)})).sort((a,b)=>a.level-b.level);
  const gatherChance=(level,node,tool=0)=>Math.max(0,Math.min(.95,.5+Math.max(0,level-node)*.05+tool));
  const recipesFor=skill=>(typeof RECIPES!=='undefined'?RECIPES:[]).filter(r=>r.skill===skill).sort((a,b)=>a.level-b.level||String(a.item).localeCompare(b.item));
  const usesOf=id=>(typeof RECIPES!=='undefined'?RECIPES:[]).filter(r=>(r.ingredients||[]).some(i=>i.id===id));
  const chanceOf=(r,l)=>typeof craftChance==='function'?craftChance(r,l):1;
  const sureAt=r=>typeof craftSureAt==='function'?craftSureAt(r):r.chance==='always'?r.level:r.chance==='cooking'?r.stop:r.level+14;
  function resourcesGiving(id){const s=api();return s?[...(s.resourceCatalog?.values()||[])].filter(r=>r.yieldItem===id):[]}
  const ingList=r=>(r.ingredients||[]).map(i=>`${n(i.quantity)}× ${item(i.id)}`).join(', ')||'—';
  // Levels 1-100 split where a better option unlocks (and every 15 after the last), with the best option for each
  // stretch (most XP per attempt at the start of the stretch) and how many actions it takes.
  // extra(best, attempts): more cells for the row (a crafting plan adds the materials those attempts use up)
  function trainingPlan(options,chanceAt,label,extra){
    const unlocks=[...new Set([1,...options.map(o=>o.level)])].filter(l=>l>=1&&l<100).sort((a,b)=>a-b);
    const stops=[...unlocks];let last=stops[stops.length-1];while(last+15<100){last+=15;stops.push(last)}stops.push(100);
    const rows=[];
    for(let i=0;i<stops.length-1;i++){
      const from=stops[i],to=stops[i+1];
      const ok=options.filter(o=>o.level<=from);if(!ok.length)continue;
      const best=ok.reduce((a,b)=>b.xp*chanceAt(b,from)>a.xp*chanceAt(a,from)?b:a);
      const need=tradeXp(to)-tradeXp(from),succ=Math.ceil(need/best.xp);
      let tries=0;for(let l=from;l<to;l++)tries+=(tradeXp(l+1)-tradeXp(l))/best.xp/Math.max(.05,chanceAt(best,l));   // level by level (fast even for millions of crafts)
      rows.push([`${from} → ${to}`,label(best),n(succ),n(Math.round(tries)),...(extra?extra(best,Math.round(tries)):[])]);
    }
    return rows;
  }

  const gemOdds=sk=>{const GT=typeof GATHERABLES!=='undefined'?GATHERABLES:[],ts=GT.filter(x=>x.skill===sk).sort((a,b)=>a.level-b.level);
    return table(['',{mining:'Ore',lumberjack:'Wood',fishing:'Fish'}[sk]||'Resource','Gem chance'],[.5,.6,.75,1].map((p,i)=>[`Tier ${i+1}`,ts[i]?item(slug(ts[i].item),ts[i].item):'—',`<b>${p}%</b>`]))+note('Chance of a gem on each successful gather.')};
  // ---- gathering skill guides ---------------------------------------------------------------------------------------
  // How long a node lasts, from the game's rules (game-recipes.js: survive = its chance to stay after each success, then
  // always used up; respawnMs = how long it takes to grow back). P(k gathers) for k = 1 .. survive.length + 1.
  function lastsChances(sv){const out=[];let alive=1;for(let k=0;k<=sv.length;k++){const stay=k<sv.length?sv[k]:0;out.push(alive*(1-stay));alive*=stay}return out}
  const regrowTxt=ms=>!ms?'—':ms<60000?`${Math.round(ms/1000)} s`:`${+(ms/60000).toFixed(1)} min`;
  function gatheringGuide(o){
    return ()=>{
      const tiers=gatherTiers(o.skill);
      const surv=(tiers.find(t=>Array.isArray(t.survive)&&t.survive.length)||{}).survive||null,hasRegrow=tiers.some(t=>t.respawnMs);
      const lasts=surv?lastsChances(surv):null,lastsAvg=lasts?lasts.reduce((a,p,k)=>a+p*(k+1),0):null;
      const rows=tiers.map(t=>{const spots=resourcesGiving(t.id).reduce((a,r)=>a+(r.count||0)+(r.manualCount||0),0);
        const cave=(globalThis.bxcCavesFor?globalThis.bxcCavesFor('item',t.id):[])[0];
        return [n(t.level),item(t.id,t.item),n(t.xp),t.minYield===t.maxYield?n(t.minYield):`${t.minYield}–${t.maxYield}`,spots?n(spots):'<span class="muted">none yet</span>',cave?`${esc(cave.name)} <span class="muted">(${n(cave.count)})</span> <button type="button" class="open-zone" data-zone="${esc(cave.z)}">Layout</button>`:'<span class="muted">—</span>',`<button type="button" class="show-on-map" data-map-kind="item" data-map-id="${esc(t.id)}">Map</button>`]});
      if(hasRegrow)rows.forEach((r,i)=>r.splice(4,0,regrowTxt(tiers[i].respawnMs)));
      const chanceRows=tiers.map(t=>[item(t.id,t.item),...[0,3,6,9].map(k=>pct(gatherChance(t.level+k,t.level)))]);
      const plan=trainingPlan(tiers,(t,l)=>gatherChance(l,t.level),t=>item(t.id,t.item));
      const uses=[...new Map(tiers.flatMap(t=>usesOf(t.id)).map(r=>[r.id,r])).values()].sort((a,b)=>a.skill.localeCompare(b.skill)||a.level-b.level);
      const useSkills=[...new Set(uses.map(r=>r.skill))];
      // a skill that finds gems (Mining, Lumberjack, Fishing - the game's own gem table) says so at the top, with a link
      // to the Gems guide
      const EG=typeof ENCHANT_GEMS!=='undefined'?ENCHANT_GEMS:{};
      const gemsHere=Object.entries(EG).filter(([,g])=>String(g.found||'').toLowerCase()===String(o.skill).toLowerCase());
      const gemAlert=gemsHere.length?`<span class="q-alert-banner gg-alert" role="note">${ALERT_SVG}<span><b>Gems can be found while ${esc(o.verb||(o.skill==='lumberjack'?'chopping':o.skill==='fishing'?'fishing':o.skill==='mining'?'mining':'gathering'))}:</b> ${gemsHere.map(([id,g])=>item('gem-'+id,g.name)).join(', ')}. See ${guide('gems')} for what they are worth and what they make.</span></span>`:'';
      return {
        lede:gemAlert+(o.lede||''),
        sections:[
          ['how','How it works',`<ul class="g-list"><li>Equip the ${esc(o.tool||'tool')} (tools have their own slot, so a shield or quiver can stay on) and click the ${esc(o.node)}.${o.learn?' '+o.learn:''}</li><li>Each success gives <b>10% more</b> for every level past mastery (9 levels above the ${esc(o.node)}’s level, where you hit 95%). A tool that would push you past 95% adds the extra to your haul instead, and <b>Prospector</b> rings (amber) add 2% per carat. The <a href="#/calc-crafting">Crafting XP planner</a> shows your rates level by level.</li><li>Better tools raise your chance: silver <b>+3%</b>, gold <b>+7%</b>, titanium <b>+12%</b> (they need the skill at 15, 30 and 45), plus 5% per carat of an Artisan gem. See ${guide('tool-smithing')}.</li>${surv?`<li>A ${esc(o.node)} isn’t used up by one ${esc(o.action)}: after each success it has a ${surv.map(p=>`<b>${pct(p)}</b>`).join(', ')} chance to stay, so it gives <b>up to ${surv.length+1}</b> and about <b>${lastsAvg.toFixed(1)}</b> on average (see How long a ${esc(o.node)} lasts). Then it grows back, the rarer ones more slowly.${o.nodeLine?' '+o.nodeLine:''}</li>`:hasRegrow?`<li>Each ${esc(o.node)} is used up by one ${esc(o.action)} and grows back after a while (see the tiers table); the rarer ones take longer.${o.nodeLine?' '+o.nodeLine:''}</li>`:`<li>Used-up ${esc(o.node)}s come back after a while; rarer ones take longer.${o.nodeLine?' '+o.nodeLine:''}</li>`}</ul>`],
          ['tiers','Tiers at a glance',table(['Level','Gives','XP each','Per success',...(hasRegrow?['Grows back']:[]),'Spots on the map','Most in',''],rows)+note('Spots are the ones players have recorded; the map fills in as more of the world is visited.')],
          ...(surv?[['lasts','How long a '+o.node+' lasts',`<p>After each successful ${esc(o.action)} the ${esc(o.node)} rolls to stay up: ${surv.map((p,k)=>`<b>${pct(p)}</b> after the ${['first','second','third','fourth','fifth','sixth'][k]||(k+1)+'th'}`).join(', ')}. After success number ${surv.length+1} it is always used up, and it grows back after the time in the tiers table. A failed ${esc(o.action)} doesn’t count.</p>`+
            table(['Successes before it’s used up','Chance'],lasts.map((p,k)=>[n(k+1),+(p*100).toFixed(1)+'%']).concat([['<b>On average</b>',`<b>${lastsAvg.toFixed(1)}</b>`]]))+
            note('From the game’s own rules. Before 3 October 2026 it was 75% and then 10%: at most 3, about 1.8 on average.')]]:[]),
          ['chance','Success chance',`<p>Each ${esc(o.action)} works at <b>50%</b> at the level the ${esc(o.node)} needs, <b>+5%</b> for every level above it, up to <b>95%</b> (reached 9 levels above). ${esc(o.toolLine||'')}</p>`+table(['Tier','At its level','+3','+6','+9 (max)'],chanceRows)+(globalThis.bxcGuideToolBox?`<h3>With your tool</h3>`+globalThis.bxcGuideToolBox('gather',pretty(o.skill)):'')],
          ['plan','Fastest way to level',globalThis.bxcGuidePath?globalThis.bxcGuidePath('gather',pretty(o.skill)):`<p>Always ${esc(o.action)} the highest tier you can: it gives the most XP per attempt even after misses. Actions below are successes needed and attempts including misses (no tool bonus).</p>`+table(['Levels','Gather','Successes','Attempts'],plan)],
          ...(o.extra?o.extra():[]),
          ['uses','What it is used for',uses.length?`<p>${useSkills.map(s=>skillGuideLink(s)).join(' · ')}</p>`+table(['Skill','Level','Makes','From'],uses.map(r=>[esc(r.skill),n(r.level),item(r.id,r.item),ingList(r)])):'<p class="muted">Nothing in the known recipes uses these directly.</p>'],
        ],
        related:o.related||[]
      };
    };
  }
  // ---- crafting skill guides ----------------------------------------------------------------------------------------
  function craftingGuide(o){
    return ()=>{
      const rs=recipesFor(o.skill);
      const rows=rs.map(r=>[n(r.level),item(r.id,r.item)+(r.out>1?` <span class="muted">×${r.out}</span>`:''),n(r.xp)+(r.split?` <span class="muted">(${+(r.xp/r.split.length).toFixed(2)} to each smithing skill)</span>`:''),ingList(r),r.chance==='always'?'Always':pct(chanceOf(r,r.level)),r.chance==='always'?'—':n(sureAt(r))]);
      // every attempt uses up the recipe's materials, a failed one too, so a stretch needs attempts × each ingredient
      const mats=(r,tries)=>[(r.ingredients||[]).map(i=>`${n(tries*(i.quantity||1))}× ${item(i.id)}`).join('<br>')||'—'];
      const plan=rs.length?trainingPlan(rs,(r,l)=>chanceOf(r,l),r=>item(r.id,r.item),mats):[];
      const feeders=[...new Set(rs.flatMap(r=>(r.ingredients||[]).map(i=>i.id)))];
      const gatherSkills=[...new Set(feeders.map(id=>(typeof GATHERABLES!=='undefined'?GATHERABLES:[]).find(g=>slug(g.item)===id)?.skill).filter(Boolean))];
      const craftedFeeds=[...new Set(feeders.map(id=>(RECIPES||[]).find(r=>r.id===id)?.skill).filter(s=>s&&s!==o.skill))];
      return {
        lede:o.lede,
        sections:[
          ['how','How it works',`<ul class="g-list">${o.station?`<li>Work at a <b>${esc(o.station)}</b>${o.tool?` with a <b>${esc(o.tool)}</b> equipped (tools have their own slot)`:''}.${o.learn?' '+o.learn:''}</li>`:''}${o.noTomes?'':`<li>Tier-1 materials need nothing else. Each higher material needs its <b>tome</b>, a rare monster drop that unlocks every recipe of that material: tier 2 drops from level-10 monsters, tier 3 from level 25, tier 4 from level 45.${o.tomeLine?' '+o.tomeLine:''}</li>`}${o.how?o.how:''}</ul>`],
          ['recipes','Every recipe',table(['Level','Makes','XP','Needs','Success at its level','Sure at'],rows)+(o.skill!=='Smelting'&&globalThis.bxcGuideToolBox?`<h3>With your tool</h3>`+globalThis.bxcGuideToolBox('craft',o.skill):'')+note(o.chanceNote||'Crafting works 60% of the time at the recipe’s level and climbs by 40% over the next 15 levels, capped at 95% (reached 14 levels above). Enchanting needs mastery: that 95%, 14 levels above. A failed attempt uses up the materials. (The game’s own rule.)')],
          ['plan','Fastest way to level',o.skill!=='Smelting'&&globalThis.bxcGuidePath?globalThis.bxcGuidePath('craft',o.skill):plan.length?`<p>The recipe with the most XP per attempt at each stretch.</p>`+table(['Levels','Make','Successes','Attempts','Materials'],plan)+note('Materials are for every attempt: a failed one uses them up too.'):''],
          ...(o.extra?o.extra():[]),
          ['materials','Where the materials come from',(gatherSkills.length||craftedFeeds.length)?`<p>${[...gatherSkills.map(s=>skillGuideLink(s)),...craftedFeeds.map(s=>skillGuideLink(s))].join(' · ')}</p>`:''],
        ],
        related:o.related||[]
      };
    };
  }
  const SKILL_SLUG={mining:'mining',lumberjack:'lumberjack',fishing:'fishing',herblore:'herblore',Smelting:'smelting','Armor Smithing':'armor-smithing','Weapon Smithing':'weapon-smithing','Tool Smithing':'tool-smithing',Bowyer:'bowyer',Tailoring:'tailoring',Leatherworking:'leatherworking',Cooking:'cooking',Herblore:'herblore',Scribing:'scribing',Carpentry:'carpentry'};
  function skillGuideSlug(skill){return SKILL_SLUG[skill]||SKILL_SLUG[String(skill).toLowerCase()]||slug(skill)}
  function skillGuideLink(skill){const s=skillGuideSlug(skill);return byslug.has(s)?guide(s):esc(pretty(skill))}

  // ---- Start here -------------------------------------------------------------------------------------------------
  reg({slug:'levels-and-xp',group:'Start here',title:'Levels and XP',blurb:'How character, combat and trade skill levels grow, with the XP each one needs.',build:()=>{
    const marks=[5,10,15,20,25,30,40,45,50,60,70,80,90,100];
    const cx=globalThis.BXC_CHARACTER_XP||[];
    const rows=marks.map(l=>[n(l),cx[l-1]!=null?n(cx[l-1]):'—',typeof COMBAT_XP!=='undefined'&&COMBAT_XP[l-1]!=null?n(COMBAT_XP[l-1]):'—',n(tradeXp(l))]);
    return {lede:'Your character has an overall level, and each weapon, magic school and trade skill levels up on its own as you use it.',sections:[
      ['kinds','Three kinds of level',`<ul class="g-list"><li><b>Character level</b> rises with the XP from everything you do, and gates what gear you can wear (see ${guide('combat','Combat')}).</li><li><b>Combat skills</b> (${esc((typeof COMBAT_SKILLS!=='undefined'?COMBAT_SKILLS:[]).join(', '))}) rise with the weapon or school you fight with.</li><li><b>Trade skills</b> (${esc((typeof TRADE_SKILLS!=='undefined'?TRADE_SKILLS:[]).join(', '))}) rise by gathering and crafting. They all share one XP curve.</li></ul>`],
      ['table','Total XP needed to reach a level',table(['Level','Character','Combat skill','Trade skill'],rows)+note('Totals from level 1, copied from the game’s own curves. The <a href="#/xp">XP tables</a> page lists every level.')],
      ['points','Skill points',`<p>Trades and weapon tomes cost skill points, and you only ever get <b>10</b>: at the start and at levels 5, 10, 20, 30, 40, 50, 60, 75 and 100. Cooking and Herblore are free. Weapon skills and magic schools need no points: they grow with the damage you deal.</p>`],
      ['party','XP in a party',`<p>A party of up to 4 pools kill XP with +10% per extra member and splits it between members nearby (see ${guide('playing-together')}).</p>`],
      ['events','Experience events',`<p>The game can run <b>server-wide XP events</b> that boost combat, gathering or crafting XP for a set time. Everyone gets a message in chat and on Discord when one starts and ends, and you are told about a running one when you log in. They <b>stack</b> with XP scrolls.</p>`],
      ['planning','Planning',`<p>Each skill guide has a “Fastest way to level” table built from these curves. For your own numbers use the <a href="#/calc-crafting">Crafting XP</a> and <a href="#/calc-combat">Combat</a> calculators.</p>`]
    ],related:['combat','mining','armor-smithing']}}});
  reg({slug:'using-the-atlas',group:'Start here',title:'Using the Atlas',blurb:'The map, pages, search, and how the data gets here.',build:()=>({lede:'The Atlas is a player-made field guide to Binxonia. Everything in it is either copied from the game’s own rules or was seen in the game by players running the collector.',sections:[
    ['map','The world map',`<p>The <a href="#/map">World map</a> shows monsters (by the area they live in), resources, places and cave or building entrances. Click anything to see just that thing in a side panel; its link opens the full page. The legend (top right) switches layers on and off.</p>`],
    ['pages','Pages and links',`<p>Every monster, item and resource has its own page, and names link to each other: a monster’s drops lead to the items, an item leads to the monsters that drop it and the recipes that use it. “Show on map” circles where something is. The browser’s Back button works everywhere, and any page can be shared by its address.</p>`],
    ['search','Searching',`<p>The search box finds monsters, items, resources and zones. In the Bestiary, typing a damage type finds monsters <i>weak</i> to it (<i>crush</i>, <i>slash burn</i>), and <i>resist slash</i> finds the ones that resist it.</p>`],
    ['data','Where the numbers come from',`<p>Levels, XP, recipes, monster stats, weaknesses and weapon numbers come from the game’s rules file. Drop rates, spawn areas and resource spots come from what players recorded, so they get more complete over time; rarer drops may not show up yet.</p>`]
  ],related:['getting-started','levels-and-xp']})});

  // ---- Combat -----------------------------------------------------------------------------------------------------
  reg({slug:'combat',group:'Combat',title:'Combat',blurb:'Damage types, weaknesses, weapons, materials, crits and elites.',build:()=>{
    const wRows=WEAPONS.map(([name,skill,a,b,cd,reach,mult])=>{const avg=(a+b)/2*mult;return [esc(name),esc(pretty(skill)),`<span class="tag-chip weak">${dmgType(name,skill)}</span>`,`${a}–${b}`,(cd/1000).toFixed(1)+' s',reach>3?n(reach)+' tiles':reach+' tiles',(avg/(cd/1000)).toFixed(2)]});
    const tierRows=TIERS.map((mats,i)=>[`Tier ${i+1}`,esc(mats[0]),esc(mats[1]),'×'+(1+TIER_BONUS[i+1]).toFixed(2),`Level ${TIER_LEVEL[i+1]}, ${TIER_STAT[i+1]} of the stat`]);
    return {lede:'Every hit has a damage type. Monsters are weak to some types and resist others, so the right weapon for a fight depends on who you are fighting.',sections:[
      ['types','Damage types',`<p>Weapons deal one of three physical types: <b>slash</b>, <b>stab</b> or <b>crush</b>. Magic and weapon enchantments add the elemental types <b>burn</b>, <b>freeze</b>, <b>shock</b> and <b>corrode</b>.</p><p>A monster family is <b>weak</b> to some types (they deal <b>${Math.round((WEAK-1)*100)}% more</b>) and <b>resists</b> others (<b>${Math.round((1-RESIST)*100)}% less</b>). Every monster page shows both; the Bestiary can filter by them.</p>`],
      ['weapons','Weapons',`<p>At the same material, every melee weapon does about the same damage per second: slow weapons hit harder per swing. What really differs is the damage type and the reach.</p>`+table(['Weapon','Skill','Type','Roll','Swing every','Reach','Avg per second*'],wRows)+note('*Base roll only, before material, stats, quality and enchantments. Melee weapons carry a ×1.15 multiplier that bows and crossbows do not.')],
      ['materials','Materials and requirements',`<p>Better materials multiply a weapon’s damage roll. Wearing them needs a character level and a stat: <b>Strength</b> for metal weapons, <b>Dexterity</b> for daggers and wooden weapons.</p>`+table(['Tier','Metal','Wood','Damage roll','To equip'],tierRows)+note('*Thak gear needs level 30 and 80 of the stat instead. Leather has no requirement. The official guide gives tier 4 as +356%; the game’s rules work out to the ×3.44 shown.')],
      ['hits','Hitting and being hit',`<ul class="g-list"><li>Whether you hit depends on your level against the target’s; the damage type then decides how hard.</li><li>A <b>killing blow resets</b> your weapon cooldowns and the spell cooldown.</li><li>Monsters below level 8 hit softer: level 1 ones do 30% of normal damage, level 4 ones 60%.</li><li>When several monsters are on a warrior, all but the one it is fighting hit 20% softer.</li><li>Bows and crossbows cost stamina per shot, and 0.5 stamina per tile you move in a fight. An exhausted shot does 40% damage with 40 less hit chance, and you slow down. About 60% of arrows and bolts can be picked back up from the kill.</li></ul>`],
      ['regen','Health, food and potions',`<p>Health, stamina and mana <b>don’t regenerate in combat</b>; afterwards they ramp up to full speed over 8 seconds. Food and potions share a <b>2-second cooldown</b>. Food heals 20% at once and the rest over 5 seconds; a potion refills one pool instantly. See ${guide('cooking')}.</p>`],
      ['crits','Critical hits',`<p>Crit chance is <b>${CRIT_BASE}%</b> plus <b>${CRIT_PER_DEX}%</b> per point of Dexterity, <b>+${CRIT_DAGGER}%</b> with a dagger (and more from a Duelist ring), up to <b>${CRIT_CAP}%</b>. A crit deals <b>×${CRIT_MULT}</b>.</p>`],
      ['elites','Elites',`<p>Some monsters appear as elites: ${globalThis.BXC_GAME_DATA?.elite?`${globalThis.BXC_GAME_DATA.elite.hp}× hitpoints, ${globalThis.BXC_GAME_DATA.elite.damage}× damage, ${globalThis.BXC_GAME_DATA.elite.xp}× the kill XP`:'3× hitpoints, 1.4× damage, 3× the kill XP'} and 2.5× the loot, with double the odds at a cape, pendant, ring, kill gem or crafting tome. Bosses have 3× hitpoints. (The game’s rules.)</p>`],
      ['choosing','Choosing a weapon for your level',weaknessBands()],
    ],related:['monsters-by-level','monster-families','quality-and-enchanting']};
  }});
  function weaknessBands(){
    const cat=(typeof D!=='undefined'?D.catalog:[])||[],list=s=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean);
    const bands=[[1,14],[15,29],[30,44],[45,200]];
    const rows=bands.map(([a,b])=>{const ms=cat.filter(m=>m.baseLevel>=a&&m.baseLevel<=b&&(list(m.weakTo).length||list(m.resists).length));
      const score=t=>ms.reduce((s,m)=>s+(list(m.weakTo).includes(t)?WEAK:list(m.resists).includes(t)?RESIST:1),0)/(ms.length||1);
      const phys=['crush','stab','slash'].map(t=>[t,score(t)]).sort((x,y)=>y[1]-x[1]);
      return [b>100?`${a}+`:`${a}–${b}`,n(ms.length),phys.map(([t,v])=>`${t} <span class="muted">×${v.toFixed(2)}</span>`).join(' · ')];});
    return `<p>Averaged over every monster in each level range (those with known weaknesses), how each physical type fares:</p>`+table(['Monster levels','Monsters','Best to worst'],rows)+note('×1.00 is neutral. A type that is weak for some and resisted by others averages out. For a specific target, check its page.');
  }
  reg({slug:'monsters-by-level',group:'Combat',title:'Monsters by level',blurb:'Every monster in level order, with weaknesses, hitpoints and XP.',build:()=>{
    const cat=[...((typeof D!=='undefined'?D.catalog:[])||[])].sort((a,b)=>(a.baseLevel||0)-(b.baseLevel||0)||String(a.name).localeCompare(b.name));
    const chips=(s,c)=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>`<span class="tag-chip ${c}">${esc(x)}</span>`).join('')||'<span class="muted">—</span>';
    const bands=[[1,9],[10,19],[20,29],[30,39],[40,49],[50,200]];
    return {lede:'Level is the monster’s base level; individual monsters can be a few levels higher.',sections:bands.map(([a,b])=>{const ms=cat.filter(m=>(m.baseLevel||0)>=a&&(m.baseLevel||0)<=b);
      return [`l${a}`,b>100?`Level ${a}+`:`Levels ${a}–${b}`,ms.length?table(['Monster','Level','Family','Weak','Resists','HP','XP','Aggressive'],ms.map(m=>[monster(m.typeId,m.name),n(m.baseLevel),esc(pretty(m.family)),chips(m.weakTo,'weak'),chips(m.resists,'resist'),m.maxHp!=null?n(m.maxHp):'—',m.xp!=null?n(m.xp):'—',m.passive?'No':'Yes'])):''];}),related:['combat','monster-families']};
  }});
  reg({slug:'monster-families',group:'Combat',title:'Monster families',blurb:'What each family attacks with, is weak to and resists.',build:()=>{
    const fams=globalThis.BXC_FAMILY_RULES?.families||{},cat=(typeof D!=='undefined'?D.catalog:[])||[];
    const chips=(a,c)=>(a||[]).map(x=>`<span class="tag-chip ${c}">${esc(x)}</span>`).join('')||'<span class="muted">—</span>';
    const rows=Object.entries(fams).sort((a,b)=>String(a[1].name).localeCompare(b[1].name)).map(([id,f])=>{const ms=cat.filter(m=>m.family===id).sort((a,b)=>a.baseLevel-b.baseLevel);
      return [esc(f.name||pretty(id)),esc(f.attackType||'—'),chips(f.weak,'weak'),chips(f.resist,'resist'),ms.map(m=>monster(m.typeId,m.name)).join(', ')||'<span class="muted">—</span>']});
    return {lede:'Weaknesses and resistances belong to a monster’s family, so every member shares them.',sections:[['families','All families',table(['Family','Attacks with','Weak to','Resists','Members'],rows)+note('From the game’s rules file.')],['reagents','Reagents by family',`<p>Since 5 October 2026 these families drop a rare <b>reagent</b> for reforging gear (small chance on any kill, far better from elites). See ${guide('reforging')}.</p>`+table(['Family','Reagent','Used to'],REAGENTS.flatMap(([id,kind,src])=>src.map(([f,cls])=>[famName(f)+(cls?' ('+cls+'s)':''),id,kind])).sort((x,y)=>x[0].localeCompare(y[0])).map(([f,id,kind])=>[esc(f),item(id),kind==='enchant'?'infuse an enchant':'reroll quality']))]],related:['combat','monsters-by-level']};
  }});

  // ---- Gathering skills -------------------------------------------------------------------------------------------
  reg({slug:'mining',group:'Gathering skills',title:'Mining',blurb:'Ore tiers, success chance, the fastest route to 100, and where the rocks are.',build:gatheringGuide({skill:'mining',action:'swing',node:'rock',
    lede:'Mine rocks for iron, silver, gold and titanium ore, the metal behind every smithing skill. Mining is also where five of the nine gems are found.',
    toolLine:'A better pickaxe adds to that chance (see Quality & enchanting for tool bonuses).',
tool:'pickaxe',unit:'ore',learn:'Learn it from a trainer for a skill point.',nodeLine:'A top-level miner gets 10 ore a swing from a starter rock, and over 13 with a full-gem titanium pickaxe.',
    extra:()=>[specialEventBlurb('mining'),['gems','Gems',`<p>Every successful swing has a small chance of a gem: <b>rubies, diamonds, emeralds, sapphires and onyx</b>.</p>`+gemOdds('mining')]],related:['smelting','weapon-smithing','armor-smithing','tool-smithing','gems']})});
  reg({slug:'lumberjack',group:'Gathering skills',title:'Lumberjack',blurb:'Wood tiers, success chance and the fastest route to 100.',build:gatheringGuide({skill:'lumberjack',action:'chop',node:'tree',
    lede:'Chop trees for pine, oak, black walnut and shagbark wood, used by bowyers and in tool handles. Trees can also give amber and iolite.',
    toolLine:'A better axe adds to that chance.',
tool:'axe',unit:'log',learn:'Learn it from a trainer for a skill point.',nodeLine:'Everyone chopping the same tree works the same tree, so in a busy forest keep another one in mind.',
    extra:()=>[specialEventBlurb('lumberjack'),['gems','Gems',`<p>Chopping can turn up <b>amber and iolite</b>.</p>`+gemOdds('lumberjack')]],related:['bowyer','tool-smithing','gems']})});
  reg({slug:'fishing',group:'Gathering skills',title:'Fishing',blurb:'Fish tiers, how fishing spots refill, and the fastest route to 100.',build:gatheringGuide({skill:'fishing',action:'cast',node:'fishing spot',
    lede:'Fish catfish, bass, trout and salmon from fishing spots, then cook them into food. Fishing is where pearls and topaz come from.',
    toolLine:'A better fishing rod adds to that chance.',
    tool:'fishing rod',unit:'fish',learn:'Learn it from the Fishing Trainer (one skill point); you fish from the bank.',
    extra:()=>[specialEventBlurb('fishing'),['spots','How fishing spots work',`<p>Each spot is for one kind of fish (the map says which). Measured by players: a spot gives <b>1 to 5 catches</b> (about 2.5 on average) and then goes quiet, and comes back in the same place about <b>65 seconds</b> later. Moving between two or three nearby spots keeps you casting.</p>`],['gems','Gems',`<p>Fishing can turn up <b>pearls and topaz</b>.</p>`+gemOdds('fishing')],['eat','Eating it',`<p>Raw fish can’t be eaten: cook it first (${guide('cooking')}).</p>`]],related:['cooking','gems']})});
  reg({slug:'herblore',group:'Gathering skills',title:'Herblore',blurb:'Plants to gather, and the pigments and potions made from them.',build:()=>{
    const gath=gatheringGuide({skill:'herblore',action:'pick',node:'plant',tool:'herbalist’s sickle',unit:'plant',learn:'Herblore costs no skill point: finishing the quest <a href="#/guide/quest-binxonia-scriptorium-apprentice">The Scriptorium Apprentice</a> (from <a href="#/npc/osric-blane">Osric Blane</a>) unlocks it.',lede:'',related:[]})();
    const craft=craftingGuide({skill:'Herblore',lede:'',chanceNote:'Pigments, powders and weapon poisons never fail. Poisoned arrows and bolts follow the usual crafting odds: 60% at their level, 95% from 14 levels above.'})();
    return {lede:'Pick plants for fibre, dyes and poison ingredients, then turn them into pigments, powders and weapon poisons. Herblore both gathers and crafts.',
      sections:[...gath.sections.filter(s=>s[0]!=='uses').map(s=>[s[0],s[1],s[2]]),specialEventBlurb('herblore'),['recipes','What herblore makes',`<p>Plants are ground into pigments and powders at a <b>pestle and mortar</b> out in the world; grinding uses your Herblore level and never fails.</p>`+craft.sections.find(s=>s[0]==='recipes')[2]],['poison','Weapon poisons',`<p>Drag a poison onto a sword, dagger, mace or spear for <b>60 doses</b>. Every hit that lands uses one and adds a share of the hit as damage over about 2 seconds that <b>ignores armor</b>; a miss uses nothing. For bows and crossbows, one vial and 60 arrows or bolts make 60 poisoned shots.</p>`+table(['Poison','Level','Needs','Adds'],[['Weak weapon poison','30','2 Mandrake Root <span class="muted">or 4 Venom Glands</span>','10% of each hit'],['Weapon poison','50','2 Wolfsbane <span class="muted">or 5 Scorpion Stingers</span>','15%'],['Potent weapon poison','70','2 Adderfern Fronds','20%']])+'<p class="g-note">Since 5 October 2026 venom glands and scorpion stingers can stand in for the plant in the two weaker poisons (the game’s own recipe alternatives).</p>'],['plan2','Levelling by making things',craft.sections.find(s=>s[0]==='plan')[2]]],related:['tailoring','scribing','cooking']};
  }});

  // ---- Special events (the game's 3 Oct 2026 update; shoal and prize ram 4 Oct) ----------------------------------------------------------------
  // From the game's own rules (game-rules-*.js): every so often a rock becomes a rift, a tree a fallen giant and a herb a
  // bloom, for a while. Each copies the node it replaces (skill, level, tool, XP per success, success chance and speed)
  // with both ends of its yield doubled, a bigger footprint (6, 10 and 2 tiles across) and no rest after a gather; the
  // game sends when each opens and closes. How often they come and how long they stay is the server's, not published.
  // The 4 Oct update (news "Rifts, Giants and Shoals") added the shoal (a fishing spot's, 3 tiles across) and the prize ram
  // (a sheep's, 2 across) and says every action on an event succeeds and pays double. Shoal and ram have no per-item yield
  // in the rules (fish and wool come from the server), so their sections are written out (custom).
  // The pictures are drawn by the game's own code (img/events, made 3 and 4 Oct 2026).
  const SPECIAL_EVENTS=[
    {kind:'rifts',title:'Rifts',one:'rift',from:'rock',skill:'mining',unit:'ore',size:6,list:[['iron-rift','iron-ore'],['silver-rift','silver-ore'],['gold-rift','gold-ore'],['titanium-rift','titanium-ore']]},
    {kind:'giants',title:'Fallen giants',one:'fallen giant',from:'tree',skill:'lumberjack',unit:'logs',size:10,list:[['fallen-pine','pine-wood'],['fallen-oak','oak-wood'],['fallen-black-walnut','black-walnut-wood'],['fallen-shagbark','shagbark-wood']]},
    {kind:'blooms',title:'Blooms',one:'bloom',from:'herb',skill:'herblore',unit:'herbs',size:2,list:[['flax-bloom','flax-fiber'],['woad-bloom','woad-leaves'],['madder-bloom','madder-root'],['weld-bloom','weld-stalks'],['mandrake-bloom','mandrake-root'],['wolfsbane-bloom','wolfsbane'],['adderfern-bloom','adderfern-fronds']]},
    {kind:'shoals',title:'Shoals',one:'shoal',from:'fishing spot',skill:'fishing',unit:'fish',size:3,list:[['fish-shoal',null]],
      custom:()=>`<p>A catch can stir up a <b>shoal</b> in open water near the bank: <b>3 by 3 tiles</b>, and you cast at it from the shore like at a fishing spot. It fishes like the spot it came from (Fishing from level 1, with a rod), every cast lands a catch and each pays <b>double</b> what the spot would. Shoals also turn up <b>gems more often</b>. See the <a href="#/guide/fishing">Fishing</a> guide for the fish themselves.</p>`},
    {kind:'rams',title:'Prize rams',one:'prize ram',from:'sheep',skill:'shearing',unit:'wool',size:2,list:[['prize-ram',null]],
      custom:()=>`<p>Shearing a sheep can bring out a <b>prize ram</b> (2 by 2 tiles). Shear it like a sheep (Shearing from level 1, with shears, 12 XP each): every clip succeeds and gives <b>double the wool</b>. Its fleece <b>thins as it is shorn</b>, and when it is bare it leaves in a burst of wool. See the <a href="#/guide/shearing">Shearing</a> guide for what wool is for.</p>`}];
  const eventRule=id=>(typeof GATHERABLES!=='undefined'?GATHERABLES:[]).find(g=>g.id===id)||null;
  const eventFig=(id,cap,small)=>`<figure class="ev-fig${small?' small':''}"><img src="img/events/${esc(id)}.svg" alt="${esc(pretty(id))}" loading="lazy"><figcaption>${cap}</figcaption></figure>`;
  const yieldTxt=(a,b)=>a===b?n(a):`${n(a)}–${n(b)}`;
  function eventSection(ev){
    if(ev.custom)return `<div class="ev-figs">${ev.list.map(([id])=>eventFig(id,esc(pretty(id)))).join('')}</div>`+ev.custom();
    const rows=ev.list.map(([id,yid])=>{const g=eventRule(yid);return [esc(pretty(id)),g?n(g.level):'—',item(yid),g?n(g.xp):'—',g?yieldTxt(g.minYield,g.maxYield):'—',g?`<b>${yieldTxt(g.minYield*2,g.maxYield*2)}</b>`:'—']});
    return `<div class="ev-figs">${ev.list.map(([id,yid])=>{const g=eventRule(yid);return eventFig(id,`${esc(pretty(id))}${g?` <span class="muted">Lv ${n(g.level)}</span>`:''}`)}).join('')}</div>`
      +`<p>A ${esc(ev.from)} that turns into a ${esc(ev.one)} covers <b>${ev.size} by ${ev.size} tiles</b> while it lasts. You gather it with ${esc(pretty(ev.skill))} at the same level as the ${esc(ev.from)} it replaced. See the <a href="#/guide/${esc(ev.skill)}">${esc(pretty(ev.skill))}</a> guide for the skill itself.</p>`
      +table(['Event','Level','Gives','XP each','Normal yield','Event yield'],rows);
  }
  reg({slug:'special-events',group:'Gathering skills',title:'Special events',blurb:'Rifts, fallen giants, blooms, shoals and prize rams: gathering spots that give double for a while.',build:()=>({
    lede:'Once in a while your gathering sets off a <b>special event</b> close by: a <b>rift</b>, a <b>fallen giant</b>, a <b>bloom</b>, a <b>shoal</b> or a <b>prize ram</b>. It gathers like the node it came from, but every swing, cast, pick or clip <b>succeeds</b> and gives <b>twice as much</b>. Anyone nearby can join in while it lasts.',
    sections:[
      ['how','How they work',`<div class="ev-figs">${SPECIAL_EVENTS.map(ev=>eventFig(ev.list[ev.list.length-1][0],esc(ev.title))).join('')}</div>
        <ul class="g-list"><li>Every gathering skill has one: <b>mining</b> can tear open a <b>rift</b>, lightning can bring down a <b>fallen giant</b> near a woodcutter, <b>picking herbs</b> can make a <b>bloom</b> spring up, a <b>catch</b> can stir up a <b>shoal</b> and <b>shearing</b> can bring a <b>prize ram</b>.</li>
        <li>It works like the node it came from: the <b>same skill, level, tool, XP per action and speed</b>.</li>
        <li><b>Every action on it succeeds</b> and pays <b>double</b> what the ordinary rock, tree, herb, spot or sheep would (the game doubles both the least and the most a gather can give).</li>
        <li>Rifts, fallen giants and shoals turn up <b>gems more often</b>; fallen giants and blooms give <b>more saplings and seeds</b>.</li>
        <li>The game's rules give it <b>no rest after a gather</b>, so you can keep working it without waiting. It does <b>run out</b>, though: the first fallen shagbark measured gave <b>68 wood over 32 chops</b> (2 or 3 a chop, where the tree gives 1 or 2) and then disappeared.</li>
        <li>It is <b>easy to spot</b>: a rift covers 6 by 6 tiles, a fallen giant 10 by 10, a shoal 3 by 3 and a bloom or prize ram 2 by 2. The game's map marks it as <i>Rift</i>, <i>Fallen giant</i>, <i>Bloom</i>, <i>Shoal</i> or <i>Prize ram</i> in its own colour.</li>
        <li>It is <b>shared</b> by everyone working it, and players close by hear when one opens.</li>
        <li>It closes when it <b>runs dry or its time is up</b>: the first one measured closed <b>4 minutes</b> after it opened, if nobody used it up first. The game announces it in <b>system chat</b> (“Lightning fells an ancient shagbark nearby.”).</li><li>It comes from <b>gathering</b>: the first fallen shagbark appeared where its chopper stood, a second after a chop at a shagbark tree. How often it happens is not published.</li></ul>`+note('Sizes, levels, XP and yields from the game’s own rules (3 and 4 October 2026 updates) and its news post “Rifts, Giants and Shoals”; how long one lasted, how much it held and the chat line were measured by players. The pictures are drawn by the game itself.')],
      ...SPECIAL_EVENTS.map(ev=>[ev.kind,ev.title,eventSection(ev)])
    ],
    related:['mining','lumberjack','herblore','fishing','shearing']})});
  // the short version for a skill's own page, linking to the full one
  function specialEventBlurb(skill){
    const ev=SPECIAL_EVENTS.find(e=>e.skill===skill);if(!ev)return null;
    return ['events','Special event: '+ev.title.toLowerCase(),`<div class="ev-figs">${ev.list.map(([id])=>eventFig(id,esc(pretty(id)),true)).join('')}</div>
      <p>Once in a while your work sets off a <b>${esc(ev.one)}</b> close by. You work it like a ${esc(ev.from)} (same level, tool and XP each), but every action succeeds and gives <b>double the ${esc(ev.unit)}</b>, until it runs dry or closes a few minutes later. More in <a href="#/guide/special-events">Special events</a>.</p>`];
  }


  // ---- Reagents and the Reforge (game update of 5 Oct 2026), from the game's own rules (game-rules-BRM0CA2R):
  // El (reagent -> the families that drop it), Oa (enchant -> reagent), Bb (enchant -> gem), Rl (ring/pendant stone ->
  // reagent), va (gear line -> reroll reagent), Kb (infuse chance by the carat it has now), jb (infuse fee 1,500 + 500 a
  // carat), zb (smallest gem: 2c, then 2.5c at 8c, 3c at 9c, 3.5c at 10c, 4c at 11c), carat caps (gear 3 a metal tier
  // up to 12, capes 7, rings and pendants 6), tm (re-enchant fee 2,000 a resulting carat), rm (reroll fee by metal tier)
  // and the levels: gear needs the trade's enchant level for that metal (xl: 16/31/46/61), capes/rings Ba(carat)
  // (16 up to 3c, 31 up to 6c, 46 for 7c); a reroll needs the level to craft the piece (La: 1/16/31/46).
  const REAGENTS=[
    ['sirocco-core','enchant',[['dust-devil']]],['giants-knucklebone','enchant',[['hill-giant']]],['troll-heart','enchant',[['troll']]],['gilded-plume','enchant',[['harpy']]],
    ['soul-shard','enchant',[['ghost']]],['moonwing-dust','enchant',[['moth']]],['fulgurite-shard','enchant',[['sand-elemental']]],['deathstalker-venom','enchant',[['scorpion']]],
    ['ember-gland','enchant',[['dragon']]],['moonhart-antler','enchant',[['moonbeast']]],['vulture-eye','enchant',[['vulture']]],['lycan-claw','enchant',[['werewolf']]],
    ['dune-whetstone','quality',[['raider']]],['cutthroats-hone','quality',[['bandit']]],['orcish-grip-wrap','quality',[['orc']]],['goblin-haft-binding','quality',[['goblin'],['lizper']]],
    ['fae-bowstring','quality',[['fae']]],['pirates-windlass','quality',[['pirate'],['bandit','archer']]],['embalming-resin','quality',[['mummy']]],['grave-rivet','quality',[['skeleton']]],
    ['wolf-sinew','quality',[['wolf'],['desert-wolf']]],['ogre-bone-needle','quality',[['ogre']]],['thak-shield-boss','quality',[['thak']]]];
  const RF_ENCH={leopard:['sirocco-core','gem-pearl','of the Leopard (SPD)'],titan:['giants-knucklebone','gem-topaz','of the Titan (STR)'],camel:['troll-heart','gem-ruby','of the Camel (END)'],weasel:['gilded-plume','gem-emerald','of the Weasel (DEX)'],sage:['soul-shard','gem-sapphire','of the Sage (INT)'],mage:['moonwing-dust','gem-amber','of the Mage (MAG)'],
    'of-flame':['ember-gland','gem-ruby','of the Flame'],'of-freezing':['moonhart-antler','gem-sapphire','of Freezing'],'of-storm':['fulgurite-shard','gem-pearl','of the Storm'],'of-corrosion':['deathstalker-venom','gem-emerald','of Corrosion'],'of-seeking':['vulture-eye','gem-diamond','of Seeking'],'of-destruction':['lycan-claw','gem-ruby','of Destruction'],
    'staff-fire':['ember-gland','gem-ruby','staff of Fire'],'staff-ice':['moonhart-antler','gem-sapphire','staff of Frost'],'staff-shock':['fulgurite-shard','gem-topaz','staff of Lightning'],'staff-acid':['deathstalker-venom','gem-emerald','staff of Acid']};
  const RF_STONE={onyx:'lycan-claw',emerald:'gilded-plume',sapphire:'soul-shard',diamond:'vulture-eye',ruby:'troll-heart',topaz:'giants-knucklebone',pearl:'sirocco-core',amber:'moonwing-dust',iolite:'ember-gland'};
  const RF_LINE={sword:'dune-whetstone',dagger:'cutthroats-hone',mace:'orcish-grip-wrap',spear:'goblin-haft-binding',bow:'fae-bowstring',crossbow:'pirates-windlass',staff:'embalming-resin',plate:'grave-rivet',leather:'wolf-sinew',cloth:'ogre-bone-needle',shield:'thak-shield-boss'};
  const RF_LINE_NAME={sword:'swords',dagger:'daggers',mace:'maces',spear:'spears',bow:'bows',crossbow:'crossbows',staff:'staves',plate:'plate armor',leather:'pelt armor',cloth:'knick armor',shield:'shields'};
  const RF_CHANCE=[.9,.85,.78,.7,.62,.55,.47,.4,.33,.26,.2],RF_GEM=c=>c>=11?4:c>=10?3.5:c>=9?3:c>=8?2.5:2,RF_FEE=c=>1500+500*c,RF_REROLL_FEE=[1000,1500,2000,3000];
  globalThis.bxcReforge={chance:RF_CHANCE,fee:RF_FEE,gem:RF_GEM};   // for the Quality calculator's infusing planner
  const famName=f=>{const r=globalThis.BXC_FAMILY_RULES?.families?.[f];return r&&r.name?r.name:pretty(f)};
  const reagentSrc=srcs=>srcs.map(([f,cls])=>esc(famName(f))+(cls?' ('+esc(cls)+'s)':'')).join(', ');
  // for the Bestiary: the reagent(s) a monster of this family (and class) can drop
  globalThis.bxcReagentsFor=(family,npcClass)=>REAGENTS.filter(([,,src])=>src.some(([f,cls])=>f===family&&(!cls||cls===npcClass))).map(([id,kind])=>({id,kind}));
  globalThis.bxcReagentsByFamily=family=>REAGENTS.filter(([,,src])=>src.some(([f])=>f===family)).map(([id,kind,src])=>({id,kind,onlyClass:(src.find(([f])=>f===family)||[])[1]||null}));
  // ---- the Reforging & reagents guide (its own page since 7 Oct 2026; every number from the game's rules) -------------
  // Reroll odds (rules nm/$l/zl/Rr): your quality "pull" o = -0.1 + min(0.26, 0.13 x levels over the recipe / 15); a fresh
  // craft's roll is o plus the sum of three uniform draws (a smooth bell), compared with the quality thresholds Rr. A
  // reroll goes up when a fresh craft would be better than the piece, down one tier when it would be two or more worse.
  const RR_TH=[.05,.13,.28,.55,.71,.83,.965],RR_Q=['inferior','crude','shoddy','ordinary','good','excellent','superior','flawless'];
  const rrBell=(e,t)=>{const a=3*(e-t);if(a<=0)return 0;if(a>=3)return 1;const r=o=>o>0?o*o*o:0;return (r(a)-3*r(a-1)+3*r(a-2))/6};
  function rerollOdds(over,q){const o=-.1+Math.min(.26,.13*Math.max(0,over)/15),cdf=k=>k<0?0:k>=RR_TH.length?1:rrBell(RR_TH[k],o),i=RR_Q.indexOf(q),up=1-cdf(i),down=cdf(i-2);return {up,down,same:1-up-down}}
  globalThis.bxcRerollOdds=rerollOdds;
  // expected cost of infusing from one carat to another: each step costs (fee + reagent + gem) / chance on average
  function infuseRange(a,b){let gold=0,tries=0,first=1;for(let c=a;c<b;c++){const ch=RF_CHANCE[c-1];gold+=RF_FEE(c)/ch;tries+=1/ch;first*=ch}return {gold,tries,first}}
  const RF_STATIONS=[['Swords, daggers, maces, spears','Weapon smithing','anvil','smithing hammer'],['Plate armor and shields','Armor smithing','anvil','smithing hammer'],['Knick armor (caster cloth)','Tailoring','tailor’s bench','sewing kit'],['Pelt armor','Leatherworking','tanning rack','leatherworking awl'],['Bows, crossbows, staves','Bowyer','bowyer table','carving tool'],['Capes','Tailoring','tailor’s bench','sewing kit'],['Rings and pendants','Armor smithing','anvil','smithing hammer']];
  function reagentsHtml(){
    const ench=REAGENTS.filter(r=>r[1]==='enchant').map(([id,,src])=>{const what=Object.entries(RF_ENCH).filter(([,v])=>v[0]===id).map(([,v])=>esc(v[2])+' <span class="muted">+ '+esc(pretty(v[1].replace('gem-','')))+'</span>');const stones=Object.entries(RF_STONE).filter(([,r])=>r===id).map(([st])=>esc(pretty(st)));if(stones.length)what.push(stones.join(', ')+' rings and pendants');return [item(id),what.join('<br>'),reagentSrc(src)]});
    const qual=REAGENTS.filter(r=>r[1]==='quality').map(([id,,src])=>[item(id),esc(Object.entries(RF_LINE).filter(([,r])=>r===id).map(([l])=>RF_LINE_NAME[l]).join(', ')),reagentSrc(src)]);
    return `<h3>Enchant reagents (for infusing)</h3>`+table(['Reagent','Infuses <span class="muted">+ gem</span>','Dropped by'],ench)
      +`<h3>Gear-line reagents (for rerolling quality)</h3>`+table(['Reagent','Rerolls','Dropped by'],qual);
  }
  // ---- the Reforging guide's calculators (one per section; same rule numbers as the tables). Each is a .rf-calc box
  // with data-calc=kind; one delegated listener recomputes the box that changed (wired once), and every box on the page
  // is filled in right after it is drawn.
  const RF_METALS=[['iron','Iron',1],['silver','Silver',2],['gold','Gold',3],['titanium','Titanium',4]];
  const RF_PIECES=[...RF_METALS.map(([k,l,t])=>[k,l+' weapon or armor',t*3,t]),['cape','Cape',7,null],['ring','Ring or pendant',6,null]];
  const rfOpt=(v,l,sel)=>`<option value="${esc(v)}"${sel?' selected':''}>${esc(l)}</option>`;
  const rfNum=(id,label,val,min,max,step)=>`<label class="rf-f"><span>${esc(label)}</span><input type="number" data-k="${id}" value="${val}" min="${min}" max="${max}" step="${step||1}"></label>`;
  const rfSel=(id,label,opts)=>`<label class="rf-f"><span>${esc(label)}</span><select data-k="${id}">${opts}</select></label>`;
  function rfCalcHtml(kind){
    let f='';
    if(kind==='need'){
      const ench=Object.entries(RF_ENCH).map(([k,v])=>rfOpt('e:'+k,'Enchant: '+v[2])).join('');
      const stones=Object.keys(RF_STONE).map(st=>rfOpt('s:'+st,'Ring or pendant: '+pretty(st))).join('');
      const lines=Object.keys(RF_LINE).map(l=>rfOpt('l:'+l,'Reroll: '+RF_LINE_NAME[l])).join('');
      f=rfSel('what','I want to…',`<optgroup label="Infuse an enchant">${ench}</optgroup><optgroup label="Infuse a ring or pendant">${stones}</optgroup><optgroup label="Reroll the quality of">${lines}</optgroup>`);
    }else if(kind==='infuse'){
      f=rfSel('piece','Piece',RF_PIECES.map(([k,l],i)=>rfOpt(k,l,i===2)).join(''))+rfNum('from','From carats',6,1,11)+rfNum('to','To carats',9,2,12)+rfNum('reag','Reagent price',0,0,1e9,100)+rfNum('gem','Gem price',0,0,1e9,100);
    }else if(kind==='reenchant'){
      const g=(id,def)=>rfSel(id,'Gem '+id.slice(1),[.5,1,1.5,2,2.5,3,3.5,4].map(c=>rfOpt(c,c+'c',c===def)).join(''));
      f=rfSel('metal','Metal',RF_METALS.map(([k,l],i)=>rfOpt(k,l,i===2)).join(''))+rfNum('now','Carats it has now',6,1,12)+g('g1',3)+g('g2',3)+g('g3',3)+rfNum('gemp','Price of the 3 gems',0,0,1e9,100);
    }else if(kind==='reroll'){
      f=rfSel('metal','Metal',RF_METALS.map(([k,l],i)=>rfOpt(k,l,i===2)).join(''))+rfNum('lvl','Your trade level',50,1,100)
        +rfSel('q','Current quality',RR_Q.slice(0,6).map((q,i)=>rfOpt(q,pretty(q),i===3)).join(''))
        +rfSel('t','Target quality',RR_Q.slice(1,7).map((q,i)=>rfOpt(q,pretty(q),q==='excellent')).join(''))+rfNum('reag','Reagent price',0,0,1e9,100);
    }
    return `<div class="rf-calc calcbox" data-calc="${kind}"><div class="rf-calc-h">Calculator</div><div class="rf-fields">${f}</div><div class="rf-out"></div></div>`;
  }
  const rfVal=(box,k)=>{const el=box.querySelector(`[data-k="${k}"]`);return el?el.value:''};
  const rfNumV=(box,k,lo,hi)=>Math.max(lo,Math.min(hi,Number(rfVal(box,k))||0));
  // average tries to climb from quality i to target t, with this many levels over the recipe: E[t]=0 and
  // E[i] = (1 + up*E[i+1] + down*E[i-1]) / (up+down) - solved by walking E as a line in E[0] (inferior can't drop)
  function rerollTries(over,i,t){
    if(i>=t)return 0;const N=t;const A=[],B=[];   // E[k] = A[k] + B[k]*E[0]
    A[0]=0;B[0]=1;
    for(let k=0;k<N;k++){const r=rerollOdds(over,RR_Q[k]);if(r.up<=0)return Infinity;const prevA=k?A[k-1]:0,prevB=k?B[k-1]:0;
      // up*E[k+1] = (up+down)*E[k] - 1 - down*E[k-1]
      A[k+1]=((r.up+r.down)*A[k]-1-r.down*prevA)/r.up;B[k+1]=((r.up+r.down)*B[k]-r.down*prevB)/r.up}
    const e0=-A[N]/B[N];return Math.max(0,A[i]+B[i]*e0);
  }
  function rfRun(box){
    const out=box.querySelector('.rf-out');if(!out)return;const kind=box.dataset.calc;
    try{
      if(kind==='need'){
        const [t,k]=String(rfVal(box,'what')).split(':');let rid,gem,uses;
        if(t==='e'){rid=RF_ENCH[k][0];gem=RF_ENCH[k][1];uses='infuse '+RF_ENCH[k][2]}
        else if(t==='s'){rid=RF_STONE[k];gem='gem-'+k;uses='infuse '+pretty(k)+' rings and pendants'}
        else{rid=RF_LINE[k];gem=null;uses='reroll the quality of '+RF_LINE_NAME[k]}
        const r=REAGENTS.find(x=>x[0]===rid);
        out.innerHTML=`<p>To ${esc(uses)} you need <b>${item(rid)}</b>${gem?` and a ${item(gem,pretty(gem.replace('gem-','')))} of the right size (see Infuse)`:''}, plus the gold fee.</p><p>It drops from <b>${reagentSrc(r?r[2]:[])}</b>, rarely on any kill and far more often from elites. Their monster pages in the Bestiary show where they live.</p>`;
      }else if(kind==='infuse'){
        const p=RF_PIECES.find(x=>x[0]===rfVal(box,'piece'))||RF_PIECES[0],cap=p[2];
        const from=rfNumV(box,'from',1,cap-1),to=rfNumV(box,'to',from+1,cap),reag=rfNumV(box,'reag',0,1e9),gp=rfNumV(box,'gem',0,1e9);
        let gold=0,tries=0,first=1;const rows=[];
        for(let c=from;c<to;c++){const ch=RF_CHANCE[c-1],t=1/ch,cost=(RF_FEE(c)+reag+gp)*t;gold+=cost;tries+=t;first*=ch;rows.push([c+'c → '+(c+1)+'c',Math.round(ch*100)+'%',RF_GEM(c)+'c+',t.toFixed(2),n(Math.round(cost))])}
        const lvl=p[3]?[16,31,46,61][p[3]-1]:(to<=3?16:to<=6?31:46);
        out.innerHTML=`${table(['Step','Chance','Gem','Tries (avg)','Cost (avg)'],rows)}<p><b>${n(Math.round(gold))} gold</b> on average${reag||gp?' (fees, reagents and gems)':' in fees (add your reagent and gem prices above)'}, using about <b>${tries.toFixed(1)} reagents</b> and <b>${tries.toFixed(1)} gems</b>. Every step working first time: ${first<.01?'under 1%':Math.round(first*100)+'%'}. Needs trade level <b>${lvl}</b>. The cap for this piece is <b>${cap}c</b>.</p>`;
      }else if(kind==='reenchant'){
        const m=RF_METALS.find(x=>x[0]===rfVal(box,'metal'))||RF_METALS[0],tier=m[2],cap=tier*3,now=rfNumV(box,'now',1,cap);
        const gems=['g1','g2','g3'].map(k=>Number(rfVal(box,k))||0),big=gems.filter(c=>c>tier),sum=gems.reduce((a,b)=>a+b,0),res=Math.min(cap,Math.floor(sum)),gp=rfNumV(box,'gemp',0,1e9);
        let msg;
        if(big.length)msg=`<p class="bad">A ${esc(m[1].toLowerCase())} piece takes gems of at most <b>${tier}c</b> each.</p>`;
        else if(res<now)msg=`<p class="bad">Not allowed: these gems make <b>${res}c</b>, below the <b>${now}c</b> it has now. Re-enchanting can’t lower a piece.</p>`;
        else msg=`<p>The gems add up to ${sum}c, so it ends at <b>${res}c</b>${sum>cap?` (the ${esc(m[1].toLowerCase())} cap)`:''}. Fee <b>${n(2000*res)} gold</b>${gp?`, <b>${n(2000*res+gp)}</b> with the gems`:''}. Needs the enchanting level for ${esc(m[1].toLowerCase())}: <b>${[16,31,46,61][tier-1]}</b>.</p>`;
        out.innerHTML=msg;
      }else if(kind==='reroll'){
        const m=RF_METALS.find(x=>x[0]===rfVal(box,'metal'))||RF_METALS[0],rec=[1,16,31,46][m[2]-1],lvl=rfNumV(box,'lvl',1,100),over=Math.max(0,lvl-rec);
        const q=rfVal(box,'q'),t=rfVal(box,'t'),qi=RR_Q.indexOf(q),ti=RR_Q.indexOf(t),reag=rfNumV(box,'reag',0,1e9),fee=RF_REROLL_FEE[m[2]-1];
        if(lvl<rec){out.innerHTML=`<p class="bad">Rerolling ${esc(m[1].toLowerCase())} gear takes trade level <b>${rec}</b>.</p>`;return}
        const r=rerollOdds(over,q);
        let tail='';
        if(ti<=qi)tail=`<p>Pick a target above ${esc(pretty(q))}.</p>`;
        else{const e=rerollTries(over,qi,ti);tail=isFinite(e)?`<p>Reaching <b>${esc(pretty(t))}</b> takes about <b>${e.toFixed(1)} rerolls</b> on average (drops included), about <b>${n(Math.round(e*(fee+reag)))} gold</b>${reag?'':' in fees'}.</p>`:`<p class="bad">${esc(pretty(t))} can’t be reached at this level.</p>`}
        out.innerHTML=`<p>You are <b>${over}</b> levels over the recipe (${rec})${over>30?', past the +30 cap':''}. Each reroll of ${/^[aeiou]/i.test(q)?'an':'a'} ${esc(q)} piece: <b>${Math.round(r.up*100)}%</b> up, ${Math.round(r.same*100)}% stays, <b>${Math.round(r.down*100)}%</b> down. Fee <b>${n(fee)} gold</b> + a reagent.</p>`+tail;
      }
    }catch(e){out.innerHTML='<p class="muted">Couldn’t work this out.</p>'}
  }
  const rfRunAll=()=>document.querySelectorAll('.rf-calc').forEach(rfRun);
  if(!globalThis.__rfWired){globalThis.__rfWired=true;const on=e=>{const b=e.target&&e.target.closest&&e.target.closest('.rf-calc');if(b)rfRun(b)};document.addEventListener('input',on);document.addEventListener('change',on)}
  // ---- "Try it" (9 Oct 2026): a working copy of the game's Reforge tab (StationViewTabs in the client: Infuse /
  // Re-enchant / Reroll, the same wording and buttons, and its overlay - the piece lit from the top by a bright edge,
  // then a coloured outcome). Rolls with the rule numbers above and keeps the result on your piece, with a tally.
  const RF_SIM_ART={iron:'iron-longsword',silver:'silver-longsword',gold:'gold-longsword',titanium:'titanium-longsword',cape:'cape',ring:'gold-ring'};
  function rfSimHtml(){
    return `<div class="rf-sim" data-tab="infuse">
      <div class="rf-sim-setup">
        <label class="rf-f"><span>Piece</span><select data-s="piece">${RF_PIECES.map(([k,l],i)=>rfOpt(k,l,i===2)).join('')}</select></label>
        <label class="rf-f"><span>Carats now</span><input type="number" data-s="c" value="6" min="1" max="12"></label>
        <label class="rf-f"><span>Quality now</span><select data-s="q">${RR_Q.map((q,i)=>rfOpt(q,pretty(q),i===3)).join('')}</select></label>
        <label class="rf-f"><span>Your trade level</span><input type="number" data-s="lvl" value="50" min="1" max="100"></label>
      </div>
      <div class="rf-sim-win">
        <div class="rf-sim-tabs"><span class="rf-sim-t">Craft</span><span class="rf-sim-t on">Reforge</span></div>
        <div class="rf-sim-sub">${[['infuse','Infuse'],['reenchant','Re-enchant'],['reroll','Reroll']].map(([k,l])=>`<button type="button" data-tab="${k}"${k==='infuse'?' class="on"':''}>${l}</button>`).join('')}</div>
        <div class="rf-sim-card"><img class="rf-sim-ico" alt=""><div><div class="rf-sim-name"></div><div class="rf-sim-meta"></div></div></div>
        <div class="rf-sim-det"></div>
        <div class="rf-sim-ov" hidden><div class="rf-sim-big"><img class="rf-sim-base" alt=""><div class="rf-sim-lit"><img alt=""></div><div class="rf-sim-edge"></div></div><p class="rf-sim-ovname"></p><p class="rf-sim-cap"></p></div>
      </div>
      <div class="rf-sim-tally"></div>
    </div>`;
  }
  const rfSimState=new WeakMap();
  function rfSimPiece(box){
    const p=RF_PIECES.find(x=>x[0]===box.querySelector('[data-s="piece"]').value)||RF_PIECES[0];
    const cap=p[2],c=Math.max(1,Math.min(cap,Number(box.querySelector('[data-s="c"]').value)||1));
    return {key:p[0],label:p[1],cap,tier:p[3],c,q:box.querySelector('[data-s="q"]').value,lvl:Math.max(1,Math.min(100,Number(box.querySelector('[data-s="lvl"]').value)||1))};
  }
  function rfSimDraw(box){
    const st=rfSimState.get(box)||{tries:0,gold:0,reag:0,gems:0,log:[]};rfSimState.set(box,st);
    const P=rfSimPiece(box),tab=box.dataset.tab,art=itemImgSafe(RF_SIM_ART[P.key]);
    box.querySelectorAll('.rf-sim-sub button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
    box.querySelectorAll('.rf-sim-ico,.rf-sim-base,.rf-sim-lit img').forEach(i=>{i.src=art});
    box.querySelector('.rf-sim-name').textContent=P.label;
    box.querySelector('.rf-sim-meta').innerHTML=`<span class="q-name q-${esc(P.q)}">${esc(pretty(P.q))}</span> · ${P.c}c · cap ${P.cap}c`;
    const needLvl=P.tier?[16,31,46,61][P.tier-1]:(P.c<3?16:P.c<6?31:46);
    let html='',act=null;
    if(tab==='infuse'){
      if(P.c>=P.cap)html=`<p class="rf-sim-msg">This piece is at its cap (${P.cap}c).</p>`;
      else{const ch=RF_CHANCE[P.c-1],fee=RF_FEE(P.c),gem=RF_GEM(P.c);
        html=`<p class="rf-sim-msg">Choose a gem of ${gem} carats or more.</p><p class="rf-sim-odds">${Math.round(ch*100)}% to reach ${P.c+1}c · ${n(fee)} gold</p>`+(P.lvl<needLvl?`<p class="rf-sim-warn">Needs level ${needLvl}</p>`:'');
        act={label:`Infuse for ${n(fee)} gold`,fee,reag:1,gems:1,roll:()=>Math.random()<ch?'up':'fail'}}
    }else if(tab==='reenchant'){
      if(P.key==='cape'||P.key==='ring')html=`<p class="rf-sim-msg">Capes, rings and pendants can’t be re-enchanted. Infuse them instead.</p>`;
      else{const fee=2000*P.c;html=`<p class="rf-sim-msg">Three new gems that add up to at least ${P.c}c (each at most ${P.tier}c) change the enchant and keep the carats.</p><p class="rf-sim-odds">New enchant at ${P.c}c · ${n(fee)} gold</p>`;
        act={label:`Re-enchant for ${n(fee)} gold`,fee,reag:0,gems:3,roll:()=>'same',sameText:'Enchant changed'}}
    }else{
      const rec=P.tier?[1,16,31,46][P.tier-1]:null,qi=RR_Q.indexOf(P.q);
      if(!P.tier)html=`<p class="rf-sim-msg">Capes, rings and pendants can’t be rerolled.</p>`;
      else if(qi>=6)html=`<p class="rf-sim-msg">${esc(pretty(P.q))} pieces can’t be rerolled.</p>`;
      else if(P.lvl<rec)html=`<p class="rf-sim-warn">Rerolling ${esc(P.key)} gear needs level ${rec}.</p>`;
      else{const r=rerollOdds(P.lvl-rec,P.q),fee=RF_REROLL_FEE[P.tier-1];
        html=`<p class="rf-sim-odds">Up ${Math.round(r.up*100)}% · Same ${Math.round(r.same*100)}% · Down ${Math.round(r.down*100)}%</p>`;
        act={label:`Reroll for ${n(fee)} gold`,fee,reag:1,gems:0,roll:()=>{const x=Math.random();return x<r.up?'up':x<r.up+r.down?'down':'same'}}}
    }
    box.querySelector('.rf-sim-det').innerHTML=html+(act?`<button type="button" class="rf-sim-go">${esc(act.label)}</button>`:'');
    box._rfAct=act;
    box.querySelector('.rf-sim-tally').innerHTML=st.tries?`<span><b>${st.tries}</b> ${st.tries===1?'try':'tries'}</span><span><b>${n(st.gold)}</b> gold</span><span><b>${st.reag}</b> reagent${st.reag===1?'':'s'}</span><span><b>${st.gems}</b> gem${st.gems===1?'':'s'}</span><span class="rf-sim-log">${st.log.slice(-6).map(esc).join(' · ')}</span><button type="button" class="rf-sim-reset">Reset</button>`:'<span class="muted">Press the gold button to try it. Each try uses the game’s own chances.</span>';
  }
  const itemImgSafe=id=>{try{return typeof itemImg==='function'?itemImg({id,typeId:id,item:pretty(id)}):''}catch{return ''}};
  function rfSimGo(box){
    const act=box._rfAct;if(!act||box.dataset.busy)return;
    const st=rfSimState.get(box),P=rfSimPiece(box),out=act.roll();
    st.tries++;st.gold+=act.fee;st.reag+=act.reag;st.gems+=act.gems;
    const ov=box.querySelector('.rf-sim-ov'),cap=box.querySelector('.rf-sim-cap');
    box.querySelector('.rf-sim-ovname').textContent=P.label;
    let text,kind;
    if(box.dataset.tab==='infuse'){if(out==='up'){kind='success';text=`Infused to ${P.c+1}c`;box.querySelector('[data-s="c"]').value=P.c+1}else{kind='fail';text='The infusion failed. The piece is unharmed.'}}
    else if(box.dataset.tab==='reenchant'){kind='success';text=act.sameText}
    else{const i=RR_Q.indexOf(P.q);if(out==='up'){kind='success';text='Now '+pretty(RR_Q[i+1]);box.querySelector('[data-s="q"]').value=RR_Q[i+1]}else if(out==='down'){kind='fail';text='Dropped to '+pretty(RR_Q[i-1]);box.querySelector('[data-s="q"]').value=RR_Q[i-1]}else{kind='neutral';text='Quality unchanged'}}
    st.log.push(text.replace(/\. The piece is unharmed\./,''));
    const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.dataset.busy='1';ov.hidden=false;ov.className='rf-sim-ov running';cap.textContent='';
    setTimeout(()=>{ov.className='rf-sim-ov '+kind;cap.textContent=text;
      setTimeout(()=>{ov.hidden=true;delete box.dataset.busy;rfSimDraw(box)},reduce?900:1700)},reduce?150:1500);
  }
  const rfSimAll=()=>document.querySelectorAll('.rf-sim').forEach(rfSimDraw);
  if(!globalThis.__rfSimWired){globalThis.__rfSimWired=true;
    document.addEventListener('click',e=>{const box=e.target.closest&&e.target.closest('.rf-sim');if(!box)return;
      const t=e.target.closest('[data-tab]');if(t&&t.tagName==='BUTTON'){box.dataset.tab=t.dataset.tab;rfSimDraw(box);return}
      if(e.target.closest('.rf-sim-go')){rfSimGo(box);return}
      if(e.target.closest('.rf-sim-reset')){rfSimState.delete(box);rfSimDraw(box)}});
    const ch=e=>{const box=e.target.closest&&e.target.closest('.rf-sim');if(box&&!box.dataset.busy)rfSimDraw(box)};
    document.addEventListener('input',ch);document.addEventListener('change',ch)}
  const RF_CALC={reagents:'need',infuse:'infuse',reenchant:'reenchant',reroll:'reroll'};
  reg({slug:'reforging',group:'Gear, gems & enchanting',title:'Reforging & reagents',blurb:'Infuse, re-enchant and reroll gear with monster reagents: every chance, cost and level.',build:()=>{
    const ROLL_Q=['inferior','crude','shoddy','ordinary','good','excellent'],OVER=[0,5,10,15,20,25,30];
    const pc=v=>Math.round(v*100)+'%';
    const rrRows=ROLL_Q.map(q=>[`<span class="q-name q-${q}">${esc(pretty(q))}</span>`,...OVER.map(d=>{const r=rerollOdds(d,q);return `<b>${pc(r.up)}</b> <span class="muted">/ ${pc(r.down)}</span>`})]);
    const stepRows=RF_CHANCE.map((ch,i)=>{const c=i+1;return [c+'c → '+(c+1)+'c',pc(ch),n(RF_FEE(c)),RF_GEM(c)+'c or more',(1/ch).toFixed(2),n(Math.round(RF_FEE(c)/ch))]});
    const ranges=[[1,3,'Iron: 1c to its cap'],[3,6,'Silver: 3c to its cap'],[6,9,'Gold: 6c to its cap'],[9,12,'Titanium: 9c to its cap'],[1,12,'Titanium: all the way, 1c to 12c']];
    const rangeRows=ranges.map(([a,b,label])=>{const r=infuseRange(a,b);return [esc(label),a+'c → '+b+'c',n(Math.round(r.gold)),r.tries.toFixed(1),r.tries.toFixed(1),r.first<.01?"under 1%":pc(r.first)]});
    const ex=infuseRange(6,9);
    const RF_PAGE={lede:'Since 5 October 2026 a finished piece of gear isn’t final: rare <b>reagents</b> from monsters let you <b>infuse</b> its enchant one carat higher, <b>re-enchant</b> it with new gems, or <b>reroll</b> its quality. This page has every chance, cost and level, straight from the game’s rules.',sections:[
      ['what','What reforging is',`<p>The <b>anvil, tailor’s bench, tanning rack and bowyer table</b> each have a <b>Reforge</b> tab with three actions: <b>Infuse</b> (+1 carat to the enchant), <b>Re-enchant</b> (three new gems) and <b>Reroll</b> (a new quality roll). You work a piece at the station of the trade that makes it, with that trade’s <b>tool equipped</b> and the piece <b>in your bag</b>.</p>`
        +table(['Gear','Trade','Station','Tool'],RF_STATIONS.map(r=>r.map(esc)))
        +`<ul class="g-list"><li><b>Can be reforged:</b> weapons, shields, and plate, knick and pelt armor of <b>iron or better</b>, plus capes, rings and pendants.</li><li><b>Can’t:</b> basic (tier 0) gear and clothing.</li><li>A successful infuse or re-enchant pays trade XP.</li></ul>`],
      ['station','Try it at the station',`<p>A working copy of the game’s <b>Reforge</b> tab. Set up a piece, pick <b>Infuse</b>, <b>Re-enchant</b> or <b>Reroll</b>, and press the gold button: it rolls with the game’s own chances, keeps the result on your piece and adds up what it cost. Nothing here touches your real gear.</p>`+rfSimHtml()],
      ['reagents','Reagents',`<p>Every monster kind that feeds a reagent has a <b>small chance</b> to drop it on any kill. <b>Elites drop them far more often</b>, and an <b>elite boss drops every reagent its kind carries</b>. Reagents <b>don’t stack</b>: each takes its own bag slot and trades on the Exchange one at a time, so you can buy the one you need. Hover one in the game to see what it is for. Drop chances aren’t published.</p><p>There are two kinds: an <b>enchant reagent</b> belongs to an enchantment (and to the ring and pendant stones), a <b>gear-line reagent</b> to a kind of gear. Each monster page in the Bestiary says which reagent it drops.</p>`+reagentsHtml()],
      ['infuse','Infuse: +1 carat',`<p>Infusing raises a piece’s enchant by <b>one carat</b>. It takes three things: the enchant’s <b>reagent</b>, <b>one gem of the same kind</b> (a ruby for Flame, a topaz for Titan, and so on, see the table above) at least the size shown below, and a <b>gold fee</b>. The higher the carat, the lower the chance.</p>
        <p>A <b>failure</b> uses up the reagent, the gem and the gold, but <b>never harms the piece</b>: it keeps its carats and quality, and you simply try again.</p>`
        +table(['Step','Chance','Fee (gold)','Smallest gem','Tries (avg)','Gold per carat (avg)'],stepRows)
        +`<ul class="g-list"><li><b>The cap</b> is set by the material: weapons and armor hold <b>3 carats per metal tier</b> (iron 3, silver 6, gold 9, titanium 12); capes 7; rings and pendants 6.</li>
          <li><b>Level needed:</b> the trade level for enchanting that metal: <b>16</b> iron, <b>31</b> silver, <b>46</b> gold, <b>61</b> titanium. Capes, rings and pendants: <b>16</b> up to 3c, <b>31</b> up to 6c, <b>46</b> for 7c.</li>
          <li>Rings and pendants infuse with <b>their stone’s reagent</b> and a gem of that stone.</li>
          <li>“Tries (avg)” is 1 ÷ the chance: on average that many reagents and gems go into each carat.</li></ul>
        <h3>What a whole upgrade costs</h3><p>Averages over many tries; your luck will vary. Add the reagents and gems at your own prices (the <a href="#/calc-quality">Quality calculator</a>’s infusing planner does it for you).</p>`
        +table(['Upgrade','Carats','Fees (avg gold)','Reagents (avg)','Gems (avg)','All first try'],rangeRows)
        +`<p class="g-note"><b>Example:</b> a gold sword of the Flame at 6c, infused to 9c, takes on average <b>${n(Math.round(ex.gold))} gold</b> in fees and about <b>${ex.tries.toFixed(1)} Ember Glands</b> and <b>${ex.tries.toFixed(1)} rubies</b> (2c, 2c and 2.5c or bigger), and a ${esc(pretty('weapon-smithing'))} level of 46. There is a ${pc(ex.first)} chance every step works the first time.</p>`],
      ['reenchant','Re-enchant: new gems',`<p>Re-enchanting puts <b>three new gems</b> on a piece under the same rules as enchanting something new (see ${guide('quality-and-enchanting')}), so you can <b>change which enchant</b> it has. It needs <b>no reagent</b>, just the gems and a fee of <b>2,000 gold for every carat the piece ends up with</b>.</p>`
        +table(['Ends at','Fee'],[[3,6,9,12].map(c=>[c+'c',n(2000*c)])].flat())
        +`<ul class="g-list"><li>It <b>can’t leave the piece lower</b> than the carats it has now, so the three gems together must add up to at least that.</li><li>The piece must <b>already carry an enchant</b>, and you need the trade’s enchanting level for its metal.</li><li><b>Capes, rings and pendants</b> can’t be re-enchanted (infuse them instead).</li><li>Use it to <b>swap</b> an enchant for another (Freezing for Flame, say) without losing carats; use Infuse to make the one you have stronger.</li></ul>`],
      ['reroll','Reroll: a new quality',`<p>Rerolling uses the piece’s <b>gear-line reagent</b> (a Dune Whetstone for swords, a Grave Rivet for plate, …) to roll its quality again, <b>the way it would come out if you crafted it now</b>. The game rolls a fresh craft at your skill and compares:</p>
        <ul class="g-list"><li>fresh craft <b>better</b> than the piece → the piece goes <b>up one tier</b>;</li><li>fresh craft <b>two or more tiers worse</b> → it goes <b>down one tier</b>;</li><li>otherwise it <b>stays</b>.</li></ul>
        <p>So only your <b>skill over the recipe</b> matters: your trade level minus the level the piece needs (iron 1, silver 16, gold 31, titanium 46). It stops improving at <b>+30</b>. The game’s Reforge panel shows these same odds before you commit.</p>`
        +table(['Current','+0','+5','+10','+15','+20','+25','+30 or more'],rrRows)
        +`<p class="g-note">Each cell is <b>up</b> / <span class="muted">down</span>; the rest of the time it stays.</p>`
        +table(['Metal','Reroll fee (gold)','Level needed'],[['Iron','1,000','1'],['Silver','1,500','16'],['Gold','2,000','31'],['Titanium','3,000','46']])
        +`<ul class="g-list"><li><b>Inferior, crude and shoddy</b> go up almost every time at any level.</li><li><b>Ordinary → good</b> is safe and worth it from about +15 (46% up, no risk).</li><li><b>Excellent</b> is a gamble even at the cap: 16% to reach superior against 26% to fall to good. Don’t reroll an excellent piece you like.</li><li><b>Superior and flawless</b> can’t be rerolled, and neither can capes.</li></ul>`],
      ['plan','Planning',`<ul class="g-list"><li>Infusing high carats is where the gold goes: the last three titanium carats (9c → 12c) cost more in fees than the first nine together (about 78,000 against 53,000 gold on average).</li><li>Farm <b>elites</b> of the right family for reagents, or buy them on the Exchange; they trade one at a time.</li><li>Quality and carats are <b>separate</b>: a reroll never touches the enchant and an infuse never changes the quality, so do them in any order.</li><li>The <a href="#/calc-quality">Quality calculator</a> has an infusing planner with your own reagent and gem prices.</li></ul>`+note('Chances, fees, gem sizes, caps, levels and the reroll formula are from the game’s own rules (5 October 2026 update). Reagent drop chances and XP amounts aren’t published.')]
    ],related:['quality-and-enchanting','gems','monster-families']};
    for(const sec of RF_PAGE.sections)if(RF_CALC[sec[0]])sec[2]+=rfCalcHtml(RF_CALC[sec[0]]);
    setTimeout(()=>{rfRunAll();rfSimAll()},0);
    return RF_PAGE}});
  // ---- Crafting skills ----------------------------------------------------------------------------------------------
  const craft=(slugName,skill,title,blurb,lede,related,extra)=>reg({slug:slugName,group:'Crafting skills',title,blurb,build:craftingGuide({skill,lede,related,extra})});
  reg({slug:'smelting',group:'Crafting skills',title:'Smelting',blurb:'Turning ore into bars.',build:craftingGuide({skill:'Smelting',station:'furnace',noTomes:true,lede:'Smelt ore into metal bars at a furnace, the first step of every smithing skill. Higher metals take some iron as well.',how:`<li>Smelting pays a little XP; most of a smith’s XP comes from forging (see ${guide('weapon-smithing')}).</li><li>The recipes below come from the game’s data. (The official guide’s pages disagree with each other on how much iron the higher bars take.)</li>`,related:['mining','weapon-smithing','armor-smithing','tool-smithing']})});
  reg({slug:'weapon-smithing',group:'Crafting skills',title:'Weapon smithing',blurb:'Swords, daggers, maces and spears from bars.',build:craftingGuide({skill:'Weapon Smithing',station:'anvil',tool:'smithing hammer',tomeLine:'Ogres drop gold and titanium tomes more often than most.',how:'<li>A failed forge destroys the bars. Forging pays the XP, and only on a success.</li><li>Rapiers and kryss can’t be forged; they only drop from monsters.</li>',lede:'Forge metal weapons from bars. Higher levels unlock better metals, and the material decides the weapon’s damage.',related:['combat','smelting','quality-and-enchanting'],extra:()=>[['gear','Quality and enchanting',`<p>Every weapon you forge rolls a quality, and can later be enchanted. See ${guide('quality-and-enchanting')}.</p>`]]})});
  reg({slug:'armor-smithing',group:'Crafting skills',title:'Armor smithing',blurb:'Plate armor, shields and rings from bars.',build:craftingGuide({skill:'Armor Smithing',station:'anvil',tool:'smithing hammer',tomeLine:'Ogres drop gold and titanium tomes more often than most.',how:`<li>A failed forge destroys the bars. Rings are forged here too (see ${guide('gems')}). Full and spiked helms only drop from monsters.</li>`,lede:'Forge plate armor, shields and rings from bars.',related:['armor','smelting','quality-and-enchanting'],extra:()=>[['gear','Quality and enchanting',`<p>Armor rolls a quality too, and takes the stat enchantments (Strength, Dexterity, Intellect and more). See ${guide('quality-and-enchanting')} and ${guide('armor')}.</p>`]]})});
  reg({slug:'tool-smithing',group:'Crafting skills',title:'Tool smithing',blurb:'Pickaxes, axes, rods and every other trade tool.',build:craftingGuide({skill:'Tool Smithing',station:'anvil',tool:'smithing hammer',how:`<li>Iron tools are sold by trade vendors; silver, gold and titanium ones are made by players. The handle wood matches the metal.</li><li>A tool’s metal adds to the success chance of the trade it serves: silver <b>+3%</b>, gold <b>+7%</b>, titanium <b>+12%</b> (usable at that trade’s level 15, 30 and 45). Its quality scales that bonus.</li><li>One gem set while forging (<b>of the Artisan</b>) adds 5% per carat, up to 1/2/3/4 carats for iron/silver/gold/titanium; you must be able to forge the tool one metal higher.</li><li>Above the 95% cap the bonus turns into extra yield for gatherers, and sometimes returned materials for crafters.</li>`,lede:'Make the tools every other trade works with. A better tool raises the success chance of the trade it serves.',related:['mining','lumberjack','fishing','quality-and-enchanting']})});
  reg({slug:'bowyer',group:'Crafting skills',title:'Bowyer',blurb:'Bows, crossbows, staves and arrows from wood and wool.',build:craftingGuide({skill:'Bowyer',station:'bowyer table',tool:'carving tool',tomeLine:'Treants drop oak and black walnut tomes more often.',how:'<li>Carving takes 4 seconds plus 2 per log. Woods above pine also need extra wool.</li><li>One pine log and two feathers make <b>10 arrows or bolts</b>.</li><li>From level 15 you can carve a <b>staff</b> from 8 logs of any wood; enchanting it ties it to a magic school.</li><li>A failure loses the materials.</li>',lede:'Carve bows and crossbows from wood and wool. The wood tier decides the damage.',related:['lumberjack','shearing','combat','quality-and-enchanting']})});
  reg({slug:'tailoring',group:'Crafting skills',title:'Tailoring',blurb:'Knick armor for casters, from monster materials and wool.',build:craftingGuide({skill:'Tailoring',station:'tailor’s bench',tool:'sewing kit',tomeLine:'Red dragons drop dragonscale tomes more often.',how:'<li>Knicks (impfeather, snakeskin, ogrewax, dragonscale) drop from monsters. Higher tiers also take more wool.</li><li>A failure loses the materials.</li>',lede:'Sew knick armor, the caster’s armor with the best magic defense, from monster materials and wool.',related:['armor','shearing','quality-and-enchanting']})});
  reg({slug:'leatherworking',group:'Crafting skills',title:'Leatherworking',blurb:'Pelt armor for archers, from monster hides.',build:craftingGuide({skill:'Leatherworking',station:'tanning rack',tool:'leatherworking awl',tomeLine:'Red dragons drop dragonhide tomes more often.',how:'<li>Deer drop deerhide and bears drop bearhide. The official guide says no monster drops werewolf pelt or dragonhide yet.</li><li>A failure loses the materials.</li>',lede:'Work monster hides into pelt armor, the archer’s balanced armor.',related:['armor','shearing','quality-and-enchanting']})});
  reg({slug:'cooking',group:'Crafting skills',title:'Cooking',blurb:'Cooking fish and meat, what it heals, and lighting your own fire.',build:craftingGuide({skill:'Cooking',noTomes:true,station:'fire',how:`<li>Everyone knows Cooking; it costs no skill point.</li><li>Fish need a <b>frying pan</b> in your off-hand; meat doesn’t. Better pans burn less and sometimes give an extra piece.</li><li>Cook up to 10 at once, or drag a stack onto the fire.</li><li>The burn chance never drops below 1 in 20.</li>`,extra:()=>[['heals','What food heals',table(['Food','Level','Heals','XP'],[['Cooked catfish','1','15','12'],['Cooked bass','15','30','28'],['Cooked trout','30','60','60'],['Cooked salmon','45','100','130'],['Chicken, rabbit, frog legs, crab','1','5 (2 raw)','7'],['Wolf meat, venison','2','6 (3 raw)','8'],['Boar','3','7 (3 raw)','8'],['Snake','4','8 (3 raw)','9'],['Bear','7','16 (6 raw)','11']])+note('From the official guide. Food heals health, stamina and mana by the same amount: 20% at once and the rest over 5 seconds.')],['fire','Lighting your own fire',`<p>Buy tinder from the vendor next to the Fishing Trainer and use <b>Light Fire</b> on a log (3 seconds, outdoors only, one fire each). Better logs burn longer and cook better.</p>`+table(['Log','Level','Cooking chance','Burns for','XP'],[['Pine','1','−10%','45 s','3'],['Oak','15','±0','1 m 30 s','7'],['Black walnut','30','+5%','2 m 30 s','15'],['Shagbark','45','+10%','4 m','32']])]],lede:'Cook fish and meat into food that heals you. Low-level cooks burn food; the chance of burning falls as you level until it stops.',chanceNote:'Cooking does not fail the usual way: food can burn. The burn chance starts at the recipe’s level and falls to nothing at the “Sure at” level shown.',related:['fishing']})});

  // ---- Carpentry (1 Oct 2026, "Homes of Your Own"): recipes from the game's rules (game-recipes.js, skill Carpentry,
  // with station/group/tier); the house stages and upgrades are the rules' own numbers (qg stages, je upgrades: 75 XP an
  // action, 1 plank each and fittings every 4th, 10,000 platinum an upgrade).
  const HOME_STEPS=[
    {name:'Pine Cottage',lvl:1,wood:'pine',metal:'iron',actions:600,plat:10000,platNote:'the lot',stages:'foundation 120, frame 180, enclosure 300'},
    {name:'Oak House',lvl:15,wood:'oak',metal:'silver',actions:720,plat:10000},
    {name:'Walnut Manor',lvl:30,wood:'black-walnut',metal:'gold',actions:1200,plat:10000},
    {name:'Shagbark Estate',lvl:45,wood:'shagbark',metal:'titanium',actions:1440,plat:10000}];
  reg({slug:'carpentry',group:'Crafting skills',title:'Carpentry',blurb:'Planks, fittings, furniture, crafting stations and building your own home.',build:()=>{
    const rs=recipesFor('Carpentry'),by=g=>rs.filter(r=>(r.group||'furniture')===g);
    const rows=list=>list.map(r=>[n(r.level),item(r.id,r.item)+(r.out>1?` <span class="muted">×${r.out}</span>`:''),n(r.xp),ingList(r)]);
    const tbl=list=>list.length?table(['Level','Makes','XP','Needs'],rows(list)):'<p class="muted">Not in the game data yet.</p>';
    const fit=m=>m+'-fittings',pl=w=>w+'-plank';
    const homeRows=HOME_STEPS.map(h=>{const f=Math.floor(h.actions/4);return [`<b>${esc(h.name)}</b>${h.stages?`<br><span class="muted">${esc(h.stages)}</span>`:''}`,n(h.lvl),n(h.actions),`${n(h.actions)}× ${item(pl(h.wood))}<br>${n(f)}× ${item(fit(h.metal))}`,`${n(h.actions*2)}× ${item(h.wood+'-wood')}<br>${n(f)}× ${item(h.metal+'-ore')}`,n(h.actions*75),n(h.plat)+(h.platNote?` <span class="muted">(${h.platNote})</span>`:'')]});
    const tot=k=>HOME_STEPS.reduce((a,h)=>a+(k==='f'?Math.floor(h.actions/4):h.actions),0);
    return {lede:'Carpentry saws logs into planks, hammers ore into fittings, and turns both into furniture, crafting stations and a home of your own. It never fails, and every action that builds a house pays the same 75 XP.',sections:[
      ['how','How it works',`<ul class="g-list">
        <li><b>Learn it</b> from <b>Hollis Tamber</b>, a carpenter at Plymouth Wharf, in the quest <a href="#/guide/quest-plymouth-carpenters-trade">The Carpenter’s Trade</a>. It is the only way to learn Carpentry, and it costs no skill point. He gives you a saw, a smithing hammer, 20 pine logs and 5 iron ore when you take it: exactly enough for the 10 planks and 5 sets of fittings it asks for.</li>
        <li><b>Planks, furniture, stations and garden pieces</b> are made at a <b>sawmill</b> with a <b>saw</b> equipped (tools have their own slot). <b>Fittings</b> are made on an anvil’s Carpentry tab with a <b>smithing hammer</b>.</li>
        <li><b>Sawing never fails</b>: every attempt makes the item.</li>
        <li><b>Saws</b> are forged by Tool Smithing in all four metals (${['saw','silver-saw','gold-saw','titanium-saw'].map(id=>item(id)).join(', ')}). A better saw builds a house faster.</li>
        <li>You don’t need a home to learn or train Carpentry. See ${guide('housing')} for lots, rooms, guests and taxes.</li></ul>`],
      ['materials','Planks and fittings',`<p>Everything else is built from these: <b>2 logs make 1 plank</b>, and <b>1 ore makes 1 fittings</b> (ore, not bars, so no smelting).</p>`+tbl(by('material'))],
      ['home','Building a home',`<p>The owner starts each stage, then a <b>builder’s workbench</b> stands in the yard. Anyone with Carpentry and a saw can click it: each click is one action (30 seconds with an iron saw) that uses <b>1 plank</b> from the worker’s own bag, plus <b>1 fittings every fourth action</b>, and pays <b>75 Carpentry XP</b> to whoever did it. Each upgrade needs the Carpentry level shown and is built the same way, with planks of the new wood and fittings of its metal.</p>`
        +table(['Home','Carpentry','Actions','Planks and fittings','Raw logs and ore','XP in total','Platinum'],homeRows)
        +`<p><b>All the way to the Shagbark Estate:</b> ${n(tot('a'))} planks (${n(tot('a')*2)} logs) and ${n(tot('f'))} fittings (${n(tot('f'))} ore), ${n(HOME_STEPS.reduce((a,h)=>a+h.plat,0))} platinum, and ${n(tot('a')*75)} Carpentry XP for whoever does the building.</p>`
        +note('Stages and counts are the game’s own rules. The house stays usable while an upgrade is being built.')],
      ['furniture','Furniture',`<p>A piece in your bag has <b>Place in home</b> in its menu. A cottage holds 30 pieces and an estate 90. Beds and storage chests also come in better woods: a better bed keeps you <b>Well Rested</b> longer (60 minutes for pine, then 75, 90 and 120).</p>`+tbl(by('furniture'))],
      ['stations','Crafting stations',`<p>Your own hearth, scribe’s lectern, pestle and mortar, tanning rack, tailor bench, bowyer table and anvil. They work like the ones in town, but only for your account. A station in a better wood crafts <b>5%, 10% or 20% faster</b> (oak, black walnut, shagbark).</p>`+tbl(by('station'))],
      ['garden','Garden pieces',`<p>Set out in your own yard with <b>Edit home</b>.</p>`+tbl(by('garden'))],
      ['level','Fastest way to level',`<p>Building is by far the best XP: <b>75 per action</b> for one plank (and a quarter of a fittings), against ${n((rs.find(r=>r.id==='pine-plank')||{}).xp||10)} XP for sawing a pine plank or about 15 XP per plank in furniture. At 30 seconds an action with an iron saw that is about <b>9,000 XP an hour</b>, and the house doesn’t have to be yours: anyone with Carpentry and a saw can work on a friend’s or guild-mate’s workbench using their own planks.</p>
        <ul class="g-list"><li>Saw your own planks as you go: each plank is a little XP before the building pays the 75.</li>
        <li>Rest in your bed first for <b>Well Rested</b>: 10% more XP from crafting for an hour (once every 20 hours per character).</li></ul>`],
      ['sources','Where the materials come from',`<p>Logs from ${guide('lumberjack')}, ore from ${guide('mining')}, saws from ${guide('tool-smithing')}, and flax for rugs, flower beds and scarecrows from ${guide('herblore')}.</p>`]
    ],related:['housing','lumberjack','tool-smithing','mining']};
  }});
  reg({slug:'housing',group:'Crafting skills',title:'Housing',blurb:'Buying a lot, building and upgrading your home, moving it, storage, Well Rested, your own mine and taxes.',build:()=>({
    lede:'You can buy a lot at Plymouth Wharf, build a pine cottage on it a plank at a time, and grow it into an estate. Everything here is from the game’s own update notes of 1 and 5 October 2026.',
    sections:[
      ['lots','Lots',`<p>Eight lots stand at Plymouth Wharf, each 12 tiles wide and 18 deep. Click the sign on a free one to buy it for <b>10,000 platinum</b>. An account can own one home per district, and the home belongs to the whole account, so every character on it can use it.</p>`],
      ['build','Building and upgrades',`<p>The cottage and every upgrade are built at the yard’s workbench by anyone with Carpentry: see ${guide('carpentry')} for the materials, the levels and the XP. The Oak House has a bigger main room, the Walnut Manor adds a second room, and the Shagbark Estate a room upstairs. Each step raises the caps on furniture, stations, garden pieces, trees and herbs, and storage tabs. When a cottage is finished, everyone online hears about it.</p>`],
      ['inside','Inside',`<ul class="g-list"><li><b>Storage chest</b>: opens your account storage, shared by every character on the account. 60 slots a tab, one tab for a cottage and up to four for an estate. Quest items and bound items can’t go in.</li>
        <li><b>Bed</b>: rest for <b>Well Rested</b>, 10% more XP from combat, gathering and crafting for an hour (longer in a better bed), once every 20 hours per character. Its menu also has <b>Wake here after death</b>.</li>
        <li><b>Home Warp</b>: a level-30 Scribing scroll that takes you home from anywhere.</li>
        <li><b>Furniture and stations</b>: place them with <b>Edit home</b> (drag, mirror, pick up). A cottage holds 30 pieces, an estate 90.</li></ul>`],
      ['guests','Guests',`<p>The door setting is Owner only, Friends, Guild members or Everyone. Guests can walk around and look; the chest, beds, stations, mine rocks and garden stay yours. Anyone a new setting keeps out is put on the doorstep.</p>`],
      ['yard','The yard and the mine',`<ul class="g-list"><li>Move the house, flip its door and set out garden pieces with <b>Edit home</b> outdoors.</li>
        <li><b>Saplings and seeds</b> planted in the yard grow while you’re offline into the same trees and herbs as in the wild, and only your account can gather them. Every chop or pick in the wild has a <b>1 in 1,000</b> chance to turn one up; produce vendors sell pine saplings, flax seeds and woad seeds. Wild mandrake can also drop <b>wolfsbane</b> and <b>adderfern</b> seeds, and a yard is the only place either grows. Since 5 October 2026 the trees and herbs <b>in your own yard</b> can turn up saplings and seeds too, so a yard can grow its own stock.</li>
        <li><b>Your own mine</b>: the owner opens a hatch, and anyone with Mining and a pickaxe helps dig it out, 240 actions at 75 Mining XP each. The first cave has 3 iron rocks; each upgrade lets it go a stage deeper, up to <b>18 rocks: 6 iron, 5 silver, 4 gold and 3 titanium</b>. Only your account can mine them.</li></ul>`],
      ['tax','Taxes',`<p>A finished home pays a tax every 30 days, from the house’s window, up to six months ahead. The first month is paid when the cottage is finished.</p>`
        +table(['Home','Tax every 30 days'],[['Pine Cottage','3,000 gold'],['Oak House','8,000 gold'],['Walnut Manor','15,000 gold'],['Shagbark Estate','25,000 gold']])
        +`<p>Miss the date and the house is boarded up, but keeps working for <b>30 days of grace</b> (except the mine, the yard’s trees and herbs, and upgrade work). You are warned in chat, by push and by email. If grace runs out the home comes down, your furniture goes into account storage and the lot goes back on sale; you keep a <b>deed</b> that claims another lot without paying platinum, and upgrades already paid for cost no platinum the second time.</p>`],
      ['move','Moving your home',`<p>A finished home can move to any free lot: click that lot’s sign. It costs the <b>same as buying a lot</b>, and your old lot goes back on sale. The whole home comes along, the house, the furniture, the yard and the mine. A piece that doesn’t fit on the new lot goes to account storage, except a <b>grown tree or herb, which is lost</b>.</p><p>A home can’t move while it is boarded up for tax, or while building, an upgrade or the first mine dig is under way.</p>`],
      ['guild','Guildhouses',`<p>Guilds build a hall of their own the same way, together, on a guild lot. See ${guide('playing-together')}.</p>`]
    ],related:['carpentry','lumberjack','mining','playing-together']})});
  reg({slug:'scribing',group:'Crafting skills',title:'Scribing',blurb:'Parchment, warp scrolls, buff scrolls and XP scrolls.',build:craftingGuide({skill:'Scribing',noTomes:true,station:'scribe’s lectern',tool:'scribing quill',learn:'<a href="#/npc/osric-blane">Osric Blane</a> teaches it, for a skill point.',how:'<li>Parchment is 3 flax fibre. Every scroll takes 2 parchment, a pigment and usually a gem.</li><li>The Atlas recipe list only has parchment so far; the scroll tables below are from the official guide.</li>',extra:()=>[
      ['warps','Warp scrolls',`<p>A successful write gives <b>3 scrolls</b> and uses the gem; a failure <b>gives the gem back</b>. Each carat above the minimum adds 2,000 XP.</p>`+table(['Destination','Level','Pigment','Gem','XP'],[['Binxonia Mage Tower','5','3 woad','0.5c+','1,060'],['Plymouth Wharf','10','6 woad','0.5c+','1,120'],['Underleaf','15','9 woad','0.5c+','1,180'],['Appleseed Farm','20','3 madder','1c+','2,060'],['Mirewick','25','6 madder','1c+','2,120'],['Wispmeyer','30','9 madder','1c+','2,180']])],
      ['buffs','Buff scrolls',`<p>From level 5: +STR, END, DEX, SPD, INT, MAG, health, mana or stamina for a while. Stat scrolls take 6 madder and pool scrolls 4 woad, plus a monster reagent (boar tusk for STR, chitin plate for END, spider silk for DEX, gossamer wing for SPD, ancient acorn for INT, fae mote for MAG, living sap for health, mire essence for mana, rabbit foot for stamina). A bigger gem makes a stronger, longer buff. One buff per stat; the timer runs even while you are offline.</p>`+table(['Gem','Level','Bonus','Lasts'],[['none','5','+3','20 min'],['0.5c','15','+6','30 min'],['1c','25','+9','40 min'],['1.5c','35','+12','50 min'],['2c','45','+15','60 min'],['2.5c','55','+18','70 min'],['3c','65','+21','80 min'],['3.5c','75','+25','90 min'],['4c','85','+30','100 min']])],
      ['xp','XP scrolls',`<p>From level 25: <b>+10% combat, gathering or crafting XP for 10 minutes</b> (2 parchment, 6 weld and a gem of 1c or more). The three kinds run together; reading one again restarts its timer. They also <b>stack with server-wide XP events</b>.</p>`],
      ['recall','Guild Recall',`<p>A scroll added on 5 October 2026 that takes guild members to their <b>finished guildhall</b> from anywhere. Its recipe isn’t in the game’s published data yet. See ${guide('playing-together')}.</p>`],
      ['reading','Reading a scroll',`<p>Takes about 1.5 seconds and breaks if you move, are hit or stunned. It is refused within 10 seconds of dealing or taking damage.</p>`]],lede:'Write scrolls on parchment: warps that take you across the world, buffs, and XP boosts.',related:['herblore','travel','gems']})});

  // ---- Gear, gems & enchanting -------------------------------------------------------------------------------------
  // An enchant's effect at c carats, the game's own rule (eu in game-rules): an element or Destruction adds
  // round(c/4.5*100)% base damage, a stat +5c, a school +c, Seeking +2c% to-hit, the Artisan +5c% success - the 1c wording
  // with its number scaled (the percentages from the rule itself, since 22% x 4 is not 89%). g: a BXC_GAME_DATA enchant.
  function enchEffectAt(g,c){const one=String(g&&g.effect&&g.effect[1]||'');if(!one)return '';
    if(g.element||(!g.school&&!g.attribute&&/base damage/.test(one)))return one.replace(/\d+(\.\d+)?/,String(Math.round(c*100/4.5)));
    return one.replace(/\d+(\.\d+)?/,m=>String(+m*c))}
  reg({slug:'quality-and-enchanting',group:'Gear, gems & enchanting',title:'Quality & enchanting',blurb:'Quality tiers and their odds, mastery, carat caps and every enchantment.',build:()=>{
    const qm=typeof QUALITY_MULT!=='undefined'?QUALITY_MULT:{},qt=typeof QUALITY_TIERS!=='undefined'?QUALITY_TIERS:[];
    // What quality does (the game's rules: gear stats and sell price x (1 + q), a tool's success bonus + q/10; official
    // guide: weapon damage, armour defence, staff spell power, tool craft chance - never your attributes or a set gem)
    const sg=v=>(v>0?'+':v<0?'−':'')+Math.abs(Math.round(v*1000)/10)+'%';
    const qRows=qt.map(t=>{const v=qm[t]||0;return [`<span class="q-name q-${t}">${esc(pretty(t))}</span>`,`<b>${sg(v)}</b>`,sg(v/10)]});
    const QT=typeof QUALITY_TIERS!=='undefined'?QUALITY_TIERS:[];
    // Craft success by levels over the item, the game's own rule (BXC_GAME_RECIPES.craftChance: 60% at its level, +40%
    // over 15 levels, capped at 95%): one tile per level, 95% at +14 marked, and +15 (ENCHANT_OVER, the game's own rule)
    // marked as where enchanting opens.
    const CB=typeof CRAFT_BASE!=='undefined'?CRAFT_BASE:.6,CS=typeof CRAFT_SPAN!=='undefined'?CRAFT_SPAN:15,CC=typeof CRAFT_CAP!=='undefined'?CRAFT_CAP:.95;
    const succ=o=>Math.min(CC,CB+(1-CB)*o/CS),sAt=[...Array(40).keys()].find(o=>succ(o)>=CC-1e-9),mAt=typeof ENCHANT_OVER!=='undefined'?ENCHANT_OVER:15;
    const masteryChart=`<div class="ms-chart" role="list" aria-label="Craft success by levels above the item">${[...Array(mAt+1).keys()].map(o=>{const v=succ(o);
      return `<div class="ms-t${o===mAt||o===sAt?' ms-m':''}" role="listitem" title="${o===mAt?'You can enchant from here':o===sAt?'Best success, 95%':''}"><span class="ms-l">+${o}${o===mAt?' ✦':''}</span><span class="ms-bar"><i style="height:${Math.round((v-.5)/(CC-.5)*100)}%"></i></span><b>${(v*100).toFixed(v*100%1?1:0)}%</b></div>`}).join('')}</div><p class="g-note">Levels above the item, and your chance to craft it: <b>95% at +${sAt}</b>, and you can <b>enchant it from +${mAt}</b> (✦).</p>`;
    const odds=(typeof CRAFT_QUALITY_TABLE!=='undefined'?CRAFT_QUALITY_TABLE:[]).filter(t=>t.levelsOver%5===0).map(t=>[`<b>+${t.levelsOver}</b>${t.levelsOver===15?' (you can enchant)':t.levelsOver===30?' (cap)':''}`,...QT.map(q=>q==='flawless'&&!t[q]?'~0%':((t[q]||0)*100).toFixed(1)+'%')]);
    const ER=typeof ENCHANT_RECIPES!=='undefined'?ENCHANT_RECIPES:{},EG=typeof ENCHANT_GEMS!=='undefined'?ENCHANT_GEMS:{};
    const gemName=g=>g==='any'?'any gem':EG[g]?.name||pretty(g);
    // every enchantment as a card (like the Gems guide's gem cards), grouped by what it goes on: its gems, what it does
    // per carat and at the most it can hold, and what it goes on (official guide: weapon enchants on any main-hand weapon
    // but a wand - bows and crossbows too; Seeking on bows and crossbows only; staff enchants on staves, the game's wands)
    const GDE=(globalThis.BXC_GAME_DATA||{}).enchants||[];
    const gemChip=g=>g==='any'?'<span class="ec-gem ec-any">any gem</span>':`<span class="ec-gem">${icon('gem-'+g)}${esc(gemName(g))}</span>`;
    const ON={weapon:'Any weapon but a staff, bows and crossbows included.',bow:'Bows and crossbows only. They take the weapon enchants above too.',staff:'Staves only: this is what makes a staff a school staff.',armor:'Any armour piece, a cape or a shield; the bonuses add up across them.',tool:'Any trade tool, from pickaxes to sewing kits. The gem is added when the tool is crafted.'};
    // An enchant's strength at every carat it can hold, by gear tier (3 carats each; a tool, by metal): the numbers only,
    // the unit ("base burn", "DEX") said once. Values from the game's rule (enchEffectAt).
    const chart=(fam,g,x,max)=>{const vals=Array.from({length:max},(_,i)=>g?enchEffectAt(g,i+1):x.effect);
      const num=t=>(String(t).match(/[+-]?\d+(\.\d+)?%?/)||[''])[0],unit=String(vals[0]||'').replace(/[+-]?\d+(\.\d+)?%?/,'').replace(/\s+/g,' ').trim();
      const cell=c=>`<div class="ec-c"><span>${c}c</span><b>${esc(num(vals[c-1]))}</b></div>`;
      // each tier heading opens that tier's gear of this enchant's kind (the same popup as in the Gems guide)
      const th=(t,label)=>`<button type="button" class="gg-pop-btn ec-g-h" data-pop="tier" data-tier="${t}" data-back-kind="${esc(fam)}" data-back-ench="${esc(x.name)}" data-gem="" title="What tier ${t} ${fam==='tool'?'tools':'gear'} is">${label}</button>`;
      const groups=fam==='tool'?['Iron','Silver','Gold','Titanium'].map((m,i)=>`<div class="ec-g">${th(i+1,m)}${cell(i+1)}</div>`)
        :[1,2,3,4].map(t=>`<div class="ec-g">${th(t,'Tier '+t)}${[3*t-2,3*t-1,3*t].map(cell).join('')}</div>`);
      return `<div class="ec-chart-h">${esc(unit.replace(/^./,c=>c.toUpperCase()))} by carat</div><div class="ec-chart${fam==='tool'?' ec-chart-tool':''}">${groups.join('')}</div>`};
    const ecard=(fam,x)=>{const g=GDE.find(e=>e.name===x.name&&e.family===fam),max=fam==='tool'?4:12;
      const ln=(k,v)=>`<div class="gg-line"><span class="gg-line-k">${k}</span><span>${v}</span></div>`;
      return `<div class="gg-card ec-card"><div class="gg-card-head"><button type="button" class="gg-pop-btn ec-name" data-pop="one" data-kind="${esc(fam)}" data-ench="${esc(x.name)}" data-gem="" title="What it does at every carat">${esc(x.name)}</button><span class="gg-card-skill">${esc(pretty(fam))}</span></div>`
        +ln('Gems',fam==='tool'?'<span class="ec-gem ec-any">any one gem</span>':`<span class="ec-gems">${x.gems.map(gemChip).join('<span class="ec-plus">+</span>')}</span>`)
        +chart(fam,g,x,max)+'</div>'};
    const ART=GDE.find(e=>e.family==='tool');
    const GROUPS=[['Weapons',['weapon']],['Bows and crossbows',['bow']],['Staves',['staff']],['Armour',['armor']]];
    const enchCards=GROUPS.map(([h,fams])=>{const cs=fams.flatMap(f=>(ER[f]||[]).map(x=>ecard(f,x)));return cs.length?`<h3>${h}</h3><p class="g-note ec-on">${esc(ON[fams[0]])}</p><div class="gg-cards ec-cards">${cs.join('')}</div>`:''}).join('')
      +(ART?`<h3>Tools</h3><p class="g-note ec-on">${esc(ON.tool)}</p><div class="gg-cards ec-cards">${ecard('tool',{name:ART.name,gems:[],effect:ART.effect[4]||''})}</div>`:'');
    return {lede:'Crafted gear and tools roll a quality that scales what they do. Gear can then be enchanted with gems for extra damage, stats or accuracy; a tool takes one gem when it is crafted, for a better chance to succeed.',sections:[
      ['quality','Quality tiers',`<p>Every piece of crafted gear rolls a quality. It scales what the item itself brings: a weapon's <b>damage</b>, a piece of armour's <b>defence</b>, a staff's <b>spell power</b> and its sell price. It never changes your own attributes, or a gem set in the item.</p>`+table(['Quality','Gear stats','Tool bonus'],qRows)+note('A flawless sword hits 38% harder than an ordinary one of the same kind; an inferior one 30% softer. Tools work differently: quality adds to the tool’s bonus, which raises your success chance. Once you are at the 95% cap, the extra becomes a chance to get your materials back when crafting, or a bigger haul when gathering.')],
      ['odds','Quality odds',`<p>The quality you get depends only on how many levels you are <b>above</b> the item’s level: the further past it, the better your odds, up to <b>+30</b>. Your gear does not change it. A better tool (metal, quality, Artisan enchant) raises your chance to succeed, and past 95% your chance to get the materials back, but not the quality.</p>`+table(['Levels over recipe',...QT.map(q=>`<span class="q-name q-${q}">${esc(pretty(q))}</span>`)],odds)],
      ['loot','Quality of dropped gear',`<p>Gear from chests and ordinary monsters is at most excellent. <b>Elites drop only excellent, superior or flawless.</b></p><p>Enchanted gear from monsters goes up to <b>9c</b>, and never more than its material can hold: 3c per tier, so a 9c drop is always tier 3 or 4 gear.</p>`],
      ['mastery','Mastery',`<p>Crafting an item succeeds 60% of the time at its level and climbs to its best, <b>95%, at 14 levels above</b> it. You can <b>enchant it from 15 levels above</b>, one level later. Tools work the same way: the gem is set while the tool is forged, by someone 15 levels above that tool’s level.</p>`+masteryChart],
      ['carats','Carats',`<p>Gear enchantments use <b>three gems</b> (tools and rings one). Which gems decides the effect; their carats added up and rounded down decide the strength. An item holds <b>3 carats per material tier</b> (tier 4: 12) and anything above that is lost. Wearing enchanted gear takes <b>5 INT per carat</b>. Shields take armour enchants like any other piece; ammunition can’t be enchanted.</p>`],
      ['rings','Rings and tools',`<p><b>Rings</b> are forged at an anvil, bare or with one gem of 1c or more (up to 1/2/3/4c for iron/silver/gold/titanium). You wear two, and two of the same kind stack. 5c and 6c titanium rings only drop, from monsters level 25+. <b>Pendants</b> are never crafted; they drop at 1c up to <b>6c</b>. <b>Capes</b> only drop too, and carry an armour enchant of up to 3c. <b>Tools</b> take one gem while being forged (of the Artisan, +5% per carat). See ${guide('gems')} and ${guide('tool-smithing')}.</p>`],
      ['list','Every enchantment',enchCards],
      ['reforge','Reforging',`<p>A finished piece can be improved afterwards with monster <b>reagents</b>: <b>infuse</b> its enchant one carat higher, <b>re-enchant</b> it with new gems, or <b>reroll</b> its quality. Every chance, cost and level is in ${guide('reforging')}.</p>`],
    ],related:['reforging','gems','combat','weapon-smithing','armor-smithing']};
  }});
  reg({slug:'gems',group:'Gear, gems & enchanting',title:'Gems',blurb:'The nine gems, where they are found, and what their rings do.',build:()=>{
    const EG=typeof ENCHANT_GEMS!=='undefined'?ENCHANT_GEMS:{};
    const GD=globalThis.BXC_GAME_DATA;
    // which enchantments each gem goes into (the game's own gem patterns; "any" = any gem as an armour enchant's third)
    const ER=typeof ENCHANT_RECIPES!=='undefined'?ENCHANT_RECIPES:{};
    // what each gem goes into, as chips by where it ends up: weapon (bows and staves too), armour and tool enchantments
    // (any one gem set while forging a tool makes it "of the Artisan"), and its ring and pendant. Each chip opens a popup
    // with what it does at every carat.
    const NONE='<span class="gg-none" title="Not used for this" aria-label="None">✗</span>';   // nothing in this column: a red cross
    const chip=(id,attrs,label,tip)=>`<button type="button" class="gg-pop-btn gg-chip" data-gem="${esc(id)}" ${attrs} title="${esc(tip)}">${esc(label)}</button>`;
    const enchChips=(id,fams)=>Object.entries(ER).filter(([k])=>fams.includes(k)).flatMap(([kind,l])=>l.filter(e=>e.gems.includes(id)).map(e=>chip(id,`data-pop="one" data-kind="${esc(kind)}" data-ench="${esc(e.name)}"`,e.name.replace(/^of (the )?/,'')+(kind==='bow'?' (bow)':''),pretty(kind)+': '+e.effect))).join('')||NONE;
    const artisan=(GD&&GD.enchants||[]).find(e=>e.family==='tool');
    const wornChip=(id,arr,what)=>{const t=(arr||[]).find(x=>x.gem===id)?.text;if(!t)return NONE;const w=t[3]||t[1]||'',[nm,...rest]=w.split(': ');return chip(id,`data-pop="${what}"`,rest.length?nm:pretty(what),(rest.length?rest.join(': '):w)+' (at 3 carats)')};
    // one card per gem, every card the same six lines (a red cross where the gem goes into nothing of that kind), so
    // they read alike and line up; staff enchants on their own line. Any gem makes a tool of the Artisan.
    const line=(k,v)=>`<div class="gg-line"><span class="gg-line-k">${k}</span><span class="gg-chips">${v}</span></div>`;
    const cards=`<div class="gg-cards">${Object.entries(EG).map(([id,g])=>`<div class="gg-card"><div class="gg-card-head">${item('gem-'+id,g.name)}<span class="gg-card-skill">${skillGuideLink(g.found)}</span></div>`
      +line('Weapon',enchChips(id,['weapon','bow']))+line('Staff',enchChips(id,['staff']))+line('Armor',(()=>{const own=enchChips(id,['armor']);return own!==NONE?own:chip(id,'data-pop="filler"','Filler','Any gem can be the third gem of an armour enchant')})())   // no armour recipe of its own: it can still fill the third slot of one
      +line('Tool',artisan?chip(id,`data-pop="one" data-kind="tool" data-ench="${esc(artisan.name)}"`,'Artisan','Tool: '+(artisan.effect[4]||'')+' (any one gem, set while forging)'):NONE)
      +line('Ring',wornChip(id,GD&&GD.rings,'ring'))+line('Pendant',wornChip(id,GD&&GD.pendants,'pendant'))+'</div>').join('')}</div>`;
    // Rarity is a gem's size, not its kind (a skill's gems come up at random): one tile per carat in the rarity's colour,
    // with how often players actually find it (the collector's recorded finds). 0.5c-2c can be built at the witch, so common.
    const rar=c=>typeof gemRarity==='function'?gemRarity(c):'common',shares=typeof gemFindShares==='function'?gemFindShares():null;
    const rarity=`<div class="gg-rarity" role="list" aria-label="Gem rarity by carat">${[.5,1,1.5,2,2.5,3,3.5,4].map(c=>{const r=rar(c),sh=shares&&shares.total?shares.share(c):null;
      return `<div class="gg-rar rar-${r.replace(/ /g,'-')}" role="listitem" title="${esc(typeof gemHowText==='function'?gemHowText(c):'')}"><b>${c}c</b><span class="gg-rar-name">${esc(r[0].toUpperCase()+r.slice(1))}</span>${sh!=null?`<span class="gg-rar-pct" title="Share of the gems players have recorded">${(sh*100).toFixed(sh<.1?1:0)}%</span>`:''}</div>`}).join('')}</div>`;
    const GT=typeof GATHERABLES!=='undefined'?GATHERABLES:[],tier=(sk,i)=>{const t=GT.filter(x=>x.skill===sk).sort((a,b)=>a.level-b.level)[i];return t?item(slug(t.item),t.item):'—'};
    const tiers=[.5,.6,.75,1].map((p,i)=>[`Tier ${i+1}`,tier('mining',i),tier('fishing',i),tier('lumberjack',i),`<b>${p}%</b>`]);
    // where gems come from: each gathering skill that finds them (its guide), and monsters by level (the official guide's rule)
    const finders=[...new Set(Object.values(EG).map(g=>g.found).filter(Boolean))].map(skillGuideLink).join(', ').replace(/, ([^,]*)$/,' and $1');
    // monsters: the official guide's carat-by-level rule; each level opens the monsters the game marks as dropping gems
    // (dropsGems in its rules) in that band
    const BANDS=[[10,19,'0.5c'],[20,29,'1c'],[30,39,'1.5c'],[40,null,'2c']];
    const band=([lo,hi,c])=>`<button type="button" class="gg-pop-btn gg-chip gg-band" data-pop="mons" data-lo="${lo}" data-hi="${hi??''}" data-c="${c}" title="See the monsters level ${lo}${hi?'–'+hi:'+'} that can drop gems">Lv ${lo}${hi?'–'+hi:'+'} · up to ${c}</button>`;
        // where gems come from, one labelled row each: gathering, monsters (by level), the Dark Witch
    const src=(k,v)=>`<div class="gg-src"><div class="gg-src-k">${k}</div><div class="gg-src-v">${v}</div></div>`;
    const sources=`<div class="gg-sources">`
      +src('Gathering',`${finders}. The only way to find a gem bigger than 2c.`)
      +src('Monsters',`A flat <b>1%</b> chance, up to a size set by their level. Click one to see which monsters drop gems:<div class="gg-bands">${BANDS.map(band).join('')}</div>`)
      +src('Dark Witch',`Three gems of the same kind and size become one half a carat bigger, up to 2c. <button type="button" class="gg-to-witch" title="Go to the Dark Witch">How it works</button>`)
      +'</div>';
    return {lede:'Nine gems in eight sizes: the bigger the gem, the rarer it is and the stronger it makes your gear.',sections:[
      ['sources','Where gems come from',sources],
      ['rarity','Gem rarity',rarity],
      ['list','The nine gems and what they make',`<p>Gems are what turn good gear into great gear.</p><ul class="g-list">`
        +`<li><b>Enchanted weapons and armour.</b> Three gems enchant a weapon, bow, staff or piece of armour: blades that burn, freeze, shock or corrode, sharper aim, stronger stats or more powerful spells. Every recipe is in ${guide('quality-and-enchanting')}.</li>`
        +`<li><b>Enchanted tools.</b> One gem set in a tool while it is forged makes it <i>of the Artisan</i>, raising your success with it. See ${guide('tool-smithing')}.</li>`
        +`<li><b>Rings and pendants.</b> A gem set in a ring or pendant gives a lasting bonus of its own: more critical hits, faster movement, bigger hauls and more.</li></ul>`
        +`<p>The bigger the gem, the stronger the effect. Wearing enchanted gear takes <b>5 INT</b> per carat.</p>`+cards],
      ['finding','Gathering odds',`<p><b>Every successful gather</b> has a small chance of turning up a gem from that skill, and better resources give better odds (for fishing, it is the fish that bit that counts). Which of the skill’s gems you get is random.</p>`+table(['','Mining','Fishing','Lumberjack','Chance'],tiers)],
      ['witch','Dark Witch: building bigger gems (up to 2c)',globalThis.bxcGemWitchHtml?globalThis.bxcGemWitchHtml():'']
    ],related:['quality-and-enchanting','mining','lumberjack','fishing']};
  }});

  reg({slug:'outfits',group:'Gear, gems & enchanting',title:'Outfits',blurb:'Every outfit in the game, what it is made of, and who wears it.',build:()=>{
    const O=globalThis.bxcOutfits?globalThis.bxcOutfits():{list:[],worn:new Map()};
    if(!O.list.length)return {lede:'The game has a catalog of outfits that dresses its people and soldiers.',sections:[['none','Not drawn yet','<p class="muted">The collector draws every outfit the first time the game loads with it running; they appear here after that.</p>']],related:['armor']};
    const groups=[...new Set(O.list.map(o=>o.group||'other'))];
    const card=o=>{const w=O.worn.get(o.id)||[],pieces=['head','torso','arms','legs','feet'].filter(s=>o.body&&o.body[s]).map(s=>pretty(o.body[s])),held=o.held?Object.values(o.held).filter(Boolean).map(pretty):[];
      return `<div class="outfit-card" id="outfit-${esc(o.id)}">${o.img?`<img src="${esc(o.img)}" alt="">`:''}<div><b>${esc(o.name)}</b><div class="g-note">${esc(pieces.join(' · '))}${held.length?' · holds '+esc(held.join(', ')):''}</div>${w.length?`<div class="outfit-worn">Worn by ${w.map(x=>`<a href="${esc(x.href||'#/npc/'+enc(x.slug))}">${esc(x.name)}</a>`).join(', ')}</div>`:''}</div></div>`};
    return {lede:`The game dresses its people and soldiers from a catalog of ${O.list.length} outfits. Each is drawn here as the game draws it; “Worn by” lists the named people seen wearing it.`,
      sections:groups.map(g=>[`g-${slug(g)}`,g==='armor'?'Armor sets':g==='clothing'?'Clothing':pretty(g),`<div class="outfit-grid">${O.list.filter(o=>(o.group||'other')===g).map(card).join('')}</div>`]),related:['armor','quality-and-enchanting']};
  }});

  reg({slug:'trainers',group:'World',title:'Trainers',blurb:'Who teaches each skill, and where to find them.',build:()=>{
    const T=globalThis.bxcTrainers?globalThis.bxcTrainers():[];
    if(!T.length)return {lede:'Trainers teach skills.',sections:[['none','None seen yet','<p class="muted">Trainers appear here once the collector has seen them.</p>']],related:['getting-started']};
    const row=t=>`<div class="trainer-card"><img src="${esc(t.img)}" alt=""><div><a href="${esc(t.href)}"><b>${esc(t.name)}</b></a>${t.skill?`<div class="g-note">Teaches ${t.guide?guide(t.guide):esc(t.skill)}</div>`:''}<div class="g-note">${t.where.length?esc(t.where[0])+(t.where.length>1?' · also '+esc(t.where.slice(1).join('; ')):''):'Not placed yet'}</div>${t.where.length?`<button type="button" class="show-on-map" data-map-kind="npc" data-map-id="${esc(t.slug)}">Show on map</button>`:''}</div></div>`;
    return {lede:`${T.length} trainer${T.length===1?'':'s'} seen so far. On the map, turn on <b>Trainers</b> to see them: outdoors at the spot they stand, indoors at the door of their building.`,
      sections:[['all','Trainers',`<div class="trainer-grid">${T.map(row).join('')}</div>`]],related:['getting-started','levels-and-xp']};
  }});

  // ---- World --------------------------------------------------------------------------------------------------------
  reg({slug:'places',group:'World',title:'Places',blurb:'Towns, dungeons, resource areas and danger zones on the official map.',build:()=>{
    const pois=(typeof D!=='undefined'?D.pois:[])||[],cats=[...new Set(pois.map(p=>p.category))].sort();
    return {lede:'The places marked on the official world map. Click one to see it on the map with what lives around it.',sections:cats.map(c=>[`c-${slug(c)}`,pretty(c),`<ul class="g-cols">${pois.filter(p=>p.category===c).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<li><a href="#/map/place/${enc(p.name)}">${esc(p.name)}</a></li>`).join('')}</ul>`]),related:['using-the-atlas']};
  }});

  // =================================================================================================================
  // Topics from the official guide (binxonia.com/guide, read 2026-09-29) - paraphrased, with our own tables. Where the
  // official pages and the game's rules file disagree, the rules win and the difference is noted.
  // =================================================================================================================
  const OFFICIAL='<a href="https://binxonia.com/guide" target="_blank" rel="noopener">official guide</a>';
  const kv=rows=>table(['',''],rows.map(([k,v])=>[`<b>${k}</b>`,v]),'g-kv');

  reg({slug:'getting-started',group:'Start here',title:'Getting started',blurb:'Classes, your first skills, the belt, death and the first things worth doing.',build:()=>({lede:'A quick path through your first hours: what your class means, which skills to pick up, and how not to lose your things.',sections:[
    ['class','Your class',`<p>A class only decides your starting kit, the weapons you already know and how your first points are spread. Everyone gets the same number of points, and nothing locks you in: you can learn any weapon later and move your points around. See ${guide('attributes-and-classes')}.</p>`],
    ['skills','Skill points: spend them carefully',`<p>You get only <b>10 skill points in a lifetime</b>: one at the start and one each at levels 5, 10, 20, 30, 40, 50, 60, 75 and 100. They pay for trades (1 point each at a trainer) and for weapon tomes. <b>Cooking is free</b>, and <b>Herblore is free</b> through a quest. Unlearning a trade or weapon costs 5,000 gold and refunds the point, but the trade’s levels are lost.</p>`],
    ['first','Good first steps',`<ol class="g-list"><li>Fight low-level monsters near town. Monsters below level 8 hit softer (level 1 monsters do 30% of normal damage).</li><li>Learn <b>Fishing</b> from the Fishing Trainer, then cook what you catch: food heals you. See ${guide('fishing')} and ${guide('cooking')}.</li><li>Do the quests marked <b>!</b> above NPCs; <b>?</b> means one is ready to hand in. Some teach weapons and trades for free.</li><li>Keep food and potions in your <b>belt</b> (the first 5 slots): they are never lost when you die.</li><li>Bank before you go exploring.</li></ol>`],
    ['death','Dying',`<p>Up to level 9 you lose nothing. From level 10 your pack drops where you died; your belt, what you wear and your bank are safe. See ${guide('death-and-banking')}.</p>`],
    ['healing','Staying alive',`<p>Health, stamina and mana <b>do not regenerate during combat</b>. After a fight they come back, ramping up to full speed over 8 seconds. In a fight, eat or drink: food and potions share a 2-second cooldown. Food heals 20% at once and the rest over 5 seconds; a potion fills one pool instantly.</p>`],
    ['keys','Handy keys',kv([['H','Mount or dismount your horse'],['1–7','Use the special attack in that action-bar slot'],['! in chat','Link an item from your pack, gear or bank'],['/p','Party chat']])],
    ['more','Where next',`<p>${guide('combat')} · ${guide('levels-and-xp')} · ${guide('mining')} · ${guide('economy')} · the <a href="#/map">World map</a>.</p>`]
  ],related:['attributes-and-classes','combat','death-and-banking','levels-and-xp']})});

  reg({slug:'attributes-and-classes',group:'Start here',title:'Attributes & classes',blurb:'What each of the six stats does, the three classes, and carry weight.',build:()=>{
    const cls=[['Warrior','Sword','Sword, shield, HP potions',15,15,5,15,10,15,5,5,5],['Archer','Bow, Dagger','Bow, 60 arrows, dagger, HP and stamina potions',10,15,5,10,20,10,10,5,5],['Mage','One magic school','Wand, first spell of the school, HP and mana potions',10,5,20,5,5,10,10,10,15]];
    return {lede:'You get 9 points to spend every level, one stat each. Points can be taken back and spent again from the Skills menu.',sections:[
      ['stats','The six stats',kv([['Strength (STR)','+1.3% melee damage per point, +0.5 max HP per point you spent, more carry weight. Needed for metal armor, swords and shields.'],['Dexterity (DEX)','+0.85% bow damage per point and more critical hits (about +1% per 10). Needed for bows, pelt armor and daggers. Daggers still take their damage from STR.'],['Endurance (END)','Faster health regeneration.'],['Speed (SPD)','Shorter time between attacks, faster stamina regeneration, cheaper steps while kiting. Walking speed is the same for everyone.'],['Intellect (INT)','Needed to learn spells, for knick armor and to wear enchanted gear (5 per carat). Faster mana regeneration.'],['Magic (MAG)','Spell damage: every full 10 above the base adds a step.']])+note('Only points you spent count toward the regeneration and kiting effects; points from enchantments don’t.')],
      ['classes','The three classes',table(['Class','Knows','Starts with','HP','Stam','Mana','STR','DEX','END','SPD','INT','MAG'],cls.map(c=>c.map((v,i)=>i<3?esc(v):n(v))))+note('Mages pick fire, ice or shock at the start; the other schools come from quests.')],
      ['weight','Carry weight',`<p>You can carry <b>50 + 7 per point of STR</b>, gear you wear included. Over that you walk at half speed, then 1% slower per extra unit, down to 10%. You can still pick things up while overloaded, even on a horse.</p>`]
    ],related:['getting-started','combat','armor']};
  }});

  reg({slug:'death-and-banking',group:'Start here',title:'Death, the belt & the bank',blurb:'What you lose when you die, how long you have to get it back, and where it is safe.',build:()=>({lede:'Dying costs your pack from level 10, but a few places are always safe.',sections:[
    ['rules','What drops',kv([['Below level 10','Nothing.'],['Level 10 and up','Everything in your pack drops in a container where you died.'],['Always kept','Your belt (the first 5 slots), everything you wear, and your bank.']])],
    ['timer','Getting it back',table(['Time after death','Who can loot it'],[['0–10 minutes','Only you'],['10–30 minutes','Anyone'],['After 30 minutes','It disappears with whatever is left']])],
    ['belt','The belt',`<p>Loot, purchases and crafted items never go into the belt on their own, so what you put there stays put. Keep food and potions there.</p>`],
    ['bank','Pack and bank',`<p>Your pack has <b>25 slots</b>. The bank has <b>5 tabs of 80 slots</b> (you start with one) and is safe when you die.</p>`]
  ],related:['getting-started','economy']})});

  reg({slug:'special-attacks',group:'Combat',title:'Weapon skills & specials',blurb:'How weapon skills level, the five specials of each weapon, and learning new weapons.',build:()=>{
    const S={Sword:[[10,'Heavy Strike','Rolls from the top half of the damage and hits ×1.5 (about double a normal hit).','15 s'],[20,'Sweeping Cut','Hits the target and up to 3 more in front of you.','20 s'],[25,'Riposte','Normal hit; the next blow at you within 9 s is cancelled and answered for free.','20 s'],[35,'Charge','Freezes an enemy up to 8 tiles away and closes in with the first hit.','30 s'],[60,'Executioner’s Strike','Never misses: ×2, or ×4 below 25% health. 20% recoil. Not usable under 10% health.','40 s']],
      Dagger:[[10,'Vital Thrust','Cannot miss and always crits, harder than a normal crit.','18 s'],[20,'Envenom','For 14 s each hit adds a poison dose worth 30% of the hit (up to 5).','24 s'],[25,'Slip','The next blow at you misses, then you move 1.4× faster for 4 s.','20 s'],[35,'Hamstring','Slows the target’s movement and attacks for a few seconds.','24 s'],[60,'Rupture','Uses up the doses: ×1.6 with none up to ×4.35 with five. 20% recoil.','40 s']],
      Mace:[[10,'Stagger','About a normal hit, and the target’s next swing is delayed.','20 s'],[20,'Sunder','Dents armor: every hit on it from anyone does ×1.2 while it lasts.','24 s'],[25,'Bulwark','You take less damage from everything for 5 s.','25 s'],[35,'Ground Slam','Hits everything around you and cannot miss.','28 s'],[60,'Skullcrusher','Adds 6% of the target’s max health. 20% recoil.','40 s']],
      Spear:[[10,'Lunge','Reaches 4 tiles without moving.','18 s'],[20,'Whirl','Hits up to 5 around you, ×1.8 at the edge down to ×0.7 up close.','30 s'],[25,'Set Spear','Roots the target (and you) for up to 8 s.','24 s'],[35,'Vault','Hit, then land 2 tiles past the target.','26 s'],[60,'Impale','×3 on a target still coming at you, ×1.4 once it is next to you. 20% recoil.','34 s']],
      Bow:[[10,'Split Shot','Two arrows, each rolled on its own.','16 s'],[20,'Barbed Arrow','A bleed that hurts double while the target moves.','24 s'],[25,'Pinning Shot','Roots the target for 3 s.','25 s'],[35,'Arrow Storm','Five arrows at the target and up to 4 nearby.','26 s'],[60,'Longshot','Hits harder the further away: ×0.5 in contact up to ×2.75 at full range.','40 s']],
      Crossbow:[[10,'Ambush Bolt','×2.1 on a target that has not noticed you.','45 s'],[20,'Snap Crank','×1.15 and the next bolt is ready in 4 s instead of 8.','32 s'],[25,'Kick Shot','Within 3 tiles: a 2 s stun.','25 s'],[35,'Piercing Bolt','Also hits up to 3 in the line between you and the target.','30 s'],[60,'Siege Bolt','×3, but adds 8 s to the reload.','45 s']]};
    const GS=globalThis.BXC_GAME_DATA?.specials,GU=globalThis.BXC_GAME_DATA?.specialUnlock||{1:10,2:20,3:25,4:35,5:60};
    if(GS){for(const k of Object.keys(S))delete S[k];
      for(const [w,list] of Object.entries(GS)){if(!Array.isArray(list)||!list.length)continue;
        S[pretty(w)]=list.slice().sort((a,b)=>a.tier-b.tier).map(sp=>{const bits=[];
          if(Number.isFinite(sp.damageMult)&&sp.damageMult!==1)bits.push('×'+sp.damageMult+' damage');if(sp.alwaysHits)bits.push('cannot miss');
          if(Number.isFinite(sp.staminaMult)&&sp.staminaMult!==1)bits.push(sp.staminaMult+'× stamina');if(Number.isFinite(sp.windupMult)&&sp.windupMult!==1)bits.push(sp.windupMult+'× wind-up');
          return [GU[sp.tier]||sp.tier*10,sp.name,sp.description+(bits.length?' ('+bits.join(', ')+')':''),Math.round(sp.cooldownMs/1000)+' s']})}}
    return {lede:'Each weapon family (sword, dagger, mace, spear, bow, crossbow) is a skill up to 100, trained by the damage you deal with it. Every family unlocks five special attacks along the way.'+(GS?' The specials below are the game’s own list.':''),sections:[
      ['how','How specials work',`<ul class="g-list"><li>Specials unlock at weapon skill <b>10, 20, 25, 35 and 60</b>; the 25 one is always defensive.</li><li>Drag one from the Skills panel onto one of the <b>7 action-bar slots</b>, then press its number or click it to make your next attack that special. Each weapon type has its own bar, so hold the weapon first.</li><li>Specials wind up slower than a normal hit and can miss (the cooldown still starts). They can crit. If the target dies or runs out of reach during the wind-up, the cooldown is refunded.</li><li>Bow and crossbow specials cost stamina. Melee specials are free, but each melee family’s level-60 finisher hurts you for 20% of the damage it deals.</li><li>A <b>killing blow resets</b> your weapon cooldowns.</li></ul>`],
      ...Object.entries(S).map(([w,list])=>[slug(w),w,weaponQuestNote(slug(w))+table(['Skill','Special','What it does','Cooldown'],list.map(([l,name,what,cd])=>[n(l),`<b>${esc(name)}</b>`,esc(what),cd]))]),
      ['learn','Unlocking combat skills',`<p>You can only wield the weapon types you know, and each is a skill of its own that levels with the damage you deal. You start with your class’s weapons; the rest come from <b>quests</b> or a <b>tome</b>.</p>`+
        table(['Skill','Who starts with it','How everyone else gets it','Cost'],[
          [item('titanium-sword','Sword'),'Warriors',`A <b>Sword tome</b>: study it from your pack.`,'1 skill point'],
          [item('titanium-dagger','Dagger'),'Archers',`A <b>Dagger tome</b>.`,'1 skill point'],
          [item('shagbark-longbow','Bow'),'Archers',`A <b>Bow tome</b>.`,'1 skill point'],
          [item('titanium-mace','Mace'),'—',`Quest <b>${weaponQuest('mace')}</b> from <b>Hester Bell</b> near Rustpick Mine (warriors, level 11). You also get a mace.`,'Free'],
          [item('titanium-spear','Spear'),'—',`Quest <b>${weaponQuest('spear')}</b> from <b>Tobin Reed</b> near Underleaf (warriors, level 10). You also get a spear.`,'Free'],
          [item('shagbark-crossbow','Crossbow'),'—',`Quest <b>${weaponQuest('crossbow')}</b> from the <b>Archery Vendor</b> by the targets in Underleaf (any class, level 10): bring him 6 crossbow stocks the young hill giants carried off. You also get a crossbow.`,'Free'],
          ['Wand (magic)','Mages','Any class can cast with a wand or staff and a learned spell: see the <a href="#/guide/magic">Magic guide</a> for the schools and spell scrolls.','—']])+
        `<p class="g-note">Vendors no longer sell weapon tomes; one you already own still works, and they turn up on the Exchange. The mace, spear and crossbow tomes are retired, since the quests teach those. A skill learned from a tome can be unlearned from the Skills menu for <b>5,000 gold</b>, which gives the skill point back. Quest skills are permanent. Shields need no training. (The official guide and the game’s rules.)</p>`]
    ],related:['combat','attributes-and-classes']};
  }});

  reg({slug:'armor',group:'Combat',title:'Armor & shields',blurb:'The three armor tracks, how much each tier protects, shields, and metal vs magic.',build:()=>({lede:'Armor has five slots (head, body, arms, legs, feet). Each piece protects against blows (armor) and spells (magic defense).',sections:[
    ['tracks','Three tracks',kv([['Plate','Metal, needs STR. Made by Armor Smithing. Best against blows, weak against spells.'],['Pelt','Hides, needs DEX. Made by Leatherworking. Balanced.'],['Knick','Needs INT. Made by Tailoring. Best against spells.'],['Leather','No requirement: 7% against both, a stopgap until level 5.']])],
    ['sets','A full set protects',table(['Tier','Plate (blows / spells)','Pelt','Knick','To wear'],[['1','Iron 15% / 6%','Deerhide 9% / 8%','Impfeather 8% / 17%','Level 5, 20 of the stat'],['2','Silver 25% / 11%','Bearhide 16% / 16%','Snakeskin 14% / 29%','Level 15, 45'],['3','Gold 35% / 17%','Werewolfpelt 23% / 26%','Ogrewax 20% / 44%','Level 25, 70'],['4','Titanium 54% / 20%','Dragonhide 34% / 33%','Dragonscale 28% / 50%','Level 40, 100']])+note('Protection is capped at 75%. The body piece gives about three times what boots give. Mixing tiers lands in between.')],
    ['pools','Extra health, stamina or mana',`<p>A full set also raises one pool: plate adds health (+5 / 15 / 35 / 60 by tier), pelt adds stamina and knick adds mana (+5 / 10 / 15 / 20). Quality doesn’t change this.</p>`],
    ['types','Against damage types',`<p>Plate is a bit better against <b>stab and slash</b> (×1.10) and worse against <b>crush</b> (×0.80). Elemental damage is stopped by magic defense, which plate barely has.</p>`],
    ['shields','Shields',`<p>No training needed. <b>Rigid</b> shields (forged metal) block much more (up to 10.5) but stop spellcasting. <b>Soft</b> shields (wood, hide, knick) top out at 1.7 and let you cast.</p>`],
    ['metal','Metal and magic',`<p>Any metal armor piece or rigid shield makes <b>spells fizzle</b> (the mana is still spent). Firing a bow in metal armor costs 15 hit chance; crossbows are fine.</p>`]
  ],related:['combat','armor-smithing','leatherworking','tailoring','magic']})});

  // the game's spells: one row per spell level (the damage schools share numbers), and each school's spells by level
  function gameSpellTables(){
    const SP=globalThis.BXC_GAME_DATA?.spells;if(!Array.isArray(SP)||!SP.length)return null;
    const dmg=SP.filter(x=>x.effect==='damage'),byLevel=new Map();for(const x of dmg)if(!byLevel.has(x.level))byLevel.set(x.level,x);
    const levels=table(['Level','Damage','Per 10 MAG','Mana','Cooldown','Cast','INT'],[...byLevel.values()].sort((a,b)=>a.level-b.level).map(x=>[n(x.level),x.baseDamageMin+'–'+x.baseDamageMax,'+'+x.magScale,n(x.manaCost),(x.cooldownMs/1000).toFixed(1)+' s',(x.castTimeMs/1000).toFixed(2)+' s',n(x.intRequirement)]));
    const schools=[...new Set(SP.map(x=>x.school))];
    // one card per school; each spell links to the scroll that teaches it (the game's item "scroll-<spell>"). Acid Bolt
    // and Mend have no scroll: they come with learning the school.
    const NO_SCROLL={'acid-bolt':'comes with the Dark Witch’s Acid quest',mend:'comes with the Priest’s Restoration training'};
    const bySchool='<div class="sp-grid">'+schools.map(sc=>`<div class="sp-card"><h4>${esc(pretty(sc))}</h4>${SP.filter(x=>x.school===sc).sort((a,b)=>a.level-b.level).map(x=>{const id=slug(x.name),lv=`<span class="sp-lv">${x.level}</span>`;
      return NO_SCROLL[id]?`<div class="sp-spell">${lv}<span><b>${esc(x.name)}</b><small class="muted">No scroll: ${NO_SCROLL[id]}</small></span></div>`
        :`<button type="button" class="gg-pop-btn sp-spell" data-pop="spell" data-spell="${esc(x.id||id)}" data-gem="" title="The spell and where its scroll comes from">${lv}${icon('scroll-'+id)}<span><b>${esc(x.name)}</b><small class="muted">${x.level===1?'Starting spell or quest':(x.school==='restoration'?'Any caster':esc(pretty(x.school))+' casters')+', level '+({2:8,3:18,4:30})[x.level]+'+'}</small></span></button>`}).join('')}</div>`).join('')+'</div>';
    return {levels,bySchool};
  }
  // ---- Melee and Ranged: the weapon families on each side, from the game's own numbers ---------------------------
  const G_DATA=()=>globalThis.BXC_GAME_DATA||{};
  const ringText=(bonus,c)=>{const r=(G_DATA().rings||[]).find(x=>x.bonus===bonus);return r&&r.text?(r.text[c]||''):''};
  const weaponRows=list=>list.map(([name,skill,a,b,cd,reach,mult])=>{const avg=(a+b)/2*mult;
    return [esc(name),esc(pretty(skill)),`<span class="tag-chip weak">${dmgType(name,skill)}</span>`,`${a}–${b}${mult!==1?` <span class="muted">×${mult}</span>`:''}`,(cd/1000).toFixed(1)+' s',reach+' tiles',(avg/(cd/1000)).toFixed(2)]});
  const SD=()=>G_DATA().combat?.statDamage||{strength:.013,dexterity:.0085};
  reg({slug:'melee',group:'Melee',title:'Melee weapons',blurb:'Swords, daggers, maces and spears: damage, reach, the stat each uses, and how to learn them.',build:()=>{
    const list=WEAPONS.filter(w=>!['bow','crossbow'].includes(w[1]));
    return {lede:'Melee weapons hit the monster in front of you. Every family levels its own skill with the damage you deal, and each has five special attacks.',sections:[
      ['weapons','The weapons',table(['Weapon','Skill','Type','Roll','Swing every','Reach','Avg per second*'],weaponRows(list))+weaponQuestNote('mace')+weaponQuestNote('spear')+note('*Base roll only, before material, stats, quality and enchantments. At the same material every melee weapon does about the same damage per second: slow ones hit harder per swing. Spears reach 2.5 tiles, the rest 1.5.')],
      ['stats','Strength, Dexterity and crits',`<p>Swords, maces and spears add <b>${(SD().strength*100).toFixed(1)}% of their average roll per point of Strength</b>. The <b>dagger</b> is a finesse blade: it scales with <b>Dexterity</b> instead and crits more (+${CRIT_DAGGER}% crit chance on top of the ${CRIT_BASE}% base and ${CRIT_PER_DEX}% per Dexterity, capped at ${CRIT_CAP}%). A crit hits ×${CRIT_MULT}.</p>`],
      ['types','Picking by damage type',`<p>Maces <b>crush</b>, daggers, spears and the rapier <b>stab</b>, and the other swords <b>slash</b>. A monster weak to your type takes <b>${Math.round((WEAK-1)*100)}% more</b>; one that resists it takes <b>${Math.round((1-RESIST)*100)}% less</b>. <a href="#/guide/monster-families">Monster families</a> shows who is weak to what, and the <a href="#/calc-combat">Combat calculator</a> ranks monsters for your weapon.</p>`],
      ['boost','Enchants and rings',`<p>Weapon enchants: <b>Destruction</b> adds to every hit; <b>Flame</b>, <b>Freezing</b>, <b>Storm</b> and <b>Corrosion</b> add elemental damage. (Seeking is for bows and crossbows only.) Rings: <b>Brawler</b> (${esc(ringText('brawler',4)||'more melee damage')} at 4 carats), <b>Duelist</b> (${esc(ringText('duelist',4)||'more crit chance')}) and <b>Reaper</b> (${esc(ringText('reaper',4)||'more damage on low-health targets')}).</p>`],
      ['learn','Learning them',`<p>Warriors start with the sword and archers with the dagger. Warriors learn the <b>mace</b> (${weaponQuest('mace')}, Hester Bell near Rustpick Mine) and the <b>spear</b> (${weaponQuest('spear')}, Tobin Reed near Underleaf) from level 10–11 quests at no skill point; a sword or dagger tome costs a skill point. See <a href="#/guide/special-attacks">Weapon skills &amp; specials</a> for the full table and every special attack.</p>`]
    ],related:['special-attacks','combat','monster-families','armor']};
  }});
  reg({slug:'ranged',group:'Ranged',title:'Ranged weapons',blurb:'Bows and crossbows: range, Dexterity, ammunition, Seeking and the Hunter ring.',build:()=>{
    const list=WEAPONS.filter(w=>['bow','crossbow'].includes(w[1]));
    const ammo=(typeof RECIPES!=='undefined'?RECIPES:[]).filter(r=>/^(arrow|bolt|bodkin-arrow|bodkin-bolt)$/.test(r.id));
    return {lede:'Ranged weapons fire from a distance, so a monster has to cross the ground to reach you. They level their own skill with the damage you deal, with five special attacks each.',sections:[
      ['weapons','The weapons',table(['Weapon','Skill','Type','Roll','Shot every','Range','Avg per second*'],weaponRows(list))+weaponQuestNote('crossbow')+note('*Base roll only, before material, Dexterity, quality and enchantments. Bows slash and the crossbow stabs.')],
      ['stats','Dexterity and crits',`<p>Bows and crossbows add <b>${(SD().dexterity*100).toFixed(2)}% of their average roll per point of Dexterity</b>, and Dexterity also raises crit chance (${CRIT_PER_DEX}% a point on top of ${CRIT_BASE}%, capped at ${CRIT_CAP}%; a crit hits ×${CRIT_MULT}). Wooden weapons need Dexterity to equip.</p>`],
      ['ammo','Arrows and bolts',ammo.length?`<p>A <b>Bowyer</b> makes the ammunition:</p>`+table(['Item','Level','Makes','From'],ammo.map(r=>[item(r.id,r.item),n(r.level),'×'+(r.out||1),(r.ingredients||[]).map(i=>`${i.quantity}× ${item(i.id)}`).join(', ')])):'<p>A Bowyer makes arrows and bolts.</p>'],
      ['boost','Seeking, enchants and rings',`<p><b>Seeking</b> is the ranged enchant: +2% chance to hit per carat, and only bows and crossbows take it. The other weapon enchants work too. The <b>Hunter</b> ring (emerald) adds ${esc(ringText('hunter',4)||'more damage to arrows and bolts')} at 4 carats; <b>Duelist</b> adds crit chance and <b>Reaper</b> damage on low-health targets.</p>`],
      ['learn','Learning them',`<p>Archers start with the bow. Any class can learn the <b>crossbow</b> from level 10: the <b>Archery Vendor</b> by the targets in Underleaf offers <b>${weaponQuest('crossbow')}</b> (bring him 6 crossbow stocks the young hill giants carried off), free of skill points. A bow tome costs a skill point. See <a href="#/guide/special-attacks">Weapon skills &amp; specials</a> for every special attack.</p>`]
    ],related:['special-attacks','combat','bowyer','monster-families']};
  }});
  reg({slug:'magic',group:'Magic',title:'Magic',blurb:'Schools, the four spell levels, what each school does, and healing.',build:()=>({lede:'Spells need a wand-type item in your main hand and a spell learned from a scroll. Each school is a skill trained by the damage it deals.',sections:[
    ['learn','Unlocking schools and spells',`<p>Each school is a skill of its own, levelled by the damage (or, for Restoration, the healing) you do with it. Spells are learned from <b>scrolls</b>.</p>`+
        table(['School','How you get it'],[
          ['<b>Fire</b>, <b>Ice</b>, <b>Shock</b>','A mage picks one when they make their character and starts with its first spell. The other two come from <b>level-10 quests</b>, each paying the school, its first spell and a choice of its second spell as a scroll or an oak staff.'],
          ['<b>Acid</b>','Taught by the <b>Dark Witch</b> to a mage of level 20 or higher (the quest also pays Acid Bolt and a choice of a Caustic Blast scroll or two 1-carat emeralds). Nobody starts with it.'],
          ['<b>Restoration</b> (healing)','Taught by the <b>Priest</b> to a mage of level 10 or higher; mages only. It adds to the school the mage already has.']])+
        table(['Spell level','Needs INT','Needs school skill'],[['1','10','—'],['2','20','5'],['3','30','15'],['4 (area)','40','25']])+
        `<p class="g-note">Both needs are checked when you learn the scroll and again on every cast, so moving your points can lock a spell. Casting needs a wand or a staff in your main hand, and any metal armor or metal shield makes the cast fizzle. (The official guide.)</p>`],
    ...(gameSpellTables()?[['spells','Every spell',gameSpellTables().bySchool]]:[]),
    // The official guide (healing scrolls: any caster, tier by the dropper's level 8/18/30), the game's own rules (a
    // scroll is picked by school and tier, tiers 2-4, for every school) and the drop logs (damage scrolls: every
    // level-3 from monsters level 25-31, every level-4 from 28 up and only level-4s past 31; the dropper a caster).
    ['scrolls','Where scrolls drop',`<p>Spell scrolls drop from <b>monsters that cast spells</b>, and only for spell levels 2 to 4: level-1 spells come from your class or a quest. Which scroll drops depends on two things:</p>
      <ul class="g-list"><li><b>The school the monster casts.</b> A fire caster drops fire scrolls, an ice caster ice scrolls, and so on. Restoration scrolls are the exception: any caster can drop those, whatever school it casts.</li>
      <li><b>The monster’s level</b> picks the spell level: level <b>8+</b> drops level-2 scrolls, <b>18+</b> level-3 and <b>30+</b> level-4.</li></ul>`
      +table(['Monster level','Scroll','Fire','Ice','Shock','Acid','Restoration'],[['8+','Level 2','Fire Blast','Ice Zap','Sparkbolt','Caustic Blast','Renew'],['18+','Level 3','Firepit','Ice Grasp','Lightning','Acid Pit','Ward'],['30+','Level 4','Fireball','Blizzard','Thunderstorm','Acid Rain','Sanctuary']])
      +note('The level rule and the restoration exception are from the official guide. The game’s own rules pick a scroll by school and level. Players’ drop logs fit both: every level-3 scroll came from monsters level 25–31, and every level-4 from monsters level 28 and up (most of them 30+). No level-2 scroll has been logged yet.')],
    ['levels','Spell levels',gameSpellTables()?gameSpellTables().levels+note('From the game’s own spell table. Casting is cancelled by moving; level-4 spells hit an area you place. Cooldowns are shared by spell level across schools.'):table(['Level','Damage','Per 10 MAG','Mana','Cooldown','INT','School skill'],[['1','4–6','+0.5','3','2.4 s','10','—'],['2','5–9','+0.7','4','3.2 s','20','5'],['3','7–11','+0.9','8','4.8 s','30','15'],['4','7–11 each (area)','+0.9','30','6.4 s','40','25']])+note('Casting takes 0.6 s (level 1) to 1.3 s (level 4) and moving cancels it. Level-4 spells hit an area you place. Cooldowns are shared by spell level across schools, with a 2.4 s global cooldown; a killing blow resets them all.')],
    ['schools','What each school adds',`<p>From spell level 2, a hit can add its school’s effect: a 20% chance, rising with MAG up to 90%.</p>`+table(['School','Effect','Spells'],[['Fire','Burn: another 25% of the hit as fire over 4 s','Burning Arrow, Fire Blast, Firepit, Fireball'],['Ice','Chill: 30% slower movement and attacks','Ice Bolt, Ice Zap, Ice Grasp, Blizzard'],['Shock','Stun for 1 s, then a short immunity','Shockbolt, Sparkbolt, Lightning, Thunderstorm'],['Acid','Corroded: takes up to 12% more damage from everything','Acid Bolt, Caustic Blast, Acid Pit, Acid Rain'],['Restoration','Heals, and may remove one debuff','Mend, Renew, Ward, Sanctuary']])],
    ['damage','Damage and mana',`<p>Every full 10 MAG above 10 raises spell damage; the wand itself does not. Mana does not come back during a fight; damage spells still cast at 0 mana but weaker, heals do not. A <b>staff</b> (made by Bowyers) enchanted to a school adds school damage too. Metal armor stops all casting (see ${guide('armor')}).</p>`],
    ['healing','Healing',`<p>Mend heals at once; Renew heals over 6 s (about 1.5 Mends); Ward is a shield that lasts 8 s or one big hit; Sanctuary heals everyone in an area four times over 6 s. Healing yourself does half. Healing someone under attack draws the monsters to you. Renew, Ward and Sanctuary scrolls drop from any monster that casts spells (see Where scrolls drop above).</p>`]
  ],related:['combat','attributes-and-classes','quality-and-enchanting']})});

  reg({slug:'shearing',group:'Gathering skills',title:'Shearing',blurb:'Wool from sheep, and what it is used for.',build:()=>{
    const uses=usesOf('wool');const skills=[...new Set(uses.map(r=>r.skill))];
    return {lede:'Use shears on a sheep to get wool. The sheep runs off a little, and its fleece grows back in about a minute; most sheep give a second clip and a few a third.',sections:[
      ['levels','Levelling',`<p>Success climbs quickly over the first levels, and after that levels add to how much you get.</p>`],
      specialEventBlurb('shearing'),
      ['uses','What wool is for',`<p>${skills.map(s=>skillGuideLink(s)).join(' · ')}</p>`+table(['Skill','Level','Makes','Needs'],uses.map(r=>[esc(r.skill),n(r.level),item(r.id,r.item),ingList(r)]))],
      ['where','Where the sheep are',`<p>Sheep are in the <a href="#/monster/sheep">Bestiary</a>; their page shows where they have been seen.</p>`]
    ],related:['tailoring','bowyer','tool-smithing']};
  }});

  reg({slug:'economy',group:'World',title:'Gold, vendors & the Exchange',blurb:'Vendor prices, the player market, platinum and taxes.',build:()=>({lede:'Gold comes from monsters and selling; the Exchange lets players trade with each other without meeting.',sections:[
    ['vendors','Vendors',`<ul class="g-list"><li>Vendors sell for <b>5× what they pay</b>. Weapons, armor and shields above tier 1 (and that tier’s wood, hides and cloth) cost far more: silver 45×, gold 180×, titanium 145×.</li><li>They pay an extra <b>1,000 gold per carat</b> of enchantment on an item.</li><li>Stock is limited. Sales of 1,000 gold or more ask you to confirm.</li><li>Selling many of the <b>same item</b> pays a little less for each copy the vendor already holds, down to a floor (since 5 October 2026), so spreading big sales across vendors or days pays more.</li></ul>`],
    ['exchange','The Exchange',`<p>The player market, on the website and at Exchange Clerks in the game, in gold only.</p>`+kv([['Tax','5% on sales'],['Orders','25 per character; they never expire and hold their slot until the goods are collected'],['Stackables','Materials, potions, ammo and warp scrolls trade as a pool at the resting price'],['Gear and gems','Trade by exact quality, enchantment and carat'],['Collecting','Gold goes straight to you; goods are picked up from a clerk']])],
    ['platinum','Platinum',`<p>Platinum is bought with real money (1,000 per US$1, with a bonus on bigger packs), is shared across your account and cannot be traded. It pays for things like founding a guild.</p>`],
    ['gems','Selling gems',`<p>The ${OFFICIAL} says vendors pay 100 gold per carat for gems in one place and nothing in another, so check before selling.</p>`]
  ],related:['playing-together','gems','death-and-banking']})});

  reg({slug:'playing-together',group:'World',title:'Parties, trading & guilds',blurb:'Party XP, trading safely, what a guild costs, and building a guildhouse.',build:()=>({lede:'Binxonia is better with friends: parties share kill XP with a bonus, and guilds share a vault and can build a hall of their own.',sections:[
    ['party','Parties',`<p>Up to <b>4</b> players. Kill XP is pooled with <b>+10% for each extra member</b> and split evenly between members nearby on the same floor. Party members can’t hurt each other. Type <b>/p</b> for party chat.</p>`],
    ['trade','Trading',`<p>Both players put items in the trade window and both confirm; any change clears the confirmations, so check the window before accepting. Type <b>!</b> in chat to link an item.</p>`],
    ['guild','Guilds',table(['',''],[['Founding','20,000 platinum at a Guildmaster; a unique name and a 3-letter tag'],['Ranks','Member, Officer (invites, kicks), Leader (everything)'],['Upkeep','Every 30 days: 250 platinum per member, at least 2,500. Unpaid: the vault is sealed; 14 days late: the guild is disbanded'],['Vault','Tabs of 60 slots; the first is free, more cost 5,000 platinum each (up to 10)'],['Hall','Level 1: 25 members. Level 2 (25,000): 50. Level 3 (75,000): 100']],'g-kv')],
    ['guildhouse','Building a guildhouse',`<ul class="g-list"><li>Every new guild gets a <b>free deed</b>. The leader uses it on an open guild lot and building starts right away.</li>
      <li>Members bring materials to the <b>construction box</b> on the lot and donate them; then anyone with a <b>saw and enough Carpentry</b> works the sawhorse. See ${guide('carpentry')}.</li>
      <li>Work goes in <b>phases</b>, each opening the next. Building can start before a phase is fully supplied, but pauses when the next action needs something nobody has brought yet. The hall’s notice board shows what is still needed.</li>
      <li>The <b>first tier has a deadline</b>: miss it and the supplies and progress are lost, but the guild gets its deed back.</li>
      <li>Donated supplies and furniture <b>belong to the guild</b>: they can’t be taken back and are lost if the guild disbands. The construction box keeps a history of who gave what and who did the work, former members included.</li>
      <li>A finished hall can be <b>remodelled</b> into a bigger one, paid from the treasury, with no deadline, and stays open meanwhile. The guild can only take on more members as its hall grows.</li></ul>`],
    ['hall','Inside the hall',`<ul class="g-list"><li>Members use the rooms, crafting stations, bunks, the garden and the mine; the leader and officers arrange the furniture.</li>
      <li>A permanent <b>chest opens the guild vault</b>, and banners show the guild’s emblem and colours. Finishing the biggest hall unlocks picture emblems: a dragon, a phoenix, a griffin, a wolf, a lion, a stag, a raven, a crown, crossed swords and a castle tower.</li>
      <li>Bigger halls get more stations, including their own <b>furnace and sawmill</b>; crafting there uses your own materials.</li>
      <li>A <b>bunk</b> gives the same rest bonus as a bed at home and shares its cooldown.</li>
      <li>The <b>garden is shared</b>, and members dig the <b>guild mine</b> together and share its rocks; each remodel lets it go deeper.</li>
      <li>The notice board also carries messages and gathering requests from the leader and officers.</li>
      <li><b>Guild Recall</b>, a Scribing scroll, takes members to a finished hall from anywhere.</li>
      <li>If the guild falls behind on <b>upkeep</b>, the hall closes along with the vault until the debt is paid.</li></ul>`+note('From the game’s update notes of 5 October 2026. Costs, deadlines and the materials for each phase aren’t published yet.')]
  ],related:['economy','housing','carpentry']})});

  // Quests, from what the collector recorded (store "quests": one record per quest, see background.js recordQuest):
  // who gives it, the level, length, quest points, the game's blurb and the exact rewards; the steps and their map
  // spots, what the quest-giver says and the closing line fill in as quests are played with the collector running.
  // "All quests" lists them; every quest has its own page, #/guide/quest-<quest id>, made on the fly from its record.
  const questList=()=>((globalThis.BINXONIA_COLLECTOR_SNAPSHOT||{}).quests||[]).filter(q=>q&&q.name).sort((a,b)=>(a.recommendedLevel||0)-(b.recommendedLevel||0)||String(a.name).localeCompare(b.name));
  const questSlug=q=>'quest-'+slug(q.questId||q.name);
  const questBySlug=s=>String(s||'').startsWith('quest-')?questList().find(q=>questSlug(q)===s)||null:null;
  // your page edits (page-edits.js, written by the app's page editor): a quest's steps, notes and whether it is done.
  // A quest not marked done gets an alert: on its card on the Quests page, and a banner on its own page.
  const questEdit=q=>((globalThis.BXC_PAGE_EDITS||{}).pages||{})['quest:'+q.questId]||null;
  const questDone=q=>!!questEdit(q)?.done;
  // an edit's text: [[#/route|Label]] a link, [[map:kind:id|Label]] shows it on the map, [[spot:x,y|Label]] a spot,
  // [[https://...|Label]] a page elsewhere, **bold**, line breaks; everything else stays plain text
  function editText(t){
    return esc(String(t||'')).replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,(m,a,label)=>{
      if(/^#\/[\w\-\/%.!~:]+$/.test(a))return `<a href="${a}">${label}</a>`;
      if(/^https:\/\/[\w.-]+\/[\w\-\/%.!~:?=;#]*$/.test(a))return `<a href="${a}" target="_blank" rel="noopener">${label}</a>`;   // a page elsewhere (opens in a new tab)
      let mm=a.match(/^map:(npc|monster|item|resource|place|zone):(.+)$/);if(mm)return `<button type="button" class="show-on-map q-map-btn" data-map-kind="${mm[1]}" data-map-id="${mm[2]}">\u{1F4CD} ${label}</button>`;
      mm=a.match(/^spot:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);if(mm)return `<button type="button" class="show-on-map q-map-btn" data-map-kind="spot" data-map-id="${mm[1]}|${mm[2]}|${label}">\u{1F4CD} ${label}</button>`;
      return m;
    }).replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>');
  }
  globalThis.bxcEditText=editText;
  function editBlocks(t){
    return String(t||'').replace(/\r/g,'').split(/\n\s*\n/).map(b=>b.trim()).filter(Boolean).map(b=>{const ls=b.split('\n').map(x=>x.trim()).filter(Boolean);
      if(ls.every(x=>/^\d+[.)]\s/.test(x)))return '<ol>'+ls.map(x=>'<li>'+editText(x.replace(/^\d+[.)]\s+/,''))+'</li>').join('')+'</ol>';
      if(ls.every(x=>/^[-*\u2022]\s/.test(x)))return '<ul>'+ls.map(x=>'<li>'+editText(x.replace(/^[-*\u2022]\s+/,''))+'</li>').join('')+'</ul>';
      return '<p>'+editText(ls.join('\n'))+'</p>'}).join('');
  }
  globalThis.bxcEditBlocks=editBlocks;
  // where the editor opens (only where editing works: the app's own copy, or the website inside the app)
  const questEditBtn=q=>globalThis.bxcCanEdit?`<p><button type="button" class="q-edit-btn" data-quest-id="${esc(q.questId)}">Edit steps &amp; notes</button></p>`:'';
  const ALERT_SVG='<svg class="q-alert-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20z" fill="currentColor"/><path d="M12 10v5M12 17.6v.4" stroke="#1b1300" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const questLink=q=>`<a href="#/guide/${enc(questSlug(q))}">${esc(q.name)}</a>`;
  const Q_CATS=[['story','Story'],['unlock','Mount & companion quests'],['skillunlock','Skill unlocks'],['combat','Combat skill unlocks'],['side','Side quests']];   // (a skill quest that unlocks nothing, e.g. A Winter's Wool, is a side quest)
  // by what the reward unlocks, whatever the game files the quest under: a mount or the pack mule -> Mount & companion quests;
  // a skill (Carpentry, Herblore) -> Skill unlocks; a weapon skill or a magic school -> Combat skill unlocks
  const nonEmpty=a=>Array.isArray(a)&&a.length>0;
  // a page of its own for each group (in the Guides menu under Quests)
  const QG_PAGES={story:['quests-story','Story quests','The main story: quests that follow on from one another and open up new places.'],
    unlock:['quests-mounts','Mount & companion quests','Quests that give you a mount or a companion, such as the pack mule.'],
    skillunlock:['quests-skills','Skill unlocks','Quests that teach you a new skill.'],
    combat:['quests-combat','Combat skill unlocks','Quests that teach you a weapon skill or a school of magic.'],
    side:['quests-side','Side quests','Stories around the world that pay gold, XP and items.']};
  const questCat=q=>{const r=q.rewards||{};if(r.unlockPackMule||nonEmpty(r.unlockMounts))return 'unlock';if(nonEmpty(r.skills))return 'skillunlock';if(nonEmpty(r.weaponSkills)||nonEmpty(r.spellSchools))return 'combat';return Q_CATS.some(c=>c[0]===q.category)?q.category:'side'};
  const qn=v=>Math.round(+v||0).toLocaleString('en-US');
  const questZone=z=>{const r=((globalThis.BINXONIA_COLLECTOR_SNAPSHOT||{}).zones||[]).find(x=>Number(x.z)===Number(z));return r&&(r.name||r.label)||null};
  function questGiver(q){
    if(!q.giverName)return '<span class="muted">unknown</span>';
    const p=globalThis.bxcNpcByName&&globalThis.bxcNpcByName(q.giverName);
    return p?`<a href="${esc(p.href)}">${esc(q.giverName)}</a>${p.onMap?` <button type="button" class="show-on-map" data-map-kind="npc" data-map-id="${esc(p.slug)}">Show on map</button>`:''}`:esc(q.giverName);
  }
  // the quest-giver's name as a link to their page (plain text when nobody by that name has been recorded)
  const giverLink=q=>{if(!q.giverName)return '';const p=globalThis.bxcNpcByName&&globalThis.bxcNpcByName(q.giverName);return p?`<a href="${esc(p.href)}">${esc(q.giverName)}</a>`:esc(q.giverName)};
  const questSkill=s=>pretty(s.skill||s.skillId||s.id||s);
  // Skills a quest unlocks and needs, as players who did it reported, where the game's reward list has it wrong: The
  // Scriptorium Apprentice needs Herblore and unlocks Scribing (the game lists Herblore as what it unlocks).
  const QUEST_SKILLS={};   // none needed now: The Scriptorium Apprentice unlocks Herblore, as the game says
  const questRequiresSkills=q=>(QUEST_SKILLS[q.questId]?.requires||[]).map(k=>`<a href="#/guide/${esc(k)}">${esc(pretty(k))}</a>`);
  // what finishing a quest opens up, short, for the About box: skills, weapon skills, an area or a dungeon
  function questUnlockFacts(q){
    const r=q.rewards||{},sk=k=>byslug.has(slug(k))?`<a href="#/guide/${esc(slug(k))}">${esc(pretty(k))}</a>`:esc(pretty(k));
    return [...(QUEST_SKILLS[q.questId]?.unlocks||(r.skills||[]).map(x=>x.skill||x)).map(x=>'the '+sk(x)+' skill'),
      ...(r.weaponSkills||[]).map(x=>`the <a href="#/guide/special-attacks">${esc(pretty(x.skill||x))}</a> weapon skill`),
      ...(QUEST_AREAS[q.questId]?['access to '+esc(QUEST_AREAS[q.questId].place)]:[]),
      ...(QUEST_UNLOCKS[q.questId]?[esc(QUEST_UNLOCKS[q.questId].name)]:[])];
  }
  // quests whose listed items are handed over at the start, not as the reward (the quest-giver's own words)
  const QUEST_START_ITEMS=new Set(['plymouth-carpenters-trade']);
  function questRewards(q){
    const r=q.rewards||{},rows=[];
    if(r.gold)rows.push(['Gold',qn(r.gold)]);
    if(r.characterXp)rows.push(['Character XP',qn(r.characterXp)]);
    for(const s of [...(r.skillXp||[]),...(r.combatSkillXp||[])])rows.push([esc(questSkill(s))+' XP',qn(s.amount)]);
    if(q.questPoints)rows.push(['Quest points',String(q.questPoints)]);
    const items=(r.items||[]).map(i=>item(i.typeId)+(i.quantity>1?' ×'+qn(i.quantity):''));
    if(items.length)rows.push([QUEST_START_ITEMS.has(q.questId)?'Given when you take it':'Items',items.join('<br>')]);
    const choice=(r.choice||[]).map(i=>item(i.typeId)+(i.quantity>1?' ×'+qn(i.quantity):''));
    if(choice.length)rows.push(['Choose one',choice.join('<br><span class="muted">or</span> ')]);
    const skillLink=k=>byslug.has(slug(k))?`<a href="#/guide/${esc(slug(k))}">${esc(pretty(k))}</a>`:esc(pretty(k));
    const unlocks=(QUEST_SKILLS[q.questId]?.unlocks||(r.skills||[]).map(x=>x.skill||x)).map(x=>'the '+skillLink(x)+' skill').concat([...(r.weaponSkills||[]).map(x=>''+(x.skill||x)),...(r.spellSchools||[]).map(x=>pretty(x.school||x)+' magic'),...(r.spells||[]).map(x=>pretty(x.spell||x)),...(r.unlockPackMule?['a pack mule']:[]),...(r.unlockMounts||[]).map(x=>pretty(x))].map(x=>x.startsWith('')?`the <a href="#/guide/special-attacks">${esc(pretty(x.slice(1)))}</a> weapon skill`:esc(x)));
    if(unlocks.length)rows.push(['Unlocks',unlocks.join(', ')]);
    return rows.length?table(['Reward',''],rows,'q-rewards'):'<p class="muted">No rewards recorded.</p>';
  }
  const questRewardLine=q=>{const r=q.rewards||{},b=[];if(r.gold)b.push(qn(r.gold)+' gold');if(r.characterXp)b.push(qn(r.characterXp)+' XP');if((r.items||[]).length||(r.choice||[]).length)b.push('items');if(q.questPoints)b.push(q.questPoints+' QP');return b.join(' · ')};
  // The steps: 1 is always "talk to the quest-giver" (where they are, with a map button); then your own steps (the
  // page editor, page-edits.js), or else the stages the game sent while someone was on the quest (numbered after it).
  // A quest that needs another one finished first (the story runs on: Cargo for the Isle, then The Ogre Traitor - same
  // quest-giver, and the second picks up where the first ends)
  const QUEST_PREREQS={'plymouth-the-ogre-traitor':['plymouth-cargo-for-the-isle']};
  // Quest chains: quests done in order, the last one opening something up. Shown at the top of each quest in it.
  const QUEST_CHAINS=[{ids:['plymouth-cargo-for-the-isle','plymouth-the-ogre-traitor'],ends:'Access to Ogre Isle'}];
  function questChain(q){
    const c=QUEST_CHAINS.find(c=>c.ids.includes(q.questId));if(!c)return '';
    const i=c.ids.indexOf(q.questId),list=questList();
    const step=(id,k)=>{const p=list.find(x=>x.questId===id),nm=esc(p?p.name:pretty(id));
      return id===q.questId?`<span class="q-chain-step on"><i>${k+1}</i>${nm}</span>`:`<a class="q-chain-step" href="#/guide/quest-${esc(slug(id))}"><i>${k+1}</i>${nm}</a>`};
    const left=c.ids.length-1-i;
    return `<div class="q-chain" role="note"><b>Quest chain</b> <span class="muted">· part ${i+1} of ${c.ids.length}${left?`, ${left} more after this one`:', the last one'}</span>
      <div class="q-chain-row">${c.ids.map(step).join('<span class="q-chain-arrow">→</span>')}<span class="q-chain-arrow">→</span><span class="q-chain-step end">🔓 ${esc(c.ends)}</span></div></div>`;
  }
  // an objective's text, with a person it names (o.npc, or a recorded named NPC whose name it contains) linked to them
  const objText=o=>{const t=String(o.text||''),nm=o.npc||null,p=nm&&globalThis.bxcNpcByName?globalThis.bxcNpcByName(nm):null;
    if(!p||!t.includes(nm))return esc(t);const i=t.indexOf(nm);return esc(t.slice(0,i))+`<a href="${esc(p.href)}">${esc(nm)}</a>`+esc(t.slice(i+nm.length))};
  function questSteps(q){
    // (10 Oct 2026) the game reports a new stage number on every kill while the objectives stay the same, so a kill step
    // was listed once per kill (Kill 15 Dune Outriders, fifteen times): stages in a row with the same objectives are one
    // step, keeping a map waypoint any copy of them has
    const st=[];
    for(const s0 of (q.stages||[]).filter(s=>s.objectives&&s.objectives.length)){
      const sig=s0.objectives.map(o=>o.id||o.text).join('|'),last=st[st.length-1];
      if(last&&last._sig===sig){last.objectives=last.objectives.map((o,i)=>o.waypoints&&o.waypoints.length||!s0.objectives[i]?o:{...o,waypoints:s0.objectives[i].waypoints});continue}
      st.push({...s0,_sig:sig,objectives:s0.objectives.slice()});
    }
    const placeOf=w=>(globalThis.bxcPlaceAt&&globalThis.bxcPlaceAt(w.z,w.x,w.y))||questZone(w.z);   // the building or dungeon it is in, not just its zone number
    // a named place links to it on the map: the game's own marker (Imp Tree), else the building's or cave's entrance
    const placeLink=w=>{const n=placeOf(w);if(!n)return '';const poi=(typeof D!=='undefined'&&D.pois||[]).find(p=>p.name===n);return `<a href="#" class="show-on-map" data-map-kind="${poi?'place':'zone'}" data-map-id="${esc(poi?poi.name:String(w.z))}">${esc(n)}</a>`};
    const where=(w,label)=>w?(w.z&&w.z!==0?` <span class="muted">inside ${placeOf(w)?placeLink(w):'a cave or building'}${placeOf(w)?'':` (${Math.round(w.x)}, ${Math.round(w.y)})`}</span>`:` <span class="muted">at ${Math.round(w.x)}, ${Math.round(w.y)}</span> <button type="button" class="show-on-map" data-map-kind="spot" data-map-id="${esc(Math.round(w.x)+'|'+Math.round(w.y)+'|'+(label||''))}">Show on map</button>`):'';
    const g=q.giverName?(globalThis.bxcQuestGivers?globalThis.bxcQuestGivers():[]).find(x=>x.name===q.giverName):null;
    const p=!g&&q.giverName&&globalThis.bxcNpcByName?globalThis.bxcNpcByName(q.giverName):null;
    const who=q.giverName?(g||p?`<a href="${esc((g||p).href)}">${esc(q.giverName)}</a>`:esc(q.giverName)):'the quest-giver';
    // the quest names which one gives it (q.giverNpcId): its own spot, not the first of everyone with that name
    const gs=q.giverNpcId&&globalThis.bxcNpcSpot?globalThis.bxcNpcSpot(q.giverNpcId):null,gsOut=gs&&!gs.z;
    const whereGiver=gsOut?` <span class="muted">(outdoors ${esc(gs.near||'')})</span>`:g&&g.where&&g.where[0]?` <span class="muted">(${esc(g.where[0])})</span>`:'';
    const mapBtn=gsOut?` <button type="button" class="show-on-map" data-map-kind="spot" data-map-id="${esc(Math.round(gs.x)+'|'+Math.round(gs.y)+'|'+(q.giverName||''))}">Show on map</button>`:(g&&g.onMap)||(p&&p.onMap)?` <button type="button" class="show-on-map" data-map-kind="npc" data-map-id="${esc((g||p).slug)}">Show on map</button>`:'';
    const steps=[`<li value="1">Talk to ${who}${whereGiver} to get the quest.${mapBtn}</li>`];
    // your own steps (page editor), when written: they are the whole list after taking the quest
    const ed=questEdit(q);
    if(ed&&String(ed.first||'').trim())steps[0]=`<li value="1">${editText(ed.first)}</li>`;   // your own step 1 (taking the quest)
    if(ed&&Array.isArray(ed.steps)&&ed.steps.some(x=>String(x||'').trim())){ed.steps.filter(x=>String(x||'').trim()).forEach((t,k)=>steps.push(`<li value="${k+2}">${editText(t)}</li>`));return '<ol class="q-steps">'+steps.join('')+'</ol>'}
    if(st.length){
      st.forEach((s,k)=>steps.push(`<li value="${k+2}">${s.text&&!s.objectives.some(o=>o.text===s.text)?`<b>${esc(s.text)}</b><br>`:''}${s.objectives.map(o=>`${objText(o)}${o.required>1?` <span class="muted">(${qn(o.required)})</span>`:''}${o.itemTypeId?' - '+item(o.itemTypeId):''}${where((o.waypoints||[])[0],o.text)}${o.afterHtml||o.after?` <span class="muted">- ${o.afterHtml||esc(o.after)}</span>`:''}`).join('<br>')}</li>`));
      return '<ol class="q-steps">'+steps.join('')+'</ol>'+((st[0].n||0)>0?note('Some steps in between were not recorded.'):'');
    }
    return '<ol class="q-steps">'+steps.join('')+'</ol>'+note('The rest of the steps are still missing: the data for this quest is incomplete.');
  }
  const questTalk=q=>(q.dialogue||[]).map(d=>'<div class="q-conv">'+d.lines.map(x=>`<p class="${x.speaker==='npc'?'q-npc':'q-you'}"><b>${x.speaker==='npc'?esc(d.npcName||q.giverName||'NPC'):'You'}:</b> ${esc(x.text)}</p>`).join('')+'</div>').join('');
  // What finishing a quest opens up, from the game's news (the quest log does not say). The contents and the ways in
  // come from what the collector recorded inside (zone z).
  const QUEST_UNLOCKS={
    'wasteland-nothing-gets-through':{z:-101,name:'Agauton Mine',questName:'Nothing Gets Through',
      text:'Finishing this quest opens the old gold mine in the Wastelands: a slide shut it, and both ways into it stay closed until you have helped Wilson Barthrone.',
      source:{title:'Update: Three Ladders and a Furnace',date:'12 Sep 2026',url:'https://binxonia.com/news/update-three-ladders-and-a-furnace'}}
  };
  // for the zone pages and layouts: the quests needed to get into a zone
  globalThis.bxcZoneQuests=z=>Object.entries(QUEST_UNLOCKS).filter(([,u])=>Number(u.z)===Number(z)).map(([id,u])=>{const q=questList().find(x=>x.questId===id);return {name:q?q.name:u.questName,href:'#/guide/quest-'+slug(id),giver:q&&q.giverName||null}});
  // a whole area a quest opens (the game's own region; atlas-live QUEST_REGIONS draws its lock): its monsters and places
  const QUEST_AREAS={'plymouth-the-ogre-traitor':{place:'Ogre Isle',text:'Finishing it earns the crossing to Ogre Isle, so the whole island and everything on it opens up. Gerald Seabroden sends you to the dock: “You’ve earned the crossing.” The ferry out costs 50 gold, and the way back is free.',news:[['update-the-exchange-opens','The Exchange Opens','13 Sep 2026'],['update-ogre-isle-opens-at-thirty','Ogre Isle Opens at Thirty','26 Sep 2026']]}};
  function questAreaUnlocks(q){const a=QUEST_AREAS[q.questId];if(!a)return '';
    const S=globalThis.BINXONIA_COLLECTOR_SNAPSHOT||{},at=globalThis.bxcQuestRegionAt;if(typeof at!=='function')return `<p>${esc(a.text)}</p>`;
    const by=new Map();for(const o of [...(S.npcObservations||[]),...(S.npcs||[])]){const p=o&&o.position;if(!p||p.z)continue;const v=by.get(o.typeId)||[0,0];v[1]++;if(at(p.x,p.y))v[0]++;by.set(o.typeId,v)}
    const only=[...by].filter(([,v])=>v[0]&&v[0]>=v[1]*.9).map(([t])=>(typeof D!=='undefined'&&D.catalog||[]).find(m=>m.typeId===t)).filter(Boolean).sort((x,y)=>(x.baseLevel||0)-(y.baseLevel||0));
    const places=(typeof D!=='undefined'&&D.pois||[]).filter(p=>at(+p.x,+p.y));
    return `<p><b>${esc(a.place)}</b></p><p>${esc(a.text)}</p>`
      +(only.length?`<p>Found only there: ${only.map(m=>monster(m.typeId,m.name)+(m.baseLevel?' <span class="muted">Lv '+esc(m.baseLevel)+'</span>':'')).join(', ')}.</p>`:'')
      +(places.length?`<p>Places: ${places.map(p=>esc(p.name)).join(', ')}.</p>`:'')
      +(a.news?note('Since 26 Sep 2026 Ogre Isle is a level 30 area (it was 45). From the Binxonia news: '+a.news.map(([u,t,d])=>`<a href="https://binxonia.com/news/${u}" target="_blank" rel="noopener">${esc(t)}</a> (${esc(d)})`).join(', ')+'.'):'')}
  function questUnlocks(q){
    const u=QUEST_UNLOCKS[q.questId];
    const ws=(q.rewards?.weaponSkills||[]).map(x=>x.skill||x);
    if(!u&&ws.length)return ws.map(k=>`<p>The <b><a href="#/guide/special-attacks">${esc(pretty(k))}</a> weapon skill</b>: this quest is how you learn it (the ${esc(k)} tome is retired). Once you have it you can wield ${esc(k)}s, the skill levels with the damage you deal, and it unlocks five special attacks along the way.</p>`).join('');
    if(!u){const c=QUEST_CHAINS.find(c=>c.ids.includes(q.questId)),i=c?c.ids.indexOf(q.questId):-1;
      if(c&&i<c.ids.length-1){const id=c.ids[i+1],p=questList().find(x=>x.questId===id);
        return `<p><a href="#/guide/quest-${esc(slug(id))}">${esc(p?p.name:pretty(id))}</a>, the next quest in the chain to <b>${esc(c.ends.replace(/^Access to /,''))}</b>.</p>`}
      return questAreaUnlocks(q)}
    const S=globalThis.BINXONIA_COLLECTOR_SNAPSHOT||{},z=Number(u.z);
    const rocks=new Map();for(const o of S.worldObjects||[]){const p=o&&o.position;if(!p||Number(p.z)!==z||!/-rock$/.test(o.typeId||''))continue;rocks.set(o.typeId,(rocks.get(o.typeId)||0)+1)}
    const res=[...rocks].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([t,n])=>`${n} ${esc(pretty(t.replace(/-rock$/,'')))} rock${n===1?'':'s'}`);
    // places you walk in from: only ways seen more than once (a single odd crossing - a warp, a death - is not a way in)
    const near=new Map();for(const t of S.zoneTransitions||[]){if(Number(t.toZ)===z&&t.fromZ!=null&&Number(t.fromZ)!==z)near.set(Number(t.fromZ),(near.get(Number(t.fromZ))||0)+1)}
    const nearNames=[...near].filter(([,n])=>n>=2).map(([k])=>questZone(k)).filter(Boolean);
    return `<p><b>${esc(u.name)}</b> <button type="button" class="show-on-map" data-map-kind="zone" data-map-id="${z}">Show on map</button> <button type="button" class="open-zone" data-zone="${z}">Open the layout</button></p><p>${esc(u.text)}</p>`
      +(res.length?`<p>Inside: ${res.join(', ')}.</p>`:'')
      +(nearNames.length?`<p>You can also get in from ${nearNames.map(esc).join(' and ')}.</p>`:'')
      +note(`From the Binxonia news, <a href="${esc(u.source.url)}" target="_blank" rel="noopener">${esc(u.source.title)}</a> (${esc(u.source.date)}); what is inside is what players have recorded there.`);
  }
  // What you have to bring to finish a quest: the items the game names for its steps (collect / deliver), items named
  // in the steps' own words (matched to real item names), and items the collector saw collected for it. How many is
  // the most any step asked for.
  // What a quest needs that the game does not send, as reported by players who finished it. oneOf: hand in any one of
  // these; quality: the least quality it must be.
  const QUEST_REQUIRES={
    'wasteland-nothing-gets-through':{kind:'gold items',oneOf:[{id:'gold-arms',also:'gauntlets'},{id:'gold-sword',also:'short sword'},{id:'gold-scribing-quill'}],quality:'excellent',
      text:'Bring Wilson Barthrone one of these gold items:',who:'Any character on your account, or anyone in your guild, can make it.'}
  };
  function questRequiresHtml(q){
    const r=QUEST_REQUIRES[q.questId];if(!r)return '';
    const QT=typeof QUALITY_TIERS!=='undefined'?QUALITY_TIERS:[],qi=QT.indexOf(r.quality),ok=qi>=0?QT.slice(qi):[r.quality];
    const rec=id=>(typeof RECIPES!=='undefined'?RECIPES:[]).find(x=>x.id===id);
    return `<p>${esc(r.text)}</p><ul class="q-needs">${r.oneOf.map(o=>{const x=rec(o.id);return `<li>${item(o.id)}${o.also?' <span class="muted">('+esc(o.also)+')</span>':''}${x?` <span class="muted">· ${esc(x.skill)} ${x.level}</span>`:''}</li>`}).join('')}</ul>`
      +(r.quality?`<p>It must be <span class="q-name q-${esc(r.quality)}">${esc(pretty(r.quality))}</span> quality or better (${ok.map(t=>`<span class="q-name q-${esc(t)}">${esc(pretty(t))}</span>`).join(', ')}).</p>`:'')
      +(r.who?note(esc(r.who)):'')
      +note('Reported by players who finished it; the game does not list it until you are on the quest. The <a href="#/calc-quality">Quality & enchanting</a> calculator shows your chance of that quality.');
  }
  function questNeeds(q){
    const S=globalThis.BINXONIA_COLLECTOR_SNAPSHOT||{},need=new Map(),pre=(questRequiresSkills(q).length?`<p>You need the ${questRequiresSkills(q).join(' and ')} skill to take this quest.</p>`:'')+questRequiresHtml(q);
    const add=(id,n)=>{if(!id)return;id=String(id);const cur=need.get(id);need.set(id,Math.max(cur||0,Number(n)||0))};
    for(const id of q.collectItemTypes||[])add(id,0);
    // item names in the step text ("Bring 5 cooked trout"): exact matches against known items only
    const names=new Map();for(const t of [...(S.inventoryTypes||[]).map(x=>x.typeId),...(typeof RECIPES!=='undefined'?RECIPES.map(r=>r.id):[])])if(t)names.set(pretty(t).toLowerCase(),t);
    for(const st of q.stages||[]){
      if(st.collectItemType)add(st.collectItemType,st.requiredCount);
      for(const o of st.objectives||[]){
        if(o.itemTypeId){add(o.itemTypeId,o.required);continue}
        const txt=String(o.text||'');
        // longest names first, whole words only, and a stretch of text counts once ("cooked trout" is not also "trout")
        const low=txt.toLowerCase(),taken=[];
        for(const [nm,id] of [...names].sort((a,b)=>b[0].length-a[0].length)){
          const re=new RegExp('(^|[^a-z])'+nm.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')+'(?![a-z])');const m=re.exec(low);if(!m)continue;
          const st=m.index+m[1].length,en=st+nm.length;if(taken.some(([a,b])=>st<b&&en>a))continue;taken.push([st,en]);
          const before=txt.slice(0,st).match(/(\d+)\s*$/);
          if(o.collectDeliver||/\b(bring|deliver|collect|gather|fetch|hand|give|find|get)\b/i.test(txt))add(id,before?before[1]:o.required);
        }
      }
    }
    for(const r of S.questItems||[])if((r.quests||[]).includes(q.name))add(r.itemTypeId,0);
    const stepsKnown=(q.stages||[]).some(st=>(st.objectives||[]).length);
    if(!need.size)return pre||(stepsKnown?(questDone(q)?'<p>Nothing to bring.</p>':'<p>Nothing to bring in the steps recorded so far.</p>'):note('Not known yet: the data for this quest is incomplete.'));
    return pre+'<ul class="q-needs">'+[...need].map(([id,n])=>`<li>${item(id)}${n>0?' <b>×'+qn(n)+'</b>':''}</li>`).join('')+'</ul>'
      +(stepsKnown&&!(q.stages||[]).every(st=>(st.objectives||[]).length)?note('From the steps recorded so far.'):'');
  }
  // one quest's page
  function questGuide(s){
    const q=questBySlug(s);if(!q)return null;
    return {slug:s,group:'Quests',title:q.name,blurb:q.lore||'',build:()=>{
      const facts=table(['',''],[['Given by',questGiver(q)],['Level',String(q.recommendedLevel||'?')],['Length',esc(pretty(q.lengthTag||'?'))],['Kind',esc((Q_CATS.find(c=>c[0]===questCat(q))||[])[1]||'Side quests').replace(/ quests$/,'')],['Quest points',String(q.questPoints||0)],...(questUnlockFacts(q).length?[['Unlocks',questUnlockFacts(q).join(', ').replace(/^./,c=>c.toUpperCase())]]:[]),...(questRequiresSkills(q).length?[['Requires',questRequiresSkills(q).join(', ')+' skill']]:[]),
        ...((QUEST_PREREQS[q.questId]||[]).length?[['Requires',(QUEST_PREREQS[q.questId]).map(id=>{const p=questList().find(x=>x.questId===id);return p?`<a href="#/guide/quest-${esc(slug(id))}">${esc(p.name)}</a>`:esc(pretty(id))}).join(', ')+' finished first']]:[])],'q-facts');
      return {lede:(questDone(q)?'':`<span class="q-alert-banner" role="alert">${ALERT_SVG}<span><b>This quest is not fully written yet.</b> Steps, items or dialogue may be missing.</span></span>`)+questChain(q)+(q.lore?esc(q.lore):''),sections:[
        ['about','About',facts],
        ['needs','What you need',questNeeds(q)],
        ['steps','Steps',questEditBtn(q)+questSteps(q)],
        ['notes','Notes',questEdit(q)?.notes?`<div class="q-notes">${editText(questEdit(q).notes)}</div>`:''],
        ['rewards','Rewards',questRewards(q)+(questUnlocks(q)?'<h3>Unlocks</h3>'+questUnlocks(q):'')],   // what finishing it opens up is a reward too
        ['talk',`What ${q.giverName?esc(q.giverName)+' says':'they say'}`,questTalk(q)],
        ['end','Handing it in',q.completionMessage?`<p class="q-end"><i>"${esc(q.completionMessage)}"</i></p>`:'']
      ],related:['quests','travel']};
    }};
  }
  reg({slug:'quests',group:'Quests',title:'All quests',blurb:'Every quest players have done: who gives it, the level, what it pays, and the steps.',build:()=>{
    const Q=questList();
    if(!Q.length)return {lede:'The quests players have done, with who gives them and what they pay.',sections:[['none','Nothing recorded yet','<p class="muted">Quests appear here as data for them comes in.</p>']],related:['travel']};
    const totalQp=Q.reduce((a,q)=>a+(q.questPoints||0),0);
    const rows=qs=>table(['Quest','Level','Length','Given by','Rewards'],qs.map(q=>[questLink(q),String(q.recommendedLevel||'?'),esc(pretty(q.lengthTag||'')),giverLink(q),esc(questRewardLine(q))]));
    return {lede:`The ${Q.length} quests players have done so far (${totalQp} quest points in all). Each has its own page with who gives it, what it pays and, where the data has them, the steps and what the quest-giver says.`,
      sections:[...Q_CATS.map(([k,t])=>[k,t,Q.some(q=>questCat(q)===k)?rows(Q.filter(q=>questCat(q)===k)):'']).filter(x=>x[2])],related:['travel','getting-started']};
  }});
  for(const [k,[pslug,ptitle,pblurb]] of Object.entries(QG_PAGES))reg({slug:pslug,group:'Quests',title:ptitle,blurb:pblurb,inIndex:false,build:()=>{
    const qs=questList().filter(q=>questCat(q)===k);
    const rows=table(['Quest','Level','Length','Given by','Rewards'],qs.map(q=>[questLink(q),String(q.recommendedLevel||'?'),esc(pretty(q.lengthTag||'')),giverLink(q),esc(questRewardLine(q))]));
    return {lede:pblurb+(qs.length?` ${qs.length} recorded so far, by level; each has its own page with the steps, rewards and what the quest-giver says.`:''),
      sections:[[k,ptitle,qs.length?rows:'<p class="muted">None recorded yet.</p>']],related:['quests','travel']};
  }});
  reg({slug:'travel',group:'World',title:'Travel & quests',blurb:'Horses, warp scrolls, keys, and how quests work.',build:()=>({lede:'Getting around faster, and the basics of quests.',sections:[
    ['horse','Horses',`<p>A horse costs <b>2,500 gold</b> at a stable and makes you <b>50% faster on roads</b>. Press <b>H</b> to mount or dismount; you get off by yourself to gather. Being overloaded slows you even on a horse, and since 5 October 2026 an <b>overloaded character can’t ride or read a warp scroll</b>: go over your limit while mounted and you climb down.</p>`],
    // the pack mule: from the quest's own reward (unlockPackMule) and the Stablemaster's own stable window (each level's
    // room and the next upgrade's price, as recorded 3 Oct 2026)
    ['mule','Pack mule',`<p>Finishing <a href="#/guide/quest-binxonia-runaway-horses">The Runaways</a> for the Stablemaster in Binxonia gives you a gray <b>pack mule</b>: extra room for your things that you call up when you want it. She starts with room for <b>5 items</b>, and a Stablemaster can make her bigger:</p>`+table(['Level','Room','To get there'],[['1','5 items','The Runaways'],['2','10 items','1,000 gold'],['3','15 items','2,500 gold'],['4','20 items (the most)','5,000 gold']])],
    ['warps','Warp scrolls',`<p>Scribes make warp scrolls to places like the Mage Tower, Plymouth Wharf, Underleaf, Appleseed Farm, Mirewick and Wispmeyer. Reading one takes about 1.5 s and is broken by moving, damage or a stun, and it is refused within 10 s of a fight. See ${guide('scribing')}.</p>`],
    ['keys','Keys',`<p>A key is used up each time it opens a lock.</p>`],
    ['quests','Quests',`<p><b>!</b> above an NPC means a quest to take, <b>?</b> one to hand in; rewards show before you accept. Kill goals count related creatures too, place goals get a waypoint, and timed quests start their clock when you accept. Some quests teach things for free: the mace and spear for warriors, the other magic schools, and Herblore.</p>`],
    ['map','Maps',`<p>The game has a Map panel. The Atlas <a href="#/map">World map</a> adds what players have found: monster areas, resources, cave and building layouts. See also ${guide('places')}.</p>`]
  ],related:['places','scribing']})});

  // ---- rendering ------------------------------------------------------------------------------------------------------
  // reading order within each group (anything not listed goes after these)
  const ORDER=['getting-started','attributes-and-classes','levels-and-xp','death-and-banking','using-the-atlas','combat','special-attacks','armor','magic','monsters-by-level','monster-families','mining','lumberjack','fishing','herblore','shearing','smelting','weapon-smithing','armor-smithing','tool-smithing','bowyer','tailoring','leatherworking','cooking','scribing','quality-and-enchanting','reforging','gems','outfits','places','trainers','travel','economy','playing-together'];
  const orderOf=s=>{const i=ORDER.indexOf(s);return i<0?999:i};
  // one card per recorded quest (the Quests section of the guide index), each opening its own page
  // the quests in their groups (story, side, skill - the game's own categories), each under its own heading
  function questGroups(){return Q_CATS.map(([k,t])=>{const qs=questList().filter(q=>questCat(q)===k);return qs.length?`<h3 class="g-subhead" id="qg-${k}">${QG_PAGES[k]?`<a href="#/guide/${QG_PAGES[k][0]}">${esc(t)}</a>`:esc(t)} <span class="muted">(${qs.length})</span></h3><div class="g-cards">${questCards(qs)}</div>`:''}).join('')}
  function questCards(list){return (list||questList()).map(q=>`<a class="g-card" href="#/guide/${enc(questSlug(q))}">${questDone(q)?'':`<span class="q-alert" role="note">${ALERT_SVG}Not fully written yet</span>`}<b>${esc(q.name)}</b><span>Level ${q.recommendedLevel||'?'} · ${esc(pretty(q.lengthTag||''))}${q.giverName?' · '+esc(q.giverName):''}</span></a>`).join('')}
  // ---- the Guides index: a hero with a live filter and quick starts, then each group as a band with its own picture
  // and a card per guide carrying the game's own art (data/img via bxcAssetImg - the website's lite start has the
  // pictures list too; a card whose art isn't known yet fills in once it is, see fillGuideArt)
  const GX_GROUP={
    'Start here':{art:['npc-binxonia-guard','monster'],about:'New to Binxonia? The basics, in the order you will need them.'},
    'Combat':{art:['goblin','monster'],about:'How fights work: damage, armor, specials and what you are up against.'},
    'Fighting styles':{art:['iron-sword','item'],about:'Melee, ranged and magic: the weapons, skills and spells of each.'},
    'Melee':{art:['iron-sword','item'],about:'Swords, maces, daggers and spears.'},
    'Ranged':{art:['pine-bow','item'],about:'Bows, crossbows and their ammo.'},
    'Magic':{art:['pine-staff','item'],about:'Schools, spells and staves.'},
    'Gathering skills':{art:['pickaxe','item'],about:'Ore, logs, fish, herbs and wool, and the special events they can set off.'},
    'Crafting skills':{art:['smithing-hammer','item'],about:'Turn what you gather into bars, gear, food, scrolls, furniture and a home.'},
    'Gear, gems & enchanting':{art:['gem-ruby','item'],about:'Quality tiers, gems, enchantments and outfits.'},
    'World':{art:['npc-banker','monster'],about:'Places, trainers, getting around, trading and playing together.'},
    'Quests':{art:['parchment','item'],about:'Every quest players have recorded, with its steps and rewards.'}};
  const GX_ART={'getting-started':['npc-binxonia-guard','monster'],'attributes-and-classes':['iron-fullhelm','item'],'levels-and-xp':['gem-amber','item'],'death-and-banking':['npc-banker','monster'],'using-the-atlas':['parchment','item'],
    combat:['goblin','monster'],'special-attacks':['iron-mace','item'],armor:['iron-torso','item'],'monsters-by-level':['skeleton','monster'],'monster-families':['wolf','monster'],
    melee:['iron-sword','item'],ranged:['pine-bow','item'],magic:['pine-staff','item'],
    mining:['pickaxe','item'],lumberjack:['axe','item'],fishing:['fishing-rod','item'],herblore:['woad-leaves','item'],shearing:['shears','item'],'special-events':['img/events/gold-rift.svg'],
    smelting:['iron-bar','item'],'weapon-smithing':['iron-dagger','item'],'armor-smithing':['iron-shield','item'],'tool-smithing':['smithing-hammer','item'],bowyer:['carving-tool','item'],tailoring:['imp-torso','item'],leatherworking:['deerhide-torso','item'],cooking:['cooked-catfish','item'],scribing:['parchment','item'],carpentry:['saw','item'],housing:['oak-plank','item'],
    'quality-and-enchanting':['iron-ring-ruby','item'],reforging:['dune-whetstone','item'],gems:['gem-sapphire','item'],outfits:['deerhide-torso','item'],
    places:['ogre','monster'],trainers:['npc-binxonia-guard','monster'],travel:['feather','item'],economy:['gold-coin','item'],'playing-together':['bandit','monster'],quests:['parchment','item']};
  const GX_QART={story:['npc-gerald-seabroden','monster'],unlock:['npc-stablemaster','monster'],skillunlock:['npc-hollis-tamber','monster'],combat:['iron-mace','item'],side:['gold-coin','item']};
  function gxQuestGroups(){return Q_CATS.map(([k,t])=>{const qs=questList().filter(q=>questCat(q)===k);if(!qs.length)return '';const pg=QG_PAGES[k];
    return `<div class="gx-qgroup"><header class="gx-head gx-subhead">${gxArt(GX_QART[k],'gx-head-art')}<div><h3>${pg?`<a href="#/guide/${pg[0]}">${esc(t)}</a>`:esc(t)} <span class="gx-count">${qs.length}</span></h3>${pg&&pg[2]?`<p>${esc(pg[2])}</p>`:''}</div></header><div class="g-cards">${questCards(qs)}</div></div>`}).join('')}
  const GX_NEW=new Set(['special-events','reforging']);   // recently added or rewritten: a small "New" tag
  // the fighting styles have one guide each, so on the all-guides page they share a band
  const GX_BANDS=[['Start here'],['Combat'],['Fighting styles',['Melee','Ranged','Magic']],['Gathering skills'],['Crafting skills'],['Gear, gems & enchanting'],['World'],['Quests']];
  const gxArtUrl=a=>{if(!a)return null;if(/^img\//.test(a[0]))return a[0];try{return globalThis.bxcAssetImg?globalThis.bxcAssetImg(a[0],a[1]||'item'):null}catch(_){return null}};
  const gxArt=(a,cls)=>{const u=gxArtUrl(a);return `<span class="${cls}"${u?'':` data-gx-art="${esc(a?a.join('|'):'')}"`}>${u?`<img src="${esc(u)}" alt="" loading="lazy">`:''}</span>`};
  // pictures not known when the page was drawn (the list still loading): fill them in as soon as it is
  let gxFillTimer=0;
  function fillGuideArt(tries){
    clearTimeout(gxFillTimer);
    const left=[...document.querySelectorAll('[data-gx-art]')];if(!left.length)return;
    for(const el of left){const u=gxArtUrl(el.dataset.gxArt.split('|'));if(u){el.innerHTML=`<img src="${esc(u)}" alt="" loading="lazy">`;el.removeAttribute('data-gx-art')}}
    if(tries>0&&document.querySelector('[data-gx-art]'))gxFillTimer=setTimeout(()=>fillGuideArt(tries-1),600);
  }
  const gxCard=g=>`<a class="gx-card" href="#/guide/${enc(g.slug)}" data-gx-find="${esc((g.title+' '+g.blurb+' '+g.group).toLowerCase())}">${gxArt(GX_ART[g.slug]||(GX_GROUP[g.group]||{}).art,'gx-art')}<span class="gx-txt"><b>${esc(g.title)}</b><span>${esc(g.blurb)}</span></span>${GX_NEW.has(g.slug)?'<em class="gx-new">New</em>':''}</a>`;
  const gxList=gr=>G.filter(g=>g.group===gr&&g.inIndex!==false&&!(gr==='Quests'&&/^quest-/.test(g.slug))).sort((a,b)=>orderOf(a.slug)-orderOf(b.slug));
  function gxBand(title,groups,only){
    const list=groups.flatMap(gxList);if(!list.length)return '';
    const meta=GX_GROUP[title]||{},isQuests=title==='Quests',nQ=isQuests?questList().length:0,count=isQuests?nQ+' quests':list.length+(list.length===1?' guide':' guides');
    const head=groups.length===1&&!only?`<a href="#/guides-${slug(title)}">${esc(title)}</a>`:esc(title);
    return `<section class="gx-band" id="gx-${slug(title)}"><header class="gx-head">${gxArt(meta.art,'gx-head-art')}<div><h2>${head} <span class="gx-count">${count}</span></h2>${meta.about?`<p>${esc(meta.about)}</p>`:''}</div></header>`
      +(isQuests?`<div class="gx-quests">${gxQuestGroups()}</div>`:`<div class="gx-grid">${list.map(gxCard).join('')}</div>`)+`</section>`;
  }
  function indexHtml(only){
    setTimeout(()=>fillGuideArt(20),0);
    if(only){
      const gr=GROUPS.find(x=>slug(x)===only);
      const chips=`<p class="gx-chips"><a class="gx-chip" href="#/guides">All guides</a>${GROUPS.filter(x=>x!==gr&&G.some(g=>g.group===x)).map(x=>`<a class="gx-chip" href="#/guides-${slug(x)}">${esc(x)}</a>`).join('')}</p>`;
      return `<div class="gx">${chips}${gr?gxBand(gr,[gr],true):''}</div>`;
    }
    const total=G.filter(g=>g.inIndex!==false&&!/^quest-/.test(g.slug)).length;
    const paths=[['getting-started','New here?','Start with the basics',['npc-binxonia-guard','monster']],['combat','Fight','How combat works',['goblin','monster']],['mining','Gather','Mining and the other gathering skills',['pickaxe','item']],['guides-crafting-skills','Craft','Smithing, cooking, carpentry and more',['smithing-hammer','item']],['quests','Quests','Steps and rewards',['parchment','item']]];
    const hero=`<div class="gx-hero"><div class="gx-hero-main"><h2>Learn the game</h2><p>${total} guides and ${questList().length} quests, built from the game&rsquo;s own data and what players have recorded.</p>`
      +`<label class="gx-find"><span class="sr-only">Find a guide</span><input type="search" id="gxFind" placeholder="Find a guide&hellip; (fishing, armor, gems, quests)" autocomplete="off"></label></div>`
      +`<nav class="gx-paths">${paths.map(([to,t,sub,a])=>`<a class="gx-path" href="#/${/^guides-/.test(to)?to:'guide/'+to}">${gxArt(a,'gx-path-art')}<b>${esc(t)}</b><span>${esc(sub)}</span></a>`).join('')}</nav></div>`;
    const chips=`<p class="gx-chips">${GX_BANDS.filter(([t,gs])=>(gs||[t]).some(x=>G.some(g=>g.group===x))).map(([t])=>`<a class="gx-chip" href="#/guides" data-gx-jump="gx-${slug(t)}">${esc(t)}</a>`).join('')}</p>`;
    return `<div class="gx">${hero}${chips}<p class="gx-none" hidden>No guide matches that. Try a skill, an item or a place.</p>${GX_BANDS.map(([t,gs])=>gxBand(t,gs||[t])).join('')}</div>`;
  }
  // the filter box and the group chips (one listener for the whole page, set once)
  if(!globalThis.__gxWired){globalThis.__gxWired=true;
    document.addEventListener('input',e=>{if(e.target&&e.target.id!=='gxFind')return;const q=e.target.value.trim().toLowerCase(),root=e.target.closest('.gx');if(!root)return;let any=false;
      for(const band of root.querySelectorAll('.gx-band')){let n=0;for(const c of band.querySelectorAll('.gx-card,.g-card')){const t=(c.dataset.gxFind||c.textContent).toLowerCase();const hit=!q||q.split(/\s+/).every(w=>t.includes(w));c.hidden=!hit;if(hit)n++}
        for(const g of band.querySelectorAll('.gx-qgroup'))g.hidden=![...g.querySelectorAll('.g-card')].some(c=>!c.hidden);band.hidden=!n;if(n)any=true}
      root.querySelector('.gx-none').hidden=any;root.querySelector('.gx-paths').hidden=!!q;});
    document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('[data-gx-jump]');if(!a)return;const el=document.getElementById(a.dataset.gxJump);if(!el)return;e.preventDefault();el.scrollIntoView({behavior:'smooth',block:'start'})});
  }
  function pageHtml(s){
    const g=byslug.get(s)||questGuide(s);if(!g)return '<p class="muted">No such guide.</p>';   // quest pages are made from their records
    let d;try{d=g.build()}catch(e){console.error('[guides]',s,e);return '<p class="muted">This guide could not be built.</p>'}
    // a skill's guide opens with who teaches it, when a trainer has been seen
    const tr=s==='trainers'?[]:(globalThis.bxcTrainers?globalThis.bxcTrainers():[]).filter(t=>t.guide===s);
    if(tr.length)d.sections=[['learn','Where to learn it',tr.map(t=>`<p><a href="${esc(t.href)}"><b>${esc(t.name)}</b></a> teaches it${t.where.length?', '+esc(t.where[0]):''}. ${t.where.length?`<button type="button" class="show-on-map" data-map-kind="npc" data-map-id="${esc(t.slug)}">Show on map</button>`:''}</p>`).join('')+'<p class="g-note">All trainers: '+guide('trainers')+'</p>'],...d.sections];
    const secs=d.sections.filter(x=>x&&x[2]);
    const toc=secs.map(([id,t])=>`<li><a href="#/guide/${enc(s)}" data-g-jump="g-${esc(id)}">${esc(t)}</a></li>`).join('');
    const rel=(d.related||[]).filter(r=>byslug.has(r)&&r!==s);
    return `<article class="wp g-page"><div class="wp-main">${d.lede?`<p class="wp-lede">${d.lede}</p>`:''}${secs.map(([id,t,b])=>sec(id,t,b)).join('')}</div>
      <aside class="wp-infobox g-aside"><h3>${esc(g.title)}</h3><p class="g-aside-group">${esc(g.group)}</p>${toc?`<p class="g-aside-h">On this page</p><ol class="g-toc">${toc}</ol>`:''}${rel.length?`<p class="g-aside-h">Related guides</p><ul class="g-toc">${rel.map(r=>`<li>${guide(r)}</li>`).join('')}</ul>`:''}<p class="g-aside-h"><a href="#/guides">All guides</a></p><p class="g-note">From the game’s own data, what players have recorded, and the ${OFFICIAL}.</p></aside></article>`;
  }
  // the Gems guide's carat chips: show that carat's wording (remembered)

  // "On this page" links scroll within the page instead of changing the address
  document.addEventListener('click',e=>{const a=e.target.closest('[data-g-jump]');if(!a)return;e.preventDefault();document.getElementById(a.dataset.gJump)?.scrollIntoView({behavior:'smooth',block:'start'})});
  globalThis.bxcGuides={
    list:G,indexHtml,pageHtml,
    title:s=>(byslug.get(s)||questGuide(s))?.title||pretty(s),
    has:s=>byslug.has(s)||!!questBySlug(s),
    // the guide for a skill name as the game or a recipe spells it ("Armor Smithing", "mining")
    forSkill:skill=>{const s=skillGuideSlug(skill);return byslug.has(s)?s:null},
    link:(s,label)=>byslug.has(s)?guide(s,label):'',
    // how many quests each group has (the home page's Quests tiles)
    questGroupCounts:()=>Object.fromEntries(Q_CATS.map(([k])=>[k,questList().filter(q=>questCat(q)===k).length])),
    // a quest page's group on the Quests page ({key, title}), for its breadcrumb
    questGroup:s=>{const q=questBySlug(s);if(!q)return null;const c=Q_CATS.find(x=>x[0]===questCat(q));return c?{key:c[0],title:c[1],page:QG_PAGES[c[0]]?.[0]||null}:null}
  };
  // Gems guide: "the witch" in the intro jumps to her section (instantly: a hidden window never animates a scroll)
  document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('.gg-to-witch');if(!b)return;e.preventDefault();document.getElementById('g-witch')?.scrollIntoView({block:'start'})});
  // Gems guide: one enchantment, or a gem's ring or pendant, at every carat in a popup. One listener for the page; the popup is built on each click.
  document.addEventListener('click',e=>{
    const b=e.target.closest&&e.target.closest('.gg-pop-btn');if(!b)return;
    e.preventDefault();
    const id=b.dataset.gem,kind=b.dataset.pop,EG=typeof ENCHANT_GEMS!=='undefined'?ENCHANT_GEMS:{},ER=typeof ENCHANT_RECIPES!=='undefined'?ENCHANT_RECIPES:{},GD=globalThis.BXC_GAME_DATA||{};
    const gemName=g=>g==='any'?'any gem':EG[g]?.name||pretty(g),gname=gemName(id);
    let title,body;
    if(kind==='spell'){
      // one spell: the game's numbers, and where its scroll has come from (recorded drops, quest rewards)
      const sp=(GD.spells||[]).find(x=>x.id===b.dataset.spell);if(!sp)return;
      const sid='scroll-'+sp.id,S=globalThis.BINXONIA_COLLECTOR_SNAPSHOT||{};
      const need=['—','—','5','15','25'][sp.level]||'—';
      const rows=[['School',esc(pretty(sp.school))],['Spell level',String(sp.level)],['Needs',`${sp.intRequirement} INT${need!=='—'?', '+esc(pretty(sp.school))+' skill '+need:''}`]];
      if(sp.effect==='damage')rows.push(['Damage',`${sp.baseDamageMin}–${sp.baseDamageMax} <span class="muted">+${sp.magScale} per 10 MAG</span>`]);
      rows.push(['Mana',String(sp.manaCost)],['Cooldown',(sp.cooldownMs/1000).toFixed(1)+' s'],['Cast',(sp.castTimeMs/1000).toFixed(2)+' s']);
      if(sp.range)rows.push(['Range',sp.range+' tiles']);
      const by=new Map();for(const d of S.drops||[])if(d.itemTypeId===sid&&d.monsterName){const k=d.monsterTypeId||d.monsterName;const v=by.get(k)||{name:d.monsterName,type:d.monsterTypeId,n:0};v.n+=d.quantity||1;by.set(k,v)}
      const mons=[...by.values()].sort((a,b)=>b.n-a.n);
      const quests=questList().filter(q=>[...(q.rewards?.items||[]),...(q.rewards?.choice||[])].some(i=>i.typeId===sid));
      // the official guide's rules for where scrolls come from (see "Unlocking schools and spells" and "Healing")
      const RULE={'burning-arrow':'Fire mages start with it; the Fire school’s level-10 quest teaches it too.','ice-bolt':'Ice mages start with it; the Ice school’s level-10 quest teaches it too.','shockbolt':'Shock mages start with it; the Shock school’s level-10 quest teaches it too.',
        'fire-blast':'A reward choice from the Fire school’s level-10 quest.','ice-zap':'A reward choice from the Ice school’s level-10 quest.','sparkbolt':'A reward choice from the Shock school’s level-10 quest.',
        'caustic-blast':'A reward choice from the Dark Witch’s Acid quest.',renew:'Drops from spellcasting monsters level 8+.',ward:'Drops from spellcasting monsters level 18+.',sanctuary:'Drops from spellcasting monsters level 30+.'}[sp.id];
      const minLv={2:8,3:18,4:30}[sp.level];
      const DROP=minLv?(sp.school==='restoration'?`Drops from any monster that casts spells, level ${minLv}+.`:`Drops from monsters that cast ${esc(pretty(sp.school))} spells, level ${minLv}+.`):null;
      const from=[...(DROP?[DROP]:[]),...(RULE&&!/^Drops from spellcasting/.test(RULE)?[esc(RULE)]:[]),...(mons.length?[`Recorded drops: ${mons.slice(0,8).map(m=>m.type?monster(m.type,m.name):esc(m.name)).join(', ')}${mons.length>8?' and '+(mons.length-8)+' more':''}.`]:[]),
        ...(quests.length?[`A reward from ${quests.map(q=>`<a href="#/guide/${enc(questSlug(q))}">${esc(q.name)}</a>`).join(', ')}.`]:[])];
      title=`${icon(sid)}${esc(sp.name)}`;
      body=table(['',''],rows,'q-facts')+`<h4>Getting the scroll</h4>`+(from.length?from.map(t=>`<p>${t}</p>`).join(''):'<p class="muted">No one has recorded where it comes from yet.</p>')
        +`<p><a href="#/item/${enc(sid)}">Open the ${esc(sp.name)} scroll’s page</a></p>`;
    }
    else if(kind==='filler'){
      // a gem with no armour recipe of its own still completes one: every armour enchant takes any gem as its third
      const list=(ER.armor||[]).filter(x=>x.gems.includes('any'));
      title=`${esc(gname)} as filler`;
      body=`<p>${esc(gname)} has no armour enchant of its own, but any gem can be the <b>third gem</b> of one. Add it to the two gems below to make that enchant:</p>`
        +table(['Enchantment','Effect','Gems'],list.map(x=>[`<b>${esc(x.name)}</b>`,esc(x.effect),x.gems.map(q=>q==='any'?`<b>${esc(gname)}</b>`:esc(gemName(q))).join(' + ')]))
        +'<p class="g-note">Its carats still count toward the strength, so a big filler gem makes a stronger enchant.</p>';
    }else if(kind==='tier'){
      // one tier of the gear this enchant goes on, from the game's recipes (enchantInfo: which kind of enchant a crafted
      // item takes, and its material tier): each material of that tier and the pieces made from it, by the skill that
      // makes them. Materials of the same tier and kind that have no recipe are named under it. A tier holds 3c more.
      const T=+b.dataset.tier,fam=b.dataset.backKind||'',M=GD.materials||{};
      const LABEL={tool:'tools',weapon:'weapons, bows and crossbows',bow:'bows and crossbows',staff:'staves',armor:'armour'},MKIND={tool:['metal'],weapon:['metal','wood'],bow:['wood'],staff:['wood'],armor:['metal','knick','pelt']};
      const SKILL_SLUG={'Weapon Smithing':'weapon-smithing','Armor Smithing':'armor-smithing','Bowyer':'bowyer','Tailoring':'tailoring','Leatherworking':'leatherworking','Tool Smithing':'tool-smithing'};
      const byMat=new Map();
      for(const r of (typeof RECIPES!=='undefined'?RECIPES:[])){const inf=typeof enchantInfo==='function'?enchantInfo(r):null;if(!inf||!(inf.kind===fam||(fam==='weapon'&&inf.kind==='bow'))||inf.tier!==T||!inf.material)continue;   // weapon enchants: any main-hand weapon but a wand, bows and crossbows too (official guide)
        const k=inf.material+'|'+r.skill;(byMat.get(k)||byMat.set(k,{mat:inf.material,skill:r.skill,items:[]}).get(k)).items.push(r)}
      const short=(r,m)=>r.item.slice(m.length).trim()||r.item;
      const rows=[...byMat.values()].map(g=>[`<b>${esc(g.mat)}</b>`,g.items.map(r=>item(slug(r.id||r.item),short(r,g.mat))).join(', '),SKILL_SLUG[g.skill]?guide(SKILL_SLUG[g.skill],g.skill):esc(g.skill)]);
      const made=new Set([...byMat.values()].map(g=>g.mat.toLowerCase().replace(/ /g,'-')));
      const other=Object.entries(M).filter(([m,v])=>v.tier===T&&(MKIND[fam]||[]).includes(v.kind)&&!made.has(m)&&!['iron','silver','gold','titanium','pine','oak','black-walnut','shagbark','imp','snakeskin','ogrewax','dragonscale','deerhide','bearhide','werewolfpelt','dragonhide'].includes(m)).map(([m])=>esc(pretty(m)));
      title=fam==='tool'?`${['Iron','Silver','Gold','Titanium'][T-1]} tools`:`Tier ${T} ${esc(LABEL[fam]||'gear')}`;
      body=(fam==='tool'?`<p>${['Iron','Silver','Gold','Titanium'][T-1]} tools take a gem of up to <b>${T}c</b> when they are forged${T<4?` (${['Iron','Silver','Gold','Titanium'][T]}: ${T+1}c)`:', the most there is'}; anything above that is lost.</p>`:`<p>Tier ${T} ${esc(LABEL[fam]||'gear')} ${fam==='armor'?'holds':'hold'} up to <b>${3*T}c</b> of enchantment${T<4?` (tier ${T+1}: ${3*T+3}c)`:', the most there is'}; anything above that is lost.</p>`)
        +(rows.length?table(['Material','Pieces','Made with'],rows):'<p class="muted">Nothing of this tier is crafted.</p>')
        +(other.length?`<p class="g-note">Also tier ${T}, but with no crafting recipe: ${other.join(', ')}.</p>`:'')
        +(b.dataset.backEnch?`<p><button type="button" class="gg-pop-btn" data-pop="one" data-kind="${esc(fam)}" data-ench="${esc(b.dataset.backEnch)}" data-gem="${esc(id||'')}">← Back to ${esc(pretty(fam)+' '+b.dataset.backEnch)}</button></p>`:'');
    }else if(kind==='mons'){
      // monsters the game marks as dropping gems (dropsGems in its rules), in one level band
      const lo=+b.dataset.lo,hi=b.dataset.hi?+b.dataset.hi:Infinity;
      const list=(typeof D!=='undefined'&&D.catalog||[]).filter(m=>m.dropsGems&&+m.baseLevel>=lo&&+m.baseLevel<=hi).sort((a,c)=>a.baseLevel-c.baseLevel||String(a.name).localeCompare(c.name));
      title=`Monsters level ${lo}${hi===Infinity?'+':'–'+hi} that drop gems`;
      body=(list.length?table(['Monster','Level','Family'],list.map(m=>[monster(m.typeId,m.name),String(m.baseLevel),esc(pretty(m.family||''))])):'<p class="muted">None.</p>')
        +`<p class="g-note">Gems up to <b>${esc(b.dataset.c)}</b> from these (official guide). Whether a monster drops gems at all is the game's own flag for it; its level here is its usual level - one met at a higher level counts by that.</p>`;
    }else if(kind==='one'){
      // one enchantment: its gems, and what it does at every carat it can hold. The game's rules (eu in game-rules) work
      // it out from the carats t: an element or Destruction adds round(t/4.5*100)% base damage, a stat +5t, a school +t,
      // Seeking +2t% to-hit, the Artisan +5t% success - so each line is the 1c wording with its number times t (the
      // percentages from the rule itself, since 22% x 4 is not 89%). Gear holds up to 12c (3 per material tier; the
      // game's enchant carat is 1-12), a tool up to 4c.
      const fam=b.dataset.kind,x=(ER[fam]||[]).find(r=>r.name===b.dataset.ench)||{name:b.dataset.ench,gems:[],effect:''};
      const g=(GD.enchants||[]).find(r=>r.name===x.name&&r.family===fam),t=g&&g.effect||{};
      const cs=fam==='tool'?[1,2,3,4]:[1,2,3,4,5,6,7,8,9,10,11,12],one=String(t[1]||'');
      const at=c=>enchEffectAt(g,c);
      title=`${esc(pretty(fam))} ${esc(x.name)}`;
      body=(g&&g.flavor?`<p class="g-note"><i>${esc(String(g.flavor).replace(/^./,c=>c.toUpperCase()))}</i></p>`:'')
        +(fam==='tool'?'<p>Gems: <b>any one gem</b>, set while the tool is forged (up to 1/2/3/4c for iron/silver/gold/titanium).</p>':`<p>Gems: ${x.gems.map(q=>q===id?`<b>${esc(gemName(q))}</b>`:esc(gemName(q))).join(' + ')}</p>`)
        +(one?table(fam==='tool'?['Carat','What it does','Tool']:['Carats','What it does','Gear'],cs.map(c=>[`<b>${c}c</b>`,esc(at(c)),fam==='tool'?['Iron','Silver','Gold','Titanium'][c-1]+(c<4?' or better':''):`<button type="button" class="gg-pop-btn" data-pop="tier" data-tier="${Math.ceil(c/3)}" data-back-kind="${esc(fam)}" data-back-ench="${esc(x.name)}" data-gem="${esc(id)}">Tier ${Math.ceil(c/3)}</button>${c<=9?' or better':''}`]),fam==='tool'?'':'gg-tiers'):`<p>${esc(x.effect)}</p>`)
        +`<p class="g-note">${fam==='tool'?'The gem\'s carat decides the strength. See '+guide('tool-smithing')+'.':`The three gems' carats added up (rounded down) decide the strength. Gear holds 3 carats per material tier, so 12c needs tier 4; anything above what it holds is lost. Every enchantment is in ${guide('quality-and-enchanting')}.`}</p>`;
    }else{
      const t=((kind==='ring'?GD.rings:GD.pendants)||[]).find(x=>x.gem===id)?.text||{};
      const cs=Object.keys(t).map(Number).filter(c=>t[c]).sort((a,c)=>a-c),nm=String(t[cs[0]]||'').split(': ')[0];
      title=`${esc(nm)} - ${esc(gname)} ${kind}`;
      body=table(['Carat','What it does'],cs.map(c=>[`<b>${c}c</b>`,esc(String(t[c]).split(': ').slice(1).join(': ')||t[c])]))
        +(kind==='ring'?'<p class="g-note">Forged at an anvil with one gem of 1c or more: up to 1/2/3/4c for iron/silver/gold/titanium. You wear two, and two of the same kind stack.</p>':'');
    }
    let d=document.getElementById('ggPop');
    if(!d){d=document.createElement('dialog');d.id='ggPop';d.className='gg-pop';document.body.append(d);
      d.addEventListener('click',ev=>{if(ev.target===d||ev.target.closest('.gg-pop-x,a'))d.close()})}
    d.innerHTML=`<div class="gg-pop-in"><div class="gg-pop-head"><h3>${title}</h3><button type="button" class="gg-pop-x" aria-label="Close">×</button></div>${body}</div>`;
    if(!d.open)d.showModal();
  });
})();
