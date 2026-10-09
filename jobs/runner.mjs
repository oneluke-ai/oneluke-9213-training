// 毎週の通知（未受講アラート・週次オーナーレポート）を、GitHubの定期実行で動かす入れもの（2026-10-09）
// ・計算の中身は、Airtableの自動化に貼るスクリプトと「同じファイル」を使う（alert.js / report.js ＝店舗フォルダのスクリプトのコピー）。
//   → 将来、Airtableの有料プラン（スクリプトが使える自動化）に移るときは、同じスクリプトをAirtableに貼って、この定期実行を止めるだけ。
// ・動くモード（環境変数 MODE）
//     rehearsal（初期値）：リハーサル。スタッフ・オーナーには送らず、「事務局」（Takeshiさん）のLINEにだけ、内容を送る。
//     live            ：本番。未受講アラートは、各スタッフ本人へ。週次レポートは、オーナーへ。
// ・公開リポジトリの実行ログは、誰でも読める。氏名・成績・LINE IDは、ログに出さない（件数だけ）。
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODE = (process.env.MODE || 'rehearsal').trim() === 'live' ? 'live' : 'rehearsal';
const LINE_TOKEN = (process.env.LINE_TOKEN || '').trim();
const AT_TOKEN = (process.env.AIRTABLE_TOKEN || '').trim();
const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appeVL1rcZRewakv3';
const REHEARSAL_NAME = '事務局';
if (!LINE_TOKEN || !AT_TOKEN) { console.log('NG: トークンが設定されていません（Secrets）'); process.exit(1); }

// Airtable用スクリプトの、純粋な計算の部分だけを取り出す（Airtableの専用部分は、使わない）
function loadPure(file) {
  const code = fs.readFileSync(path.join(here, file), 'utf8').split('// ---- Airtable Automation')[0];
  const sb = { module: { exports: {} }, console };
  vm.createContext(sb);
  vm.runInContext(code, sb);
  return sb.module.exports;
}
const alertLib = loadPure('alert.js');
const reportLib = loadPure('report.js');

