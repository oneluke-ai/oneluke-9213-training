/**
 * 実行チェック（現場で実際にできているかの確認）ver001  ── 2026-09-21
 *
 * クイズに合格した技術を、オーナー・先輩が現場で見て「できた」「まだ」を付ける仕組みの、
 * チェック項目と集計ロジック。管理ダッシュボードから読み込んで使う。
 *
 * データの持ち方：Airtable「実行チェックログ」に、1回の判定ごとに1行ずつ積み上げる（上書きしない）。
 *   (氏名, 所属店舗, クイズID, 項目ID) ごとに、日時が一番新しい1件を「今の状態」とする。
 *   → 「できた」のあとに「まだ」を付ければ取り消せる。履歴も残る。
 *
 * チェック項目は、動画のポイントから作った（クイズ1本につき3〜5項目）。実技のクイズ7本が対象。
 * 特別セミナー（講義形式）は、現場で見て確認できる動作が少ないため、今回は対象外。
 * クイズIDは、公開ページ側（deploy）のIDと同じ。新しいクイズを足した時は、ここにも足す。
 */

const PRACTICE_TABLE_NAME = "実行チェックログ";

const PRACTICE_CHECKLIST = [
  {
    quizId: "dakko-no-shikata", title: "抱っこの仕方",
    items: [
      { id: "d1", text: "犬舎の扉を、パッと開けず、開きすぎないようにして犬を出している" },
      { id: "d2", text: "犬が安心するように、落ち着いた動きと声かけで抱えている" },
      { id: "d3", text: "抱えるとき、胸の下とお尻の2か所をしっかり支えている" },
      { id: "d4", text: "「出す → 扉に注意 → 安心させる → 抱えて支える」の順で行える" },
    ],
  },
  {
    quizId: "ashi-no-agekata", title: "足の上げ方",
    items: [
      { id: "a1", text: "足を後ろに引っ張らず、外側から持ち、肩甲骨の動きに注意している" },
      { id: "a2", text: "足先を触る前に、「触るよ」と合図（声かけ）をしている" },
      { id: "a3", text: "嫌がる反応が出たら、持ち方や力加減を変えている" },
      { id: "a4", text: "足だけでなく、全体のバランスを見ながら作業している" },
      { id: "a5", text: "道具やサポートを使って、無理なく作業している" },
    ],
  },
  {
    quizId: "dry-blow", title: "ドライ&ブロー",
    items: [
      { id: "b1", text: "タオルドライ後、ブロアーで水分を8割ほど飛ばしている" },
      { id: "b2", text: "パピー・シニア・神経質な子には、風量を弱めている" },
      { id: "b3", text: "被毛に風を近づけすぎず、皮膚に垂直に当てて放射状に伸ばしている" },
      { id: "b4", text: "後ろ足など凹凸の多い所を丁寧に伸ばし、毛玉の場所を覚えている" },
      { id: "b5", text: "ドライ中に、皮膚の傷・赤み・できものをチェックしている" },
    ],
  },
  {
    quizId: "zenshi-tsumekiri", title: "前肢爪切り",
    items: [
      { id: "t1", text: "足を持ち始める前に、「持つよ」と犬に伝えている" },
      { id: "t2", text: "座るなどして目線を下げ、作業が胸の前にくる位置でやっている" },
      { id: "t3", text: "肘が体の中心よりも上に上がっていない（鏡で確認できている）" },
      { id: "t4", text: "関節を固定せず「支える」持ち方ができている（足を横に広げない）" },
      { id: "t5", text: "毛をしっかり出して分けてから切り、上から覆い被さらずに持てている" },
    ],
  },
  {
    quizId: "koshi-tsumekiri", title: "後肢爪切り",
    items: [
      { id: "u1", text: "ギロチンとニッパーを、手の大きさや爪の状態で選べている" },
      { id: "u2", text: "ギロチンタイプを、スプリング側を上・硬い側を下にして握って使えている" },
      { id: "u3", text: "肛門よりつま先が前か後ろかを見て、足を後ろに引けるか判断している" },
      { id: "u4", text: "後ろに引かず、飛節と坐骨端をくっつけるように真上に上げている（開かない）" },
      { id: "u5", text: "足をおろす時、地面についたのを確認してからゆっくり離している" },
    ],
  },
  {
    quizId: "tsume-yasuri", title: "爪やすり",
    items: [
      { id: "y1", text: "爪切りのあと、爪の角を残さずヤスリで優しく削っている" },
      { id: "y2", text: "後肢は後ろに引かず、真上に上げて持ってヤスリをかけている" },
      { id: "y3", text: "狼爪は毛をかき分けてから、角だけを取るようにかけている" },
      { id: "y4", text: "手動に頼らず、電動ヤスリも使って短い時間で終わらせている" },
      { id: "y5", text: "嫌がる子は、二人で行う・道具を変えるなど、その子に合わせて対応している" },
    ],
  },
  {
    quizId: "dougu-1", title: "道具の説明①",
    items: [
      { id: "g1", text: "クリッパー（替刃式・25mmまで対応）の特徴と使う場面を、自分の言葉で説明できる" },
      { id: "g2", text: "くし（ピンが太いタイプ）の特徴を説明でき、選んで使える" },
      { id: "g3", text: "クリッパー・くし・シザーを見分けて、用途に合わせて選べる" },
    ],
  },
  {
    quizId: "pin-brush", title: "ピンブラシの使い方",
    items: [
      { id: "p1", text: "被毛の長さよりも長いピンかどうかで、ピンブラシとスリッカーを選べている" },
      { id: "p2", text: "ブラッシングの前に、被毛をしっかり分けている" },
      { id: "p3", text: "毛先から少しずつ、毛を解くようにブラッシングしている" },
      { id: "p4", text: "手首をひねらず横に向けず、被毛に対してまっすぐ抜いている（被毛より短く動かさない）" },
      { id: "p5", text: "左手で被毛や皮膚をしっかり持ち、余分に引っ張らないようにしている" },
    ],
  },
  {
    quizId: "slicker-brush", title: "スリッカーの動かし方",
    items: [
      { id: "k1", text: "スリッカーを当てる前に、コームで被毛の状態（毛先・根元の引っかかり）を確認している" },
      { id: "k2", text: "根元に引っかかりがある時、コームで無理に引っ張らず、スリッカーに持ち替えている" },
      { id: "k3", text: "もつれた部分の毛を分けてから、くっついているところにスリッカーを当てている" },
      { id: "k4", text: "毛先から、スタンプを押すように点で捉え、横に引っ張らないで動かしている" },
      { id: "k5", text: "ブラッシングのあと、もう一度コームを通して確認している" },
    ],
  },
  {
    quizId: "dougu-2", title: "道具の説明②",
    items: [
      { id: "h1", text: "カットの内容や犬の大きさに合わせて、ストレート・セニング（ブレンダー）・カーブなどのシザーを使い分けている" },
      { id: "h2", text: "シーズーなど耳の長い子は、耳を止めてから作業し、耳の毛を切らないようにしている" },
      { id: "h3", text: "シザーやクリッパーをテーブルに置きっぱなしにせず、シザーケースに収納している" },
      { id: "h4", text: "静電気やパサつきが出る時は、スプレーで水分を足してからブラッシングやカットをしている" },
    ],
  },
  {
    quizId: "oshiri-cut", title: "お尻カットガイド",
    items: [
      { id: "o1", text: "カットの前に、理想の形をイメージしてから始めている" },
      { id: "o2", text: "最初に、お尻の頂点を決めている" },
      { id: "o3", text: "お尻と飛節のつながり部分を意識して整えている" },
      { id: "o4", text: "カーブシザーで丸みを作り、被毛に優しいシザーリングをしている" },
    ],
  },
  {
    quizId: "muzzle-cut", title: "プードルマズルカット",
    items: [
      { id: "m1", text: "正面から見て目がはっきり見えるよう、マズル上部と目頭周りを整えている" },
      { id: "m2", text: "アイラインをミニクリッパーで整えている（まつ毛を残す場合を除く）" },
      { id: "m3", text: "マズルの幅を、目尻〜+1mmほどを目安に整えている" },
      { id: "m4", text: "口角周辺・マズル上部の奥行きの切り残しを確認している" },
      { id: "m5", text: "顎の毛を優しく掴み、急な動きに備えている" },
    ],
  },
  {
    quizId: "asime-cut-sougou", title: "アシメカット総合",
    items: [
      { id: "s1", text: "マズル周りを、鼻を中心に放射状にコーミングしている" },
      { id: "s2", text: "マズルの仕上がりを、飼い主の好みを確認して決めている" },
      { id: "s3", text: "口周りの仕上げで、リップ横も整えている" },
      { id: "s4", text: "耳は、耳付きの延長線が一番出っ張るようにして、バランスを取っている" },
    ],
  },
];

