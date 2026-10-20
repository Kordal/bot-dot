// Public HTTP and spawned-process boundary, exercised inside an isolated Linux container.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startServer } = require('./helpers');
const CAN = process.platform === 'linux' && process.getuid?.() === 0;

test('the broker starts a working HTTP server without root or effective capabilities', { skip: !CAN && 'needs isolated Linux root', timeout: 30000 }, async () => {
  const srv = await startServer({ broker: true, env: { BOT_DOT_SEPARATE_USERS: '1', HOST:'0.0.0.0' } });
  try {
    assert.equal((await srv.api('/settings')).status, 200);
    const children = fs.readFileSync(`/proc/${srv.pid}/task/${srv.pid}/children`, 'utf8').trim().split(/\s+/);
    const pid = children.find(pid => fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').some(arg => arg.endsWith('/server.js') || arg === 'server.js'));
    assert.ok(pid, 'HTTP server child exists');
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    assert.match(status, /^Uid:\s+60000\s+60000\s+60000\s+60000$/m);
    assert.match(status, /^CapEff:\s+0+$/m);
  } finally { await srv.stop(); }
});

test('approved scripts retain distinct bot UIDs and cannot use owner HTTP or server files', { skip: !CAN && 'needs isolated Linux root', timeout: 30000 }, async () => {
  const { makeBot, waitFor } = require('./helpers');
  const srv = await startServer({ broker: true, env: { BOT_DOT_SEPARATE_USERS: '1', HOST:'0.0.0.0' } });
  try {
    for (const uid of [61000,61001]) {
      const bot = await makeBot(srv, { name: `Worker ${uid}` });
      const code = `const fs=require('fs'); (async()=>{const denied=[];for(const f of ${JSON.stringify([srv.data+'/bots.json',srv.dir+'/config/vault.key'])}){try{fs.readFileSync(f);denied.push(false)}catch{denied.push(true)}};const r=await fetch(${JSON.stringify(`http://127.0.0.2:${srv.botdotPort}/api/settings`)},{headers:{Host:'127.0.0.1'}});const door=await new Promise((ok)=>{const c=require('net').connect(${JSON.stringify(srv.socket)},()=>{c.destroy();ok(false)});c.on('error',()=>ok(true))});console.log(JSON.stringify({uid:process.getuid(),groups:process.getgroups(),http:r.status,denied,door}));})();`;
      const script = `node - <<'PROBE'\n${code}\nPROBE`;
      const added = await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name:'Identity probe',kind:'script',cron:'0 0 1 1 *',script,enabled:false,aiWhen:'never' } });
      assert.equal(added.status,201,JSON.stringify(added.data));
      await srv.api(`/bots/${bot.id}/jobs/${added.data.id}/run`, { method:'POST' });
      const run = await waitFor(async()=> (await srv.api(`/runs?botId=${bot.id}`)).data.find(r=>r.kind==='script'), {what:'script result'});
      assert.equal(run.status,'success',JSON.stringify(run));
      const result=JSON.parse(run.result);
      assert.equal(result.uid,uid); assert.ok(result.groups.every(g=>g===uid)); assert.equal(result.http,403); assert.deepEqual(result.denied,[true,true]);
      assert.equal(result.door,true,"a bot can't open the front door's socket");
    }
  } finally { await srv.stop(); }
});

