// ==========================================
// 設定エリア 1：エリアごとの通知先
// ==========================================
const AREA_CONFIG = [
  { 
    name: '東北', 
    id: '2', 
    webhook: 'https://discordapp.com/api/webhooks/xxxx' // 東北用のWebhook URL
  },
  { 
    name: '関東', 
    id: '3', 
    webhook: 'https://discordapp.com/api/webhooks/xxxx' // 関東用のWebhook URL
  },
  { 
    name: '中部', 
    id: '4', 
    webhook: 'https://discordapp.com/api/webhooks/xxxx' // 中部用のWebhook URL
  },
  { 
    name: '近畿', 
    id: '5', 
    webhook: 'https://discordapp.com/api/webhooks/xxxx' // 近畿用のWebhook URL
  }
];

// ==========================================
// 設定エリア 2：レア車専用の設定
// ==========================================
const RARE_CAR_CONFIG = {
  keywords: ['ハリアー', 'アルファード', 'ヴェルファイア', '86', 'GR86', 'クラウン', 'カローラスポーツ', 'カムリ', 'RAV4', 'LS', 'GS', 'ES', 'IS', 'CT', 'UX', 'LX', 'RX', 'NX', 'LC', 'MIRAI', 'ランドクルーザー', 'bZ4X', 'GRヤリス'],
  webhook: 'https://discordapp.com/api/webhooks/xxxx', // レア車用のWebhook URL
  sendToNormalChannelAlso: false 
};

const TARGET_URL = 'https://cp.toyota.jp/rentacar/'; 

// ==========================================
// メイン処理
// ==========================================
function checkNewCars() {
  console.log("🚀 車両チェックを開始します...");

  let html = '';
  try {
    const response = UrlFetchApp.fetch(TARGET_URL);
    html = response.getContentText();
  } catch (e) {
    console.error('❌ サイトへのアクセスに失敗しました: ' + e);
    return;
  }

  const items = html.match(/<li class="service-item"[\s\S]*?<\/li>/g);
  if (!items) {
    console.log('⚠️ 車両情報が見つかりませんでした。');
    return;
  }
  console.log(`📋 ページ全体で ${items.length} 件の車両要素を発見。`);

  const scriptProperties = PropertiesService.getScriptProperties();
  const savedProp = scriptProperties.getProperty('CAR_STATUS_HISTORY');
  let previousStatusMap = {};
  try {
    previousStatusMap = savedProp ? JSON.parse(savedProp) : {};
    if (Array.isArray(previousStatusMap)) previousStatusMap = {};
  } catch (e) { previousStatusMap = {}; }

  let currentStatusMap = {};
  let processedIdsInThisLoop = [];

  for (const config of AREA_CONFIG) {
    console.log(`\n🔎 [${config.name} (ID:${config.id})] のチェック中...`);
    let normalNotifications = [];
    let rareNotifications = [];

    for (const itemHtml of items) {
      const areaMatch = itemHtml.match(/data-start-area="([^"]+)"/);
      if (!areaMatch || areaMatch[1] !== config.id) {
        continue;
      }

      // ★修正箇所：車種名から「車両番号」以降を削除する処理を追加
      let carNameRaw = extractText(itemHtml, '車種', 'service-item__info__car-type').normalize('NFKC');
      const carName = carNameRaw.replace(/車両番号.*/, '').trim();

      const shopName = extractText(itemHtml, '出発<br>店舗', 'service-item__shop-start').normalize('NFKC');
      const returnShopName = extractText(itemHtml, '返却<br>店舗', 'service-item__shop-return').normalize('NFKC');
      const dateRange = extractText(itemHtml, '出発期間', 'service-item__date').normalize('NFKC');
      
      let reserveTel = extractText(itemHtml, '予約電話番号', 'service-item__reserve-tel').normalize('NFKC').trim();

      // 一意なIDを作る際は、念のため元の長い名前を使っても良いし、短い名前でもOK
      // ここでは短い名前に変更します
      const uniqueId = `${carName}_${shopName}_${dateRange}`;

      if (processedIdsInThisLoop.includes(uniqueId)) {
        continue; 
      }
      
      const isClosed = itemHtml.includes('show-entry-end');
      const currentStatus = isClosed ? 'CLOSED' : 'OPEN';

      currentStatusMap[uniqueId] = currentStatus;
      processedIdsInThisLoop.push(uniqueId);

      const previousStatus = previousStatusMap[uniqueId];

      if ((!previousStatus && currentStatus === 'OPEN') || (previousStatus === 'OPEN' && currentStatus === 'CLOSED')) {
        
        const type = (!previousStatus && currentStatus === 'OPEN') ? 'NEW' : 'SOLD';
        
        // 通知データ作成（元の完全な情報をログに残したい場合はcarNameRawを使う手もありますが、通知も見やすくするためにcarNameを使います）
        const carData = {
          type: type,
          car: carNameRaw, // 通知には「車両番号」付きの情報を載せる
          shop: shopName,
          returnShop: returnShopName,
          date: dateRange,
          tel: reserveTel
        };

        // 判定にはクリーニング済みの短い名前(carName)を使う
        const isRare = RARE_CAR_CONFIG.keywords.some(keyword => {
          return carName.includes(keyword.normalize('NFKC'));
        });

        if (isRare) {
          console.log(`     💎 レア車検知！: ${carName}`);
          rareNotifications.push(carData);
          if (RARE_CAR_CONFIG.sendToNormalChannelAlso) {
            normalNotifications.push(carData);
          }
        } else {
          console.log(`     ✨ 通常検知: ${carName}`);
          normalNotifications.push(carData);
        }
      }
    }

    if (normalNotifications.length > 0) {
      console.log(`  📨 ${config.name}エリア(通常)：送信`);
      sendDiscordMessage(normalNotifications, config.webhook, config.name, false);
    }

    if (rareNotifications.length > 0) {
      console.log(`  📨 ${config.name}エリア(レア)：送信`);
      sendDiscordMessage(rareNotifications, RARE_CAR_CONFIG.webhook, config.name, true);
    }
  }

  scriptProperties.setProperty('CAR_STATUS_HISTORY', JSON.stringify(currentStatusMap));
  console.log("\n💾 全エリアの状態を保存しました。");
}

