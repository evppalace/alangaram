/* OneByte Production — push notification senders (Firebase Cloud Functions, 2nd gen).
 * Reads device tokens from  prod_push/{userId}/{hash}  (saved by the Android app after login)
 * and sends FCM messages when escalations, feedback, notices or meal events happen.
 * Deploy:  cd prod-functions && npm install && firebase deploy --only functions --project evp-crm
 * Needs the Blaze (pay-as-you-go) plan. Cost for this volume is normally ₹0 (free tier).
 */
const { onValueCreated, onValueUpdated, onValueWritten } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');
admin.initializeApp();
const REGION = 'asia-southeast1', INSTANCE = 'evp-crm-default-rtdb';
const opt = ref => ({ ref, region: REGION, instance: INSTANCE });
const pad3 = n => String(n || 0).padStart(3, '0');
const STAFF = ['admin', 'prodmanager', 'opsmanager', 'supervisor'];

async function tokensFor(pred) {
  const snap = await admin.database().ref('prod_push').once('value');
  const out = [];
  snap.forEach(u => u.forEach(t => { const v = t.val(); if (v && v.token && pred(v)) out.push({ token: v.token, path: `prod_push/${u.key}/${t.key}` }); }));
  return out;
}
async function send(targets, title, body, ref, extra) {
  if (!targets.length) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens: targets.map(t => t.token),
    notification: { title, body: (ref ? ref + ' · ' : '') + body },
    data: Object.assign({ ref: ref || '' }, extra || {}),
    android: { priority: 'high', notification: Object.assign({ tag: ref || undefined }, extra && extra.loud ? { channelId: 'urgent', sound: 'default', defaultVibrateTimings: true, priority: 'max' } : {}) }
  });
  const dead = [];
  res.responses.forEach((r, i) => { if (!r.success && /registration-token-not-registered|invalid-argument|invalid-registration/.test((r.error && r.error.code) || '')) dead.push(targets[i].path); });
  await Promise.all(dead.map(p => admin.database().ref(p).remove()));
}
const toStaff = (site) => v => STAFF.includes(v.role) && (v.role !== 'supervisor' || v.siteId === 'all' || !site || v.siteId === site);
const toAgg = (site) => v => v.role === 'aggregator' && (v.siteId === 'all' || !v.siteId || !site || site === 'all' || v.siteId === site);

/* Aggregator raised an escalation -> staff (level 1 = Site Supervisor) */
exports.onEscalationCreated = onValueCreated(opt('/prod_escalations/{id}'), async ev => {
  const e = ev.data.val(); if (!e) return;
  await send(await tokensFor(toStaff(e.siteId)), `🚨 Client escalation — ${e.sev}`, `${e.cat}: ${(e.text || '').slice(0, 90)}`, 'ESC-' + pad3(e.n), { type: 'esc' });
});
/* Escalation status / level changed -> client (status) or staff (moved up) */
exports.onEscalationUpdated = onValueUpdated(opt('/prod_escalations/{id}'), async ev => {
  const a = ev.data.before.val(), b = ev.data.after.val(); if (!a || !b) return;
  const ref = 'ESC-' + pad3(b.n);
  if ((b.level || 1) > (a.level || 1)) await send(await tokensFor(toStaff(b.siteId)), `⬆ Escalation moved to level ${b.level}`, `${b.cat} — needs attention now`, ref, { type: 'esc' });
  if (b.status !== a.status) await send(await tokensFor(toAgg(b.siteId)), `Escalation ${ref}: ${b.status}`, b.resolution || b.cat, ref, { type: 'esc' });
  if (b.status !== a.status && b.status === 'open' && a.status === 'resolved') await send(await tokensFor(toStaff(b.siteId)), 'Client says not fixed', b.cat, ref, { type: 'esc' });
});
/* New feedback -> staff; reply -> client */
exports.onFeedbackCreated = onValueCreated(opt('/prod_feedback/{id}'), async ev => {
  const f = ev.data.val(); if (!f) return;
  await send(await tokensFor(toStaff(f.siteId)), `💬 Client ${f.type}`, (f.text || '').slice(0, 100), f.n ? 'FB-' + pad3(f.n) : '', { type: 'fb' });
});
exports.onFeedbackUpdated = onValueUpdated(opt('/prod_feedback/{id}'), async ev => {
  const a = ev.data.before.val(), b = ev.data.after.val(); if (!a || !b || a.reply || !b.reply) return;
  await send(await tokensFor(toAgg(b.siteId)), 'Reply from Kalyana Sapadu', b.reply.slice(0, 100), b.n ? 'FB-' + pad3(b.n) : '', { type: 'fb' });
});
/* Notice board post -> everybody on staff */
exports.onNoticeCreated = onValueCreated(opt('/prod_notices/{id}'), async ev => {
  const n = ev.data.val(); if (!n) return;
  await send(await tokensFor(v => v.role !== 'aggregator'), '📢 Notice from ' + (n.by || 'office'), (n.text || '').slice(0, 110), '', { type: 'notice' });
});
/* Meal events: vehicle left / arrived, QC failed, meal closed (wastage) -> client + managers */
exports.onSessionTimes = onValueWritten(opt('/prod_sessions/{sid}'), async ev => {
  const a = ev.data.before.val() || {}, b = ev.data.after.val(); if (!b) return;
  const sid = ev.params.sid, [d, site, meal] = sid.split('_');
  const code = 'ML-' + d.slice(8, 10) + d.slice(5, 7) + '-' + site.slice(0, 3).toUpperCase() + '-' + String(meal || '').slice(0, 3).toUpperCase();
  const at = (o, k) => o && o.times && o.times[k] && o.times[k].ts;
  const tag = `${site.toUpperCase()} · ${meal}`;
  const both = site => v => toStaff(site)(v) || toAgg(site)(v);
  if (!at(a, 'departed') && at(b, 'departed')) await send(await tokensFor(both(site)), `🚚 Left kitchen — ${tag}`, `${b.vehicle || 'Vehicle'}${b.driver ? ' · ' + b.driver : ''}${b.odo && b.odo.start != null ? ' · meter ' + b.odo.start + ' km' : ''}`, code, { type: 'trip' });
  if (!at(a, 'arrived') && at(b, 'arrived')) await send(await tokensFor(both(site)), `📍 Arrived at counter — ${tag}`, b.odo && b.odo.end != null && b.odo.start != null ? `${Math.round((b.odo.end - b.odo.start) * 10) / 10} km driven` : 'Food has reached the counter', code, { type: 'trip' });
  ['qc1', 'qc2'].forEach(async k => { if ((!a[k] || !a[k].ts) && b[k] && b[k].ts && b[k].ok === false) await send(await tokensFor(both(site)), `⚠️ Quality check failed — ${tag}`, `${k === 'qc1' ? 'Kitchen' : 'Arrival'} check${b[k].temp != null ? ' · ' + b[k].temp + '°C' : ''}`, code, { type: 'qc' }); });
  if (!at(a, 'closed') && at(b, 'closed')) await send(await tokensFor(toAgg(site)), `♻️ Wastage update — ${tag}`, 'Meal closed. Open the app for the wastage figures.', code, { type: 'waste' });
});

