// ==========================================
// 設定エリア
// ==========================================
const DISCORD_WEBHOOK_URL = 'https://discordapp.com/api/webhooks/1451322157685805178/bauCX4---zhVs3rtDxIQu-TU880DgelNFDMCRZkxhfC_U26359bcb_HaabT-9JBnCXgg'; 

const TARGET_URL = 'https://cp.toyota.jp/rentacar/'; 
const TARGET_AREA_ID = '3'; // 関東='3'

// ==========================================
// メイン処理
// ==========================================
function checkNewCars() {
  console.log("🚀 チェック処理を開始します...");

  // 1. サイトのHTMLを取得
  let html = '';
  try {
    const response = UrlFetchApp.fetch(TARGET_URL);
    html = response.getContentText();
  } catch (e) {
    console.error('❌ サイトへのアクセスに失敗しました: ' + e);
    return;
  }

  // 2. 車両リスト抽出
  const items = html.match(/<li class="service-item"[\s\S]*?<\/li>/g);
  if (!items) {
    console.log('⚠️ 車両情報が見つかりませんでした。');
    return;
  }
  console.log(`📋 ページ全体で ${items.length} 件の車両要素を発見。`);

  // 3. 履歴取得
  const scriptProperties = PropertiesService.getScriptProperties();
  const savedProp = scriptProperties.getProperty('CAR_STATUS_HISTORY');
  let previousStatusMap = {};
  try {
    previousStatusMap = savedProp ? JSON.parse(savedProp) : {};
    if (Array.isArray(previousStatusMap)) previousStatusMap = {};
  } catch (e) { previousStatusMap = {}; }

  let currentStatusMap = {}; 
  let notifications = []; 
  
  // 重複防止用リスト（今回の実行内で処理したIDを記録）
  let processedIdsInThisLoop = [];

  // 4. 解析と状態チェック
  for (const itemHtml of items) {
    // エリアチェック
    const areaMatch = itemHtml.match(/data-start-area="([^"]+)"/);
    if (!areaMatch || areaMatch[1] !== TARGET_AREA_ID) {
      continue;
    }

    // 情報の抽出（返却店舗を追加）
    const carName = extractText(itemHtml, '車種', 'service-item__info__car-type');
    const shopName = extractText(itemHtml, '出発<br>店舗', 'service-item__shop-start');
    const returnShopName = extractText(itemHtml, '返却<br>店舗', 'service-item__shop-return'); // ★追加
    const dateRange = extractText(itemHtml, '出発期間', 'service-item__date');
    const reserveTel = extractText(itemHtml, '予約電話番号', 'service-item__reserve-tel');
    
    // ID生成
    const uniqueId = `${carName}_${shopName}_${dateRange}`;

    // 重複スキップ処理
    if (processedIdsInThisLoop.includes(uniqueId)) {
      continue;
    }
    processedIdsInThisLoop.push(uniqueId);

    // 受付終了かどうかの判定
    const isClosed = itemHtml.includes('show-entry-end');
    const currentStatus = isClosed ? 'CLOSED' : 'OPEN';

    // 今回の状態を記録
    currentStatusMap[uniqueId] = currentStatus;
    const previousStatus = previousStatusMap[uniqueId];

    // 通知データ作成（returnShopを追加）
    const carData = {
      type: '',
      car: carName,
      shop: shopName,
      returnShop: returnShopName, // ★追加
      date: dateRange,
      tel: reserveTel
    };

    // --- 比較ロジック ---
    if (!previousStatus && currentStatus === 'OPEN') {
      console.log(`✨ 新着発見: ${carName}`);
      carData.type = 'NEW';
      notifications.push(carData);
    }
    else if (previousStatus === 'OPEN' && currentStatus === 'CLOSED') {
      console.log(`🏁 受付終了: ${carName}`);
      carData.type = 'SOLD';
      notifications.push(carData);
    }
  }

  // 5. 通知があれば送信
  if (notifications.length > 0) {
    sendDiscordMessage(notifications);
  } else {
    console.log("💤 状態の変化はありませんでした。");
  }

  // 6. 履歴保存
  scriptProperties.setProperty('CAR_STATUS_HISTORY', JSON.stringify(currentStatusMap));
}

// ==========================================
// 補助関数（抽出ズレ防止の強化版）
// ==========================================
function extractText(html, labelStr, parentClass) {
  // 指定クラスの中にある <p>タグの内容を、ラベル名を目印に厳密に探す
  // 例: class="...type" ... >車種</p> ... <p>車名</p>
  const regex = new RegExp(`${parentClass}"[\\s\\S]*?>${labelStr}[\\s\\S]*?<p>([\\s\\S]*?)</p>`);
  let match = html.match(regex);
  
  // もしラベル名での検索が失敗した場合の予備（単純な構造検索）
  if (!match) {
    const fallbackRegex = new RegExp(`${parentClass}"[\\s\\S]*?<p>[\\s\\S]*?</p>[\\s\\S]*?<p>([\\s\\S]*?)</p>`);
    match = html.match(fallbackRegex);
  }

  if (match && match[1]) {
    return match[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
  
  // 電話番号用特別処理
  if (parentClass.includes('reserve-tel')) {
     const telMatch = html.match(/service-item__reserve-tel"[\s\S]*?>([\s\S]*?)<\/div>/);
     return telMatch ? telMatch[1].replace(/<[^>]*>/g, '').trim() : '不明';
  }
  return '不明';
}

// ==========================================
// Discord送信関数（返却店舗表示を追加）
// ==========================================
function sendDiscordMessage(notifications) {
  const header = `**【車両状況の更新】(エリア${TARGET_AREA_ID})**\n`;
  const footer = `\n━━━━━━━━━━━━━━\n${TARGET_URL}`;
  let currentMessage = header;
  
  notifications.forEach((note) => {
    let icon = note.type === 'NEW' ? '🟢 **新着車両**' : '🔴 **受付終了**';
    
    // ★メッセージに返却店舗を追加
    let carBlock = `━━━━━━━━━━━━━━\n`;
    carBlock += `${icon}\n`;
    carBlock += `🚗 **車種:** ${note.car}\n`;
    carBlock += `🛫 **出発:** ${note.shop}\n`;
    carBlock += `🛬 **返却:** ${note.returnShop}\n`; // ★ここに追加
    carBlock += `📅 **期間:** ${note.date}\n`;

    if (note.type === 'NEW') { 
        carBlock += `📞 **TEL:** ${note.tel}\n`; 
    }

    if ((currentMessage + carBlock + footer).length > 1800) {
      postToDiscord(currentMessage); 
      currentMessage = header + `(続き)\n` + carBlock;
    } else {
      currentMessage += carBlock;
    }
  });

  if (currentMessage !== header) {
    postToDiscord(currentMessage + footer);
  }
}

function postToDiscord(content) {
  console.log(`📤 Discord送信: ${content.substring(0, 30)}...`); 
  const payload = { "content": content };
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  try {
    UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, options);
    Utilities.sleep(500); 
  } catch (e) {
    console.error('❌ Discord送信エラー: ' + e);
  }
}
