import unittest

from app import create_app, load_deployment


class FakeService:
    config = {"chainId": 11155111, "address": "0x" + "1" * 40, "abi": []}
    artifact = {"abi": [], "bytecode": "0x00"}

    def health(self):
        return None

    def campaigns(self, offset, limit):
        return {"total": 1, "offset": offset, "blockNumber": 10, "items": []}

    def campaign(self, campaign_id):
        if campaign_id != 0:
            raise LookupError
        return {"id": 0, "title": "Example"}

    def history(self, account):
        return {"fromBlock": 1, "toBlock": 10, "total": 0, "items": [], "limit": 100}


class FlaskApiTests(unittest.TestCase):
    def setUp(self):
        self.client = create_app(FakeService()).test_client()

    def test_health_config_and_campaigns(self):
        self.assertEqual(self.client.get("/api/health").json, {"ok": True})
        self.assertEqual(self.client.get("/api/config").json["chainId"], 11155111)
        self.assertEqual(self.client.get("/api/campaigns?offset=2&limit=10").json["offset"], 2)
        self.assertEqual(self.client.get("/api/campaigns/0").json["title"], "Example")

    def test_validation_and_security_headers(self):
        response = self.client.get("/api/campaigns?limit=100")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Content-Security-Policy", response.headers)
        self.assertEqual(self.client.get("/api/campaigns/no").status_code, 400)
        self.assertEqual(self.client.get("/api/campaigns/99").status_code, 404)
        self.assertEqual(self.client.get("/api/history?account=no").status_code, 400)

    def test_render_environment_descriptor(self):
        deployment = load_deployment(
            {
                "CHAIN_ID": "11155111",
                "CONTRACT_ADDRESS": "0x" + "2" * 40,
                "DEPLOYMENT_BLOCK": "11821189",
            }
        )
        self.assertEqual(deployment["chainId"], 11155111)
        self.assertEqual(deployment["blockNumber"], 11821189)


if __name__ == "__main__":
    unittest.main()
