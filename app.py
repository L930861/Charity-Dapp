"""ClearCause Flask server for the Render deployment.

The browser signs every state-changing transaction with MetaMask.  This server
only serves the compiled interface and reads public Ethereum data.
"""

from __future__ import annotations

import json
import os
import re
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional, Union

from eth_utils import event_abi_to_log_topic
from flask import Flask, jsonify, request, send_from_directory
from web3 import Web3
from web3._utils.events import get_event_data


ROOT = Path(__file__).resolve().parent
STATUSES = ("Active", "Funded", "Paid", "Refundable")
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


def _decimal_ether(value: int) -> str:
    text = format(Decimal(value) / Decimal(10**18), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def load_deployment(
    env: Union[dict[str, str], os._Environ] = os.environ,
) -> dict[str, Any]:
    chain_id = int(env.get("CHAIN_ID", "31337"))
    if chain_id <= 0:
        raise ValueError("CHAIN_ID must be positive.")
    if env.get("CONTRACT_ADDRESS"):
        deployment = {
            "chainId": chain_id,
            "address": env["CONTRACT_ADDRESS"],
            "blockNumber": int(env.get("DEPLOYMENT_BLOCK", "0")),
            "transactionHash": env.get("DEPLOYMENT_TX_HASH"),
            "deployedAt": env.get("DEPLOYED_AT"),
        }
    else:
        deployment_file = Path(
            env.get("DEPLOYMENT_FILE", f"deployments/{chain_id}.json")
        )
        if not deployment_file.is_absolute():
            deployment_file = ROOT / deployment_file
        deployment = json.loads(deployment_file.read_text(encoding="utf-8"))
    if int(deployment["chainId"]) != chain_id:
        raise ValueError("Deployment chain ID does not match CHAIN_ID.")
    if not ADDRESS_RE.fullmatch(str(deployment["address"])):
        raise ValueError("Invalid contract address.")
    if int(deployment["blockNumber"]) < 0:
        raise ValueError("DEPLOYMENT_BLOCK must be non-negative.")
    return deployment


class ChainService:
    def __init__(self, env: Union[dict[str, str], os._Environ] = os.environ):
        self.deployment = load_deployment(env)
        self.artifact = json.loads(
            (ROOT / "artifacts/CharityFund.json").read_text(encoding="utf-8")
        )
        rpc_url = env.get("RPC_URL", "http://127.0.0.1:8545")
        self.web3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 20}))
        self.contract = self.web3.eth.contract(
            address=Web3.to_checksum_address(self.deployment["address"]),
            abi=self.artifact["abi"],
        )
        self.config = {
            **self.deployment,
            "abi": self.artifact["abi"],
            "networkName": (
                "Local development"
                if self.deployment["chainId"] == 31337
                else "Sepolia"
            ),
            "explorer": (
                "https://sepolia.etherscan.io"
                if self.deployment["chainId"] == 11155111
                else None
            ),
        }
        event_abis = [
            entry for entry in self.artifact["abi"] if entry.get("type") == "event"
        ]
        self.event_abis = {
            event_abi_to_log_topic(event_abi): event_abi for event_abi in event_abis
        }

    def health(self) -> None:
        if self.web3.eth.chain_id != self.deployment["chainId"]:
            raise RuntimeError("Deployment does not match RPC network.")
        if not self.web3.eth.get_code(self.contract.address):
            raise RuntimeError("No contract code exists at the configured address.")

    @staticmethod
    def _block_number(block: Any) -> int:
        return int(block["number"])

    @staticmethod
    def _block_timestamp(block: Any) -> int:
        return int(block["timestamp"])

    def _encode_campaign(self, row: Any, campaign_id: int, timestamp: int) -> dict[str, Any]:
        (
            creator,
            beneficiary,
            goal,
            raised,
            refunded,
            deadline,
            withdrawn,
            title,
            description,
            category,
        ) = row
        status_index = 2 if withdrawn else 1 if raised >= goal else 3 if timestamp >= deadline else 0
        return {
            "id": campaign_id,
            "creator": creator,
            "beneficiary": beneficiary,
            "goal": _decimal_ether(goal),
            "raised": _decimal_ether(raised),
            "refunded": _decimal_ether(refunded),
            "deadline": int(deadline),
            "withdrawn": bool(withdrawn),
            "title": title,
            "description": description,
            "category": int(category),
            "status": STATUSES[status_index],
        }

    def campaign(self, campaign_id: int) -> dict[str, Any]:
        block = self.web3.eth.get_block("latest")
        block_number = self._block_number(block)
        total = self.contract.functions.campaignCount().call(
            block_identifier=block_number
        )
        if campaign_id >= total:
            raise LookupError("Campaign not found.")
        row = self.contract.functions.getCampaign(campaign_id).call(
            block_identifier=block_number
        )
        return self._encode_campaign(
            row, campaign_id, self._block_timestamp(block)
        )

    def campaigns(self, offset: int, limit: int) -> dict[str, Any]:
        block = self.web3.eth.get_block("latest")
        block_number = self._block_number(block)
        total = int(
            self.contract.functions.campaignCount().call(
                block_identifier=block_number
            )
        )
        ids = range(total - 1 - offset, max(-1, total - 1 - offset - limit), -1)
        items = [
            self._encode_campaign(
                self.contract.functions.getCampaign(campaign_id).call(
                    block_identifier=block_number
                ),
                campaign_id,
                self._block_timestamp(block),
            )
            for campaign_id in ids
            if campaign_id >= 0
        ]
        return {
            "total": total,
            "offset": offset,
            "blockNumber": block_number,
            "items": items,
        }

    def history(self, account: Optional[str]) -> dict[str, Any]:
        latest = self.web3.eth.get_block("latest")
        latest_number = self._block_number(latest)
        from_block = max(int(self.deployment["blockNumber"]), latest_number - 9999)
        requested = account.lower() if account else None
        rows: list[dict[str, Any]] = []
        for start in range(from_block, latest_number + 1, 500):
            logs = self.web3.eth.get_logs(
                {
                    "address": self.contract.address,
                    "fromBlock": start,
                    "toBlock": min(start + 499, latest_number),
                }
            )
            for log in logs:
                event_abi = self.event_abis.get(bytes(log["topics"][0]))
                if not event_abi:
                    continue
                event = get_event_data(self.web3.codec, event_abi, log)
                args = event["args"]
                actor = args.get("donor") or args.get("beneficiary") or args.get("creator")
                creator = args.get("creator")
                if requested and actor.lower() != requested and (
                    not creator or creator.lower() != requested
                ):
                    continue
                amount = args.get("amount")
                rows.append(
                    {
                        "type": event["event"],
                        "campaignId": int(args["id"]),
                        "account": actor,
                        "amount": _decimal_ether(amount) if amount is not None else None,
                        "hash": log["transactionHash"].hex(),
                        "blockNumber": int(log["blockNumber"]),
                        "logIndex": int(log["logIndex"]),
                        "confirmations": latest_number - int(log["blockNumber"]) + 1,
                    }
                )
        rows.reverse()
        return {
            "fromBlock": from_block,
            "toBlock": latest_number,
            "total": len(rows),
            "items": rows[:100],
            "limit": 100,
        }