// ==========================================
// 補助関数
// ==========================================
function extractText(html, labelStr, parentClass) {
  const regex = new RegExp(`${parentClass}"[\\s\\S]*?>${labelStr}[\\s\\S]*?<p>([\\s\\S]*?)</p>`);
  let match = html.match(regex);
  if (!match) {
    const fallbackRegex = new RegExp(`${parentClass}"[\\s\\S]*?<p>[\\s\\S]*?</p>[\\s\\S]*?<p>([\\s\\S]*?)</p>`);
    match = html.match(fallbackRegex);
  }
  if (match && match[1]) {
    return match[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
  if (parentClass.includes('reserve-tel')) {
     const telMatch = html.match(/service-item__reserve-tel"[\s\S]*?>([\s\S]*?)<\/div>/);
     return telMatch ? telMatch[1].replace(/<[^>]*>/g, '').trim() : '不明';
  }
  return '不明';
}

// ==========================================
// Discord送信関数
// ==========================================
function sendDiscordMessage(notifications, webhookUrl, areaName, isRare) {
  const now = new Date();
  const timeString = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  let titlePrefix = isRare ? '💎【激レア車両発見】' : '【車両状況の更新】';
  
  const header = `**${titlePrefix}(${areaName}エリア)**\n🕒 通知時刻: ${timeString}\n`;
  const footer = `\n━━━━━━━━━━━━━━\n${TARGET_URL}`;
  
  let currentMessage = header;
  
  notifications.forEach((note) => {
    let icon = note.type === 'NEW' ? '🟢 **新着**' : '🔴 **終了**';
    if (isRare && note.type === 'NEW') icon = '💎 **激レア新着**';

    let carBlock = `━━━━━━━━━━━━━━\n`;
    carBlock += `${icon}\n`;
    carBlock += `🚗 **車種:** ${note.car}\n`; // ここには車両番号付きの名前が表示されます
    carBlock += `🛫 **出発:** ${note.shop}\n`;
    carBlock += `🛬 **返却:** ${note.returnShop}\n`;
    carBlock += `📅 **期間:** ${note.date}\n`;
    if (note.type === 'NEW') { 
        carBlock += `📞 **TEL:** ${note.tel}\n`; 
    }

    if ((currentMessage + carBlock + footer).length > 1800) {
      postToDiscord(currentMessage, webhookUrl);
      currentMessage = header + `(続き)\n` + carBlock;
    } else {
      currentMessage += carBlock;
    }
  });

  if (currentMessage !== header) {
    postToDiscord(currentMessage + footer, webhookUrl);
  }
}

function postToDiscord(content, webhookUrl) {
  const payload = { "content": content };
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  try {
    UrlFetchApp.fetch(webhookUrl, options);
    Utilities.sleep(500); 
  } catch (e) {
    console.error('❌ Discord送信エラー: ' + e);
  }
}
