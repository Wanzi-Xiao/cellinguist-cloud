"""Operational metrics only; never reads researcher history."""
import os
from datetime import datetime, timedelta, timezone


def handler(event, context):
    import boto3
    end = datetime.now(timezone.utc)
    metrics = boto3.client("cloudwatch")
    lines = ["Cellinguist Cloud weekly operational digest (last 7 days)"]
    for metric in ("Invocations", "Errors"):
        data = metrics.get_metric_statistics(Namespace="AWS/Lambda", MetricName=metric,
            Dimensions=[{"Name": "FunctionName", "Value": os.environ["API_FUNCTION"]}],
            StartTime=end-timedelta(days=7), EndTime=end, Period=86400, Statistics=["Sum"])
        total = sum(point["Sum"] for point in data.get("Datapoints", []))
        lines.append(f"{metric}: {total:g}")
    boto3.client("sns").publish(TopicArn=os.environ["TOPIC_ARN"],
        Subject="Cellinguist Cloud operational digest", Message="\n".join(lines))
    return {"status": "published"}
