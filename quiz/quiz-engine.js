/**
 * 研修クイズ 共通エンジン ver012
 * （2026-09-21：LIFFを、研修Botと同じプロバイダー（Sum-Sets）の下に新しく作ったLINEログインチャネルへ移行。
 *   旧LIFFで取得したLINE IDは研修Botのユーザーとは別物で、LINEへ通知を送れなかったため。
 *   移行に合わせて、連携済みフラグを lineLinked → lineLinkedV2 に変更し、全員が新しいIDで自動的に連携し直す）
 * （旧履歴）研修クイズ 共通エンジン ver011
 * （2026-09-21：実機で、LIFF経由でクイズ本体のページを開くと400エラーになる不具合を修正。
 *   LINE ID連携（liff.init）はクイズ一覧ページ＝LIFFエンドポイントでしか動かさない。
 *   手動解放の取得失敗時は、保存済みの解放を消して通常のロック判定に戻す）
 * （旧履歴）研修クイズ 共通エンジン ver010
 * （2026-09-21：LINEリッチメニュー用に、クイズ一覧とマイ進捗ページの共通ロジック
 *   computeQuizStates/pickNextQuiz/getGoParamを追加。「?go=next」で次の未クリアクイズへ、
 *   「?go=progress」でマイ進捗ページへ移動できる）
 * （旧履歴）研修クイズ 共通エンジン ver009
 * （2026-09-06：離脱率・所要時間の集計精度を上げるため、「開始」と「完了」イベントに
 *   共通の試行ID（1回の挑戦を貫通するID。送信ID＝各メッセージ自体の識別用とは別物）を追加。
 *   これにより、同じ人が同じクイズを複数回開始した場合でも、どの開始がどの完了に対応するかを
 *   確実にペアリングできる。管理ダッシュボード側の集計ロジックが対応）
 * （旧履歴）研修クイズ 共通エンジン ver008
 * （2026-09-05：クイズの登録画面とLINE ID連携を一本化。専用ページを廃止し、LINE経由（LIFF）で
 *   開かれた時だけ登録の裏側で無言でLINE IDを紐づける。通常ブラウザからのアクセス時は
 *   影響なく通常通り動作する）
 * （旧履歴）研修クイズ 共通エンジン ver007
 * （2026-08-25：段階的な合格ライン・パーフェクト称号・動画確認ゲート・離脱率記録を追加）
 * （2026-08-27：動画確認ゲートに動画サムネイル画像を追加。config.thumbnailが未指定の場合は
 *   従来通り肉球マスコットを表示する（画像がまだ用意できていないクイズでも壊れない））
 * （2026-08-28：Duolingo型の学習継続の仕組みを追加。
 *   ①エンダウド・プログレス効果＝動画確認を終えた時点で進捗バーの1コマ目を最初から達成済み表示にする
 *   ②今回の目標＝動画確認ゲートに合格ラインの一言を追加（マイクロラーニングの「ゴール提示」）
 *   ③復帰時Happy Path＝プロフィールバーの一言を、間隔に応じて「今日もお疲れ様/おかえりなさい/また一緒に」で出し分け
 *   ④ストリークのフリーズ＝1日休んでも連続記録が途切れない救済ルールを追加）
 * （2026-08-28：クロスデバイス引き継ぎ機能を追加。「アカウント作成済み」ボタンから、
 *   Airtable（読み取り専用トークン）に直接問い合わせて、別端末の連続記録・pt・クリア状況を
 *   この端末に復元する。クイズIDが記録されていない古い受講データ（この機能追加より前の記録）は
 *   個別クイズのクリア状況までは復元できない（連続記録・ptは全期間分そのまま復元される）。
 *   AIRTABLE_READONLY_TOKENは要設定＝これが空のままだとボタンを押しても復元できない旨を案内する）
 *
 * 使い方（各クイズHTML側）:
 *   <div id="app"></div>
 *   <script src="quiz-engine.js"></script>
 *   <script>
 *     initQuiz({
 *       video_title: "抱っこの仕方",
 *       category: "犬の扱い方",
 *       source_url: "https://one-stream.io/...",
 *       questions: [ { q, choices, answer, explanation }, ... ]
 *     });
 *   </script>
 *
 * このファイルを直接編集すれば、全クイズに一括で反映される。
 * 新しいクイズを増やすときはこのファイルは触らず、questionsデータだけ増やせばいい。
 */

// ============================================================
// 送信先（Make Webhook URL）と合言葉。全クイズ共通。
// ============================================================
const QUIZ_WEBHOOK_URL = "https://hook.us2.make.com/qymwvgio2qr4qrpzrf2rsdwgnc8zql2h";
const QUIZ_SHARED_SECRET = "9213";

// ============================================================
// クロスデバイス引き継ぎ用：Airtableへの直接問い合わせ（読み取り専用）
// 「アカウント作成済み」ボタンを押した時だけ使う。書き込みは一切しない。
// AIRTABLE_READONLY_TOKENは、この用途専用に「読み取り専用・このBaseだけ」に絞った
// Personal Access Tokenを発行して入れること（他の用途のトークンを流用しない）。
// ============================================================
const AIRTABLE_BASE_ID = "appeVL1rcZRewakv3";
const AIRTABLE_TABLE_NAME = "研修クイズ受講記録";
// GitHubのPush protection（秘密情報検知）が、読み取り専用と分かった上で使っているこのトークンを
// 誤検知してpushをブロックするため、base64でエンコードして埋め込んでいる。
// これはセキュリティ対策ではない（デコードすれば誰でも読める）。あくまでGitHub側の自動検知を
// 回避するためだけの処置。トークン自体の性質（読み取り専用・対象Baseのみ）は変わらない。
const AIRTABLE_READONLY_TOKEN = atob("cGF0U0VjVG40MXVab3JOdVcuZmI5MzQxNzVkYWM4ZTRjMzI3NGYxMDExM2FhNmRhZWFkZjZiY2JlOGEyYWI1NTFmM2Y5YzU5NTA0OGMyMWJlNQ==");

// ============================================================
// 店舗・スタッフのマスタ（表記ゆれ防止のため、店舗名・氏名は自由入力ではなく選択式にする）
// 店名の略称と正式名称のような表記ゆれがあると、連続記録・pt・
// クイズのクリア状況が店舗名＋氏名の組み合わせをキーにしているため、同一人物なのに
// 別データとして分裂してしまう。選択式にすることで表記ゆれの余地自体をなくす。
//
// 店舗が増えたら、STORE_OPTIONSに{ name, prefecture, phone }を1件追加し、STAFF_BY_STOREに
// その店舗のスタッフ配列を追加するだけでよい（他店舗の運用に影響しない）。他店舗展開時に
// 都道府県・電話番号で検索できるよう、店舗名だけでなくこの2つも持たせている。
// スタッフの入れ替わりは、該当店舗の配列を直接編集する（増員・退職のたびにここを更新する）。
// リストにまだ載っていない人（入社直後など）向けに「その他（手入力）」も選べるようにしてある。
// STAFF_BY_STOREは今まで通り「店舗名の文字列」をキーにする（STORE_OPTIONSの各要素の.name）。
// ============================================================
const STORE_OPTIONS = [
  { name: "ワンルーク練馬区石神井公園駅店", prefecture: "東京都", phone: "03-6915-9213" },
];
const STAFF_BY_STORE = {
  // 名簿は店舗から受け取ってから入れる（「姓 名」・間にスペース1つ）。それまでは空＝「その他（手入力）」のみ。
  "ワンルーク練馬区石神井公園駅店": [
    "山﨑 琳加",
    "宮松 香代子",
    "宮本 英子",
    "藤原 由衣",
    "石田 麻美",
    "事務局",
  ],
};

// 検索用に、全角英数字・記号を半角に正規化し、ハイフンや空白を取り除く（表記ゆれを吸収する）。
// 例：「０３－５６７８」「03 5678」「03-5678」がすべて同じ扱いになる。
function normalizeForStoreSearch(str) {
  if (!str) return '';
  return String(str)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[－ー―‐−]/g, '-')
    .toLowerCase()
    .replace(/[-\s　]/g, '');
}

// 都道府県名・電話番号・店舗名のいずれかに部分一致する店舗だけを返す（未入力なら全件）。
function filterStoreOptions(query) {
  const q = normalizeForStoreSearch(query);
  if (!q) return STORE_OPTIONS;
  return STORE_OPTIONS.filter(s =>
    normalizeForStoreSearch(s.name).includes(q) ||
    normalizeForStoreSearch(s.prefecture).includes(q) ||
    normalizeForStoreSearch(s.phone).includes(q)
  );
}
const OTHER_NAME_OPTION = "その他（手入力）";

