import { ethers } from "ethers";
import streamPayArtifact from "./StreamPay.json";
import "./style.css";

// -------------------------------------------------------
// STREAM PAY CONFIGURATION
// -------------------------------------------------------

const CONTRACT_ADDRESS =
  "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const REQUIRED_CHAIN_ID = 31337n;

const RPC_URL = "http://127.0.0.1:8545";

// -------------------------------------------------------
// GLOBAL STATE
// -------------------------------------------------------

const app = document.querySelector("#app");

let provider;
let signer;
let contract;
let currentAccount = "";

let tickingInterval = null;

let eventProvider = null;
let eventContract = null;
let liveSyncStarted = false;

let chainClock = {
  blockTimestamp: 0,
  localStartTime: 0,
};

// -------------------------------------------------------
// BASIC HELPERS
// -------------------------------------------------------

function shortAddress(address) {
  if (!address) return "";

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatEth(value, decimals = 6) {
  const amount = Number(ethers.formatEther(value));

  return amount.toFixed(decimals);
}

function getErrorMessage(error) {
  return (
    error?.shortMessage ||
    error?.reason ||
    error?.info?.error?.message ||
    error?.message ||
    "Unknown transaction error"
  );
}

function clearTicker() {
  if (tickingInterval) {
    clearInterval(tickingInterval);
    tickingInterval = null;
  }
}

function setMessage(text, type = "info") {
  const box = document.querySelector("#message");

  if (!box) return;

  box.textContent = text;
  box.className = `message show ${type}`;
}

function currentBlockchainTime() {
  const localSecondsPassed = Math.floor(
    (Date.now() - chainClock.localStartTime) / 1000
  );

  return chainClock.blockTimestamp + localSecondsPassed;
}

// -------------------------------------------------------
// BLOCKCHAIN CLOCK
// -------------------------------------------------------

async function syncBlockchainClock() {
  const block = await provider.getBlock("latest");

  chainClock = {
    blockTimestamp: Number(block.timestamp),
    localStartTime: Date.now(),
  };
}

// -------------------------------------------------------
// LIVE BLOCKCHAIN EVENT AUTO-SYNC
// -------------------------------------------------------

async function setupLiveEventSync() {
  // Prevent duplicate listeners
  if (liveSyncStarted) {
    return;
  }

  /*
    This provider connects directly to Anvil.

    It is separate from MetaMask so that every browser
    window can independently listen for blockchain events.
  */
  eventProvider =
    new ethers.JsonRpcProvider(RPC_URL);

  // Check Anvil for new events approximately every second.
  eventProvider.pollingInterval = 1000;

  eventContract =
    new ethers.Contract(
      CONTRACT_ADDRESS,
      streamPayArtifact.abi,
      eventProvider
    );

  // -----------------------------------------------------
  // STREAM CREATED
  // -----------------------------------------------------

  await eventContract.on(
    "StreamCreated",
    async (
      streamId,
      companyId,
      employerAddress,
      employeeAddress
    ) => {
      try {
        const me =
          currentAccount.toLowerCase();

        const isEmployer =
          employerAddress.toLowerCase() === me;

        const isEmployee =
          employeeAddress.toLowerCase() === me;

        /*
          Only refresh if this stream belongs to
          the wallet currently using this browser.
        */
        if (!isEmployer && !isEmployee) {
          return;
        }

        await renderForCurrentAccount();

        setMessage(
          `LIVE SYNC: Stream #${streamId.toString()} created on-chain.`,
          "success"
        );
      } catch (error) {
        console.error(
          "StreamCreated live sync error:",
          error
        );
      }
    }
  );

  // -----------------------------------------------------
  // STREAM CANCELLED
  // -----------------------------------------------------

  await eventContract.on(
    "StreamCancelled",
    async (
      streamId,
      vestedAmount,
      protocolFee,
      employeeAmount,
      employerRefund
    ) => {
      try {
        /*
          Immediately stop the old local ticking timer.
        */
        clearTicker();

        /*
          Fetch the new blockchain state once.
          The cancelled stream will now have status CLOSED.
        */
        await renderForCurrentAccount();

        setMessage(
          `LIVE SYNC: Stream #${streamId.toString()} cancelled — counter stopped. Employee received ${formatEth(
            employeeAmount
          )} ETH and Employer refund was ${formatEth(
            employerRefund
          )} ETH.`,
          "success"
        );
      } catch (error) {
        console.error(
          "StreamCancelled live sync error:",
          error
        );
      }
    }
  );

  liveSyncStarted = true;

  console.log(
    "StreamPay live event synchronization started."
  );
}

// -------------------------------------------------------
// COMMON PAGE HEADER
// -------------------------------------------------------

function renderShell(role, content) {
  app.innerHTML = `
    <main class="shell">

      <header class="header">

        <div class="brand">
          <h1>StreamPay</h1>
          <p>Corporate Micro-Salary & Vesting Protocol</p>

          <div class="contract-info">
            Contract: ${CONTRACT_ADDRESS}
          </div>
        </div>

        <div class="wallet-info">

          <div class="wallet-address">
            ${shortAddress(currentAccount)}
          </div>

          <div class="network">
            Anvil Local • Chain 31337
          </div>

          <div class="role-badge">
            ${role}
          </div>

          <div class="top-actions">
            <button
              id="refreshButton"
              class="refresh-button"
            >
              Refresh
            </button>
          </div>

        </div>

      </header>

      <div id="message" class="message"></div>

      ${content}

    </main>
  `;

  document
    .querySelector("#refreshButton")
    ?.addEventListener("click", async () => {
      await renderForCurrentAccount();
    });
}

// -------------------------------------------------------
// WRONG NETWORK PAGE
// -------------------------------------------------------

function renderWrongNetwork() {
  clearTicker();

  app.innerHTML = `
    <main class="shell">

      <div class="card">

        <h1>Wrong MetaMask Network</h1>

        <p>
          StreamPay requires the Anvil Local network.
        </p>

        <p>
          Required Chain ID:
          <strong>31337</strong>
        </p>

        <button
          id="switchNetworkButton"
          class="primary-button"
        >
          Switch to Anvil Local
        </button>

      </div>

    </main>
  `;

  document
    .querySelector("#switchNetworkButton")
    .addEventListener("click", switchToAnvil);
}

async function switchToAnvil() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [
        {
          chainId: "0x7A69",
        },
      ],
    });

    window.location.reload();
  } catch (error) {
    if (error.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x7A69",
            chainName: "Anvil Local",

            nativeCurrency: {
              name: "Ether",
              symbol: "ETH",
              decimals: 18,
            },

            rpcUrls: [RPC_URL],
          },
        ],
      });

      window.location.reload();
    } else {
      alert(getErrorMessage(error));
    }
  }
}

