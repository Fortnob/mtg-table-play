/* MTG Table Play: automation extension for thirteen cards, Commander replacement choices,
   visible cost adjustments, and hot-path optimizations. Loaded after the main game scripts. */
(function (MTG) {
  'use strict';
  if (!MTG || !MTG.rules || !MTG.scripts || !MTG.scripts.all || MTG._tablePlayAutomationPatch) return;
  MTG._tablePlayAutomationPatch = true;
  const Game = MTG.rules.Game, SUSPEND = MTG.rules.SUSPEND, scripts = MTG.scripts.all;
  const canon = n => String(n || '').toLowerCase().replace(/[’‘]/g, "'");
  const install = (name, script) => { scripts[MTG.scripts.keyFor(name)] = script; };

  install("Anzrag's Rampage", { abilities: [{ kind:'spell', auto:true,
    text:"Destroy all artifacts you don't control. Then exile the top X cards of your library, where X is the number of artifacts put into graveyards from the battlefield this turn. You may put a creature card exiled this way onto the battlefield. It gains haste. Return it to its owner's hand at the beginning of the next end step.",
    effects:[{op:'mtgAutoAnzragRampage'}] }] });
  install('Avoid Fate', { abilities:[{ kind:'spell', auto:true,
    text:'Counter target instant or Aura spell that targets a permanent you control.',
    effects:[{op:'counterSpell',targets:[{type:'spell',zone:'stack',filter:'instant or Aura spell',targetsWhat:'permanent',targetsYour:'permanent'}]}] }] });
  install('Party Dude', { abilities:[
    {kind:'triggered',event:'etb',self:true,auto:true,text:'When this Class enters, each player creates a Food token.',effects:[{op:'mtgAutoPartyDudeFood'}]},
    {kind:'activated',auto:true,cost:{mana:'{1}{G}',tap:false,other:[]},sorcerySpeed:true,text:'{1}{G}: Level 2',effects:[{op:'classLevel',to:2}]},
    {kind:'triggered',event:'permLeaves',auto:true,levelCond:{kind:'levelRange',min:1,max:1},
      objFilter:{words:'artifact',controller:'opponent',to:'graveyard'},
      text:'Whenever an artifact an opponent controls is put into a graveyard from the battlefield, draw a card.',effects:[{op:'draw',n:1,who:'you'}]},
    {kind:'activated',auto:true,cost:{mana:'{4}{G}',tap:false,other:[]},sorcerySpeed:true,text:'{4}{G}: Level 3',effects:[{op:'classLevel',to:3}]},
    {kind:'triggered',event:'anyPlayerAttacksPlayer',auto:true,levelCond:{kind:'levelRange',min:2,max:2},
      text:'Whenever one or more of your opponents are attacked, up to one target attacking creature gets +X/+X until end of turn, where X is the number of cards in your hand.',
      effects:[{op:'mtgAutoPartyDudeBoost'}]}
  ]});
  install('Signal the Clans', { abilities:[{kind:'spell',auto:true,
    text:'Search your library for three creature cards and reveal them. If you reveal three cards with different names, choose one of them at random and put that card into your hand. Then shuffle.',
    effects:[{op:'mtgAutoSignalClans'}]}] });
  install('Green Slime', { abilities:[{kind:'triggered',event:'etb',self:true,auto:true,
    text:"When this creature enters, counter target activated or triggered ability from an artifact or enchantment source. If a permanent's ability is countered this way, destroy that permanent.",
    effects:[{op:'mtgAutoGreenSlime'}]}] });
  install("Titania's Song", { abilities:[{kind:'static',auto:true,
    text:'Each noncreature artifact loses all abilities and becomes an artifact creature with power and toughness each equal to its mana value. If this enchantment leaves the battlefield, this effect continues until end of turn.',
    effects:[
      {op:'continuous',layer:4,scope:{who:'all',what:'artifact',noncreature:true},addTypes:['Creature']},
      {op:'continuous',layer:6,scope:{who:'all',what:'artifact',noncreature:true},loseAll:true}
    ]}]});
  install('Structural Assault', { abilities:[{kind:'spell',auto:true,
    text:'Destroy all artifacts, then Structural Assault deals damage to each creature equal to the number of artifacts put into graveyards from the battlefield this turn.',
    effects:[{op:'mtgAutoStructuralAssault'}]}]});
  install('Collected Company', { abilities:[{kind:'spell',auto:true,
    text:'Look at the top six cards of your library. Put up to two creature cards with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in any order.',
    effects:[{op:'mtgAutoCollectedCompany'}]}]});
  install('Topography Tracker', { abilities:[{kind:'triggered',event:'etb',self:true,auto:true,
    text:'When this creature enters, create a Map token. If a creature you control would explore, instead it explores, then it explores again.',
    effects:[{op:'mtgAutoMapToken'}]}]});
  install('Call to the Kindred', { abilities:[{kind:'triggered',event:'yourUpkeep',auto:true,
    text:'At the beginning of your upkeep, you may look at the top five cards of your library. If you do, you may put a creature card that shares a creature type with enchanted creature from among them onto the battlefield, then put the rest on the bottom of your library in any order.',
    effects:[{op:'mtgAutoCallKindred'}]}]});
  install('Tide Shaper', { abilities:[{kind:'triggered',event:'etb',self:true,auto:true,
    text:'When this creature enters, if it was kicked, target land becomes an Island for as long as this creature remains on the battlefield. Tide Shaper gets +1/+1 as long as an opponent controls an Island.',
    effects:[{op:'mtgAutoTideShaper'}]}]});
  install('Deeproot Historian', { abilities:[{kind:'static',auto:true,
    text:'Merfolk and Druid cards in your graveyard have retrace.',effects:[{op:'mtgAutoHistorianRetrace'}]}]});
  install('Over the Edge', { abilities:[{kind:'spell',auto:true,text:'Choose one — destroy target artifact or enchantment; or target creature you control explores, then it explores again.',
    effects:[{op:'modal',count:1,modes:[
      {label:'Destroy target artifact or enchantment',auto:true,effects:[{op:'destroy',targets:[{type:'permanent',filter:'artifact or enchantment',anyOf:['artifact','enchantment']}]}]},
      {label:'Target creature you control explores, then it explores again',auto:true,effects:[
        {op:'explore',targets:[{type:'creature',controller:'you',filter:'creature you control'}]},
        {op:'explore',targets:[{type:'creature',controller:'you',filter:'creature you control'}]}
      ]}
    ]}]}]});

  const oldRun=Game.prototype._runEffect;
  const rState=(g,name)=>{
    if(!g.resolving)return {};
    const k=g.resolving.index+':tablePlayAuto:'+name;
    if(!g.resolving.answers[k])g.resolving.answers[k]={};
    return g.resolving.answers[k];
  };
  const mv=o=>Number((o&&o.card&&o.card.cmc)||(o&&o.analysis&&o.analysis()&&o.analysis().mv)||0);
  const libraryCreature=o=>!!o&&o.zone==='library'&&!!((o.analysis()||{}).isCreature);
  const choose=(g,pool,pid,min,max,prompt,sub,optional)=>{
    if(!pool.length)return [];
    const got=g._choose({playerId:pid,purpose:'tablePlayAutoPick',kind:'objects',zone:'library',
      items:g._chooseItems(pool),min,max,optional:!!optional,prompt},sub);
    if(got===SUSPEND)return SUSPEND;
    return (got&&got.picks||[]).map(id=>pool.find(o=>o.id===id)).filter(Boolean);
  };
  const arrange=(g,pool,pid,sub,prompt)=>{
    if(!pool.length)return [];
    const ids=pool.map(o=>o.id);
    const got=g._ask({type:'arrange',playerId:pid,cards:pool.map(o=>({id:o.id,name:o.name,card:o.card})),prompt},sub);
    if(got===SUSPEND)return SUSPEND;
    const supplied=got&&(got.order||got.top||got.cards);
    const order=Array.isArray(supplied)?supplied.filter(id=>ids.includes(id)):[];
    for(const id of ids)if(!order.includes(id))order.push(id);
    return order;
  };
  const putBottom=(g,pool,pid,ids)=>{
    const z=g.zones[pid], map=new Map(pool.map(o=>[o.id,o]));
    for(const id of ids||pool.map(o=>o.id)){
      const o=map.get(id);if(!o||o.zone!=='library')continue;
      g._removeFromZone(o);o.zone='library';z.library.push(o);map.delete(id);
    }
    for(const o of map.values())if(o.zone==='library'){g._removeFromZone(o);o.zone='library';z.library.push(o);}
  };
  const song=o=>canon(o&&o.name)==="titania's song";
  const tracker=o=>canon(o&&o.name)==='topography tracker';
  const turnRng=(g)=>g.rng&&typeof g.rng.next==='function'?g.rng.next():Math.random();

  Game.prototype._runEffect=function(e,ctx){
    if(!e||!e.op)return oldRun.call(this,e,ctx);
    const pid=ctx&&ctx.controller,src=ctx&&(ctx.obj||(ctx.objId&&this.obj(ctx.objId)));
    if(e.op==='mtgAutoPartyDudeFood'){for(const p of this.players)this._createNamedToken(p.id,{tokenName:'Food',n:1});return;}
    if(e.op==='mtgAutoMapToken'){this._createNamedToken(pid,{tokenName:'Map',n:1});return;}
    if(e.op==='mtgAutoHistorianRetrace')return;
    if(e.op==='mtgAutoAnzragReturn'){const o=ctx&&(ctx.obj||(ctx.objId&&this.obj(ctx.objId)));if(o&&o.zone==='battlefield')this.moveObject(o,'hand');return;}
    if(e.op==='mtgAutoTideShaper'){
      if(!src||src.zone!=='battlefield'||!src.wasKicked)return;
      const lands=this.battlefield.filter(o=>!o.phasedOut&&(o.analysis()||{}).isLand);
      const got=this._choose({playerId:pid,purpose:'tablePlayAutoTideLand',kind:'objects',items:this._chooseItems(lands),min:1,max:1,
        prompt:'Tide Shaper: choose target land to become an Island.'},'tablePlayAutoTideLand');
      if(got===SUSPEND)return SUSPEND;
      const land=lands.find(o=>o.id===((got&&got.picks||[])[0]));
      if(land&&land.zone==='battlefield'&&src.zone==='battlefield'){
        land.effects.push({setSubtypes:['Island'],setMana:['U'],whileFrom:src.id});land._chr=null;this.bumpBoard();
        this.logEvent('rules',land.name+' becomes an Island for as long as '+src.name+' remains on the battlefield.');
      }
      return;
    }
    if(e.op==='mtgAutoGreenSlime'){
      if(!this.resolving)return;
      const st=rState(this,'greenSlime');
      if(!st.candidates)st.candidates=this.stack.filter(it=>it.kind!=='spell'&&it.id!==(ctx&&ctx.id)).map(it=>{
        const o=this.obj(it.objId||it.sourceId||(it.obj&&it.obj.id)),a=o&&o.zone==='battlefield'?(o.analysis()||{}):{};
        return {stackId:it.id,sourceId:o&&o.id,sourceName:(o&&o.name)||it.name||'Ability',legal:!!o&&o.zone==='battlefield'&&(a.isArtifact||a.isEnchantment)};
      }).filter(x=>x.legal);
      if(!st.candidates.length)return;
      if(!st.pick){
        const got=this._choose({playerId:pid,purpose:'tablePlayAutoGreenSlime',kind:'options',
          options:st.candidates.map((x,i)=>({i,label:x.sourceName+' — activated or triggered ability'})),min:1,max:1,
          prompt:'Green Slime: choose an activated or triggered ability from an artifact or enchantment.'},'tablePlayAutoGreenSlimeTarget');
        if(got===SUSPEND)return SUSPEND;
        st.pick=st.candidates[(got&&got.picks||[])[0]||0];
      }
      const item=this.stack.find(x=>x.id===st.pick.stackId);
      if(!item)return;
      this._runEffect({op:'counterSpell'},Object.assign({},ctx,{targets:[{kind:'stack',id:item.id}]}));
      if(this.stack.some(x=>x.id===item.id))return;
      const permanent=st.pick.sourceId&&this.obj(st.pick.sourceId);
      if(permanent&&permanent.zone==='battlefield')this._runEffect({op:'destroy',scope:'self'},Object.assign({},ctx,{obj:permanent,objId:permanent.id,name:permanent.name}));
      return;
    }
    if(e.op==='mtgAutoSignalClans'){
      const st=rState(this,'signalClans'),lib=(this.zones[pid]||{}).library||[];
      if(!st.done){
        const creatures=lib.filter(libraryCreature);
        if(creatures.length<3){
          this.logEvent('rules','Signal the Clans: fewer than three creature cards were found; no three-card reveal is possible.');
          if(this.rng&&this.rng.shuffle)this.rng.shuffle(lib);else lib.sort(()=>Math.random()-.5);
          st.done=true;return;
        }
        const got=choose(this,creatures,pid,3,3,'Signal the Clans: choose three creature cards to reveal.','tablePlayAutoSignalPick',false);
        if(got===SUSPEND)return SUSPEND;
        st.picks=got;
        for(const o of got)this.logEvent('reveal',(this.player(pid)||{}).name+' reveals '+o.name+' with Signal the Clans.');
        if(new Set(got.map(o=>canon(o.name))).size===3){
          const pick=got[Math.floor(turnRng(this)*got.length)];
          if(pick&&pick.zone==='library')this.moveObject(pick,'hand');
          if(pick)this.logEvent('rules',(this.player(pid)||{}).name+' puts '+pick.name+' into their hand at random.');
        }else this.logEvent('rules','Signal the Clans found cards that do not all have different names; no card is put into hand.');
        st.done=true;
      }
      const z=this.zones[pid];if(z&&this.rng&&this.rng.shuffle)this.rng.shuffle(z.library);else if(z)z.library.sort(()=>Math.random()-.5);
      return;
    }
    if(e.op==='mtgAutoCollectedCompany'){
      const st=rState(this,'collectedCompany'),z=this.zones[pid];if(!z)return;
      if(!st.looked){st.looked=z.library.slice(0,6);this._know(st.looked,pid);this.logEvent('look',(this.player(pid)||{}).name+' looks at the top '+st.looked.length+' cards with Collected Company.');}
      const pool=st.looked.filter(o=>o.zone==='library'&&(o.analysis()||{}).isCreature&&mv(o)<=3);
      if(!st.picked){const got=choose(this,pool,pid,0,Math.min(2,pool.length),'Collected Company: choose up to two creature cards with mana value 3 or less.','tablePlayCompanyPick',true);if(got===SUSPEND)return SUSPEND;st.picked=got;}
      for(const o of st.picked)if(o&&o.zone==='library')this.moveObject(o,'battlefield',{controller:pid});
      const rest=st.looked.filter(o=>o&&o.zone==='library');
      if(!st.ordered){const order=arrange(this,rest,pid,'tablePlayCompanyOrder','Collected Company: put the remaining cards on the bottom in any order.');if(order===SUSPEND)return SUSPEND;st.order=order;st.ordered=true;}
      putBottom(this,rest,pid,st.order);this._looked=null;return;
    }
    if(e.op==='mtgAutoCallKindred'){
      const st=rState(this,'callKindred'),aura=src;
      if(!aura||aura.zone!=='battlefield'||!aura.attachedTo)return;
      const host=this.obj(aura.attachedTo);if(!host||host.zone!=='battlefield')return;
      const z=this.zones[pid];if(!z)return;
      if(!st.lookPrompted){
        const yes=this._ask({type:'confirm',playerId:pid,purpose:'tablePlayAutoCallKindredLook',
          prompt:'Call to the Kindred: look at the top five cards of your library?'},'tablePlayCallKindredLook');
        if(yes===SUSPEND)return SUSPEND;
        st.lookPrompted=true;st.look=!!(yes&&yes.yes);
        if(!st.look)return;
        st.cards=z.library.slice(0,5);this._know(st.cards,pid);
        this.logEvent('look',(this.player(pid)||{}).name+' looks at the top '+st.cards.length+' cards for Call to the Kindred.');
      }
      if(!st.look)return;
      const types=((host.analysis()||{}).subtypes||[]).filter(t=>this._isCreatureType(t));
      const pool=st.cards.filter(o=>o.zone==='library'&&(o.analysis()||{}).isCreature&&((o.analysis().subtypes||[]).some(t=>types.includes(t))));
      if(!st.pickDone){
        const got=this._choose({playerId:pid,purpose:'tablePlayAutoCallKindredPick',kind:'objects',items:this._chooseItems(pool),min:0,max:Math.min(1,pool.length),optional:true,
          prompt:'Call to the Kindred: you may put a creature card that shares a creature type with the enchanted creature onto the battlefield.'},'tablePlayCallKindredPick');
        if(got===SUSPEND)return SUSPEND;
        st.pick=pool.find(o=>o.id===((got&&got.picks||[])[0]))||null;st.pickDone=true;
      }
      if(st.pick&&st.pick.zone==='library')this.moveObject(st.pick,'battlefield',{controller:pid});
      const rest=st.cards.filter(o=>o&&o.zone==='library');
      if(!st.ordered){const order=arrange(this,rest,pid,'tablePlayCallKindredOrder','Call to the Kindred: put the remaining cards on the bottom in any order.');if(order===SUSPEND)return SUSPEND;st.order=order;st.ordered=true;}
      putBottom(this,rest,pid,st.order);this._looked=null;return;
    }
    if(e.op==='mtgAutoAnzragRampage'){
      const st=rState(this,'anzragRampage');
      if(!st.destroyed){const out=oldRun.call(this,{op:'destroyAll',what:'artifact',scope:{who:'opponents',what:'artifact'}},ctx);if(out===SUSPEND)return SUSPEND;st.destroyed=true;}
      if(!st.exiled){
        const z=this.zones[pid],count=Math.max(0,Number((this.turnHistory||{}).artifactsToGraveyard)||0),cards=z?z.library.slice(0,Math.min(count,z.library.length)):[];
        st.exiledIds=cards.map(o=>o.id);for(const o of cards)this.moveObject(o,'exile');st.exiled=true;
        this.logEvent('exile',(this.player(pid)||{}).name+' exiles '+cards.length+' card(s) with Anzrag\\'s Rampage.');
      }
      const eligible=(st.exiledIds||[]).map(id=>this.obj(id)).filter(o=>o&&o.zone==='exile'&&(o.analysis()||{}).isCreature);
      if(!st.choiceDone){const got=this._choose({playerId:pid,purpose:'tablePlayAutoAnzragPick',kind:'objects',items:this._chooseItems(eligible),min:0,max:Math.min(1,eligible.length),optional:true,
        prompt:"Anzrag's Rampage: you may put a creature card exiled this way onto the battlefield."},'tablePlayAnzragPick');if(got===SUSPEND)return SUSPEND;st.pick=eligible.find(o=>o.id===((got&&got.picks||[])[0]))||null;st.choiceDone=true;}
      if(st.pick&&st.pick.zone==='exile'){const o=st.pick;this.moveObject(o,'battlefield',{controller:pid});if(o.zone==='battlefield'){
        o.effects.push({keywords:['Haste'],until:'eot'});
        this.scheduleDelayed({event:'eachEndStep',controller:pid,objId:o.id,sameTurnOk:true,name:'Return '+o.name+' to its owner\\'s hand',effects:[{op:'mtgAutoAnzragReturn'}]});
      }}return;
    }
    if(e.op==='mtgAutoStructuralAssault'){
      const out=oldRun.call(this,{op:'destroyAll',what:'artifact'},ctx);if(out===SUSPEND)return SUSPEND;
      const n=Math.max(0,Number((this.turnHistory||{}).artifactsToGraveyard)||0);
      return n?oldRun.call(this,{op:'damage',n,scope:{who:'all',what:'creature'}},ctx):undefined;
    }
    if(e.op==='mtgAutoPartyDudeBoost'){
      const n=((this.zones[pid]||{}).hand||[]).length,attackers=this.battlefield.filter(o=>!o.phasedOut&&o.attacking&&(o.analysis()||{}).isCreature);
      const got=this._choose({playerId:pid,purpose:'tablePlayPartyBoost',kind:'objects',items:this._chooseItems(attackers),min:0,max:Math.min(1,attackers.length),optional:true,
        prompt:'Party Dude: you may give an attacking creature +'+n+'/+'+n+' until end of turn.'},'tablePlayPartyBoost');
      if(got===SUSPEND)return SUSPEND;
      const pick=attackers.find(o=>o.id===((got&&got.picks||[])[0]));
      if(pick&&n){pick.effects.push({pt:{p:n,t:n},until:'eot'});pick._chr=null;this.bumpBoard();}
      return;
    }
    if(e.op==='explore'&&!e._tablePlayTrackerExtra){
      const count=this.battlefield.filter(o=>!o.phasedOut&&o.controller===pid&&tracker(o)).length;
      if(count){
        const out=oldRun.call(this,e,ctx);if(out===SUSPEND)return SUSPEND;
        for(let i=0;i<count;i++){const more=oldRun.call(this,Object.assign({},e,{_tablePlayTrackerExtra:true}),ctx);if(more===SUSPEND)return SUSPEND;}
        return;
      }
    }
    const out=oldRun.call(this,e,ctx);
    if(this.pendingChoice&&this.pendingChoice.purpose==='commanderMove'&&this.resolving){this._tablePlayCommanderPaused=true;return SUSPEND;}
    return out;
  };

  // Commanders may choose the command zone instead of the actual destination (including hand/library/exile).
  const oldMove=Game.prototype.moveObject;
  Game.prototype.moveObject=function(o,toZone,opts){
    opts=opts||{};
    const from=o&&o.zone,ask=!!(o&&o.isCommander&&
      ['graveyard','exile','hand','library'].includes(toZone)&&from!==toZone&&!opts.noCommanderChoice);
    if(!ask)return oldMove.call(this,o,toZone,opts);
    const owner=this.player(o.owner);
    if(!owner||owner.isBot||owner.hasLost)return oldMove.call(this,o,toZone,opts);
    const saved=MTG.settings.commanderToZone;let result;
    MTG.settings.commanderToZone=false;
    try{result=oldMove.call(this,o,toZone,opts);}finally{MTG.settings.commanderToZone=saved;}
    if(o.zone==='command'||o.zone===from||!['graveyard','exile','hand','library'].includes(o.zone))return result;
    o._cmdToGrave=false;
    if(o._tablePlayCommanderChoiceQueued)return result;
    o._tablePlayCommanderChoiceQueued=true;o._tablePlayCommanderChoice={from,destination:o.zone};
    this.queueChoice({type:'confirm',purpose:'commanderMove',playerId:o.owner,objId:o.id,
      prompt:o.name+' would go to '+o.zone+'. Put it into the command zone instead?'});
    return result;
  };
  const oldResolve=Game.prototype.resolveChoice;
  Game.prototype.resolveChoice=function(playerId,data){
    const ch=this.pendingChoice;
    if(ch&&ch.purpose==='commanderMove'&&ch.playerId===playerId){
      const o=this.obj(ch.objId),wasResolving=!!this.resolving;
      this.pendingChoice=null;
      if(o){const info=o._tablePlayCommanderChoice||{};o._tablePlayCommanderChoiceQueued=false;o._tablePlayCommanderChoice=null;o._cmdToGrave=false;
        if(data&&data.yes&&o.zone!=='command'){this.moveObject(o,'command',{noCommanderChoice:true});this.logEvent('rules',o.name+' is put into the command zone instead of '+(info.destination||'its destination')+'.');}}
      this._nextChoice();
      if(!this.pendingChoice&&!((this.choiceQueue||[]).length)&&wasResolving&&this.resolving&&this._tablePlayCommanderPaused){
        this._tablePlayCommanderPaused=false;this._pumpResolution();
      }
      if(!this.pendingChoice)this._nextChoice();
      if(!this.pendingChoice){this.checkStateBasedActions();this.touch();}
      return true;
    }
    const out=oldResolve.call(this,playerId,data);
    if(this._tablePlayCommanderPaused&&!this.pendingChoice&&!((this.choiceQueue||[]).length)&&this.resolving){
      this._tablePlayCommanderPaused=false;this._pumpResolution();
      if(!this.pendingChoice)this._nextChoice();
      if(!this.pendingChoice){this.checkStateBasedActions();this.touch();}
    }
    return out;
  };

  // Count actual artifact movements to graveyards, including token artifacts, without a huge end-of-turn scan.
  const moveCount=Game.prototype.moveObject;
  Game.prototype.moveObject=function(o,toZone,opts){
    const from=o&&o.zone,wasArtifact=!!(o&&from==='battlefield'&&(o.analysis()||{}).isArtifact);
    const result=moveCount.call(this,o,toZone,opts);
    if(wasArtifact&&toZone==='graveyard'&&(o.zone==='graveyard'||o.zone==null)&&from==='battlefield'){
      const h=this.turnHistory||(this.turnHistory={creaturesDied:0,permanentsLeft:0,attacked:false});
      h.artifactsToGraveyard=(h.artifactsToGraveyard||0)+1;
    }
    return result;
  };

  // Deeproot Historian grants retrace only while controlled and only to owned Merfolk/Druid cards in graveyards.
  const alt=Game.prototype._altUsesForRaw;
  if(alt)Game.prototype._altUsesForRaw=function(playerId,objId){
    const out=alt.call(this,playerId,objId),o=this.obj(objId);
    if(!o||o.zone!=='graveyard'||o.owner!==playerId)return out;
    const a=o.analysis()||{},ok=(a.subtypes||[]).some(t=>/^(Merfolk|Druid)$/i.test(t));
    if(ok&&this.battlefield.some(x=>!x.phasedOut&&x.controller===playerId&&canon(x.name)==='deeproot historian')&&!out.some(u=>u.via==='retrace'))
      out.push({kind:'cast',via:'retrace',cost:a.manaCost||'',label:'Retrace '+(a.manaCost||'')+' (discard a land)'});
    return out;
  };

  // Add small symbol chips for cost reductions/taxes to card views in zones where they can be cast.
  const costChanges=(g,o,pid)=>{
    if(!o||!o.analysis||!o.analysis())return [];
    const less=[];let delta=0,extra='';
    try{delta=Number(g._costDelta(o,pid,less))||0;delta+=(Number((g._commanderTax(o)||{}).mana)||0);
      delta+=(o.effects||[]).reduce((n,x)=>n+((x&&x.perpetual&&x.costDelta)||0),0);delta-=Number(g.costReductionFor(o,{})||0);extra=String(g._costExtraSymbols(o,pid)||'');}
    catch(_){return [];}
    const entries=[],add=(sign,symbol)=>{if(symbol!=null&&String(symbol)!=='')entries.push({sign,symbol:String(symbol).replace(/[{}]/g,'')});};
    for(const symbol of less)add('−',symbol);
    if(delta<0)add('−',Math.abs(delta)===1?'1':String(Math.abs(delta)));else if(delta>0)add('+',delta===1?'1':String(delta));
    for(const symbol of extra.match(/\{[^}]+\}/g)||[])add('+',symbol);
    const counts=new Map();for(const x of entries){const k=x.sign+':'+x.symbol;counts.set(k,(counts.get(k)||0)+1);}
    return Array.from(counts,([k,count])=>({sign:k.slice(0,1),symbol:k.slice(2),count}));
  };
  const viewFor=Game.prototype.viewFor;
  if(viewFor)Game.prototype.viewFor=function(playerId,opts){
    const view=viewFor.call(this,playerId,opts),seen=new Set();
    const visit=v=>{
      if(!v||typeof v!=='object')return;
      if(Array.isArray(v)){for(const x of v)visit(x);return;}
      if(v.id!=null&&v.zone&&!v.hidden&&!seen.has(v.id)){
        seen.add(v.id);const o=this.obj(v.id);
        if(o&&o.owner===playerId&&['hand','command','exile','graveyard'].includes(o.zone)&&!o.faceDownExile){const marks=costChanges(this,o,playerId);if(marks.length)v.costChanges=marks;}
      }
      for(const k of Object.keys(v))visit(v[k]);
    };visit(view);return view;
  };
  const UI=MTG.ui;
  if(MTG.oracle&&MTG.oracle.clearCache)MTG.oracle.clearCache();
  if(UI&&UI.clearAutoCache)UI.clearAutoCache();
  if(UI&&UI.cardSlot){
    const slot=UI.cardSlot;
    UI.cardSlot=function(card,state,opts){
      const node=slot.call(this,card,state,opts),marks=state&&state.costChanges;
      if(!node||!marks||!marks.length||typeof document==='undefined')return node;
      const row=document.createElement('div');row.className='cost-change-indicators';row.setAttribute('aria-label','Mana cost adjustments');
      row.title='Mana cost adjustments currently affecting this card.';
      for(const mark of marks){
        const chip=document.createElement('span');chip.className='cost-change '+(mark.sign==='+'?'increase':'decrease');
        chip.appendChild(document.createTextNode(mark.sign+(mark.count>1?mark.count+'×':'')));
        const sym=mark.symbol;
        if(/^(?:[WUBRGC]|[0-9]+|X|Y|Z|T|Q)$/i.test(sym)){
          const img=document.createElement('img');img.alt='{'+sym+'}';img.src='https://svgs.scryfall.io/card-symbols/'+sym+'.svg';img.loading='lazy';img.decoding='async';chip.appendChild(img);
        }else chip.appendChild(document.createTextNode('{'+sym+'}'));
        row.appendChild(chip);
      }
      node.appendChild(row);return node;
    };
    const css=document.createElement('style');
    css.textContent='.card-slot{position:relative}.cost-change-indicators{position:absolute;z-index:8;top:3%;right:8%;display:flex;gap:2px;max-width:68%;flex-wrap:wrap;justify-content:flex-end;pointer-events:none}.cost-change{display:inline-flex;align-items:center;gap:1px;padding:1px 3px;border-radius:4px;border:1px solid rgba(0,0,0,.45);font:700 9px/1.3 system-ui,sans-serif;color:#fff;text-shadow:0 1px 1px #000;white-space:nowrap;box-shadow:0 1px 2px #0005}.cost-change img{width:12px;height:12px;vertical-align:middle}.cost-change.decrease{background:#22643f}.cost-change.increase{background:#8e3131}@media(min-width:900px){.cost-change{font-size:10px}.cost-change img{width:13px;height:13px}}';
    document.head.appendChild(css);
  }

  // Memoize repeat queries for stable scope shapes until the board changes.
  const scopeList=Game.prototype._scopeList;
  if(scopeList)Game.prototype._scopeList=function(sc,controllerId,src,targetPid,inLayers){
    const dynamic=['thatPlayer','combatWithSelf','chosenType','chosenName','chosenColor','minPower','maxPower','minToughness','maxToughness','minMv','maxMv',
      'keyword','keywordAny','withCounter','attacking','blocking','tapped','untapped','damaged','condition','inCombat','wasAttacking','otherThanHost'];
    if(!sc||typeof sc!=='object'||inLayers||dynamic.some(k=>sc[k]!=null)||sc.either)return scopeList.call(this,sc,controllerId,src,targetPid,inLayers);
    const cache=this._tablePlayScopeCache||(this._tablePlayScopeCache={epoch:null,map:new Map()});
    const epoch=String(this._boardKey)+':'+String(controllerId)+':'+String(targetPid||'')+':'+String(src&&src.id||'');
    if(cache.epoch!==epoch){cache.epoch=epoch;cache.map.clear();}
    const key=JSON.stringify(sc);let result=cache.map.get(key);
    if(!result){result=scopeList.call(this,sc,controllerId,src,targetPid,inLayers).slice();cache.map.set(key,result);if(cache.map.size>180)cache.map.delete(cache.map.keys().next().value);}
    return result.slice();
  };

  // Titania's Song animates base noncreature artifacts with their mana value as base power/toughness.
  const power=Game.prototype.powerOf,toughness=Game.prototype.toughnessOf;
  const songAnimated=(g,o)=>{
    if(!o||o.zone!=='battlefield')return false;
    const base=g._baseAnalysis?(g._baseAnalysis(o)||{}):{};
    return !!(base.isArtifact&&!base.isCreature&&(g.battlefield.some(song)||(o.effects||[]).some(x=>x&&x.tablePlayTitaniaSong&&x.until==='eot')));
  };
  Game.prototype.powerOf=function(o){const p=power.call(this,o);if(songAnimated(this,o))return mv(o)+(Number((o.counters||{})['+1/+1'])||0)-(Number((o.counters||{})['-1/-1'])||0);
    if(o&&o.zone==='battlefield'&&canon(o.name)==='tide shaper'&&this.battlefield.some(x=>x.controller!==o.controller&&(x.analysis()||{}).isLand&&(((x.analysis()||{}).subtypes||[]).includes('Island'))))return p+1;return p;};
  Game.prototype.toughnessOf=function(o){const t=toughness.call(this,o);if(songAnimated(this,o))return mv(o)+(Number((o.counters||{})['+1/+1'])||0)-(Number((o.counters||{})['-1/-1'])||0);
    if(o&&o.zone==='battlefield'&&canon(o.name)==='tide shaper'&&this.battlefield.some(x=>x.controller!==o.controller&&(x.analysis()||{}).isLand&&(((x.analysis()||{}).subtypes||[]).includes('Island'))))return t+1;return t;};
  const moving=Game.prototype.moveObject;
  Game.prototype.moveObject=function(o,toZone,opts){
    const leaving=o&&song(o)&&o.zone==='battlefield'&&toZone!=='battlefield';
    const artifacts=leaving?this.battlefield.filter(x=>x!==o&&!x.phasedOut&&(this._baseAnalysis(x)||{}).isArtifact&&!(this._baseAnalysis(x)||{}).isCreature):[];
    const result=moving.call(this,o,toZone,opts);
    if(leaving)for(const x of artifacts)if(x.zone==='battlefield'){x.effects.push({addTypes:['Creature'],loseAll:true,tablePlayTitaniaSong:true,until:'eot'});x._chr=null;}
    if(leaving&&artifacts.length)this.bumpBoard();return result;
  };

  // Catch commander replacement choices created by every custom effect branch, including mass-movement effects.
  const runWithChoicePause=Game.prototype._runEffect;
  Game.prototype._runEffect=function(e,ctx){
    const result=runWithChoicePause.call(this,e,ctx);
    if(this.pendingChoice&&this.pendingChoice.purpose==='commanderMove'&&this.resolving){this._tablePlayCommanderPaused=true;return SUSPEND;}
    return result;
  };

  if(UI&&UI.clearAutoCache)UI.clearAutoCache();
})(window.MTG);