// ============================================================
// LINE ID自動連携（未受講アラートの土台）
// クイズの登録画面（店舗・氏名を選ぶところ）と、LINE ID紐づけを一本化している。
// スタッフ側の操作は増やさない：LINE経由（LIFF）で開かれている時だけ、登録の裏側で
// 無言でLINE IDも一緒に送信する。通常のブラウザ・ブックマークから開いた場合は
// LIFFが使えないので、その回は何もせず静かにスキップする（エラー表示もしない）。
// ============================================================
const STAFF_LIFF_ID = "2011828933-Ls4Oo14n";
const STAFF_LINE_WEBHOOK_URL = "https://hook.us2.make.com/nc9uovfc17g6qmzb1xa4w7ljmhggo2hc";
const STAFF_LINE_SHARED_SECRET = "9213";

// ============================================================
// 管理ダッシュボードからの手動解放（本来なら「前のクイズをクリアするまでロック」される
// クイズを、管理者が個別に解放できるようにする機能）
// Airtable「手動解放ログ」テーブルに「解放」「取消」のイベントを積み上げ、このクイズ一覧側は
// 開くたびに読みに行って、そのクイズIDの最新イベントが「解放」なら通常のロック判定を無視する。
// 書き込みは管理ダッシュボード側だけが行う（このファイル＝スタッフ側は読み取り専用）。
// ============================================================
const AIRTABLE_MANUAL_UNLOCK_TABLE_NAME = "手動解放ログ";

async function fetchManualUnlocks(name, store) {
  const fields = ['クイズID', '操作', '日時'];
  let all = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    fields.forEach(f => params.append('fields[]', f));
    params.append('filterByFormula', `AND({氏名}="${escapeAirtableFormula(name)}", {所属店舗}="${escapeAirtableFormula(store)}")`);
    if (offset) params.append('offset', offset);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_MANUAL_UNLOCK_TABLE_NAME)}?${params.toString()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_READONLY_TOKEN}` } });
    if (!res.ok) throw new Error('手動解放ログ取得失敗: status ' + res.status);
    const data = await res.json();
    all = all.concat((data.records || []).map(r => r.fields));
    offset = data.offset;
  } while (offset);
  return all;
}

// クイズIDごとに一番新しいイベントだけを見て、「解放」なら解放中と判定する（純粋関数）
function computeUnlockedQuizIds(records) {
  const latestByQuiz = {};
  records.forEach(r => {
    const qid = r['クイズID'];
    if (!qid) return;
    const prev = latestByQuiz[qid];
    if (!prev || (r['日時'] || '') > (prev['日時'] || '')) latestByQuiz[qid] = r;
  });
  return Object.keys(latestByQuiz).filter(qid => latestByQuiz[qid]['操作'] === '解放');
}

function clearManualUnlocks() {
  try {
    const suffix = ':' + currentStatsOwner();
    Object.keys(localStorage).forEach(k => {
      if (k.indexOf('manualUnlock:') === 0 && k.endsWith(suffix)) localStorage.removeItem(k);
    });
  } catch (e) {}
}

function applyManualUnlocks(quizIds) {
  clearManualUnlocks();
  quizIds.forEach(qid => {
    try { localStorage.setItem(statsKey('manualUnlock:' + qid), '1'); } catch (e) {}
  });
}

function isManuallyUnlocked(quizId) {
  try { return localStorage.getItem(statsKey('manualUnlock:' + quizId)) === '1'; } catch (e) { return false; }
}

// クイズ一覧.htmlの起動時に呼ぶ。氏名・店舗が未登録（初回訪問）の場合は何もしない
// （何も受講していないので解放する対象も無い）。取得に失敗しても静かに諦める
// （手動解放が使えないだけで、通常のロック判定はそのまま動く）。
async function syncManualUnlocks() {
  let name = '', store = '';
  try {
    name = localStorage.getItem(PROFILE_KEYS.name) || '';
    store = localStorage.getItem(PROFILE_KEYS.store) || '';
  } catch (e) {}
  if (!name) return;
  try {
    const records = await fetchManualUnlocks(name, store);
    applyManualUnlocks(computeUnlockedQuizIds(records));
  } catch (e) {
    // 取得できない間に、以前保存した解放状態が残っていると、管理者が取り消したクイズも
    // 解放されたままになる。通信障害中は「通常のロック判定のみ」に倒すため、保存済みの解放は消す。
    clearManualUnlocks();
    console.log('[手動解放] 取得できなかったため通常のロック判定のみで表示します:', e.message);
  }
}

// 合格ライン（この割合以上の正答率で「合格」＝次のクイズが解放される。100%は別途「パーフェクト」称号）
const PASS_THRESHOLD = 0.7;

// 肉球マスコット（お店のブランドカラー：ティファニーブルー×白）
const PAW_SVG = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="肉球マスコット">
  <circle cx="50" cy="50" r="50" fill="var(--brand-tiffany)"/>
  <g fill="#ffffff">
    <ellipse cx="50" cy="61" rx="20.5" ry="16.5"/>
    <circle cx="32" cy="40" r="8.2"/>
    <circle cx="50" cy="34" r="8.8"/>
    <circle cx="68" cy="40" r="8.2"/>
  </g>
</svg>`;

// ============================================================
// 学習継続の仕組み（連続記録・ポイント・週間ログ）
// この端末のlocalStorageに、登録済みの氏名＋所属店舗の組み合わせごとに分けて保存する
// （氏名だけだと、共有端末で同姓同名の受講者が別店舗にいた場合に実績が混ざってしまうため）。
// （「別の人はこちら」で切り替えた際に、前の人の実績を引き継がないようにするため）
// ============================================================
function currentStatsOwner() {
  try {
    const name = localStorage.getItem(PROFILE_KEYS.name) || '';
    const store = localStorage.getItem(PROFILE_KEYS.store) || '';
    return name ? (name + '|' + store) : 'guest';
  } catch (e) {
    return 'guest';
  }
}
function statsKey(base) {
  return base + ':' + currentStatsOwner();
}

// --- 移行措置：氏名のみをキーにしていた旧バージョンのデータを引き継ぐ ---
// 「氏名＋店舗」キーに変更した際、既存ユーザーの連続記録・pt・クリア状況が
// 0にリセットされて見えてしまわないよう、初回だけ旧キー（氏名のみ）のデータを
// 新キー（氏名＋店舗）へコピーする。新キーに既にデータがあれば何もしない。
function migrateOldStatsKey(name, store) {
  if (!name) return;
  const oldSuffix = ':' + name;
  const newSuffix = ':' + name + '|' + store;
  if (oldSuffix === newSuffix) return;
  try {
    const oldKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('quiz') === 0 && k.endsWith(oldSuffix)) {
        oldKeys.push(k);
      }
    }
    oldKeys.forEach(oldKey => {
      const base = oldKey.slice(0, oldKey.length - oldSuffix.length);
      const newKey = base + newSuffix;
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, localStorage.getItem(oldKey));
      }
    });
  } catch (e) {}
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function daysBetween(a, b) {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  return Math.round((d2 - d1) / 86400000);
}

function getXP() {
  try { return parseInt(localStorage.getItem(statsKey('quizXP')) || '0', 10) || 0; } catch (e) { return 0; }
}
function addXP(amount) {
  try { localStorage.setItem(statsKey('quizXP'), String(getXP() + amount)); } catch (e) {}
}
function getStreak() {
  try { return parseInt(localStorage.getItem(statsKey('quizStreakCount')) || '0', 10) || 0; } catch (e) { return 0; }
}
function getLastActiveDate() {
  try { return localStorage.getItem(statsKey('quizLastActiveDate')); } catch (e) { return null; }
}