function practiceKey(name, store, quizId, itemId) {
  return [name || '', store || '', quizId || '', itemId || ''].join('|');
}

// ログ（Airtableのfields配列）から、(氏名|店舗|クイズID|項目ID)ごとの「今の状態」を作る（純粋関数）。
// 日時が一番新しい1件を採用する。日時が同じ場合は、後に並んでいる方を採用する。
function computePracticeState(records) {
  const latest = {};
  (records || []).forEach(r => {
    const name = r['氏名'], quizId = r['クイズID'], itemId = r['項目ID'];
    if (!name || !quizId || !itemId) return;
    const key = practiceKey(name, r['所属店舗'], quizId, itemId);
    const at = r['日時'] ? String(r['日時']) : '';
    const cur = latest[key];
    if (!cur || at >= cur.at) {
      latest[key] = { result: r['結果'] || '', checker: r['確認者'] || '', memo: r['メモ'] || '', at };
    }
  });
  return latest;
}

// 1人・1クイズの進み具合。項目が今のチェックリストに残っているものだけ数える。
function practiceProgress(state, name, store, quiz) {
  const total = quiz.items.length;
  let done = 0;
  let latestAt = '';
  quiz.items.forEach(item => {
    const s = state[practiceKey(name, store, quiz.quizId, item.id)];
    if (!s) return;
    if (s.result === 'できた') done++;
    if (s.at > latestAt) latestAt = s.at;
  });
  return { done, total, latestAt, complete: total > 0 && done === total };
}

// 全体の集計：スタッフごとに「全項目できた」クイズが何本あるか
function practiceSummary(state, staff, checklist) {
  return staff.map(s => {
    const per = checklist.map(q => Object.assign({ quizId: q.quizId }, practiceProgress(state, s.name, s.store, q)));
    return {
      name: s.name, store: s.store, per,
      completeQuizzes: per.filter(p => p.complete).length,
      checkedItems: per.reduce((n, p) => n + p.done, 0),
    };
  });
}

// Make（Webhook）へ送る内容。合言葉は呼び出し側で付ける
function buildPracticeEvent(name, store, quiz, item, result, checker, memo, nowIso) {
  return {
    氏名: name, 所属店舗: store, クイズID: quiz.quizId, 項目ID: item.id, 項目: item.text,
    結果: result, 確認者: checker || '', メモ: memo || '', 日時: nowIso || new Date().toISOString(),
  };
}

if (typeof module !== 'undefined') module.exports = { PRACTICE_TABLE_NAME, PRACTICE_CHECKLIST, practiceKey, computePracticeState, practiceProgress, practiceSummary, buildPracticeEvent };