// -------------------------------------------------------
// ADMIN DASHBOARD
// -------------------------------------------------------

async function renderAdmin() {
  clearTicker();

  const fees = await contract.adminWithdrawable();

  renderShell(
    "Protocol Admin",
    `
      <h2 class="dashboard-title">
        Protocol Admin Dashboard
      </h2>

      <p class="dashboard-subtitle">
        Manage the protocol fee balance collected from salary settlements.
      </p>

      <div class="grid">

        <section class="card">

          <h2>Accumulated Protocol Fees</h2>

          <div class="big-balance">
            ${formatEth(fees)} ETH
          </div>

          <p>
            StreamPay deducts a 1% protocol fee from vested
            salary settlements.
          </p>

          <button
            id="claimFeesButton"
            class="primary-button"
            ${fees === 0n ? "disabled" : ""}
          >
            Claim Admin Fees
          </button>

        </section>

        <section class="card">

          <h2>Protocol Information</h2>

          <div class="stat">
            <div class="stat-name">Admin Wallet</div>
            <div class="small-value">
              ${currentAccount}
            </div>
          </div>

          <div class="stat">
            <div class="stat-name">Network</div>
            <div class="small-value">
              Anvil Local
            </div>
          </div>

          <div class="stat">
            <div class="stat-name">Chain ID</div>
            <div class="small-value">
              31337
            </div>
          </div>

          <div class="stat">
            <div class="stat-name">Protocol Fee</div>
            <div class="small-value">
              1%
            </div>
          </div>

        </section>

      </div>
    `
  );

  document
    .querySelector("#claimFeesButton")
    ?.addEventListener("click", claimAdminFees);
}

