import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserProvider,
  Contract,
  ContractFactory,
  formatEther,
  isAddress,
  parseEther,
} from "ethers";
import "./styles.css";

const categories = [
  "Water & wellbeing",
  "Education",
  "Health",
  "Emergency relief",
];
const short = (value) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "";
const money = (value) =>
  Number(value).toLocaleString("en", { maximumFractionDigits: 5 });
const utf8 = (value) => new TextEncoder().encode(value).length;
async function api(path) {
  const res = await fetch("/api/" + path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}
function explain(error) {
  if (error.code === 4001 || error.code === "ACTION_REJECTED")
    return "You declined the wallet request. No action was completed.";
  if (error.code === "INSUFFICIENT_FUNDS")
    return "Your wallet needs enough test ETH for the amount and the network fee.";
  return (
    error.reason ||
    error.shortMessage ||
    error.message ||
    "The transaction could not be completed."
  );
}
function App() {
  const [config, setConfig] = useState(null),
    [items, setItems] = useState([]),
    [total, setTotal] = useState(0);
  const [account, setAccount] = useState(""),
    [chain, setChain] = useState(0),
    [tab, setTab] = useState("Explore");
  const [selected, setSelected] = useState(null),
    [history, setHistory] = useState(null),
    [contribution, setContribution] = useState("0");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(false),
    [tx, setTx] = useState(null);
  const [loading, setLoading] = useState(true),
    [filter, setFilter] = useState("All causes"),
    [amount, setAmount] = useState("0.01");
  const [manifest, setManifest] = useState(null);
  const wrongNetwork = !!account && !!config && chain !== config.chainId;

  async function refresh() {
    const [c, list] = await Promise.all([
      api("config"),
      api("campaigns?limit=50"),
    ]);
    setConfig(c);
    setItems(list.items);
    setTotal(list.total);
    if (selected) {
      const current = await api("campaigns/" + selected.id);
      setSelected((previous) =>
        previous?.id === current.id ? current : previous,
      );
    }
  }
  useEffect(() => {
    refresh()
      .catch((e) => setError(explain(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!window.ethereum) return;
    const accountsChanged = (accounts) => {
      setAccount(accounts[0] || "");
      setContribution("0");
      setHistory(null);
    };
    const chainChanged = (id) => {
      setChain(Number(id));
      setContribution("0");
    };
    window.ethereum
      .request({ method: "eth_accounts" })
      .then(accountsChanged)
      .catch(() => {});
    window.ethereum
      .request({ method: "eth_chainId" })
      .then(chainChanged)
      .catch(() => {});
    window.ethereum.on?.("accountsChanged", accountsChanged);
    window.ethereum.on?.("chainChanged", chainChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", accountsChanged);
      window.ethereum.removeListener?.("chainChanged", chainChanged);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    if (account && config && selected && chain === config.chainId) {
      const provider = new BrowserProvider(window.ethereum);
      new Contract(config.address, config.abi, provider)
        .contributions(selected.id, account)
        .then((v) => {
          if (alive) setContribution(formatEther(v));
        })
        .catch((e) => {
          if (alive) setError(explain(e));
        });
    } else setContribution("0");
    return () => {
      alive = false;
    };
  }, [account, chain, config, selected]);
  useEffect(() => {
    let alive = true;
    if (tab === "My activity" && account)
      api("history?account=" + account)
        .then((h) => {
          if (alive) setHistory(h);
        })
        .catch((e) => {
          if (alive) setError(explain(e));
        });
    return () => {
      alive = false;
    };
  }, [tab, account, tx]);

  async function connect() {
    setError("");
    try {
      if (!window.ethereum)
        throw new Error(
          "Install MetaMask, then open this site in the same browser.",
        );
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      setAccount(accounts[0] || "");
      setChain(
        Number(await window.ethereum.request({ method: "eth_chainId" })),
      );
    } catch (e) {
      setError(explain(e));
    }
  }
  async function switchNetwork(id = config.chainId) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + id.toString(16) }],
      });
      setChain(id);
    } catch (e) {
      if (e.code === 4902 && id === 31337) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x7a69",
                chainName: "ClearCause Local",
                nativeCurrency: {
                  name: "Test Ether",
                  symbol: "ETH",
                  decimals: 18,
                },
                rpcUrls: ["http://127.0.0.1:8545"],
              },
            ],
          });
          setChain(
            Number(await window.ethereum.request({ method: "eth_chainId" })),
          );
        } catch (err) {
          setError(explain(err));
        }
      } else if (e.code === 4902 && id === 11155111) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0xaa36a7",
                chainName: "Sepolia",
                nativeCurrency: {
                  name: "Sepolia Ether",
                  symbol: "ETH",
                  decimals: 18,
                },
                rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
                blockExplorerUrls: ["https://sepolia.etherscan.io"],
              },
            ],
          });
          setChain(
            Number(await window.ethereum.request({ method: "eth_chainId" })),
          );
        } catch (err) {
          setError(explain(err));
        }
      } else setError(explain(e));
    }
  }
  async function transact(action, done) {
    setError("");
    setNotice("");
    setTx(null);
    setPending(true);
    try {
      if (!account) throw new Error("Connect your wallet first.");
      const provider = new BrowserProvider(window.ethereum);
      if (Number((await provider.getNetwork()).chainId) !== config.chainId)
        throw new Error("Switch your wallet to " + config.networkName + ".");
      const signer = await provider.getSigner();
      setNotice("Review and confirm the request in MetaMask.");
      const sent = await action(
        new Contract(config.address, config.abi, signer),
      );
      setTx({ hash: sent.hash, state: "Pending" });
      setNotice("Transaction submitted. Waiting for a block confirmation.");
      let receipt;
      try {
        receipt = await sent.wait();
      } catch (e) {
        if (e.code === "TRANSACTION_REPLACED" && !e.cancelled)
          receipt = e.receipt;
        else throw e;
      }
      if (!receipt || receipt.status !== 1)
        throw new Error("Transaction reverted.");
      setTx({ hash: receipt.hash, state: "Confirmed" });
      setNotice("Confirmed on chain. Your transaction is recorded.");
      try {
        await refresh();
        done?.();
      } catch {
        setError(
          "Transaction confirmed, but the page could not refresh. Use Refresh or reload to query the latest chain state.",
        );
      }
    } catch (e) {
      setError(explain(e));
      setNotice("");
      setTx((previous) =>
        previous
          ? { ...previous, state: "Failed or cancelled; verify receipt" }
          : null,
      );
    } finally {
      setPending(false);
    }
  }
  function donate(event) {
    event.preventDefault();
    try {
      if (!/^\d+(\.\d{1,18})?$/.test(amount) || parseEther(amount) <= 0n)
        throw new Error(
          "Enter a positive ETH amount with no more than 18 decimal places.",
        );
    } catch (e) {
      setError(explain(e));
      return;
    }
    transact((c) => c.donate(selected.id, { value: parseEther(amount) }));
  }
  function create(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const title = values.title.trim(),
        description = values.description.trim();
      if (
        !title ||
        utf8(title) > 96 ||
        !description ||
        utf8(description) > 1600
      )
        throw new Error(
          "Title must be 1–96 UTF-8 bytes; description 1–1600 bytes.",
        );
      if (
        !isAddress(values.beneficiary) ||
        /^0x0{40}$/i.test(values.beneficiary) ||
        values.beneficiary.toLowerCase() === config.address.toLowerCase()
      )
        throw new Error(
          "Enter a valid beneficiary address, excluding zero and this contract.",
        );
      const goal = parseEther(values.goal);
      if (goal <= 0n) throw new Error("The target must be greater than zero.");
      const deadline = Math.floor(new Date(values.deadline).getTime() / 1000),
        now = Math.floor(Date.now() / 1000);
      if (
        !Number.isFinite(deadline) ||
        deadline <= now + 60 ||
        deadline > now + 364 * 86400
      )
        throw new Error(
          "Choose a deadline between one minute and 364 days from now.",
        );
      transact(
        (c) =>
          c.createCampaign(
            title,
            description,
            values.beneficiary,
            goal,
            deadline,
            Number(values.category),
          ),
        () => {
          setTab("Explore");
          setSelected(null);
        },
      );
    } catch (e) {
      setError(explain(e));
    }
  }
  async function deploySepolia() {
    setError("");
    setPending(true);
    try {
      if (!account) throw new Error("Connect MetaMask first.");
      const provider = new BrowserProvider(window.ethereum);
      if ((await provider.getNetwork()).chainId !== 11155111n)
        throw new Error("Switch MetaMask to Sepolia before deploying.");
      const artifact = await api("artifact");
      setNotice(
        "Approve the Sepolia deployment in MetaMask. Test ETH is required for gas.",
      );
      const c = await new ContractFactory(
        artifact.abi,
        artifact.bytecode,
        await provider.getSigner(),
      ).deploy();
      setTx({
        hash: c.deploymentTransaction().hash,
        state: "Pending Sepolia deployment",
      });
      const r = await c.deploymentTransaction().wait();
      const m = {
        chainId: 11155111,
        address: await c.getAddress(),
        blockNumber: r.blockNumber,
        transactionHash: r.hash,
        deployedAt: new Date().toISOString(),
      };
      setManifest(m);
      setNotice(
        "Sepolia contract deployed. Save the manifest and configure the backend as explained below.",
      );
      setTx({ hash: r.hash, state: "Confirmed on Sepolia" });
    } catch (e) {
      setError(explain(e));
      setNotice("");
    } finally {
      setPending(false);
    }
  }
  const shown = items.filter(
    (c) => filter === "All causes" || categories[c.category] === filter,
  );
  const go = (name) => {
    setTab(name);
    setSelected(null);
    setError("");
  };
  return (
    <>
      <header className="header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("Explore");
          }}
        >
          <span className="brand-mark">c</span>ClearCause
          <span className="brand-note">GIVING, MADE VISIBLE</span>
        </a>
        <nav aria-label="Main navigation">
          {["Explore", "My activity", "How it works"].map((name) => (
            <button
              key={name}
              className={tab === name ? "nav active" : "nav"}
              onClick={() => go(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        <button className="wallet" onClick={connect}>
          {account ? short(account) : "Connect wallet"}
        </button>
      </header>
      <div className="network-strip">
        <span>{config?.networkName || "Connecting"} · Test ETH only</span>
        <span>No platform fee · Network gas applies</span>
      </div>
      <main aria-busy={pending}>
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {wrongNetwork && (
          <div className="alert">
            Your wallet is on another network.{" "}
            <button onClick={() => switchNetwork()}>
              Switch to {config.networkName}
            </button>
          </div>
        )}
        {(notice || tx) && (
          <div className="alert success" role="status">
            {notice}
            {tx && (
              <div>
                <strong>{tx.state}</strong> ·{" "}
                {config?.explorer ? (
                  <a
                    href={`${config.explorer}/tx/${tx.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction
                  </a>
                ) : (
                  <code className="hash">{tx.hash}</code>
                )}
              </div>
            )}
          </div>
        )}
        {tab === "Explore" && !selected && (
          <>
            <section className="hero">
              <div>
                <p className="eyebrow">A CLEARER WAY TO CARE</p>
                <h1>
                  Small acts.
                  <br />
                  Visible impact.
                </h1>
                <p className="lead">
                  Support a cause. Follow your contribution.
                  <br />
                  Know when funds move, directly on chain.
                </p>
                <button
                  className="primary"
                  onClick={() => go("Create a campaign")}
                >
                  Start a campaign <span aria-hidden="true">↗</span>
                </button>
              </div>
              <div className="hero-panel">
                <div className="orbit" aria-hidden="true">
                  <span>YOU</span>
                  <b>+</b>
                  <span>A CAUSE</span>
                </div>
                <p>Every contribution has a trail.</p>
                <div className="flow">
                  <span>Give</span>
                  <i>→</i>
                  <span>Reach the goal</span>
                  <i>→</i>
                  <span>Release funds</span>
                </div>
                <small>
                  If a goal is missed by its deadline, donors can claim a
                  refund.
                </small>
              </div>
            </section>
            <section className="campaign-section">
              <div className="section-title">
                <div>
                  <p className="eyebrow">FIND YOUR CAUSE</p>
                  <h2>Good starts here.</h2>
                </div>
                <span>
                  {total} campaign{total !== 1 ? "s" : ""} on chain
                </span>
              </div>
              <div className="filters" aria-label="Filter campaigns">
                {["All causes", ...categories].map((name) => (
                  <button
                    key={name}
                    className={filter === name ? "chip selected" : "chip"}
                    onClick={() => setFilter(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {loading ? (
                <p role="status">Loading campaigns from the blockchain…</p>
              ) : !shown.length ? (
                <div className="empty">
                  <h3>No campaigns here yet.</h3>
                  <p>Create a campaign or choose another category.</p>
                </div>
              ) : (
                <div className="grid">
                  {shown.map((c) => (
                    <button
                      className="campaign-card"
                      key={c.id}
                      onClick={() => {
                        setSelected(c);
                        setAmount("0.01");
                      }}
                    >
                      <div
                        className={`cause-art art-${c.category}`}
                        aria-hidden="true"
                      >
                        <span>
                          {["WATER", "LEARN", "CARE", "RELIEF"][c.category]}
                        </span>
                        <div className="art-shape" />
                      </div>
                      <div className="card-body">
                        <div className="card-meta">
                          <span>{categories[c.category]}</span>
                          <span className={"status " + c.status.toLowerCase()}>
                            {c.status}
                          </span>
                        </div>
                        <h3>{c.title}</h3>
                        <p className="description">{c.description}</p>
                        <div
                          className="progress"
                          role="progressbar"
                          aria-label="Funding progress"
                          aria-valuenow={Math.min(
                            100,
                            Math.round(
                              (Number(c.raised) / Number(c.goal)) * 100,
                            ),
                          )}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <span
                            style={{
                              width:
                                Math.min(
                                  100,
                                  (Number(c.raised) / Number(c.goal)) * 100,
                                ) + "%",
                            }}
                          />
                        </div>
                        <div className="funding">
                          <strong>{money(c.raised)} ETH</strong>
                          <span>of {money(c.goal)} ETH</span>
                        </div>
                        <div className="card-bottom">
                          <span>
                            {c.status === "Active"
                              ? "Until " +
                                new Date(c.deadline * 1000).toLocaleDateString(
                                  "en-GB",
                                )
                              : c.status === "Refundable"
                                ? "Donor refunds available"
                                : c.status === "Paid"
                                  ? "Funds released"
                                  : "Ready for beneficiary"}
                          </span>
                          <span>View cause ↗</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {items.length < total && (
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      const next = await api(
                        "campaigns?limit=50&offset=" + items.length,
                      );
                      setItems((current) => [...current, ...next.items]);
                    } catch (e) {
                      setError(explain(e));
                    }
                  }}
                >
                  Load more campaigns
                </button>
              )}
            </section>
            <section className="principle">
              <h2>
                Trust the record.
                <br />
                Research the cause.
              </h2>
              <p>
                ClearCause makes the movement of funds visible. Campaigns are
                permissionless and are not independently verified. Read the
                details and check the beneficiary before giving.
              </p>
            </section>
          </>
        )}
        {tab === "Explore" && selected && (
          <section>
            <button className="back" onClick={() => setSelected(null)}>
              ← All campaigns
            </button>
            <div className="detail-grid">
              <article>
                <p className="eyebrow">{categories[selected.category]}</p>
                <h1 className="detail-title">{selected.title}</h1>
                <span className={"status " + selected.status.toLowerCase()}>
                  {selected.status}
                </span>
                <p className="story">{selected.description}</p>
                <h3>Campaign details</h3>
                <dl>
                  <dt>Beneficiary</dt>
                  <dd className="hash">{selected.beneficiary}</dd>
                  <dt>Creator</dt>
                  <dd className="hash">{selected.creator}</dd>
                  <dt>Deadline</dt>
                  <dd>{new Date(selected.deadline * 1000).toLocaleString()}</dd>
                  <dt>Refunded to donors</dt>
                  <dd>{money(selected.refunded)} ETH</dd>
                  <dt>Campaign ID</dt>
                  <dd>#{selected.id}</dd>
                </dl>
                <p className="muted">
                  Descriptions and wallet addresses are public on chain. No
                  charity verification or tax receipt is provided.
                </p>
              </article>
              <aside className="donation-panel">
                <p className="eyebrow">FUNDED SO FAR</p>
                <p className="big-number">
                  {money(selected.raised)} <span>ETH</span>
                </p>
                <p>of {money(selected.goal)} ETH goal</p>
                <div className="progress">
                  <span
                    style={{
                      width:
                        Math.min(
                          100,
                          (Number(selected.raised) / Number(selected.goal)) *
                            100,
                        ) + "%",
                    }}
                  />
                </div>
                {selected.status === "Active" && (
                  <form onSubmit={donate}>
                    <label htmlFor="amount">Your contribution (ETH)</label>
                    <input
                      id="amount"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                    />
                    <div className="presets">
                      {["0.01", "0.05", "0.1"].map((a) => (
                        <button
                          type="button"
                          key={a}
                          onClick={() => setAmount(a)}
                        >
                          {a} ETH
                        </button>
                      ))}
                    </div>
                    <button
                      className="primary full"
                      disabled={pending || wrongNetwork}
                      type="submit"
                    >
                      {pending ? "Processing…" : "Donate with MetaMask"}
                    </button>
                    <small>
                      Test ETH only. Your wallet shows the gas fee before you
                      confirm. The final donation may exceed the target.
                    </small>
                  </form>
                )}
                {selected.status === "Funded" && (
                  <>
                    <p>
                      The target has been reached. Only the designated
                      beneficiary can release the funds.
                    </p>
                    <button
                      className="primary full"
                      disabled={
                        pending ||
                        wrongNetwork ||
                        account.toLowerCase() !==
                          selected.beneficiary.toLowerCase()
                      }
                      onClick={() => transact((c) => c.withdraw(selected.id))}
                    >
                      Withdraw funds
                    </button>
                  </>
                )}
                {selected.status === "Refundable" && (
                  <>
                    <p>The deadline passed before the target was met.</p>
                    <p>
                      Your refundable contribution:{" "}
                      <strong>{money(contribution)} ETH</strong>
                    </p>
                    <button
                      className="primary full"
                      disabled={
                        pending || wrongNetwork || Number(contribution) === 0
                      }
                      onClick={() => transact((c) => c.refund(selected.id))}
                    >
                      Claim refund
                    </button>
                  </>
                )}
                {selected.status === "Paid" && (
                  <p>
                    Funds have been released to the beneficiary. No further
                    donations or refunds are available.
                  </p>
                )}
                {!account && (
                  <button className="secondary full" onClick={connect}>
                    Connect wallet
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() => refresh().catch((e) => setError(explain(e)))}
                >
                  Refresh on-chain status
                </button>
              </aside>
            </div>
          </section>
        )}
        {tab === "Create a campaign" && (
          <section className="form-page">
            <p className="eyebrow">BUILD SOMETHING GOOD</p>
            <h1>Create a campaign</h1>
            <p className="lead">
              Set a clear goal and a beneficiary. These details become permanent
              on chain.
            </p>
            <form onSubmit={create} className="create-form">
              <label>
                Campaign title
                <input
                  name="title"
                  maxLength={96}
                  required
                  placeholder="A specific goal for a community"
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  rows={5}
                  maxLength={1600}
                  required
                  placeholder="Explain the purpose, use of funds and who benefits. Do not include private information."
                />
              </label>
              <label>
                Beneficiary wallet
                <input
                  name="beneficiary"
                  required
                  placeholder="0x…"
                  defaultValue={account}
                />
              </label>
              <div className="form-row">
                <label>
                  Target (ETH)
                  <input
                    name="goal"
                    inputMode="decimal"
                    required
                    placeholder="1.0"
                  />
                </label>
                <label>
                  Deadline (your local time)
                  <input name="deadline" type="datetime-local" required />
                </label>
              </div>
              <label>
                Category
                <select name="category">
                  {categories.map((c, i) => (
                    <option value={i} key={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                Title: maximum 96 UTF-8 bytes. Description: maximum 1600 bytes.
                Campaigns cannot be edited or cancelled. If funded, the
                beneficiary may withdraw immediately; otherwise donors may
                refund after the deadline.
              </p>
              <button
                type="submit"
                className="primary"
                disabled={pending || wrongNetwork}
              >
                {pending ? "Processing…" : "Create on chain"}
              </button>
            </form>
          </section>
        )}
        {tab === "My activity" && (
          <section>
            <p className="eyebrow">YOUR ON-CHAIN FOOTPRINT</p>
            <h1>Giving, recorded.</h1>
            {!account ? (
              <div className="empty">
                <p>Connect your wallet to see its recorded activity.</p>
                <button className="primary" onClick={connect}>
                  Connect wallet
                </button>
              </div>
            ) : (
              <>
                <p className="hash muted">{account}</p>
                <button
                  className="secondary"
                  onClick={() =>
                    api("history?account=" + account)
                      .then(setHistory)
                      .catch((e) => setError(explain(e)))
                  }
                >
                  Refresh history
                </button>
                {!history ? (
                  <p>Loading activity…</p>
                ) : (
                  <>
                    <p className="muted">
                      Latest {history.items.length} of {history.total} matching
                      events in blocks {history.fromBlock}–{history.toBlock}. At
                      most 100 events from the latest 10,000 blocks.
                      Confirmation counts are not finality guarantees.
                    </p>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Action</th>
                            <th>Campaign</th>
                            <th>Amount</th>
                            <th>Transaction</th>
                            <th>Confirmations</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.items.map((r) => (
                            <tr key={r.hash + ":" + r.logIndex}>
                              <td>{r.type}</td>
                              <td>#{r.campaignId}</td>
                              <td>
                                {r.amount ? money(r.amount) + " ETH" : "—"}
                              </td>
                              <td>
                                {config.explorer ? (
                                  <a
                                    href={`${config.explorer}/tx/${r.hash}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {short(r.hash)} ↗
                                  </a>
                                ) : (
                                  <span title={r.hash}>{short(r.hash)}</span>
                                )}
                              </td>
                              <td>{r.confirmations}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!history.items.length && (
                        <p className="empty">
                          No matching activity in this block window.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )}
        {tab === "How it works" && (
          <section className="guide">
            <p className="eyebrow">TRANSPARENT BY DESIGN</p>
            <h1>
              A simple promise,
              <br />
              written in a contract.
            </h1>
            {[
              [
                "01",
                "Choose a cause",
                "Read the description, target, deadline and beneficiary address. Anyone can create a campaign; do your own checks.",
              ],
              [
                "02",
                "Give through your wallet",
                "Connect MetaMask on the configured network. Approve a donation and wait for the transaction confirmation.",
              ],
              [
                "03",
                "A goal determines the outcome",
                "When donations reach the target, the beneficiary can withdraw. If the deadline passes below target, each donor can claim their contribution back. Gas fees are not refunded.",
              ],
            ].map(([n, title, body]) => (
              <div className="guide-row" key={n}>
                <span>{n}</span>
                <div>
                  <h2>{title}</h2>
                  <p>{body}</p>
                </div>
              </div>
            ))}
            <h2>What this prototype does not verify</h2>
            <p>
              It does not validate charitable status, guarantee how withdrawn
              funds are spent, issue tax receipts, or provide a dispute process.
              Blockchain records are public and persistent. This coursework
              application is intended for local development and Sepolia test ETH
              only.
            </p>
            <button className="secondary" onClick={() => go("Deployment")}>
              Sepolia deployment helper
            </button>
          </section>
        )}
        {tab === "Deployment" && (
          <section className="form-page">
            <h1>Deploy with your wallet</h1>
            <p>
              Connect MetaMask, select Sepolia and obtain test ETH. This helper
              deploys the compiled coursework contract without sharing a private
              key.
            </p>
            <button
              className="secondary"
              onClick={() => switchNetwork(11155111)}
            >
              Switch to Sepolia
            </button>{" "}
            <button
              className="primary"
              disabled={pending}
              onClick={deploySepolia}
            >
              Deploy CharityFund
            </button>
            {manifest && (
              <>
                <h2>Deployment manifest</h2>
                <textarea
                  rows={9}
                  readOnly
                  value={JSON.stringify(manifest, null, 2)}
                />
                <button
                  className="secondary"
                  onClick={() => {
                    const u = URL.createObjectURL(
                      new Blob([JSON.stringify(manifest, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = u;
                    a.download = "11155111.json";
                    a.click();
                    URL.revokeObjectURL(u);
                  }}
                >
                  Download manifest
                </button>
              </>
            )}
            <p>
              Save the manifest as <code>deployments/11155111.json</code>. Set{" "}
              <code>CHAIN_ID=11155111</code> and your Sepolia{" "}
              <code>RPC_URL</code> in <code>.env</code>, then restart the
              backend. See README for details. No Sepolia deployment is claimed
              until a confirmed manifest exists.
            </p>
          </section>
        )}
      </main>
      <footer>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("Explore");
          }}
        >
          ClearCause
        </a>
        <p>SC6113 · Financial DApp coursework</p>
        <span>Transparent giving. Test networks only.</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);\n
