let userAddress = null;
let tronWebInstance = null;

// !!! УКАЖИТЕ АДРЕС ВАШЕГО РАЗВЕРНУТОГО КОНТРАКТА СМАРТ-КОНТРАКТА !!!
const CONTRACT_ADDRESS = "0xYOUR_DEPLOYED_CONTRACT_ADDRESS_HERE"; 
const CHAIN_ID = 728126428; // TRON Mainnet Chain ID

const walletAddressLabel = document.getElementById('walletAddress');
const txStatusLabel = document.getElementById('txStatus');
const userRoleDisplay = document.getElementById('userRoleDisplay');

// --- 1. ТАЙМЕР ВРЕМЕНИ ЛОНДОНА (UTC/BST) ---
function updateLondonClock() {
    const clockElem = document.getElementById('londonClock');
    if (!clockElem) return;
    const options = {
        timeZone: 'Europe/London',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    const londonTimeStr = new Intl.DateTimeFormat('en-GB', options).format(new Date());
    clockElem.innerText = londonTimeStr + " (London Time)";
}
setInterval(updateLondonClock, 1000);
updateLondonClock();

// --- 2. ПОДКТЮЧЕНИЕ КОШЕЛЬКА ---
document.getElementById('btnConnectBrowser').addEventListener('click', async () => {
    if (window.tronWeb && window.tronWeb.ready) {
        tronWebInstance = window.tronWeb;
        userAddress = tronWebInstance.defaultAddress.base58;
        walletAddressLabel.innerText = "Подключен кошелек: " + userAddress;
        
        await loadContractComplianceData();
        await loadCurrentPayees();
        await loadPayoutAndActionRegistry();
    } else {
        alert("Откройте dApp через TronLink или встроенный браузер Tangem Wallet!");
    }
});

// QR-код для внешних браузеров
document.getElementById('btnConnectQR').addEventListener('click', () => {
    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = "";
    new QRCode(qrContainer, { text: window.location.href, width: 200, height: 200 });
    document.getElementById('qrModal').style.display = "block";
});

// --- 3. ЗАГРУЗКА СОСТОЯНИЯ СМАРТ-КОНТРАКТА ---
async function loadContractComplianceData() {
    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        
        const legalHash = await contract.amlAndLegalDocHash().call();
        document.getElementById('amlDocHashDisplay').innerText = legalHash;

        const isPaused = await contract.isPaused().call();
        const pauseElem = document.getElementById('pauseStatusDisplay');
        pauseElem.innerText = isPaused ? "ЗАМОРОЖЕН" : "АКТИВЕН";
        pauseElem.style.color = isPaused ? "#ef4444" : "#10b981";

        // Определение роли текущего кошелька
        const investor = await contract.investor().call();
        const receiver = await contract.receiver().call();
        const oracle = await contract.oracle().call();

        const currentHex = tronWebInstance.address.toHex(userAddress).toLowerCase();
        if (currentHex === tronWebInstance.address.toHex(investor).toLowerCase()) {
            userRoleDisplay.innerText = "Роль: Инвестор (Party A)";
        } else if (currentHex === tronWebInstance.address.toHex(receiver).toLowerCase()) {
            userRoleDisplay.innerText = "Роль: Приемка (Party B)";
        } else if (currentHex === tronWebInstance.address.toHex(oracle).toLowerCase()) {
            userRoleDisplay.innerText = "Роль: Оракул-Координатор";
        } else {
            userRoleDisplay.innerText = "Роль: Внешний наблюдатель / Участник";
        }
    } catch (err) {
        console.error("Ошибка считывания комплаенса:", err);
    }
}

// Загрузка текущих получателей из смарт-контракта
async function loadCurrentPayees() {
    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        for (let i = 0; i < 4; i++) {
            const payee = await contract.payees(i).call();
            const inputElem = document.getElementById(`payee${i}`);
            if (inputElem && payee.wallet) {
                inputElem.value = tronWebInstance.address.fromHex(payee.wallet);
            }
        }
    } catch (err) {
        console.error("Ошибка загрузки адресов получателей:", err);
    }
}

// --- 4. НЕЗАВИСИМАЯ ГЕНЕРАЦИЯ ПОДПИСЕЙ ПО ЛОНДОНСКОМУ ВРЕМЕНИ ---
async function generateSignature(roleTag) {
    if (!userAddress || !tronWebInstance) {
        alert("Сначала подключите кошелек!");
        return null;
    }
    try {
        // Расчет Epoch Timestamp по UTC (Лондон)
        const timestamp = Math.floor(Date.now() / 1000);
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        const nonce = await contract.nonce().call();

        // Формирование структуры хэша сообщения EIP-191
        const messageHash = tronWebInstance.sha3(
            tronWebInstance.address.toHex(CONTRACT_ADDRESS) +
            CHAIN_ID.toString(16).padStart(64, '0') +
            tronWebInstance.toHex(roleTag).replace('0x', '') +
            timestamp.toString(16).padStart(64, '0') +
            BigInt(nonce).toString(16).padStart(64, '0')
        );

        const signature = await tronWebInstance.trx.sign(messageHash);
        return { timestamp, signature };
    } catch (err) {
        alert("Ошибка создания подписи: " + err.message);
        return null;
    }
}

// Обработчики кнопок подписи каждого участника
document.getElementById('btnSignInvestor').addEventListener('click', async () => {
    const res = await generateSignature("STAGE_2_INVESTOR");
    if (res) { 
        document.getElementById('timeA').value = res.timestamp; 
        document.getElementById('sigA').value = res.signature; 
    }
});

