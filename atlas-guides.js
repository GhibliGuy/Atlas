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

  const gemOdds=()=>`The chance per success depends on the tier you gather: <b>0.5%</b> at tier 1, <b>0.6%</b> at tier 2, <b>0.75%</b> at tier 3 and <b>1%</b> at tier 4.`;
  // ---- gathering skill guides ---------------------------------------------------------------------------------------
  function gatheringGuide(o){
    return ()=>{
      const tiers=gatherTiers(o.skill);
      const rows=tiers.map(t=>{const spots=resourcesGiving(t.id).reduce((a,r)=>a+(r.count||0)+(r.manualCount||0),0);
        const cave=(globalThis.bxcCavesFor?globalThis.bxcCavesFor('item',t.id):[])[0];
        return [n(t.level),item(t.id,t.item),n(t.xp),t.minYield===t.maxYield?n(t.minYield):`${t.minYield}–${t.maxYield}`,spots?n(spots):'<span class="muted">none yet</span>',cave?`${esc(cave.name)} <span class="muted">(${n(cave.count)})</span> <button type="button" class="open-zone" data-zone="${esc(cave.z)}">Layout</button>`:'<span class="muted">—</span>',`<button type="button" class="show-on-map" data-map-kind="item" data-map-id="${esc(t.id)}">Map</button>`]});
      const chanceRows=tiers.map(t=>[item(t.id,t.item),...[0,3,6,9].map(k=>pct(gatherChance(t.level+k,t.level)))]);
      const plan=trainingPlan(tiers,(t,l)=>gatherChance(l,t.level),t=>item(t.id,t.item));
      const uses=[...new Map(tiers.flatMap(t=>usesOf(t.id)).map(r=>[r.id,r])).values()].sort((a,b)=>a.skill.localeCompare(b.skill)||a.level-b.level);
      const useSkills=[...new Set(uses.map(r=>r.skill))];
      return {
        lede:o.lede,
        sections:[
          ['how','How it works',`<ul class="g-list"><li>Hold the ${esc(o.tool||'tool')} in your <b>off-hand</b> and click the ${esc(o.node)}.${o.learn?' '+o.learn:''}</li><li>Each success gives <b>10% more</b> for every level past mastery (9 levels above the ${esc(o.node)}’s level, where you hit 95%). A tool that would push you past 95% adds the extra to your haul instead, and <b>Prospector</b> rings (amber) add 2% per carat. The <a href="#/calc-crafting">Crafting XP planner</a> shows your rates level by level.</li><li>Better tools raise your chance: silver <b>+3%</b>, gold <b>+7%</b>, titanium <b>+12%</b> (they need the skill at 15, 30 and 45), plus 5% per carat of an Artisan gem. See ${guide('tool-smithing')}.</li><li>Used-up ${esc(o.node)}s come back after a while; rarer ones take longer.${o.nodeLine?' '+o.nodeLine:''}</li></ul>`],
          ['tiers','Tiers at a glance',table(['Level','Gives','XP each','Per success','Spots on the map','Most in',''],rows)+note('Spots are the ones players have recorded; the map fills in as more of the world is visited.')],
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
          ['how','How it works',`<ul class="g-list">${o.station?`<li>Work at a <b>${esc(o.station)}</b>${o.tool?` with a <b>${esc(o.tool)}</b> in your off-hand`:''}.${o.learn?' '+o.learn:''}</li>`:''}${o.noTomes?'':`<li>Tier-1 materials need nothing else. Each higher material needs its <b>tome</b>, a rare monster drop that unlocks every recipe of that material: tier 2 drops from level-10 monsters, tier 3 from level 25, tier 4 from level 45.${o.tomeLine?' '+o.tomeLine:''}</li>`}${o.how?o.how:''}</ul>`],
          ['recipes','Every recipe',table(['Level','Makes','XP','Needs','Success at its level','Sure at'],rows)+(o.skill!=='Smelting'&&globalThis.bxcGuideToolBox?`<h3>With your tool</h3>`+globalThis.bxcGuideToolBox('craft',o.skill):'')+note(o.chanceNote||'Crafting works 60% of the time at the recipe’s level and climbs by 40% over the next 15 levels, capped at 95% (reached 14 levels above). Enchanting needs mastery, 15 levels above. A failed attempt uses up the materials. (The game’s own rule.)')],
          ['plan','Fastest way to level',o.skill!=='Smelting'&&globalThis.bxcGuidePath?globalThis.bxcGuidePath('craft',o.skill):plan.length?`<p>The recipe with the most XP per attempt at each stretch. It is the quickest, not always the cheapest: check the materials first.</p>`+table(['Levels','Make','Successes','Attempts','Materials'],plan)+note('Materials are for every attempt: a failed one uses them up too.'):''],
          ...(o.extra?o.extra():[]),
          ['materials','Where the materials come from',(gatherSkills.length||craftedFeeds.length)?`<p>${[...gatherSkills.map(s=>skillGuideLink(s)),...craftedFeeds.map(s=>skillGuideLink(s))].join(' · ')}</p>`:''],
        ],
        related:o.related||[]
      };
    };
  }
  const SKILL_SLUG={mining:'mining',lumberjack:'lumberjack',fishing:'fishing',herblore:'herblore',Smelting:'smelting','Armor Smithing':'armor-smithing','Weapon Smithing':'weapon-smithing','Tool Smithing':'tool-smithing',Bowyer:'bowyer',Tailoring:'tailoring',Leatherworking:'leatherworking',Cooking:'cooking',Herblore:'herblore',Scribing:'scribing'};
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
    return {lede:'Weaknesses and resistances belong to a monster’s family, so every member shares them.',sections:[['families','All families',table(['Family','Attacks with','Weak to','Resists','Members'],rows)+note('From the game’s rules file.')]],related:['combat','monsters-by-level']};
  }});

  // ---- Gathering skills -------------------------------------------------------------------------------------------
  reg({slug:'mining',group:'Gathering skills',title:'Mining',blurb:'Ore tiers, success chance, the fastest route to 100, and where the rocks are.',build:gatheringGuide({skill:'mining',action:'swing',node:'rock',
    lede:'Mine rocks for iron, silver, gold and titanium ore, the metal behind every smithing skill. Mining is also where five of the nine gems are found.',
    toolLine:'A better pickaxe adds to that chance (see Quality & enchanting for tool bonuses).',
tool:'pickaxe',unit:'ore',learn:'Learn it from a trainer for a skill point.',nodeLine:'A top-level miner gets 10 ore a swing from a starter rock, and over 13 with a full-gem titanium pickaxe.',
    extra:()=>[['gems','Gems',`<p>Every successful swing has a small chance of a gem: <b>rubies, diamonds, emeralds, sapphires and onyx</b>. ${gemOdds()} See ${guide('gems')}.</p>`]],related:['smelting','weapon-smithing','armor-smithing','tool-smithing','gems']})});
  reg({slug:'lumberjack',group:'Gathering skills',title:'Lumberjack',blurb:'Wood tiers, success chance and the fastest route to 100.',build:gatheringGuide({skill:'lumberjack',action:'chop',node:'tree',
    lede:'Chop trees for pine, oak, black walnut and shagbark wood, used by bowyers and in tool handles. Trees can also give amber and iolite.',
    toolLine:'A better axe adds to that chance.',
tool:'axe',unit:'log',learn:'Learn it from a trainer for a skill point.',nodeLine:'A tree gives a few logs and then falls to a stump that grows back; everyone chopping the same tree shares its logs.',
    extra:()=>[['gems','Gems',`<p>Chopping can turn up <b>amber and iolite</b>. ${gemOdds()} See ${guide('gems')}.</p>`]],related:['bowyer','tool-smithing','gems']})});
  reg({slug:'fishing',group:'Gathering skills',title:'Fishing',blurb:'Fish tiers, how fishing spots refill, and the fastest route to 100.',build:gatheringGuide({skill:'fishing',action:'cast',node:'fishing spot',
    lede:'Fish catfish, bass, trout and salmon from fishing spots, then cook them into food. Fishing is where pearls and topaz come from.',
    toolLine:'A better fishing rod adds to that chance.',
    tool:'fishing rod',unit:'fish',learn:'Learn it from the Fishing Trainer (one skill point); you fish from the bank.',
    extra:()=>[['spots','How fishing spots work',`<p>Each spot is for one kind of fish (the map says which). Measured by players: a spot gives <b>1 to 5 catches</b> (about 2.5 on average) and then goes quiet, and comes back in the same place about <b>65 seconds</b> later. Moving between two or three nearby spots keeps you casting.</p>`],['gems','Gems',`<p>Fishing can turn up <b>pearls and topaz</b>. ${gemOdds()} See ${guide('gems')}.</p>`],['eat','Eating it',`<p>Raw fish can’t be eaten: cook it first (${guide('cooking')}).</p>`]],related:['cooking','gems']})});
  reg({slug:'herblore',group:'Gathering skills',title:'Herblore',blurb:'Plants to gather, and the pigments and potions made from them.',build:()=>{
    const gath=gatheringGuide({skill:'herblore',action:'pick',node:'plant',tool:'herbalist’s sickle',unit:'plant',learn:'Herblore costs no skill point. The quest <a href="#/guide/quest-binxonia-scriptorium-apprentice">The Scriptorium Apprentice</a> needs it (and unlocks <a href="#/guide/scribing">Scribing</a>).',lede:'',related:[]})();
    const craft=craftingGuide({skill:'Herblore',lede:'',chanceNote:'Pigments, powders and weapon poisons never fail. Poisoned arrows and bolts follow the usual crafting odds: 60% at their level, 95% from 14 levels above.'})();
    return {lede:'Pick plants for fibre, dyes and poison ingredients, then turn them into pigments, powders and weapon poisons. Herblore both gathers and crafts.',
      sections:[...gath.sections.filter(s=>s[0]!=='uses').map(s=>[s[0],s[1],s[2]]),['recipes','What herblore makes',`<p>Plants are ground into pigments and powders at a <b>pestle and mortar</b> out in the world; grinding uses your Herblore level and never fails.</p>`+craft.sections.find(s=>s[0]==='recipes')[2]],['poison','Weapon poisons',`<p>Drag a poison onto a sword, dagger, mace or spear for <b>60 doses</b>. Every hit that lands uses one and adds a share of the hit as damage over about 2 seconds that <b>ignores armor</b>; a miss uses nothing. For bows and crossbows, one vial and 60 arrows or bolts make 60 poisoned shots.</p>`+table(['Poison','Level','Needs','Adds'],[['Weak weapon poison','30','2 Mandrake Root','10% of each hit'],['Weapon poison','50','2 Wolfsbane','15%'],['Potent weapon poison','70','2 Adderfern Fronds','20%']])],['plan2','Levelling by making things',craft.sections.find(s=>s[0]==='plan')[2]]],related:['tailoring','scribing','cooking']};
  }});

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
  reg({slug:'scribing',group:'Crafting skills',title:'Scribing',blurb:'Parchment, warp scrolls, buff scrolls and XP scrolls.',build:craftingGuide({skill:'Scribing',noTomes:true,station:'scribe’s lectern',tool:'scribing quill',learn:'You unlock it by finishing the quest <a href="#/guide/quest-binxonia-scriptorium-apprentice">The Scriptorium Apprentice</a> from Osric Blane; then it costs a skill point.',how:'<li>Parchment is 3 flax fibre. Every scroll takes 2 parchment, a pigment and usually a gem.</li><li>The Atlas recipe list only has parchment so far; the scroll tables below are from the official guide.</li>',extra:()=>[
      ['warps','Warp scrolls',`<p>A successful write gives <b>3 scrolls</b> and uses the gem; a failure <b>gives the gem back</b>. Each carat above the minimum adds 2,000 XP.</p>`+table(['Destination','Level','Pigment','Gem','XP'],[['Binxonia Mage Tower','5','3 woad','0.5c+','1,060'],['Plymouth Wharf','10','6 woad','0.5c+','1,120'],['Underleaf','15','9 woad','0.5c+','1,180'],['Appleseed Farm','20','3 madder','1c+','2,060'],['Mirewick','25','6 madder','1c+','2,120'],['Wispmeyer','30','9 madder','1c+','2,180']])],
      ['buffs','Buff scrolls',`<p>From level 5: +STR, END, DEX, SPD, INT, MAG, health, mana or stamina for a while. Stat scrolls take 6 madder and pool scrolls 4 woad, plus a monster reagent (boar tusk for STR, chitin plate for END, spider silk for DEX, gossamer wing for SPD, ancient acorn for INT, fae mote for MAG, living sap for health, mire essence for mana, rabbit foot for stamina). A bigger gem makes a stronger, longer buff. One buff per stat; the timer runs even while you are offline.</p>`+table(['Gem','Level','Bonus','Lasts'],[['none','5','+3','20 min'],['0.5c','15','+6','30 min'],['1c','25','+9','40 min'],['1.5c','35','+12','50 min'],['2c','45','+15','60 min'],['2.5c','55','+18','70 min'],['3c','65','+21','80 min'],['3.5c','75','+25','90 min'],['4c','85','+30','100 min']])],
      ['xp','XP scrolls',`<p>From level 25: <b>+10% combat, gathering or crafting XP for 10 minutes</b> (2 parchment, 6 weld and a gem of 1c or more). The three kinds run together; reading one again restarts its timer.</p>`],
      ['reading','Reading a scroll',`<p>Takes about 1.5 seconds and breaks if you move, are hit or stunned. It is refused within 10 seconds of dealing or taking damage.</p>`]],lede:'Write scrolls on parchment: warps that take you across the world, buffs, and XP boosts.',related:['herblore','travel','gems']})});

  // ---- Gear, gems & enchanting -------------------------------------------------------------------------------------
  reg({slug:'quality-and-enchanting',group:'Gear, gems & enchanting',title:'Quality & enchanting',blurb:'Quality tiers and their odds, mastery, carat caps and every enchantment.',build:()=>{
    const qm=typeof QUALITY_MULT!=='undefined'?QUALITY_MULT:{},qt=typeof QUALITY_TIERS!=='undefined'?QUALITY_TIERS:[];
    const qRows=qt.map(t=>[esc(pretty(t)),(qm[t]>0?'+':'')+Math.round((qm[t]||0)*100)+'%']);
    const QT=typeof QUALITY_TIERS!=='undefined'?QUALITY_TIERS:[];
    const odds=(typeof CRAFT_QUALITY_TABLE!=='undefined'?CRAFT_QUALITY_TABLE:[]).filter(t=>t.levelsOver%5===0).map(t=>[`<b>+${t.levelsOver}</b>${t.levelsOver===15?' (mastery from +14)':t.levelsOver===30?' (cap)':''}`,...QT.map(q=>q==='flawless'&&!t[q]?'~0%':((t[q]||0)*100).toFixed(1)+'%')]);
    const ER=typeof ENCHANT_RECIPES!=='undefined'?ENCHANT_RECIPES:{},EG=typeof ENCHANT_GEMS!=='undefined'?ENCHANT_GEMS:{};
    const gemName=g=>g==='any'?'any gem':EG[g]?.name||pretty(g);
    const eRows=Object.entries(ER).flatMap(([kind,list])=>list.map(e=>[esc(pretty(kind)),`<b>${esc(e.name)}</b>`,esc(e.effect),e.gems.map(gemName).map(esc).join(' + ')]));
    return {lede:'Crafted gear rolls a quality that scales its stats, and can then be enchanted with gems for extra damage, stats or accuracy.',sections:[
      ['quality','Quality tiers',table(['Quality','Stats'],qRows)],
      ['odds','Quality odds',`<p>The quality you get depends on how many levels you are <b>above</b> the item’s level, and stops improving at +30. Nothing you wear or hold changes it: a better tool (metal, quality, Artisan enchant) only raises your chance to succeed, and no ring or pendant affects crafting.</p>`+table(['Levels over recipe',...QT.map(q=>`<span class="q-name q-${q}">${esc(pretty(q))}</span>`)],odds)+note('The game developer’s published table. The <a href="#/calc-quality">Quality & enchanting</a> calculator works it out for one item.')],
      ['loot','Quality of dropped gear',`<p>Gear from chests and ordinary monsters is at most excellent. <b>Elites drop only excellent, superior or flawless.</b> Scrolls and food have no quality. At a master level, flawless is about 1 in 30 crafts.</p>`],
      ['mastery','Mastery',`<p>You can enchant an item once you have <b>mastered</b> it: the level where crafting it reaches its best success rate, <b>95%</b>. That is <b>14 levels</b> above its required level (60% at its level, climbing 40% over 15 levels, capped at 95%). A tool is the exception: its gem is set while it is forged, and you need mastery of the same tool <b>one metal up</b>.</p>`],
      ['carats','Carats',`<p>Gear enchantments use <b>three gems</b> (tools and rings one). Which gems decides the effect; their carats added up and rounded down decide the strength. An item holds <b>3 carats per material tier</b> (tier 4: 12) and anything above that is lost. Wearing enchanted gear takes <b>5 INT per carat</b>. Shields and ammo can’t be enchanted.</p>`],
      ['rings','Rings and tools',`<p><b>Rings</b> are forged at an anvil, bare or with one gem of 1c or more (up to 1/2/3/4c for iron/silver/gold/titanium). You wear two, and two of the same kind stack. 5c and 6c titanium rings only drop, from monsters level 25+. <b>Tools</b> take one gem while being forged (of the Artisan, +5% per carat). See ${guide('gems')} and ${guide('tool-smithing')}.</p>`],
      ['list','Every enchantment',table(['On','Enchantment','Effect','Gems'],eRows)+note('Weapon enchantments all add the same amount of damage per carat; the elemental ones add it as their element, Destruction as the weapon’s own type. Pick the one the monster is weak to.')],
    ],related:['gems','combat','weapon-smithing','armor-smithing']};
  }});
  reg({slug:'gems',group:'Gear, gems & enchanting',title:'Gems',blurb:'The nine gems, where they are found, and what their rings do.',build:()=>{
    const EG=typeof ENCHANT_GEMS!=='undefined'?ENCHANT_GEMS:{};
    const GD=globalThis.BXC_GAME_DATA;
    // ring and pendant wording at every carat, in the game's own words; the chips pick which one shows (no redraw)
    // one carat picker for every size: how rare it is, how often it turns up, where it comes from, and (whole carats,
    // the sizes rings and pendants take) the ring and pendant at that size in the game's own words. No redraw on a pick.
    const CS=[.5,1,1.5,2,2.5,3,3.5,4],pick=(()=>{try{const v=+localStorage.getItem('bxc-gem-guide-c');return CS.includes(v)?v:3}catch{return 3}})();
    const RQ={common:'ordinary',uncommon:'good','semi-rare':'excellent',rare:'superior','very rare':'flawless'};
    const rar=c=>typeof gemRarity==='function'?gemRarity(c):'common',shares=typeof gemFindShares==='function'?gemFindShares():null;
    const sizeLine=c=>{const sh=shares&&shares.total?shares.share(c):null;
      return `<span class="gg-at" data-c="${c}"><b>${c} carat</b> ${globalThis.bxcGemRarityChip?globalThis.bxcGemRarityChip(c):''}${sh!=null?` · ${(sh*100).toFixed(sh<.1?1:0)}% of gems found <span class="muted">(${shares.count(c)} of ${shares.total})</span>`:''}<br>${esc(typeof gemHowText==='function'?gemHowText(c):'')}${Number.isInteger(c)?'':'. <span class="muted">Rings and pendants take whole carats.</span>'}</span>`};
    const atC=(list,gem,fb)=>{const t=(list||[]).find(x=>x.gem===gem)?.text;return t?CS.map(c=>`<span class="gg-at" data-c="${c}">${Number.isInteger(c)&&t[c]?esc(t[c]):'<span class="muted">—</span>'}</span>`).join(''):esc(fb||'')};
    const rows=Object.entries(EG).map(([id,g])=>[item('gem-'+id,g.name),skillGuideLink(g.found),atC(GD&&GD.rings,id,g.ring),...(GD?[atC(GD.pendants,id,g.pendant)]:[])]);
    const chips=`<div class="q-picker gg-pick" role="group" aria-label="Carat">${CS.map(c=>`<button type="button" class="q-chip q-${RQ[rar(c)]}${c===pick?' on':''}" data-gg-c="${c}">${c}c</button>`).join('')}</div><p class="gg-size">${CS.map(sizeLine).join('')}</p>`;
    const GT=typeof GATHERABLES!=='undefined'?GATHERABLES:[],tier=(sk,i)=>{const t=GT.filter(x=>x.skill===sk).sort((a,b)=>a.level-b.level)[i];return t?item(slug(t.item),t.item):'—'};
    const tiers=[.5,.6,.75,1].map((p,i)=>[`Tier ${i+1}`,tier('mining',i),tier('fishing',i),tier('lumberjack',i),`<b>${p}%</b>`]);
    return {lede:'Gems turn up while gathering and from humanoid monsters. Set in a ring or pendant a gem gives a lasting bonus, three of them make an enchantment, and the witch can build small ones into bigger ones.',sections:[
      ['list','The nine gems',`<div class="gg-wrap" data-c="${pick}">`+chips+table(['Gem','Found by','As a ring',...(GD?['As a pendant']:[])],rows)+'</div>'+(GD?note('Up to 2c can be built at the witch, so those count as common; bigger gems only come from gathering. Rings take a gem of 1c or more: up to 1/2/3/4c for iron/silver/gold/titanium.'):'')],
      ['finding','Finding gems',`<p>Every successful gather has a chance of a gem from that skill, higher for better resources (for fishing, the fish that bit). Which of the skill’s gems you get is random.</p>`+table(['','Mining','Fishing','Lumberjack','Chance'],tiers)+`<p>Monsters of level 10+ that can drop gems have a flat <b>1%</b>, with the biggest carat set by their level: 0.5c from level 10, 1c from 20, 1.5c from 30, 2c from 40.</p>`],
      ['witch','Building a gem at the witch',globalThis.bxcGemWitchHtml?globalThis.bxcGemWitchHtml():''],
      ['uses','Using them',`<p>Enchantments take three gems each; the recipes are on ${guide('quality-and-enchanting')}.</p>`]
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
      ...Object.entries(S).map(([w,list])=>[slug(w),w,table(['Skill','Special','What it does','Cooldown'],list.map(([l,name,what,cd])=>[n(l),`<b>${esc(name)}</b>`,esc(what),cd]))]),
      ['learn','Unlocking combat skills',`<p>You can only wield the weapon types you know, and each is a skill of its own that levels with the damage you deal. You start with your class’s weapons; the rest come from <b>quests</b> or a <b>tome</b>.</p>`+
        table(['Skill','Who starts with it','How everyone else gets it','Cost'],[
          [item('titanium-sword','Sword'),'Warriors',`A <b>Sword tome</b>: study it from your pack.`,'1 skill point'],
          [item('titanium-dagger','Dagger'),'Archers',`A <b>Dagger tome</b>.`,'1 skill point'],
          [item('shagbark-longbow','Bow'),'Archers',`A <b>Bow tome</b>.`,'1 skill point'],
          [item('titanium-mace','Mace'),'—',`Quest <b>The Broken Hammers</b> from <b>Hester Bell</b> near Rustpick Mine (warriors, level 10). You also get a mace.`,'Free'],
          [item('titanium-spear','Spear'),'—',`Quest <b>Beyond the Point</b> from <b>Tobin Reed</b> near Underleaf (warriors, level 10). You also get a spear.`,'Free'],
          [item('shagbark-crossbow','Crossbow'),'—',`Quest <b>The Heavy Bow</b> from the <b>Archery Vendor</b> by the targets in Underleaf (any class, level 10): bring him 6 crossbow stocks the young hill giants carried off. You also get a crossbow.`,'Free'],
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
    const bySchool=table(['School','Spells by level'],schools.map(sc=>[esc(pretty(sc)),SP.filter(x=>x.school===sc).sort((a,b)=>a.level-b.level).map(x=>esc(x.name)+' <span class="muted">('+x.level+')</span>').join(', ')]));
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
      ['weapons','The weapons',table(['Weapon','Skill','Type','Roll','Swing every','Reach','Avg per second*'],weaponRows(list))+note('*Base roll only, before material, stats, quality and enchantments. At the same material every melee weapon does about the same damage per second: slow ones hit harder per swing. Spears reach 2.5 tiles, the rest 1.5.')],
      ['stats','Strength, Dexterity and crits',`<p>Swords, maces and spears add <b>${(SD().strength*100).toFixed(1)}% of their average roll per point of Strength</b>. The <b>dagger</b> is a finesse blade: it scales with <b>Dexterity</b> instead and crits more (+${CRIT_DAGGER}% crit chance on top of the ${CRIT_BASE}% base and ${CRIT_PER_DEX}% per Dexterity, capped at ${CRIT_CAP}%). A crit hits ×${CRIT_MULT}.</p>`],
      ['types','Picking by damage type',`<p>Maces <b>crush</b>, daggers, spears and the rapier <b>stab</b>, and the other swords <b>slash</b>. A monster weak to your type takes <b>${Math.round((WEAK-1)*100)}% more</b>; one that resists it takes <b>${Math.round((1-RESIST)*100)}% less</b>. <a href="#/guide/monster-families">Monster families</a> shows who is weak to what, and the <a href="#/calc-combat">Combat calculator</a> ranks monsters for your weapon.</p>`],
      ['boost','Enchants and rings',`<p>Weapon enchants: <b>Destruction</b> adds to every hit; <b>Flame</b>, <b>Freezing</b>, <b>Storm</b> and <b>Corrosion</b> add elemental damage. (Seeking is for bows and crossbows only.) Rings: <b>Brawler</b> (${esc(ringText('brawler',4)||'more melee damage')} at 4 carats), <b>Duelist</b> (${esc(ringText('duelist',4)||'more crit chance')}) and <b>Reaper</b> (${esc(ringText('reaper',4)||'more damage on low-health targets')}).</p>`],
      ['learn','Learning them',`<p>Warriors start with the sword and archers with the dagger. Warriors learn the <b>mace</b> (The Broken Hammers, Hester Bell near Rustpick Mine) and the <b>spear</b> (Beyond the Point, Tobin Reed near Underleaf) from level-10 quests at no skill point; a sword or dagger tome costs a skill point. See <a href="#/guide/special-attacks">Weapon skills &amp; specials</a> for the full table and every special attack.</p>`]
    ],related:['special-attacks','combat','monster-families','armor']};
  }});
  reg({slug:'ranged',group:'Ranged',title:'Ranged weapons',blurb:'Bows and crossbows: range, Dexterity, ammunition, Seeking and the Hunter ring.',build:()=>{
    const list=WEAPONS.filter(w=>['bow','crossbow'].includes(w[1]));
    const ammo=(typeof RECIPES!=='undefined'?RECIPES:[]).filter(r=>/^(arrow|bolt|bodkin-arrow|bodkin-bolt)$/.test(r.id));
    return {lede:'Ranged weapons fire from a distance, so a monster has to cross the ground to reach you. They level their own skill with the damage you deal, with five special attacks each.',sections:[
      ['weapons','The weapons',table(['Weapon','Skill','Type','Roll','Shot every','Range','Avg per second*'],weaponRows(list))+note('*Base roll only, before material, Dexterity, quality and enchantments. Bows slash and the crossbow stabs.')],
      ['stats','Dexterity and crits',`<p>Bows and crossbows add <b>${(SD().dexterity*100).toFixed(2)}% of their average roll per point of Dexterity</b>, and Dexterity also raises crit chance (${CRIT_PER_DEX}% a point on top of ${CRIT_BASE}%, capped at ${CRIT_CAP}%; a crit hits ×${CRIT_MULT}). Wooden weapons need Dexterity to equip.</p>`],
      ['ammo','Arrows and bolts',ammo.length?`<p>A <b>Bowyer</b> makes the ammunition:</p>`+table(['Item','Level','Makes','From'],ammo.map(r=>[item(r.id,r.item),n(r.level),'×'+(r.out||1),(r.ingredients||[]).map(i=>`${i.quantity}× ${item(i.id)}`).join(', ')])):'<p>A Bowyer makes arrows and bolts.</p>'],
      ['boost','Seeking, enchants and rings',`<p><b>Seeking</b> is the ranged enchant: +2% chance to hit per carat, and only bows and crossbows take it. The other weapon enchants work too. The <b>Hunter</b> ring (emerald) adds ${esc(ringText('hunter',4)||'more damage to arrows and bolts')} at 4 carats; <b>Duelist</b> adds crit chance and <b>Reaper</b> damage on low-health targets.</p>`],
      ['learn','Learning them',`<p>Archers start with the bow. Any class can learn the <b>crossbow</b> from level 10: the <b>Archery Vendor</b> by the targets in Underleaf offers <b>The Heavy Bow</b> (bring him 6 crossbow stocks the young hill giants carried off), free of skill points. A bow tome costs a skill point. See <a href="#/guide/special-attacks">Weapon skills &amp; specials</a> for every special attack.</p>`]
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
    ...(gameSpellTables()?[['spells','Every spell (the game’s list)',gameSpellTables().bySchool]]:[]),
    ['levels','Spell levels',gameSpellTables()?gameSpellTables().levels+note('From the game’s own spell table. Casting is cancelled by moving; level-4 spells hit an area you place. Cooldowns are shared by spell level across schools.'):table(['Level','Damage','Per 10 MAG','Mana','Cooldown','INT','School skill'],[['1','4–6','+0.5','3','2.4 s','10','—'],['2','5–9','+0.7','4','3.2 s','20','5'],['3','7–11','+0.9','8','4.8 s','30','15'],['4','7–11 each (area)','+0.9','30','6.4 s','40','25']])+note('Casting takes 0.6 s (level 1) to 1.3 s (level 4) and moving cancels it. Level-4 spells hit an area you place. Cooldowns are shared by spell level across schools, with a 2.4 s global cooldown; a killing blow resets them all.')],
    ['schools','What each school adds',`<p>From spell level 2, a hit can add its school’s effect: a 20% chance, rising with MAG up to 90%.</p>`+table(['School','Effect','Spells'],[['Fire','Burn: another 25% of the hit as fire over 4 s','Burning Arrow, Fire Blast, Firepit, Fireball'],['Ice','Chill: 30% slower movement and attacks','Ice Bolt, Ice Zap, Ice Grasp, Blizzard'],['Shock','Stun for 1 s, then a short immunity','Shockbolt, Sparkbolt, Lightning, Thunderstorm'],['Acid','Corroded: takes up to 12% more damage from everything','Acid Bolt, Caustic Blast, Acid Pit, Acid Rain'],['Restoration','Heals, and may remove one debuff','Mend, Renew, Ward, Sanctuary']])],
    ['damage','Damage and mana',`<p>Every full 10 MAG above 10 raises spell damage; the wand itself does not. Mana does not come back during a fight; damage spells still cast at 0 mana but weaker, heals do not. A <b>staff</b> (made by Bowyers) enchanted to a school adds school damage too. Metal armor stops all casting (see ${guide('armor')}).</p>`],
    ['healing','Healing',`<p>Mend heals at once; Renew heals over 6 s (about 1.5 Mends); Ward is a shield that lasts 8 s or one big hit; Sanctuary heals everyone in an area four times over 6 s. Healing yourself does half. Healing someone under attack draws the monsters to you. Renew, Ward and Sanctuary scrolls drop from spellcasting monsters (level 8+, 18+ and 30+).</p>`]
  ],related:['combat','attributes-and-classes','quality-and-enchanting']})});

  reg({slug:'shearing',group:'Gathering skills',title:'Shearing',blurb:'Wool from sheep, and what it is used for.',build:()=>{
    const uses=usesOf('wool');const skills=[...new Set(uses.map(r=>r.skill))];
    return {lede:'Use shears on a sheep to get wool. The sheep runs off a little, and its fleece grows back in about a minute; most sheep give a second clip and a few a third.',sections:[
      ['levels','Levelling',`<p>Success climbs quickly over the first levels, and after that levels add to how much you get.</p>`],
      ['uses','What wool is for',`<p>${skills.map(s=>skillGuideLink(s)).join(' · ')}</p>`+table(['Skill','Level','Makes','Needs'],uses.map(r=>[esc(r.skill),n(r.level),item(r.id,r.item),ingList(r)]))],
      ['where','Where the sheep are',`<p>Sheep are in the <a href="#/monster/sheep">Bestiary</a>; their page shows where they have been seen.</p>`]
    ],related:['tailoring','bowyer','tool-smithing']};
  }});

  reg({slug:'economy',group:'World',title:'Gold, vendors & the Exchange',blurb:'Vendor prices, the player market, platinum and taxes.',build:()=>({lede:'Gold comes from monsters and selling; the Exchange lets players trade with each other without meeting.',sections:[
    ['vendors','Vendors',`<ul class="g-list"><li>Vendors sell for <b>5× what they pay</b>. Weapons, armor and shields above tier 1 (and that tier’s wood, hides and cloth) cost far more: silver 45×, gold 180×, titanium 145×.</li><li>They pay an extra <b>1,000 gold per carat</b> of enchantment on an item.</li><li>Stock is limited. Sales of 1,000 gold or more ask you to confirm.</li></ul>`],
    ['exchange','The Exchange',`<p>The player market, on the website and at Exchange Clerks in the game, in gold only.</p>`+kv([['Tax','5% on sales'],['Orders','25 per character; they never expire and hold their slot until the goods are collected'],['Stackables','Materials, potions, ammo and warp scrolls trade as a pool at the resting price'],['Gear and gems','Trade by exact quality, enchantment and carat'],['Collecting','Gold goes straight to you; goods are picked up from a clerk']])],
    ['platinum','Platinum',`<p>Platinum is bought with real money (1,000 per US$1, with a bonus on bigger packs), is shared across your account and cannot be traded. It pays for things like founding a guild.</p>`],
    ['gems','Selling gems',`<p>The ${OFFICIAL} says vendors pay 100 gold per carat for gems in one place and nothing in another, so check before selling.</p>`]
  ],related:['playing-together','gems','death-and-banking']})});

  reg({slug:'playing-together',group:'World',title:'Parties, trading & guilds',blurb:'Party XP, trading safely, and what a guild costs.',build:()=>({lede:'Binxonia is better with friends: parties share kill XP with a bonus, and guilds share a vault.',sections:[
    ['party','Parties',`<p>Up to <b>4</b> players. Kill XP is pooled with <b>+10% for each extra member</b> and split evenly between members nearby on the same floor. Party members can’t hurt each other. Type <b>/p</b> for party chat.</p>`],
    ['trade','Trading',`<p>Both players put items in the trade window and both confirm; any change clears the confirmations, so check the window before accepting. Type <b>!</b> in chat to link an item.</p>`],
    ['guild','Guilds',table(['',''],[['Founding','20,000 platinum at a Guildmaster; a unique name and a 3-letter tag'],['Ranks','Member, Officer (invites, kicks), Leader (everything)'],['Upkeep','Every 30 days: 250 platinum per member, at least 2,500. Unpaid: the vault is sealed; 14 days late: the guild is disbanded'],['Vault','Tabs of 60 slots; the first is free, more cost 5,000 platinum each (up to 10)'],['Hall','Level 1: 25 members. Level 2 (25,000): 50. Level 3 (75,000): 100']],'g-kv')]
  ],related:['economy']})});

  // Quests, from what the collector recorded (store "quests": one record per quest, see background.js recordQuest):
  // who gives it, the level, length, quest points, the game's blurb and the exact rewards; the steps and their map
  // spots, what the quest-giver says and the closing line fill in as quests are played with the collector running.
  // "All quests" lists them; every quest has its own page, #/guide/quest-<quest id>, made on the fly from its record.
  const questList=()=>((globalThis.BINXONIA_COLLECTOR_SNAPSHOT||{}).quests||[]).filter(q=>q&&q.name).sort((a,b)=>(a.recommendedLevel||0)-(b.recommendedLevel||0)||String(a.name).localeCompare(b.name));
  const questSlug=q=>'quest-'+slug(q.questId||q.name);
  const questBySlug=s=>String(s||'').startsWith('quest-')?questList().find(q=>questSlug(q)===s)||null:null;
  // Quest guides the user has confirmed as fully written (quest ids). Every other quest gets an alert: on its card on
  // the Quests page, and a banner on its own page.
  const QUEST_COMPLETE=new Set(['wasteland-nothing-gets-through','imp-menace']);
  const questDone=q=>QUEST_COMPLETE.has(q.questId);
  const ALERT_SVG='<svg class="q-alert-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20z" fill="currentColor"/><path d="M12 10v5M12 17.6v.4" stroke="#1b1300" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const questLink=q=>`<a href="#/guide/${enc(questSlug(q))}">${esc(q.name)}</a>`;
  const Q_CATS=[['story','Story'],['side','Side quests'],['skill','Skill quests']];
  const questCat=q=>Q_CATS.some(c=>c[0]===q.category)?q.category:'side';
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
  const QUEST_SKILLS={'binxonia-scriptorium-apprentice':{unlocks:['scribing'],requires:['herblore']}};
  const questRequiresSkills=q=>(QUEST_SKILLS[q.questId]?.requires||[]).map(k=>`<a href="#/guide/${esc(k)}">${esc(pretty(k))}</a>`);
  function questRewards(q){
    const r=q.rewards||{},rows=[];
    if(r.gold)rows.push(['Gold',qn(r.gold)]);
    if(r.characterXp)rows.push(['Character XP',qn(r.characterXp)]);
    for(const s of [...(r.skillXp||[]),...(r.combatSkillXp||[])])rows.push([esc(questSkill(s))+' XP',qn(s.amount)]);
    if(q.questPoints)rows.push(['Quest points',String(q.questPoints)]);
    const items=(r.items||[]).map(i=>item(i.typeId)+(i.quantity>1?' ×'+qn(i.quantity):''));
    if(items.length)rows.push(['Items',items.join('<br>')]);
    const choice=(r.choice||[]).map(i=>item(i.typeId)+(i.quantity>1?' ×'+qn(i.quantity):''));
    if(choice.length)rows.push(['Choose one',choice.join('<br><span class="muted">or</span> ')]);
    const skillLink=k=>byslug.has(slug(k))?`<a href="#/guide/${esc(slug(k))}">${esc(pretty(k))}</a>`:esc(pretty(k));
    const unlocks=(QUEST_SKILLS[q.questId]?.unlocks||(r.skills||[]).map(x=>x.skill||x)).map(x=>'the '+skillLink(x)+' skill').concat([...(r.weaponSkills||[]).map(x=>pretty(x.skill||x)+' (weapon skill)'),...(r.spellSchools||[]).map(x=>pretty(x.school||x)+' magic'),...(r.spells||[]).map(x=>pretty(x.spell||x)),...(r.unlockPackMule?['a pack mule']:[]),...(r.unlockMounts||[]).map(x=>pretty(x))].map(esc));
    if(unlocks.length)rows.push(['Unlocks',unlocks.join(', ')]);
    return rows.length?table(['Reward',''],rows,'q-rewards'):'<p class="muted">No rewards recorded.</p>';
  }
  const questRewardLine=q=>{const r=q.rewards||{},b=[];if(r.gold)b.push(qn(r.gold)+' gold');if(r.characterXp)b.push(qn(r.characterXp)+' XP');if((r.items||[]).length||(r.choice||[]).length)b.push('items');if(q.questPoints)b.push(q.questPoints+' QP');return b.join(' · ')};
  // The steps: 1 is always "talk to the quest-giver" (where they are, with a map button); then the stages the game sent
  // while someone was on the quest (numbered after it); with none recorded, what players reported (QUEST_REQUIRES).
  // Quests whose every step is known: the recorded steps are all of them, and handIn - the last step is going back to
  // the quest-giver (as players who finished it reported).
  const QUEST_STEPS_KNOWN={'imp-menace':{handIn:true}};
  function questSteps(q){
    const st=(q.stages||[]).filter(s=>s.objectives&&s.objectives.length);
    const placeOf=w=>(globalThis.bxcPlaceAt&&globalThis.bxcPlaceAt(w.z,w.x,w.y))||questZone(w.z);   // the building or dungeon it is in, not just its zone number
    // a named place links to it on the map: the game's own marker (Imp Tree), else the building's or cave's entrance
    const placeLink=w=>{const n=placeOf(w);if(!n)return '';const poi=(typeof D!=='undefined'&&D.pois||[]).find(p=>p.name===n);return `<a href="#" class="show-on-map" data-map-kind="${poi?'place':'zone'}" data-map-id="${esc(poi?poi.name:String(w.z))}">${esc(n)}</a>`};
    const where=w=>w?(w.z&&w.z!==0?` <span class="muted">inside ${placeOf(w)?placeLink(w):'a cave or building'}${placeOf(w)?'':` (${Math.round(w.x)}, ${Math.round(w.y)})`}</span>`:` <span class="muted">at ${Math.round(w.x)}, ${Math.round(w.y)}</span>`):'';
    const g=q.giverName?(globalThis.bxcQuestGivers?globalThis.bxcQuestGivers():[]).find(x=>x.name===q.giverName):null;
    const p=!g&&q.giverName&&globalThis.bxcNpcByName?globalThis.bxcNpcByName(q.giverName):null;
    const who=q.giverName?(g||p?`<a href="${esc((g||p).href)}">${esc(q.giverName)}</a>`:esc(q.giverName)):'the quest-giver';
    const whereGiver=g&&g.where&&g.where[0]?` <span class="muted">(${esc(g.where[0])})</span>`:'';
    const mapBtn=(g&&g.onMap)||(p&&p.onMap)?` <button type="button" class="show-on-map" data-map-kind="npc" data-map-id="${esc((g||p).slug)}">Show on map</button>`:'';
    const steps=[`<li value="1">Talk to ${who}${whereGiver} to get the quest.${mapBtn}</li>`];
    // every step known (players who finished it said so): the recorded ones in order, then handing it back in
    const known=QUEST_STEPS_KNOWN[q.questId];
    if(st.length&&known){
      st.forEach((s,k)=>steps.push(`<li value="${k+2}">${s.text&&!s.objectives.some(o=>o.text===s.text)?`<b>${esc(s.text)}</b><br>`:''}${s.objectives.map(o=>`${esc(o.text)}${o.required>1?` <span class="muted">(${qn(o.required)})</span>`:''}${o.itemTypeId?' - '+item(o.itemTypeId):''}${where((o.waypoints||[])[0])}`).join('<br>')}</li>`));
      if(known.handIn)steps.push(`<li value="${st.length+2}">Go back to ${who} to finish the quest.${mapBtn}</li>`);
      return '<ol class="q-steps">'+steps.join('')+'</ol>';
    }
    if(st.length){
      for(const s of st)steps.push(`<li value="${(s.n||0)+2}">${s.text&&!s.objectives.some(o=>o.text===s.text)?`<b>${esc(s.text)}</b><br>`:''}${s.objectives.map(o=>`${esc(o.text)}${o.required>1?` <span class="muted">(${qn(o.required)})</span>`:''}${o.itemTypeId?' - '+item(o.itemTypeId):''}${where((o.waypoints||[])[0])}`).join('<br>')}</li>`);
      return '<ol class="q-steps">'+steps.join('')+'</ol>'+((st[0].n||0)>0?note('Some steps in between were not recorded.'):'');
    }
    const r=QUEST_REQUIRES[q.questId];
    if(r&&r.oneOf){
      {const names=r.oneOf.map(o=>item(o.id)),list=names.length>1?names.slice(0,-1).join(', ')+' or '+names[names.length-1]:names[0];
        steps.push(`<li value="2">Get ${list}${r.quality?`, <span class="q-name q-${esc(r.quality)}">${esc(pretty(r.quality))}</span> quality or better`:''}.</li>`)}
      steps.push(`<li value="3">Bring it back to ${who} to finish the quest.</li>`);
      return '<ol class="q-steps">'+steps.join('')+'</ol>'+note('Steps 2 and 3 are as reported by players who finished it.');
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
  function questUnlocks(q){
    const u=QUEST_UNLOCKS[q.questId];if(!u)return '';
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
      const facts=table(['',''],[['Given by',questGiver(q)],['Level',String(q.recommendedLevel||'?')],['Length',esc(pretty(q.lengthTag||'?'))],['Kind',esc((Q_CATS.find(c=>c[0]===questCat(q))||[])[1]||'Side quests').replace(/ quests$/,'')],['Quest points',String(q.questPoints||0)],...(questRequiresSkills(q).length?[['Requires',questRequiresSkills(q).join(', ')+' skill']]:[])],'q-facts');
      return {lede:(questDone(q)?'':`<span class="q-alert-banner" role="alert">${ALERT_SVG}<span><b>This quest is not fully written yet.</b> Steps, items or dialogue may be missing.</span></span>`)+(q.lore?esc(q.lore):''),sections:[
        ['about','About',facts],
        ['needs','What you need',questNeeds(q)],
        ['steps','Steps',questSteps(q)],
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
  reg({slug:'travel',group:'World',title:'Travel & quests',blurb:'Horses, warp scrolls, keys, and how quests work.',build:()=>({lede:'Getting around faster, and the basics of quests.',sections:[
    ['horse','Horses',`<p>A horse costs <b>2,500 gold</b> at a stable and makes you <b>50% faster on roads</b>. Press <b>H</b> to mount or dismount; you get off by yourself to gather. Being overloaded slows you even on a horse.</p>`],
    ['warps','Warp scrolls',`<p>Scribes make warp scrolls to places like the Mage Tower, Plymouth Wharf, Underleaf, Appleseed Farm, Mirewick and Wispmeyer. Reading one takes about 1.5 s and is broken by moving, damage or a stun, and it is refused within 10 s of a fight. See ${guide('scribing')}.</p>`],
    ['keys','Keys',`<p>A key is used up each time it opens a lock.</p>`],
    ['quests','Quests',`<p><b>!</b> above an NPC means a quest to take, <b>?</b> one to hand in; rewards show before you accept. Kill goals count related creatures too, place goals get a waypoint, and timed quests start their clock when you accept. Some quests teach things for free: the mace and spear for warriors, the other magic schools, and Herblore.</p>`],
    ['map','Maps',`<p>The game has a Map panel. The Atlas <a href="#/map">World map</a> adds what players have found: monster areas, resources, cave and building layouts. See also ${guide('places')}.</p>`]
  ],related:['places','scribing']})});

  // ---- rendering ------------------------------------------------------------------------------------------------------
  // reading order within each group (anything not listed goes after these)
  const ORDER=['getting-started','attributes-and-classes','levels-and-xp','death-and-banking','using-the-atlas','combat','special-attacks','armor','magic','monsters-by-level','monster-families','mining','lumberjack','fishing','herblore','shearing','smelting','weapon-smithing','armor-smithing','tool-smithing','bowyer','tailoring','leatherworking','cooking','scribing','quality-and-enchanting','gems','outfits','places','trainers','travel','economy','playing-together'];
  const orderOf=s=>{const i=ORDER.indexOf(s);return i<0?999:i};
  // one card per recorded quest (the Quests section of the guide index), each opening its own page
  function questCards(){return questList().map(q=>`<a class="g-card" href="#/guide/${enc(questSlug(q))}">${questDone(q)?'':`<span class="q-alert" role="note">${ALERT_SVG}Not fully written yet</span>`}<b>${esc(q.name)}</b><span>Level ${q.recommendedLevel||'?'} · ${esc(pretty(q.lengthTag||''))}${q.giverName?' · '+esc(q.giverName):''}</span></a>`).join('')}
  function indexHtml(only){
    const groups=only?GROUPS.filter(gr=>slug(gr)===only):GROUPS;
    // All guides: a row of links to each group first, and each heading links to its own page
    const jump=only?`<p class="g-groups"><a href="#/guides">All guides</a>${GROUPS.filter(gr=>slug(gr)!==only).map(gr=>` · <a href="#/guides-${slug(gr)}">${esc(gr)}</a>`).join('')}</p>`
      :`<p class="g-groups">${GROUPS.filter(gr=>G.some(g=>g.group===gr)).map(gr=>`<a href="#/guides-${slug(gr)}">${esc(gr)}</a>`).join(' · ')}</p>`;
    return `<div class="g-index">`+jump+groups.map(gr=>{const list=G.filter(g=>g.group===gr).sort((a,b)=>orderOf(a.slug)-orderOf(b.slug));if(!list.length)return '';
      return `<section><h2>${only?esc(gr):`<a href="#/guides-${slug(gr)}">${esc(gr)}</a>`}</h2><div class="g-cards">${list.map(g=>`<a class="g-card" href="#/guide/${enc(g.slug)}"><b>${esc(g.title)}</b><span>${esc(g.blurb)}</span></a>`).join('')}${gr==='Quests'?questCards():''}</div></section>`}).join('')+`</div>`;
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
  document.addEventListener('click',e=>{const b=e.target.closest('[data-gg-c]');if(!b)return;const w=b.closest('.gg-wrap');if(!w)return;w.dataset.c=b.dataset.ggC;
    w.querySelectorAll('[data-gg-c]').forEach(x=>x.classList.toggle('on',x===b));try{localStorage.setItem('bxc-gem-guide-c',b.dataset.ggC)}catch{}});
  // "On this page" links scroll within the page instead of changing the address
  document.addEventListener('click',e=>{const a=e.target.closest('[data-g-jump]');if(!a)return;e.preventDefault();document.getElementById(a.dataset.gJump)?.scrollIntoView({behavior:'smooth',block:'start'})});
  globalThis.bxcGuides={
    list:G,indexHtml,pageHtml,
    title:s=>(byslug.get(s)||questGuide(s))?.title||pretty(s),
    has:s=>byslug.has(s)||!!questBySlug(s),
    // the guide for a skill name as the game or a recipe spells it ("Armor Smithing", "mining")
    forSkill:skill=>{const s=skillGuideSlug(skill);return byslug.has(s)?s:null},
    link:(s,label)=>byslug.has(s)?guide(s,label):''
  };
})();
