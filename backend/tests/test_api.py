import json
import base64
import unittest
from app import handler

class FakeStore:
    def __init__(self):
        self.rows = {}
    def catalog(self):
        return {"version": "v1", "entries": [{"cellType": "demo-cell", "conditionId": "demo-condition"}]}
    def result(self, cell, condition):
        return {"precomputed": True, "summary": {"synthetic": True}}
    def save(self, sub, cell, condition):
        row = {"cellType": cell, "conditionId": condition}
        self.rows.setdefault(sub, []).append(row)
        return row
    def history(self, sub):
        return self.rows.get(sub, [])


def event(path, method="GET", sub="alice", **kwargs):
    return {"rawPath": path, "requestContext": {"http": {"method": method},
        "authorizer": {"jwt": {"claims": {"sub": sub}}}}, **kwargs}

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.store = FakeStore()
    def call(self, e):
        return handler(e, None, self.store)
    def test_health_without_auth(self):
        self.assertEqual(self.call(event("/health", sub=None))["statusCode"], 200)
    def test_auth_required(self):
        for path in ("/catalog", "/results", "/history"):
            self.assertEqual(self.call(event(path, sub=None))["statusCode"], 401)
    def test_allowlist_and_path_traversal(self):
        for cell in ("../secret", "unknown", None):
            self.assertEqual(self.call(event("/results", queryStringParameters={
                "cell_type": cell, "condition": "demo-condition"}))["statusCode"], 400)
    def test_result_is_precomputed(self):
        r = self.call(event("/results", queryStringParameters={"cell_type": "demo-cell", "condition": "demo-condition"}))
        self.assertTrue(json.loads(r["body"])["precomputed"])
    def test_user_isolation(self):
        body = json.dumps({"cellType": "demo-cell", "conditionId": "demo-condition"})
        self.assertEqual(self.call(event("/history", "POST", body=body))["statusCode"], 201)
        self.assertEqual(json.loads(self.call(event("/history", sub="bob"))["body"])["items"], [])
        self.assertEqual(len(json.loads(self.call(event("/history"))["body"])["items"]), 1)
    def test_reject_spoofed_identity_and_bad_json(self):
        for body in ('{"userId":"bob"}', '[]', 'broken'):
            self.assertEqual(self.call(event("/history", "POST", body=body))["statusCode"], 400)
    def test_missing_allowlisted_result_returns_404(self):
        class Missing(FakeStore):
            def result(self, cell, condition):
                return None
        result = handler(event("/results", queryStringParameters={"cell_type": "demo-cell", "condition": "demo-condition"}), None, Missing())
        self.assertEqual(result["statusCode"], 404)
    def test_body_limit_is_in_bytes(self):
        result = self.call(event("/history", "POST", body="界" * 3000))
        self.assertEqual(result["statusCode"], 413)
    def test_encoded_body_and_invalid_encoding(self):
        raw = json.dumps({"cellType": "demo-cell", "conditionId": "demo-condition"})
        encoded = base64.b64encode(raw.encode()).decode()
        self.assertEqual(self.call(event("/history", "POST", body=encoded, isBase64Encoded=True))["statusCode"], 201)
        self.assertEqual(self.call(event("/history", "POST", body="!!!", isBase64Encoded=True))["statusCode"], 400)
    def test_storage_value_error_is_server_failure_not_client_error(self):
        class Broken(FakeStore):
            def catalog(self):
                raise ValueError("invalid stored JSON")
        with self.assertLogs("app", level="ERROR"):
            result = handler(event("/catalog"), None, Broken())
        self.assertEqual(result["statusCode"], 500)
    def test_internal_error_is_sanitized(self):
        class Broken(FakeStore):
            def catalog(self):
                raise RuntimeError("private bucket name")
        with self.assertLogs("app", level="ERROR"):
            r = handler(event("/catalog"), None, Broken())
        self.assertEqual(r["statusCode"], 500)
        self.assertNotIn("private bucket", r["body"])

if __name__ == "__main__":
    unittest.main()
