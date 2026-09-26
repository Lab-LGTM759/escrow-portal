let userAddress = null;
let tronWebInstance = null;

// Укажите адрес развернутого контракта
const CONTRACT_ADDRESS = "0xYOUR_DEPLOYED_CONTRACT_ADDRESS_HERE"; 
const CHAIN_ID = 728126428;

let emergencyDeadlineTimestamp = 0;

const walletAddressLabel = document.getElementById('walletAddress');
const txStatusLabel = document.getElementById('txStatus');
const userRoleDisplay = document.getElementById('userRoleDisplay');

// Часы Лондона
function updateLondonClock() {
    const clockElem = document.getElementById('londonClock');
    if (!clockElem) return;
    const options = { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    clockElem.innerText = new Intl.DateTimeFormat('en-GB', options).format(new Date()) + " (London GMT/BST)";
}
setInterval(updateLondonClock, 1000);

// Подключение кошелька
document.getElementById('btnConnectBrowser').addEventListener('click', async () => {
    if (window.tronWeb && window.tronWeb.ready) {
        tronWebInstance = window.tronWeb;
        userAddress = tronWebInstance.defaultAddress.base58;
        walletAddressLabel.innerText = "Подключен кошелек: " + userAddress;
        
        await loadContractComplianceData();
        await loadDepositAndTimerData();
        await loadCurrentPayees();
        await loadFullAuditTrailWithFailures();
    } else {
        alert("Откройте dApp через TronLink или встроенный браузер Tangem Wallet!");
    }
});

// Загрузка состояния и депозита
async function loadContractComplianceData() {
    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        
        const legalHash = await contract.amlAndLegalDocHash().call();
        document.getElementById('amlDocHashDisplay').innerText = legalHash;

        const isPaused = await contract.isPaused().call();
        const pauseElem = document.getElementById('pauseStatusDisplay');
        pauseElem.innerText = isPaused ? "ЗАМОРОЖЕН / FROZEN" : "АКТИВЕН / ACTIVE";
        pauseElem.style.color = isPaused ? "#ef4444" : "#10b981";

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
            userRoleDisplay.innerText = "Роль: Внешний наблюдатель";
        }
    } catch (err) {
        console.error("Ошибка загрузки комплаенса:", err);
    }
}

// Загрузка депозита и таймера 5 суток
async function loadDepositAndTimerData() {
    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);

        const isLocked = await contract.isDepositLocked().call();
        const depositElem = document.getElementById('depositLockStatus');
        depositElem.innerText = isLocked ? "ВНЕСЕН И ЗАБЛОКИРОВАН / LOCKED" : "ОЖИДАЕТ ВНОСА / PENDING";
        depositElem.style.color = isLocked ? "#10b981" : "#f59e0b";

        const usdtContract = await tronWebInstance.contract().at("0xa614f803b6fd780986a42c78ec9c7f77e6ded13c");
        const rawBalance = await usdtContract.balanceOf(CONTRACT_ADDRESS).call();
        document.getElementById('depositedAmountDisplay').innerText = `${(Number(rawBalance) / 1e6).toLocaleString()} USDT`;

        const receiverAddr = await contract.receiver().call();
        document.getElementById('receiverRefundAddress').innerText = tronWebInstance.address.fromHex(receiverAddr);

        const isStage1Done = await contract.isStage1Completed().call();
        let startTime = 0;
        if (isStage1Done) {
            startTime = Number(await contract.stage1Timestamp().call());
        } else {
            startTime = Number(await contract.contractCreatedAt().call());
        }
        emergencyDeadlineTimestamp = startTime + (5 * 24 * 3600); // + 5 суток
    } catch (err) {
        console.error("Ошибка считывания депозита:", err);
    }
}

// Живой таймер 5 суток
setInterval(() => {
    const timerElem = document.getElementById('emergencyTimerDisplay');
    if (!timerElem || emergencyDeadlineTimestamp === 0) return;

    const now = Math.floor(Date.now() / 1000);
    const diff = emergencyDeadlineTimestamp - now;

    if (diff <= 0) {
        timerElem.innerText = "СРОК ИСТЕК (Возврат доступен Приемке)";
        timerElem.style.color = "#ef4444";
    } else {
        const d = Math.floor(diff / (24 * 3600));
        const h = Math.floor((diff % (24 * 3600)) / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        timerElem.innerText = `${d}д ${h}ч ${m}м ${s}с`;
    }
}, 1000);

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
    } catch (err) { console.error("Ошибка загрузки адресов:", err); }
}

