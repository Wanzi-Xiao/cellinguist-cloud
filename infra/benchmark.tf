# Temporary measurement resources. Keep false after collecting evidence.
variable "enable_gzip_benchmark" {
  type    = bool
  default = false
}
resource "aws_iam_role" "benchmark" {
  count = var.enable_gzip_benchmark ? 1 : 0
  name  = "${local.name}-gzip-benchmark"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
  Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_cloudwatch_log_group" "benchmark" {
  count             = var.enable_gzip_benchmark ? 1 : 0
  name              = "/aws/lambda/${local.name}-gzip-benchmark"
  retention_in_days = 1
}
resource "aws_iam_role_policy" "benchmark" {
  count = var.enable_gzip_benchmark ? 1 : 0
  role  = aws_iam_role.benchmark[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "s3:GetObject", Resource = "${aws_s3_bucket.results.arn}/benchmarks/gzip/*" },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.benchmark[0].arn}:*" }
  ] })
}
resource "aws_lambda_function" "benchmark" {
  count         = var.enable_gzip_benchmark ? 1 : 0
  function_name = "${local.name}-gzip-benchmark"
  role          = aws_iam_role.benchmark[0].arn
  package_type  = "Image"
  image_uri     = var.api_image_uri
  architectures = ["x86_64"]
  image_config { command = ["benchmark.handler"] }
  timeout                        = 15
  memory_size                    = 256
  reserved_concurrent_executions = 1
  environment { variables = { RESULTS_BUCKET = aws_s3_bucket.results.id } }
  depends_on = [aws_iam_role_policy.benchmark, aws_ecr_repository_policy.lambda]
}

# Optional one-off integration check, not a recurring job. Disable after evidence.
variable "digest_check_at" {
  type        = string
  default     = ""
  description = "UTC timestamp YYYY-MM-DDTHH:MM:SS for an explicitly run one-time digest integration check; empty disables it."
  validation {
    condition     = var.digest_check_at == "" || can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$", var.digest_check_at))
    error_message = "Use an empty string or a UTC schedule timestamp without a timezone suffix."
  }
}
resource "aws_scheduler_schedule_group" "digest_check" {
  count = var.digest_check_at == "" ? 0 : 1
  name  = "${local.name}-course-check"
}
resource "aws_scheduler_schedule" "digest_check" {
  count                        = var.digest_check_at == "" ? 0 : 1
  name                         = "${local.name}-one-time-digest-check"
  group_name                   = aws_scheduler_schedule_group.digest_check[0].name
  state                        = "ENABLED"
  schedule_expression          = "at(${var.digest_check_at})"
  schedule_expression_timezone = "UTC"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_lambda_function.digest[0].arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ source = "cellinguist-course-scheduler-check" })
    retry_policy {
      maximum_event_age_in_seconds = 300
      maximum_retry_attempts       = 0
    }
  }
  depends_on = [aws_iam_role_policy.scheduler]
}
