const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const C=require('../core.js');
const source=fs.readFileSync('example.csv','utf8');
const base=C.readTasks(source).tasks;
const occurrence=()=>C.expand(base,'2026-11').rows.find(r=>r.id==='SUPPLY'&&r.due==='2026-11-02');
const stamp='2026-11-02T18:00:00.000Z';
test('CSV preserves quoted punctuation, embedded newlines and record numbers',()=>{
  const r=C.readTasks('\uFEFFid,task,owner,repeat,on\r\n\r\nX,"Check, then\nrecord","Team ""A""",weekly,Mon\r\n');
  assert.deepEqual(r.issues,[]);assert.equal(r.tasks[0].task,'Check, then\nrecord');assert.equal(r.tasks[0].owner,'Team "A"');
  assert.equal(C.readTasks('id,task,owner,repeat,on\n\nx,bad,,weekly,\n').issues[0].record,3);
});
test('malformed records, duplicated IDs and missing required columns are held',()=>{
  assert.throws(()=>C.parseCSV('a\n"unfinished'));
  assert.throws(()=>C.parseCSV('a\n"done"oops'));
  assert.throws(()=>C.readTasks('task,repeat,on\n'),/Missing column: id/);
  assert.match(C.readTasks(source+'supply,Other task,Office,monthly,2\n').issues[0].message,/Duplicate/);
  assert.match(C.readTasks(source+'NEW,Task,Owner,weekly,Mon,extra\n').issues[0].message,/Column count/);
});
test('weekly calendar expands all Mondays and Wednesdays in November 2026',()=>{
  const s=C.expand(base,'2026-11');assert.equal(s.rows.length,15);
  assert.deepEqual(s.rows.filter(r=>r.id==='SUPPLY').map(r=>r.due),['2026-11-02','2026-11-04','2026-11-09','2026-11-11','2026-11-16','2026-11-18','2026-11-23','2026-11-25','2026-11-30']);
});
test('calendar dates handle leap years, weekdays and month end without rolling dates',()=>{
  const tasks=C.readTasks('id,task,owner,repeat,on\nD,Daily,,daily,\nW,Weekdays,,weekdays,\nL,Last,,monthly,last\nF,Day 31,,monthly,31\nY,Leap,,yearly,02-29\nO,Once,,once,2024-02-29\n').tasks;
  const leap=C.expand(tasks,'2024-02');
  assert.equal(leap.rows.filter(x=>x.id==='D').length,29);assert.equal(leap.rows.filter(x=>x.id==='W').length,21);
  assert.equal(leap.rows.find(x=>x.id==='L').due,'2024-02-29');assert.equal(leap.rows.filter(x=>x.id==='F').length,0);assert.equal(leap.warnings.length,1);
  const ordinary=C.expand(tasks,'2025-02');assert.equal(ordinary.rows.filter(x=>x.id==='Y'||x.id==='O').length,0);assert.equal(ordinary.warnings.length,2);
  assert.throws(()=>C.expand(tasks,'2026-13'));assert.equal(C.day('2026-02-29'),null);
});
test('unsupported or ambiguous recurrence is rejected',()=>{
  const t={id:'X',task:'Task',owner:'',repeat:'weekly',on:'Mon|Wed'};
  for(const change of [{on:''},{on:'Monday'},{on:'Mon|Mon'},{repeat:'monthly',on:'32'},{repeat:'daily',on:'Mon'},{repeat:'yearly',on:'02-30'},{repeat:'once',on:'2026-04-31'},{id:'=X'}])assert.throws(()=>C.task({...t,...change}));
  assert.equal(C.task({...t,on:' wed | MON '}).on,'Mon|Wed');
});
test('reordering and inserting source tasks cannot move a completion to another task/date',()=>{
  const done=C.mark(occurrence(),[],true,stamp);
  const t=C.readTasks('id,task,owner,repeat,on\nARRIVAL,Prepare workshop room,Office,once,2026-11-02\n'+source.trim().split('\n').slice(1).reverse().join('\n')+'\n').tasks;
  const after=C.expand(t,'2026-11').rows;
  const checked=after.filter(o=>C.stateFor(o,done).status==='done');
  assert.equal(checked.length,1);assert.equal(checked[0].id,'SUPPLY');assert.equal(checked[0].due,'2026-11-02');
  assert.equal(C.stateFor(after.find(o=>o.id==='ARRIVAL'),done).status,'open');
});
test('task, owner and recurrence changes cannot silently inherit the old checkmark',()=>{
  const o=occurrence(),done=C.mark(o,[],true,stamp);
  for(const change of [{task:'Check and restock supplies'},{owner:'Coordinator'},{repeat:'weekly',on:'Mon'}])assert.equal(C.stateFor({...o,...change},done).status,'changed');
  assert.equal(C.stateFor({...o,due:'2026-11-04'},done).status,'open');
  assert.equal(C.stateFor({...o,id:'NEW'},done).status,'open');
});
test('completing a changed version preserves the earlier record; undo affects only that version',()=>{
  const o=occurrence(),changed={...o,task:'Check and restock supplies'};
  let done=C.mark(o,[],true,stamp);done=C.mark(changed,done,true,'2026-11-02T19:00:00.000Z');
  assert.equal(done.length,2);assert.equal(C.stateFor(changed,done).status,'done');
  done=C.mark(changed,done,false);assert.equal(done.length,1);assert.equal(C.stateFor(changed,done).status,'changed');assert.equal(done[0].task,o.task);
});
test('a backup restores task text, month and original dated completion records',()=>{
  const done=C.mark(occurrence(),[],true,stamp),saved=C.backup(source,'2026-11',done),restored=C.restore(saved);
  assert.equal(restored.sourceCSV,source);assert.equal(restored.month,'2026-11');assert.deepEqual(restored.completed,done);
  assert.equal(C.stateFor(occurrence(),restored.completed).status,'done');
  const edited=C.restore(C.backup('draft not built yet','2026-12',done));assert.equal(edited.sourceCSV,'draft not built yet');assert.equal(edited.completed.length,1);
});
test('corrupt backups cannot introduce impossible dates, duplicate records or unsupported versions',()=>{
  const done=C.mark(occurrence(),[],true,stamp),valid={version:1,sourceCSV:source,month:'2026-11',completed:done};
  for(const bad of [{...valid,version:2},{...valid,month:'2026-14'},{...valid,completed:[...done,...done]},{...valid,completed:[{...done[0],due:'2026-11-03'}]},{...valid,completed:[{...done[0],completedAt:'Yesterday'}]}])assert.throws(()=>C.restore(JSON.stringify(bad)));
  assert.throws(()=>C.restore('null'));assert.throws(()=>C.restore('{bad json'));
});
test('exports preserve the correct state and separate original completion instructions',()=>{
  const o=occurrence(),done=C.mark(o,[],true,stamp),changed={...o,task:'Check and restock supplies'};
  const rows=C.parseCSV(C.monthCSV([changed],done));assert.equal(rows[1][6],'changed');assert.equal(rows[1][7],'');
  const history=C.parseCSV(C.historyCSV(done));assert.equal(history[1][2],'Check shared supplies');
  assert.equal(C.parseCSV(C.csv([['=HYPERLINK("x")','  +1','@SUM(A1)','ordinary']]))[0][0],'\'=HYPERLINK("x")');
});
test('input limits and fields keep generation bounded',()=>{
  assert.throws(()=>C.parseCSV('x'.repeat(100001)));
  assert.throws(()=>C.backup('x'.repeat(100001),'2026-11',[]));
  const rows=Array.from({length:101},(_,i)=>`X${i},Daily,,daily,`).join('\n');
  assert.match(C.readTasks('id,task,owner,repeat,on\n'+rows).issues.at(-1).message,/100 tasks/);
  assert.throws(()=>C.task({id:'X',task:'x'.repeat(161),owner:'',repeat:'daily',on:''}));
});
