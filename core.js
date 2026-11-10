(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RepeatSheet=api;})(globalThis,function(){
  'use strict';
  const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function parseCSV(text){
    if(typeof text!=='string'||text.length>100000)throw Error('Use at most 100,000 CSV characters.');
    text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
    const rows=[];let row=[],field='',quoted=false,closed=false;
    const cell=()=>{row.push(field);field='';closed=false;};
    const record=()=>{cell();rows.push(row);row=[];};
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else field+=c;}
      else if(c===',')cell();else if(c==='\n')record();
      else if(closed)throw Error('Unexpected text after a closing CSV quote.');
      else if(c==='"'){if(field)throw Error('A quote must start a CSV field.');quoted=true;}else field+=c;
    }
    if(quoted)throw Error('Close the quoted CSV field.');
    if(field||row.length||closed)record();
    if(rows.length>201)throw Error('Use at most 100 tasks, with fewer than 200 CSV records.');
    return rows;
  }
  function day(s){
    if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
    const [y,m,d]=s.split('-').map(Number),v=new Date(Date.UTC(y,m-1,d));
    return y>=2000&&y<=2199&&v.getUTCFullYear()===y&&v.getUTCMonth()===m-1&&v.getUTCDate()===d?v:null;
  }
  function monthParts(s){
    if(typeof s!=='string'||!/^\d{4}-\d{2}$/.test(s)||!day(s+'-01'))throw Error('Choose a month from 2000 to 2199.');
    return s.split('-').map(Number);
  }
  function cleanText(value,max,name){
    if(typeof value!=='string')throw Error(name+' must be text.');
    const v=value.trim();
    if(v.length>max||/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(v))throw Error(name+' is too long or contains control characters.');
    return v;
  }
  function task(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid task record.');
    const id=cleanText(raw.id,40,'ID').toUpperCase();
    if(!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(id))throw Error('ID needs letters, numbers, underscores or hyphens.');
    const title=cleanText(raw.task,160,'Task');if(!title)throw Error('Task text is required.');
    const owner=cleanText(raw.owner,80,'Owner'),repeat=cleanText(raw.repeat,20,'Repeat').toLowerCase();
    let on=cleanText(raw.on,100,'On');
    if(['daily','weekdays'].includes(repeat)){if(on)throw Error('Leave on blank for '+repeat+'.');}
    else if(repeat==='weekly'){
      const tokens=on.split('|').map(x=>x.trim().toLowerCase());
      if(tokens.some(t=>!DAYS.some(d=>d.toLowerCase()===t))||new Set(tokens).size!==tokens.length)throw Error('Weekly on uses distinct days such as Mon|Wed.');
      on=DAYS.filter(d=>tokens.includes(d.toLowerCase())).join('|');
    }else if(repeat==='monthly'){
      if(on.toLowerCase()==='last')on='last';
      else if(/^(?:[1-9]|[12]\d|3[01])$/.test(on))on=String(Number(on));
      else throw Error('Monthly on needs 1–31 or last.');
    }else if(repeat==='yearly'){
      if(!/^\d{2}-\d{2}$/.test(on)||!day('2000-'+on))throw Error('Yearly on needs a real MM-DD, such as 02-29.');
    }else if(repeat==='once'){if(!day(on))throw Error('Once on needs a real YYYY-MM-DD date.');}
    else throw Error('Repeat must be daily, weekdays, weekly, monthly, yearly or once.');
    return {id,task:title,owner,repeat,on};
  }
  function readTasks(text){
    const rows=parseCSV(text);if(!rows.length)throw Error('Add a header and at least one task.');
    const header=rows.shift().map(x=>x.trim().toLowerCase());
    if(header.some(x=>!x)||new Set(header).size!==header.length)throw Error('Column names must be unique and non-empty.');
    for(const field of ['id','task','owner','repeat','on'])if(!header.includes(field))throw Error('Missing column: '+field+'.');
    const tasks=[],issues=[],ids=new Set();
    rows.forEach((row,i)=>{
      if(row.every(v=>!v.trim()))return;
      try{
        if(row.length!==header.length)throw Error('Column count differs from the header.');
        const raw=Object.fromEntries(['id','task','owner','repeat','on'].map(k=>[k,row[header.indexOf(k)]]));
        const t=task(raw);if(ids.has(t.id))throw Error('Duplicate task ID '+t.id+'.');ids.add(t.id);tasks.push(t);
      }catch(e){issues.push({record:i+2,message:e.message});}
    });
    if(tasks.length>100)issues.push({record:0,message:'Use at most 100 tasks.'});
    if(!tasks.length&&!issues.length)issues.push({record:0,message:'Add at least one task.'});
    return {tasks,issues};
  }
  const fingerprint=t=>JSON.stringify([t.id,t.task,t.owner,t.repeat,t.on]);
  const key=(id,due)=>id+':'+due;
  function expand(tasks,month){
    const [y,m]=monthParts(month),last=new Date(Date.UTC(y,m,0)).getUTCDate(),rows=[],warnings=[];
    if(tasks.length>100)throw Error('Use at most 100 tasks.');
    for(const raw of tasks){
      const t=task(raw);let matches=0;
      for(let d=1;d<=last;d++){
        const due=month+'-'+String(d).padStart(2,'0'),weekday=new Date(Date.UTC(y,m-1,d)).getUTCDay();
        const occurs=t.repeat==='daily'||(t.repeat==='weekdays'&&weekday>=1&&weekday<=5)||(t.repeat==='weekly'&&t.on.split('|').includes(DAYS[weekday]))||(t.repeat==='monthly'&&d===(t.on==='last'?last:Number(t.on)))||(t.repeat==='yearly'&&due.slice(5)===t.on)||(t.repeat==='once'&&due===t.on);
        if(occurs){rows.push({...t,due,key:key(t.id,due)});matches++;}
      }
      if(!matches&&t.repeat==='monthly')warnings.push(t.id+': day '+t.on+' does not exist in '+month+'; no date was generated. Use last for month-end.');
      if(!matches&&t.repeat==='yearly'&&t.on.startsWith(String(m).padStart(2,'0')+'-'))warnings.push(t.id+': '+t.on+' does not exist this year; no date was generated.');
    }
    rows.sort((a,b)=>a.due.localeCompare(b.due)||a.id.localeCompare(b.id));
    return {rows,warnings};
  }
  function stateFor(occurrence,completed){
    const related=completed.filter(r=>r.id===occurrence.id&&r.due===occurrence.due);
    const exact=related.find(r=>fingerprint(r)===fingerprint(occurrence));
    return exact?{status:'done',record:exact}:related.length?{status:'changed',record:related[related.length-1]}:{status:'open',record:null};
  }
  function mark(occurrence,completed,done,completedAt=new Date().toISOString()){
    const keep=completed.filter(r=>!(r.id===occurrence.id&&r.due===occurrence.due&&fingerprint(r)===fingerprint(occurrence)));
    if(done)keep.push({...task(occurrence),due:occurrence.due,completedAt});
    if(keep.length>20000)throw Error('This backup holds 20,000 completed records. Archive it before starting a new checklist.');
    return keep;
  }
  function backup(sourceCSV,month,completed){
    monthParts(month);
    if(typeof sourceCSV!=='string'||sourceCSV.length>100000)throw Error('Keep the draft CSV under 100,000 characters before saving a backup.');
    if(!Array.isArray(completed)||completed.length>20000)throw Error('Too many completed records for one backup.');
    return JSON.stringify({version:1,sourceCSV,month,completed},null,2)+'\n';
  }
  function restore(text){
    if(typeof text!=='string'||text.length>10000000)throw Error('Use a backup smaller than 10 million characters.');
    let data;try{data=JSON.parse(text);}catch(e){throw Error('This is not a valid JSON backup.');}
    if(!data||data.version!==1||typeof data.sourceCSV!=='string'||data.sourceCSV.length>100000||!Array.isArray(data.completed)||data.completed.length>20000)throw Error('This is not a supported Repeat Sheet backup.');
    monthParts(data.month);
    const seen=new Set();
    const completed=data.completed.map(r=>{
      const t=task(r);
      if(!day(r.due)||typeof r.completedAt!=='string'||!Number.isFinite(Date.parse(r.completedAt))||new Date(r.completedAt).toISOString()!==r.completedAt)throw Error('A completed record has an invalid date or timestamp.');
      if(!expand([t],r.due.slice(0,7)).rows.some(o=>o.due===r.due))throw Error('A completed record is not scheduled on its recorded date.');
      const k=key(t.id,r.due)+fingerprint(t);if(seen.has(k))throw Error('The backup repeats a completed record.');seen.add(k);
      return {...t,due:r.due,completedAt:r.completedAt};
    });
    return {sourceCSV:data.sourceCSV,month:data.month,completed};
  }
  function csv(records){
    const cell=v=>'"'+(/^[\s]*[=+@-]/.test(String(v))?"'":'')+String(v).replace(/"/g,'""')+'"';
    return records.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
  }
  function monthCSV(rows,completed){
    return csv([['due','id','task','owner','repeat','on','status','completed_at'],...rows.map(o=>{const s=stateFor(o,completed);return[o.due,o.id,o.task,o.owner,o.repeat,o.on,s.status,s.status==='done'?s.record.completedAt:''];})]);
  }
  function historyCSV(completed){return csv([['due','id','task_when_completed','owner_when_completed','repeat','on','completed_at'],...completed.map(r=>[r.due,r.id,r.task,r.owner,r.repeat,r.on,r.completedAt])]);}
  return {parseCSV,day,monthParts,task,readTasks,fingerprint,expand,stateFor,mark,backup,restore,csv,monthCSV,historyCSV};
});
