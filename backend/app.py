"""Read-only curated results and user-scoped history. No inference dependencies."""
import base64
import json
import logging
import os
import re
from datetime import datetime, timezone
from uuid import uuid4

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)
SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

class InvalidSelection(ValueError):
    pass

class Store:
    def __init__(self):
        import boto3
        self.s3 = boto3.client("s3")
        self.table = boto3.resource("dynamodb").Table(os.environ["HISTORY_TABLE"])
        self.bucket = os.environ["RESULTS_BUCKET"]

    def read_json(self, key):
        from botocore.exceptions import ClientError
        try:
            body = self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read(262145)
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return None
            raise
        if len(body) > 262144:
            raise RuntimeError("Curated object exceeds size limit")
        return json.loads(body)

    def catalog(self):
        return self.read_json("results/v1/catalog.json") or {"version": "v1", "entries": []}

    def result(self, cell, condition):
        prefix = f"results/v1/{cell}/{condition}"
        summary = self.read_json(f"{prefix}/summary.json")
        if summary is None:
            return None
        return {"precomputed": True, "resultVersion": "v1", "summary": summary,
                "plotUrl": self.s3.generate_presigned_url("get_object", Params={
                    "Bucket": self.bucket, "Key": f"{prefix}/plot.png"}, ExpiresIn=300)}

    def save(self, sub, cell, condition):
        now = datetime.now(timezone.utc).isoformat()
        item = {"PK": f"USER#{sub}", "SK": f"QUERY#{now}#{uuid4()}",
                "cellType": cell, "conditionId": condition, "createdAt": now, "resultVersion": "v1"}
        self.table.put_item(Item=item, ConditionExpression="attribute_not_exists(PK) AND attribute_not_exists(SK)")
        return public_item(item)

    def history(self, sub):
        from boto3.dynamodb.conditions import Key
        result = self.table.query(KeyConditionExpression=Key("PK").eq(f"USER#{sub}"),
                                  ScanIndexForward=False, Limit=50)
        return [public_item(item) for item in result.get("Items", [])]


def public_item(item):
    return {key: value for key, value in item.items() if key != "PK"}


def response(status, body):
    return {"statusCode": status, "headers": {"content-type": "application/json", "cache-control": "no-store"},
            "body": json.dumps(body)}


def selection(store, cell, condition):
    if not all(isinstance(v, str) and SLUG.fullmatch(v) for v in (cell, condition)):
        raise InvalidSelection("Use catalog cell_type and condition identifiers")
    entries = store.catalog().get("entries", [])
    if not any(e.get("cellType") == cell and e.get("conditionId") == condition for e in entries):
        raise InvalidSelection("Selection is not in the approved catalog")


def handler(event, context, store=None):
    path = event.get("rawPath", "")
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    if (method, path) == ("GET", "/health"):
        return response(200, {"status": "ok", "mode": "precomputed-only"})
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        return response(401, {"error": "Authentication required"})
    try:
        store = store if store is not None else Store()
        if (method, path) == ("GET", "/catalog"):
            return response(200, store.catalog())
        if (method, path) == ("GET", "/results"):
            params = event.get("queryStringParameters") or {}
            cell, condition = params.get("cell_type"), params.get("condition")
            selection(store, cell, condition)
            result = store.result(cell, condition)
            return response(200, result) if result else response(404, {"error": "Result not found"})
        if (method, path) == ("POST", "/history"):
            raw = event.get("body") or ""
            if len(raw) > 8192:
                return response(413, {"error": "Request too large"})
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw, validate=True).decode("utf-8")
            body = json.loads(raw)
            if not isinstance(body, dict) or set(body) != {"cellType", "conditionId"}:
                raise InvalidSelection("Expected only cellType and conditionId")
            cell, condition = body["cellType"], body["conditionId"]
            selection(store, cell, condition)
            return response(201, store.save(sub, cell, condition))
        if (method, path) == ("GET", "/history"):
            return response(200, {"items": store.history(sub), "limit": 50})
        return response(404, {"error": "Route not found"})
    except (ValueError, UnicodeError):
        return response(400, {"error": "Invalid request or unsupported selection"})
    except Exception:
        log.exception("API request failed")
        return response(500, {"error": "Internal server error"})