async function claimAdminFees() {
  try {
    setMessage(
      "Waiting for MetaMask confirmation...",
      "info"
    );

    const tx = await contract.claimAdminFees();

    setMessage(
      "Transaction submitted. Waiting for confirmation...",
      "info"
    );

    await tx.wait();

    setMessage(
      "Admin fees claimed successfully.",
      "success"
    );

    await renderForCurrentAccount();
  } catch (error) {
    setMessage(
      getErrorMessage(error),
      "error"
    );
  }
}

// -------------------------------------------------------
// EMPLOYER DASHBOARD
// -------------------------------------------------------

async function renderEmployer(companyId) {
  clearTicker();

  const ids =
    await contract.getEmployerStreamIds(
      currentAccount
    );

  const streams = await Promise.all(
    ids.map((id) => contract.getStream(id))
  );

  let streamHTML = "";

  if (streams.length === 0) {
    streamHTML = `
      <div class="empty-state">
        No salary streams created yet.
      </div>
    `;
  } else {
    streamHTML = streams
      .map((stream) => {
        const active =
          Number(stream.status) === 0;

        return `
          <div class="stream-card">

            <div class="stream-heading">

              <div class="stream-id">
                Stream #${stream.id}
              </div>

              <strong class="${
                active
                  ? "status-active"
                  : "status-closed"
              }">
                ${active ? "ACTIVE" : "CLOSED"}
              </strong>

            </div>

            <div class="stream-grid">

              <div>
                <div class="stat-name">
                  Employee
                </div>

                <div class="small-value">
                  ${shortAddress(stream.employee)}
                </div>
              </div>

              <div>
                <div class="stat-name">
                  Total Salary
                </div>

                <div class="small-value">
                  ${formatEth(
                    stream.totalDeposit,
                    4
                  )} ETH
                </div>
              </div>

              <div>
                <div class="stat-name">
                  Duration
                </div>

                <div class="small-value">
                  ${stream.duration} seconds
                </div>
              </div>

              <div>
                <div class="stat-name">
                  Gross Settled
                </div>

                <div class="small-value">
                  ${formatEth(
                    stream.totalWithdrawn,
                    4
                  )} ETH
                </div>
              </div>

              <div>
                <div class="stat-name">
                  Protocol Fee
                </div>

                <div class="small-value">
                  ${formatEth(
                    stream.totalFeeCharged,
                    4
                  )} ETH
                </div>
              </div>

              <div>
  <div class="stat-name">
    Employer Refund
  </div>

  <div class="small-value">
    ${
      Number(stream.status) === 1
        ? `${formatEth(
            stream.totalDeposit -
            stream.totalWithdrawn,
            6
          )} ETH`
        : "Pending"
    }
  </div>
</div>

              <div>
                <div class="stat-name">
                  Started
                </div>

                <div class="small-value">
                  ${new Date(
                    Number(stream.startTime) *
                      1000
                  ).toLocaleString()}
                </div>
              </div>

            </div>

            ${
              active
                ? `
                  <button
                    class="danger-button cancel-stream"
                    data-stream-id="${stream.id}"
                  >
                    Cancel Stream
                  </button>
                `
                : ""
            }

          </div>
        `;
      })
      .join("");
  }

  renderShell(
    "Employer",
    `
      <h2 class="dashboard-title">
        Employer Dashboard
      </h2>

      <p class="dashboard-subtitle">
        Company ID: ${companyId}
      </p>

      <div class="grid">

        <section class="card">

          <h2>Register Employee</h2>

          <p>
            An employee must be registered under your
            company before you can create a salary stream.
          </p>

          <form id="registerEmployeeForm">

            <label class="label">
              Employee Wallet Address
            </label>

            <input
              id="registerEmployeeAddress"
              type="text"
              placeholder="0x..."
              required
            />

            <button
              class="secondary-button"
              type="submit"
            >
              Register Employee
            </button>

          </form>

        </section>

        <section class="card">

          <h2>Create Salary Stream</h2>

          <form id="createStreamForm">

            <label class="label">
              Employee Wallet Address
            </label>

            <input
              id="streamEmployeeAddress"
              type="text"
              placeholder="0x..."
              required
            />

            <label class="label">
              Duration in Seconds
            </label>

            <input
              id="streamDuration"
              type="number"
              min="16"
              value="120"
              required
            />

            <label class="label">
              Salary Amount in ETH
            </label>

            <input
              id="streamAmount"
              type="number"
              min="0"
              step="0.001"
              placeholder="1"
              required
            />

            <button
              class="primary-button"
              type="submit"
            >
              Create Stream
            </button>

          </form>

        </section>

        <section class="card full">

          <h2>Outgoing Streams</h2>

          <div class="stream-list">
            ${streamHTML}
          </div>

        </section>

      </div>
    `
  );

  document
    .querySelector("#registerEmployeeForm")
    .addEventListener(
      "submit",
      registerEmployee
    );

  document
    .querySelector("#createStreamForm")
    .addEventListener(
      "submit",
      createStream
    );

  document
    .querySelectorAll(".cancel-stream")
    .forEach((button) => {
      button.addEventListener(
        "click",
        cancelStream
      );
    });
}

