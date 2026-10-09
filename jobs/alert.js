/**
 * 未受講アラート（研修クイズ・スタッフ本人へのLINE通知）ver001  ── 2026-09-21
 *
 * 使い方：AirtableのAutomationで「Run script」アクションにこのファイル全体を貼り付ける。
 *   トリガー：At a scheduled time（毎週月曜 朝8時。時刻は入力したパソコンの時間帯＝日本時間で扱われる）
 *   入力：Secrets に LINE_TOKEN_9213（石神井公園駅店の研修Bot＝Messaging APIのチャネルアクセストークン）を登録する
 *         ※トークンはコードに直接書かない。Airtableの「Add new secret」から登録する
 *
 * 何をするか：
 *   ・直近7日間に「完了」した受講記録が1本も無い名簿のスタッフを見つける（週次レポートと同じ判定）
 *   ・そのうち、LINE連携済み（テーブル「スタッフLINE連携」に登録あり）の人だけに、LINEでやさしく促す
 *   ・同じ人が複数回連携している時は、登録日時が一番新しいLINE IDを使う
 *   ・LINE未連携の人・同じLINEアカウントを共用していて送らなかった人・LINEを送れなかった人は、結果として summary に出す（実行履歴で確認できる）
 *
 * 安全のための設定（CONFIG）：
 *   ・DRY_RUN: true の間は、LINEを1通も送らず、送る予定だけを summary に出す。まずここで確認する
 *   ・TEST_NAMES に名前を入れると、その人だけに「【テスト】」付きで送る（未受講でなくても送る）。動作確認用
 *
 * 変更が必要になる時：
 *   ・スタッフが増減したら STAFF を直す（週次レポートのスクリプトと同じ内容にする）
 *   ・文面を変える時は buildMessage を直す
 */