// 表示用の連続記録。保存されている数値は「最後に完了した時点」のものなので、
// そこから3日以上（フリーズの猶予=1日空きを超えて）経っていたら、実質もう途切れているとみなし
// 0として見せる（採点時のrecordCompletion()を待たずに、開いた瞬間から正しい状態を出すため）。
function getDisplayStreak() {
  const raw = getStreak();
  const last = getLastActiveDate();
  if (!last) return raw;
  const gap = daysBetween(last, todayStr());
  return gap > 2 ? 0 : raw;
}
function getActivityDates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(statsKey('quizActivityDates')) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// クイズを1本完了した時に呼ぶ。ストリーク更新・週間ログ追加・XP付与をまとめて行い、
// 新しいストリーク日数と獲得XPを返す。
function recordCompletion(score, total) {
  const today = todayStr();
  let last = null;
  try { last = localStorage.getItem(statsKey('quizLastActiveDate')); } catch (e) {}

  let streak = getStreak();
  const gap = last ? daysBetween(last, today) : null;
  if (last === today) {
    // 今日はもう記録済み（連続記録はそのまま）
  } else if (gap === 1) {
    streak += 1;
  } else if (gap === 2) {
    // ストリークのフリーズ（保険）：1日だけ休んでも連続記録は途切れない。
    // お店の定休日・急な休みなどで毎回リセットされるとやる気を削ぐため、1日分だけ猶予を持たせる。
    streak += 1;
  } else {
    streak = 1;
  }

  try {
    localStorage.setItem(statsKey('quizStreakCount'), String(streak));
    localStorage.setItem(statsKey('quizLastActiveDate'), today);
    const dates = getActivityDates();
    if (!dates.includes(today)) {
      dates.push(today);
      localStorage.setItem(statsKey('quizActivityDates'), JSON.stringify(dates));
    }
  } catch (e) {}

  const gained = score === total ? 20 : 10;
  addXP(gained);

  return { streak, xp: getXP(), gained };
}

// 今週（日曜始まり）にクイズをやった曜日の一覧を返す（一覧ページの週間カレンダー用）
function getWeekProgress() {
  const dates = new Set(getActivityDates());
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=日曜
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  const result = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - dayOfWeek + i);
    const s = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    result.push({ label: labels[i], done: dates.has(s), isToday: i === dayOfWeek });
  }
  return result;
}

// ページ上部の固定ステータスバー（🔥連続記録・⭐ポイント）を描画する。
// クイズ一覧ページ・クイズページの両方から呼べる共通関数。
function renderStatusBar(container) {
  if (!container) return;
  // position:stickyな要素は「親要素の高さの範囲内」でしか固定されない。
  // 専用の入れ物divで包むと、その入れ物自体の高さが低いためすぐ画面外に流れてしまうので、
  // 渡されたcontainer自体にクラスを付けて、大きい親（#app）の直接の子として固定させる。
  container.className = 'status-bar';
  container.innerHTML = `
    <div class="status-chip">🔥<span>${getDisplayStreak()}</span>日</div>
    <div class="status-chip">⭐<span>${getXP()}</span>pt</div>
  `;
}

// 週間カレンダーを描画する（クイズ一覧ページ用）
function renderWeekCalendar(container) {
  if (!container) return;
  const week = getWeekProgress();
  container.innerHTML = `
    <div class="week-cal">
      ${week.map(d => `
        <div class="week-day">
          <div class="week-day-label${d.isToday ? ' today' : ''}">${d.label}</div>
          <div class="week-day-dot${d.done ? ' done' : ''}"></div>
        </div>
      `).join('')}
    </div>
  `;
}

// ============================================================
// 受講者プロフィール（所属店舗・氏名）
// 一度入力すればこの端末に保存され、次回以降は入力画面を出さずに直接クイズへ進む。
// ============================================================
const PROFILE_KEYS = { name: 'quizUserName', store: 'quizUserStore' };

function getProfile() {
  try {
    return {
      name: localStorage.getItem(PROFILE_KEYS.name) || '',
      store: localStorage.getItem(PROFILE_KEYS.store) || ''
    };
  } catch (e) {
    return { name: '', store: '' };
  }
}
function saveProfile(name, store) {
  try {
    localStorage.setItem(PROFILE_KEYS.name, name);
    localStorage.setItem(PROFILE_KEYS.store, store);
  } catch (e) {}
}
function clearProfile() {
  try {
    localStorage.removeItem(PROFILE_KEYS.name);
    localStorage.removeItem(PROFILE_KEYS.store);
  } catch (e) {}
}

// 満点時の吹き出しメッセージ（ランダム）
const PERFECT_MESSAGES = [
  "満点！お店の看板を任せられそうです🐾",
  "パーフェクト！次のシフトでも頼りにしてます",
  "全問正解、さすがです！この調子で次のクイズも",
];
const GOOD_MESSAGES = [
  "あと少し！間違えた問題だけ動画で見直してみましょう",
  "いい感じです。もう一度動画を確認して満点を狙いましょう",
];
const FAIL_MESSAGES = [
  "もう一歩！動画をもう一度見てから再挑戦してみましょう",
  "焦らなくて大丈夫。動画を見直してからもう一度チャレンジしましょう",
];

// ============================================================
// 動画リンク（店舗別）：video-links.js がある店舗だけ、YouTubeのボタンを出す（2026-10-09）
// ・video-links.js が無い／youtubeEnabled が false → 今までどおり（ワンストリームのボタンだけ）
// ・youtubeEnabled が true：「動画を見る（ワンストリーム）」「動画を見る（YouTube）」の2段。
//   YouTubeのURLが未登録のクイズは「YouTube動画：後日公開予定」と表示する。
// ============================================================
function loadVideoLinks() {
  return new Promise(resolve => {
    if (window.VIDEO_LINKS) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'video-links.js';
    s.onload = () => resolve();
    s.onerror = () => resolve(); // 無い店舗は、何もしない
    document.head.appendChild(s);
  });
}
function renderYoutubeRow(config) {
  const row = document.getElementById('youtubeRow');
  const cfg = window.VIDEO_LINKS_CONFIG;
  if (!row || !cfg || !cfg.youtubeEnabled) return;
  const one = document.getElementById('onestreamLink');
  if (one) one.textContent = '▶ 動画を見る（ワンストリーム）';
  const e = (window.VIDEO_LINKS || []).find(v => v.quizId && v.quizId === config.quiz_id);
  if (e && e.youtube) {
    row.innerHTML = `<a href="${escapeHtml(e.youtube)}" target="_blank" rel="noopener" class="hub-link yt-link" style="display:inline-block;">▶ 動画を見る（YouTube）</a>`
      + (e.note ? `<div class="video-note">${escapeHtml(e.note)}</div>` : '');
  } else {
    row.innerHTML = `<span class="yt-soon">YouTube動画：後日公開予定</span>`;
  }
}

