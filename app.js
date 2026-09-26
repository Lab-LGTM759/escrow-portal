let userAddress = null;
let tronWebInstance = null;

const CONTRACT_ADDRESS = "TMzLAfhixpozQvuqVBqhGWccLm1qQYJ4dQ"; 
const CHAIN_ID = 728126428;

// Автоматический запуск при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
    updateLondonClock();
    setInterval(updateLondonClock, 1000);
    initUIEvents();
});

// 1. Отображение времени Лондона (GMT/BST)
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
    clockElem.innerText = new Intl.DateTimeFormat('en-GB', options).format(new Date()) + " (London GMT/BST)";
}

// 2. Инициализация обработчиков событий
function initUIEvents() {
    // Подключение кошелька
    const btnConnect = document.getElementById('btnConnectBrowser');
    if (btnConnect) btnConnect.addEventListener('click', connectWallet);

    // Модальное окно QR-кода
    const qrModal = document.getElementById('qrModal');
    const btnConnectQR = document.getElementById('btnConnectQR');
    const btnCloseQR = document.getElementById('btnCloseQR');

    if (btnConnectQR && qrModal) {
        btnConnectQR.addEventListener('click', () => {
            const qrContainer = document.getElementById('qrcode');
            if (qrContainer) {
                qrContainer.innerHTML = ""; 
                new QRCode(qrContainer, {
                    text: window.location.href,
                    width: 200,
                    height: 200,
                    colorDark: "#0f172a",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.H
                });
            }
            qrModal.style.display = "flex";
        });
    }

    if (btnCloseQR && qrModal) {
        btnCloseQR.addEventListener('click', () => { qrModal.style.display = "none"; });
    }

    window.addEventListener('click', (event) => {
        if (qrModal && event.target === qrModal) qrModal.style.display = "none";
    });

    // Кнопки генерации подписей (EIP-191)
    const btnSignInv = document.getElementById('btnSignInvestor');
    if (btnSignInv) btnSignInv.addEventListener('click', () => generateSignature('timeA', 'sigA'));

    const btnSignOp = document.getElementById('btnSignOperator');
    if (btnSignOp) btnSignOp.addEventListener('click', () => generateSignature('timeB', 'sigB'));

    const btnSignOra = document.getElementById('btnSignOracle');
    if (btnSignOra) btnSignOra.addEventListener('click', () => generateSignature('timeOracle', 'sigOracle'));

    // Исполнение смарт-контракта
    const btnExecute = document.getElementById('btnExecuteStage2');
    if (btnExecute) btnExecute.addEventListener('click', executeStage2Payouts);

    const btnRefund = document.getElementById('btnTimeoutRefund');
    if (btnRefund) btnRefund.addEventListener('click', executeEmergencyRefund);

    // Обновление кошельков
    const btnUpdate = document.getElementById('btnUpdateWallets');
    if (btnUpdate) btnUpdate.addEventListener('click', updatePayeeWallets);
}

// 3. Логика подключения кошелька TronLink / Tangem
async function connectWallet() {
    try {
        const provider = window.tron || window.tronLink;
        
        if (!provider) {
            alert("Кошелек TronLink не найден! Убедитесь, что расширение установлено и включено.");
            return;
        }

        try {
            await provider.request({ method: 'tron_requestAccounts' });
        } catch (reqErr) {
            console.warn("Запрос авторизации отправлен в TronLink:", reqErr);
        }

        // Ожидание инициализации объекта TronWeb
        let attempts = 0;
        while ((!window.tronWeb || !window.tronWeb.ready || !window.tronWeb.defaultAddress.base58) && attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 300));
            attempts++;
        }

        if (window.tronWeb && window.tronWeb.ready && window.tronWeb.defaultAddress.base58) {
            tronWebInstance = window.tronWeb;
            userAddress = tronWebInstance.defaultAddress.base58;
            
            const walletLabel = document.getElementById('walletAddress');
            if (walletLabel) {
                walletLabel.innerText = "Подключен кошелек: " + userAddress;
            }
            
            await loadContractDataSafely();
        } else {
            alert("Кошелек TronLink заблокирован или не ответил. Нажмите на иконку TronLink в браузере, введите пароль и повторите попытку.");
        }
    } catch (err) {
        console.error("Ошибка подключения:", err);
        alert("Не удалось подключить кошелек: " + (err.message || err));
    }
}

// 4. Безопасное считывание состояния смарт-контракта
async function loadContractDataSafely() {
    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        
        // Хэш документов
        const legalHash = await contract.amlAndLegalDocHash().call();
        const amlElem = document.getElementById('amlDocHashDisplay');
        if (amlElem) amlElem.innerText = legalHash;

        // Статус паузы / заморозки
        const isPaused = await contract.isPaused().call();
        const pauseElem = document.getElementById('pauseStatusDisplay');
        if (pauseElem) {
            pauseElem.innerText = isPaused ? "ЗАМОРОЖЕН / FROZEN" : "АКТИВЕН / ACTIVE";
            pauseElem.style.color = isPaused ? "#ef4444" : "#10b981";
        }

        await loadDepositAndTimerData();
        await loadCurrentPayees();
        await loadFullAuditTrailWithFailures();
    } catch (err) {
        console.error("Ошибка загрузки данных контракта:", err);
    }
}

