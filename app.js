'use strict';
const C=RepeatSheet,$=id=>document.getElementById(id);
const example='id,task,owner,repeat,on\nSUPPLY,Check shared supplies,Operations,weekly,Mon|Wed\nSUMMARY,Send workshop attendance summary,Coordinator,monthly,15\nNOTICE,Review room noticeboard,Office,weekly,Mon\n';
let rows=null,completed=[],page=0,revision=0;
const current=new Date();$('month').value=current.getFullYear()+'-'+String(current.getMonth()+1).padStart(2,'0');
function el(tag,text,cls){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;}
function invalidate(){revision++;rows=null;$('checklist').hidden=true;$('empty').hidden=false;$('empty').textContent='Build the checklist to apply your task list.';$('progress').textContent='Task list changed.';$('status').textContent='Task list changed. Build again; your completed records are kept.';$('issues').replaceChildren();}
function build(){
  invalidate();
  try{
    const parsed=C.readTasks($('source').value);
    if(parsed.issues.length){$('status').textContent='Fix '+parsed.issues.length+' task issue'+(parsed.issues.length===1?'':'s')+' before building.';for(const i of parsed.issues)$('issues').append(el('li',(i.record?'Record '+i.record+': ':'')+i.message));return;}
    const generated=C.expand(parsed.tasks,$('month').value);rows=generated.rows;page=0;
    $('status').textContent=parsed.tasks.length+' task definition'+(parsed.tasks.length===1?'':'s')+' · '+rows.length+' dated task'+(rows.length===1?'':'s');
    $('warning').hidden=!generated.warnings.length;$('warning').textContent=generated.warnings.join(' ');
    $('empty').hidden=true;$('checklist').hidden=false;render();
  }catch(e){$('status').textContent=e.message;}
}
function renderHistory(){
  $('history-title').textContent='Completed records ('+completed.length+')';const list=$('history-list');list.replaceChildren();
  for(const r of [...completed].sort((a,b)=>b.completedAt.localeCompare(a.completedAt)).slice(0,30)){
    const p=el('p',r.due+' · '+r.id+' · '+r.task+' · '+(r.owner||'Unassigned'),'history-record');
    p.append(el('small','Recorded '+r.completedAt.replace('T',' ').replace('Z',' UTC')));list.append(p);
  }
  if(completed.length>30)list.append(el('p','Showing the latest 30 records. The download includes all completed records.','muted'));
  if(!completed.length)list.append(el('p','No completed tasks yet.','muted'));
}
function render(){
  renderHistory();if(!rows)return;
  const states=rows.map(o=>({...o,state:C.stateFor(o,completed)}));
  const done=states.filter(o=>o.state.status==='done').length,changed=states.filter(o=>o.state.status==='changed').length;
  $('month-title').textContent=new Intl.DateTimeFormat('en',{month:'long',year:'numeric',timeZone:'UTC'}).format(C.day($('month').value+'-01'));
  $('progress').textContent=done+' / '+rows.length+' done'+(changed?' · '+changed+' changed':'');
  const filtered=states.filter(o=>$('filter').value==='all'||o.state.status===$('filter').value),pages=Math.max(1,Math.ceil(filtered.length/100));
  page=Math.max(0,Math.min(page,pages-1));const body=$('rows');body.replaceChildren();
  for(const o of filtered.slice(page*100,(page+1)*100)){
    const tr=el('tr',undefined,o.state.status);
    const date=el('td');date.append(el('b',o.due.slice(5)),el('small',new Intl.DateTimeFormat('en',{weekday:'short',timeZone:'UTC'}).format(C.day(o.due))));
    const title=el('td');title.append(el('strong',o.task),el('small',o.id));
    if(o.state.status==='changed')title.append(el('span','Task changed · earlier completion kept','changed-label'));
    const owner=el('td',o.owner||'Unassigned'),checkCell=el('td');
    const label=el('label',undefined,'check-label'),check=el('input');check.type='checkbox';check.checked=o.state.status==='done';check.dataset.key=o.key;
    check.setAttribute('aria-label','Done: '+o.task+' on '+o.due);
    check.addEventListener('change',()=>{try{completed=C.mark(o,completed,check.checked);revision++;$('backup-status').textContent='Work changed. Download a backup to keep it.';render();const focus=[...$('rows').querySelectorAll('input')].find(x=>x.dataset.key===o.key);if(focus)focus.focus();}catch(e){check.checked=!check.checked;$('status').textContent=e.message;}});
    label.append(check,el('span',o.state.status==='done'?'Done':o.state.status==='changed'?'Review':'Open'));checkCell.append(label);tr.append(date,title,owner,checkCell);body.append(tr);
  }
  if(!filtered.length){const tr=el('tr'),td=el('td','No tasks in this view.');td.colSpan=4;tr.append(td);body.append(tr);}
  $('page').textContent=filtered.length+' task'+(filtered.length===1?'':'s')+' · Page '+(page+1)+' of '+pages;$('prev').disabled=page===0;$('next').disabled=page>=pages-1;
}
function download(text,name,type){const url=URL.createObjectURL(new Blob(['\uFEFF'+text],{type})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('source').addEventListener('input',invalidate);$('build').addEventListener('click',build);
$('month').addEventListener('change',()=>{revision++;if($('source').value.trim())build();});
$('example').addEventListener('click',()=>{$('source').value=example;$('month').value='2026-11';$('file').value='';build();});
$('filter').addEventListener('change',()=>{page=0;render();});$('prev').addEventListener('click',()=>{page--;render();});$('next').addEventListener('click',()=>{page++;render();});
$('download').addEventListener('click',()=>{if(rows)download(C.monthCSV(rows,completed),'repeat-sheet-'+$('month').value+'.csv','text/csv;charset=utf-8');});
$('history-download').addEventListener('click',()=>download(C.historyCSV(completed),'repeat-sheet-completed.csv','text/csv;charset=utf-8'));
$('backup').addEventListener('click',()=>{try{C.monthParts($('month').value);download(C.backup($('source').value,$('month').value,completed),'repeat-sheet-backup.json','application/json');$('backup-status').textContent='Backup download requested. Check your downloads before closing.';}catch(e){$('backup-status').textContent=e.message;}});
$('file').addEventListener('change',async()=>{
  const f=$('file').files[0];$('file').value='';if(!f)return;const expected=++revision;
  if(f.size>500000){$('status').textContent='Use a task CSV smaller than 500 KB.';return;}
  try{const text=await f.text();if(expected!==revision)return;$('source').value=text;build();}catch(e){$('status').textContent='Could not read the CSV. Your current work is still here.';}
});
$('restore').addEventListener('change',async()=>{
  const f=$('restore').files[0];$('restore').value='';if(!f)return;const expected=++revision;
  if(f.size>10000000){$('backup-status').textContent='Use a backup smaller than 10 MB.';return;}
  try{const text=await f.text();if(expected!==revision)return;const data=C.restore(text.replace(/^\uFEFF/,''));$('source').value=data.sourceCSV;$('month').value=data.month;completed=data.completed;build();renderHistory();$('backup-status').textContent='Backup restored. '+completed.length+' completed record'+(completed.length===1?'':'s')+' loaded.';}
  catch(e){$('backup-status').textContent=e.message+' Your current work was not replaced.';}
  finally{$('restore').value='';}
});
renderHistory();