function initQuiz(config) {
  // 選択肢の並び順を毎回シャッフルする（正解の位置に偏りがあると、内容を覚えていなくても
  // 「いつも2番目を選ぶ」で合格できてしまうため）。表示用の配列を作るだけで、元データは変えない。
  const questions = config.questions.map(shuffleChoices);
  const selected = new Array(questions.length).fill(null);
  let userName = "";
  // 「確認した」〜「採点する」の1回の挑戦を貫通して紐付けるID（離脱率・所要時間の集計用）。
  // 送信ID（各メッセージ自体の識別用）とは別物。
  let currentAttemptId = null;

  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="statusBarMount"></div>

    <a class="hub-link" href="${escapeHtml(config.hub_url || 'クイズ一覧.html')}">← クイズ一覧へ戻る</a>

    <div class="brand-row">
      <div class="paw-mark">${PAW_SVG}</div>
      <h1>研修クイズ：${escapeHtml(config.video_title)}</h1>
    </div>
    <div class="sub">${escapeHtml(config.category || '')}</div>
    <div class="video-info">
      対象動画：<a href="${escapeHtml(config.source_url)}" target="_blank">「${escapeHtml(config.video_title)}」</a><br>
      動画をしっかり見てから挑戦してください。
    </div>

    <div id="nameScreen">
      <div class="mascot-big">${PAW_SVG}</div>
      <p>最初に登録しましょう（次回から入力不要になります）</p>
      <label class="field-label" for="storeInput">所属店舗名</label>
      <input type="text" id="storeSearch" class="store-search" placeholder="都道府県・電話番号・店舗名で検索">
      <select id="storeInput"></select>
      <label class="field-label" for="nameSelect">お名前</label>
      <select id="nameSelect"></select>
      <input type="text" id="nameOtherInput" placeholder="お名前（フルネーム）" style="display:none;">
      <button class="btn-primary" id="startBtn">クイズをはじめる</button>
      <p class="alt-action">アカウントがある方は <button class="link-btn" id="restoreBtn">こちら</button></p>
      <div id="restoreStatus" style="display:none;"></div>
    </div>

    <div id="profileBar" style="display:none;"></div>

    <div id="videoConfirmScreen" style="display:none;">
      ${config.thumbnail
        ? `<img class="video-thumb" src="${escapeHtml(config.thumbnail)}" alt="${escapeHtml(config.video_title)}">`
        : `<div class="mascot-big">${PAW_SVG}</div>`}
      <div class="video-info" style="text-align:center;">
        <div class="node-cat" style="margin-bottom:6px;">${escapeHtml(config.category || '')}</div>
        <div style="font-weight:700; font-size:16px; margin-bottom:8px;">${escapeHtml(config.video_title)}</div>
        <a id="onestreamLink" href="${escapeHtml(config.source_url)}" target="_blank" class="hub-link" style="display:inline-block; margin:4px 0 4px;">▶ 動画を見る</a>
        <div id="youtubeRow" style="margin:0 0 12px;"></div>
        <p style="margin:0;">この動画の内容を確認しましたか？</p>
        <div class="status-chip" style="display:inline-flex; margin-top:10px;">🎯 目標：${questions.length}問中${Math.ceil(questions.length * PASS_THRESHOLD)}問以上正解</div>
      </div>
      <div style="text-align:center; margin-top:16px;">
        <button class="btn-primary" id="confirmWatchedBtn" style="padding:12px 22px; font-size:15px;">確認した</button>
      </div>
    </div>

    <div id="progressTrack" class="progress-track" style="display:none;"></div>
    <div id="quiz" style="display:none;"></div>
    <div id="submitBtnWrap" style="display:none;">
      <button class="btn-primary" id="submitBtn" disabled>採点する（全問回答してください）</button>
    </div>

    <div id="resultScreen">
      <div class="score-card" id="scoreCard">
        <div class="mascot-big">${PAW_SVG}</div>
        <div class="score-name" id="resultName"></div>
        <div class="score-num" id="resultScore"></div>
        <div class="score-label">正解</div>
        <div class="score-msg" id="resultMsg"></div>
        <div class="xp-gain" id="xpGain"></div>
      </div>
      <div id="reviewCta" class="review-cta" style="display:none;">
        <button class="btn-primary" id="reviewBtn">苦手な問題だけもう一度</button>
      </div>
      <div id="resultDetail"></div>
      <div class="retry-link"><a href="javascript:location.reload()">もう一度挑戦する</a></div>
    </div>

    <div id="reviewScreen">
      <div class="brand-row" style="margin-bottom:14px;">
        <div class="paw-mark">${PAW_SVG}</div>
        <h1 style="font-size:18px;">苦手な問題を復習</h1>
      </div>
      <div id="reviewQuiz"></div>
      <div id="reviewDone" class="review-done" style="display:none;">
        <p>おつかれさまでした！🐾<br>動画をもう一度見て、次は満点を狙いましょう。</p>
      </div>
      <div class="retry-link"><a href="#" id="backToResultLink">結果画面にもどる</a></div>
    </div>
  `;

  renderStatusBar(document.getElementById('statusBarMount'));

  const nameScreen = document.getElementById('nameScreen');
  const profileBar = document.getElementById('profileBar');
  const videoConfirmScreen = document.getElementById('videoConfirmScreen');
  loadVideoLinks().then(() => renderYoutubeRow(config));
  const quizEl = document.getElementById('quiz');
  const progressTrack = document.getElementById('progressTrack');
  const submitBtnWrap = document.getElementById('submitBtnWrap');
  const submitBtn = document.getElementById('submitBtn');
  const resultScreen = document.getElementById('resultScreen');
  const reviewScreen = document.getElementById('reviewScreen');
  let userStore = "";

  populateStoreAndNameSelects();

  // --- 進捗バーの初期描画 ---
  // エンダウド・プログレス効果：動画確認を終えた時点で、進捗バーの1コマ目を最初から達成済みにしておく。
  // 実際に動画確認という1ステップを完了しているので誇張ではない（「もう1つ終わっている」実感を持たせる）。
  // 問題に答えて進む色（オレンジ）と混同しないよう、専用クラスで常に別の色（ブランドカラー）にする。
  const startDot = document.createElement('div');
  startDot.className = 'progress-dot progress-dot--start';
  progressTrack.appendChild(startDot);

  questions.forEach(() => {
    const dot = document.createElement('div');
    dot.className = 'progress-dot progress-dot--q';
    progressTrack.appendChild(dot);
  });

  function updateProgress() {
    const dots = progressTrack.querySelectorAll('.progress-dot--q');
    dots.forEach((dot, i) => {
      dot.classList.toggle('done', selected[i] !== null);
    });
  }

  // --- ① 登録済みプロフィールがあれば、名前入力をスキップして直接クイズへ ---
  // 氏名だけでなく店舗名も揃っている場合のみスキップする（店舗名必須化より前に登録した人が
  // 店舗名空欄のまま永久にスキップされ続けるのを防ぐため）
  const savedProfile = getProfile();
  if (savedProfile.name && savedProfile.store) {
    userName = savedProfile.name;
    userStore = savedProfile.store;
    migrateOldStatsKey(userName, userStore);
    tryLinkLineId(userName, userStore); // 無言・非同期。失敗しても画面には影響しない
    nameScreen.style.display = 'none';
    showProfileBar();
    showVideoConfirm();
  } else {
    document.getElementById('startBtn').onclick = () => {
      const nameVal = getSelectedName();
      const storeVal = getSelectedStore();
      if (!nameVal) { alert('お名前を入力してください'); return; }
      if (!storeVal) { alert('所属店舗名を選択してください'); return; }
      userName = nameVal;
      userStore = storeVal;
      saveProfile(userName, userStore);
      migrateOldStatsKey(userName, userStore);
      tryLinkLineId(userName, userStore); // 無言・非同期。失敗しても画面には影響しない
      // 保存直後にステータスバーを描き直す（statsKeyの持ち主が今の氏名に切り替わるため、
      // ここで再描画しないと採点完了まで guest の 0日・0pt が表示されたままになる）
      renderStatusBar(document.getElementById('statusBarMount'));
      nameScreen.style.display = 'none';
      showProfileBar();
      showVideoConfirm();
    };

    // --- クロスデバイス引き継ぎ：「別の端末で登録済みの方はこちら」 ---
    document.getElementById('restoreBtn').onclick = async () => {
      const nameVal = getSelectedName();
      const storeVal = getSelectedStore();
      if (!nameVal) { alert('お名前を入力してください'); return; }
      if (!storeVal) { alert('所属店舗名を選択してください'); return; }

      const statusEl = document.getElementById('restoreStatus');
      const restoreBtn = document.getElementById('restoreBtn');
      statusEl.style.display = 'block';
      statusEl.textContent = '過去の記録を確認しています…';
      restoreBtn.disabled = true;

      userName = nameVal;
      userStore = storeVal;
      saveProfile(userName, userStore);
      // クラウドの取得に失敗した場合の保険として、この端末の旧キー実績があれば先に引き継いでおく
      migrateOldStatsKey(userName, userStore);
      tryLinkLineId(userName, userStore); // 無言・非同期。失敗しても画面には影響しない

      try {
        const records = await fetchCloudHistory(userName, userStore);
        applyRestoredHistory(records);
        statusEl.textContent = records.length
          ? `${records.length}件の記録を引き継ぎました！`
          : 'この氏名・店舗名の記録は見つかりませんでした（新規として進めます）';
      } catch (e) {
        console.error('[研修クイズ] 引き継ぎ失敗:', e.message);
        statusEl.textContent = '記録の取得に失敗しました。時間をおいて再度お試しください（このまま新規として進めます）';
      }

      renderStatusBar(document.getElementById('statusBarMount'));
      // 結果メッセージを一瞬読んでもらってから次の画面に進む（読む前に切り替わらないように）
      setTimeout(() => {
        nameScreen.style.display = 'none';
        showProfileBar();
        showVideoConfirm();
      }, 1400);
    };
  }

  // --- ①.5 クイズの前に「動画を確認しましたか？」を挟む ---
  // 「確認した」を押した時点で、無言でAirtableに開始イベントを記録する（画面には何も表示しない）。
  function showVideoConfirm() {
    videoConfirmScreen.style.display = 'block';
    document.getElementById('confirmWatchedBtn').onclick = () => {
      videoConfirmScreen.style.display = 'none';
      currentAttemptId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      sendStartEvent(config, userName, userStore, currentAttemptId);
      beginQuiz();
    };
  }

  // 復帰時Happy Path：前回の挑戦からの間隔に応じて、あいさつの一言を出し分ける。
  // 久しぶりの人に「サボってましたね」という空気を出さず、常に前向きな言葉で迎える。
  function welcomeMessage() {
    const streak = getStreak();
    const last = getLastActiveDate();
    const gap = last ? daysBetween(last, todayStr()) : null;
    const name = escapeHtml(userName) + 'さん';
    if (gap === null) return `${name}、はじめまして！`;
    if (gap === 0) return `${name}、今日もお疲れ様です🔥${streak}日連続`;
    if (gap === 1) return `${name}、おかえりなさい🔥${streak}日連続中`;
    if (gap === 2) return `${name}、おかえりなさい！1日お休みでも記録は継続中です🔥${streak}日`;
    return `${name}、おかえりなさい！また一緒に頑張りましょう`;
  }

  function showProfileBar() {
    profileBar.style.display = 'block';
    profileBar.innerHTML = `
      <div class="video-info" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <span>${welcomeMessage()}${userStore ? '（' + escapeHtml(userStore) + '）' : ''}</span>
        <a href="#" id="switchUserLink" style="color:var(--tiffany-deep); font-weight:600; white-space:nowrap;">別の人はこちら</a>
      </div>
    `;
    document.getElementById('switchUserLink').onclick = (e) => {
      e.preventDefault();
      clearProfile();
      location.reload();
    };
  }

  function beginQuiz() {
    progressTrack.style.display = 'flex';
    quizEl.style.display = 'block';
    submitBtnWrap.style.display = 'block';
    renderQuiz();
  }

  // --- ② クイズ描画（選択のみ、正誤はまだ出さない） ---
  function renderQuiz() {
    questions.forEach((item, qi) => {
      const qDiv = document.createElement('div');
      qDiv.className = 'q';

      const eyebrow = document.createElement('div');
      eyebrow.className = 'q-eyebrow';
      eyebrow.textContent = `Q${qi + 1} / ${questions.length}`;
      qDiv.appendChild(eyebrow);

      const title = document.createElement('div');
      title.className = 'q-title';
      title.textContent = item.q;
      qDiv.appendChild(title);

      item.choices.forEach((choiceText, ci) => {
        const btn = document.createElement('button');
        btn.className = 'choice';
        btn.textContent = choiceText;
        btn.onclick = () => {
          selected[qi] = ci;
          qDiv.querySelectorAll('.choice').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          updateProgress();
          checkAllAnswered();
        };
        qDiv.appendChild(btn);
      });

      quizEl.appendChild(qDiv);
    });
  }

  function checkAllAnswered() {
    const allAnswered = selected.every(s => s !== null);
    submitBtn.disabled = !allAnswered;
    submitBtn.textContent = allAnswered
      ? '採点する'
      : `採点する（あと${selected.filter(s => s === null).length}問）`;
  }

  // --- ③ 採点 → 結果画面表示 + 送信 ---
  submitBtn.onclick = () => {
    let score = 0;
    const detailEl = document.getElementById('resultDetail');
    detailEl.innerHTML = '';

    questions.forEach((item, qi) => {
      const isCorrect = selected[qi] === item.answer;
      if (isCorrect) score++;

      const qDiv = document.createElement('div');
      qDiv.className = 'q';

      const eyebrow = document.createElement('div');
      eyebrow.className = 'q-eyebrow';
      eyebrow.textContent = `Q${qi + 1}　${isCorrect ? '⭕️ 正解' : '❌ 不正解'}`;
      qDiv.appendChild(eyebrow);

      const title = document.createElement('div');
      title.className = 'q-title';
      title.textContent = item.q;
      qDiv.appendChild(title);

      item.choices.forEach((choiceText, ci) => {
        const div = document.createElement('div');
        div.className = 'choice';
        div.textContent = choiceText + (ci === selected[qi] ? '（あなたの回答）' : '');
        if (ci === item.answer) div.classList.add('correct');
        else if (ci === selected[qi]) div.classList.add('wrong');
        qDiv.appendChild(div);
      });

      const exp = document.createElement('div');
      exp.className = 'explanation';
      exp.style.display = 'block';
      exp.textContent = item.explanation;
      qDiv.appendChild(exp);

      detailEl.appendChild(qDiv);
    });

    const isPerfect = score === questions.length;
    const isPassed = (score / questions.length) >= PASS_THRESHOLD;
    document.getElementById('resultName').textContent = `${userName} さん`;
    document.getElementById('resultScore').textContent = `${score} / ${questions.length}`;
    document.getElementById('scoreCard').classList.toggle('perfect', isPerfect);
    document.getElementById('resultMsg').textContent = isPerfect
      ? pickRandom(PERFECT_MESSAGES)
      : (isPassed ? pickRandom(GOOD_MESSAGES) : pickRandom(FAIL_MESSAGES));

    // ストリーク・ポイントを更新し、獲得ポイントを表示。ヘッダーのステータスバーも更新する。
    const stats = recordCompletion(score, questions.length);
    document.getElementById('xpGain').textContent = `+${stats.gained}pt 獲得！（累計${stats.xp}pt・連続${stats.streak}日）`;
    renderStatusBar(document.getElementById('statusBarMount'));

    // 満点でなければ「苦手な問題だけもう一度」を出す
    const reviewCta = document.getElementById('reviewCta');
    if (!isPerfect) {
      reviewCta.style.display = 'block';
      document.getElementById('reviewBtn').onclick = () => startReview();
    } else {
      reviewCta.style.display = 'none';
    }

    quizEl.style.display = 'none';
    progressTrack.style.display = 'none';
    submitBtnWrap.style.display = 'none';
    resultScreen.style.display = 'block';
    window.scrollTo(0, 0);

    // 「合格」（正答率が合格ライン以上）の時だけ次のクイズを解放する。
    // 「パーフェクト」（満点）は別枠の称号として記録し、一覧ページで区別して表示する。
    const quizId = config.quiz_id || config.video_title;
    if (isPassed) markCleared(quizId);
    if (isPerfect) markPerfect(quizId);
    sendResult(config, questions, selected, userName, userStore, score, isPassed, isPerfect, currentAttemptId);
  };

  // --- ④ 苦手な問題だけの復習（Airtableへの再送信はしない、その場の練習用） ---
  function startReview() {
    const wrongQuestions = questions.filter((item, qi) => selected[qi] !== item.answer);
    const reviewQuizEl = document.getElementById('reviewQuiz');
    const reviewDone = document.getElementById('reviewDone');
    reviewQuizEl.innerHTML = '';
    reviewDone.style.display = 'none';

    let doneCount = 0;

    wrongQuestions.forEach((item, qi) => {
      const qDiv = document.createElement('div');
      qDiv.className = 'q';

      const eyebrow = document.createElement('div');
      eyebrow.className = 'q-eyebrow';
      eyebrow.textContent = `復習 ${qi + 1} / ${wrongQuestions.length}`;
      qDiv.appendChild(eyebrow);

      const title = document.createElement('div');
      title.className = 'q-title';
      title.textContent = item.q;
      qDiv.appendChild(title);

      let answered = false;
      item.choices.forEach((choiceText, ci) => {
        const btn = document.createElement('button');
        btn.className = 'choice';
        btn.textContent = choiceText;
        btn.onclick = () => {
          if (answered) return;
          answered = true;
          doneCount++;
          qDiv.querySelectorAll('.choice').forEach((b, bi) => {
            if (bi === item.answer) b.classList.add('correct');
            else if (bi === ci) b.classList.add('wrong');
          });
          exp.style.display = 'block';
          if (doneCount === wrongQuestions.length) {
            reviewDone.style.display = 'block';
          }
        };
        qDiv.appendChild(btn);
      });

      const exp = document.createElement('div');
      exp.className = 'explanation';
      exp.textContent = item.explanation;
      qDiv.appendChild(exp);

      reviewQuizEl.appendChild(qDiv);
    });

    resultScreen.style.display = 'none';
    reviewScreen.style.display = 'block';
    window.scrollTo(0, 0);

    // 「結果画面にもどる」：ページを再読み込みせず、既に描画済みの結果画面をそのまま出し直す
    document.getElementById('backToResultLink').onclick = (e) => {
      e.preventDefault();
      reviewScreen.style.display = 'none';
      resultScreen.style.display = 'block';
      window.scrollTo(0, 0);
    };
  }
}

// --- 一覧ページの「Clear」スタンプ用（この端末のブラウザに、登録済みの氏名ごとに記録） ---
// quiz_id はファイル名（拡張子なし）を使う。クイズ一覧.html側のファイル名と必ず一致させること。
// isCleared()はクイズ一覧.html / deploy/index.html からも呼ばれる共通関数。
function markCleared(quizId) {
  try {
    localStorage.setItem(statsKey('quizCleared:' + quizId), '1');
  } catch (e) {
    // localStorageが使えない環境では何もしない（挑戦自体は問題なく完了する）
  }
}

function isCleared(quizId) {
  try {
    return localStorage.getItem(statsKey('quizCleared:' + quizId)) === '1';
  } catch (e) {
    return false;
  }
}

// 「パーフェクト」（満点）の記録。進行の解放条件ではなく、称号としてクイズ一覧に星バッジを出すためだけに使う。
function markPerfect(quizId) {
  try {
    localStorage.setItem(statsKey('quizPerfect:' + quizId), '1');
  } catch (e) {}
}

function isPerfectCleared(quizId) {
  try {
    return localStorage.getItem(statsKey('quizPerfect:' + quizId)) === '1';
  } catch (e) {
    return false;
  }
}

// ============================================================
// クイズ一覧・マイ進捗ページの共通ロジック
// quizzes: 表示順に並べた [{ title, category, file, count }]（クイズ一覧.htmlのQUIZZESと同じ形）。
// カテゴリごとに「直前の1本をクリアするまで次は挑戦不可」。管理者が手動解放したものは例外として開く。
// 判定はファイル名（拡張子なし）＝各クイズのquiz_idで行う。
// ============================================================
// ------------------------------------------------------------
// 【石神井公園駅店だけの「見る順番」ルール】（2026-10-10）
// 研修動画の配信元の方針：先生のセミナー（福山先生・丹下さん）を最初に見てもらう。
//   ① 「特別セミナー」を、すべてクリアするまで、ほかのカテゴリのクイズは開かない。
//   ② セミナーは2つの系列（tracks）を、同時並行で進められる（系列どうしに順番はない）。
//      各系列の中は、書いた順に、前をクリアすると次が開く。
//   ③ セミナーをすべてクリアしたあとは、今までどおり（カテゴリごとに、前の1本をクリアすると次が開く）。
//   ④ 管理ダッシュボードからの手動解放は、これまでどおり、すべての鍵に優先する。
// 新しい特別セミナーを足すときは、該当する系列の最後にクイズIDを足す（足し忘れても、カテゴリ内の順番待ちで動く）。
// このブロックを削除すれば、元（亀戸店と同じ）の動きに戻る。
// ------------------------------------------------------------
const TRAINING_ORDER = {
  gateCategory: '特別セミナー',
  tracks: [
    // 系列A：Dog History → Dog Stress Master → Dog Wellness Master（福山先生）
    ['dog-history-1-part1', 'dog-history-1-part2', 'dog-history-1-part3',
     'dog-stress-master-2-part1', 'dog-stress-master-2-part2', 'dog-stress-master-2-part3',
     'dog-wellness-master-3'],
    // 系列B：やさしさGrooming 第一弾①②③ → 第二弾
    ['yasashisa-grooming-1-1-part1', 'yasashisa-grooming-1-1-part2', 'yasashisa-grooming-1-1-part3',
     'yasashisa-grooming-1-2-part1', 'yasashisa-grooming-1-2-part2', 'yasashisa-grooming-1-2-part3',
     'yasashisa-grooming-1-3-part1', 'yasashisa-grooming-1-3-part2',
     'yasashisa-grooming-2-part1', 'yasashisa-grooming-2-part2', 'yasashisa-grooming-2-part3'],
  ],
};

function computeQuizStates(quizzes) {
  const T = (typeof TRAINING_ORDER !== 'undefined') ? TRAINING_ORDER : null;
  const idOf = q => q.file.replace(/\.html$/, '');
  const titleById = {};
  quizzes.forEach(q => { titleById[idOf(q)] = q.title; });

  // 「見る順番」ルールの下準備（ルールがない店舗では、何もしない）
  const trackPrev = {};   // クイズID → 同じ系列の1つ前のID（先頭はnull）
  const seminarRank = {}; // 「続きから」の優先順（系列を交互に並べる）
  let gateRemaining = 0;
  if (T) {
    T.tracks.forEach(t => t.forEach((id, i) => { trackPrev[id] = i > 0 ? t[i - 1] : null; }));
    const longest = Math.max(...T.tracks.map(t => t.length));
    let r = 0;
    for (let i = 0; i < longest; i++) T.tracks.forEach(t => { if (i < t.length) seminarRank[t[i]] = r++; });
    gateRemaining = quizzes.filter(q => q.category === T.gateCategory && !isCleared(idOf(q))).length;
  }

  const lastClearedInCategory = {};
  return quizzes.map((quiz, idx) => {
    const quizId = idOf(quiz);
    const cleared = isCleared(quizId);
    const inTrack = T && (quizId in trackPrev);
    let wouldBeLockedBySequence;
    let lockHint = '';
    if (inTrack) {
      // セミナーの系列の中：同じ系列の1つ前をクリアすると開く（カテゴリ内の表示順には従わない）
      const prev = trackPrev[quizId];
      wouldBeLockedBySequence = prev !== null && !isCleared(prev);
      if (wouldBeLockedBySequence) lockHint = '先に「' + titleById[prev] + '」をクリアしてください';
    } else {
      const isFirstInCategory = !(quiz.category in lastClearedInCategory);
      wouldBeLockedBySequence = !isFirstInCategory && !lastClearedInCategory[quiz.category];
      if (wouldBeLockedBySequence) lockHint = '前のクイズをクリアすると挑戦できます';
      lastClearedInCategory[quiz.category] = cleared;
      // 特別セミナー以外は、セミナーをすべてクリアするまで開かない
      if (T && quiz.category !== T.gateCategory && gateRemaining > 0) {
        wouldBeLockedBySequence = true;
        lockHint = 'まず「' + T.gateCategory + '」をすべてクリアすると挑戦できます（あと' + gateRemaining + '本）';
      }
    }
    const manuallyUnlocked = isManuallyUnlocked(quizId);
    return {
      quiz, quizId, cleared,
      perfect: isPerfectCleared(quizId),
      wouldBeLockedBySequence, manuallyUnlocked, lockHint,
      rank: (quizId in seminarRank) ? seminarRank[quizId] : 1000 + idx,
      locked: wouldBeLockedBySequence && !manuallyUnlocked,
    };
  });
}

// 「続きから」で開くクイズ＝挑戦できる（ロックされていない）未クリアのうち、優先順位が一番高いもの。全部クリア済みならnull。
// 優先順位（rank）は、ルールのない店舗では、表示順と同じ。
function pickNextQuiz(states) {
  const open = states.filter(s => !s.locked && !s.cleared);
  if (!open.length) return null;
  return open.reduce((a, b) => (b.rank < a.rank ? b : a));
}

// リッチメニューなどから「?go=next」「?go=progress」付きで開かれた時の行き先を返す。
// LINEのLIFF経由で開くとクエリが「liff.state」パラメータの中に入って届くことがあるので、両方を見る。
function getGoParam() {
  try {
    const params = new URLSearchParams(location.search);
    let go = params.get('go');
    if (!go) {
      const state = params.get('liff.state');
      if (state) go = new URLSearchParams(state.slice(state.indexOf('?') + 1)).get('go');
    }
    return go || '';
  } catch (e) {
    return '';
  }
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 選択肢の並び順をシャッフルする（正解が毎回同じ位置に来ないように）。
// answerは「シャッフル後の配列の中で正解が何番目に来たか」に正しく付け替える。
// 元のitem（config.questions内のオブジェクト）は書き換えず、新しいオブジェクトを返す。
function shuffleChoices(item) {
  const order = item.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    ...item,
    choices: order.map(i => item.choices[i]),
    answer: order.indexOf(item.answer),
  };
}

// --- 開始イベントの送信（離脱率算出用） ---
// 「確認した」を押した時点で、無言でAirtableに1行記録する。正答数・正答率などはまだ空欄。
function sendStartEvent(config, userName, userStore, attemptId) {
  const payload = {
    合言葉: QUIZ_SHARED_SECRET,
    送信ID: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    試行ID: attemptId, // 同じ挑戦の「開始」と「完了」を確実に紐付けるためのID（離脱率・所要時間の集計用）
    受講者名: userName,
    所属店舗: userStore,
    動画タイトル: config.video_title,
    クイズID: config.quiz_id || config.video_title,
    受講日時: new Date().toISOString(),
    ステータス: '開始',
    正答数: '',
    総問題数: config.questions.length,
    正答率: '',
    合格判定: '',
    満点フラグ: '',
    回答詳細: ''
  };
  queuePending(payload);
  postToWebhook(payload);
}

// --- 回答結果の送信（Airtable連携用） ---
// 画面には状態を表示しない。送信の成否はブラウザの開発者ツール（コンソール）にのみ記録する。
function sendResult(config, questions, selected, userName, userStore, score, isPassed, isPerfect, attemptId) {
  const detailText = questions.map((item, qi) => {
    const isCorrect = selected[qi] === item.answer;
    return `Q${qi + 1}. ${item.q}\n`
      + `回答: ${item.choices[selected[qi]]}（${isCorrect ? '正解' : '不正解'}）\n`
      + `正解: ${item.choices[item.answer]}`;
  }).join('\n\n');

  const payload = {
    合言葉: QUIZ_SHARED_SECRET,
    送信ID: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    試行ID: attemptId, // 対応する「開始」イベントと同じ値（未対応の場合はnull＝旧バージョンからの呼び出し等）
    受講者名: userName,
    所属店舗: userStore,
    動画タイトル: config.video_title,
    クイズID: config.quiz_id || config.video_title,
    受講日時: new Date().toISOString(),
    ステータス: '完了',
    正答数: score,
    総問題数: questions.length,
    正答率: Math.round((score / questions.length) * 100),
    合格判定: isPassed ? '合格' : 'もう少し！',
    満点フラグ: isPerfect ? 'はい' : 'いいえ',
    回答詳細: detailText
  };

  // 送信を試みる前に、まず再送キューへ保存しておく。
  // （送信中・リトライ待機中にページを閉じても、キューに残っていれば次回開いた時に再送できる）
  queuePending(payload);
  postToWebhook(payload);
}

// ============================================================
// クロスデバイス引き継ぎ（「アカウント作成済み」ボタン）
// この端末のlocalStorageが空でも、別端末で完了した過去の受講記録をAirtableから直接取得して
// 連続記録・pt・クイズごとのクリア状況を復元する。書き込みは一切行わない（読み取り専用）。
// ============================================================

// ============================================================
// LINE ID自動連携（登録の裏側で無言で行う。失敗しても画面には何も表示しない）
// ============================================================
function alreadyLineLinked() {
  try { return localStorage.getItem(statsKey('lineLinkedV2')) === '1'; } catch (e) { return false; }
}
function markLineLinked() {
  try { localStorage.setItem(statsKey('lineLinkedV2'), '1'); } catch (e) {}
}

// LIFF SDKを動的に読み込む（全クイズHTMLに<script>タグを追加せずに済むように、
// このファイル側で必要な時だけ読み込む）。
function loadLiffSdk() {
  return new Promise((resolve, reject) => {
    if (window.liff) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('LIFF SDKの読み込みに失敗しました'));
    document.head.appendChild(s);
  });
}

// LINE経由（LIFF）で開かれている時だけ、無言でLINE IDを取得してAirtableに紐づける。
// 通常のブラウザ・ブックマークから開いた場合はliff.isLoggedIn()がfalseになるので、
// エラー扱いにせず静かに何もしない（コンソールに一言残すのみ）。
//
// 【重要・2026-09-21】LIFFはエンドポイントURL（クイズ一覧のページ）でしか初期化できない。
// LINEのLIFF画面からクイズ本体のページへ移動した後にliff.init()を呼ぶと、LINEのログイン画面
// （access.line.me）へ飛ばされて「400 Bad Request」になる（実機で400を確認。原因はこの仕組みによるものと推定。修正後の実機確認が必要）。
// そのため、この関数はクイズ一覧ページが window.IS_LIFF_ENDPOINT = true を立てた時だけ動く。
// クイズ本体のページ（登録画面からの呼び出し）では何もしない。連携はクイズ一覧を開いた時に行う。
async function tryLinkLineId(name, store) {
  if (!window.IS_LIFF_ENDPOINT) return;
  if (alreadyLineLinked()) return;
  try {
    await loadLiffSdk();
    await liff.init({ liffId: STAFF_LIFF_ID });
    if (!liff.isLoggedIn()) {
      console.log('[LINE連携] LINE経由で開いていないためスキップします');
      return;
    }
    const profile = await liff.getProfile();
    const payload = {
      合言葉: STAFF_LINE_SHARED_SECRET,
      氏名: name,
      所属店舗: store,
      LINE_UserID: profile.userId,
      登録日時: new Date().toISOString(),
    };
    const res = await fetch(STAFF_LINE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      markLineLinked();
      console.log('[LINE連携] 成功');
    }
  } catch (e) {
    console.log('[LINE連携] スキップ（LINE経由で開いていない可能性）:', e.message);
  }
}

// クイズ一覧ページ専用：登録済みの氏名・店舗があれば、LINE IDの連携を試みる（最大waitMsだけ待つ）。
// 「続きから」等でこの後すぐ別ページへ移動する場合に、連携の完了待ちで長く止まらないための上限。
async function linkLineIdForHub(waitMs) {
  window.IS_LIFF_ENDPOINT = true;
  const p = getProfile();
  if (!p.name || !p.store) return;
  await Promise.race([
    tryLinkLineId(p.name, p.store),
    new Promise(resolve => setTimeout(resolve, waitMs || 2000)),
  ]);
}

// Airtableの検索式（filterByFormula）に埋め込む文字列をエスケープする。
// ダブルクォートをそのまま埋め込むと式が壊れる（または意図しない条件になる）ため。
function escapeAirtableFormula(str) {
  return String(str).replace(/"/g, '\\"');
}

// 指定した氏名・所属店舗の「完了」記録を、Airtableから直接取得する（読み取り専用トークンを使用）。
// Airtableは1回のリクエストで最大100件しか返さないため、offsetが返ってくる限りページを送りして
// 全件取り切る（そうしないと101件目以降の記録がポイント・連続記録・クリア状況からごっそり抜け落ちる）。
async function fetchCloudHistory(name, store) {
  if (!AIRTABLE_READONLY_TOKEN) {
    throw new Error('AIRTABLE_READONLY_TOKEN が未設定です（quiz-engine.js側の設定漏れ）');
  }
  // 「ステータス＝完了」だけで絞ると、この項目が追加される前に完了した記録（正答数は入っているが
  // ステータスは空欄のもの）が復元できなくなる。正答数が入っていれば「完了扱い」とみなすことで、
  // 過去の実績も拾えるようにする（「開始」イベントには正答数が入らないので誤って混ざる心配はない）。
  const formula = `AND({受講者名}="${escapeAirtableFormula(name)}", {所属店舗}="${escapeAirtableFormula(store)}", OR({ステータス}="完了", {正答数}!=""))`;
  const fields = ['動画タイトル', 'クイズID', '受講日時', '正答数', '総問題数', '正答率', '合格判定', '満点フラグ'];

  let allFields = [];
  let offset;
  do {
    const params = new URLSearchParams({ filterByFormula: formula, pageSize: '100' });
    fields.forEach(f => params.append('fields[]', f));
    if (offset) params.set('offset', offset);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}?${params.toString()}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_READONLY_TOKEN}` }
    });
    if (!res.ok) throw new Error('Airtable取得失敗: status ' + res.status);
    const data = await res.json();
    allFields = allFields.concat((data.records || []).map(r => r.fields));
    offset = data.offset; // 101件目以降が残っている場合だけ次のページ用のトークンが返ってくる
  } while (offset);

  return allFields;
}

