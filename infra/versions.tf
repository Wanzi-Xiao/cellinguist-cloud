terraform {
  required_version = ">= 1.6, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}
provider "aws" {
  region = var.region
  default_tags { tags = { Project = "cellinguist-cloud", Environment = var.environment } }
}
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
locals {
  name    = "cellinguist-${var.environment}"
  account = data.aws_caller_identity.current.account_id
}