/* ---- Production hand-offs: loud alerts to the people above & below each step ---- */
const roleIn = (roles, loudRoles, site) => v => roles.includes(v.role) && (!['supervisor', 'counter'].includes(v.role) || v.siteId === 'all' || !site || v.siteId === site);
const HAND = {
  planned: ['🗓️ Plan sent to kitchen', ['kitchen', 'cook', 'store', 'prodmanager', 'opsmanager', 'admin'], ['kitchen', 'cook']],
  cookStart: ['🍳 Cooking started', ['prodmanager', 'opsmanager', 'store', 'admin', 'driver', 'supervisor', 'counter'], []],
  prodDone: ['✅ Cooking complete — ready for QC', ['prodmanager', 'opsmanager', 'driver', 'supervisor', 'counter', 'admin', 'kitchen', 'cook'], ['prodmanager', 'opsmanager', 'driver']],
  packed: ['📦 Packed', ['driver', 'prodmanager', 'opsmanager', 'kitchen', 'cook', 'admin'], ['driver']],
  loaded: ['🚛 Loaded in vehicle', ['driver', 'prodmanager', 'opsmanager', 'supervisor', 'counter', 'admin', 'kitchen', 'cook'], ['driver']],
  counterLoaded: ['🍽️ Loaded into food counter', ['prodmanager', 'opsmanager', 'kitchen', 'cook', 'admin', 'supervisor', 'counter', 'store'], []]
};
exports.onHandOffs = onValueWritten(opt('/prod_sessions/{sid}'), async ev => {
  const a = ev.data.before.val() || {}, b = ev.data.after.val(); if (!b) return;
  const sid = ev.params.sid, [d, site, meal] = sid.split('_'), tag = `${site.toUpperCase()} · ${meal}`;
  const at = (o, k) => o && o.times && o.times[k] && o.times[k].ts;
  for (const [k, [title, roles, loud]] of Object.entries(HAND)) {
    const ts = at(b, k); if (!ts || ts === at(a, k)) continue;
    const by = b.times[k].by || '';
    if (k === 'planned') {
      /* one alert for the whole day's plan (batch), cook is told to send the requirement */
      const batch = b.times[k].batch || (sid + ts);
      const lock = await admin.database().ref('prod_pushlock/' + String(batch).replace(/[.#$\[\]\/]/g, '_')).transaction(c => c ? undefined : Date.now());
      if (!lock.committed) continue;
      const cookT = await tokensFor(v => v.role === 'cook');
      await send(cookT, '🗓️ Meal plan sent — now send your requirement', `by ${by} · ${d}`, '', { type: 'handoff', loud: '1', tab: 'req', date: d });
      const kT = await tokensFor(v => v.role === 'kitchen');
      await send(kT, '🗓️ Meal plan sent to kitchen — ' + d, `by ${by}`, '', { type: 'handoff', loud: '1', tab: 'prod', date: d });
      const oT = await tokensFor(v => ['store', 'prodmanager', 'opsmanager', 'admin'].includes(v.role));
      await send(oT, '🗓️ Meal plan sent to kitchen — ' + d, `by ${by}`, '', { type: 'handoff', tab: 'prod', date: d });
      continue;
    }
    const all = await tokensFor(roleIn(roles, loud, site));
    const isLoud = v => loud.includes(v.role);
    const lt = (await tokensFor(v => roleIn(roles, loud, site)(v) && isLoud(v))), st = all.filter(t => !lt.some(x => x.token === t.token));
    const tab = k === 'cookStart' ? 'prod' : 'prod';
    await send(lt, title + ' — ' + tag, 'by ' + by, '', { type: 'handoff', loud: '1', tab, sid, date: d });
    await send(st, title + ' — ' + tag, 'by ' + by, '', { type: 'handoff', tab, sid, date: d });
  }
});
exports.onKitchenIssue = onValueCreated(opt('/prod_ledger/{id}'), async ev => {
  const e = ev.data.val(); if (!e || e.type !== 'issue') return;
  if (e.batch) {
    const snap = await admin.database().ref('prod_ledger').orderByChild('batch').equalTo(e.batch).once('value');
    const keys = Object.keys(snap.val() || {}).sort(); if (keys[0] !== ev.params.id) return;
  }
  const tgt = e.allDay ? 'entire production' : e.siteId ? `${String(e.siteId).toUpperCase()} · ${e.meal}` : 'general kitchen use';
  const date = e.forDate || e.date;
  await send(await tokensFor(v => ['kitchen', 'cook'].includes(v.role)), `📤 Raw material issued — ${tgt}`, `by ${e.by || 'Store Keeper'} · start production`, '', { type: 'issue', loud: '1', tab: 'prod', date });
  await send(await tokensFor(v => ['prodmanager', 'opsmanager', 'admin'].includes(v.role)), `📤 Raw material issued — ${tgt}`, `by ${e.by || 'Store Keeper'}`, '', { type: 'issue', tab: 'prod', date });
});
/* ---- Cook's daily requirement: ONLY Store Keeper, Production / Operations Manager (approve) and Admin ---- */
const reqTxt = x => { const n = Object.keys(x.items || {}).length; return `by ${x.by || 'Cook'}${n ? ' · ' + n + ' items' : ''}${x.photoKey ? ' · photo' : ''}`; };
exports.onRequirement = onValueCreated(opt('/prod_settings/reqs/{date}/{id}'), async ev => {
  const x = ev.data.val(); if (!x) return;
  const date = ev.params.date, txt = reqTxt(x);
  if (x.approved) { /* sent by a manager: already approved → store issues */
    await send(await tokensFor(v => v.role === 'store'), `✅ Approved requirement — issue the material (${date})`, txt, '', { type: 'req', loud: '1', tab: 'issue', date });
    await send(await tokensFor(v => v.role === 'admin'), `📝 Requirement ${date}`, txt, '', { type: 'req', tab: 'req', date });
    return;
  }
  await send(await tokensFor(v => ['prodmanager', 'opsmanager'].includes(v.role)), `📝 Approve cook requirement (${date})`, txt, '', { type: 'req', loud: '1', tab: 'req', date });
  await send(await tokensFor(v => ['store', 'admin'].includes(v.role)), `📝 Cook requirement sent (${date})`, txt + ' · waiting for approval', '', { type: 'req', tab: 'req', date });
});
exports.onRequirementUpdated = onValueUpdated(opt('/prod_settings/reqs/{date}/{id}'), async ev => {
  const a = ev.data.before.val() || {}, b = ev.data.after.val(); if (!b) return;
  const date = ev.params.date, txt = reqTxt(b);
  if (!a.approved && b.approved && !b.issuedTs) {
    await send(await tokensFor(v => v.role === 'store'), `✅ Approved requirement — issue the material (${date})`, txt + ' · approved by ' + (b.appBy || 'manager'), '', { type: 'req', loud: '1', tab: 'issue', date });
    await send(await tokensFor(v => v.role === 'cook' && v.name === b.by), `✅ Requirement approved (${date})`, 'Store will issue the material', '', { type: 'req', tab: 'req', date });
  }
  if (!a.rejected && b.rejected) await send(await tokensFor(v => v.role === 'cook' && v.name === b.by), `↩ Requirement sent back (${date})`, b.rejNote || 'Please check and send again', '', { type: 'req', loud: '1', tab: 'req', date });
});