// AirtableのISO日時（UTC）を、この端末のローカル日付（YYYY-MM-DD）に変換する。
// todayStr()と同じ「ローカル時刻基準」に揃えないと、日本時間の深夜〜朝9時前の受講が
// UTC換算で前日扱いになり、週間ログや連続記録の計算がずれてしまう。
function isoToLocalDateStr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 取得した過去記録から、連続記録・pt・週間ログ・クイズごとのクリア状況を、
// 現在のプロフィール（statsKeyの持ち主）に対して復元する。
// 「クイズID」が入っていない古い記録（この機能を追加する前の受講データ）は、
// 個別クイズのクリア状況までは復元できない（連続記録・ptは全期間分そのまま反映される）。
//
// この端末に既にある実績を単純に上書きはしない（統合する）。
// 送信の再送キューにまだ残っている（＝Airtableにまだ届いていない）記録がある状態で
// 復元を行うと、上書きしてしまうとその分の実績が消えてしまうため。
function applyRestoredHistory(records) {
  const cloudDates = records.map(r => isoToLocalDateStr(r['受講日時'])).filter(Boolean);
  const localDates = getActivityDates();
  const dates = [...new Set([...localDates, ...cloudDates])].sort();

  // 満点フラグが空欄の古い記録は、正答数と総問題数から満点かどうかを推測する
  // （この項目が追加される前の記録を「常に満点ではない」と決めつけて損させないため）
  function wasPerfect(r) {
    if (r['満点フラグ'] === 'はい') return true;
    if (r['満点フラグ'] === 'いいえ') return false;
    return r['正答数'] != null && r['総問題数'] != null && r['正答数'] === r['総問題数'];
  }
  let cloudXp = 0;
  records.forEach(r => { cloudXp += wasPerfect(r) ? 20 : 10; });
  // 「大きい方を採用」だと、ローカル・クラウド双方に別々の受講記録がある場合に
  // 片方の分が失われる。そのため、まだAirtableに届いていない（＝再送キューに残っている）
  // 分だけをクラウドの合計に足し込む方式にする。再送キューにある時点でクラウドには
  // 含まれていないと分かっているので、二重計上にはならない。
  const xp = cloudXp + pendingXpForCurrentOwner();

  // 直近の記録から遡って連続日数を数える（1日空きまでは既存のストリークのフリーズと同じ扱い）
  let streak = dates.length ? 1 : 0;
  for (let i = dates.length - 1; i > 0; i--) {
    const gap = daysBetween(dates[i - 1], dates[i]);
    if (gap === 1 || gap === 2) streak++;
    else break;
  }

  try {
    localStorage.setItem(statsKey('quizXP'), String(xp));
    localStorage.setItem(statsKey('quizStreakCount'), String(streak));
    localStorage.setItem(statsKey('quizActivityDates'), JSON.stringify(dates));
    if (dates.length) {
      localStorage.setItem(statsKey('quizLastActiveDate'), dates[dates.length - 1]);
    }
  } catch (e) {}

  // 合格判定が空欄の古い記録は、正答数と総問題数から合格ラインを満たしているか推測する
  function wasPassed(r) {
    if (r['合格判定'] === '合格') return true;
    if (r['合格判定'] === 'もう少し！') return false;
    return r['正答数'] != null && r['総問題数'] > 0 && (r['正答数'] / r['総問題数']) >= PASS_THRESHOLD;
  }

  records.forEach(r => {
    const qid = r['クイズID'];
    if (!qid) return; // クイズID未記録の古いデータはここでは復元しない（動画タイトルからの推測はしない）
    if (wasPassed(r)) markCleared(qid);
    if (wasPerfect(r)) markPerfect(qid);
  });
}

