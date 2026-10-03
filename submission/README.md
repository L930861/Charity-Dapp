# SC6113 required submission files

| Required item | File in this folder | Role |
|---|---|---|
| Solidity | `CharityFund.sol` | Escrow, donation, withdrawal and refund rules |
| ABI | `CharityFundABI.json` | Contract interface used by the server and browser |
| Python Flask | `app.py` | Render API and static frontend server |
| HTML | `index.html` | Vite/React document entry |
| CSS | `style.css` | Responsive visual design |
| JavaScript | `app.js` | React JavaScript/JSX application and MetaMask integration |
| Render link | `render-link.txt` | Public Sepolia deployment URL |

The JavaScript source contains JSX and is compiled by Vite. The production
Docker image builds this source, then Gunicorn runs the Flask application.
MetaMask signs transactions in the visitor's browser; Flask never receives a
private key. The complete reproducible project, tests and deployment files are
in the repository root.