// -------------------------------------------------------
// NEW / UNASSIGNED WALLET
// -------------------------------------------------------

function renderNewWallet() {
  clearTicker();

  renderShell(
    "No role yet",
    `
      <h2 class="dashboard-title">
        StreamPay Wallet Setup
      </h2>

      <p class="dashboard-subtitle">
        This address is not yet an Admin, Employer,
        or Employee with an active/incoming stream.
      </p>

      <div class="grid">

        <section class="card">

          <h2>Set Up Employer</h2>

          <p>
            To become an Employer, register your first
            Employee. StreamPay will automatically create
            your Company ID.
          </p>

          <form id="firstEmployeeForm">

            <label class="label">
              Employee Wallet Address
            </label>

            <input
              id="firstEmployeeAddress"
              type="text"
              placeholder="0x..."
              required
            />

            <button
              type="submit"
              class="primary-button"
            >
              Register First Employee
            </button>

          </form>

        </section>

        <section class="card">

          <h2>Employee Wallet?</h2>

          <p>
            Employee access appears automatically after an
            Employer creates a salary stream for this wallet.
          </p>

        </section>

      </div>
    `
  );

  document
    .querySelector("#firstEmployeeForm")
    .addEventListener(
      "submit",
      registerFirstEmployee
    );
}

// -------------------------------------------------------
// EMPLOYER TRANSACTIONS
// -------------------------------------------------------

async function registerFirstEmployee(event) {
  event.preventDefault();

  const employee =
    document
      .querySelector("#firstEmployeeAddress")
      .value.trim();

  await executeRegisterEmployee(employee);
}

async function registerEmployee(event) {
  event.preventDefault();

  const employee =
    document
      .querySelector(
        "#registerEmployeeAddress"
      )
      .value.trim();

  await executeRegisterEmployee(employee);
}

async function executeRegisterEmployee(employee) {
  try {
    if (!ethers.isAddress(employee)) {
      throw new Error(
        "Please enter a valid Ethereum address."
      );
    }

    setMessage(
      "Please confirm employee registration in MetaMask.",
      "info"
    );

    const tx =
      await contract.registerEmployee(employee);

    setMessage(
      "Registration transaction submitted...",
      "info"
    );

    await tx.wait();

    await renderForCurrentAccount();

    setMessage(
      "Employee registered successfully.",
      "success"
    );
  } catch (error) {
    setMessage(
      getErrorMessage(error),
      "error"
    );
  }
}