test('nonroot backup and restore preserve files created privately by a bot', { skip: !CAN && 'needs isolated Linux root', timeout: 60000 }, async () => {
  const { makeBot, waitFor } = require('./helpers');
  let srv = await startServer({ broker:true,env:{BOT_DOT_SEPARATE_USERS:'1'} });
  try {
    const bot=await makeBot(srv,{name:'Private writer'});
    async function run(script) {
      const add=await srv.api(`/bots/${bot.id}/jobs`,{method:'POST',body:{name:'Private file',kind:'script',cron:'0 0 1 1 *',script,enabled:false,aiWhen:'never'}});
      assert.equal(add.status,201,JSON.stringify(add.data));
      await srv.api(`/bots/${bot.id}/jobs/${add.data.id}/run`,{method:'POST'});
      const result=await waitFor(async()=> (await srv.api(`/runs?botId=${bot.id}`)).data.find(r=>r.jobId===add.data.id),{what:'private file script'});
      assert.equal(result.status,'success',JSON.stringify(result));return result.result;
    }
    assert.match(await run('umask 077; printf "private bot file" > private.txt; echo saved'),/saved/);
    const passphrase='nonroot synthetic backup phrase';
    assert.equal((await srv.api('/backups/passphrase',{method:'PUT',body:{passphrase}})).status,200);
    const made=await srv.api('/backups/now',{method:'POST'});assert.equal(made.status,200,JSON.stringify(made.data));
    const raw=(await srv.api(`/backups/${made.data.last.name}`)).data;
    assert.ok(Buffer.isBuffer(raw));
    await run('rm private.txt; echo removed');
    const up=await srv.api('/backups/upload',{method:'POST',raw});
    const restore=await srv.api('/backups/restore',{method:'POST',body:{file:up.data.file,passphrase}});
    assert.equal(restore.status,200,JSON.stringify(restore.data));
    await srv.exited;
    srv=await startServer({dir:srv.dir,broker:true,env:{BOT_DOT_SEPARATE_USERS:'1'}});
    assert.match(await run('cat private.txt; stat -c " uid=%u mode=%a" private.txt'),/private bot file uid=61000 mode=600/);
  } finally { await srv.stop(); }
});

test('brokered Claude keeps private MCP settings and can use a skill and owner upload', {skip:!CAN&&'needs isolated Linux root',timeout:30000},async()=>{
 const {makeBot,heldRun,self,waitFor}=require('./helpers');const srv=await startServer({broker:true,env:{BOT_DOT_SEPARATE_USERS:'1'}});
 try{
  assert.equal((await srv.api('/skills',{method:'POST',body:{name:'safe-report',description:'Report layout',instructions:'Use short paragraphs.'}})).status,201);
  const bot=await makeBot(srv,{name:'Writer',skills:['safe-report']});
  const up=await srv.api(`/uploads?to=bot:${bot.id}`,{method:'POST',raw:Buffer.from('Private upload'),headers:{'X-File-Name':'note.txt'}});
  assert.equal(up.status,201,JSON.stringify(up.data));
  const {run,rec,token}=await heldRun(srv,bot);
  assert.equal(rec.uid,61000);assert.equal(rec.pluginReadable,true);assert.ok(token);
  // What it is told comes in a private file of its own user, never as an argument, with Claude Code's own memory off and its skill loaded (ADR 014).
  assert.equal(rec.args[rec.args.indexOf('--append-system-prompt-file')+1],rec.promptFile.path);assert.ok(!rec.args.includes('--append-system-prompt'));
  assert.match(rec.promptFile.path,/\/homes\/[^/]+\/[0-9a-f]{16}-botdot-prompt-[^/]+\.txt$/);assert.deepEqual([rec.promptFile.uid,rec.promptFile.mode],[61000,0o600]);
  assert.deepEqual([rec.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,rec.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS],['1','1']);assert.ok(rec.args.includes('--strict-mcp-config'));
  assert.deepEqual(rec.skills,['botdot:safe-report']);assert.ok(fs.existsSync(rec.promptFile.path));
  const attachment=await self(srv,token,'file',{path:up.data.file});
  assert.equal(attachment.data.ok,true,JSON.stringify(attachment.data));
  const downloaded=await fetch(`${srv.base}/api/files/${run.id}/${attachment.data.file.name}`);
  assert.equal(await downloaded.text(),'Private upload');
  srv.release(rec);assert.equal((await srv.finished(run.id)).status,'success');
  await waitFor(()=>!fs.existsSync(rec.promptFile.path),{what:'the prompt file to go once its Claude Code has exited'});
 }finally{await srv.stop()}
});

