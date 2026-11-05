variable "region" {
  type    = string
  default = "us-east-1"
}
variable "environment" {
  type    = string
  default = "dev"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,15}$", var.environment))
    error_message = "Use a short lowercase environment identifier."
  }
}
variable "github_repository" {
  type    = string
  default = "Wanzi-Xiao/cellinguist-cloud"
}
variable "notification_email" {
  type    = string
  default = ""
}
variable "api_image_uri" {
  type        = string
  default     = ""
  description = "ECR image URI pinned to a commit SHA or digest; empty enables bootstrap only."
}
variable "enable_schedule" {
  type    = bool
  default = false
}
variable "github_oidc_provider_arn" {
  type        = string
  default     = ""
  description = "Reuse an existing GitHub OIDC provider if this account already has one."
}