async function createStream(event) {
  event.preventDefault();

  try {
    const employee =
      document
        .querySelector(
          "#streamEmployeeAddress"
        )
        .value.trim();

    const duration =
      Number(
        document.querySelector(
          "#streamDuration"
        ).value
      );

    const amount =
      document
        .querySelector("#streamAmount")
        .value.trim();

    if (!ethers.isAddress(employee)) {
      throw new Error(
        "Please enter a valid Employee address."
      );
    }

    if (!Number.isInteger(duration) ||
        duration <= 15) {
      throw new Error(
        "Duration must be greater than 15 seconds."
      );
    }

    if (!amount || Number(amount) <= 0) {
      throw new Error(
        "ETH amount must be greater than zero."
      );
    }

    setMessage(
      "Please confirm stream creation in MetaMask.",
      "info"
    );

    const tx =
      await contract.createStream(
        employee,
        duration,
        {
          value: ethers.parseEther(amount),
        }
      );

    setMessage(
      "Stream transaction submitted. Waiting for confirmation...",
      "info"
    );

    await tx.wait();

    await renderForCurrentAccount();

    setMessage(
      "Salary stream created successfully.",
      "success"
    );
  } catch (error) {
    setMessage(
      getErrorMessage(error),
      "error"
    );
  }
}

async function cancelStream(event) {
  const streamId =
    event.currentTarget.dataset.streamId;

  const confirmed = window.confirm(
    `Cancel Stream #${streamId}?`
  );

  if (!confirmed) return;

  try {
    setMessage(
      "Please confirm cancellation in MetaMask.",
      "info"
    );

    const tx =
      await contract.cancelStream(streamId);

    setMessage(
      "Cancellation submitted...",
      "info"
    );

    await tx.wait();

    await renderForCurrentAccount();

    setMessage(
      `Stream #${streamId} cancelled successfully.`,
      "success"
    );
  } catch (error) {
    setMessage(
      getErrorMessage(error),
      "error"
    );
  }
}

// -------------------------------------------------------
// EMPLOYEE DASHBOARD
// -------------------------------------------------------

async function renderEmployee(ids) {
  clearTicker();

  await syncBlockchainClock();

  const streams = await Promise.all(
    ids.map((id) => contract.getStream(id))
  );

  const streamHTML = streams
    .map((stream) => {
      const active =
        Number(stream.status) === 0;

      return `
        <div class="stream-card">

          <div class="stream-heading">

            <div class="stream-id">
              Stream #${stream.id}
            </div>

            <strong class="${
              active
                ? "status-active"
                : "status-closed"
            }">
              ${active ? "ACTIVE" : "CLOSED"}
            </strong>

          </div>

          <div class="stream-grid">

            <div>
              <div class="stat-name">
                Employer
              </div>

              <div class="small-value">
                ${shortAddress(stream.employer)}
              </div>
            </div>

            <div>
              <div class="stat-name">
                Total Salary
              </div>

              <div class="small-value">
                ${formatEth(
                  stream.totalDeposit,
                  4
                )} ETH
              </div>
            </div>

            <div>
              <div class="stat-name">
                Duration
              </div>

              <div class="small-value">
                ${stream.duration} seconds
              </div>
            </div>

            <div>
              <div class="stat-name">
                Gross Withdrawn / Settled
              </div>

              <div class="small-value">
                ${formatEth(
                  stream.totalWithdrawn,
                  6
                )} ETH
              </div>
            </div>

            <div>
              <div class="stat-name">
                Protocol Fee Charged
              </div>

              <div class="small-value">
                ${formatEth(
                  stream.totalFeeCharged,
                  6
                )} ETH
              </div>
            </div>

            <div>
              <div class="stat-name">
                Start Time
              </div>

              <div class="small-value">
                ${new Date(
                  Number(stream.startTime) *
                    1000
                ).toLocaleString()}
              </div>
            </div>

          </div>

          <div class="claimable">

            <div class="stat-name">
              Claimable Now (Gross)
            </div>

            <div
              id="gross-${stream.id}"
              class="claimable-number"
            >
              0.000000 ETH
            </div>

            <div class="stat">
              <div class="stat-name">
                Estimated Protocol Fee
              </div>

              <div
                id="fee-${stream.id}"
                class="small-value"
              >
                0.000000 ETH
              </div>
            </div>

            <div class="stat">
              <div class="stat-name">
                Estimated Net Employee Amount
              </div>

              <div
                id="net-${stream.id}"
                class="small-value"
              >
                0.000000 ETH
              </div>
            </div>

            <div class="progress">

              <div
                id="progress-${stream.id}"
                class="progress-bar"
              ></div>

            </div>

          </div>

          ${
            active
              ? `
                <button
                  class="primary-button withdraw-stream"
                  data-stream-id="${stream.id}"
                >
                  Withdraw Vested Funds
                </button>

                <button
                  class="danger-button employee-cancel-stream"
                  data-stream-id="${stream.id}"
                >
                  Cancel Stream
                </button>
              `
              : ""
          }

        </div>
      `;
    })
    .join("");

  renderShell(
    "Employee",
    `
      <h2 class="dashboard-title">
        Employee Dashboard
      </h2>

      <p class="dashboard-subtitle">
        Your vested salary is calculated locally every second.
      </p>

      <section class="card">

        <h2>Incoming Salary Streams</h2>

        <div class="stream-list">
          ${streamHTML}
        </div>

      </section>
    `
  );

  document
    .querySelectorAll(".withdraw-stream")
    .forEach((button) => {
      button.addEventListener(
        "click",
        withdrawStream
      );
    });

  document
    .querySelectorAll(
      ".employee-cancel-stream"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        cancelStream
      );
    });

