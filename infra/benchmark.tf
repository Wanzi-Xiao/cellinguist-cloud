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
