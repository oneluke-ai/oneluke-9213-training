/**
 * 週次オーナーレポート（研修クイズ）ver001  ── 2026-09-21
 *
 * 【LINE送信版】オーナー本人のLINE（研修Bot）へ、毎週の受講レポートを送る。メール版は 週次レポート_Airtableスクリプト_ver001.js。
 *   ・オーナーは、LINEのメニュー「研修クイズ一覧」を一度開いて、LINE連携が済んでいる必要がある（未連携なら、送らずに summary に出す）。
 *   ・トークンは Airtable の Secrets（名前：LINE_TOKEN_9213）から読む。コードには入れない。
 * 使い方：AirtableのAutomationで「Run script」アクションにこのファイル全体を貼り付ける。
 *   トリガー：At a scheduled time（毎週月曜 朝8時。時刻は入力したパソコンの時間帯＝日本時間で扱われる）
 *   出力：subject（件名）・body（本文）・bodyHtml（改行を<br>にした本文）を output.set で返す → 次の「Send email」で subject と bodyHtml を使う
 *
 * 集計の考え方：
 *   ・対象は「完了」した受講記録（ステータス空欄でも正答数が入っていれば完了扱い。クイズ本体と同じ判定）
 *   ・期間は「実行時刻から遡って7日間」
 *   ・スタッフ名簿に載っているのに0本の人は「未受講」として先頭に出す
 *
 * 変更が必要になる時：
 *   ・スタッフが増減したら STAFF を直す（quiz-engine.js の STAFF_BY_STORE と同じ内容にする）
 *   ・クイズ本数が増えたら TOTAL_QUIZZES を直す
 *   ・他店舗へ広げる時は STORE を変えてAutomationを複製する
 */

const CONFIG = {
  STORE: 'ワンルーク練馬区石神井公園駅店',
  STAFF: ['山﨑 琳加', '宮松 香代子', '宮本 英子', '藤原 由衣', '石田 麻美'],
  TOTAL_QUIZZES: 45,
  EXCLUDE_NAMES: ['事務局'],        // 数字・レポートに含めない名前（テスト用の事務局）
  PASS_RATE: 0.7,
  TABLE: '研修クイズ受講記録',
  OWNER_NAME: '宮松 香代子',          // レポートを受け取るオーナー（名簿の氏名と同じ表記）
  LINK_TABLE: 'スタッフLINE連携',
  SECRET_NAME: 'LINE_TOKEN_9213',   // Airtableの Secrets に登録した、石神井公園駅店の研修Botのトークン
  DRY_RUN: true,                    // true＝送らずに、内容だけ summary に出す。本番で送る時に false にする
  LINE_PUSH_URL: 'https://api.line.me/v2/bot/message/push',
};

