#!/usr/bin/env python3
"""Reproducible synthetic-only plain/gzip comparison; AWS measurement is opt-in."""
import argparse
from datetime import datetime, timezone
import gzip
import io
import json
from pathlib import Path
import random
import statistics
import string
import sys
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from object_json import read_json_object, MAX_JSON_BYTES


def cases():
    result = {"demo_summary": (ROOT / "demo/synthetic-v1/demo-cell-alpha/demo-treatment-one/summary.json").read_bytes()}
    rng = random.Random(20261115)
    for target in (32*1024, 128*1024, 240*1024):
        for pattern in ("repetitive", "mixed"):
            name = f"{pattern}_{target//1024}k"
            obj = {"synthetic": True, "fixtureId": name, "padding": ""}
            encode = lambda: json.dumps(obj, separators=(",", ":")).encode()
            size = target-len(encode())
            obj["padding"] = (("synthetic-feature;"*((size//18)+2))[:size] if pattern == "repetitive"
                              else "".join(rng.choices(string.ascii_letters+string.digits, k=size)))
            raw = encode()
            assert len(raw) == target and len(raw) <= MAX_JSON_BYTES
            result[name] = raw
    return result


def stats(values):
    ordered = sorted(values)
    return {"n": len(values), "median": statistics.median(values),
            "p95": ordered[max(0, int(len(ordered)*.95+.9999)-1)], "min": min(values), "max": max(values)}


def measure_local(fixtures):
    rows=[]
    for name, plain in fixtures.items():
        encoded=gzip.compress(plain, compresslevel=6, mtime=0)
        expected=json.loads(plain)
        timings={"plain_decode_ms":[],"gzip_decode_ms":[],"inflate_only_ms":[]}
        for _ in range(50):
            for variant,data,encoding in (("plain",plain,None),("gzip",encoded,"gzip")):
                start=time.perf_counter_ns()
                actual=read_json_object(io.BytesIO(data),encoding)
                timings[f"{variant}_decode_ms"].append((time.perf_counter_ns()-start)/1e6)
                assert actual==expected
            start=time.perf_counter_ns()
            with gzip.GzipFile(fileobj=io.BytesIO(encoded),mode="rb") as stream:
                restored=stream.read(MAX_JSON_BYTES+1)
            timings["inflate_only_ms"].append((time.perf_counter_ns()-start)/1e6)
            assert restored==plain
        rows.append({"fixture":name,"plain_bytes":len(plain),"gzip_bytes":len(encoded),
                     "reduction_pct":100*(1-len(encoded)/len(plain)),
                     **{key:stats(vals) for key,vals in timings.items()}})
    return rows


def measure_aws(fixtures, bucket, function, pairs):
    import boto3
    from botocore.config import Config
    config=Config(retries={"max_attempts":2},connect_timeout=10,read_timeout=30)
    s3=boto3.client("s3",config=config)
    client=boto3.client("lambda",config=config)
    run=uuid4().hex
    prefix=f"benchmarks/gzip/{run}/"
    marker=ROOT/".tools/perf-cleanup.json"
    marker.parent.mkdir(parents=True,exist_ok=True)
    marker.write_text(json.dumps({"bucket":bucket,"prefix":prefix}))
    marker.chmod(0o600)
    observations=[]
    warmups=[]
    try:
        for name,plain in fixtures.items():
            for variant,data,encoding in (("plain",plain,None),("gzip",gzip.compress(plain,compresslevel=6,mtime=0),"gzip")):
                s3.put_object(Bucket=bucket,Key=f"{prefix}{name}/{variant}.json",Body=data,
                              ContentType="application/json",Metadata={"synthetic":"true"},
                              **({"ContentEncoding":encoding} if encoding else {}))
        def invoke(name,variant):
            key=f"{prefix}{name}/{variant}.json"
            start=time.perf_counter()
            result=client.invoke(FunctionName=function,InvocationType="RequestResponse",
                                 Payload=json.dumps({"key":key}).encode())
            try: payload=json.loads(result["Payload"].read())
            finally: result["Payload"].close()
            elapsed=(time.perf_counter()-start)*1000
            if result.get("FunctionError"):
                raise RuntimeError(f"Benchmark handler failed: {payload.get('errorType')}")
            expected=json.loads(fixtures[name])
            assert payload['fixture_id']==expected.get('fixtureId',expected.get('fixtureVersion'))
            assert payload['padding_bytes']==len(expected.get('padding',''))
            return {"fixture":name,"variant":variant,"invoke_roundtrip_ms":elapsed,**payload}
        for name in fixtures:
            for variant in ("plain","gzip"):
                warmups.append(invoke(name,variant))
        sequence=[(name,index) for name in fixtures for index in range(pairs)]
        rng=random.Random(20261115)
        rng.shuffle(sequence)
        for name,index in sequence:
            variants=["plain","gzip"]
            rng.shuffle(variants)
            for variant in variants:
                row=invoke(name,variant)
                row['pair']=index
                assert row['cold_start'] is False,'Unexpected cold start; do not mix it into warm timing'
                observations.append(row)
            if len(observations)%28==0: print(f"Measured {len(observations)} warm invocations",flush=True)
        summaries=[]
        for name in fixtures:
            variants={}
            for variant in ("plain","gzip"):
                chosen=[r for r in observations if r['fixture']==name and r['variant']==variant]
                variants[variant]={key:stats([r[key] for r in chosen]) for key in ('read_decode_ms','invoke_roundtrip_ms')}
            deltas=[]
            for index in range(pairs):
                pair={r['variant']:r for r in observations if r['fixture']==name and r['pair']==index}
                deltas.append(pair['gzip']['read_decode_ms']-pair['plain']['read_decode_ms'])
            summaries.append({'fixture':name,'variants':variants,'paired_gzip_minus_plain_read_ms':stats(deltas)})
        return {'region':client.meta.region_name,'pairs_per_fixture':pairs,'warmups':warmups,
                'observations':observations,'summaries':summaries}
    finally:
        # Delete versions, not merely current keys: the results bucket is versioned.
        count=0
        for page in s3.get_paginator('list_object_versions').paginate(Bucket=bucket,Prefix=prefix):
            objects=[{'Key':v['Key'],'VersionId':v['VersionId']} for section in ('Versions','DeleteMarkers') for v in page.get(section,[])]
            if objects:
                response=s3.delete_objects(Bucket=bucket,Delete={'Objects':objects,'Quiet':True})
                if response.get('Errors'):raise RuntimeError('Benchmark version cleanup failed; inspect .tools/perf-cleanup.json')
                count+=len(objects)
        marker.unlink(missing_ok=True)
        print(f"Removed {count} temporary S3 object versions; no demo objects changed.",flush=True)


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--aws',action='store_true')
    p.add_argument('--bucket')
    p.add_argument('--function',default='cellinguist-dev-gzip-benchmark')
    p.add_argument('--pairs',type=int,default=12)
    p.add_argument('--output',type=Path,default=ROOT/'docs/gzip-benchmark.json')
    args=p.parse_args()
    if args.aws and not args.bucket:p.error('--aws requires --bucket')
    if not 5<=args.pairs<=30:p.error('--pairs must be between 5 and 30')
    fixtures=cases()
    report={'date':datetime.now(timezone.utc).date().isoformat(),'synthetic_only':True,'gzip_level':6,'local_iterations':50,
            'limits':{'wire_bytes':MAX_JSON_BYTES,'decoded_bytes':MAX_JSON_BYTES},
            'method':'Deterministic plain/gzip payloads; local decode and bounded inflate; randomized paired warm AWS S3→Lambda reads using the production decoder.',
            'limitations':['Synthetic inputs only; one region and run, not a general speed guarantee.',
                           'AWS invoke roundtrip includes SDK/network/function but NOT API Gateway, Cognito, catalog lookup, plot presigning or returning the full summary.',
                           'Warm starts only; no throughput/load test. p95 from 12 pairs is descriptive and noisy.'],
            'local':measure_local(fixtures)}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    args.output.chmod(0o600)
    print('Local metrics saved:',args.output,flush=True)
    if args.aws:
        report['aws']=measure_aws(fixtures,args.bucket,args.function,args.pairs)
        args.output.write_text(json.dumps(report,indent=2)+'\n')
    for row in report['local']:
        print(f"{row['fixture']}: {row['plain_bytes']} → {row['gzip_bytes']} bytes ({row['reduction_pct']:.1f}% reduction); inflate median {row['inflate_only_ms']['median']:.4f} ms")


if __name__=='__main__':main()