test('a prompt file a stopped botdot left in a home is removed when botdot starts again',{skip:!CAN&&'needs isolated Linux root',timeout:30000},async()=>{
 const {makeBot,heldRun,waitFor}=require('./helpers');let srv=await startServer({broker:true,env:{BOT_DOT_SEPARATE_USERS:'1'}});
 try{
  const bot=await makeBot(srv,{name:'Leaver'});
  const {run,rec}=await heldRun(srv,bot);srv.release(rec);await srv.finished(run.id);srv.unhold();
  // As a botdot that died in the middle of a run leaves them: the bot's, and the Chief's.
  const home=require('node:path').dirname(rec.promptFile.path);const chief=require('node:path').join(home,'..','chief');
  const left=[`${home}/0123456789abcdef-botdot-prompt-20261007000000-abc123.txt`,`${chief}/fedcba9876543210-botdot-prompt-chief-look.txt`];const kept=`${home}/notes-of-mine.txt`;
  fs.mkdirSync(chief,{recursive:true});for(const f of [...left,kept])fs.writeFileSync(f,'left behind',{mode:0o600});
  await srv.stop();
  srv=await startServer({dir:srv.dir,broker:true,env:{BOT_DOT_SEPARATE_USERS:'1'}});
  await waitFor(()=>left.every(f=>!fs.existsSync(f)),{what:'the left prompt files to be removed'});
  assert.ok(fs.existsSync(kept),'nothing else in the home is touched');
 }finally{await srv.stop()}
});

test('brokered Claude on the owner\'s Anthropic API key gets it, as its own user, and no subscription token (#35)',{skip:!CAN&&'needs isolated Linux root',timeout:30000},async()=>{
 const {makeBot,heldRun}=require('./helpers');const KEY='sk-ant-api03-nonroot-test-key-0123456789-abcd';
 const anthropic=require('node:http').createServer((req,res)=>{res.writeHead(req.headers['x-api-key']===KEY?200:401,{'Content-Type':'application/json'});res.end('{}');});
 await new Promise((ok)=>anthropic.listen(0,'127.0.0.1',ok));
 const srv=await startServer({broker:true,env:{BOT_DOT_SEPARATE_USERS:'1',BOT_DOT_ANTHROPIC_API_URL:`http://127.0.0.1:${anthropic.address().port}`}});
 try{
  const saved=await srv.api('/setup/claude/key',{method:'PUT',body:{key:KEY}});
  assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.claude.using,'api-key');
  const bot=await makeBot(srv,{name:'Keyed'});
  const {run,rec}=await heldRun(srv,bot);
  assert.equal(rec.uid,61000);assert.equal(rec.apiKey,KEY);assert.equal(rec.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);
  srv.release(rec);assert.equal((await srv.finished(run.id)).status,'success');
 }finally{await srv.stop();anthropic.closeAllConnections();anthropic.close()}
});

test('the Chief also runs separately and a timed-out script loses its child processes', {skip:!CAN&&'needs isolated Linux root',timeout:30000},async()=>{
 const {makeBot,waitFor}=require('./helpers');const srv=await startServer({broker:true,env:{BOT_DOT_SEPARATE_USERS:'1'}});
 try{
  const chat=await srv.api('/chief/chats',{method:'POST',body:{}});assert.equal(chat.status,201,JSON.stringify(chat.data));
  await srv.api(`/chief/chats/${chat.data.id}/messages`,{method:'POST',body:{text:'Hello'}});
  const rec=await srv.nextRun(r=>r.args.includes('🧭 Chief of Staff'));assert.equal(rec.uid,60500);assert.ok(rec.botdot);
  assert.match(rec.promptFile.path,/\/homes\/chief\/[0-9a-f]{16}-botdot-prompt-chief-/);assert.deepEqual([rec.promptFile.uid,rec.promptFile.mode],[60500,0o600]);
  assert.deepEqual([rec.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,rec.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS],['1','1']);
  const bot=await makeBot(srv,{name:'Timeout worker'});
  const add=await srv.api(`/bots/${bot.id}/jobs`,{method:'POST',body:{name:'Timeout',kind:'script',cron:'0 0 1 1 *',script:'sleep 1000 & echo child=$!; wait',timeoutSeconds:5,enabled:false,aiWhen:'never'}});
  assert.equal(add.status,201,JSON.stringify(add.data));
  await srv.api(`/bots/${bot.id}/jobs/${add.data.id}/run`,{method:'POST'});
  const result=await waitFor(async()=> (await srv.api(`/runs?botId=${bot.id}`)).data.find(r=>r.jobId===add.data.id),{timeout:15000,what:'timed-out process tree'});
  assert.equal(result.timedOut,true);const pid=result.result.match(/child=(\d+)/)?.[1];assert.ok(pid,JSON.stringify(result));
  await waitFor(()=>{try{return /^State:\s+Z/m.test(fs.readFileSync(`/proc/${pid}/status`,'utf8'))}catch(e){return e.code==='ENOENT'}},{what:'child termination'});
 }finally{await srv.stop()}
});
