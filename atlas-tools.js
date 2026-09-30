// Crafting planner (Crafting > Crafting XP): pick a skill, your level and a goal, and see what to make at each
// stretch, how many crafts and attempts it takes, and the materials. Laid out like the rest of the wiki: a small
// "Your numbers" box, reading sections, and a facts box. Gathering skills work too (tiers, tool bonus).
// Field ids (cSkill, cLevel, cInto, cAutoState) are the ones atlas-live.js fills from your character in the app.
// Built only when the page is open; nothing here runs on live updates except refilling your level.
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const slug=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const pretty=id=>String(id||'').replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  const n=v=>Math.round(v).toLocaleString('en-US');
  const pct=v=>(v*100).toFixed(v<.1?1:0)+'%';
  const icon=id=>typeof itemImg==='function'?`<img class="g-ico" src="${esc(itemImg({id,typeId:id,item:pretty(id)}))}" alt="">`:'';
  const item=(id,label)=>`<a href="#/item/${encodeURIComponent(id)}">${icon(id)}${esc(label||pretty(id))}</a>`;
  const xpAtT=l=>typeof xpAt==='function'?xpAt('Trade',Math.max(1,Math.min(100,l))):0;
  const levelFor=xp=>{let l=1;while(l<100&&xpAtT(l+1)<=xp)l++;return l};
  const table=(head,rows,cls='')=>`<div class="g-scroll"><table class="g-table ${cls}"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  // Tools, from the game's rules: which tool each skill uses, and what a tool adds to the chance of success -
  // its metal (iron 0, silver 3%, gold 7%, titanium 12%), 5% per carat of an Artisan enchant (at most 1 carat on
  // iron, 2 silver, 3 gold, 4 titanium) and 10% of its quality's value (flawless +3.8%, inferior -3%). Success is
  // capped at 95%; for cooking the bonus comes off the chance to burn. A silver tool needs the skill at 15, gold 30,
  // titanium 45. Smelting has no tool.
  const TOOL=[['iron','Iron',0,1],['silver','Silver',.03,15],['gold','Gold',.07,30],['titanium','Titanium',.12,45]];
  const TOOL_OF={'armor smithing':'Smithing hammer','weapon smithing':'Smithing hammer','tool smithing':'Smithing hammer',tailoring:'Sewing kit',leatherworking:'Leatherworking awl',bowyer:'Carving tool',cooking:'Frying pan',scribing:'Scribing quill',herblore:'Herbalist sickle',mining:'Pickaxe',lumberjack:'Axe',fishing:'Fishing rod',shearing:'Shears'};
  // the game's own values where game-data.js is loaded (metal bonus and skill level by tier, quality values)
  {const GT=globalThis.BXC_GAME_DATA?.tools;if(GT&&Array.isArray(GT.metalBonus)&&Array.isArray(GT.levelNeeded))TOOL.forEach((t,i)=>{if(Number.isFinite(GT.metalBonus[i+1]))t[2]=GT.metalBonus[i+1];if(Number.isFinite(GT.levelNeeded[i+1]))t[3]=GT.levelNeeded[i+1]})}
  const QUALITIES=[['inferior',-.3],['crude',-.2],['shoddy',-.1],['ordinary',0],['good',.1],['excellent',.22],['superior',.3],['flawless',.38]];
  const toolFor=skill=>TOOL_OF[String(skill||'').toLowerCase().replace(/-/g,' ')]||null;
  // "Best for my level": the best metal your skill level allows (Artisan carats are capped by the metal)
  const bestToolAt=l=>{let i=0;TOOL.forEach((t,k)=>{if(l>=t[3])i=k});return i};
  const toolIdx=(sel,l)=>sel==='best'?bestToolAt(l):Math.max(0,TOOL.findIndex(t=>t[0]===sel));
  const toolOptions=sel=>`<option value="best"${sel==='best'?' selected':''}>Best for my level</option>`+TOOL.map(([k,l,,lv])=>`<option value="${k}"${k===sel?' selected':''}>${l}${lv>1?' (level '+lv+')':''}</option>`).join('');
  function toolBonus(metal,quality,carat){
    const i=Math.max(0,TOOL.findIndex(t=>t[0]===metal)),q=(QUALITIES.find(x=>x[0]===quality)||[0,0])[1];
    return TOOL[i][2]+.05*Math.min(Math.max(0,+carat||0),i+1)+.1*q;
  }

  // The options for a skill: recipes, or gathering tiers. Each has id, label, level, xp, chance(level), per (materials per attempt).
  // Gathering, from the game's rules: a node works 50% of the time at its level, +5% a level, up to 95% (reached 9
  // levels above it - "mastery"); the tool's bonus is added on top, and whatever goes past 95% is "overflow". Items
  // per success = base yield × (1 + 10% for every level past mastery) × (1 + overflow), and Prospector rings (amber)
  // add 2% gathered yield per carat on top. An attempt takes 3.5 s at rocks, trees and fishing spots, 2 s at plants.
  const GATHER_MS={mining:3500,lumberjack:3500,fishing:3500,herblore:2000};
  function gatherModel(g,tool,pros){
    const base=l=>Math.min(.95,.5+Math.max(0,l-g.level)*.05);
    const chance=l=>l<g.level?0:Math.max(0,Math.min(.95,base(l)+tool));
    const overflow=l=>Math.min(.95,Math.max(0,base(l)+tool-.95));
    const avg=((+g.minYield||1)+(+g.maxYield||+g.minYield||1))/2;
    const yieldAt=l=>avg*(1+Math.max(0,l-(g.level+9))*.1)*(1+overflow(l))*(1+.02*pros);
    return {chance,yieldAt,ms:GATHER_MS[g.skill]||null};
  }
  function optionsFor(skill,mode,tool,pros=0){
    if(mode==='gather'){
      const key=skill.toLowerCase();
      return (typeof GATHERABLES!=='undefined'?GATHERABLES:[]).filter(g=>g.skill===key).map(g=>{const mdl=gatherModel(g,tool,pros);
        return {id:slug(g.item),label:g.item,level:g.level,xp:g.xp,per:[],chance:mdl.chance,yieldAt:mdl.yieldAt,ms:mdl.ms,base:[g.minYield,g.maxYield]}});
    }
    // a bar's XP is shared by the three smithing skills, so smelting counts a third of it towards each
    return (typeof RECIPES!=='undefined'?RECIPES:[]).filter(r=>r.skill===skill||(r.split&&r.split.includes(skill))).map(r=>({id:r.id,label:r.item,level:r.level,xp:r.split&&r.skill!==skill?r.xp/r.split.length:r.xp,out:r.out||1,per:r.ingredients||[],
      chance:l=>{
        if(r.chance==='always')return 1;
        if(r.chance==='cooking'){if(l<r.level)return 0;const burn=l>=r.stop?.05:(l<=r.level?r.burn:r.burn*(1-(l-r.level)/(r.stop-r.level)));return Math.max(0,Math.min(.95,1-Math.max(0,burn-tool)))}
        if(l<r.level)return 0;const base=typeof craftChance==='function'?craftChance(r,l):.6;return Math.max(0,Math.min(.95,base+tool));
      },sure:typeof craftSureAt==='function'?craftSureAt(r):r.level+14,split:r.split?r.split.length:1}));
  }
  // From (level, xp into it) to goal: split where a better option unlocks, take the most XP per attempt in each stretch.
  function plan(opts,level,into,goal){
    const unlocks=[...new Set(opts.map(o=>o.level))].filter(l=>l>level&&l<goal).sort((a,b)=>a-b);
    const stops=[level,...unlocks,goal],rows=[];
    let xp=xpAtT(level)+into;
    for(let i=0;i<stops.length-1;i++){
      const from=stops[i],to=stops[i+1],ok=opts.filter(o=>o.level<=from);if(!ok.length)continue;
      const best=ok.reduce((a,b)=>b.xp*b.chance(from)>a.xp*a.chance(from)?b:a);
      // level by level (fast even when the goal is millions of crafts away)
      let tries=0,items=0;const succ=Math.ceil((xpAtT(to)-xp)/best.xp);
      for(let l=levelFor(xp);l<to;l++){const part=Math.min(xpAtT(l+1),xpAtT(to))-Math.max(xpAtT(l),xp);if(part>0){tries+=part/best.xp/Math.max(.05,best.chance(l));if(best.yieldAt)items+=part/best.xp*best.yieldAt(l)}}
      xp=xpAtT(to);
      // an unlock that does not change the best choice just extends the stretch before it
      const last=rows[rows.length-1];
      if(last&&last.best===best){last.to=to;last.succ+=succ;last.tries+=Math.round(tries);last.items+=items}else rows.push({from,to,best,succ,tries:Math.round(tries),items});
    }
    return rows;
  }
  function mats(rows){const m=new Map();for(const r of rows)for(const i of r.best.per)m.set(i.id,(m.get(i.id)||0)+i.quantity*r.tries);return m}

  function skillsList(){
    const crafts=[...new Set((typeof RECIPES!=='undefined'?RECIPES:[]).filter(r=>!r.split).map(r=>r.skill))].sort();   // Smelting is not a skill of its own
    const gathers=[...new Set((typeof GATHERABLES!=='undefined'?GATHERABLES:[]).map(g=>g.skill))].sort();
    return [...crafts.map(s=>({value:s,mode:'craft',label:s+(gathers.includes(s.toLowerCase())?' (making)':'')})),...gathers.map(s=>({value:pretty(s),mode:'gather',label:pretty(s)+' (gathering)'}))];
  }

  // Gather rates level by level for the best node at each level: chance, items per success, and per hour at the
  // node's own pace (attempts back to back; walking between nodes and waiting for them to come back not counted).
  function gatherRatesHtml(opts,level,goal){
    const last=Math.min(100,Math.max(goal,level+10)),step=last-level>30?5:1,rows=[];
    for(let l=level;l<=last;l+=step){
      const ok=opts.filter(o=>o.level<=l);if(!ok.length)continue;
      const o=ok.reduce((a,b)=>b.xp*b.chance(l)>a.xp*a.chance(l)?b:a),c=o.chance(l),y=o.yieldAt(l),per=o.ms?3600000/o.ms:null;
      rows.push([n(l),item(o.id,o.label),pct(c),y.toFixed(2),(c*y).toFixed(2),per?n(per*c*y):'—',per?n(per*c*o.xp):'—']);
    }
    return `<section><h2>Gather rates by level</h2>${table(['Level','Best node','Success','Items per success','Items per attempt','Items per hour','XP per hour'],rows)}<p class="g-note">Items per success grow 10% for every level past mastery (9 levels above the node), a tool past 95% adds its overflow, and Prospector rings add 2% per carat. Per hour means gathering back to back at the node’s pace (3.5 s an attempt, 2 s for plants), not counting walking or waiting for nodes to come back; fishing spots run dry after a few catches.</p></section>`;
  }
  // Gathering training path: level by level, the node that pays the most XP per attempt with your tool (and, on
  // "Best for my level", the best tool you can hold by then), sticking with the node you are on while it is within
  // 10% of the best. Time is attempts back to back at the node's pace; items include Prospector's extra yield.
  function gatherPath(skill,level,into,goal,sel,qual,carat,pros){
    const to=Math.min(100,Math.max(goal,level+10)),out=[];
    for(let l=level;l<to;l++){
      const ti=toolIdx(sel,l),usable=l>=TOOL[ti][3],tb=usable?toolBonus(TOOL[ti][0],qual,Math.min(ti+1,carat)):0;
      const opts=optionsFor(skill,'gather',tb,pros).filter(o=>o.level<=l);if(!opts.length)continue;
      const sc=o=>o.xp*o.chance(l);let best=opts.reduce((a,b)=>sc(b)>sc(a)?b:a);
      const last=out[out.length-1],same=last&&opts.find(o=>o.id===last.node.id);
      if(same&&sc(same)>=.9*sc(best))best=same;
      const c=best.chance(l);if(!(c>0))continue;
      const need=xpAtT(l+1)-xpAtT(l)-(l===level?into:0),tries=need/(best.xp*c),items=tries*c*best.yieldAt(l),secs=best.ms?tries*best.ms/1000:null;
      const perHr=best.ms?3600000/best.ms:null,xpHr=perHr?perHr*c*best.xp:null,itHr=perHr?perHr*c*best.yieldAt(l):null;
      if(last&&last.node.id===best.id&&last.ti===ti){last.to=l;last.tries+=tries;last.items+=items;last.secs=last.secs!=null&&secs!=null?last.secs+secs:null;last.cEnd=c;last.xpHrEnd=xpHr;last.itHrEnd=itHr}
      else out.push({from:l,to:l,node:best,ti,usable,tb,tries,items,secs,cStart:c,cEnd:c,xpHrStart:xpHr,xpHrEnd:xpHr,itHrStart:itHr,itHrEnd:itHr});
    }
    return out;
  }
  const dur=s=>s==null?'—':s>=5400?(s/3600).toFixed(1)+' h':Math.max(1,Math.round(s/60))+' min';
  const range=(a,b,f)=>a==null?'—':(b!=null&&Math.abs(b-a)>=(f===pct?.005:1)?f(a)+' → '+f(b):f(a));
  // Upgrades worth making at your level: the next metal, one more Artisan carat, more Prospector carats - each
  // scored on the best node for you, as XP and items an hour. 4-carat gems are very rare, so they are marked, and
  // Prospector is counted over both ring slots (a ring holds 1 carat on iron up to 4 on titanium).
  // The best tool smith's level: what you typed, else (in the app) your own Tool Smithing, else unknown
  // The best smith: the level you typed, else the top of the game's leaderboard (the app reads binxonia.com's
  // leaderboards with your website login; the public Atlas gets the top levels with its data), else (in the app)
  // your own level, else unknown ("a smith 10 levels over it").
  let lbTops=null,lbLoading=null;
  function loadTops(){
    if(lbTops)return Promise.resolve(lbTops);
    const pub=globalThis.BINXONIA_COLLECTOR_SNAPSHOT&&globalThis.BINXONIA_COLLECTOR_SNAPSHOT.leaderboardTops;
    if(pub&&pub.levels){lbTops={at:pub.at,levels:pub.levels};return Promise.resolve(lbTops)}
    if(globalThis.BXC_PUBLIC||typeof chrome==='undefined'||!chrome.runtime||!chrome.runtime.sendMessage)return Promise.resolve(null);
    return lbLoading||=Promise.resolve(chrome.runtime.sendMessage({cmd:'leaderboard-tops'})).then(r=>{
      if(r&&r.boards)lbTops={at:r.at,levels:Object.fromEntries(Object.entries(r.boards).map(([k,v])=>[k,v.level])),loginNeeded:!!r.loginNeeded};return lbTops}).catch(()=>null).finally(()=>{lbLoading=null});
  }
  const lbTop=skill=>{const l=lbTops&&lbTops.levels&&lbTops.levels[slug(skill)];return Number.isFinite(+l)&&+l>0?+l:null};
  function bestSmith(skill,typed){const t=Math.floor(+typed||0);if(t>0)return {lv:t,src:'typed',skill};const top=lbTop(skill);if(top)return {lv:top,src:'top',skill};
    const own=globalThis.bxcSkillLevel?globalThis.bxcSkillLevel(skill):null;return own?{lv:own,src:'yours',skill}:null}
  const smithWho=sm=>!sm?'from a smith 10 levels over it':sm.src==='typed'?`with the best smith’s ${sm.skill} ${sm.lv}`:sm.src==='top'?`with the leaderboard’s top ${sm.skill} ${sm.lv}`:`with your ${sm.skill} ${sm.lv}`;
  const smithPlaceholder=skill=>{const t=lbTop(skill);if(t)return `top (${t})`;const own=globalThis.bxcSkillLevel?globalThis.bxcSkillLevel(skill):null;return own?`yours (${own})`:globalThis.BXC_PUBLIC?'level':'yours'};
  const SMITH_TITLE=skill=>`The highest ${skill} level of anyone who makes them - it decides how often good quality comes out. Empty: the top of the game's leaderboard${globalThis.BXC_PUBLIC?'':' (or yours)'}.`;
  const smithLevel=v=>bestSmith('Tool Smithing',v);
  const toolRecipeLevel=(skill,t)=>{const id=(t?TOOL[t][0]+'-':'')+slug(toolFor(skill)||'');   // iron tools have no "iron-" (the game's ids)
const r=(typeof RECIPES!=='undefined'?RECIPES:[]).find(x=>x.id===id);return r?r.level:null};
  function gatherUpgradesHtml(skill,level,sel,qual,carat,pros,smithIn){
    const ti=toolIdx(sel,level),c0=Math.min(ti+1,carat),qi=Math.max(0,QUALITIES.findIndex(q=>q[0]===qual));
    const rate=(t,q,c,p)=>{const tb=level>=TOOL[t][3]?toolBonus(TOOL[t][0],q,Math.min(t+1,c)):0,opts=optionsFor(skill,'gather',tb,p).filter(o=>o.level<=level);if(!opts.length)return null;
      const o=opts.reduce((a,b)=>b.xp*b.chance(level)>a.xp*a.chance(level)?b:a),ch=o.chance(level),per=o.ms?3600000/o.ms:null;
      return per?{xp:per*ch*o.xp,it:per*ch*o.yieldAt(level),node:o,tb}:null};
    const now=rate(ti,qual,c0,pros);if(!now)return '';
    const tname=(toolFor(skill)||'tool').toLowerCase(),ups=[];
    // a tool, spelled out: metal, quality and Artisan carats
    const spec=(t,q,c)=>`${TOOL[t][1]} ${tname} · ${pretty(q)}${c?` · Artisan ${c}c`:' · no enchant'}`;
    // how often a quality comes out of the forge (the game's crafting-quality odds, for a smith 10 levels over the tool);
    // under 10% is very rare - excellent, superior and flawless - so it is not what to plan on
    // the odds come from the best smith's Tool Smithing over the tool's recipe (unknown: assume 10 levels over)
    const sm=smithLevel(smithIn),over=t=>{const rl=toolRecipeLevel(skill,t);return rl==null?10:sm?sm.lv-rl:10};
    const qOdds=(q,t=ti)=>{if(typeof interpolateCraftQuality!=='function')return null;const o=over(t);return o<0?0:(interpolateCraftQuality(Math.min(30,o))[q]||0)};
    const qRare=(q,t=ti)=>{const o=qOdds(q,t);return o!=null&&QUALITIES.findIndex(x=>x[0]===q)>3&&o<.10};
    const oddsTxt=o=>o<.005?'almost never':'about '+(o*100).toFixed(o<.1?1:0)+'%';
    const smithTxt=t=>smithWho(sm);
    const qNote=(q,t=ti)=>{if(!qRare(q,t))return '';const o=qOdds(q,t),m=TOOL[t][1].toLowerCase();
      return `${pretty(q)} is ${oddsRarity(o)}: ${o<.005?`${/^[aeiou]/.test(m)?"an":"a"} ${m} ${tname} almost never comes out ${q}`:`about ${(o*100).toFixed(o<.1?1:0)}% of ${m} ${tname}s come out ${q}`} ${smithTxt(t)}`};
    // the best quality a smith realistically turns out for a metal (not very rare), at least ordinary
    const realQ=t=>{for(let k=QUALITIES.length-1;k>3;k--)if(!qRare(QUALITIES[k][0],t))return QUALITIES[k][0];return 'ordinary'};
    const cantMake=t=>{const rl=toolRecipeLevel(skill,t);return sm&&rl!=null&&sm.lv<rl?`no one can make it yet: needs Tool Smithing ${rl} (best is ${sm.lv})`:''};
    const add=(label,r,note)=>{if(!r)return;const dx=r.xp/now.xp-1,di=r.it/now.it-1;if(dx>.004||di>.004)ups.push({label,dx,di,note,score:dx+di*.5})};
    // the metal you could hold at this level, and the next one after it
    const topT=bestToolAt(level),nt=TOOL.findIndex((t,k)=>k>ti);
    for(let t=ti+1;t<=topT;t++){const c=Math.min(t+1,Math.max(c0,Math.min(3,t+1)));
      const qn=realQ(t);
      add(spec(t,qn,c0),rate(t,qn,c0,pros),cantMake(t)||(qn!==qual?`a new tool: ${pretty(qn)} is the most to expect ${smithTxt(t)}${c0?'; it needs its own Artisan enchant':''}`:(c0?'a new tool needs its own Artisan enchant':'')));
      if(c>c0)add(spec(t,qn,c),rate(t,qn,c,pros),cantMake(t)||(caratNote(c,'tools')))}
    if(nt>0&&nt>topT)ups.push({label:spec(nt,qual,c0),future:TOOL[nt][3]});
    // better quality on the tool you have (10% of the quality's value is added to success)
    for(const qn of [QUALITIES[qi+1]&&QUALITIES[qi+1][0],'flawless'])if(qn&&QUALITIES.findIndex(q=>q[0]===qn)>qi&&!ups.some(u=>u.q===qn)){const before=ups.length;add(spec(ti,qn,c0),rate(ti,qn,c0,pros),qNote(qn));if(ups.length>before)ups[ups.length-1].q=qn}
    // one more Artisan carat on the tool you have
    if(c0<ti+1)add(spec(ti,qual,c0+1),rate(ti,qual,c0+1,pros),caratNote(c0+1,'tools'));
    else if(c0<4&&nt>0)ups.push({label:`Artisan ${c0+1}c`,info:`needs a ${TOOL[nt][1].toLowerCase()} ${tname} (a ${TOOL[ti][1].toLowerCase()} one holds ${ti+1}c)${c0+1>=4?"; 4-carat tools are very rare":""}`});
    const ringNote=p=>{const hi=Math.ceil(p/2);return hi>=3?'needs a '+caratNote(hi,'ring').replace(/-carat ring are /,'-carat ring: '):''};
    if(pros<8){const p1=pros+1;add(`Prospector ${p1} carat${p1>1?'s':''} in total`,rate(ti,qual,c0,p1),ringNote(p1)||(pros===0?'one amber ring':''));
      const p2=Math.min(4,pros+2);if(p2>p1)add(`Prospector ${p2} carats in total`,rate(ti,qual,c0,p2),ringNote(p2))}
    const vr=u=>/very rare|no one can make/.test(u.note||'')?2:/rare|uncommon/.test(u.note||'')?1:0,pr=u=>/^Prospector/.test(u.label);
    ups.sort((a,b)=>(a.future?1:0)-(b.future?1:0)||(a.info?1:0)-(b.info?1:0)||vr(a)-vr(b)||(pr(a)&&pr(b)?a.label.localeCompare(b.label,undefined,{numeric:true}):(b.score||0)-(a.score||0)));
    // what to aim for: the best metal you can hold, flawless, 3 Artisan carats (4 is very rare), 3+3 Prospector
    const aimP=Math.max(pros,4);
    // aim at the best metal a smith can make, in the best quality that is not very rare from them
    let aimT=topT;while(aimT>ti&&cantMake(aimT))aimT--;
    // a new metal starts from what a smith realistically makes; on the tool you have, keep your quality if it is better
    const rq=realQ(aimT),aimQ=aimT!==ti?rq:(QUALITIES.findIndex(x=>x[0]===rq)>qi?rq:qual);
    const aim=rate(aimT,aimQ,Math.max(c0,Math.min(aimT+1,2)),aimP);
    const pctp=v=>v>.004?'+'+(v*100).toFixed(v<.1?1:0)+'%':'—';
    const aimLine=aim&&(aim.xp/now.xp-1>.004||aim.it/now.it-1>.004)?`<p class="tool-answer"><b>Aim for:</b> ${esc(spec(aimT,aimQ,Math.max(c0,Math.min(aimT+1,2))))}${aimP>pros?` and Prospector ${aimP}c (two 2-carat rings)`:''}: ${[aim.xp/now.xp-1>.004?pctp(aim.xp/now.xp-1)+" XP":"",aim.it/now.it-1>.004?pctp(aim.it/now.it-1)+" items":""].filter(Boolean).join(" and ")} an hour over what you have.</p>`:`<p class="tool-answer">Your ${esc(tname)} is as good as it realistically gets at level ${level}.</p>`;
    const nowLine=`<p class="g-note">You now: ${esc(spec(ti,qual,c0))}${pros?`, Prospector ${pros}c`:''} (+${(now.tb*100).toFixed(1).replace(/[.]0$/,'')}% success), on ${esc(now.node.label)}.</p>`;
    if(!ups.length)return `<h3>Upgrades worth making at level ${level}</h3>`+nowLine+aimLine;
    return `<h3>Upgrades worth making at level ${level}</h3>`+nowLine+aimLine+table(['Upgrade','XP / hour','Items / hour','Note'],ups.map(u=>u.future?[esc(u.label),'—','—',`usable from level ${u.future}`]:u.info?[esc(u.label),'—','—',esc(u.info)]:[esc(u.label),pctp(u.dx),pctp(u.di),u.note?(/rare|uncommon/.test(u.note)&&globalThis.bxcRarityChip?globalThis.bxcRarityChip(esc(u.note)):`<span class="muted">${esc(u.note)}</span>`):'']))+
      `<p class="g-note">Success is capped at 95%: once a tool gets you there, more metal, quality or Artisan only adds to the haul, not XP. Quality adds a tenth of its value to success (flawless about +3.8%); how often each quality comes out depends on how far the best smith is over the tool’s recipe (${esc(smithTxt(ti))}${sm?'':', assumed'}), and anything under 10% is marked very rare and left out of “Aim for”. Prospector adds 2% haul a carat and no XP. The gem combiner makes up to 2 carats, so plans count on 2-carat gems and rings; 3 carats are rare and 4 very rare.</p>`;
  }
  function gatherPathHtml(skill,path,sel,level,goal,bare){
    if(!path.length)return '';
    const wrap=h=>bare?h:`<section><h2>Training path</h2>${h}</section>`;
    const tname=(toolFor(skill)||'tool').toLowerCase();
    const betterAt=sel==='best'?null:TOOL.findIndex((t,k)=>k>toolIdx(sel,level)&&t[3]>level&&t[3]<Math.max(goal,level+10));
    return wrap(`<p class="g-note">What to gather at each level with ${sel==='best'?'the best '+esc(tname)+' you can use by then':'your '+esc(tname)}, when to move on, and how long it takes back to back. It stays on a node until another pays at least 10% more XP per attempt.</p>`+
      table(['Levels','Gather','Tool','Success','XP / hour','Items / hour','Time','You’ll gather'],path.map((p,i)=>{const prev=path[i-1],nx=path[i+1];
        return [`<b>${p.from===p.to?p.from:p.from+'–'+p.to}</b>${p.from>=goal?' <span class="muted">(past goal)</span>':''}`,
          item(p.node.id,p.node.label)+(nx&&nx.node.id!==p.node.id?`<div class="muted" style="font-size:11px">switch at ${nx.from}</div>`:''),
          `${esc(TOOL[p.ti][1])} +${(p.tb*100).toFixed(1).replace(/\.0$/,'')}%${prev&&prev.ti!==p.ti?' <span class="tag-chip weak">new tool</span>':''}${p.usable?'':' <span class="muted">(too low to use)</span>'}`,
          range(p.cStart,p.cEnd,pct),range(p.xpHrStart,p.xpHrEnd,n),range(p.itHrStart,p.itHrEnd,n),dur(p.secs),`${n(p.items)}× ${item(p.node.id,p.node.label)}`]}))+
      (betterAt>0?`<p class="note">A ${esc(TOOL[betterAt][1].toLowerCase())} ${esc(tname)} can be used from level ${TOOL[betterAt][3]}: pick “Best for my level” to see the path with it.</p>`:''));
  }
  function renderCraftPlanner(){
    const skills=skillsList();
    let saved={};try{saved=JSON.parse(localStorage.getItem('bxcCraftPlanner')||'{}')}catch{}
    const pick=skills.findIndex(s=>s.label===saved.skill);
    content.innerHTML=`<article class="wp tool-wp"><div class="wp-main">
      <p class="wp-lede">Pick a skill and your level: you’ll see what to make at each step to your goal, how many crafts it takes, and the materials to bring.</p>
      <div class="tool-form">
        <label>Skill<select id="cSkill">${skills.map((s,i)=>`<option value="${esc(s.value)}" data-mode="${s.mode}"${i===(pick<0?0:pick)?' selected':''}>${esc(s.label)}</option>`).join('')}</select></label>
        <label>Your level<input id="cLevel" type="number" min="1" max="100" value="${Number(saved.level)||1}"></label>
        <label>XP into it<input id="cInto" type="number" min="0" value="0"></label>
        <label>Goal level<input id="cTarget" type="number" min="2" max="100" value=""></label>
        <label id="cToolField" hidden><span id="cToolName">Tool</span><select id="cTool">${toolOptions(saved.tool)}</select></label>
        <label id="cQualField" hidden>Quality<select id="cQual">${QUALITIES.map(([k])=>`<option value="${k}"${k===(saved.qual||'ordinary')?' selected':''}>${pretty(k)}</option>`).join('')}</select></label>
        <label id="cCaratField" hidden>Artisan carats<input id="cCarat" type="number" min="0" max="4" step="1" value="${Number(saved.carat)||0}"></label>
        <label id="cSmithField" hidden title="${esc(SMITH_TITLE('Tool Smithing'))}">Best tool smith<input id="cSmith" type="number" min="0" max="100" placeholder="${esc(smithPlaceholder('Tool Smithing'))}" value="${Number(saved.smith)||''}"></label>
        <label id="cProsField" hidden title="Amber rings: +2% gathered yield per carat. Both ring slots count; a ring holds up to 1 carat on iron, 2 silver, 3 gold, 4 titanium.">Prospector carats<input id="cPros" type="number" min="0" max="8" step="1" value="${Number(saved.pros)||0}"></label>
        <div id="cAutoState" class="tool-auto"></div>
      </div>
      <div id="cPlanOut"></div>
    </div><aside class="wp-infobox" id="cPlanAside"></aside></article>`;
    const el=id=>document.getElementById(id);
    let goalTouched=false;
    function run(){
      const opt=el('cSkill').selectedOptions[0],skill=opt.value,mode=opt.dataset.mode;
      const toolName=toolFor(skill);
      for(const id of ['cToolField','cQualField','cCaratField'])el(id).hidden=!toolName;
      el('cToolName').textContent=toolName||'Tool';
      const tsel=el('cTool').value,lvNow=Math.max(1,Math.min(99,Math.floor(+el('cLevel').value||1))),ti=toolIdx(tsel,lvNow);
      el('cCarat').max=tsel==='best'?'4':String(ti+1);if(+el('cCarat').value>+el('cCarat').max)el('cCarat').value=el('cCarat').max;
      const tool=toolName?toolBonus(TOOL[ti][0],el('cQual').value,Math.min(ti+1,+el('cCarat').value||0)):0;
      el('cProsField').hidden=mode!=='gather';el('cSmithField').hidden=mode!=='gather';
      const pros=mode==='gather'?Math.max(0,Math.min(8,Math.floor(+el('cPros').value||0))):0;
      const opts=optionsFor(skill,mode,tool,pros).sort((a,b)=>a.level-b.level);
      const level=Math.max(1,Math.min(99,Math.floor(+el('cLevel').value||1)));
      const into=Math.max(0,Math.min(xpAtT(level+1)-xpAtT(level)-1,Math.floor(+el('cInto').value||0)));
      const next=opts.find(o=>o.level>level);
      // default goal: the first unlock at least 5 levels away (so the plan is worth reading), else 10 levels on
      const aim=opts.find(o=>o.level>=level+5);
      if(!goalTouched)el('cTarget').value=String(aim?aim.level:Math.min(100,level+10));
      const goal=Math.max(level+1,Math.min(100,Math.floor(+el('cTarget').value||level+1)));
      try{localStorage.setItem('bxcCraftPlanner',JSON.stringify({skill:opt.textContent,level,tool:el('cTool').value,qual:el('cQual').value,carat:+el('cCarat').value||0,pros:+el('cPros').value||0,smith:+el('cSmith').value||0}))}catch{}
      const toolLv=TOOL[ti][3],toolLine=toolName?`${tsel==='best'?'Best for level '+level+': ':''}${TOOL[ti][1]} ${toolName.toLowerCase()}${el('cQual').value!=='ordinary'?' ('+el('cQual').value+')':''}${Math.min(ti+1,+el('cCarat').value||0)?' of the Artisan '+Math.min(ti+1,+el('cCarat').value||0)+'c':''}: <b>${tool>=0?'+':''}${(tool*100).toFixed(1).replace(/\.0$/,'')}%</b> ${mode!=='gather'&&skill.toLowerCase()==='cooking'?'less chance to burn':'success'}`:'';
      const rows=plan(opts,level,into,goal),m=mats(rows);
      const totalSucc=rows.reduce((a,r)=>a+r.succ,0),totalTries=rows.reduce((a,r)=>a+r.tries,0);
      const unit=mode==='gather'?'gathers':'crafts';
      const now=opts.filter(o=>o.level<=level).map(o=>({o,c:o.chance(level),e:o.xp*o.chance(level)})).sort((a,b)=>b.e-a.e);
      const coming=opts.filter(o=>o.level>level).slice(0,6);
      const matLine=[...m].map(([id,q])=>`${n(q)}× ${item(id)}`).join(' · ');
      const guideLink=globalThis.bxcGuides?.forSkill(skill)?globalThis.bxcGuides.link(globalThis.bxcGuides.forSkill(skill),skill+' guide'):'';
      el('cPlanOut').innerHTML=
        (toolName&&level<toolLv?`<p class="note">A ${esc(TOOL[ti][1].toLowerCase())} ${esc(toolName.toLowerCase())} needs ${esc(skill)} at ${toolLv}; you can’t use it at level ${level} yet.</p>`:'')+
        `<section><h2>Your plan</h2>${toolLine?`<p class="g-note">With your tool: ${toolLine}.</p>`:''}${rows.length?`<p class="tool-answer">Level <b>${level}</b> → <b>${goal}</b>: about <b>${n(totalSucc)}</b> ${unit}${totalTries>totalSucc?` (<b>${n(totalTries)}</b> attempts with misses)`:''}.</p>`+
          table(['Levels',mode==='gather'?'Gather':'Make','Successes','Attempts',mode==='gather'?'You’ll gather':'Materials'],rows.map(r=>[`${r.from} → ${r.to}`,item(r.best.id,r.best.label),n(r.succ),n(r.tries),mode==='gather'?`${n(r.items)}× ${item(r.best.id,r.best.label)}`:(r.best.per.map(i=>`${n(i.quantity*r.tries)}× ${item(i.id)}`).join(', ')||'—')]))+
          (matLine?`<p class="tool-total"><b>Bring in total:</b> ${matLine}</p>`:'')+
          `<p class="g-note">Each stretch uses whatever gives the most XP per attempt at its start (misses included). It’s the fastest, not always the cheapest.${mode==='gather'?'':' Attempts count failures, which use up the materials.'}</p>`
          :'<p class="muted">Nothing to make yet at this level.</p>'}</section>`+
        `<section><h2>What you can ${mode==='gather'?'gather':'make'} now</h2>${now.length?table(['Level','Item','XP','Success now','XP per attempt',...(mode==='gather'?[]:['Needs'])],now.map(({o,c,e},i)=>[n(o.level),(i===0?'★ ':'')+item(o.id,o.label),n(o.xp),pct(c),e.toFixed(1),...(mode==='gather'?[]:[o.per.map(x=>`${x.quantity}× ${item(x.id)}`).join(', ')||'—'])])):'<p class="muted">Nothing unlocked yet.</p>'}</section>`+
        (mode==='gather'?gatherPathHtml(skill,gatherPath(skill,level,into,goal,tsel,el('cQual').value,+el('cCarat').value||0,pros),tsel,level,goal)+`<section>${gatherUpgradesHtml(skill,level,tsel,el('cQual').value,+el('cCarat').value||0,pros,+el('cSmith').value||0)}</section>`+gatherRatesHtml(opts,level,goal):'')+
        (coming.length?`<section><h2>Coming up</h2>${table(['Level','Item','XP'],coming.map(o=>[n(o.level),item(o.id,o.label),n(o.xp)]))}</section>`:'');
      const best=now[0]?.o;
      el('cPlanAside').innerHTML=`${best?`<div class="wp-pic"><img src="${esc(typeof itemImg==='function'?itemImg({id:best.id,typeId:best.id,item:best.label}):'')}" alt=""></div>`:''}<h3>${esc(opt.textContent)}</h3><table>
        <tr><th>Your level</th><td>${level}</td></tr><tr><th>Goal</th><td>${goal}</td></tr><tr><th>XP to go</th><td>${n(Math.max(0,xpAtT(goal)-xpAtT(level)-into))}</td></tr>
        ${best?`<tr><th>Best now</th><td>${item(best.id,best.label)}</td></tr>`:''}${next?`<tr><th>Next unlock</th><td>${item(next.id,next.label)} at ${next.level}</td></tr>`:''}</table>
        <p class="g-note">${mode==='gather'?'Gathering: 50% at the tier’s level, +5% a level, up to 95%; a better tool adds to it.':'Crafting: 60% at the recipe’s level, 95% fifteen levels above. A failure uses up the materials. Your tool only changes the chance to succeed: the quality you get and when you can enchant (15 levels above the item) depend on your level alone.'}</p>
        <p class="g-aside-h">Guides</p><ul class="g-toc">${guideLink?`<li>${guideLink}</li>`:''}<li><a href="#/guide/levels-and-xp">Levels and XP</a></li>${mode==='gather'?'':'<li><a href="#/calc-quality">Quality &amp; enchanting</a></li>'}</ul>`;
    }
    el('cSkill').addEventListener('change',()=>{goalTouched=false;el('cInto').value='0';run()});
    el('cLevel').addEventListener('input',()=>{goalTouched=false;run()});
    el('cInto').addEventListener('input',run);
    el('cTarget').addEventListener('input',()=>{goalTouched=true;run()});
    for(const id of ['cTool','cQual'])el(id).addEventListener('change',run);
    el('cCarat').addEventListener('input',run);
    el('cPros').addEventListener('input',run);el('cSmith').addEventListener('input',run);
    if(!lbTops)loadTops().then(t=>{if(t&&document.getElementById('cPlanOut')){el('cSmith').placeholder=smithPlaceholder('Tool Smithing');run()}});
    run();
  }
  globalThis.renderCraftPlanner=renderCraftPlanner;
  {const GQ=globalThis.BXC_GAME_DATA?.quality;if(GQ)QUALITIES.forEach(q=>{if(Number.isFinite(GQ[q[0]]))q[1]=GQ[q[0]]})}
  // ---- The tool box on the skill guides: your level and tool -> what each tier / recipe gives you --------------------
  // Shares the planner's saved tool (bxcCraftPlanner), so picking it in either place carries over.
  const savedTool=()=>{try{return JSON.parse(localStorage.getItem('bxcCraftPlanner')||'{}')}catch{return {}}};
  function guideToolBox(kind,skill,level){
    const s=savedTool(),toolName=toolFor(skill);if(!toolName)return '';
    const lv=level||Number((s.guideLevel||{})[skill])||1;
    return `<div class="g-tool" data-kind="${kind}" data-skill="${esc(skill)}"><div class="tool-form">
      <label>Your level<input type="number" min="1" max="100" data-f="level" value="${lv}"></label>
      <label>${esc(toolName)}<select data-f="tool">${toolOptions(s.tool)}</select></label>
      <label>Quality<select data-f="qual">${QUALITIES.map(([k])=>`<option value="${k}"${k===(s.qual||'ordinary')?' selected':''}>${pretty(k)}</option>`).join('')}</select></label>
      <label>Artisan carats<input type="number" min="0" max="4" data-f="carat" value="${Number(s.carat)||0}"></label>
      ${kind==='gather'?`<label>Prospector carats<input type="number" min="0" max="8" data-f="pros" value="${Number(s.pros)||0}"></label><label title="${esc(SMITH_TITLE('Tool Smithing'))}">Best tool smith<input type="number" min="0" max="100" data-f="smith" placeholder="${esc(smithPlaceholder('Tool Smithing'))}" value="${Number(s.smith)||''}"></label>`:''}
    </div><div class="g-tool-out">${guideToolOut(kind,skill,{level:lv,tool:s.tool,qual:s.qual,carat:s.carat,pros:s.pros})}</div></div>`;
  }
  function guideToolOut(kind,skill,v){
    const level=Math.max(1,Math.min(100,Math.floor(+v.level||1))),ti=toolIdx(v.tool,level);
    const carat=Math.max(0,Math.min(ti+1,Math.floor(+v.carat||0))),bonus=toolBonus(TOOL[ti][0],v.qual||'ordinary',carat),pros=Math.max(0,Math.min(8,Math.floor(+v.pros||0)));
    const canUse=level>=TOOL[ti][3];
    const head=`<p class="g-note">With your ${esc(TOOL[ti][1].toLowerCase())} ${esc(toolFor(skill).toLowerCase())}: <b>${bonus>=0?'+':''}${(bonus*100).toFixed(1).replace(/\.0$/,'')}%</b>${kind==='gather'&&pros?` and +${pros*2}% yield from Prospector`:''}.${canUse?'':` <b>You can’t use it until ${esc(skill)} ${TOOL[ti][3]}.</b>`}</p>`;
    if(kind==='gather'){
      const gs=(typeof GATHERABLES!=='undefined'?GATHERABLES:[]).filter(g=>g.skill===String(skill).toLowerCase()).sort((a,b)=>a.level-b.level);
      const rows=gs.map(g=>{const md=gatherModel(g,canUse?bonus:0,pros),c=md.chance(level),y=md.yieldAt(level),per=md.ms?3600000/md.ms:null;
        return level<g.level?[item(slug(g.item),g.item),n(g.level),'<span class="muted">needs '+g.level+'</span>','—','—','—']
          :[item(slug(g.item),g.item),n(g.level),pct(c),y.toFixed(2),(c*y).toFixed(2),per?n(per*c*y):'—']});
      return head+table(['Tier','Level','Success','Items per success','Items per attempt','Items per hour'],rows)+'<p class="g-note">Per hour is gathering back to back at the node’s pace, not counting walking or waiting for nodes to come back.</p>';
    }
    const opts=optionsFor(skill,'craft',canUse?bonus:0).filter(o=>o.level<=level).sort((a,b)=>b.level-a.level).slice(0,12);
    if(!opts.length)return head+'<p class="muted">Nothing to make at this level yet.</p>';
    return head+table(['Recipe','Level','Success','Attempts per success'],opts.map(o=>{const c=o.chance(level);return [item(o.id,o.label),n(o.level),pct(c),c>0?(1/c).toFixed(2):'—']}))+'<p class="g-note">The 12 highest recipes you can make at this level.</p>';
  }
  globalThis.bxcGuideToolBox=(...a)=>{
    // the first box drawn fetches the leaderboard tops, then redraws the boxes on the page with them
    if(!lbTops)loadTops().then(t=>{if(t)for(const b of document.querySelectorAll('.g-tool')){const i=b.querySelector('[data-f=smith]');if(i)i.placeholder=smithPlaceholder('Tool Smithing');reToolBox(b)}});
    return guideToolBox(...a)};
  // "Fastest way to level" on a skill guide, from the tool box's level, tool and carats to level 100
  function guidePathOut(kind,skill,v){
    const level=Math.max(1,Math.min(99,Math.floor(+v.level||1))),sel=v.tool||'iron',qual=v.qual||'ordinary',carat=Math.max(0,Math.floor(+v.carat||0)),pros=Math.max(0,Math.min(8,Math.floor(+v.pros||0)));
    if(kind==='gather'){const p=gatherPath(skill,level,0,100,sel,qual,carat,pros);return p.length?gatherUpgradesHtml(skill,level,sel,qual,carat,pros,v.smith)+'<h3>Level by level</h3>'+gatherPathHtml(skill,p,sel,level,100,true):'<p class="muted">Nothing to gather at this level.</p>'}
    const ti=toolIdx(sel,level),usable=level>=TOOL[ti][3],tb=usable?toolBonus(TOOL[ti][0],qual,Math.min(ti+1,carat)):0;
    const rows=plan(optionsFor(skill,'craft',tb),level,0,100);if(!rows.length)return '<p class="muted">Nothing to make at this level yet.</p>';
    return `<p class="g-note">From level ${level} with your ${esc(TOOL[ti][1].toLowerCase())} ${esc((toolFor(skill)||'tool').toLowerCase())} (${tb>=0?'+':''}${(tb*100).toFixed(1).replace(/[.]0$/,'')}%): the recipe with the most XP per attempt at each stretch. It is the quickest, not always the cheapest.</p>`+
      table(['Levels','Make','Successes','Attempts','Materials'],rows.map(r=>[`${r.from} → ${r.to}`,item(r.best.id,r.best.label),n(r.succ),n(r.tries),r.best.per.map(i=>`${n(i.quantity*r.tries)}× ${item(i.id)}`).join(', ')||'—']))+'<p class="g-note">Materials are for every attempt: a failed one uses them up too.</p>';
  }
  globalThis.bxcGuidePath=(kind,skill)=>{const s=savedTool(),lv=Number((s.guideLevel||{})[skill])||1;
    return `<div class="g-path-out" data-kind="${kind}" data-skill="${esc(skill)}">${guidePathOut(kind,skill,{...s,level:lv})}</div>`};
  const reToolBox=box=>{const v={};box.querySelectorAll('[data-f]').forEach(el=>v[el.dataset.f]=el.value);
    const s=savedTool();s.tool=v.tool;s.qual=v.qual;s.carat=+v.carat||0;if(v.pros!=null)s.pros=+v.pros||0;if(v.smith!=null)s.smith=+v.smith||0;s.guideLevel={...(s.guideLevel||{}),[box.dataset.skill]:+v.level||1};
    try{localStorage.setItem('bxcCraftPlanner',JSON.stringify(s))}catch{}
    box.querySelector('.g-tool-out').innerHTML=guideToolOut(box.dataset.kind,box.dataset.skill,v);
    for(const out of document.querySelectorAll('.g-path-out'))if(out.dataset.skill===box.dataset.skill)out.innerHTML=guidePathOut(out.dataset.kind,out.dataset.skill,v)};
  document.addEventListener('input',e=>{const box=e.target.closest('.g-tool');if(box)reToolBox(box)});
  document.addEventListener('change',e=>{const box=e.target.closest('.g-tool');if(box)reToolBox(box)});

  // ---- Combat planner (Calculators > Combat calculator) ------------------------------------------------------------
  // Weapon and magic skills are trained by the damage you deal, not by kills: an Ogre Butcher is worth 2,150
  // character XP but about 250 sword XP. The game's files hold no formula for that, so the XP a skill gets per kill
  // of each monster is measured from your own fights: the skill's recorded XP (it is reported every few seconds in a
  // fight) between one kill and the next, credited to the monster that died. Character level uses kill XP, which is
  // the game's own number (50 × the monster's level, elites 3×), or what your kills actually gave.
  // Field ids (cmbSkill, cmbLevel, cmbInto, cmbAutoState) are the ones atlas-live.js fills from your character.
  const curveOf=skill=>skill==='Character'?(globalThis.BXC_CHARACTER_XP||[]):(typeof COMBAT_XP!=='undefined'?COMBAT_XP:[]);
  const xpOn=(curve,l)=>curve[Math.max(1,Math.min(curve.length,l))-1]||0;
  let measureCache={snap:null,map:new Map()};
  // skill id ('sword', 'fire', or 'character') -> Map(monster name lower -> {name, xs:[xp per kill]})
  function measuredPerKill(skillId){
    const S=globalThis.BINXONIA_COLLECTOR_SNAPSHOT||{};
    if(measureCache.snap!==S)measureCache={snap:S,map:new Map()};
    if(measureCache.map.has(skillId))return measureCache.map.get(skillId);
    const out=new Map(),add=(name,x)=>{const k=String(name||'').toLowerCase();if(!k||!(x>0))return;const r=out.get(k)||out.set(k,{name,xs:[]}).get(k);r.xs.push(x)};
    const kills=(S.exp||[]).filter(e=>(e.sourceKind||e.source?.kind)==='kill'&&e.source?.enemyName);
    if(skillId==='character'){for(const e of kills)add(e.source.enemyName,Number(e.amount));}
    else{
      const bySess=new Map();
      for(const o of S.skillObservations||[])if(o.skill===skillId&&Number.isFinite(+o.experience)&&Number.isFinite(+o.time))(bySess.get(o.sessionId)||bySess.set(o.sessionId,[]).get(o.sessionId)).push(o);
      const killsBy=new Map();for(const e of kills)(killsBy.get(e.sessionId)||killsBy.set(e.sessionId,[]).get(e.sessionId)).push(e);
      for(const [sid,obs] of bySess){
        const ks=(killsBy.get(sid)||[]).slice().sort((a,b)=>a.time-b.time);if(ks.length<2)continue;
        obs.sort((a,b)=>a.time-b.time);const ts=obs.map(o=>+o.time);
        const lastAt=t=>{let lo=0,hi=ts.length;while(lo<hi){const m=(lo+hi)>>1;if(ts[m]<=t)lo=m+1;else hi=m}return lo-1};   // index of the last report at or before t
        for(let i=1;i<ks.length;i++){
          const a=ks[i-1],b=ks[i];if(b.time-a.time>90000)continue;   // only kills in one stretch of fighting
          const ia=lastAt(a.time+1500),ib=lastAt(b.time+1500);if(ia<0||ib<=ia)continue;   // the skill must have been used in between
          add(b.source.enemyName,+obs[ib].experience-+obs[ia].experience);
        }
      }
    }
    for(const r of out.values()){const s=r.xs.slice().sort((a,b)=>a-b);r.n=s.length;r.median=s[s.length>>1]}
    measureCache.map.set(skillId,out);return out;
  }
  const monsterByName=name=>(typeof D!=='undefined'?D.catalog||[]:[]).find(m=>String(m.name).toLowerCase()===String(name).toLowerCase());
  const monImg=m=>typeof monsterImg==='function'&&m?monsterImg(m):'';
  const mon=(m,name)=>m?`<a href="#/monster/${encodeURIComponent(m.typeId)}"><img class="g-ico" src="${esc(monImg(m))}" alt="">${esc(m.name)}</a>`:esc(name);

  // ---- Your weapon against each monster --------------------------------------------------------------------------
  // Damage per hit is the game's own formula (its rules file): (roll × (1 + material bonus) × quality + average roll ×
  // 22% per Destruction carat) × the weapon's multiplier; an elemental enchant adds 22% per carat of the average roll as
  // that element. Weak ×1.3 / resist ×0.7 per damage type. Crits: 4% + 0.1% per DEX (+10% with a dagger), up to 50%,
  // ×1.8. Chance to hit is worked out by the server, so it comes from what the server told you: the collector keeps a
  // tally of the "% to hit" of your attacks per monster and character level; without one it is estimated from your
  // attacks at the same level gap (or, with none at all, a curve read off recorded attacks - marked "est.").
  const MAT_BONUS=[0,1/4.5,3/4.5,6/4.5,16/4.5],PER_CARAT=1/4.5;
  const W_SKILL={'short-sword':'sword','long-sword':'sword',scimitar:'sword',rapier:'sword',kryss:'dagger',dagger:'dagger','short-bow':'bow','long-bow':'bow',crossbow:'crossbow',mace:'mace','war-mace':'mace',spear:'spear','battle-spear':'spear'};
  const W_TYPE=w=>w==='rapier'?'stab':/mace/.test(w)?'crush':/dagger|kryss|spear|crossbow/.test(w)?'stab':'slash';
  const METALS=['Iron','Silver','Gold','Titanium'],WOODS=['Pine','Oak','Black walnut','Shagbark'];
  const METAL_IDS=['iron','silver','gold','titanium'],WOOD_IDS=['pine','oak','black-walnut','shagbark'];
  // rings that change a fight, with their effect per carat (read from the game's own ring text at 4 carats)
  const RINGS=[['','No ring'],['brawler','Brawler (melee damage)'],['hunter','Hunter (bow damage)'],['duelist','Duelist (crit chance)'],['reaper','Reaper (vs low health)'],['adept','Adept (spell damage)']];
  const ringsFor=(cls,w)=>{const own=isSpell(w)||(!w&&cls==='mage')?['adept']:/bow$/.test(w||'')?['hunter']:w?['brawler']:cls==='archer'?['hunter']:['brawler'];   // by the weapon (an archer's dagger is melee), by the class when none is picked
    const mage=own.includes('adept');   // spells do not crit here, so Duelist would add nothing for a mage
    return RINGS.filter(([k])=>!k||(k==='duelist'&&!mage)||k==='reaper'||own.includes(k))};
  // the ring boxes offer only those; a ring that no longer fits is taken off
  function setRingOpts(ids,cls,w){const list=ringsFor(cls,w);for(const id of ids){const b=document.getElementById(id);if(!b)continue;const cur=b.value;
    b.innerHTML=list.map(([k,l])=>`<option value="${k}">${esc(l)}</option>`).join('');b.value=list.some(([k])=>k===cur)?cur:''}}
  // a ring's bonus at its carats, as the game's ring text says it ("Brawler: 5% more melee damage dealt" at 3 carats)
  const ringPct=(b,c)=>{c=Math.max(0,Math.min(4,Math.round(+c||0)));if(!c)return 0;const r=(globalThis.BXC_GAME_DATA?.rings||[]).find(x=>x.bonus===b),t=r&&r.text&&r.text[c],m=t&&String(t).match(/(\d+(?:\.\d+)?)%/);const fb={brawler:1.5,hunter:1.5,duelist:.75,reaper:4};return (m?+m[1]:(fb[b]||0)*c)/100};
  // an equipped item id -> the weapon it is ("titanium-battlespear" -> battle-spear, titanium)
  function weaponFromItem(typeId){
    const id=String(typeId||'');let tier=0;
    for(const [list] of [[METAL_IDS],[WOOD_IDS]])list.forEach((m,i)=>{if(id.startsWith(m+'-'))tier=i+1});
    const w=/battlespear/.test(id)?'battle-spear':/spear/.test(id)?'spear':/warmace/.test(id)?'war-mace':/mace/.test(id)?'mace':/longsword/.test(id)?'long-sword':/scimitar/.test(id)?'scimitar':/rapier/.test(id)?'rapier':/kryss/.test(id)?'kryss':/dagger/.test(id)?'dagger':/crossbow/.test(id)?'crossbow':/longbow/.test(id)?'long-bow':/bow/.test(id)?'short-bow':/sword/.test(id)?'short-sword':null;
    return w?{weapon:w,tier}:null;
  }
  const ENCH_OF={'of-destruction':'destruction','of-flame':'burn','of-freezing':'freeze','of-storm':'shock','of-corrosion':'corrode','of-seeking':'seeking'};
  const ELEMENTS=[['','No enchant'],['destruction','of Destruction (damage)'],['burn','of the Flame (burn)'],['freeze','of Freezing (freeze)'],['shock','of the Storm (shock)'],['corrode','of Corrosion (corrode)'],['seeking','of Seeking (bows: to-hit)']];
  const HIT_CURVE=[[-12,10],[-9,30],[-8,50],[-6,65],[-4,70],[-3,75],[-1,77.5],[0,80],[6,95]];   // from recorded attacks, your level minus theirs
  const curveHit=gap=>{if(gap<=HIT_CURVE[0][0])return HIT_CURVE[0][1];for(let i=1;i<HIT_CURVE.length;i++){const [a,va]=HIT_CURVE[i-1],[b,vb]=HIT_CURVE[i];if(gap<=b)return va+(vb-va)*(gap-a)/(b-a)}return 95};
  let hitCache=null;
  async function loadHits(){if(hitCache)return hitCache;hitCache={};try{if(!globalThis.BXC_PUBLIC&&typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.sendMessage){const r=await chrome.runtime.sendMessage({cmd:'hit-chances'});if(r&&r.stats)hitCache=r.stats}}catch(_){}return hitCache}
  function hitFor(name,level,monLevel,stats){
    const nm=String(name).toLowerCase(),rows=Object.entries(stats||{}).map(([k,v])=>{const i=k.lastIndexOf('|');return {n:k.slice(0,i),lv:+k.slice(i+1),c:v.sum/v.n,k:v.n}});
    const own=rows.filter(r=>r.n===nm&&r.k>=3).sort((a,b)=>Math.abs(a.lv-level)-Math.abs(b.lv-level))[0];
    if(own&&Math.abs(own.lv-level)<=2)return {c:own.c/100,src:'yours ('+own.k+')'};
    // same level gap, other monsters
    const cat=typeof D!=='undefined'?D.catalog||[]:[],lvOf=n=>{const m=cat.find(x=>String(x.name).toLowerCase()===n);return m?m.baseLevel:null};
    const gap=level-monLevel,near=rows.filter(r=>r.k>=3).map(r=>({...r,g:r.lv-(lvOf(r.n)??r.lv)})).filter(r=>Math.abs(r.g-gap)<=1);
    if(near.length){const t=near.reduce((a,r)=>a+r.c*r.k,0)/near.reduce((a,r)=>a+r.k,0);return {c:t/100,src:'est.'}}
    return {c:curveHit(gap)/100,src:'est.'};
  }
  function monsterUsualLevel(m){
    const S=globalThis.BINXONIA_COLLECTOR_SNAPSHOT;const cnt=new Map();
    for(const n of (S&&S.npcs)||[])if(n.typeId===m.typeId&&Number.isFinite(n.level))cnt.set(n.level,(cnt.get(n.level)||0)+1);
    return cnt.size?[...cnt].sort((a,b)=>b[1]-a[1])[0][0]:m.baseLevel;
  }
  function monsterAt(m,L){
    const GL=globalThis.BXC_GAME_DATA?.monsterLevels;
    if(L===m.baseLevel||!GL)return {hp:m.maxHp,xp:m.xp,dmg:m.attackDamage};
    const dm=GL.damage&&(GL.damage[m.archetype||'soft']||Object.values(GL.damage)[0]);
    return {hp:GL.hp[L-1],xp:GL.xp[L-1],dmg:dm?dm[L-1]:null};
  }
  const list=s=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean);
  // the game's rule: resist is checked first (x0.7), then weak (x1.3)
  function typeMult(m,type){return list(m.resists).includes(type)?.7:list(m.weakTo).includes(type)?1.3:1}
  // Kill XP by level gap (binxonia.com news, 29 Sep 2026: "Full kill exp now reaches three levels below you"; 26 Sep:
  // it "reaches zero at ten"). The server applies it; in between it is taken as a straight line.
  const KILL_XP_FULL_BELOW=3,KILL_XP_ZERO_BELOW=10;
  const killXpShare=gap=>gap<=KILL_XP_FULL_BELOW?1:gap>=KILL_XP_ZERO_BELOW?0:(KILL_XP_ZERO_BELOW-gap)/(KILL_XP_ZERO_BELOW-KILL_XP_FULL_BELOW);
  // the game's character-sheet formula: (roll × (1+material) × quality + average roll × (stat bonus + 22%/Destruction
  // carat)) × weapon multiplier; STR for melee, DEX for bows and crossbows; the swing shortens with SPD (capped)
  // A school's spells as a "weapon": the game's spell formula (rules Nc) - the roll, plus magScale for every full 10
  // Magic above 10, plus magScale per full 10 Intellect with a staff bound to the school - cast in a rotation: each
  // spell level has its own cooldown (shared by every school), 2.4 s must pass between any two casts, and each cast
  // takes its cast time. The best spell ready is cast each time; mana is not counted.
  const REAL_CARAT_R=2;
  // Staffs, from the game: a wand-class weapon adds "steps" by its wood (pine 1, oak 4, black walnut 7, shagbark 12)
  // to every spell, its quality multiplies the spell, and its school enchant ("of Fire" ...) binds it: +1 to that school
  // per carat, and a point of damage per full 10 Intellect on that school's spells. A plain wand adds nothing.
  const STAFF_STEPS=[0,1,4,7,12],STAFF_WOODS=['Wand','Pine staff','Oak staff','Black walnut staff','Shagbark staff'];
  const STAFF_ENCH={fire:'of Fire',ice:'of Frost',shock:'of Lightning',acid:'of Acid'};
  const SCHOOL_ELEM={fire:'burn',ice:'freeze',shock:'shock',acid:'corrode'};
  const SPELL_SCHOOL_REQ={1:0,2:5,3:15,4:25};
  const isSpell=w=>String(w||'').startsWith('spell:');
  const wLabel=w=>isSpell(w)?pretty(w.slice(6))+' spells':pretty(w);
  function spellHit(school,v){
    const G=globalThis.BXC_GAME_DATA||{},INT=Math.max(0,+v.int||0),MAG=Math.max(0,+v.mag||0),slv=Math.max(0,+v.slv||0);
    const st=Math.max(0,Math.min(4,+v.staff||0)),steps=STAFF_STEPS[st],qm=1+((QUALITIES.find(x=>x[0]===v.squal)||[0,0])[1]||0);
    const bound=st>0&&+v.sc>0,intBonus=bound?Math.floor(INT/10):0,slvEff=slv+(bound?+v.sc:0),magSteps=Math.floor(Math.max(0,MAG-10)/10);
    const ringC=b=>(v.rings||[]).filter(r=>r&&r.bonus===b).reduce((a,r)=>a+ringPct(b,r.carat),0),adept=(1+ringC('adept'))*(1+ringC('reaper')*.3);   // Reaper: its bonus on the last 30% of health, as for weapons
    const known=(G.spells||[]).filter(sp=>sp.school===school&&sp.effect==='damage'&&(v.only?v.only.includes(sp.id):INT>=(sp.intRequirement||10*sp.level)&&slvEff>=(SPELL_SCHOOL_REQ[sp.level]||0)))
      .map(sp=>({...sp,avg:((((sp.baseDamageMin+sp.baseDamageMax)/2+sp.magScale*steps)*qm+sp.magScale*magSteps)+intBonus)*adept}));
    if(!known.length)return null;
    const GCD=2400,ready={};let t=0,dmg=0,casts=0,mana=0;const used=new Map();
    while(t<120000){const now=known.filter(sp=>(ready[sp.level]||0)<=t);
      if(!now.length){t=Math.min(...known.map(sp=>ready[sp.level]||0));continue}
      const sp=now.reduce((a,b)=>b.avg>a.avg?b:a);dmg+=sp.avg;casts++;mana+=sp.manaCost||0;used.set(sp.name,(used.get(sp.name)||0)+1);
      ready[sp.level]=t+sp.cooldownMs;t+=Math.max(GCD,sp.castTimeMs)}
    return {phys:dmg/casts,elem:0,elemType:null,type:SCHOOL_ELEM[school]||school,swing:t/casts/1000,crit:0,critMult:1,seeking:0,range:Math.max(...known.map(sp=>sp.range||11)),stat:'magic',statBonus:0,
      manaPerSec:mana/(t/1000),spell:{school,known:known.map(sp=>sp.name),used:[...used].sort((a,b)=>b[1]-a[1]).map(([k])=>k),steps,intBonus,bound,slvEff}};
  }
  // which weapons each class plays with (warriors: melee and the crossbow any class can learn; archers: bows, the
  // crossbow and daggers; mages: the spell schools)
  const CLASS_WEAPONS={warrior:w=>!/bow$/.test(w)||w==='crossbow',archer:w=>/bow$/.test(w)||w==='dagger'||w==='kryss'};
  // Both ring slots: every pair of ring kinds at 2 carats (what the gem combiner makes), keeping the pair that adds the
  // most to each hit (crits included) - Adept for spells, Brawler/Hunter/Duelist/Reaper for weapons
  function bestRings(w,v){
    const kinds=ringsFor(v&&v.cls,w).map(r=>r[0]).filter(Boolean),c=REAL_CARAT_R;let best=null;
    const score=h=>h?h.phys*(1+(h.crit||0)*((h.critMult||1)-1))+(h.elem||0):0;
    for(let i=0;i<kinds.length;i++)for(let j=i;j<kinds.length;j++){const rings=[{bonus:kinds[i],carat:c},{bonus:kinds[j],carat:c}],sc=score(weaponHit(w,{...v,rings}));if(!best||sc>best.sc)best={sc,rings}}
    return best?best.rings:[{bonus:'',carat:0},{bonus:'',carat:0}];
  }
  // Ammo (the game's rules): bodkin arrows/bolts hit 1.15× as hard; poisoned ones add a dose of poison (weak 10%,
  // normal 15%, potent 20%) that the game's server works out, so it is named but not counted.
  const AMMO=[['','Plain',1],['bodkin','Bodkin (+15%)',1.15],['weak-poisoned','Weak poisoned',1],['poisoned','Poisoned',1],['potent-poisoned','Potent poisoned',1]];
  const ammoMult=a=>(AMMO.find(x=>x[0]===a)||AMMO[0])[2];
  function weaponHit(w,v){
    if(isSpell(w))return spellHit(w.slice(6),v);
    const G=globalThis.BXC_GAME_DATA,wd=G&&G.weapons&&G.weapons[w];if(!wd)return null;const C=G.combat||{};
    const MB=Array.isArray(C.materialBonus)?C.materialBonus:MAT_BONUS,PC=C.enchantPerCarat||PER_CARAT,SD=C.statDamage||{strength:.013,dexterity:.0085};
    const ti=Math.max(0,Math.min(4,+v.tier||0)),q=(QUALITIES.find(x=>x[0]===v.qual)||[0,0])[1],c=Math.max(0,+v.carats||0);
    const ranged=/bow/.test(w),stat=ranged?'dexterity':'strength',statBonus=Math.max(0,ranged?+v.dex||0:+v.str||0)*SD[stat];
    const avg=(wd.damageMin+wd.damageMax)/2,destr=v.ench==='destruction'?c*PC:0;
    // rings: Brawler (melee) / Hunter (bows) add damage, Duelist adds crit chance, Reaper adds damage below 30% health
    const ringC=b=>(v.rings||[]).filter(r=>r&&r.bonus===b).reduce((a,r)=>a+ringPct(b,r.carat),0);
    const ringDmg=1+(ranged?ringC('hunter'):ringC('brawler'))+ringC('reaper')*.3;
    const am=ranged?ammoMult(v.ammo!=null?v.ammo:(document.getElementById('cmbAmmo')||{}).value):1;   // like the weapon's own damageMult
    const phys=(avg*(1+MB[ti])*(1+q)+avg*(statBonus+destr))*wd.damageMult*am*ringDmg;
    const elemType=['burn','freeze','shock','corrode'].includes(v.ench)?v.ench:null,elem=elemType?avg*c*PC*wd.damageMult*am:0;
    const crit=Math.min((C.critCap??50)/100,((C.critBase??4)+(C.critPerDex??.1)*Math.max(0,+v.dex||0)+(W_SKILL[w]==='dagger'?(C.critDagger??10):0))/100+ringC('duelist'));
    const speed=Math.min(C.speedCap??1.5,1+Math.max(0,+v.spd||0)*(C.speedPerPoint??.0025));
    return {staminaCost:wd.staminaCost||0,phys,elem,elemType,type:W_TYPE(w),swing:wd.cooldownMs/speed/(wd.rateBonus||1)/1000,crit,critMult:C.critMult??1.8,seeking:v.ench==='seeking'?.02*c:0,range:wd.range,stat,statBonus};
  }

  // What a weapon asks of you (the game's rules): material tier -> character level, and that much STR (metal weapons)
  // or DEX (daggers, bows and crossbows)
  const matName=v=>v.tier?(/bow/.test(v.weapon)?WOODS:METALS)[v.tier-1]:'Basic';
  const EQUIP_LEVEL=[0,5,15,25,40],EQUIP_ATTR=[0,20,45,70,100];
  const equipStat=w=>W_SKILL[w]==='dagger'||/bow/.test(w)?'dex':'str';
  function bestTierFor(w,charLv,v){const useAttr=(+v[equipStat(w)]||0)>0;let t=0;   // the weapon's own stat, when it is filled in
    for(let i=1;i<=4;i++)if(charLv>=EQUIP_LEVEL[i]&&(!useAttr||(+v[equipStat(w)]||0)>=EQUIP_ATTR[i]))t=i;return Math.max(t,charLv>=EQUIP_LEVEL[1]?1:0)}
  // Gem sizes to plan on: the gem combiner makes up to 2 carats, so 2 is realistic, 3 is rare and 4 very rare
  const REAL_CARAT=2;
  // a quality's rarity from how often the best smith turns it out (under 10% is left out of "Aim for")
  const oddsRarity=o=>o<.02?'very rare':o<.05?'rare':o<.10?'semi-rare':o<.20?'uncommon':'common';
  const caratNote=(c,what)=>c>=2.5?`${c}-carat ${what} are ${globalThis.bxcGemRarity?globalThis.bxcGemRarity(c):(c>=4?'very rare':c>=3.5?'rare':c>=3?'semi-rare':'uncommon')} (the gem combiner makes up to 2)`:'';
  const W_RECIPE_ID={'short-sword':'sword','long-sword':'longsword','war-mace':'warmace','battle-spear':'battlespear','short-bow':'bow','long-bow':'longbow'};
  const smithSkillOf=w=>/bow/.test(w)?'Bowyer':'Weapon Smithing';
  function weaponRecipeLevel(w,t){if(!t)return null;const id=(/bow/.test(w)?WOOD_IDS:METAL_IDS)[t-1]+'-'+(W_RECIPE_ID[w]||w),r=(typeof RECIPES!=='undefined'?RECIPES:[]).find(x=>x.id===id);return r?r.level:null}
  // the quality a smith turns out at least 10% of the time (the game's crafting-quality odds for their level over the
  // recipe; unknown smith: 10 levels over), and an enchant of three gems up to 3 carats each (4-carat gems are very rare)
  function realisticWeapon(w,t,smLv){
    const rl=weaponRecipeLevel(w,t),over=rl==null?10:smLv?smLv-rl:10;let qual='ordinary';
    if(typeof interpolateCraftQuality==='function'&&over>=0){const od=interpolateCraftQuality(Math.min(30,over));for(let k=QUALITIES.length-1;k>3;k--)if((od[QUALITIES[k][0]]||0)>=.10){qual=QUALITIES[k][0];break}}
    return {qual,carats:t?Math.min(3*REAL_CARAT,3*t):0,recipe:rl,over,canMake:!(smLv&&rl!=null&&smLv<rl)};
  }
  function renderCombatPlanner(){
    const skills=['Character',...(typeof COMBAT_SKILLS!=='undefined'?COMBAT_SKILLS:[])];
    let saved={};try{saved=JSON.parse(localStorage.getItem('bxcCombatPlanner')||'{}')}catch{}
    const G=globalThis.BXC_GAME_DATA,allWeapons=G&&G.weapons?Object.keys(G.weapons):[];
    const startClass=['warrior','archer','mage'].includes(saved.cls)?saved.cls:(globalThis.bxcCharClass&&globalThis.bxcCharClass())||'warrior';
    const classWeapons=c=>c==='mage'?Object.keys(SCHOOL_ELEM).map(sc=>'spell:'+sc):allWeapons.filter(CLASS_WEAPONS[c]||(()=>true)).sort((a,b)=>c==='archer'?(/bow$/.test(a)?0:1)-(/bow$/.test(b)?0:1):0);
    let weapons=classWeapons(startClass);
    content.innerHTML=`<article class="wp tool-wp"><div class="wp-main">
      <p class="wp-lede">Pick what you are levelling and the weapon you fight with: monsters are ranked by the XP a minute your weapon gets from them, with their hit points, XP and weaknesses.</p>
      <div class="tool-form">
        <label>Skill<select id="cmbSkill">${skills.map(s=>`<option value="${esc(s)}"${s===saved.skill?' selected':''}>${esc(s==='Character'?'Character level':s)}</option>`).join('')}</select></label>
        <label>Your level<input id="cmbLevel" type="number" min="1" max="100" value="${Number(saved.level)||1}"></label>
        <label>XP into it<input id="cmbInto" type="number" min="0" value="0"></label>
        <label>Goal level<input id="cmbTarget" type="number" min="2" max="100" value=""></label>
        <label>Character level<input id="cmbChar" type="number" min="1" max="100" value="${Number(saved.char)||Number(saved.level)||1}" title="Chance to hit depends on your character level against the monster's"></label>
        <div id="cmbAutoState" class="tool-auto"></div>
      </div>
      ${weapons.length?`<div class="tool-form">
        ${typeof globalThis.bxcCharGear==='function'&&!globalThis.BXC_PUBLIC?`<label class="tool-check"><input type="checkbox" id="cmbFollow"${saved.follow===false?'':' checked'}> Use my equipped gear and stats</label>`:''}
        <p class="gp-linkrow"><button type="button" id="cmbFromGear" class="gp-mine">Use my Gear &amp; DPS loadout</button> <span id="cmbFromGearNote" class="muted"></span></p>
        <label>Class<select id="cmbClass">${[['warrior','Warrior'],['archer','Archer'],['mage','Mage']].map(([k,l])=>`<option value="${k}"${k===startClass?' selected':''}>${l}</option>`).join('')}</select></label>
        <label><span id="cmbWeaponLabel">Weapon</span><select id="cmbWeapon"><option value="">Best for my level</option>${weapons.map(w=>`<option value="${w}">${esc(wLabel(w))}</option>`).join('')}</select></label>
        <label class="mage-f">Staff<select id="cmbStaff">${STAFF_WOODS.map((l,i)=>`<option value="${i}"${i===(+saved.staff||0)?' selected':''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="mage-f">Quality<select id="cmbSQual">${QUALITIES.map(([k])=>`<option value="${k}"${k===(saved.squal||'ordinary')?' selected':''}>${pretty(k)}</option>`).join('')}</select></label>
        <label class="mage-f"><span id="cmbSEnchLabel">School enchant carats</span><input id="cmbSC" type="number" min="0" step="1" value="${Number(saved.sc)||0}" title="The staff's own school enchant (three gems, up to 3 carats each by the wood): +1 to the school per carat, and a point of damage per full 10 INT" max="12"></label>
        <label class="mage-f">INT<input id="cmbInt" type="number" min="0" max="999" value="${Number(saved.int)||10}" title="10 per spell level to learn and cast it; a staff adds a little per full 10"></label>
        <label class="mage-f">MAG<input id="cmbMag" type="number" min="0" max="999" value="${Number(saved.mag)||10}" title="Every full 10 above 10 raises every spell"></label>
        <label class="mage-f">School level<input id="cmbSlv" type="number" min="0" max="100" value="${Number(saved.slv)||1}" title="Spells of level 2, 3 and 4 need 5, 15 and 25 in their school"></label>
        <label>Material<select id="cmbTier"></select></label>
        <label>Quality<select id="cmbQual">${QUALITIES.map(([k])=>`<option value="${k}"${k===(saved.qual||'ordinary')?' selected':''}>${pretty(k)}</option>`).join('')}</select></label>
        <label>Enchant<select id="cmbEnch">${ELEMENTS.map(([k,l])=>`<option value="${k}"${k===(saved.ench||'')?' selected':''}>${esc(l)}</option>`).join('')}</select></label>
        <label>Carats<input id="cmbCarat" type="number" min="0" max="12" step="1" value="${Number(saved.carats)||0}"></label>
        <label>STR<input id="cmbStr" type="number" min="0" max="999" value="${Number(saved.str)||0}" title="Adds damage to melee weapons"></label>
        <label>DEX<input id="cmbDex" type="number" min="0" max="999" value="${Number(saved.dex)||0}" title="Adds damage to bows and crossbows, and crit chance"></label>
        <label title="${esc(SMITH_TITLE('Weapon Smithing (Bowyer for bows and crossbows)'))}">Best smith<input id="cmbSmith" type="number" min="0" max="100" placeholder="${globalThis.BXC_PUBLIC?'level':'yours'}" value="${Number(saved.smith)||''}"></label>
        <label>SPD<input id="cmbSpd" type="number" min="0" max="999" value="${Number(saved.spd)||0}" title="Swings faster (up to 1.5×)"></label>
        <label class="ammo-f" title="Bodkins (Bowyer 10: 10 arrows or bolts + 1 iron bar) hit 15% harder. Poisoned ammo (Herblore 30/50/70) adds poison over time that the game works out on its server, so it is not in these numbers.">Ammo<select id="cmbAmmo">${AMMO.map(([k,l])=>`<option value="${k}"${k===(saved.ammo||'')?' selected':''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="mage-f" title="Your whole mana bar: mana does not refill during a fight">Mana<input id="cmbMana" type="number" min="0" max="9999" value="${Number(saved.mana)||''}" placeholder="any"></label>
        <label class="cmb-stam" title="Your whole stamina bar: stamina does not refill during a fight. Every attack costs some; with a bow or crossbow every tile you move does too">Stamina<input id="cmbStam" type="number" min="0" max="9999" value="${Number(saved.stam)||''}" placeholder="any"></label>
        <label class="ammo-f" title="Tiles you move in a fight (bows and crossbows: 0.5 stamina a tile, less with SPD from points)">Tiles a fight<input id="cmbTiles" type="number" min="0" max="99" value="${saved.tiles??6}"></label>
        <div id="cmbGoalNote" class="tool-auto"></div>
        ${[0,1].map(i=>`<div class="ring-row"><label>Ring ${i+1}<select id="cmbRing${i}">${RINGS.map(([k,l])=>`<option value="${k}"${k===((saved.rings||[])[i]||{}).bonus?' selected':''}>${esc(l)}</option>`).join('')}</select></label><label>Carats<input id="cmbRingC${i}" type="number" min="0" max="4" step="1" value="${Number(((saved.rings||[])[i]||{}).carat)||0}"></label></div>`).join('')}
      </div>`:''}
      <div id="cmbPlanOut"></div>
    </div><aside class="wp-infobox" id="cmbPlanAside"></aside></article>`;
    const el=id=>document.getElementById(id);
    let goalTouched=false,hits={},lastSuggested='',linkRotation=null,linkSpdBase=null;   // from Gear & DPS: your spell rotation and SPD from points
    // the class decides the weapon list and the boxes: a mage picks a school and gives INT, MAG and school level
    function classView(){
      const c=el('cmbClass').value,mage=c==='mage';setRingOpts(['cmbRing0','cmbRing1'],c,el('cmbWeapon')&&el('cmbWeapon').value);
      for(const l of el('cmbPlanOut').closest('.wp-main').querySelectorAll('.mage-f'))l.hidden=!mage;
      for(const id of ['cmbTier','cmbQual','cmbEnch','cmbCarat','cmbStr','cmbDex','cmbSmith','cmbSpd','cmbStam'])if(el(id))el(id).closest('label').hidden=mage||(id==='cmbStr'&&c==='archer');
      ammoView();
      el('cmbWeaponLabel').textContent=mage?'School':'Weapon';
      if(el('cmbGoalNote')&&mage)el('cmbGoalNote').textContent='';
    }
    // the ammo box is only for bows and crossbows, and says arrows or bolts
    function ammoView(){const w=el('cmbWeapon')&&el('cmbWeapon').value,box=el('cmbAmmo');if(!box)return;if(el('cmbTiles'))el('cmbTiles').closest('label').hidden=!(/bow/.test(w||'')||(!w&&el('cmbClass').value==='archer'));const on=/bow/.test(w||'')||(!w&&el('cmbClass')&&el('cmbClass').value==='archer');   // an archer's best-for-level pick is a bow
     box.closest('label').hidden=!on;
      box.closest('label').firstChild.textContent=on?(w==='crossbow'?'Bolts':'Arrows'):'Ammo';}
    function setClass(c){const cur=el('cmbWeapon').value;weapons=classWeapons(c);
      el('cmbWeapon').innerHTML='<option value="">Best for my level</option>'+weapons.map(w=>`<option value="${w}">${esc(wLabel(w))}</option>`).join('');
      el('cmbWeapon').value=weapons.includes(cur)?cur:'';classView()}
    const fillTiers=()=>{if(!el('cmbTier'))return;const w=el('cmbWeapon').value,wood=/bow/.test(w),names=wood?WOODS:METALS;
      // Seeking is for bows and crossbows only; they take every other weapon enchant too
      {const ench=el('cmbEnch'),cur=ench.value;ench.innerHTML=ELEMENTS.filter(([k])=>k!=='seeking'||wood||!w).map(([k,l])=>`<option value="${k}">${esc(l)}</option>`).join('');ench.value=[...ench.options].some(o=>o.value===cur)?cur:''}
      const cur=el('cmbTier').value!==''&&el('cmbTier').value!=null&&el('cmbTier').options.length?+el('cmbTier').value:(saved.tier?+saved.tier:1);
      el('cmbTier').innerHTML=['Basic',...names].map((n,i)=>`<option value="${i}"${i===cur?' selected':''}>${n}</option>`).join('')};
    fillTiers();classView();
    function run(){ammoView();
      const skill=el('cmbSkill').value,isChar=skill==='Character',curve=curveOf(skill),max=curve.length||100;
      const level=Math.max(1,Math.min(max-1,Math.floor(+el('cmbLevel').value||1)));
      if(isChar&&document.activeElement!==el('cmbChar'))el('cmbChar').value=String(level);
      const charLv=Math.max(1,Math.min(100,Math.floor(+el('cmbChar').value||level)));
      const into=Math.max(0,Math.min(xpOn(curve,level+1)-xpOn(curve,level)-1,Math.floor(+el('cmbInto').value||0)));
      if(!goalTouched)el('cmbTarget').value=String(Math.min(max,(Math.floor(level/5)+1)*5));
      const goal=Math.max(level+1,Math.min(max,Math.floor(+el('cmbTarget').value||level+1)));
      const v=el('cmbWeapon')?{weapon:el('cmbWeapon').value,tier:+el('cmbTier').value,qual:el('cmbQual').value,ench:el('cmbEnch').value,carats:+el('cmbCarat').value||0,str:+el('cmbStr').value||0,dex:+el('cmbDex').value||0,spd:+el('cmbSpd').value||0,ammo:el('cmbAmmo')?el('cmbAmmo').value:'',rings:[0,1].map(i=>({bonus:el('cmbRing'+i).value,carat:+el('cmbRingC'+i).value||0})),follow:el('cmbFollow')?el('cmbFollow').checked:undefined,cls:el('cmbClass').value,int:+el('cmbInt').value||0,mag:+el('cmbMag').value||0,slv:+el('cmbSlv').value||0,staff:+el('cmbStaff').value||0,squal:el('cmbSQual').value,sc:Math.min(3*(+el('cmbStaff').value||0),Math.max(0,Math.floor(+el('cmbSC').value||0))),mana:+el('cmbMana').value||0,stam:+el('cmbStam').value||0,tiles:Math.max(0,+el('cmbTiles').value||0),spdBase:linkSpdBase,only:linkRotation}:{};
      try{localStorage.setItem('bxcCombatPlanner',JSON.stringify({skill,level,char:charLv,...v,smith:+el('cmbSmith').value||0}))}catch{}
      const toGo=Math.max(0,xpOn(curve,goal)-xpOn(curve,level)-into);
      const suggest=!!el('cmbWeapon')&&!v.weapon;
      let wh=v.weapon?weaponHit(v.weapon,v):null;
      const barCol=(isSpell(v.weapon)||el('cmbClass').value==='mage')?(v.mana>0?'Mana':null):(v.stam>0?'Stamina':null);
      // XP per kill for what you are levelling: character XP is the game's number at the monster's level (or what your
      // kills gave); a weapon/magic skill's is what your own fights measured
      const meas=measuredPerKill(isChar?'character':String(skill).toLowerCase());
      // the monsters worth fighting at a character level, with the XP each pays you there and your chance to hit it
      const usualLv=new Map();const lvOfMon=m=>{if(!usualLv.has(m))usualLv.set(m,monsterUsualLevel(m));return usualLv.get(m)};
      function monstersAt(cl){const out=[];
        for(const m of (typeof D!=='undefined'?D.catalog||[]:[])){
          if(!m.baseLevel||m.passive||m.family==='human'||!m.maxHp)continue;
          const L=lvOfMon(m);if(L<cl-9||L>cl+10)continue;
          const st=monsterAt(m,L),r=meas.get(String(m.name).toLowerCase());
          // character XP: the game's number for the monster's level, cut by how far below you it is (your own past kills
          // were at other levels, and elites pay triple, so they are not used here); skill XP: what your fights measured
          const share=isChar?killXpShare(cl-L):1;if(isChar&&share<=0)continue;
          const xp=isChar?Math.round(st.xp*share):(r&&r.n>=3?r.median:null);
          out.push({m,L,st,xp,share,xpSrc:!isChar&&r&&r.n>=3?'yours':'rule',h:hitFor(m.name,cl,L,hits)});
        }
        return out}
      // the same monsters, scored for one weapon: damage a hit (weakness included), hit chance, swing time -> kill time
      const scoreRows=(rs,wh,vv)=>rs.map(r=>{let dps=null,ttk=null,perHit=null,dry=null;vv=vv||v;
        if(wh){const hitC=Math.min(.95,r.h.c+wh.seeking);perHit=wh.phys*typeMult(r.m,wh.type)+(wh.elemType?wh.elem*typeMult(r.m,wh.elemType):0);
          dps=hitC*perHit*(1+wh.crit*(wh.critMult-1))/wh.swing;ttk=r.st.hp/dps;
          const bar=wh.spell?vv.mana:vv.stam;
          if(bar>0){const ranged=wh.stat==='dexterity',perSec=wh.spell?(wh.manaPerSec||0):(wh.staminaCost||0)/wh.swing+(ranged?(vv.tiles||0)*stepCost(vv.spdBase!=null?vv.spdBase:vv.spd||10)/ttk:0);
            const need=perSec*ttk;
            if(need>bar){const tDry=bar/perSec,done=dps*tDry;dry=done/r.st.hp;
              if(wh.spell)ttk=null;   // out of mana: no more spells this fight
              else{const hc2=Math.max(.05,hitC-.4),dps2=dps*.4*hc2/hitC;ttk=tDry+(r.st.hp-done)/dps2}}}}
        return {...r,perHit,dps,ttk,dry,xpMin:r.xp!=null&&ttk?r.xp/ttk*60:null}})
        .sort((a,b)=>(b.xpMin??-1)-(a.xpMin??-1)||(a.ttk??1e9)-(b.ttk??1e9)||(b.xp??0)-(a.xp??0));
      // "Best for my level": every weapon at the best material you can equip at that level, ordinary and unenchanted,
      // with your stats and rings; the one with the most XP a minute (or quickest kills) comes first
      // each weapon at the best material you can wield that a smith can make, in the quality and carats to expect
      // from the best smith (2-carat gems, Destruction)
      const smithFor=w=>{const b=bestSmith(smithSkillOf(w),el('cmbSmith').value);return b?b.lv:null};
      const gearFor=(w,cl)=>{const g=gearBase(w,cl);return {...g,rings:bestRings(w,g)}};
      const gearBase=(w,cl)=>{if(isSpell(w)){let t=0;for(let i=1;i<=4;i++)if(cl>=EQUIP_LEVEL[i]&&(!(+v.int>0)||+v.int>=EQUIP_ATTR[i]))t=i;
          const bwS=bestSmith('Bowyer',el('cmbSmith').value),bw=bwS?bwS.lv:null;while(t>0&&bw&&bw<[0,15,30,45,60][t])t--;const rl=[0,15,30,45,60][t],over=bw?bw-rl:10;
          let q='ordinary';if(t&&typeof interpolateCraftQuality==='function'&&over>=0){const od=interpolateCraftQuality(Math.min(30,over));for(let k=QUALITIES.length-1;k>3;k--)if((od[QUALITIES[k][0]]||0)>=.10){q=QUALITIES[k][0];break}}
          return {...v,weapon:w,tier:0,qual:'ordinary',ench:'',carats:0,staff:t,squal:q,sc:Math.min(3*t,6)}}let tier=bestTierFor(w,cl,v);while(tier>0&&!realisticWeapon(w,tier,smithFor(w)).canMake)tier--;
        const rw=realisticWeapon(w,tier,smithFor(w));return {...v,weapon:w,tier,qual:rw.qual,ench:rw.carats?'destruction':'',carats:rw.carats}};
      // an archer's own weapons (bows and the crossbow) come first; the dagger is the melee backup
      const mainFirst=w=>v.cls==='archer'&&!/bow$/.test(w)?1:0;
      const picksAt=(cl,rs)=>weapons.map(w=>{const vw=gearFor(w,cl),tier=vw.tier,whw=weaponHit(w,vw);
          const best=whw?scoreRows(rs,whw)[0]:null;return {w,tier,vw,wh:whw,best}}).filter(p=>p.wh&&p.best)
          .sort((a,b)=>mainFirst(a.w)-mainFirst(b.w)||(b.best.xpMin??-1)-(a.best.xpMin??-1)||(a.best.ttk??1e9)-(b.best.ttk??1e9));
      const rows=monstersAt(charLv);
      const scoreWith=wh=>scoreRows(rows,wh);
      let picks=[];
      if(suggest){picks=picksAt(charLv,rows);if(picks[0])wh=picks[0].wh}
      const shownV=suggest&&picks[0]?picks[0].vw:v;
      // the Weapon box says which weapon was picked for you
      const gearTxt=g=>isSpell(g.weapon)?`${wLabel(g.weapon)} · ${g.staff?`${pretty(g.squal)} ${STAFF_WOODS[g.staff]} ${STAFF_ENCH[g.weapon.slice(6)]} ${g.sc}c`:'wand'}`:`${matName(g)} ${pretty(g.weapon)} · ${pretty(g.qual)} · ${g.ench&&g.carats?`Destruction ${g.carats}c`:'no enchant'}`;
      if(el('cmbWeapon'))el('cmbWeapon').options[0].textContent=suggest&&picks[0]?`Best: ${gearTxt(picks[0].vw)}`:'Best for my level';
      // "Best for my level" fills the same boxes as a picked weapon, with the suggested gear
      if(suggest&&picks[0]&&!isSpell(picks[0].w)){const g=picks[0].vw;lastSuggested=g.weapon;
        el('cmbTier').innerHTML=['Basic',...(/bow/.test(g.weapon)?WOODS:METALS)].map((nm,i)=>`<option value="${i}"${i===g.tier?' selected':''}>${nm}</option>`).join('');
        el('cmbQual').value=g.qual;el('cmbEnch').value=g.ench||'';el('cmbCarat').value=String(g.carats||0);setRingBoxes(g.rings)}
      if(suggest&&picks[0]&&isSpell(picks[0].w)){const g=picks[0].vw;setRingBoxes(g.rings);el('cmbStaff').value=String(g.staff);el('cmbSQual').value=g.squal;el('cmbSC').value=String(g.sc)}
      if(suggest&&el('cmbGoalNote')&&picks[0]&&isSpell(picks[0].w)){const p=picks[0];el('cmbGoalNote').textContent=`Best for level ${charLv}: ${wLabel(p.w)}, casting ${(p.wh.spell&&p.wh.spell.used||[]).join(', ')} with ${/^[AEIOU]/i.test(gearTxt(p.vw).split(' · ')[1]||'')?'an':'a'} ${esc(gearTxt(p.vw).split(' · ').slice(1).join(' · '))} and two 2-carat Adept rings. Change any box to make it yours.`}
      else if(suggest&&el('cmbGoalNote')){const p=picks[0],sm=p&&smithFor(p.w);el('cmbGoalNote').textContent=p?`Best for level ${charLv}: ${gearTxt(p.vw)}${p.vw.carats?` (three ${p.vw.carats/3}-carat gems)`:''} - the quality and carats to expect ${smithWho(bestSmith(smithSkillOf(p.w),el('cmbSmith').value))}. Change any box to make it yours.`:''}
      // Training path (character level): level by level to your goal (at least ten ahead), the best gear and monster
      // at each; kill XP falls off as you outlevel a monster, so this shows when to move on and to what
      const path=[],STICK=.9;
      if(isChar&&(suggest||wh)){
        const to=Math.min(max,Math.max(goal,level+10));
        for(let cl=level;cl<to;cl++){
          const rs=cl===charLv?rows:monstersAt(cl);let gear,b;
          if(suggest){const p=picksAt(cl,rs)[0];if(!p)continue;gear=p.vw;b=p.best}else{b=scoreRows(rs,wh)[0];gear=v}
          if(!b||!b.xp)continue;
          // stay with the weapon and monster you are on while they are within 10% of the best (a better material for
          // the same weapon is still picked up); only a clearly better choice is worth walking somewhere new for
          const last0=path[path.length-1];
          if(last0&&b.xpMin!=null){const lw=last0.gear.weapon,gNow=suggest?{...v,weapon:lw,tier:bestTierFor(lw,cl,v),qual:'ordinary',ench:'',carats:0}:v;
            const sc=scoreRows(rs,suggest?weaponHit(lw,gNow):wh),same=sc.find(r=>r.m===last0.b.m),ok=r=>r&&r.xp&&r.xpMin!=null&&r.xpMin>=STICK*b.xpMin;
            if(ok(same)){gear=gNow;b=same}else if(ok(sc[0])){gear=gNow;b=sc[0]}}
          const need=xpOn(curve,cl+1)-xpOn(curve,cl)-(cl===level?into:0),kills=Math.ceil(need/b.xp),mins=b.ttk?kills*b.ttk/60:null;
          const key=gear.weapon+'|'+gear.tier+'|'+b.m.name,last=path[path.length-1];
          if(last&&last.key===key){last.to=cl;last.kills+=kills;last.mins=last.mins!=null&&mins!=null?last.mins+mins:null;last.xpMinEnd=b.xpMin}
          else path.push({key,from:cl,to:cl,gear,b,kills,mins,xpMinStart:b.xpMin,xpMinEnd:b.xpMin,goalLv:goal});
        }
      }
      const ranked=scoreWith(wh);rows.length=0;rows.push(...ranked);
      const top=rows.slice(0,25),best=top[0];
      const chip=(t,m)=>{const x=typeMult(m,t);return x>1?`<span class="tag-chip weak">weak to ${esc(t)}</span>`:x<1?`<span class="tag-chip resist">resists ${esc(t)}</span>`:''};
      const weakLine=m=>[list(m.weakTo).length?'weak: '+esc(list(m.weakTo).join(', ')):'',list(m.resists).length?'resists: '+esc(list(m.resists).join(', ')):''].filter(Boolean).join(' · ')||'—';
      const kills=best&&best.xp?Math.ceil(toGo/best.xp):null;
      // the suggested gear, weapon by weapon (best first); "Use" picks it and the page switches to that weapon
      const mageMode=v.cls==='mage';
      const pickHtml=suggest&&picks.length&&mageMode?`<section><h2>Schools at level ${charLv}</h2><p class="g-note">Each school with the spells your INT and school level allow, against its best monster.</p>`+table(['School','Spells','Best monster','Hit','Kill','XP / min',''],picks.map((p,i)=>[`${i===0?'<b>':''}${esc(wLabel(p.w))}${i===0?'</b>':''}`,esc((p.wh.spell&&p.wh.spell.known||[]).join(', ')),mon(p.best.m,p.best.m.name)+` <span class="muted">Lv ${p.best.L}</span>`,Math.round(p.best.h.c*100)+'%',p.best.ttk?p.best.ttk.toFixed(1)+' s':'—',p.best.xpMin!=null?n(p.best.xpMin):'—',`<button type="button" class="cmb-use" data-w="${esc(p.w)}" data-t="0">Use</button>`]))+'</section>'
        :suggest&&picks.length?`<section><h2>Suggested gear for level ${charLv}</h2><p class="g-note">Every weapon at the best material you can wield at level ${charLv}${(+v.str||0)||(+v.dex||0)?' with your STR/DEX':''}, in the quality and carats to expect from the best smith (2-carat gems), against its best monster. Pick one (or your own weapon) in the Weapon box to plan with it.</p>`+
        table(['Weapon','Gear','Needs','Best monster','Hit','Kill','XP / min',''],picks.map((p,i)=>[`${i===0?'<b>':''}${esc(matName(p.vw))} ${esc(pretty(p.w))}${i===0?'</b>':''}`,`${esc(pretty(p.vw.qual))}${p.vw.carats?` · Destruction ${p.vw.carats}c`:''}`,`Lv ${EQUIP_LEVEL[p.tier]}${EQUIP_ATTR[p.tier]?` · ${EQUIP_ATTR[p.tier]} ${equipStat(p.w).toUpperCase()}`:''}`,mon(p.best.m,p.best.m.name)+` <span class="muted">Lv ${p.best.L}</span>`,Math.round(p.best.h.c*100)+'%',p.best.ttk?p.best.ttk.toFixed(1)+' s':'—',p.best.xpMin!=null?n(p.best.xpMin):'—',`<button type="button" class="cmb-use" data-w="${esc(p.w)}" data-t="${p.tier}">Use</button>`]))+'</section>':'';
      const lvRange=p=>p.from===p.to?`${p.from}`:`${p.from}–${p.to}`;
      const gearName=g=>`${esc(matName(g))} ${esc(pretty(g.weapon))}`;
      const mins=m=>m==null?'—':m>=90?(m/60).toFixed(1)+' h':Math.round(m)+' min';
      const pathHtml=path.length?`<section><h2>Training path</h2><p class="g-note">What to fight at each character level${suggest?' and the gear to do it with (the best material you can wield by then, ordinary, no enchant)':' with your '+esc(pretty(v.weapon))}. A monster stops being the best once you outlevel it: its kill XP falls from 3 levels below you and is gone at 10.${suggest&&((+v.str||0)||(+v.dex||0))?' Your STR/DEX are kept as they are now.':''}</p>`+
        table(['Levels',suggest?'Gear':'','Monster','XP / min','Kills','Time'].filter(Boolean),path.map((p,i)=>{
          const nx=path[i+1],cells=[`<b>${lvRange(p)}</b>${p.from>=p.goalLv?' <span class="muted">(past goal)</span>':''}`];
          if(suggest)cells.push(gearName(p.gear)+(i>0&&(p.gear.weapon!==path[i-1].gear.weapon||p.gear.tier!==path[i-1].gear.tier)?' <span class="tag-chip weak">new gear</span>':''));
          cells.push(mon(p.b.m,p.b.m.name)+` <span class="muted">Lv ${p.b.L}</span>`+(nx?`<div class="muted" style="font-size:11px">switch at ${nx.from}${nx.b.m!==p.b.m?' — its XP drops as you outlevel it':''}</div>`:''),
            p.xpMinStart!=null?n(p.xpMinStart)+(p.xpMinEnd!=null&&Math.abs(p.xpMinEnd-p.xpMinStart)>=1?' → '+n(p.xpMinEnd):''):'—',n(p.kills),mins(p.mins));
          return cells}))+'</section>':'';
      // Upgrades worth making with this weapon: the next metal (at the quality a smith realistically makes), better
      // quality, more enchant carats, rings - each scored as XP a minute on your best monster. How often a quality comes
      // out is the game's crafting-quality odds for the best smith over the weapon's recipe; under 10%, and 4-carat
      // gems and rings, are very rare and left out of "Aim for".
      const upgHtml=(()=>{
        if(!wh||!shownV.weapon||isSpell(shownV.weapon))return '';
        const w=shownV.weapon,base={...shownV,rings:(shownV.rings||[]).map(r=>({...r}))},ranged=/bow/.test(w),smithSkill=ranged?'Bowyer':'Weapon Smithing';
        const metric=vv=>{const h=weaponHit(w,vv);if(!h)return null;const b=scoreRows(rows,h)[0];return b?(b.xpMin??(b.ttk?60/b.ttk:null)):null};
        const now=metric(base);if(!now)return '';
        const sm=bestSmith(smithSkill,el('cmbSmith').value);
        const W_ID={'short-sword':'sword','long-sword':'longsword','war-mace':'warmace','battle-spear':'battlespear','short-bow':'bow','long-bow':'longbow'};
        const recLv=t=>{if(!t)return null;const id=(ranged?WOOD_IDS:METAL_IDS)[t-1]+'-'+(W_ID[w]||w),r=(typeof RECIPES!=='undefined'?RECIPES:[]).find(x=>x.id===id);return r?r.level:null};
        const over=t=>{const rl=recLv(t);return rl==null?10:sm?sm.lv-rl:10};
        const qi=q=>QUALITIES.findIndex(x=>x[0]===q);
        const qOdds=(q,t)=>{if(typeof interpolateCraftQuality!=='function')return null;const o=over(t);return o<0?0:(interpolateCraftQuality(Math.min(30,o))[q]||0)};
        const qRare=(q,t)=>{const o=qOdds(q,t);return o!=null&&qi(q)>3&&o<.10};
        const smithTxt=smithWho(sm);
        const wName=t=>(matName({weapon:w,tier:t})+' '+pretty(w)).toLowerCase();
        const qNote=(q,t)=>{if(!qRare(q,t))return '';const o=qOdds(q,t),m=wName(t);return `${pretty(q)} is ${oddsRarity(o)}: ${o<.005?`${/^[aeiou]/.test(m)?'an':'a'} ${m} almost never comes out ${q}`:`about ${(o*100).toFixed(o<.1?1:0)}% of ${m}s come out ${q}`} ${smithTxt}`};
        const realQ=t=>{for(let k=QUALITIES.length-1;k>3;k--)if(!qRare(QUALITIES[k][0],t))return QUALITIES[k][0];return 'ordinary'};
        const cantMake=t=>{const rl=recLv(t);return sm&&rl!=null&&sm.lv<rl?`no one can make it yet: needs ${smithSkill} ${rl} (best is ${sm.lv})`:''};
        const lvOk=t=>charLv>=EQUIP_LEVEL[t]&&(!((+v.str||0)||(+v.dex||0))||(+v[equipStat(w)]||0)>=EQUIP_ATTR[t]);
        const capOf=t=>3*Math.max(1,t);   // an enchant is three gems, each up to 1 carat on the first metal ... 4 on the fourth
        const enchName=e=>((ELEMENTS.find(x=>x[0]===e)||[])[1]||'').replace(/ \(.*\)$/,'');
        const ringName=b=>((RINGS.find(x=>x[0]===b)||[])[1]||'').replace(/ \(.*\)$/,'');
        const spec=vv=>`${matName(vv)} ${pretty(w)} · ${pretty(vv.qual)}${vv.ench&&vv.carats?` · ${enchName(vv.ench)} ${vv.carats}c`:' · no enchant'}`;
        const ups=[];const add=(label,vv,note)=>{const m=metric(vv);if(m==null)return;const d=m/now-1;if(d>.004)ups.push({label,d,note})};
        const t0=+base.tier||0;
        for(let t=t0+1;t<=4;t++){
          if(!lvOk(t)){ups.push({label:`${matName({weapon:w,tier:t})} ${pretty(w)}`,future:`needs level ${EQUIP_LEVEL[t]}${EQUIP_ATTR[t]&&((+v.str||0)||(+v.dex||0))?' and '+EQUIP_ATTR[t]+' '+equipStat(w).toUpperCase():''}`});break}
          const qn=realQ(t),c=Math.min(+base.carats||0,capOf(t)),vv={...base,tier:t,qual:qn,carats:c};
          add(spec(vv),vv,cantMake(t)||(qn!==base.qual?`a new weapon: ${pretty(qn)} is the most to expect ${smithTxt}`:'a new weapon')+(c?'; it needs its own enchant':''));
        }
        for(const qn of [QUALITIES[qi(base.qual)+1]&&QUALITIES[qi(base.qual)+1][0],'flawless'])if(qn&&qi(qn)>qi(base.qual)&&!ups.some(u=>u.q===qn)){const vv={...base,qual:qn},n0=ups.length;add(spec(vv),vv,qNote(qn,t0));if(ups.length>n0)ups[ups.length-1].q=qn}
        const cap=capOf(t0);
        if(!base.ench||!(+base.carats>0)){for(const c of [3,6,9].filter(c=>c<=cap)){const vv={...base,ench:'destruction',carats:c};add(spec(vv),vv,caratNote(c/3,'gems')||`three ${c/3}-carat rubies`)}}
        else if(+base.carats<cap){const c=Math.min(cap,+base.carats+3),vv={...base,carats:c};add(spec(vv),vv,c>6?'needs '+caratNote(Math.ceil(c/3),'gems').replace(' are ',': '):'')}
        const rings=[0,1].map(i=>({...(base.rings[i]||{})}));
        let emptyDone=false;for(const i of [0,1]){const r=rings[i];
          if(!r.bonus||!(+r.carat>0)){if(emptyDone)continue;emptyDone=true;for(const c of [2,3]){let best=null;for(const [b] of RINGS){if(!b)continue;const rr=rings.map((x,j)=>j===i?{bonus:b,carat:c}:x),m=metric({...base,rings:rr});if(m&&(!best||m>best.m))best={b,m,rr}}
              if(best)add(`Ring ${i+1}: ${ringName(best.b)} ${c}c`,{...base,rings:best.rr},caratNote(c,'rings')||'a silver ring or better')}}
          else if(+r.carat<4){const c=+r.carat+1,rr=rings.map((x,j)=>j===i?{...x,carat:c}:x);add(`Ring ${i+1}: ${ringName(r.bonus)} ${c}c`,{...base,rings:rr},caratNote(c,'rings'))}}
        const vr=u=>/very rare|no one can make/.test(u.note||'')?2:/rare|uncommon/.test(u.note||'')?1:0;
        ups.sort((a,b)=>(a.future?1:0)-(b.future?1:0)||vr(a)-vr(b)||(b.d||0)-(a.d||0));
        // what to aim for: the best metal you can wield that a smith can make, at the quality they realistically make,
        // an enchant of three 2-carat gems, and both rings at 2 carats (as far as the gem combiner goes)
        let aT=t0;for(let t=t0+1;t<=4;t++)if(lvOk(t)&&!cantMake(t))aT=t;
        const aQ=aT!==t0?realQ(aT):(qi(realQ(aT))>qi(base.qual)?realQ(aT):base.qual),aE=base.ench||'destruction',aC=Math.max(+base.carats||0,Math.min(3*REAL_CARAT,capOf(aT)));
        const aR=rings.map((r,i)=>{if(r.bonus&&+r.carat>=REAL_CARAT)return r;let best=null;for(const [b] of RINGS){if(!b)continue;const rr=rings.map((x,j)=>j===i?{bonus:b,carat:REAL_CARAT}:x),m=metric({...base,tier:aT,qual:aQ,ench:aE,carats:aC,rings:rr});if(m&&(!best||m>best.m))best={b,m}}return best?{bonus:r.bonus||best.b,carat:Math.max(+r.carat||0,REAL_CARAT)}:r});
        const aV={...base,tier:aT,qual:aQ,ench:aE,carats:aC,rings:aR},aM=metric(aV),aD=aM!=null?aM/now-1:0;
        const unit=isChar?'XP a minute':(rows.some(r=>r.xp!=null)?'XP a minute':'kills a minute');
        const aimLine=aD>.004?`<p class="tool-answer"><b>Aim for:</b> ${esc(spec(aV))}${aR.some(r=>r.bonus)?`, rings ${aR.filter(r=>r.bonus).map(r=>esc(ringName(r.bonus))+' '+r.carat+'c').join(' + ')}`:''}: <b>+${(aD*100).toFixed(aD<.1?1:0)}%</b> ${unit} over what you have.</p>`:`<p class="tool-answer">Your ${esc(pretty(w).toLowerCase())} is as good as it realistically gets at level ${charLv}.</p>`;
        const pp=d=>'+'+(d*100).toFixed(d<.1?1:0)+'%';
        return `<section><h2>Upgrades worth making at level ${charLv}</h2><p class="g-note">${suggest?'Suggested':'You now'}: ${esc(spec(base))}${rings.some(r=>r.bonus&&+r.carat>0)?', rings '+rings.filter(r=>r.bonus&&+r.carat>0).map(r=>esc(ringName(r.bonus))+' '+r.carat+'c').join(' + '):''}.</p>`+aimLine+
          (ups.length?table(['Upgrade',isChar?'XP / min':'Gain','Note'],ups.map(u=>u.future?[esc(u.label),'—',esc(u.future)]:[esc(u.label),pp(u.d),u.note?(/rare|uncommon/.test(u.note)&&globalThis.bxcRarityChip?globalThis.bxcRarityChip(esc(u.note)):`<span class="${vr(u)?'tag-chip resist':'muted'}">${esc(u.note)}</span>`):''])):'')+
          `<p class="g-note">Scored on your best monster at level ${charLv}. How often a quality comes out depends on how far the best smith is over the weapon’s recipe (${esc(smithTxt)}${sm?'':', assumed'}); under 10% is marked very rare and left out of “Aim for”, as are gems and rings over 2 carats (the gem combiner makes up to 2; 3 is rare, 4 very rare). An enchant is three gems: three 2-carat gems make 6 carats.</p></section>`;
      })();
      el('cmbPlanOut').innerHTML=
        `<section><h2>Your plan</h2><p class="tool-answer">Level <b>${level}</b> → <b>${goal}</b>: <b>${n(toGo)}</b> ${isChar?'character':esc(skill.toLowerCase())} XP to go${best&&kills?`, about <b>${n(kills)}</b> kills of ${mon(best.m,best.m.name)}${best.ttk?` (≈ ${n(kills*best.ttk/60)} min of fighting)`:''}`:''}.</p>
          ${wh&&wh.spell?`<p class="g-note">${suggest?'Suggested':'Your'} ${esc(wLabel(shownV.weapon))}: ${wh.phys.toFixed(1)} ${esc(wh.type)} a cast on average, one cast every ${wh.swing.toFixed(1)} s, casting ${esc(wh.spell.used.join(', '))}${wh.spell.steps?` (the staff adds ${wh.spell.steps} steps${wh.spell.bound?` and ${wh.spell.intBonus} from INT; school counts as ${wh.spell.slvEff}`:''})`:''}. From the game’s spell formula; the rotation waits out each spell level’s cooldown and 2.4 s between casts, and mana is not counted.</p>`:''}${wh&&!wh.spell?`<p class="g-note">${suggest?'Suggested':'Your'} ${esc(pretty(shownV.weapon))} (${esc(matName(shownV))}, ${esc(shownV.qual)}${shownV.ench&&shownV.carats?`, ${esc((ELEMENTS.find(e=>e[0]===shownV.ench)||[])[1])} ${shownV.carats}c`:''}): ${wh.phys.toFixed(1)} ${esc(wh.type)} a hit on average (${esc(wh.stat==='strength'?'STR':'DEX')} adds ${Math.round(wh.statBonus*100)}% of the roll)${wh.elemType?` + ${wh.elem.toFixed(1)} ${esc(wh.elemType)}`:''}, one ${/bow/.test(shownV.weapon)?'shot':'swing'} every ${wh.swing.toFixed(1)} s, ${Math.round(wh.crit*100)}% crits. The game’s own formula; the monster’s armor may soak a little of each hit.</p>`:''}</section>`+
        pathHtml+upgHtml+pickHtml+`<section><h2>Best monsters for ${suggest&&picks[0]?(isSpell(picks[0].w)?esc(wLabel(picks[0].w)):'the '+esc(pretty(picks[0].w))):(isSpell(v.weapon)?esc(wLabel(v.weapon)):'your weapon')}</h2>${top.length?table(['Monster','Lv','HP','XP per kill','Against your hit','Hit','Kill','XP / min',...(barCol?[barCol]:[])],top.map(r=>[mon(r.m,r.m.name),n(r.L),n(r.st.hp),r.xp!=null?n(r.xp)+(r.share<1?` <span class="muted" title="${n(r.st.xp)} at full: ${charLv-r.L} levels below you">(${Math.round(r.share*100)}%)</span>`:'')+(r.xpSrc==='yours'?' <span class="muted">(yours)</span>':''):'<span class="muted">not measured</span>',wh?(chip(wh.type,r.m)+(wh.elemType?chip(wh.elemType,r.m):''))||'<span class="muted">normal</span>':weakLine(r.m),`${Math.round(r.h.c*100)}%${r.h.src==='est.'?' <span class="muted">est.</span>':''}`,r.ttk?r.ttk.toFixed(1)+' s':'—',r.xpMin!=null?n(r.xpMin):'—',...(barCol?[r.dry==null?'<span class="gp-ok">fits</span>':`<span class="gp-no">dry at ${Math.round(r.dry*100)}%</span>`]:[])]))+
          `<p class="g-note">Monsters from 9 levels below to 10 above your character, at the level you usually meet them.${isChar?` Kill XP is full down to ${KILL_XP_FULL_BELOW} levels below you and falls to nothing at ${KILL_XP_ZERO_BELOW} below (the % shows what is left).`:''} Kill time is swinging back to back with your hit chance; walking, their attacks and eating are not counted. “Hit” is the chance the server told you against that monster${Object.keys(hits).length?'':' — none recorded yet, so it is estimated from the level gap'}; “est.” means no attacks on it at your level yet.</p>`
          :'<p class="muted">No monsters around this level.</p>'}</section>`;
      const bm=best&&best.m;
      el('cmbPlanAside').innerHTML=bm?`<div class="wp-pic"><img src="${esc(monImg(bm))}" alt=""></div><h3>${esc(bm.name)}</h3><table>
        <tr><th>Level</th><td>${best.L}${best.L!==bm.baseLevel?` <span class="muted">(base ${bm.baseLevel})</span>`:''}</td></tr>
        <tr><th>Hit points</th><td>${n(best.st.hp)}</td></tr><tr><th>XP per kill</th><td>${best.xp!=null?n(best.xp)+(best.share<1?` <span class="muted">(${Math.round(best.share*100)}% of ${n(best.st.xp)})</span>`:''):'—'}</td></tr>
        <tr><th>Attacks with</th><td>${esc(bm.attackType||'—')}${best.st.dmg?' · '+best.st.dmg+' dmg':''}</td></tr>
        <tr><th>Weak to</th><td>${esc(list(bm.weakTo).join(', ')||'—')}</td></tr><tr><th>Resists</th><td>${esc(list(bm.resists).join(', ')||'—')}</td></tr>
        ${wh?`<tr><th>Your hit</th><td>${Math.round(best.h.c*100)}% · ${best.perHit.toFixed(1)} dmg</td></tr><tr><th>Kill time</th><td>${best.ttk.toFixed(1)} s</td></tr>`:''}
        <tr><th>XP to go</th><td>${n(toGo)}</td></tr></table>
        <p class="g-aside-h">Guides</p><ul class="g-toc"><li><a href="#/guide/combat">Combat</a></li><li><a href="#/guide/special-attacks">Weapon skills &amp; specials</a></li><li><a href="#/guide/monsters-by-level">Monsters by level</a></li></ul>`
        :`<h3>${esc(isChar?'Character level':skill)}</h3><table><tr><th>Your level</th><td>${level}</td></tr><tr><th>Goal</th><td>${goal}</td></tr><tr><th>XP to go</th><td>${n(toGo)}</td></tr></table>`;
    }
    el('cmbSkill').addEventListener('change',()=>{goalTouched=false;el('cmbInto').value='0';run()});
    el('cmbLevel').addEventListener('input',()=>{goalTouched=false;run()});
    for(const id of ['cmbInto','cmbChar','cmbCarat','cmbStr','cmbDex','cmbSpd'])el(id)&&el(id).addEventListener('input',run);
    for(const id of ['cmbRingC0','cmbRingC1','cmbSmith'])el(id)&&el(id).addEventListener('input',run);
    el('cmbAmmo')&&el('cmbAmmo').addEventListener('change',run);
    for(const id of ['cmbRing0','cmbRing1'])el(id)&&el(id).addEventListener('change',run);
    // In the app, the boxes follow your character: its equipped weapon (item, material, quality, enchant, carats), rings
    // and stats, refreshed whenever new data arrives (bxcCombatSync). Changing a box yourself switches to your own
    // numbers (the switch goes off); anyone without the collector just fills the boxes in, and they are remembered.
    let lastGearSig='';
    function followGear(){
      const f=el('cmbFollow');if(!f||!f.checked)return false;
      const gear=globalThis.bxcCharGear?globalThis.bxcCharGear():null,cs=globalThis.bxcCharStats?globalThis.bxcCharStats():null;
      const sig=JSON.stringify([gear,cs]);if(sig===lastGearSig)return false;lastGearSig=sig;
      const mh=gear&&gear.mainHand,wi=mh&&weaponFromItem(mh.typeId);
      if(wi&&[...el('cmbWeapon').options].some(o=>o.value===wi.weapon)){el('cmbWeapon').value=wi.weapon;fillTiers();el('cmbTier').value=String(wi.tier);
        el('cmbQual').value=mh.quality||'ordinary';el('cmbEnch').value=mh.kind==='enchant'&&ENCH_OF[mh.enchant]?ENCH_OF[mh.enchant]:'';el('cmbCarat').value=String(mh.kind==='enchant'&&mh.carat?mh.carat:0)}
      for(const [i,slot] of [[0,'ring1'],[1,'ring2']]){const r=gear&&gear[slot],gem=r&&String(r.typeId).split('-').pop(),b=(globalThis.BXC_GAME_DATA?.rings||[]).find(x=>x.gem===gem)?.bonus;
        const fight=!!b&&RINGS.some(x=>x[0]===b);el('cmbRing'+i).value=fight?b:'';el('cmbRingC'+i).value=String(fight&&r.carat||0)}
      {const pl=globalThis.bxcCharPools&&globalThis.bxcCharPools(),bs=globalThis.bxcCharBaseStats&&globalThis.bxcCharBaseStats();if(pl){if(Number.isFinite(+pl.mana))el('cmbMana').value=String(pl.mana);if(Number.isFinite(+pl.stamina))el('cmbStam').value=String(pl.stamina)}linkSpdBase=bs&&Number.isFinite(+bs.speed)?+bs.speed:null}
      if(cs)for(const [id,k] of [['cmbStr','strength'],['cmbDex','dexterity'],['cmbSpd','speed'],['cmbInt','intellect'],['cmbMag','magic']])if(Number.isFinite(+cs[k]))el(id).value=String(cs[k]);
      const cc=globalThis.bxcCharClass&&globalThis.bxcCharClass();if(cc&&el('cmbClass').value!==cc){el('cmbClass').value=cc;setClass(cc);fillTiers()}
      const sc=isSpell(el('cmbWeapon').value)?el('cmbWeapon').value.slice(6):null,slv=sc&&globalThis.bxcSkillLevel?globalThis.bxcSkillLevel(sc):null;if(slv)el('cmbSlv').value=String(slv);
      return true;
    }
    for(const id of ['cmbWeapon','cmbTier','cmbQual','cmbEnch','cmbCarat','cmbStr','cmbDex','cmbSpd','cmbRing0','cmbRing1','cmbRingC0','cmbRingC1'])
      el(id)&&el(id).addEventListener(el(id).tagName==='SELECT'?'change':'input',e=>{if(e.isTrusted&&el('cmbFollow')&&el('cmbFollow').checked){el('cmbFollow').checked=false;run()}});
    el('cmbFollow')&&el('cmbFollow').addEventListener('change',()=>{lastGearSig='';followGear();run()});
    globalThis.bxcCombatSync=()=>{if(!document.getElementById('cmbPlanOut'))return;if(followGear())run()};
    followGear();
    // Gear & DPS -> this page: class, weapon or staff, stats with enchants, rings, ammo, your rotation and the bars
    function fromGear(){let g={};try{g=JSON.parse(localStorage.getItem('bxcGearPlanner')||'{}')}catch{}
      if(!g.cls){el('cmbFromGearNote').textContent='Set up a loadout in Calculators > Gear & DPS first.';return}
      if(el('cmbFollow'))el('cmbFollow').checked=false;
      el('cmbClass').value=g.cls;setClass(g.cls);
      const w=g.cls==='mage'?'spell:'+g.school:g.weapon;if([...el('cmbWeapon').options].some(o=>o.value===w))el('cmbWeapon').value=w;fillTiers();ammoView();setRingOpts(['cmbRing0','cmbRing1'],g.cls,w);
      const set=(id,val)=>{if(el(id)&&val!=null)el(id).value=String(val)};
      set('cmbTier',g.tier);set('cmbQual',g.qual);set('cmbEnch',g.ench);set('cmbCarat',g.carats);set('cmbAmmo',g.ammo||'');
      const t=g.totals||g.stats||{};set('cmbStr',t.str);set('cmbDex',t.dex);set('cmbSpd',t.spd);set('cmbInt',t.int);set('cmbMag',t.mag);
      set('cmbStaff',g.staff);set('cmbSQual',g.squal);set('cmbSC',g.sc);set('cmbSlv',g.slv);
      (g.rings||[]).forEach((r,i)=>{set('cmbRing'+i,r.bonus||'');set('cmbRingC'+i,r.carat||0)});
      set('cmbMana',g.poolMax&&g.poolMax.mana);set('cmbStam',g.poolMax&&g.poolMax.stam);set('cmbTiles',g.tiles);
      linkSpdBase=g.stats?g.stats.spd:null;linkRotation=g.cls==='mage'&&Array.isArray(g.rotation)&&g.rotation.length?g.rotation:null;
      el('cmbFromGearNote').textContent='Loaded from Gear & DPS'+(linkRotation?' (your spell rotation too)':'')+'. Change anything here and it stays here.';
      goalTouched=false;run()}
    el('cmbFromGear')&&el('cmbFromGear').addEventListener('click',fromGear);
    // editing the stats or the weapon by hand drops the linked rotation and base SPD
    for(const id of ['cmbWeapon','cmbSpd'])el(id)&&el(id).addEventListener(el(id).tagName==='SELECT'?'change':'input',e=>{if(e.isTrusted){linkRotation=null;linkSpdBase=null}});
    for(const id of ['cmbMana','cmbStam','cmbTiles'])el(id)&&el(id).addEventListener('input',run);
    // Quality and carats start at what the best smith realistically makes of this weapon (you can change them after);
    // they are filled again when the weapon, material or smith level changes - not while following your equipped gear
    const ownSmith=w=>globalThis.bxcSkillLevel?globalThis.bxcSkillLevel(smithSkillOf(w)):null;
    function setRingBoxes(rings){(rings||[]).forEach((r,i)=>{if(el('cmbRing'+i)){el('cmbRing'+i).value=r.bonus||'';el('cmbRingC'+i).value=String(r.bonus?r.carat:0)}})}
    // what the boxes say right now (for working out the best rings)
    function readV(){return {weapon:el('cmbWeapon').value,tier:+el('cmbTier').value,qual:el('cmbQual').value,ench:el('cmbEnch').value,carats:+el('cmbCarat').value||0,str:+el('cmbStr').value||0,dex:+el('cmbDex').value||0,spd:+el('cmbSpd').value||0,int:+el('cmbInt').value||0,mag:+el('cmbMag').value||0,slv:+el('cmbSlv').value||0,staff:+el('cmbStaff').value||0,squal:el('cmbSQual').value,sc:+el('cmbSC').value||0,rings:[]}}
    function applyGoal(){
      const w=el('cmbWeapon').value,note=el('cmbGoalNote');if(note)note.textContent='';
      if(el('cmbSmith'))el('cmbSmith').placeholder=smithPlaceholder(w?smithSkillOf(w):'Weapon Smithing');
      if(!w||(el('cmbFollow')&&el('cmbFollow').checked))return;
      if(isSpell(w)){setRingBoxes(bestRings(w,readV()));return}
      const t=+el('cmbTier').value||0,bs=bestSmith(smithSkillOf(w),el('cmbSmith').value),sm=bs?bs.lv:null,r=realisticWeapon(w,t,sm);
      el('cmbQual').value=r.qual;
      if(r.carats){if(!el('cmbEnch').value)el('cmbEnch').value='destruction';el('cmbCarat').value=String(r.carats)}else{el('cmbEnch').value='';el('cmbCarat').value='0'}
      setRingBoxes(bestRings(w,readV()));
      if(note){const who=smithWho(bs).replace(/^(with|from) /,'');
        note.textContent=!r.canMake?`No one can make this yet: it needs ${smithSkillOf(w)} ${r.recipe} (best is ${sm}).`
          :`Filled in with what to expect ${bs?'with '+who:'from '+who}: ${pretty(r.qual)}${r.carats?`, ${r.carats} carats (three ${r.carats/3}-carat gems)`:''}. Change them to match yours.`}
    }
    if(!(el('cmbFollow')&&el('cmbFollow').checked))applyGoal();else applyGoal.call(null);
    el('cmbTarget').addEventListener('input',()=>{goalTouched=true;run()});
    for(const id of ['cmbQual','cmbEnch'])el(id)&&el(id).addEventListener('change',run);
    // changing one of those boxes while on "Best for my level" takes the suggested weapon as yours, with your change
    el('cmbWeapon').closest('.tool-form').addEventListener('change',e=>{if(e.isTrusted&&!el('cmbWeapon').value&&lastSuggested&&['cmbTier','cmbQual','cmbEnch','cmbRing0','cmbRing1'].includes(e.target.id))el('cmbWeapon').value=lastSuggested},true);
    el('cmbWeapon').closest('.tool-form').addEventListener('input',e=>{if(e.isTrusted&&!el('cmbWeapon').value&&lastSuggested&&['cmbCarat','cmbRingC0','cmbRingC1'].includes(e.target.id))el('cmbWeapon').value=lastSuggested},true);
    el('cmbTier')&&el('cmbTier').addEventListener('change',()=>{applyGoal();run()});
    el('cmbClass').addEventListener('change',e=>{if(e.isTrusted&&el('cmbFollow'))el('cmbFollow').checked=false;setClass(el('cmbClass').value);fillTiers();applyGoal();run()});
    for(const id of ['cmbInt','cmbMag','cmbSlv'])el(id).addEventListener('input',run);
    for(const id of ['cmbStaff','cmbSQual'])el(id).addEventListener('change',run);el('cmbSC').addEventListener('input',run);
    el('cmbSmith')&&el('cmbSmith').addEventListener('input',()=>{applyGoal();run()});
    el('cmbWeapon')&&el('cmbWeapon').addEventListener('change',()=>{fillTiers();ammoView();setRingOpts(['cmbRing0','cmbRing1'],el('cmbClass').value,el('cmbWeapon').value);const w=el('cmbWeapon').value;if(w&&!isSpell(w)){const lv=Math.max(1,Math.floor(+el('cmbChar').value||+el('cmbLevel').value||1));let t=Math.max(1,bestTierFor(w,lv,{str:+el('cmbStr').value||0,dex:+el('cmbDex').value||0}));const bs=bestSmith(smithSkillOf(w),el('cmbSmith').value);while(t>1&&!realisticWeapon(w,t,bs?bs.lv:null).canMake)t--;el('cmbTier').value=String(t)}applyGoal();run()});
    el('cmbPlanOut').addEventListener('click',e=>{const b=e.target.closest('.cmb-use');if(!b)return;
      if(el('cmbFollow')&&el('cmbFollow').checked)el('cmbFollow').checked=false;
      el('cmbWeapon').value=b.dataset.w;fillTiers();el('cmbTier').value=b.dataset.t;el('cmbEnch').value='';applyGoal();run();
      el('cmbWeapon').scrollIntoView({block:'center',behavior:'smooth'})});
    run();
    loadHits().then(h=>{hits=h||{};if(document.getElementById('cmbPlanOut'))run()});
    if(!lbTops)loadTops().then(t=>{if(t&&document.getElementById('cmbPlanOut')){applyGoal();run()}});
  }
  globalThis.renderCombatPlanner=renderCombatPlanner;

  // ---- Gear & DPS planner (Calculators > Gear & DPS) ---------------------------------------------------------------
  // Every slot you wear, your own stats, and the damage a second it adds up to against a monster that is neutral to,
  // resists or is weak to your damage. The maths is the combat calculator's (weaponHit / spellHit, the game's own
  // formulas). Armor enchants add 5 of their attribute per carat (3 carats per material tier); shields take no enchant;
  // pendants only defend. Resist is x0.7 and weak x1.3 per damage type, so a weapon with an elemental enchant does two
  // types at once: "double" is both of them resisted (or both weak).
  const ARMOR_SLOTS=[['head','Head'],['torso','Torso'],['arms','Arms'],['legs','Legs'],['feet','Feet']];
  const ARMOR_ENCH=[['','No enchant',null],['titan','of the Titan (STR)','str'],['camel','of the Camel (END)','end'],['weasel','of the Weasel (DEX)','dex'],['leopard','of the Leopard (SPD)','spd'],['sage','of the Sage (INT)','int'],['mage','of the Mage (MAG)','mag']];
  const ARMOR_TIERS=['None','Tier 1 (iron, imp, deerhide)','Tier 2 (silver, snakeskin, bearhide)','Tier 3 (gold, ogrewax, werewolf)','Tier 4 (titanium, dragonscale, dragonhide)'];
  const STATS=[['str','STR'],['end','END'],['dex','DEX'],['spd','SPD'],['int','INT'],['mag','MAG']];
  const POOLS=[['hp','Health'],['mana','Mana'],['stam','Stamina']];
  // armor pools (the game's rules): plate +1/3/7/12 health a piece by tier, pelt +1-4 stamina, knick +1-4 mana
  const ARMOR_KINDS=[['metal','Plate (health)','hp',[0,1,3,7,12]],['pelt','Pelt (stamina)','stam',[0,1,2,3,4]],['knick','Knick (mana)','mana',[0,1,2,3,4]]];
  const STAT_KEY={str:'strength',end:'endurance',dex:'dexterity',spd:'speed',int:'intellect',mag:'magic'};
  // Every spell of a school (the game's spell list): what it needs, what it does with this loadout (the same sum as
  // spellHit: the roll plus the staff's steps, times the staff's quality, plus magScale per full 10 MAG above 10, plus
  // a point per full 10 INT on a bound staff, times Adept rings), and whether the rotation uses it.
  function spellsHtml(school,v,wh){
    const pick=v.only||[];
    const G=globalThis.BXC_GAME_DATA||{},list=(G.spells||[]).filter(sp=>sp.school===school).sort((a,b)=>a.level-b.level);
    if(!list.length)return '<p class="muted">No spells known for this school.</p>';
    const INT=Math.max(0,+v.int||0),MAG=Math.max(0,+v.mag||0),st=Math.max(0,Math.min(4,+v.staff||0)),steps=STAFF_STEPS[st],qm=1+((QUALITIES.find(x=>x[0]===v.squal)||[0,0])[1]||0);
    const bound=st>0&&+v.sc>0,intBonus=bound?Math.floor(INT/10):0,slvEff=Math.max(0,+v.slv||0)+(bound?+v.sc:0),magSteps=Math.floor(Math.max(0,MAG-10)/10);
    const rc=b=>(v.rings||[]).filter(r=>r&&r.bonus===b).reduce((a,r)=>a+ringPct(b,r.carat),0),adept=(1+rc('adept'))*(1+rc('reaper')*.3),used=new Set(wh&&wh.spell?wh.spell.used:[]);
    const rows=list.map(sp=>{const on=pick.includes(sp.id),needInt=sp.intRequirement||10*sp.level,needSl=SPELL_SCHOOL_REQ[sp.level]||0,miss=[INT<needInt?`${needInt} INT`:'',slvEff<needSl?`school ${needSl}`:''].filter(Boolean);
      const dmg=sp.effect==='damage'?((((sp.baseDamageMin+sp.baseDamageMax)/2+sp.magScale*steps)*qm+sp.magScale*magSteps)+intBonus)*adept:null;
      const extra=[sp.splashRadius?`splash ${sp.splashRadius} tiles at ${Math.round((sp.splashDamageMult||1)*100)}%`:'',sp.aoeRadius?`area ${sp.aoeRadius} tiles`:'',sp.projectile?'projectile':''].filter(Boolean).join(', ');
      const chips=((pick.length?on:used.has(sp.name))?`<span class="tag-chip ${pick.length?'gp-pick':'weak'}">in rotation</span>`:'<span class="tag-chip gp-out">out of rotation</span>');
      return [`<span class="gp-tick">✓</span><b>${esc(sp.name)}</b>${extra?` <span class="muted">${esc(extra)}</span>`:''}<div class="gp-chips">${chips}</div>`,String(sp.level),`<span class="${INT>=needInt?'gp-ok':'gp-no'}">${needInt} INT</span>${needSl?`<br><span class="${slvEff>=needSl?'gp-ok':'gp-no'}">school ${needSl}</span>`:''}`,
        dmg!=null?`<b>${dmg.toFixed(1)}</b> <span class="muted">(${sp.baseDamageMin}-${sp.baseDamageMax} +${sp.magScale}/step)</span>`:esc(pretty(sp.effect)),
        (sp.cooldownMs/1000).toFixed(1)+' s',(sp.castTimeMs/1000).toFixed(2)+' s',String(sp.manaCost),sp.effect==='damage'?sp.id:'']});
    return `<div class="g-scroll"><table class="g-table gp-spells"><thead><tr>${['Spell','Lv','Needs','Damage a cast','Cooldown','Cast','Mana'].map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>{const id=r.pop();return `<tr${id?` data-spell="${esc(id)}" class="${pick.includes(id)?'on':''}" title="${pick.includes(id)?'Click to take it out of your rotation':'Click to add it to your rotation'}"`:''}>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`}).join('')}</tbody></table></div><p class="g-note"><b>Click spells</b> to build your own rotation and see it on the side (spells you cannot cast yet work too, as a what-if); click one again to take it out. With none picked, the side shows the best rotation of everything you can cast. Damage with this staff, INT, MAG and rings (${steps} staff step${steps===1?'':'s'}${bound?`, +${intBonus} from INT on a bound staff, school ${slvEff} with the staff's +${+v.sc}`:''}). The rotation casts the strongest spell that is ready; every cast waits at least 2.4 s. Mana is not counted.</p>`;
  }
  const pickSpells=new Set();let bestUsed=[];   // the spells the best rotation casts (ids), shown before you pick
  // ---- Where to put your points ----------------------------------------------------------------------------------
  // The game's rules and the official guide: 9 points a level, into the six stats or the three pools (1 point = 1 more);
  // STR adds 0.5 max health a point above 10; plate/pelt/knick armor add health/stamina/mana. Mana and stamina do not
  // refill during a fight, so a fight has to fit in what you carry: a mage's rotation costs mana every cast, every
  // attack costs its weapon's stamina, and with a bow or crossbow every tile you move costs 0.5 stamina (half at 40 SPD
  // from points - enchanted SPD does not count; the curve between is estimated as 0.5 x 40 / (40 + SPD)). Out of stamina
  // a shot does 40% damage and -40 to hit, so the budget comes first. A fight here is one monster of your level
  // (the game's health for that level), neutral, with your chance to hit.
  const stepCost=spdBase=>.5*40/(40+Math.max(0,spdBase-10));
  function adviceHtml(s,v,wh){
    const G=globalThis.BXC_GAME_DATA||{},mage=s.cls==='mage',w=v.weapon,ranged=/bow/.test(w||'');
    const monHp=(G.monsterLevels&&G.monsterLevels.hp&&G.monsterLevels.hp[s.level-1])||null;
    const kind=ARMOR_KINDS.find(k=>k[0]===s.akind)||ARMOR_KINDS[0],armorPool=ARMOR_SLOTS.reduce((a,[k])=>a+(kind[3][s.armor[k].t]||0),0);
    const gearAdd={};for(const [k] of STATS)gearAdd[k]=(v[k]!=null?v[k]:s.stats[k])-s.stats[k];   // what the armor enchants add
    // one loadout with these points: damage a second (neutral), what a fight costs and what you carry
    const evalPts=(st,pl,ex)=>{const vv={...v};for(const k of ['str','dex','spd','int','mag'])vv[k]=st[k]+(gearAdd[k]||0)+((ex&&ex[k])||0);
      const h=weaponHit(w,vv);if(!h)return null;const hitC=Math.min(.95,Math.max(0,s.hit/100)+(h.seeking||0)),critX=1+h.crit*(h.critMult-1);
      const dps=hitC*(h.phys+(h.elem||0))*critX/h.swing,fight=monHp&&dps>0?monHp/dps:null,attacks=fight?fight/h.swing:null;
      const need=!fight?null:mage?h.manaPerSec*fight:attacks*h.staminaCost+(ranged?s.tiles*stepCost(st.spd):0);
      const have=mage?pl.mana+(kind[2]==='mana'?armorPool:0):pl.stam+(kind[2]==='stam'?armorPool:0);
      return {dps,fight,need,have,hp:pl.hp+Math.floor(Math.max(0,st.str-10)*.5)+(kind[2]==='hp'?armorPool:0)}};
    const base=evalPts(s.stats,s.pools);if(!base)return '';
    const earned=(s.level-1)*9,spent=STATS.reduce((a,[k])=>a+s.stats[k]-10,0)+POOLS.reduce((a,[k])=>a+s.pools[k]-10,0),free=earned-spent;
    const pool=mage?'mana':'stam',poolName=mage?'Mana':'Stamina';
    // the stats that add damage for this class (END only refills health between fights; STR adds a little health too)
    const dmgStats=mage?['mag','int']:ranged?['dex','spd']:['str','spd','dex'];
    // greedy: fill the budget first, then the most damage a point (looking up to 10 points ahead for MAG and INT steps)
    const plan=(n)=>{const st={...s.stats},pl={...s.pools},add={};let cur=evalPts(st,pl);
      for(let left=n;left>0;){
        if(cur.need!=null&&cur.have<cur.need){   // short: the pool, or (bows) SPD when it saves more stamina a point
          let pick=pool,k=1;
          if(ranged){const t={...st,spd:st.spd+1},e=evalPts(t,pl);if(e&&cur.need-e.need>1)pick='spd'}
          if(pick===pool)pl[pool]+=k;else st.spd+=k;add[pick]=(add[pick]||0)+k;left-=k;cur=evalPts(st,pl);continue}
        let best=null;
        for(const k of dmgStats)for(let j=1;j<=Math.min(10,left);j++){const t={...st,[k]:st[k]+j},e=evalPts(t,pl);if(!e)continue;
          const gain=(e.dps-cur.dps)/j;if(e.need!=null&&e.have<e.need)continue;if(!best||gain>best.gain+1e-9)best={k,j,gain,e}}
        if(!best||best.gain<=1e-9){pl[pool]+=left;add[pool]=(add[pool]||0)+left;cur=evalPts(st,pl);break}   // nothing adds damage: more to spend
        st[best.k]+=best.j;add[best.k]=(add[best.k]||0)+best.j;left-=best.j;cur=best.e}
      return {add,after:cur}};
    const n=free>0?free:9,p=plan(n);
    const lbl=k=>(STATS.find(x=>x[0]===k)||POOLS.find(x=>x[0]===k)||[k,k])[1];
    const addTxt=Object.entries(p.add).filter(([,x])=>x>0).sort((a,b)=>b[1]-a[1]).map(([k,x])=>`<b>+${x} ${esc(lbl(k))}</b>`).join(', ');
    const f1=x=>x.toFixed(1),fits=b=>b.need==null?'':b.have>=b.need?`<span class="gp-ok">enough</span> for ${Math.floor(b.have/Math.max(.01,b.need))} fight${Math.floor(b.have/Math.max(.01,b.need))===1?'':'s'} on a full bar`:`<span class="gp-no">not enough</span> - you run dry ${Math.round(100*b.have/b.need)}% of the way through`;
    // what 10 more points in each would do, for comparing
    const cmp=[...dmgStats,pool].map(k=>{const st={...s.stats},pl={...s.pools};if(k===pool)pl[k]+=10;else st[k]+=10;const e=evalPts(st,pl);
      return [esc(lbl(k)),k===pool?`+10 ${poolName.toLowerCase()}`:`${e.dps>=base.dps?'+':''}${f1(e.dps-base.dps)} a second (${Math.round(100*(e.dps-base.dps)/base.dps)}%)`,e.need==null?'—':e.have>=e.need?'<span class="gp-ok">enough</span>':'<span class="gp-no">short</span>']});
    const ENCH_OF_STAT={str:'of the Titan',dex:'of the Weasel',spd:'of the Leopard',int:'of the Sage',mag:'of the Mage'};
    const encGain=dmgStats.map(k=>{const e=evalPts(s.stats,s.pools,{[k]:10});return {k,d:e?(e.dps-base.dps)/2:0}}).sort((a,b)=>b.d-a.d)[0];
    const fromEnch=Object.entries(gearAdd).filter(([,x])=>x>0).map(([k,x])=>`+${x} ${esc(lbl(k))}`).join(', ');
    const wasted=Object.entries(gearAdd).filter(([k,x])=>x>0&&!dmgStats.includes(k)).map(([k])=>esc(lbl(k)));
    const enchLine=`<p class="gp-budget"><b>Armor enchants:</b> each carat adds <b>5</b> to its stat (up to 3 carats a tier on each piece), so a carat is worth 5 points.${fromEnch?` Yours add ${fromEnch}.`:''}${wasted.length?` <span class="gp-no">${wasted.join(' and ')} add${wasted.length===1?'s':''} nothing to your damage${mage?' (spells do not use it)':''}.</span>`:''}${encGain&&encGain.d>0?` Here a carat is worth most as <b>${ENCH_OF_STAT[encGain.k]}</b> (${esc(lbl(encGain.k))}): +${f1(encGain.d)} damage a second.`:''} Enchanted stats count for damage and attack speed only: health from STR, stamina refill from SPD${ranged?', the cheaper steps from SPD':''} come from points alone.${mage?' Knick armor also adds mana a piece, which enchants cannot.':''}</p>`;
    return `<p>Level ${s.level}: <b>${earned}</b> points earned, <b>${spent}</b> spent${free>0?`, <b>${free}</b> to spend`:free<0?`, <span class="gp-no">${-free} more than you have</span>`:''}.</p>
      ${monHp?`<div class="gp-budget"><b>${poolName} for a fight:</b> a level ${s.level} monster (${monHp} health) takes about <b>${Math.round(base.fight)} s</b> and <b>${f1(base.need)}</b> ${poolName.toLowerCase()}${mage?' (your rotation)':ranged?` (${Math.round(base.fight/wh.swing)} shots and ${s.tiles} tiles)`:' (your swings)'}; you carry <b>${Math.round(base.have)}</b>: ${fits(base)}.${mage?' Mana does not refill during a fight.':' Stamina does not refill during a fight'+(ranged?'; out of it, shots do 40% damage and lose 40 to hit.':'.')}</div>`:''}
      <p class="gp-plan">${free>0?`Your ${n} free points`:'Your next level (9 points)'}: ${addTxt||'nothing adds damage'} - damage a second <b>${f1(base.dps)}</b> → <b>${f1(p.after.dps)}</b>${p.after.need!=null?`, ${poolName.toLowerCase()} ${fits(p.after)}`:''}.</p>
      ${table(['10 more points in','Damage','A fight'],cmp)}
      ${enchLine}
      <p class="g-note">${poolName} comes first, so a fight never runs dry; then whatever adds the most damage a point (MAG and INT count in steps of 10). ${mage?'INT also opens higher spells (10 a spell level) and adds to a bound staff.':''} END only refills health between fights, and your health (${base.hp}) is not part of this.${mage?' Short on mana? Click spells above to try a cheaper rotation: level 4 spells cost 30 mana a cast, level 1 spells 3.':''}${ranged?' The cost of a tile with SPD is estimated between the two points the guide gives (0.5 at none, half at 40).':''}</p>`;
  }
  function renderGearPlanner(){
    let saved={};try{saved=JSON.parse(localStorage.getItem('bxcGearPlanner')||'{}')}catch{}
    if(!pickSpells.size&&Array.isArray(saved.rotation))for(const x of saved.rotation)pickSpells.add(x);   // your rotation, kept
    const G=globalThis.BXC_GAME_DATA||{},allWeapons=G.weapons?Object.keys(G.weapons):[];
    const opt=(list,cur)=>list.map(([k,l])=>`<option value="${esc(k)}"${String(k)===String(cur??'')?' selected':''}>${esc(l)}</option>`).join('');
    const num=(id,label,val,max,title)=>`<label${title?` title="${esc(title)}"`:''}>${label}<input id="${id}" type="number" min="0" max="${max}" step="1" value="${Number(val)||0}"></label>`;
    const cls=['warrior','archer','mage'].includes(saved.cls)?saved.cls:(globalThis.bxcCharClass&&globalThis.bxcCharClass())||'warrior';
    const pend=(G.pendants||[]).map(p=>[p.gem,pretty(p.bonus)+' ('+pretty(p.gem)+')']);
    content.innerHTML=`<article class="wp tool-wp gear-wp"><div class="wp-main">
      <p class="wp-lede">Put together a whole loadout - weapon, armor, rings and your own stats - and see the damage a second it does against monsters that are neutral to it, resist it or are weak to it.</p>
      ${typeof globalThis.bxcCharGear==='function'&&!globalThis.BXC_PUBLIC?'<p><button type="button" id="gpMine" class="gp-mine">Fill in my character</button> <span id="gpMineNote" class="muted"></span></p>':''}
      <section><h2>Class and weapon</h2><div class="tool-form gp-row">
        <label>Class<select id="gpClass">${opt([['warrior','Warrior'],['archer','Archer'],['mage','Mage']],cls)}</select></label>
        <label class="gp-w">Weapon<select id="gpWeapon"></select></label>
        <label class="gp-w">Material<select id="gpTier"></select></label>
        <label class="gp-w">Quality<select id="gpQual">${opt(QUALITIES.map(([k])=>[k,pretty(k)]),saved.qual||'ordinary')}</select></label>
        <label class="gp-w">Enchant<select id="gpEnch"></select></label>
        ${num('gpCarat','Carats',saved.carats,12,'Three gems; their carats added up, up to 3 per material tier')}
        <label class="gp-ammo">Arrows<select id="gpAmmo">${opt(AMMO.map(a=>[a[0],a[1]]),saved.ammo||'')}</select></label>
        <label class="gp-m">School<select id="gpSchool">${opt(Object.keys(SCHOOL_ELEM).map(k=>[k,pretty(k)]),saved.school||'fire')}</select></label>
        <label class="gp-m">Staff<select id="gpStaff">${opt(STAFF_WOODS.map((l,i)=>[i,l]),saved.staff||0)}</select></label>
        <label class="gp-m">Staff quality<select id="gpSQual">${opt(QUALITIES.map(([k])=>[k,pretty(k)]),saved.squal||'ordinary')}</select></label>
        ${num('gpSC','School carats',saved.sc,12,"The staff's school enchant: +1 to the school per carat, 3 per wood tier").replace('<label','<label class="gp-m"')}
        ${num('gpSlv','School level',saved.slv||1,100,'Spells of level 2, 3 and 4 need 5, 15 and 25 in their school').replace('<label','<label class="gp-m"')}
      </div></section>
      <section class="gp-m" id="gpSpellSec"><h2>Spells</h2><div id="gpSpells"></div></section>
      <section><h2>Armor, rings and pendant</h2><div class="tool-form gp-row"><label title="Plate adds max health, pelt max stamina, knick max mana - more at each tier">Armor type<select id="gpAKind">${opt(ARMOR_KINDS.map(([k,l])=>[k,l]),saved.akind||({warrior:'metal',archer:'pelt',mage:'knick'})[cls])}</select></label></div><div class="g-scroll"><table class="g-table gp-armor"><thead><tr><th>Slot</th><th>Material</th><th>Enchant</th><th>Carats</th></tr></thead><tbody>
        ${ARMOR_SLOTS.map(([k,l])=>{const a=(saved.armor||{})[k]||{};return `<tr><td>${l}</td><td><select id="gpA_${k}_t">${opt(ARMOR_TIERS.map((t,i)=>[i,t]),a.t||0)}</select></td><td><select id="gpA_${k}_e">${opt(ARMOR_ENCH.map(e=>[e[0],e[1]]),a.e||'')}</select></td><td><input id="gpA_${k}_c" type="number" min="0" max="12" step="1" value="${Number(a.c)||0}"></td></tr>`}).join('')}
        <tr><td>Off hand</td><td><select id="gpShield">${opt([['','Nothing'],['shield','Shield']],saved.shield||'')}</select></td><td colspan="2" class="muted">Shields take no enchant and add no damage.</td></tr>
        ${[0,1].map(i=>{const r=(saved.rings||[])[i]||{};return `<tr class="gp-jewel"><td>Ring ${i+1}</td><td class="muted">A gem of 1-4 carats (iron to titanium)</td><td><select id="gpRing${i}">${opt(RINGS,r.bonus||'')}</select></td><td><input id="gpRingC${i}" type="number" min="0" max="4" step="1" value="${Number(r.carat)||0}"></td></tr>`}).join('')}
        <tr class="gp-jewel"><td>Pendant</td><td class="muted">Defence only</td><td><select id="gpPend">${opt([['','None'],...pend],saved.pend||'')}</select></td><td><input id="gpPendC" type="number" min="0" max="4" step="1" value="${Number(saved.pendC)||0}"></td></tr>
      </tbody></table></div><p id="gpPendNote" class="g-note"></p></section>
      <section><h2>Your stats</h2><p class="g-note">Your stats with your armor enchants included (each carat adds 5); a box cannot go under what your enchants give. Everything starts at 10, and you get 9 points a level for the six stats or straight into HP, mana or stamina.</p><div class="tool-form gp-row">
        ${num('gpLevel','Character level',saved.level||20,100)}
        ${STATS.map(([k,l])=>num('gpS_'+k,l,(saved.stats||{})[k]??10,999)).join('')}
        ${POOLS.map(([k,l])=>num('gpP_'+k,k==='hp'?'HP':l,(saved.pools||{})[k]??10,999,'Each point is 1 more to the pool')).join('')}
        ${num('gpTiles','Tiles moved a fight',saved.tiles??6,99,'Bows and crossbows: every tile you move while fighting costs stamina (0.5 a tile, less with SPD)').replace('<label','<label class="gp-rng"')}
        ${num('gpHit','Chance to hit %',saved.hit||80,95,'Worked out by the game server from your level against the monster\'s: about 80% at the same level, 95% six levels above')}
      </div></section>
      <section><h2>Where to put your points</h2><div id="gpAdvice"></div></section>
    </div><aside class="wp-infobox gp-aside" id="gpAside"><h3>Damage a second</h3><div id="gpOut"></div><div id="gpTotals"></div></aside></article>`;
    const el=id=>document.getElementById(id);
    const weaponsFor=c=>allWeapons.filter(CLASS_WEAPONS[c]||(()=>true)).sort((a,b)=>c==='archer'?(/bow$/.test(a)?0:1)-(/bow$/.test(b)?0:1):0);
    function fillWeapon(keep){const c=el('gpClass').value,ws=weaponsFor(c),cur=keep||el('gpWeapon').value;
      el('gpWeapon').innerHTML=opt(ws.map(w=>[w,pretty(w)]),ws.includes(cur)?cur:ws[0]);fillTier();}
    function fillTier(keep){setRingOpts(['gpRing0','gpRing1'],el('gpClass').value,el('gpClass').value==='mage'?'spell:':el('gpWeapon').value);const w=el('gpWeapon').value,bow=/bow/.test(w),cur=keep??el('gpTier').value;
      el('gpTier').innerHTML=opt([0,1,2,3,4].map(i=>[i,i?(bow?WOODS:METALS)[i-1]:'Basic']),cur||4);
      const ec=el('gpEnch').value||saved.ench||'';el('gpEnch').innerHTML=opt(ELEMENTS.filter(([k])=>k!=='seeking'||bow),ec);
      el('gpAmmo').closest('label').firstChild.textContent=w==='crossbow'?'Bolts':'Arrows';view()}
    function view(){const c=el('gpClass').value,mage=c==='mage',bow=/bow/.test(el('gpWeapon').value);
      document.querySelectorAll('.gear-wp .gp-w').forEach(l=>l.hidden=mage);el('gpCarat').closest('label').hidden=mage;
      document.querySelectorAll('.gear-wp .gp-m').forEach(l=>l.hidden=!mage);el('gpAmmo').closest('label').hidden=mage||!bow;el('gpTiles').closest('label').hidden=mage||!bow}
    const cap=(v,t)=>Math.max(0,Math.min(3*t,Math.floor(+v||0)));
    function read(){
      const armor={};for(const [k] of ARMOR_SLOTS)armor[k]={t:+el(`gpA_${k}_t`).value||0,e:el(`gpA_${k}_e`).value,c:+el(`gpA_${k}_c`).value||0};
      const stats={};for(const [k] of STATS){const b=el('gpS_'+k);stats[k]=Math.max(10,(+b.value||0)-(+b.dataset.ench||0))}
      return {cls:el('gpClass').value,weapon:el('gpWeapon').value,tier:+el('gpTier').value||0,qual:el('gpQual').value,ench:el('gpEnch').value,carats:+el('gpCarat').value||0,ammo:el('gpAmmo').value,
        school:el('gpSchool').value,staff:+el('gpStaff').value||0,squal:el('gpSQual').value,sc:+el('gpSC').value||0,slv:+el('gpSlv').value||0,armor,shield:el('gpShield').value,
        rings:[0,1].map(i=>({bonus:el('gpRing'+i).value,carat:+el('gpRingC'+i).value||0})),pend:el('gpPend').value,pendC:+el('gpPendC').value||0,stats,hit:+el('gpHit').value||80,
        level:Math.max(1,Math.min(100,+el('gpLevel').value||1)),pools:Object.fromEntries(POOLS.map(([k])=>[k,Math.max(0,+el('gpP_'+k).value||0)])),akind:el('gpAKind').value,tiles:Math.max(0,+el('gpTiles').value||0)};
    }
    function run(){
      const s=read();
      // totals: your points plus the armor enchants (5 per carat, capped by each piece's tier)
      const tot={...s.stats},from=[];
      for(const [k,l] of ARMOR_SLOTS){const a=s.armor[k],e=ARMOR_ENCH.find(x=>x[0]===a.e),c=a.t?cap(a.c,a.t):0;if(e&&e[2]&&c){tot[e[2]]+=5*c;from.push(`${l} +${5*c} ${e[2].toUpperCase()}`)}
        if(a.c>c&&a.e)from.push(`<span class="muted">${l}: ${a.t?'tier '+a.t+' holds '+3*a.t:'no armor holds no'} carats</span>`)}
      for(const [k] of STATS){const b=el('gpS_'+k),e=tot[k]-s.stats[k];b.min=String(10+e);b.title=e?`Your ${10+e} is the least with your enchants: 10 to start + ${e} from armor enchants`:'';
        if(document.activeElement!==b&&(+b.dataset.ench!==e||+b.value<10+e)){b.dataset.ench=String(e);b.value=String(s.stats[k]+e)}}   // not while you are typing in it
      const mage=s.cls==='mage',w=mage?'spell:'+s.school:s.weapon,carats=mage?0:cap(s.carats,s.tier);
      {const ak=ARMOR_KINDS.find(k=>k[0]===s.akind)||ARMOR_KINDS[0],ap=ARMOR_SLOTS.reduce((a,[k])=>a+(ak[3][s.armor[k].t]||0),0);
        try{localStorage.setItem('bxcGearPlanner',JSON.stringify({...s,totals:tot,rotation:[...pickSpells],poolMax:{mana:s.pools.mana+(ak[2]==='mana'?ap:0),stam:s.pools.stam+(ak[2]==='stam'?ap:0)}}))}catch{}}
      const v={weapon:w,tier:s.tier,qual:s.qual,ench:s.tier?s.ench:'',carats,ammo:s.ammo,str:tot.str,dex:tot.dex,spd:tot.spd,int:tot.int,mag:tot.mag,slv:s.slv,staff:s.staff,squal:s.squal,sc:Math.min(3*s.staff,s.sc),rings:s.rings,only:mage&&pickSpells.size?[...pickSpells].filter(id=>(G.spells||[]).some(sp=>sp.id===id&&sp.school===s.school)):null};if(v.only&&!v.only.length)v.only=null;
      const wh=w?weaponHit(w,v):null;
      if(mage){el('gpSpells').innerHTML=spellsHtml(s.school,v,wh);if(!v.only)bestUsed=wh&&wh.spell?(G.spells||[]).filter(sp=>sp.school===s.school&&wh.spell.used.includes(sp.name)).map(sp=>sp.id):[]}
      const pe=(G.pendants||[]).find(p=>p.gem===s.pend),pc=Math.max(0,Math.min(4,Math.round(s.pendC)));
      el('gpPendNote').textContent=pe?(pc&&pe.text&&pe.text[pc]?pe.text[pc]+' - defence only, no damage.':'A pendant needs a gem of 1 carat or more.'):'';
      if(!wh){el('gpOut').innerHTML=`<p class="muted">${mage?'No damage spell of this school is open to you: every spell needs 10 INT per spell level, and levels 2-4 need 5, 15 and 25 in the school.':'Pick a weapon.'}</p>`;el('gpTotals').innerHTML='';el('gpAdvice').innerHTML='';return}
      const hitC=Math.min(.95,Math.max(0,s.hit/100)+(wh.seeking||0)),critX=1+wh.crit*(wh.critMult-1);
      const dps=(pm,em)=>hitC*(wh.phys*pm+(wh.elemType?wh.elem*em:0))*critX/wh.swing,f=x=>x.toFixed(1);
      const M=[['Weak',1.3],['Neutral',1],['Resists',.7]],lbl=(l,t)=>l==='Resists'?'Resists '+esc(t):l+' to '+esc(t),cell=(pm,em)=>`<b>${f(dps(pm,em))}</b>`;
      // One set of boxes: damage a second against weak / neutral / resisting monsters (the average landed hit under
      // each), then the doubles, then what one attack is. Singles: your weapon's own type weak or resisted (the
      // enchant's element neutral). Doubles need a second damage type (an elemental enchant): both weak, or both resisted.
      const two=!!(wh.elemType&&wh.elem>0),hitAvg=(pm,em)=>(wh.phys*pm+(two?wh.elem*em:0))*critX,act=mage?'cast':/bow/.test(w)?'shot':'swing';
      const card=(label,pm,em,cls)=>`<div class="gp-c ${cls||''}"><span class="gp-l">${label}</span><b>${f(dps(pm,em))}</b><span class="gp-h">${f(hitAvg(pm,em))} a hit</span></div>`;
      const stat=(label,val,sub)=>`<div class="gp-c gp-s"><span class="gp-l">${label}</span><b>${val}</b>${sub?`<span class="gp-h">${sub}</span>`:''}</div>`;
      el('gpOut').innerHTML=`<div class="gp-cards">
        ${card('Weak',1.3,1,'gp-3')}${card('Neutral',1,1,'gp-3 gp-n')}${card('Resists',.7,1,'gp-3')}
        ${two?card('Double weak',1.3,1.3,'gp-dw gp-half')+card('Double resist',.7,.7,'gp-dr gp-half')
          :`<div class="gp-c gp-na gp-full">No doubles: all your damage is ${esc(wh.type)}.${mage?'':' An elemental enchant adds a second type.'}</div>`}
        <div class="gp-sep gp-full">One ${act}${v.only?`: your rotation (${v.only.length} spell${v.only.length===1?'':'s'})`:mage?' (best rotation)':''}</div>
        ${stat('Damage',f(wh.phys+(wh.elem||0)),two?`${f(wh.phys)} ${esc(wh.type)} + ${f(wh.elem)} ${esc(wh.elemType)}`:esc(wh.type))}
        ${stat('Every',wh.swing.toFixed(2)+' s')}
        ${stat('To hit',Math.round(hitC*100)+'%',wh.seeking?'Seeking included':'')}
        ${wh.crit?stat('Crits',Math.round(wh.crit*100)+'%','×'+wh.critMult):''}
      </div>
      <p class="g-note">Damage a second, with the average landed hit${wh.crit?' (crits included)':''} under it.${two?` Single: weak to or resisting ${esc(wh.type)}. Double: ${esc(wh.type)} and ${esc(wh.elemType)} both.`:''}</p>
        ${s.ammo&&/bow/.test(w)&&s.ammo!=='bodkin'?'<p class="g-note">Poisoned ammo adds poison over time that the game works out on its server; it is not in these numbers.</p>':''}`;
      el('gpAdvice').innerHTML=adviceHtml(s,v,wh);
      const ak=ARMOR_KINDS.find(k=>k[0]===s.akind)||ARMOR_KINDS[0],ap=ARMOR_SLOTS.reduce((a,[k])=>a+(ak[3][s.armor[k].t]||0),0),strHp=Math.floor(Math.max(0,s.stats.str-10)*.5);
      const poolRow=(l,pts,parts)=>{const add=parts.filter(p=>p[0]>0);const t=pts+add.reduce((a,p)=>a+p[0],0);return `<tr><th>${l}</th><td>${t}${add.length?` <span class="muted">(${pts} + ${add.map(p=>p[0]+' '+p[1]).join(' + ')})</span>`:''}</td></tr>`};
      el('gpTotals').innerHTML=`<h3>Your totals</h3><table>${poolRow('HP',s.pools.hp,[[strHp,'STR'],[ak[2]==='hp'?ap:0,'plate']])}${poolRow('Mana',s.pools.mana,[[ak[2]==='mana'?ap:0,'knick']])}${poolRow('Stamina',s.pools.stam,[[ak[2]==='stam'?ap:0,'pelt']])}</table><table>${STATS.map(([k,l])=>`<tr><th>${l}</th><td>${tot[k]}${tot[k]!==s.stats[k]?` <span class="muted">(${s.stats[k]} + ${tot[k]-s.stats[k]})</span>`:''}</td></tr>`).join('')}</table>
        ${from.length?`<p class="g-note">${from.join('<br>')}</p>`:''}<p class="g-note">STR adds to melee damage, DEX to bows, crossbows and crits, SPD to how fast you attack (up to 1.5×), INT and MAG to spells. HP, mana and stamina take points of their own; STR adds 0.5 HP a point on top. END refills health between fights.</p>`;
    }
    // your character, in the app: class, what you wear and your own points (the game's stats without gear)
    function fillMine(){
      const gear=globalThis.bxcCharGear&&globalThis.bxcCharGear(),base=globalThis.bxcCharBaseStats&&globalThis.bxcCharBaseStats(),cc=globalThis.bxcCharClass&&globalThis.bxcCharClass();
      if(!gear){el('gpMineNote').textContent='No equipment recorded for this character yet.';return}
      if(cc){el('gpClass').value=cc;fillWeapon()}
      const MAT=G.materials||{},tierOf=id=>{const m=Object.keys(MAT).filter(k=>String(id).startsWith(k+'-')).sort((a,b)=>b.length-a.length)[0];return m?MAT[m].tier:0};
      for(const [slot,it] of Object.entries(gear)){if(!it||!it.typeId)continue;const id=it.typeId;
        const part=ARMOR_SLOTS.find(([k])=>new RegExp('-'+k+'$').test(id)||(k==='head'&&/helm$/.test(id)));
        if(part){const k=part[0],e=ARMOR_ENCH.find(x=>x[0]&&String(it.enchant||'').includes(x[0]));el(`gpA_${k}_t`).value=String(tierOf(id));el(`gpA_${k}_e`).value=e?e[0]:'';el(`gpA_${k}_c`).value=String(e&&it.carat||0);continue}
        if(/shield/.test(id)){el('gpShield').value='shield';continue}
        if(/^pendant-/.test(id)){el('gpPend').value=id.replace(/^pendant-/,'');el('gpPendC').value=String(it.carat||0);continue}
        if(slot==='mainHand'){const wi=weaponFromItem(id);if(wi&&[...el('gpWeapon').options].some(o=>o.value===wi.weapon)){el('gpWeapon').value=wi.weapon;fillTier(String(wi.tier));el('gpQual').value=it.quality||'ordinary';el('gpEnch').value=it.kind==='enchant'&&ENCH_OF[it.enchant]?ENCH_OF[it.enchant]:'';el('gpCarat').value=String(it.kind==='enchant'&&it.carat||0)}
          else if(/staff|wand/.test(id)){el('gpStaff').value=String(/wand/.test(id)?0:tierOf(id));el('gpSQual').value=it.quality||'ordinary';const sch=Object.keys(SCHOOL_ELEM).find(k=>String(it.enchant||'').includes(k==='ice'?'ice':k));if(sch)el('gpSchool').value=sch;el('gpSC').value=String(it.carat||0)}}
      }
      for(const [i,slot] of [[0,'ring1'],[1,'ring2']]){const r=gear[slot],gem=r&&String(r.typeId).split('-').pop(),b=(G.rings||[]).find(x=>x.gem===gem)?.bonus;const ok=!!b&&RINGS.some(x=>x[0]===b);el('gpRing'+i).value=ok?b:'';el('gpRingC'+i).value=String(ok&&r.carat||0)}
      if(base)for(const [k] of STATS)if(Number.isFinite(+base[STAT_KEY[k]])){el('gpS_'+k).value=String(base[STAT_KEY[k]]);el('gpS_'+k).dataset.ench='0'}   // own points; run() adds the enchants back on
      const sch=el('gpSchool').value,slv=globalThis.bxcSkillLevel&&globalThis.bxcSkillLevel(sch);if(slv)el('gpSlv').value=String(slv);
      el('gpMineNote').textContent=base?'':'Your stats without gear were not recorded; fill them in.';view();run();
    }
    el('gpClass').addEventListener('change',()=>{el('gpAKind').value=({warrior:'metal',archer:'pelt',mage:'knick'})[el('gpClass').value]||'metal';fillWeapon();run()});   // each class's own armor
    el('gpWeapon').addEventListener('change',()=>{fillTier();run()});
    el('gpTier').addEventListener('change',run);
    content.querySelector('.gear-wp').addEventListener('input',e=>{if(e.target.matches('input'))run()});
    content.querySelector('.gear-wp').addEventListener('change',e=>{if(e.target.matches('select')&&!['gpClass','gpWeapon','gpTier'].includes(e.target.id))run()});
    el('gpMine')&&el('gpMine').addEventListener('click',fillMine);
    for(const [k] of STATS)el('gpS_'+k).addEventListener('change',run);
    el('gpSpells').addEventListener('click',e=>{const r=e.target.closest('tr[data-spell]');if(!r)return;const id=r.dataset.spell;if(!pickSpells.size)for(const x of bestUsed)pickSpells.add(x);if(pickSpells.has(id))pickSpells.delete(id);else pickSpells.add(id);run()});
    el('gpSchool').addEventListener('change',()=>{pickSpells.clear()});
    fillWeapon(saved.weapon);if(saved.tier!=null)fillTier(String(saved.tier));if(saved.ench)el('gpEnch').value=saved.ench;
    run();
  }
  globalThis.renderGearPlanner=renderGearPlanner;
})();
