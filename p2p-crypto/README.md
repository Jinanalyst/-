# PeerSwap – P2P crypto marketplace (demo)

Open `index.html` in a browser, or run `npx serve p2p-crypto`. No build step or backend.

- **Market**: Buy/Sell tabs, coin + currency + payment-method + amount filters, best price first.
- **Trade room**: escrow steps, 15-minute payment timer, chat, "I've paid" / "Release" / "Cancel".
- **Post offer**: publish your own buy or sell ad (sell ads lock your coins until removed).
- **My orders / Wallet**: trade history, balances, escrow, demo faucet, reset.

This is a simulation: prices are fixed, counterparties are bots, and data lives in `localStorage`.
A real platform needs a backend, KYC/AML, custody or smart-contract escrow, dispute handling and live price feeds.
