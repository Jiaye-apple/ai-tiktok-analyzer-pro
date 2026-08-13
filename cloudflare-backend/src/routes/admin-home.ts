import type { Context } from 'hono';
import type { Env, UserRow } from '../lib/types';
import { brandTitle, html, page } from '../site/layout';

type AdminCtx = Context<{ Bindings: Env; Variables: { user: UserRow | null } }>;

/**
 * GET /admin —— 运营后台首页。
 *
 * 在这之前 /admin 是个纯前缀，底下全是 API，浏览器直接开会吃一个全局 404，
 * 和「被 Access 拦了」长得一模一样（lib/owner.ts 的假 404 是故意做成这样的），
 * 分不清是没权限还是地址错。这页就是那个落地点：把所有入口摆出来。
 *
 * 顺带把激活码的三件事（发码 / 查批次 / 作废）做成能点的表单 ——
 * 原来只有 POST 接口，发码得开终端拼 curl，浏览器里干不了。
 *
 * 鉴权不在这儿：admin.ts 的 r.use('*') 已经把整个 /admin/* 挡在
 * Access + X-Admin-Key 之外，能读到这页的必然是属主本人。
 */
export const adminHomePage = (c: AdminCtx) =>
  html(
    page({
      title: brandTitle('Admin'),
      nav: '',
      style: `
  main{max-width:900px}
  .card + .card{margin-top:18px}
  h2{font-size:16px;margin:0 0 4px}
  .hint{font-size:12.5px;color:var(--muted);line-height:1.65;margin:0 0 16px}
  .hint code{font-size:12px}
  .links{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
  .links a{
    display:block;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-md);
    text-decoration:none;color:var(--ink);transition:border-color .15s,background .15s;
  }
  .links a:hover{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 5%,transparent);text-decoration:none}
  .links a b{display:block;font-size:14px;font-weight:600}
  .links a span{display:block;font-size:12px;color:var(--muted);margin-top:2px;word-break:break-all}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 14px}
  /* BASE_CSS 只给 input 定了皮，select 不跟着走，这里补齐 */
  select{
    width:100%;padding:11px 13px;font-size:15px;font-family:var(--sans);
    border:1px solid var(--line);border-radius:var(--r-sm);background:var(--paper);color:var(--ink);
  }
  select:focus{outline:2px solid var(--accent);outline-offset:-1px}
  .row2{display:flex;gap:10px;align-items:flex-end}
  .row2 > div{flex:1}
  button.ghost{
    width:auto;margin-top:0;padding:11px 16px;background:transparent;color:var(--ink);
    border:1px solid var(--line);font-size:14px;font-weight:500;white-space:nowrap;
  }
  button.ghost:hover:not(:disabled){background:color-mix(in srgb,var(--ink) 5%,transparent)}
  .out{margin-top:16px;display:none}
  .out.show{display:block}
  .codes{
    font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:13px;line-height:1.9;
    background:var(--paper);border:1px solid var(--line);border-radius:var(--r-sm);
    padding:12px 14px;max-height:320px;overflow:auto;white-space:pre;user-select:all;
  }
  .acts{display:flex;gap:10px;margin-top:12px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
  th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{font-size:12px;color:var(--muted);font-weight:500}
  td.mono{font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
  .api{width:100%;border-collapse:collapse;font-size:13px}
  .api td{border-bottom:1px solid var(--line);padding:8px;vertical-align:top;white-space:normal}
  .api td.m{width:52px;color:var(--muted);font-size:11.5px;font-weight:600;white-space:nowrap}
  .api td.p{width:38%;font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);word-break:break-all}
  .api td.d{color:var(--muted)}
`,
      body: `<div class="card">
  <h1>Admin</h1>
  <p class="sub">Cloudflare Access 已放行。这台机器上的浏览器可以直接调下面所有接口。</p>
  <h2>后台页面</h2>
  <p class="hint">有界面的就这三个。</p>
  <div class="links">
    <a href="/admin/feedback"><b>意见反馈</b><span>/admin/feedback</span></a>
    <a href="/wish/admin"><b>功能许愿</b><span>/wish/admin</span></a>
    <a href="/admin"><b>本页</b><span>/admin</span></a>
  </div>
</div>

<div class="card">
  <h2>生成激活码</h2>
  <p class="hint">
    码是无主的（不绑定用户），生成后直接把字符串发给谁都行 —— 用户在扩展 popup
    的权益面板里找「激活码」入口兑换。生成时定的是套餐和天数，兑换那一刻才开始算有效期。
    码面事后能按批次号查回来，但当场复制/下载最省事。
  </p>
  <div class="grid">
    <div>
      <label for="g-plan">套餐</label>
      <select id="g-plan"></select>
    </div>
    <div>
      <label for="g-days">时长（天）</label>
      <input id="g-days" type="number" value="31" min="1">
    </div>
    <div>
      <label for="g-count">数量</label>
      <input id="g-count" type="number" value="10" min="1" max="1000">
    </div>
    <div>
      <label for="g-uses">每张可用次数</label>
      <input id="g-uses" type="number" value="1" min="1">
    </div>
  </div>
  <div class="grid">
    <div>
      <label for="g-batch">批次号（留空自动按日期生成）</label>
      <input id="g-batch" placeholder="B20260807">
    </div>
    <div>
      <label for="g-note">备注（自己看的，比如渠道名）</label>
      <input id="g-note" placeholder="小红书 8 月活动">
    </div>
  </div>
  <button id="g-go">生成</button>
  <div id="g-msg" class="msg"></div>
  <div id="g-out" class="out">
    <div class="codes" id="g-codes"></div>
    <div class="acts">
      <button class="ghost" id="g-copy">复制全部</button>
      <button class="ghost" id="g-csv">下载 CSV</button>
    </div>
  </div>
</div>

<div class="card">
  <h2>查批次 / 作废</h2>
  <p class="hint">发出去的码事后只能按批次号查。作废填批次号则整批未使用的码一起废掉；填单张码则只废那一张。</p>
  <div class="row2">
    <div>
      <label for="q-batch">批次号</label>
      <input id="q-batch" placeholder="B20260807">
    </div>
    <button class="ghost" id="q-go">查询</button>
  </div>
  <div class="row2" style="margin-top:14px">
    <div>
      <label for="d-key">作废（批次号 或 单张码）</label>
      <input id="d-key" placeholder="B20260807 或 ABCD-EFGH-JKLM-NPQR">
    </div>
    <button class="ghost" id="d-go">作废</button>
  </div>
  <div id="q-msg" class="msg"></div>
  <div id="q-out" class="out"></div>
</div>

<div class="card">
  <h2>数据查询</h2>
  <p class="hint">都是 GET，点开就是 JSON。</p>
  <div class="links">
    <a href="/admin/orders?limit=100" target="_blank"><b>订单流水</b><span>/admin/orders</span></a>
    <a href="/admin/webhook-events?limit=100" target="_blank"><b>支付回调流水</b><span>/admin/webhook-events</span></a>
    <a href="/admin/wishes?limit=100" target="_blank"><b>许愿原始数据</b><span>/admin/wishes</span></a>
    <a href="/admin/announcements" target="_blank"><b>公告列表</b><span>/admin/announcements</span></a>
    <a href="/admin/plans" target="_blank"><b>套餐字典</b><span>/admin/plans</span></a>
  </div>
</div>

<div class="card">
  <h2>一键操作</h2>
  <p class="hint">两个不用填参数的维护动作。</p>
  <div class="row2">
    <button class="ghost" id="op-settle">结算挂起的预扣配额</button>
    <button class="ghost" id="op-ai">AI 供应商自检</button>
  </div>
  <div id="op-msg" class="msg"></div>
  <div id="op-out" class="out"><div class="codes" id="op-body"></div></div>
</div>

<div class="card">
  <h2>其余写接口</h2>
  <p class="hint">
    页面上没做表单，用 curl 打。浏览器里已经有 Access 会话，脚本里要额外带
    <code>X-Admin-Key</code> 加一对 <code>CF-Access-Client-Id/Secret</code>（见 scripts/smoke-test.sh）。
  </p>
  <table class="api">
    <tr><td class="m">POST</td><td class="p">/admin/users</td><td class="d">建用户 · <code>{username, email?, phone?, planCode?}</code></td></tr>
    <tr><td class="m">POST</td><td class="p">/admin/users/:id/token</td><td class="d">发长期 token（调试用）</td></tr>
    <tr><td class="m">POST</td><td class="p">/admin/users/:id/plan</td><td class="d">改会员 · <code>{planCode, expireAt?}</code>，expireAt 传 0 = 不过期</td></tr>
    <tr><td class="m">POST</td><td class="p">/admin/users/:id/quota/grant</td><td class="d">补额度 · <code>{quotaType, amount, period?}</code></td></tr>
    <tr><td class="m">POST</td><td class="p">/admin/announcements</td><td class="d">发站内公告 · <code>{title, body, lang?, pinned?}</code></td></tr>
    <tr><td class="m">POST</td><td class="p">/admin/announcements/:id/hide</td><td class="d">下线一条公告（不物理删）</td></tr>
    <tr><td class="m">POST</td><td class="p">/admin/notify</td><td class="d">给单个用户发消息 · <code>{userId, title, body?, link?}</code></td></tr>
    <tr><td class="m">POST</td><td class="p">/admin/jobs/run</td><td class="d">手动跑离线任务 · <code>{kind, limit?}</code>，同步执行别开太大</td></tr>
    <tr><td class="m">GET</td><td class="p">/admin/activation/batch/:batch</td><td class="d">查批次（上面那个表单就是它）</td></tr>
  </table>
</div>`,
      script: `
(function(){
  var $ = function(id){ return document.getElementById(id); };

  function say(box, text, kind){
    box.textContent = text;
    box.className = 'msg show ' + kind;
  }
  function clear(box){ box.textContent = ''; box.className = 'msg'; }

  /** 统一的请求外壳：返回 data，出错抛 Error（message 直接是后端那句话）。 */
  async function call(path, body){
    var res = await fetch(path, body === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var j = await res.json().catch(function(){ return null; });
    // 后端全站 200 + code 字段，res.ok 靠不住，只认 code。
    if (!j || j.code !== 'OK') throw new Error((j && j.message) || '请求失败（HTTP ' + res.status + '）');
    return j.data;
  }

  // ---- 套餐下拉：从库里读，别在前端写死一份会过期的副本 -------------------
  var plan = $('g-plan');
  var days = $('g-days');
  var planDays = {};
  (async function(){
    try {
      var list = await call('/admin/plans');
      list.forEach(function(p){
        if (p.code === 'free') return;           // 免费版发码没意义
        planDays[p.code] = p.durationDays;
        var o = document.createElement('option');
        o.value = p.code;
        o.textContent = p.name + ' (' + p.code + ')';
        plan.appendChild(o);
      });
      syncDays();
    } catch (e) {
      var o = document.createElement('option');
      o.textContent = '套餐读取失败：' + e.message;
      plan.appendChild(o);
    }
  })();
  // 选中套餐时把时长填成该套餐的自然周期，仍可手改（比如补偿性的 7 天卡）。
  function syncDays(){ if (planDays[plan.value]) days.value = planDays[plan.value]; }
  plan.addEventListener('change', syncDays);

  // ---- 生成 -------------------------------------------------------------
  var gMsg = $('g-msg'), gOut = $('g-out'), gCodes = $('g-codes'), gGo = $('g-go');
  var lastBatch = '';

  gGo.addEventListener('click', async function(){
    clear(gMsg);
    gOut.className = 'out';
    gGo.disabled = true;
    try {
      var d = await call('/admin/activation/generate', {
        planCode: plan.value,
        durationDays: Number(days.value),
        count: Number($('g-count').value),
        maxUses: Number($('g-uses').value),
        batch: $('g-batch').value.trim() || undefined,
        note: $('g-note').value.trim() || undefined,
      });
      lastBatch = d.batch;
      gCodes.textContent = d.codes.join('\\n');
      gOut.className = 'out show';
      say(gMsg, '已生成 ' + d.count + ' 张，批次 ' + d.batch + '。事后可以用批次号查回码面，但先复制走更省事。', 'ok');
      $('q-batch').value = d.batch;
    } catch (e) {
      say(gMsg, e.message, 'err');
    } finally {
      gGo.disabled = false;
    }
  });

  $('g-copy').addEventListener('click', function(){
    navigator.clipboard.writeText(gCodes.textContent).then(
      function(){ say(gMsg, '已复制 ' + gCodes.textContent.split('\\n').length + ' 张到剪贴板。', 'ok'); },
      function(){ say(gMsg, '复制失败，手动全选下面那块。', 'err'); }
    );
  });

  $('g-csv').addEventListener('click', function(){
    var rows = ['code,plan,days,batch'];
    gCodes.textContent.split('\\n').forEach(function(code){
      if (code) rows.push([code, plan.value, days.value, lastBatch].join(','));
    });
    var url = URL.createObjectURL(new Blob([rows.join('\\n')], { type: 'text/csv' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = (lastBatch || 'codes') + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  // ---- 查批次 / 作废 -----------------------------------------------------
  var qMsg = $('q-msg'), qOut = $('q-out');

  $('q-go').addEventListener('click', async function(){
    clear(qMsg);
    qOut.className = 'out';
    var batch = $('q-batch').value.trim();
    if (!batch) { say(qMsg, '填个批次号。', 'err'); return; }
    try {
      var rows = await call('/admin/activation/batch/' + encodeURIComponent(batch));
      if (!rows.length) { say(qMsg, '这个批次没有码。', 'err'); return; }
      var used = rows.filter(function(r){ return r.usedCount > 0; }).length;
      qOut.textContent = '';
      var t = document.createElement('table');
      var head = ['码', '套餐', '天数', '状态', '已用/上限', '生成时间'];
      var tr = document.createElement('tr');
      head.forEach(function(h){
        var th = document.createElement('th');
        th.textContent = h;
        tr.appendChild(th);
      });
      t.appendChild(tr);
      rows.forEach(function(r){
        var line = document.createElement('tr');
        // created_at 是 unixepoch 秒，直接打出来是一串数字，没法看
        var when = new Date(r.createdAt * 1000).toLocaleString();
        [r.code, r.planCode, r.days, r.status, r.usedCount + '/' + r.maxUses, when].forEach(function(v, i){
          var td = document.createElement('td');
          if (i === 0) td.className = 'mono';
          td.textContent = String(v);
          line.appendChild(td);
        });
        t.appendChild(line);
      });
      qOut.appendChild(t);
      qOut.className = 'out show';
      say(qMsg, batch + '：共 ' + rows.length + ' 张，已被兑换 ' + used + ' 张。', 'ok');
    } catch (e) {
      say(qMsg, e.message, 'err');
    }
  });

  $('d-go').addEventListener('click', async function(){
    clear(qMsg);
    var key = $('d-key').value.trim();
    if (!key) { say(qMsg, '填批次号或单张码。', 'err'); return; }
    var single = /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/.test(key);
    if (!confirm(single ? '作废这张码：' + key + '？' : '作废批次 ' + key + ' 里所有还没被用掉的码？')) return;
    try {
      await call('/admin/activation/disable', single ? { code: key } : { batch: key });
      say(qMsg, '已作废。已经兑换过的不受影响（会员时长不回收）。', 'ok');
    } catch (e) {
      say(qMsg, e.message, 'err');
    }
  });

  // ---- 一键操作 ---------------------------------------------------------
  var opMsg = $('op-msg'), opOut = $('op-out'), opBody = $('op-body');
  function runOp(btn, path, label){
    btn.addEventListener('click', async function(){
      clear(opMsg);
      opOut.className = 'out';
      btn.disabled = true;
      try {
        var d = await call(path, {});
        opBody.textContent = JSON.stringify(d, null, 2);
        opOut.className = 'out show';
        say(opMsg, label + '完成。', 'ok');
      } catch (e) {
        say(opMsg, e.message, 'err');
      } finally {
        btn.disabled = false;
      }
    });
  }
  runOp($('op-settle'), '/admin/quota/settle', '结算');
  runOp($('op-ai'), '/admin/ai/selftest', '自检');
})();
`,
    }),
  );
