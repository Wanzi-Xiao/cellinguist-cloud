"""Operational metrics only; never reads researcher history."""
import json
import logging
import os
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)
log.setLevel(logging.INFO)


def handler(event, context, client_factory=None):
    if client_factory is None:
        import boto3
        client_factory = boto3.client
    end = datetime.now(timezone.utc)
    metrics = client_factory("cloudwatch")
    test = event.get("source") == "cellinguist-course-scheduler-check"
    lines = ["Cellinguist Cloud operational digest (last 7 days)"]
    if test:
        lines.insert(0, "COURSE INTEGRATION TEST — this is not an actual failure alert.")
    for metric in ("Invocations", "Errors"):
        data = metrics.get_metric_statistics(Namespace="AWS/Lambda", MetricName=metric,
            Dimensions=[{"Name": "FunctionName", "Value": os.environ["API_FUNCTION"]}],
            StartTime=end-timedelta(days=7), EndTime=end, Period=86400, Statistics=["Sum"])
        total = sum(point["Sum"] for point in data.get("Datapoints", []))
        lines.append(f"{metric}: {total:g}")
    published = client_factory("sns").publish(TopicArn=os.environ["TOPIC_ARN"],
        Subject="Cellinguist Cloud TEST digest" if test else "Cellinguist Cloud operational digest",
        Message="\n".join(lines))
    source = "scheduled-check" if test else "operational"
    log.info(json.dumps({"event": "digest_published", "source": source,
                        "snsMessageId": published["MessageId"],
                        "requestId": getattr(context, "aws_request_id", "unknown")}))
    return {"status": "published", "source": source, "messageId": published["MessageId"]}