// Генерация подписи
async function generateSignature(roleTag) {
    if (!userAddress || !tronWebInstance) return alert("Подключите кошелек!");
    try {
        const timestamp = Math.floor(Date.now() / 1000);
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        const nonce = await contract.nonce().call();

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

document.getElementById('btnSignInvestor').addEventListener('click', async () => {
    const res = await generateSignature("STAGE_2_INVESTOR");
    if (res) { document.getElementById('timeA').value = res.timestamp; document.getElementById('sigA').value = res.signature; }
});
document.getElementById('btnSignOperator').addEventListener('click', async () => {
    const res = await generateSignature("STAGE_2_OPERATOR");
    if (res) { document.getElementById('timeB').value = res.timestamp; document.getElementById('sigB').value = res.signature; }
});
document.getElementById('btnSignOracle').addEventListener('click', async () => {
    const res = await generateSignature("STAGE_2_ORACLE");
    if (res) { document.getElementById('timeOracle').value = res.timestamp; document.getElementById('sigOracle').value = res.signature; }
});

// Исполнение Stage 2
document.getElementById('btnExecuteStage2').addEventListener('click', async () => {
    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        const tx = await contract.executeStage2AndDistribute(
            document.getElementById('timeA').value, document.getElementById('timeB').value, document.getElementById('timeOracle').value,
            document.getElementById('sigA').value, document.getElementById('sigB').value, document.getElementById('sigOracle').value
        ).send({ feeLimit: 300000000 });
        txStatusLabel.innerText = "Выплаты выполнены! Tx: " + tx;
        await loadFullAuditTrailWithFailures();
    } catch (err) { txStatusLabel.innerText = "Ошибка: " + err.message; }
});

// Смена кошельков
document.getElementById('btnUpdateWallets').addEventListener('click', async () => {
    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        const wallets = [
            document.getElementById('payee0').value, document.getElementById('payee1').value,
            document.getElementById('payee2').value, document.getElementById('payee3').value
        ];
        const timeA = document.getElementById('timeA').value || Math.floor(Date.now() / 1000);
        const tx = await contract.updateConfigWithTripleSig(
            wallets, [500, 350, 150, 100], timeA, timeA, timeA,
            document.getElementById('sigA').value, document.getElementById('sigB').value, document.getElementById('sigOracle').value
        ).send({ feeLimit: 150000000 });
        txStatusLabel.innerText = "Кошельки обновлены! Tx: " + tx;
        await loadFullAuditTrailWithFailures();
    } catch (err) { txStatusLabel.innerText = "Ошибка обновления: " + err.message; }
});

// Аварийный возврат (5 дней)
document.getElementById('btnTimeoutRefund').addEventListener('click', async () => {
    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        const tx = await contract.emergencyRefundAfterTimeout().send({ feeLimit: 100000000 });
        txStatusLabel.innerText = "Возврат выполнен Приемке! Tx: " + tx;
        await loadFullAuditTrailWithFailures();
    } catch (err) { txStatusLabel.innerText = "Ошибка возврата: " + err.message; }
});

// Считывание ВСЕХ транзакций (ВКЛЮЧАЯ FAILED/REVERT) из API Tronscan
async function loadFullAuditTrailWithFailures() {
    const tbody = document.getElementById("registryBody");
    if (!tbody) return;

    try {
        const base58Contract = tronWebInstance.address.fromHex(CONTRACT_ADDRESS);
        const response = await fetch(`https://apilist.tronscan.org/api/transaction?sort=-timestamp&limit=25&contract=${base58Contract}`);
        const data = await response.json();

        if (data && data.data && data.data.length > 0) {
            tbody.innerHTML = "";
            data.data.forEach((tx, idx) => {
                const isSuccess = tx.result === "SUCCESS" || tx.contractRet === "SUCCESS";
                const statusHtml = isSuccess
                    ? `<span style="color:#10b981; font-weight:bold;">УСПЕШНО / SUCCESS</span>`
                    : `<span style="color:#ef4444; font-weight:bold;">ОТКЛОНЕНО / FAILED (${tx.contractRet || 'REVERT'})</span>`;

                const londonTime = new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                }).format(new Date(tx.timestamp));

                tbody.innerHTML += `<tr>
                    <td>${idx + 1}</td>
                    <td><strong>${tx.methodName || 'Вызов контракта'}</strong></td>
                    <td>${statusHtml}</td>
                    <td class="hash-code"><a href="https://tronscan.org/#/transaction/${tx.hash}" target="_blank" style="color:#60a5fa;">${tx.hash.substring(0, 12)}...</a></td>
                    <td>${londonTime} (London)</td>
                </tr>`;
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Транзакции отсутствуют</td></tr>';
        }
    } catch (err) {
        console.error("Ошибка загрузки публичной истории Tronscan:", err);
    }
}
