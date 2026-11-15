#!/usr/bin/env python3
"""Temporarily encode one synthetic summary; restore by deleting only our version."""
import gzip
import json
import os
from pathlib import Path
import subprocess
import boto3

ROOT=Path(__file__).resolve().parents[1]
outputs=json.loads(subprocess.check_output([str(ROOT/'.tools/bin/terraform'),'-chdir=infra','output','-json'],cwd=ROOT,text=True))
BUCKET=outputs['results_bucket']['value']
KEY='results/v1/demo-cell-alpha/demo-treatment-one/summary.json'
s3=boto3.client('s3')
obj=s3.get_object(Bucket=BUCKET,Key=KEY)
try:plain=obj['Body'].read(262145)
finally:obj['Body'].close()
assert len(plain)<=262144 and not obj.get('ContentEncoding')
summary=json.loads(plain)
assert summary.get('synthetic') is True and summary['cellType']=='demo-cell-alpha'
created=None
marker=ROOT/'.tools/gzip-restore.json'
try:
    response=s3.put_object(Bucket=BUCKET,Key=KEY,Body=gzip.compress(plain,compresslevel=6,mtime=0),
        ContentType='application/json',ContentEncoding='gzip',Metadata=obj.get('Metadata',{}))
    created=response['VersionId']
    marker.write_text(json.dumps({'bucket':BUCKET,'key':KEY,'temporaryVersion':created,'originalVersion':obj['VersionId']}))
    marker.chmod(0o600)
    assert created and created!='null','Bucket versioning is required for this test'
    assert s3.head_object(Bucket=BUCKET,Key=KEY)['ContentEncoding']=='gzip'
    print('Testing the real application against one gzip-encoded synthetic summary; other fixtures remain plain.',flush=True)
    subprocess.run(['node','scripts/aws_smoke.mjs'],cwd=ROOT,
                   env={**os.environ,'CELLINGUIST_LIVE_CHECK':'1'},check=True)
finally:
    if created:
        s3.delete_object(Bucket=BUCKET,Key=KEY,VersionId=created)
        restored=s3.head_object(Bucket=BUCKET,Key=KEY)
        assert restored['VersionId']==obj['VersionId']
        assert not restored.get('ContentEncoding')
        marker.unlink(missing_ok=True)
        print('Removed only the temporary gzip version; original plain fixture restored.',flush=True)