updateEmployeeCounters(streams);

/*
  Only start the second-by-second ticker if at least
  one stream is still ACTIVE.
*/
const hasActiveStream =
  streams.some(
    (stream) =>
      Number(stream.status) === 0
  );

if (hasActiveStream) {
  tickingInterval = setInterval(() => {
    updateEmployeeCounters(streams);
  }, 1000);
}
}

// -------------------------------------------------------
// LOCAL SECOND-BY-SECOND VESTING ENGINE
// -------------------------------------------------------

function updateEmployeeCounters(streams) {
  const now =
    BigInt(currentBlockchainTime());

  for (const stream of streams) {
    const streamId =
      stream.id.toString();

    const grossElement =
      document.querySelector(
        `#gross-${streamId}`
      );

    const feeElement =
      document.querySelector(
        `#fee-${streamId}`
      );

    const netElement =
      document.querySelector(
        `#net-${streamId}`
      );

    const progressElement =
      document.querySelector(
        `#progress-${streamId}`
      );

    if (!grossElement) continue;

    if (Number(stream.status) !== 0) {
      grossElement.textContent =
        "0.000000 ETH";

      feeElement.textContent =
        "0.000000 ETH";

      netElement.textContent =
        "0.000000 ETH";

      progressElement.style.width =
        "100%";

      continue;
    }

    let elapsed = 0n;

    if (now > stream.startTime) {
      elapsed =
        now - stream.startTime;
    }

    if (elapsed > stream.duration) {
      elapsed = stream.duration;
    }

    // -------------------------------------------------
    // EXACT SAME INTEGER FORMULA AS SOLIDITY:
    //
    // unlocked =
    // totalDeposit * elapsed / duration
    // -------------------------------------------------

    const unlocked =
      (
        stream.totalDeposit *
        elapsed
      ) /
      stream.duration;

    let grossClaimable = 0n;

    if (
      unlocked >
      stream.totalWithdrawn
    ) {
      grossClaimable =
        unlocked -
        stream.totalWithdrawn;
    }

    const newGrossSettled =
      stream.totalWithdrawn +
      grossClaimable;

    const totalFeeRequired =
      newGrossSettled / 100n;

    let newFee = 0n;

    if (
      totalFeeRequired >
      stream.totalFeeCharged
    ) {
      newFee =
        totalFeeRequired -
        stream.totalFeeCharged;
    }

    const netClaimable =
      grossClaimable - newFee;

    grossElement.textContent =
      `${formatEth(
        grossClaimable
      )} ETH`;

    feeElement.textContent =
      `${formatEth(newFee)} ETH`;

    netElement.textContent =
      `${formatEth(
        netClaimable
      )} ETH`;

    const progressBasisPoints =
      (
        elapsed *
        10000n
      ) /
      stream.duration;

    const progress =
      Number(progressBasisPoints) /
      100;

    progressElement.style.width =
      `${Math.min(progress, 100)}%`;
  }
}

