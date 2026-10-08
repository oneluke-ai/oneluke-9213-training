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
    quizId: "ashiura-clipping", title: "足裏クリッピング",
    items: [
      { id: "c1", text: "後肢は座骨端と飛節をくっつけるように保持してクリッピングしている" },
      { id: "c2", text: "肉球の間を中までツルツルに刈らず、刈りすぎないようにしている" },
      { id: "c3", text: "前肢はパスターンを軽く前に押して上げ、肘を体の中心より上げず、外側にひねっていない" },
      { id: "c4", text: "クリッパーの角や角度を使って、刈り残しが無いようにしている" },
      { id: "c5", text: "終わったら、足が地面に着くまで優しく補助している" },
    ],
  },
  {
    quizId: "leash-tsukekata", title: "リーシュの付け方",
    items: [
      { id: "l1", text: "リーシュを一度アームから外し、ルーズな状態で首に通している" },
      { id: "l2", text: "紐の長さを拳3個分に調整し、前足が台から落ちない長さにしている" },
      { id: "l3", text: "前方に引きながら上に上げ、リードを下顎骨に沿わせて固定している" },
      { id: "l4", text: "バランスはお腹の下ではなく、お尻の間に手を入れて取っている" },
      { id: "l5", text: "座ってしまった時は、無理に立たせずお尻の方から軽くトントンとしている" },
    ],
  },
  {
    quizId: "leash-hazushikata", title: "リーシュの外し方",
    items: [
      { id: "r1", text: "移動する時、犬の首元でリーシュを外していない" },
      { id: "r2", text: "リーシュは根元から外し、持ったまま移動している" },
      { id: "r3", text: "または、抱っこしてからリーシュを外している" },
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
  {
    quizId: "shampoo-machine", title: "シャンプー(マシンあり)",
    items: [
      { id: "w1", text: "マシンの容器にシャンプー剤を入れたら、しっかり混ぜてから使っている" },
      { id: "w2", text: "マシンを使う時も、たらいに溜めながら洗っている" },
      { id: "w3", text: "下洗いをしっかり行い、仕上げシャンプーはさっくり済ませている" },
      { id: "w4", text: "クレンジングオイルは毎回ではなく、耳や口角など汚れが多いところに使っている" },
      { id: "w5", text: "耳は押し当てて中まで入るように、裏表を洗っている" },
    ],
  },
  {
    quizId: "blow-dry", title: "ブロー＆ドライ",
    items: [
      { id: "e1", text: "ブロワーの前に、スヌードで耳を覆って音と風から守っている" },
      { id: "e2", text: "最初は風で振って水分を飛ばし、そのあと1点集中で毛を伸ばして乾かしている" },
      { id: "e3", text: "耳や鼻に直接風が当たらないように気をつけている" },
      { id: "e4", text: "乾いたところに温風を当て続けず、乾き具合を見極めている" },
    ],
  },
  {
    quizId: "groomer-position", title: "グルーマーのポジション姿勢",
    items: [
      { id: "f1", text: "足裏のクリッピングや爪切りなど細かい作業は、椅子に座って行っている" },
      { id: "f2", text: "作業する足を胸の前の高さに持ってきてから作業している" },
      { id: "f3", text: "爪切りの時は犬の前に座り、お手の状態で足を出してもらっている" },
      { id: "f4", text: "作業中、犬の足を自分の方へ引っ張っていない" },
    ],
  },
  {
    quizId: "combing", title: "コーミング",
    items: [
      { id: "i1", text: "粗めと細めのコームを用意し、毛量が多い子はまず粗い方から入れている" },
      { id: "i2", text: "コームの先を皮膚にガツンと当てていない" },
      { id: "i3", text: "カットの時は、コームを着陸させるように根元まで入れてから上に上げている" },
      { id: "i4", text: "強い引っかかりがある時は、スリッカーに持ち替えてからコーミングしている" },
      { id: "i5", text: "毛の途中で止めず、毛よりも長くゆっくりストロークしている" },
    ],
  },
  {
    quizId: "scissor-care", title: "シザー手入れ",
    items: [
      { id: "j1", text: "汚れたセーム皮と綺麗なセーム皮の2枚を用意して手入れしている" },
      { id: "j2", text: "セーム皮を二枚に畳んで挟み、回すように内側に向けてバリを取っている" },
      { id: "j3", text: "オイルを根元に入れたら、軽く振って汚れを出し、拭き取っている" },
      { id: "j4", text: "ブレンダー・スキバサミは動刃だけバリを取っている" },
      { id: "j5", text: "バリ取りとオイルの手入れを毎日行っている" },
    ],
  },
  {
    quizId: "scissoring", title: "シザーリング",
    items: [
      { id: "n1", text: "シザーを胸の前の一番安定する位置で開閉している" },
      { id: "n2", text: "カットの前にしっかりコーミングしている" },
      { id: "n3", text: "手だけでなく体ごと動かして、同じ位置のまま切っている" },
      { id: "n4", text: "自分の目線で切っているラインを確認しながらカットしている" },
    ],
  },
  {
    quizId: "body-clipper", title: "ボディクリッパー",
    items: [
      { id: "q1", text: "クリッパーをかける前に、立てて置いてかけ位置と角度を確認している" },
      { id: "q2", text: "クリッパーはゆっくり、角度を一定に保ってかけている" },
      { id: "q3", text: "胸はあばら骨に沿って、脇の下はお手の形で前肢を持ってかけている" },
      { id: "q4", text: "前肢2本を一緒に持つバンザイをしていない" },
      { id: "q5", text: "お腹は男の子は性器から指3本分上まで、女の子は陰部周りをかけている" },
    ],
  },
  {
    quizId: "cut-mushroom", title: "カット動画①マッシュルームカット",
    items: [
      { id: "cm1", text: "頭を丸く、耳も丸く切っている" },
      { id: "cm2", text: "頭はつなげ、耳前の毛を残している" },
      { id: "cm3", text: "マズルは頭とつなげず、マズルとして独立させている" },
      { id: "cm4", text: "仕上がりで全体の丸みが見えているか確認している" },
    ],
  },
  {
    quizId: "cut-asymmetry", title: "カット動画②アシンメトリーカット",
    items: [
      { id: "ca1", text: "切る前に耳の位置を確認している" },
      { id: "ca2", text: "片側のラインを反対の耳の後ろにつなげている" },
      { id: "ca3", text: "左右の長さの差で陰影が出ているか確認している" },
      { id: "ca4", text: "顔まわりがすっきりした仕上がりになっている" },
    ],
  },
  {
    quizId: "cut-mohican", title: "カット動画③モヒカンカット",
    items: [
      { id: "cmh1", text: "毛を中央に向かって残し、頭の真ん中を高くしている" },
      { id: "cmh2", text: "サイドを切る前に耳付きの位置を確認している" },
      { id: "cmh3", text: "正面から見て、真ん中のラインが左右にずれていないか確認している" },
    ],
  },
  {
    quizId: "cut-teddybear", title: "カット動画④テディベアカット",
    items: [
      { id: "ct1", text: "切る前に、どこを取ってどこを残すかを決めてから切っている" },
      { id: "ct2", text: "頭の上を丸く取り、テディベアの丸いシルエットにしている" },
      { id: "ct3", text: "顎下を取り、耳前の毛を残している" },
      { id: "ct4", text: "お客様の希望を聞いて、マッシュ・アシメ・モヒカン・テディの違いを伝えている" },
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