document.getElementById('btnSignOperator').addEventListener('click', async () => {
    const res = await generateSignature("STAGE_2_OPERATOR");
    if (res) { 
        document.getElementById('timeB').value = res.timestamp; 
        document.getElementById('sigB').value = res.signature; 
    }
});

document.getElementById('btnSignOracle').addEventListener('click', async () => {
    const res = await generateSignature("STAGE_2_ORACLE");
    if (res) { 
        document.getElementById('timeOracle').value = res.timestamp; 
        document.getElementById('sigOracle').value = res.signature; 
    }
});

// --- 5. ИСПОЛНЕНИЕ ВЫПЛАТ СТАЦИИ 2 СМАРТ-КОНТРАКТОМ ---
document.getElementById('btnExecuteStage2').addEventListener('click', async () => {
    const timeA = document.getElementById('timeA').value;
    const sigA = document.getElementById('sigA').value;
    const timeB = document.getElementById('timeB').value;
    const sigB = document.getElementById('sigB').value;
    const timeOracle = document.getElementById('timeOracle').value;
    const sigOracle = document.getElementById('sigOracle').value;

    if (!timeA || !sigA || !timeB || !sigB || !timeOracle || !sigOracle) {
        return alert("Все 3 участника должны самостоятельно сгенерировать подписи!");
    }

    try {
        txStatusLabel.innerText = "Отправка 3-of-3 подписей в контракт...";
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        
        const tx = await contract.executeStage2AndDistribute(
            timeA, timeB, timeOracle, 
            sigA, sigB, sigOracle
        ).send({ feeLimit: 300000000 });

        txStatusLabel.innerText = "Разгон средств выплат успешно завершен! Tx: " + tx;
        await loadPayoutAndActionRegistry();
    } catch (err) {
        txStatusLabel.innerText = "Ошибка исполнения Stage 2: " + err.message;
    }
});

// --- 6. ОБНОВЛЕНИЕ АДРЕСОВ КОШЕЛЬКОВ В СМАРТ-КОНТРАКТЕ ---
document.getElementById('btnUpdateWallets').addEventListener('click', async () => {
    const w0 = document.getElementById('payee0').value;
    const w1 = document.getElementById('payee1').value;
    const w2 = document.getElementById('payee2').value;
    const w3 = document.getElementById('payee3').value;

    if (!w0 || !w1 || !w2 || !w3) {
        return alert("Заполните все 4 адреса получателей!");
    }

    const timeA = document.getElementById('timeA').value || Math.floor(Date.now() / 1000);
    const sigA = document.getElementById('sigA').value;
    const sigB = document.getElementById('sigB').value;
    const sigOracle = document.getElementById('sigOracle').value;

    if (!sigA || !sigB || !sigOracle) {
        return alert("Для смены адресов необходимы подписи всех 3 сторон!");
    }

    try {
        txStatusLabel.innerText = "Смена адресов получателей в контракте...";
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        
        const wallets = [w0, w1, w2, w3];
        const bps = [500, 350, 150, 100]; // 11% суммарно

        const tx = await contract.updateConfigWithTripleSig(
            wallets, bps, timeA, timeA, timeA, sigA, sigB, sigOracle
        ).send({ feeLimit: 150000000 });

        txStatusLabel.innerText = "Адреса получателей обновлены! Tx: " + tx;
        await loadPayoutAndActionRegistry();
    } catch (err) {
        txStatusLabel.innerText = "Ошибка смены адресов: " + err.message;
    }
});

// Аварийный возврат (5 дней)
document.getElementById('btnTimeoutRefund').addEventListener('click', async () => {
    try {
        txStatusLabel.innerText = "Инициирование аварийного возврата...";
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        const tx = await contract.emergencyRefundAfterTimeout().send({ feeLimit: 100000000 });
        txStatusLabel.innerText = "Возврат выполнен! Tx: " + tx;
        await loadPayoutAndActionRegistry();
    } catch (err) {
        txStatusLabel.innerText = "Ошибка возврата: " + err.message;
    }
});

// --- 7. АУДИТОРСКИЙ РЕЕСТР ВЫПЛАТ И ДЕЙСТВИЙ С КОНВЕРТАЦИЕЙ В ВРЕМЯ ЛОНДОНА ---
async function loadPayoutAndActionRegistry() {
    const tbody = document.getElementById("registryBody");
    if (!tbody || !tronWebInstance) return;

    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        tbody.innerHTML = "";
        let i = 0;
        let hasRecords = false;

        // Погрузка всех зафиксированных выплат из массива payoutRecords
        while (true) {
            try {
                const record = await contract.payoutRecords(i).call();
                hasRecords = true;

                // Перевод Unix timestamp в лондонский формат времени
                const londonDateStr = new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Europe/London',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                }).format(new Date(Number(record.timestamp) * 1000));

                const recipientAddress = tronWebInstance.address.fromHex(record.recipient);
                const amountUsdt = (Number(record.amountUsdt) / 1e6).toLocaleString();

                tbody.innerHTML += `<tr>
                    <td>${i + 1}</td>
                    <td class="hash-code">${recipientAddress}</td>
                    <td><strong>${amountUsdt} USDT</strong></td>
                    <td class="hash-code">${record.txHash}</td>
                    <td>${londonDateStr} (London)</td>
                </tr>`;
                i++;
            } catch (e) {
                break; // Выход по достижению конца массива
            }
        }

        if (!hasRecords) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Записи действий и выплат пока отсутствуют</td></tr>';
        }
    } catch (err) { 
        console.error("Ошибка загрузки отчета выплат:", err); 
    }
}