// 5. Загрузка данных депозита и баланса USDT
async function loadDepositAndTimerData() {
    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        const isLocked = await contract.isDepositLocked().call();
        const depositElem = document.getElementById('depositLockStatus');
        if (depositElem) {
            depositElem.innerText = isLocked ? "ВНЕСЕН И ЗАБЛОКИРОВАН / LOCKED" : "ОЖИДАЕТ ВНОСА / PENDING";
            depositElem.style.color = isLocked ? "#10b981" : "#f59e0b";
        }

        const usdtContract = await tronWebInstance.contract().at("0xa614f803b6fd780986a42c78ec9c7f77e6ded13c");
        const rawBalance = await usdtContract.balanceOf(CONTRACT_ADDRESS).call();
        const balanceElem = document.getElementById('depositedAmountDisplay');
        if (balanceElem) balanceElem.innerText = `${(Number(rawBalance) / 1e6).toLocaleString()} USDT`;
    } catch (err) {
        console.error("Ошибка депозита:", err);
    }
}

// 6. Загрузка адресов получателей
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
        console.error("Ошибка адресов:", err); 
    }
}

// 7. Аудиторский реестр транзакций из Shasta TronGrid API
async function loadFullAuditTrailWithFailures() {
    const tbody = document.getElementById("registryBody");
    if (!tbody || !tronWebInstance) return;

    try {
        const base58Contract = tronWebInstance.address.fromHex(CONTRACT_ADDRESS);
        const response = await fetch(`https://apilist.shasta.trongrid.io/api/transaction?sort=-timestamp&limit=25&contract=${base58Contract}`);
        const data = await response.json();

        if (data && data.data && data.data.length > 0) {
            tbody.innerHTML = "";
            data.data.forEach((tx, idx) => {
                const isSuccess = tx.result === "SUCCESS" || tx.contractRet === "SUCCESS";
                const statusHtml = isSuccess
                    ? `<span style="color:#10b981; font-weight:bold;">УСПЕШНО / SUCCESS</span>`
                    : `<span style="color:#ef4444; font-weight:bold;">ОТКЛОНЕНО / FAILED</span>`;

                tbody.innerHTML += `<tr>
                    <td>${idx + 1}</td>
                    <td><strong>${tx.methodName || 'Вызов контракта'}</strong></td>
                    <td>${statusHtml}</td>
                    <td class="hash-code"><a href="https://shasta.tronscan.org/#/transaction/${tx.hash}" target="_blank" style="color:#60a5fa;">${tx.hash.substring(0, 12)}...</a></td>
                    <td>${new Date(tx.timestamp).toLocaleTimeString()}</td>
                </tr>`;
            });
        }
    } catch (err) { 
        console.error("Ошибка аудита:", err); 
    }
}

// 8. Генерация криптографической подписи (EIP-191)
async function generateSignature(timeInputId, sigInputId) {
    if (!tronWebInstance || !userAddress) {
        alert("Сначала подключите кошелек!");
        return;
    }
    try {
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `London Epoch Time: ${timestamp}`;
        const signature = await tronWebInstance.trx.signMessageV2(message);

        document.getElementById(timeInputId).value = timestamp;
        document.getElementById(sigInputId).value = signature;
    } catch (err) {
        console.error("Ошибка подписи:", err);
        alert("Ошибка при создании подписи: " + (err.message || err));
    }
}

// 9. Исполнение Stage 2 выплат
async function executeStage2Payouts() {
    if (!tronWebInstance) return alert("Подключите кошелек!");
    const tA = document.getElementById('timeA').value;
    const sA = document.getElementById('sigA').value;
    const tB = document.getElementById('timeB').value;
    const sB = document.getElementById('sigB').value;
    const tO = document.getElementById('timeOracle').value;
    const sO = document.getElementById('sigOracle').value;

    if (!sA || !sB || !sO) {
        return alert("Необходимы подписи всех 3 сторон!");
    }

    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        const tx = await contract.executeStage2(tA, sA, tB, sB, tO, sO).send();
        document.getElementById('txStatus').innerText = "Транзакция отправлена: " + tx;
    } catch (err) {
        console.error("Ошибка исполнения:", err);
        alert("Ошибка выполнения: " + (err.message || err));
    }
}

// 10. Аварийный возврат средств
async function executeEmergencyRefund() {
    if (!tronWebInstance) return alert("Подключите кошелек!");
    try {
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        const tx = await contract.emergencyTimeoutRefund().send();
        document.getElementById('txStatus').innerText = "Аварийный возврат запущен: " + tx;
    } catch (err) {
        console.error("Ошибка возврата:", err);
        alert("Ошибка аварийного возврата: " + (err.message || err));
    }
}

// 11. Обновление адресов получателей
async function updatePayeeWallets() {
    if (!tronWebInstance) return alert("Подключите кошелек!");
    try {
        const payees = [];
        for (let i = 0; i < 4; i++) {
            const val = document.getElementById(`payee${i}`).value;
            if (!val) return alert(`Заполните адрес кошелька #${i}`);
            payees.push(val);
        }
        const contract = await tronWebInstance.contract().at(CONTRACT_ADDRESS);
        const tx = await contract.updatePayeeWallets(payees).send();
        document.getElementById('txStatus').innerText = "Кошельки обновлены: " + tx;
    } catch (err) {
        console.error("Ошибка обновления кошельков:", err);
        alert("Ошибка обновления: " + (err.message || err));
    }
}