const CONFIG = {
  STORE: 'ワンルーク練馬区石神井公園駅店',
  STAFF: ['山﨑 琳加', '宮松 香代子', '宮本 英子', '藤原 由衣', '石田 麻美'],
  QUIZ_TABLE: '研修クイズ受講記録',
  LINK_TABLE: 'スタッフLINE連携',
  DRY_RUN: true,        // true＝送らずに予定だけ表示。本番で送る時に false にする
  TEST_NAMES: [],       // 例：['松本雄']。空のままなら本番の判定（未受講の人）で送る
  LINE_PUSH_URL: 'https://api.line.me/v2/bot/message/push',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// quizRecords: [{ name, store, status, correct, date }]  linkRecords: [{ name, store, userId, registeredAt }]
// 週次レポート（週次レポート_Airtableスクリプト_ver001.js）の「完了」「今週」の判定と同じにすること
function planAlerts(quizRecords, linkRecords, nowMs, cfg) {
  const since = nowMs - 7 * DAY_MS;
  const isDone = r => r.status === '完了' || (r.status !== '開始' && toNum(r.correct) !== null);
  const doneThisWeek = new Set(
    quizRecords
      .filter(r => r.store === cfg.STORE && r.name && isDone(r))
      .filter(r => { const t = new Date(r.date).getTime(); return !isNaN(t) && t >= since && t <= nowMs; })
      .map(r => r.name)
  );

  const idle = cfg.STAFF.filter(n => !doneThisWeek.has(n));
  const testing = cfg.TEST_NAMES.length > 0;
  const wanted = testing ? cfg.TEST_NAMES.filter(n => cfg.STAFF.includes(n)) : idle;

  // 同じ人が複数回連携している時（スマホの買い替え等）は、登録日時が一番新しいLINE IDを使う
  const latest = {};
  linkRecords
    .filter(r => r.store === cfg.STORE && r.name && r.userId)
    .forEach(r => {
      const cur = latest[r.name];
      const t = r.registeredAt ? String(r.registeredAt) : '';
      if (!cur || t >= cur.t) latest[r.name] = { userId: r.userId, t };
    });

  const targets = [];
  const unlinked = [];
  const sharedSkipped = [];   // 同じLINEアカウントに複数の名前が紐づいていて、通知しなかった人
  const owner = {};           // userId -> 最初に通知対象にした人の名前
  wanted.forEach(name => {
    const hit = latest[name];
    if (!hit) { unlinked.push(name); return; }
    if (owner[hit.userId]) { sharedSkipped.push(name + '（' + owner[hit.userId] + 'さんと同じLINEアカウント）'); return; }
    owner[hit.userId] = name;
    targets.push({ name, userId: hit.userId });
  });
  return { idle, targets, unlinked, sharedSkipped, testing };
}

function buildMessage(name, testing) {
  const lines = [];
  if (testing) lines.push('【テスト送信】');
  lines.push(name + 'さん、おつかれさまです。');
  lines.push('今週はまだ研修クイズを受けていないようです。');
  lines.push('1本3〜5分で終わります。下のメニューの「続きから」を押すと、次のクイズがすぐ始まります。');
  lines.push('お店が落ち着いたときに、ぜひ挑戦してみてください。');
  return lines.join('\n');
}

if (typeof module !== 'undefined') module.exports = { planAlerts, buildMessage, CONFIG };

// ---- Airtable Automation（Run script）で実行される部分 ----
if (typeof base !== 'undefined') {
  const quizQuery = await base.getTable(CONFIG.QUIZ_TABLE).selectRecordsAsync({
    fields: ['受講者名', '所属店舗', 'ステータス', '受講日時', '正答数'],
  });
  const quizRecords = quizQuery.records.map(rec => ({
    name: rec.getCellValueAsString('受講者名'),
    store: rec.getCellValueAsString('所属店舗'),
    status: rec.getCellValueAsString('ステータス'),
    date: rec.getCellValue('受講日時'),
    correct: rec.getCellValue('正答数'),
  }));
  const linkQuery = await base.getTable(CONFIG.LINK_TABLE).selectRecordsAsync({
    fields: ['氏名', '所属店舗', 'LINE_UserID', '登録日時'],
  });
  const linkRecords = linkQuery.records.map(rec => ({
    name: rec.getCellValueAsString('氏名'),
    store: rec.getCellValueAsString('所属店舗'),
    userId: rec.getCellValueAsString('LINE_UserID'),
    registeredAt: rec.getCellValue('登録日時'),
  }));

  const plan = planAlerts(quizRecords, linkRecords, Date.now(), CONFIG);
  const sent = [];
  const failed = [];

  if (!CONFIG.DRY_RUN && plan.targets.length > 0) {
    // 貼り付け時に前後へ入りがちな空白・改行を取り除く（入っているとLINEが401を返す）
    const token = String(input.secret('LINE_TOKEN_9213')).trim();
    for (const t of plan.targets) {
      try {
        const res = await fetch(CONFIG.LINE_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ to: t.userId, messages: [{ type: 'text', text: buildMessage(t.name, plan.testing) }] }),
        });
        if (res.ok) {
          sent.push(t.name);
        } else {
          // LINEが返す理由（トークン不正・友だちでない等）を一緒に残す。トークン自体は含まれない
          let detail = '';
          try { detail = String((await res.json()).message || '').slice(0, 120); } catch (e) { detail = ''; }
          failed.push(t.name + '（LINE応答 ' + res.status + (detail ? '：' + detail : '') + '）');
        }
      } catch (e) {
        failed.push(t.name + '（通信エラー）');
      }
    }
  }

  const lines = [];
  lines.push(CONFIG.DRY_RUN ? '【確認のみ・LINEは送っていません】' : '【送信実行】');
  if (plan.testing) lines.push('テストモード：' + CONFIG.TEST_NAMES.join('、') + ' だけが対象');
  lines.push('今週まだ受講していない人：' + (plan.idle.length ? plan.idle.join('、') : 'なし'));
  lines.push('LINEで通知する予定：' + (plan.targets.length ? plan.targets.map(t => t.name).join('、') : 'なし'));
  lines.push('LINE未連携のため通知できない人：' + (plan.unlinked.length ? plan.unlinked.join('、') : 'なし'));
  lines.push('同じLINEアカウントを共用していて通知しなかった人：' + (plan.sharedSkipped.length ? plan.sharedSkipped.join('、') : 'なし'));
  if (!CONFIG.DRY_RUN) {
    lines.push('送信できた人：' + (sent.length ? sent.join('、') : 'なし'));
    lines.push('送信できなかった人：' + (failed.length ? failed.join('、') : 'なし'));
  }
  output.set('summary', lines.join('\n'));
  output.set('sentCount', sent.length);
  output.set('failedCount', failed.length);
}