async function allRecords(table, fields) {
  const out = []; let offset;
  do {
    const u = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`);
    fields.forEach(f => u.searchParams.append('fields[]', f));
    if (offset) u.searchParams.set('offset', offset);
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + AT_TOKEN } });
    if (!r.ok) throw new Error('Airtable ' + r.status);
    const j = await r.json(); out.push(...j.records); offset = j.offset;
  } while (offset);
  return out;
}

async function push(userId, text) {
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LINE_TOKEN },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
    });
    return r.status;
  } catch (e) {
    return 0; // 通信エラー。1人の失敗で、ほかの人への送信を止めない
  }
}

const AC = alertLib.CONFIG, RC = reportLib.CONFIG;
const quiz = (await allRecords(AC.QUIZ_TABLE, ['受講者名', '所属店舗', 'ステータス', '受講日時', '正答数', '総問題数', '合格判定', 'クイズID', '動画タイトル']));
const linkRaw = (await allRecords(AC.LINK_TABLE, ['氏名', '所属店舗', 'LINE_UserID', '登録日時']));
const linkRecords = linkRaw.map(r => ({ name: r.fields['氏名'] || '', store: r.fields['所属店舗'] || '', userId: r.fields['LINE_UserID'] || '', registeredAt: r.fields['登録日時'] }));
const alertQuiz = quiz.map(r => ({ name: r.fields['受講者名'] || '', store: r.fields['所属店舗'] || '', status: r.fields['ステータス'] || '', date: r.fields['受講日時'], correct: r.fields['正答数'] ?? null }));
const reportQuiz = quiz.map(r => ({
  name: r.fields['受講者名'] || '', store: r.fields['所属店舗'] || '', status: r.fields['ステータス'] || '', date: r.fields['受講日時'],
  correct: r.fields['正答数'] ?? null, total: r.fields['総問題数'] ?? null, judged: r.fields['合格判定'] || '',
  quizKey: r.fields['動画タイトル'] || r.fields['クイズID'] || '',
}));

// 最新のLINE IDを探す（同じ人が複数回連携している時は、登録日時が一番新しいもの）
function latestUserId(name) {
  let best = null;
  linkRecords.filter(r => r.name === name && r.store === AC.STORE && r.userId).forEach(r => {
    const t = r.registeredAt ? String(r.registeredAt) : '';
    if (!best || t >= best.t) best = { userId: r.userId, t };
  });
  return best ? best.userId : null;
}
const rehearsalTo = latestUserId(REHEARSAL_NAME);

const now = Date.now();
let sentAlerts = 0, failedAlerts = 0;
const problems = []; // 通知できていない状態（あれば、ジョブを失敗にして、GitHubから気づけるようにする）

// ---- 1) 未受講アラート ----
const plan = alertLib.planAlerts(alertQuiz, linkRecords, now, { ...AC, TEST_NAMES: [] });
if (MODE === 'live') {
  for (const t of plan.targets) {
    const st = await push(t.userId, alertLib.buildMessage(t.name, false));
    if (st === 200) sentAlerts++; else failedAlerts++;
  }
  if (failedAlerts > 0) problems.push('alert-send-failed');
} else if (!rehearsalTo) {
  problems.push('rehearsal-destination-unlinked');
} else if (rehearsalTo) {
  const text = '【リハーサル・未受講アラート】\n本番では、次の方に送ります。\n'
    + (plan.targets.length ? plan.targets.map(t => '・' + t.name).join('\n') : '（LINE連携済みの未受講の方は、いません）')
    + '\n\nLINE未連携で送れない方：' + (plan.unlinked.length ? plan.unlinked.join('、') : 'なし')
    + '\n同じLINEアカウントを共用していて送らない方：' + (plan.sharedSkipped.length ? plan.sharedSkipped.join('、') : 'なし')
    + '\n\n送る文面の例：\n' + alertLib.buildMessage('○○', false);
  const st = await push(rehearsalTo, text);
  if (st === 200) sentAlerts++; else { failedAlerts++; problems.push('rehearsal-alert-send-failed'); }
}

// ---- 2) 週次オーナーレポート ----
const report = reportLib.buildReport(reportQuiz, now, RC);
const reportText = report.subject + '\n\n' + report.body;
const ownerTo = latestUserId(RC.OWNER_NAME);
let reportResult = '';
if (MODE === 'live') {
  if (!ownerTo) { reportResult = 'オーナー未連携のため送れません'; problems.push('owner-unlinked'); }
  else if ((await push(ownerTo, reportText)) === 200) reportResult = '送信しました';
  else { reportResult = '送信に失敗'; problems.push('report-send-failed'); }
} else if (rehearsalTo) {
  const st = await push(rehearsalTo, '【リハーサル・週次レポート】\n本番では、オーナー（' + RC.OWNER_NAME + 'さん）に、次の内容を送ります。'
    + (ownerTo ? '' : '\n※オーナーは、まだLINE連携していません（連携するまで、本番では送れません）。') + '\n\n' + reportText);
  if (st === 200) reportResult = 'リハーサルを送信しました';
  else { reportResult = 'リハーサルの送信に失敗'; problems.push('rehearsal-report-send-failed'); }
} else {
  reportResult = 'リハーサルの宛先（事務局）がLINE未連携です';
  if (!problems.includes('rehearsal-destination-unlinked')) problems.push('rehearsal-destination-unlinked');
}

// 公開ログには、件数と結果だけを出す
console.log(`mode=${MODE} | alert: targets=${plan.targets.length} unlinked=${plan.unlinked.length} shared-skipped=${plan.sharedSkipped.length} sent=${sentAlerts} failed=${failedAlerts} | report: ${reportResult} | problems=${problems.length ? problems.join(',') : 'none'}`);
if (problems.length > 0) process.exit(1);
