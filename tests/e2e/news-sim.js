const fs=require('fs'),vm=require('vm'),path=require('path');const D=process.argv[2];
const store={};
const win={};win.window=win;win.localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}};
win.document={addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},createElement(){return{style:{},setAttribute(){},appendChild(){}}},documentElement:{classList:{add(){},remove(){},contains(){return false}},style:{}},body:{classList:{add(){}}},head:{appendChild(){}}};
win.navigator={userAgent:'node',language:'sv'};win.location={search:'',hash:'',href:'http://x/'};win.setTimeout=setTimeout;win.clearTimeout=clearTimeout;win.setInterval=()=>0;win.Intl=Intl;win.Date=Date;win.Math=Math;win.JSON=JSON;win.console=console;
win.addEventListener=()=>{};win.matchMedia=()=>({matches:false,addEventListener(){}});
const ctx=vm.createContext(win);
for(const f of ['util.js','dialekt.js','i18n.js','cities.js','news-more.js','news-gt.js','levels-content.js','news.js']){try{vm.runInContext(fs.readFileSync(path.join(D,f),'utf8'),ctx,{filename:f})}catch(e){console.error('ERR',f,e.message)}}
win.I18N.lang='sv';
if(process.argv[4]==='store') win.OLNU_STORE=true;
win.UTE={current:()=>({at:Date.now(),d:{t:-4,code:3,pr:0}})};
const town=process.argv[3]||'Ludvika';const C=win.CITIES.list.find(c=>c.name===town);
const beers=[{id:1,is_mine:true,beer_count:4,lat:C.lat,lng:C.lng,created_at:new Date(Date.now()-3600e3).toISOString()},{id:2,friend_name:'Lisa',beer_count:6,lat:C.lat+0.001,lng:C.lng,created_at:new Date(Date.now()-7200e3).toISOString()},{id:3,beer_count:2,lat:C.lat+0.002,lng:C.lng+0.002,created_at:new Date().toISOString()}];
const hours=[9,13,18,21,23.5,1.5,4];const all=[];let prev=[];const kinds={};
for(let r=0;r<400;r++){const h=hours[r%hours.length];const d=new Date('2026-11-14T00:00:00+01:00');d.setTime(d.getTime()+((h<5?h+24:h)*3600e3));
 const items=win.NEWS.build(beers,{center:{lat:C.lat,lng:C.lng},now:d,prev,titles:{},home:[{group_id:'g',group_name:'Gänget',name:'Lisa',beers:6,live:true}],checkins:[]});
 prev=items.map(x=>x.text);items.forEach(x=>{all.push(x.text);kinds[x.k]=(kinds[x.k]||0)+1});}
if(process.argv[4]==='dump'){all.forEach(t=>console.log('L\t'+t));process.exit(0)}
const cnt={};all.forEach(t=>cnt[t]=(cnt[t]||0)+1);
const reps=Object.entries(cnt).filter(([t,n])=>n>1);
console.log('town',town,'items',all.length,'unique',Object.keys(cnt).length,'repeated texts',reps.length);
console.log('kinds',JSON.stringify(kinds));
const loc=all.filter(t=>/Väsman|Grangärde|Sunnansjö|Ludvika/.test(t)&&town!=='Ludvika');console.log('ludvika lines outside',loc.length, loc.slice(0,3));
console.log('sample', [...new Set(all)].filter(t=>/°|Riksturn|Lugnet|Liseberg|Slussen|Fredag|Lördag|November|Vasaloppet|Väsman/.test(t)).slice(0,12));
