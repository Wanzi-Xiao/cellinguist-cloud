resource "aws_s3_bucket" "frontend" {
  bucket = "${local.name}-frontend-${local.account}"
}
resource "aws_s3_bucket" "results" {
  bucket = "${local.name}-results-${local.account}"
}
resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_public_access_block" "results" {
  bucket                  = aws_s3_bucket.results.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "results" {
  bucket = aws_s3_bucket.results.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_versioning" "results" {
  bucket = aws_s3_bucket.results.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_dynamodb_table" "history" {
  name         = "${local.name}-history"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"
  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
}
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = local.name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }
  default_cache_behavior {
    target_origin_id           = "frontend"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.frontend.id
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject",
    Resource  = "${aws_s3_bucket.frontend.arn}/*",
    Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn } }
  }] })
  depends_on = [aws_s3_bucket_public_access_block.frontend]
}
locals {
  frontend_types = {
    "index.html" = "text/html; charset=utf-8"
    "styles.css" = "text/css; charset=utf-8"
    "app.mjs"    = "text/javascript; charset=utf-8"
    "auth.mjs"   = "text/javascript; charset=utf-8"
    "api.mjs"    = "text/javascript; charset=utf-8"
  }
}
resource "aws_s3_object" "frontend" {
  for_each      = local.frontend_types
  bucket        = aws_s3_bucket.frontend.id
  key           = each.key
  source        = "${path.module}/../frontend/${each.key}"
  etag          = filemd5("${path.module}/../frontend/${each.key}")
  content_type  = each.value
  cache_control = "no-cache"
}
resource "aws_s3_object" "config" {
  bucket = aws_s3_bucket.frontend.id
  key    = "config.js"
  content = "window.CELLINGUIST_CONFIG = Object.freeze(${jsonencode({
    apiUrl        = aws_apigatewayv2_api.api.api_endpoint
    cognitoDomain = "https://${aws_cognito_user_pool_domain.users.domain}.auth.${var.region}.amazoncognito.com"
    clientId      = aws_cognito_user_pool_client.web.id
    redirectUri   = "https://${aws_cloudfront_distribution.frontend.domain_name}/"
  })});"
  content_type  = "text/javascript; charset=utf-8"
  cache_control = "no-store"
}
resource "aws_s3_object" "empty_catalog" {
  bucket       = aws_s3_bucket.results.id
  key          = "results/v1/catalog.json"
  content      = jsonencode({ version = "v1", entries = [] })
  content_type = "application/json"
  # This is bootstrap configuration. Later curated uploads are owned outside Terraform.
  lifecycle { ignore_changes = [content] }
}
resource "aws_cloudfront_response_headers_policy" "frontend" {
  name = "${local.name}-browser-security"
  security_headers_config {
    content_type_options { override = true }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      override                   = true
    }
    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://${aws_s3_bucket.results.id}.s3.amazonaws.com https://${aws_s3_bucket.results.id}.s3.${var.region}.amazonaws.com; connect-src 'self' https://*.execute-api.${var.region}.amazonaws.com https://${aws_cognito_user_pool_domain.users.domain}.auth.${var.region}.amazoncognito.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
      override                = true
    }
  }
}
