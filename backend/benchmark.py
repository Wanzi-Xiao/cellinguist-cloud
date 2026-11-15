"""Optional IAM-only performance probe; never exposed as a public API route."""
import json
import os
import re
import time
import boto3
from botocore.config import Config
from object_json import read_json_object

s3 = boto3.client("s3", config=Config(signature_version="s3v4", retries={"max_attempts": 2}))
COLD = True
KEY = re.compile(r"^benchmarks/gzip/[a-f0-9]{32}/[a-z0-9_-]{1,50}/(?:plain|gzip)\.json$")


def handler(event, context):
    global COLD
    cold = COLD
    COLD = False
    key = event.get("key", "")
    if not KEY.fullmatch(key):
        raise ValueError("Only temporary gzip benchmark keys are supported")
    start = time.perf_counter()
    obj = s3.get_object(Bucket=os.environ["RESULTS_BUCKET"], Key=key)
    # read_json_object uses the same bounded path as production. This aggregate
    # includes transfer+inflate+JSON parsing; local paired decode isolates CPU cost.
    parsed = read_json_object(obj["Body"], obj.get("ContentEncoding"))
    elapsed = (time.perf_counter() - start) * 1000
    if parsed.get("synthetic") is not True:
        raise ValueError("Benchmark fixtures must be explicitly synthetic")
    return {"read_decode_ms": elapsed, "wire_bytes": obj["ContentLength"],
            "encoding": obj.get("ContentEncoding", "identity"), "cold_start": cold,
            "fixture_id": parsed.get("fixtureId", parsed.get("fixtureVersion")), "padding_bytes": len(parsed.get("padding", ""))}