// -------------------------------------------------------
// EMPLOYEE WITHDRAWAL
// -------------------------------------------------------

async function withdrawStream(event) {
  const streamId =
    event.currentTarget.dataset.streamId;

  try {
    setMessage(
      "Please confirm withdrawal in MetaMask.",
      "info"
    );

    const tx =
      await contract.withdraw(streamId);

    setMessage(
      "Withdrawal submitted. Waiting for confirmation...",
      "info"
    );

    await tx.wait();

    await renderForCurrentAccount();

    setMessage(
      `Stream #${streamId} withdrawal completed.`,
      "success"
    );
  } catch (error) {
    setMessage(
      getErrorMessage(error),
      "error"
    );
  }
}

// -------------------------------------------------------
// ROLE DETECTION
// -------------------------------------------------------

async function renderForCurrentAccount() {
  clearTicker();

  await syncBlockchainClock();

  const [
    adminAddress,
    companyId,
    incomingStreamIds,
  ] = await Promise.all([
    contract.admin(),

    contract.companyIdOf(
      currentAccount
    ),

    contract.getEmployeeStreamIds(
      currentAccount
    ),
  ]);

  if (
    adminAddress.toLowerCase() ===
    currentAccount.toLowerCase()
  ) {
    await renderAdmin();
    return;
  }

  if (companyId > 0n) {
    await renderEmployer(companyId);
    return;
  }

  if (incomingStreamIds.length > 0) {
    await renderEmployee(
      incomingStreamIds
    );

    return;
  }

  renderNewWallet();
}

// -------------------------------------------------------
// METAMASK CONNECTION
// -------------------------------------------------------

async function connectStreamPay() {
  clearTicker();

  if (!window.ethereum) {
    app.innerHTML = `
      <div class="loading-screen">

        <h1>MetaMask Required</h1>

        <p>
          Please install and enable MetaMask in Chrome.
        </p>

      </div>
    `;

    return;
  }

  try {
    await window.ethereum.request({
      method: "eth_requestAccounts",
    });

    provider =
      new ethers.BrowserProvider(
        window.ethereum
      );

    const network =
      await provider.getNetwork();

    if (
      network.chainId !==
      REQUIRED_CHAIN_ID
    ) {
      renderWrongNetwork();
      return;
    }

    signer =
      await provider.getSigner();

    currentAccount =
      await signer.getAddress();

contract =
  new ethers.Contract(
    CONTRACT_ADDRESS,
    streamPayArtifact.abi,
    signer
  );

await renderForCurrentAccount();

/*
  Begin listening for StreamPay events from Anvil.
*/
await setupLiveEventSync();
  } catch (error) {
    app.innerHTML = `
      <div class="loading-screen">

        <h1>Connection Error</h1>

        <p>
          ${getErrorMessage(error)}
        </p>

      </div>
    `;
  }
}

// -------------------------------------------------------
// METAMASK LIVE ACCOUNT / NETWORK CHANGES
// -------------------------------------------------------

if (window.ethereum) {
  window.ethereum.on(
    "accountsChanged",
    async () => {
      await connectStreamPay();
    }
  );

  window.ethereum.on(
    "chainChanged",
    () => {
      window.location.reload();
    }
  );
}

// -------------------------------------------------------
// START APP
// -------------------------------------------------------

connectStreamPay();