const JST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function jstMD(ms) {
  const d = new Date(ms + JST_MS);
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// records: [{ name, store, status, correct, total, judged, date, quizKey }]
function buildReport(records, nowMs, cfg) {
  const since = nowMs - 7 * DAY_MS;
  const mine = records.filter(r => r.store === cfg.STORE && r.name && (cfg.EXCLUDE_NAMES || []).indexOf(r.name) < 0);

  const isDone = r => r.status === '完了' || (r.status !== '開始' && toNum(r.correct) !== null);
  const done = mine.filter(isDone);
  const parseMs = r => { const t = new Date(r.date).getTime(); return isNaN(t) ? null : t; };
  const week = done.filter(r => { const t = parseMs(r); return t !== null && t >= since && t <= nowMs; });

  // 保存済みの「合格判定」があればそれに従う（レポートと記録が食い違わないように）。
  // 空欄の古い記録だけ、正答率で判定する。
  const isPassed = r => {
    if (r.judged) return r.judged === '合格';
    return toNum(r.correct) !== null && toNum(r.total) > 0 && toNum(r.correct) / toNum(r.total) >= cfg.PASS_RATE;
  };

  const names = [...cfg.STAFF];
  week.forEach(r => { if (!names.includes(r.name)) names.push(r.name); });

  const rows = names.map(name => {
    const w = week.filter(r => r.name === name);
    const sumC = w.reduce((s, r) => s + (toNum(r.correct) || 0), 0);
    const sumT = w.reduce((s, r) => s + (toNum(r.total) || 0), 0);
    const clearedAll = new Set(done.filter(r => r.name === name && isPassed(r)).map(r => r.quizKey).filter(Boolean));
    return {
      name,
      inRoster: cfg.STAFF.includes(name),
      count: w.length,
      rate: sumT > 0 ? Math.round((sumC / sumT) * 100) : null,
      cleared: clearedAll.size,
    };
  });

  const active = rows.filter(r => r.count > 0);
  const idle = rows.filter(r => r.count === 0 && r.inRoster);
  const totalCount = week.length;
  const allC = week.reduce((s, r) => s + (toNum(r.correct) || 0), 0);
  const allT = week.reduce((s, r) => s + (toNum(r.total) || 0), 0);
  const avgRate = allT > 0 ? Math.round((allC / allT) * 100) : null;

  const period = jstMD(since) + '〜' + jstMD(nowMs);
  const subject = '【研修クイズ 週次レポート】' + cfg.STORE + '（' + period + '）';

  const lines = [];
  lines.push(cfg.STORE + ' 研修クイズの受講状況（直近7日間：' + period + '）');
  lines.push('');
  lines.push('■ 今週のまとめ');
  lines.push('・受講したスタッフ：' + active.filter(r => r.inRoster).length + ' / ' + cfg.STAFF.length + '名');
  lines.push('・完了したクイズ：' + totalCount + '本' + (avgRate !== null ? '（平均正答率 ' + avgRate + '%）' : ''));
  lines.push('');
  if (idle.length) {
    lines.push('■ 今週まだ受講していない人（' + idle.length + '名）');
    idle.forEach(r => lines.push('・' + r.name + '（累計クリア ' + r.cleared + '/' + cfg.TOTAL_QUIZZES + '本）'));
    lines.push('');
  } else {
    lines.push('■ 全員が今週受講しました');
    lines.push('');
  }
  if (active.length) {
    lines.push('■ 受講したスタッフ');
    active
      .sort((a, b) => b.count - a.count)
      .forEach(r => lines.push('・' + r.name + '：' + r.count + '本' + (r.rate !== null ? '（正答率 ' + r.rate + '%）' : '') + '／累計クリア ' + r.cleared + '/' + cfg.TOTAL_QUIZZES + '本' + (r.inRoster ? '' : '（名簿にない受講者）')));
    lines.push('');
  }
  lines.push('※ 詳しい内訳は管理ダッシュボードで確認できます。');
  lines.push('※ このメッセージは、毎週月曜の朝に、自動で送信されています。');

  return { subject, body: lines.join('\n'), stats: { totalCount, avgRate, idle: idle.map(r => r.name), active: active.map(r => r.name) } };
}

if (typeof module !== 'undefined') module.exports = { buildReport, CONFIG };

// ---- Airtable Automation（Run script）で実行される部分 ----
if (typeof base !== 'undefined') {
  const query = await base.getTable(CONFIG.TABLE).selectRecordsAsync({
    fields: ['受講者名', '所属店舗', 'ステータス', '受講日時', '正答数', '総問題数', '合格判定', 'クイズID', '動画タイトル'],
  });
  const records = query.records.map(rec => ({
    name: rec.getCellValueAsString('受講者名'),
    store: rec.getCellValueAsString('所属店舗'),
    status: rec.getCellValueAsString('ステータス'),
    date: rec.getCellValue('受講日時'),
    correct: rec.getCellValue('正答数'),
    total: rec.getCellValue('総問題数'),
    judged: rec.getCellValueAsString('合格判定'),
    quizKey: rec.getCellValueAsString('動画タイトル') || rec.getCellValueAsString('クイズID'),
  }));
  const report = buildReport(records, Date.now(), CONFIG);
  let text = report.subject + '\n\n' + report.body;
  if (text.length > 4800) text = text.slice(0, 4800) + '\n…（長いため、ここまで）';

  // オーナーのLINE ID（同じ人が複数回連携している時は、登録日時が一番新しいもの）
  const linkQuery = await base.getTable(CONFIG.LINK_TABLE).selectRecordsAsync({
    fields: ['氏名', '所属店舗', 'LINE_UserID', '登録日時'],
  });
  let owner = null;
  linkQuery.records.forEach(rec => {
    if (rec.getCellValueAsString('氏名') !== CONFIG.OWNER_NAME) return;
    if (rec.getCellValueAsString('所属店舗') !== CONFIG.STORE) return;
    const userId = rec.getCellValueAsString('LINE_UserID');
    if (!userId) return;
    const t = String(rec.getCellValue('登録日時') || '');
    if (!owner || t >= owner.t) owner = { userId, t };
  });

  const lines = [];
  if (!owner) {
    lines.push('【送れませんでした】オーナー（' + CONFIG.OWNER_NAME + 'さん）のLINE連携が、まだ記録されていません。');
    lines.push('LINEのメニュー「研修クイズ一覧」を、一度開いてもらってください。');
  } else if (CONFIG.DRY_RUN) {
    lines.push('【確認のみ・LINEは送っていません】送る予定の内容：');
    lines.push(text);
  } else {
    const token = String(input.secret(CONFIG.SECRET_NAME)).trim();
    const res = await fetch(CONFIG.LINE_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ to: owner.userId, messages: [{ type: 'text', text }] }),
    });
    lines.push(res.ok ? '【送信しました】' + CONFIG.OWNER_NAME + 'さんへ' : '【送信に失敗】LINE応答 ' + res.status + '：' + (await res.text()).slice(0, 120));
  }
  output.set('summary', lines.join('\n'));
}