// --- 送信の実行＋失敗時の再送キュー ---
// 一時的な通信障害で受講記録が消えないよう、失敗した回答はlocalStorageに残し、
// 次に別のクイズページを開いたタイミングで自動的に再送を試みる。
const PENDING_KEY = 'quizPendingSubmissions';

// 送信失敗時、その場で3回まで自動リトライ（1.5秒→3秒間隔）する。
// payloadは呼び出し元（sendResult/flushPendingSubmissions）で送信前に既にキューへ保存済みなので、
// ここでは「成功したらキューから消す」だけでよい（送信中・リトライ待機中にページを閉じても記録は残る）。
function postToWebhook(payload, attempt) {
  attempt = attempt || 1;
  fetch(QUIZ_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    // 結果表示直後に「もう一度挑戦する」等でページ離脱しても送信が中断されないようにする
    keepalive: true
  }).then(res => {
    if (!res.ok) throw new Error('status ' + res.status);
    console.log('[研修クイズ] 送信OK', payload);
    removeFromPending(payload.送信ID);
  }).catch(err => {
    if (attempt < 3) {
      console.warn(`[研修クイズ] 送信失敗（${attempt}回目）。再試行します:`, err.message);
      setTimeout(() => postToWebhook(payload, attempt + 1), attempt * 1500);
    } else {
      console.error('[研修クイズ] 送信失敗（3回試行）。再送キューに残したままにします:', err.message, payload);
    }
  });
}

