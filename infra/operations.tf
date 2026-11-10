resource "aws_sns_topic" "operations" {
  name = "${local.name}-operations"
}
resource "aws_sns_topic_subscription" "email" {
  count     = var.notification_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.operations.arn
  protocol  = "email"
  endpoint  = var.notification_email
}
resource "aws_iam_role" "digest" {
  name = "${local.name}-digest"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
  Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_cloudwatch_log_group" "digest" {
  name              = "/aws/lambda/${local.name}-digest"
  retention_in_days = 14
}
resource "aws_iam_role_policy" "digest" {
  role = aws_iam_role.digest.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "sns:Publish", Resource = aws_sns_topic.operations.arn },
    { Effect = "Allow", Action = "cloudwatch:GetMetricStatistics", Resource = "*" },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.digest.arn}:*" }
  ] })
}
resource "aws_lambda_function" "digest" {
  count         = var.api_image_uri == "" ? 0 : 1
  function_name = "${local.name}-digest"
  role          = aws_iam_role.digest.arn
  package_type  = "Image"
  image_uri     = var.api_image_uri
  architectures = ["x86_64"]
  image_config { command = ["digest.handler"] }
  memory_size = 128
  timeout     = 30
  environment { variables = {
    TOPIC_ARN    = aws_sns_topic.operations.arn
    API_FUNCTION = "${local.name}-api"
  } }
  depends_on = [aws_iam_role_policy.digest, aws_ecr_repository_policy.lambda]
}
resource "aws_iam_role" "scheduler" {
  name = "${local.name}-scheduler"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole",
  Condition = { StringEquals = { "aws:SourceAccount" = local.account } } }] })
}
resource "aws_iam_role_policy" "scheduler" {
  count = var.api_image_uri == "" ? 0 : 1
  role  = aws_iam_role.scheduler.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
  Effect = "Allow", Action = "lambda:InvokeFunction", Resource = aws_lambda_function.digest[0].arn }] })
}
resource "aws_scheduler_schedule" "digest" {
  count                        = var.api_image_uri == "" ? 0 : 1
  name                         = "${local.name}-weekly-digest"
  state                        = var.enable_schedule ? "ENABLED" : "DISABLED"
  schedule_expression          = "cron(0 9 ? * MON *)"
  schedule_expression_timezone = "America/New_York"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_lambda_function.digest[0].arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 2
    }
  }
  depends_on = [aws_iam_role_policy.scheduler]
}
resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "${local.name}-api-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = "${local.name}-api" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
}
resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = local.name
  dashboard_body = jsonencode({ widgets = [
    { type = "metric", x = 0, y = 0, width = 12, height = 6, properties = {
      title = "API Lambda requests and errors", region = var.region, stat = "Sum", period = 300,
    metrics = [["AWS/Lambda", "Invocations", "FunctionName", "${local.name}-api"], ["AWS/Lambda", "Errors", "FunctionName", "${local.name}-api"]] } },
    { type = "metric", x = 12, y = 0, width = 12, height = 6, properties = {
      title = "API Lambda duration", region = var.region, stat = "Average", period = 300,
    metrics = [["AWS/Lambda", "Duration", "FunctionName", "${local.name}-api"]] } },
    { type = "metric", x = 0, y = 6, width = 12, height = 6, properties = {
      title = "HTTP API requests and server errors", region = var.region, stat = "Sum", period = 300,
    metrics = [["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.api.id], ["AWS/ApiGateway", "5xx", "ApiId", aws_apigatewayv2_api.api.id]] } }
  ] })
}