def create_app(service: Optional[Any] = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    chain = service or ChainService()

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self' https: http://127.0.0.1:8545"
        )
        return response

    @app.get("/api/health")
    def health():
        chain.health()
        return jsonify(ok=True)

    @app.get("/api/config")
    def config():
        return jsonify(chain.config)

    @app.get("/api/artifact")
    def artifact():
        return jsonify(chain.artifact)

    @app.get("/api/campaigns")
    def campaigns():
        try:
            offset = int(request.args.get("offset", "0"))
            limit = int(request.args.get("limit", "20"))
        except ValueError:
            return jsonify(error="Invalid pagination."), 400
        if offset < 0 or limit < 1 or limit > 50:
            return jsonify(error="Invalid pagination."), 400
        return jsonify(chain.campaigns(offset, limit))

    @app.get("/api/campaigns/<campaign_id>")
    def campaign(campaign_id: str):
        if not campaign_id.isdecimal():
            return jsonify(error="Invalid campaign ID."), 400
        try:
            return jsonify(chain.campaign(int(campaign_id)))
        except LookupError:
            return jsonify(error="Campaign not found."), 404

    @app.get("/api/history")
    def history():
        account = request.args.get("account")
        if account and not ADDRESS_RE.fullmatch(account):
            return jsonify(error="Invalid wallet address."), 400
        return jsonify(chain.history(account))

    @app.get("/api/<path:_unused>")
    def missing_api(_unused: str):
        return jsonify(error="API route not found."), 404

    @app.get("/assets/<path:filename>")
    def assets(filename: str):
        return send_from_directory(ROOT / "dist" / "assets", filename)

    @app.get("/")
    @app.get("/<path:_path>")
    def frontend(_path: str = ""):
        return send_from_directory(ROOT / "dist", "index.html")

    @app.errorhandler(Exception)
    def unavailable(error: Exception):
        app.logger.exception("Request failed", exc_info=error)
        return (
            jsonify(
                error="Blockchain service unavailable. Check the RPC connection and deployment."
            ),
            503,
        )

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "3001")))