function readPendingList() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// 今のプロフィール（氏名・所属店舗）について、まだAirtableに届いていない「完了」記録の
// pt合計を返す（クロスデバイス復元時、クラウドの合計に足し込むために使う）。
// 再送キューに残っている＝まだクラウドに反映されていないことが確定しているので、
// ここで足しても二重計上にはならない。
function pendingXpForCurrentOwner() {
  let name = '', store = '';
  try {
    name = localStorage.getItem(PROFILE_KEYS.name) || '';
    store = localStorage.getItem(PROFILE_KEYS.store) || '';
  } catch (e) {}
  return readPendingList()
    .filter(p => p && p.ステータス === '完了' && p.受講者名 === name && p.所属店舗 === store)
    .reduce((sum, p) => sum + (p.満点フラグ === 'はい' ? 20 : 10), 0);
}

// 送信IDで重複を避けつつキューに積む（既にキューにある場合は上書き）
function queuePending(payload) {
  try {
    const list = readPendingList().filter(p => p && p.送信ID !== payload.送信ID);
    list.push(payload);
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch (e) {
    // localStorageが使えない環境では再送キューも諦める（それ以上は打つ手がない）
  }
}

function removeFromPending(sendId) {
  try {
    const list = readPendingList().filter(p => p && p.送信ID !== sendId);
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch (e) {}
}

// ページ読み込み時に、前回以前に送信できなかった分があれば自動で再送を試みる。
// 送信が確定するまでキューからは消さないので、再試行中にページを閉じても記録は残る。
function flushPendingSubmissions() {
  const list = readPendingList();
  if (!list.length) return;
  list.forEach(payload => postToWebhook(payload));
}
flushPendingSubmissions();

// 文字列をHTMLに埋め込める形にする。
// 注意：div.innerHTML は & < > だけをエスケープし、引用符はそのまま残す。
// この関数の結果は data-name="..." のような「引用符で囲んだ属性」にも入れているので、
// 引用符を残すと属性が途中で閉じてしまい、細工された氏名・店舗名でXSSになる（2026-09-22 修正）。
// 出力は必ずHTMLとして書き出しており（textContentには使っていない）、実体参照は表示時に元の文字へ戻るため、
// ここで引用符まで変換して問題ない。
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================================
// 店舗・氏名の選択欄（表記ゆれ防止のため自由入力ではなく選択式にしている）
// ============================================================

// 店舗の選択肢を描画し、選んだ店舗に応じて氏名の選択肢を出し分ける（店舗が増えても自動対応）。
// 検索欄（都道府県・電話番号・店舗名）で入力するたびに、一致する店舗だけに絞り込む。
// 店舗数が少ないうち（今は1件）は実質フル表示のままだが、店舗が増えた時にそのまま機能する。
function renderStoreOptions(stores) {
  const storeSelect = document.getElementById('storeInput');
  if (!storeSelect) return;
  const prevValue = storeSelect.value;
  storeSelect.innerHTML = stores.length
    ? stores.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}（${escapeHtml(s.prefecture)}）</option>`).join('')
    : `<option value="">該当する店舗がありません</option>`;
  // 絞り込み後も、それまで選んでいた店舗が候補に残っていればそのまま維持する
  if (stores.some(s => s.name === prevValue)) storeSelect.value = prevValue;
  populateNameSelect(storeSelect.value);
}

function populateStoreAndNameSelects() {
  const storeSelect = document.getElementById('storeInput');
  const storeSearch = document.getElementById('storeSearch');
  if (!storeSelect) return;
  renderStoreOptions(STORE_OPTIONS);
  storeSelect.onchange = () => populateNameSelect(storeSelect.value);
  if (storeSearch) {
    storeSearch.addEventListener('input', () => renderStoreOptions(filterStoreOptions(storeSearch.value)));
  }
}

function populateNameSelect(store) {
  const nameSelect = document.getElementById('nameSelect');
  const otherInput = document.getElementById('nameOtherInput');
  if (!nameSelect || !otherInput) return;
  const staff = STAFF_BY_STORE[store] || [];
  nameSelect.innerHTML = staff.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')
    + `<option value="${escapeHtml(OTHER_NAME_OPTION)}">${escapeHtml(OTHER_NAME_OPTION)}</option>`;
  nameSelect.onchange = () => {
    otherInput.style.display = nameSelect.value === OTHER_NAME_OPTION ? 'block' : 'none';
  };
  otherInput.style.display = 'none';
  otherInput.value = '';
}

// 「その他（手入力）」が選ばれていればその自由入力欄の値を、そうでなければ選択された氏名を返す
function getSelectedName() {
  const nameSelect = document.getElementById('nameSelect');
  const otherInput = document.getElementById('nameOtherInput');
  if (!nameSelect) return '';
  if (nameSelect.value === OTHER_NAME_OPTION) return (otherInput ? otherInput.value : '').trim();
  return nameSelect.value;
}
function getSelectedStore() {
  const storeSelect = document.getElementById('storeInput');
  return storeSelect ? storeSelect.value : '';
}
