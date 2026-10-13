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
const STAFF = ['admin', 'prodmanager', 'supervisor'];

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
    android: { priority: 'high', notification: { tag: ref || undefined } }
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
